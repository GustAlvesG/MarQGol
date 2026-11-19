// Monta o MarQGol: Express + Socket.IO + Postgres + serviços. `criarApp`
// recebe as dependências (testes passam um db próprio, e-mail em memória e
// fetch falso para o Asaas) e devolve { app, server, io, ... } sem escutar
// porta — quem escuta é server.js.
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const { criarRepos } = require('./repos');
const { criarArmazenamento } = require('./armazenamento');
const { criarSessao, middlewares } = require('./auth');
const { criarAgenda, ErroRegra } = require('./servicos/agenda');
const { criarContas } = require('./servicos/contas');
const { criarEmail } = require('./servicos/email');
const { criarAsaas } = require('./servicos/asaas');
const { criarCobranca } = require('./servicos/cobranca');
const { criarGerenciador } = require('./placares/gerenciador');
const { registrarSockets } = require('./placares/sockets');
const { rotasPublicas } = require('./rotas/publico');
const { rotasTelas } = require('./rotas/telas');
const { rotasArquivos, PUBLIC, opcoesEstatico } = require('./rotas/arquivos');
const { rotasApp } = require('./rotas/app');
const { rotasAdmin } = require('./rotas/admin');

function criarApp({ db, cfg, email = criarEmail(cfg), fetchAsaas } = {}) {
    if (!cfg.segredoSessao) throw new Error('SESSION_SECRET é obrigatório em produção.');
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, {
        // Logos/fotos em base64 do modo manual vêm por configurar_jogo.
        maxHttpBufferSize: 5 * 1024 * 1024
    });

    app.disable('x-powered-by');
    // Atrás do edge (Caddy): confia no primeiro proxy para IP e HTTPS.
    app.set('trust proxy', 1);

    const repos = criarRepos(db);
    const armazenamento = criarArmazenamento(cfg.dirDados);
    const asaas = criarAsaas(cfg.asaas, fetchAsaas);
    const agenda = criarAgenda(repos);
    const contas = criarContas({ repos, email, cfg });
    const cobranca = criarCobranca({ repos, asaas, email, cfg });
    const gerenciador = criarGerenciador({ repos, io, armazenamento });
    const sessao = criarSessao({ db, cfg });
    const mw = middlewares(repos);
    const deps = { repos, armazenamento, asaas, agenda, contas, cobranca, gerenciador, cfg, mw, email };

    // Webhook do Asaas: antes da sessão e do cabeçalho X-MarQ (chamada de
    // servidor para servidor, autenticada pelo token do webhook).
    app.post('/api/asaas/webhook', express.json({ limit: '1mb' }), async (req, res) => {
        if (!cfg.asaas.tokenWebhook || req.headers['asaas-access-token'] !== cfg.asaas.tokenWebhook) {
            return res.status(401).json({ erro: 'token inválido' });
        }
        try {
            res.json(await cobranca.processarWebhook(req.body));
        } catch (e) {
            console.error('Falha no webhook do Asaas:', e);
            // 500 faz o Asaas reenviar depois.
            res.status(500).json({ erro: 'falha ao processar' });
        }
    });

    app.use(sessao);
    app.use(mw.carregarUsuario);
    app.use('/api', mw.exigirCabecalhoApi);
    // JSON só em /api, e nunca nos uploads (corpo é o arquivo cru).
    app.use('/api', (req, res, next) => {
        if (req.path.startsWith('/midia') || req.path.startsWith('/app/arquivos') || /\/arte\//.test(req.path)) return next();
        return express.json({ limit: '1mb' })(req, res, next);
    });

    app.use(rotasPublicas(deps));
    app.use(rotasTelas(deps));
    app.use(rotasArquivos(deps));
    app.use(rotasApp(deps));
    app.use(rotasAdmin(deps));

    // Páginas estáticas. Site público na raiz (/entrar → entrar.html).
    app.use('/comum', express.static(path.join(PUBLIC, 'comum'), opcoesEstatico));
    app.use('/app', express.static(path.join(PUBLIC, 'app'), opcoesEstatico));
    app.use('/admin', express.static(path.join(PUBLIC, 'admin'), opcoesEstatico));
    app.use('/telao', express.static(path.join(PUBLIC, 'telao'), opcoesEstatico));
    app.use(express.static(path.join(PUBLIC, 'site'), { ...opcoesEstatico, extensions: ['html'] }));

    app.use('/api', (_req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

    // Erros: regra de negócio vira JSON com a mensagem; o resto, 500 genérico.
    // eslint-disable-next-line no-unused-vars
    app.use((erro, req, res, _next) => {
        const status = erro.status || erro.statusCode || 500;
        if (status >= 500 && !(erro instanceof ErroRegra)) console.error(`Erro em ${req.method} ${req.originalUrl}:`, erro);
        if (res.headersSent) return;
        const mensagem = status >= 500 && !(erro instanceof ErroRegra) ? 'Erro interno. Tente de novo.' : erro.message;
        if (erro.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
        res.status(status).json({ erro: mensagem, codigo: erro.codigo });
    });

    registrarSockets({ io, repos, gerenciador, agenda, armazenamento, sessao });

    async function encerrar() {
        gerenciador.parar();
        await gerenciador.gravarTodos();
        io.close();
    }

    return { app, server, io, ...deps, encerrar };
}

module.exports = { criarApp };
