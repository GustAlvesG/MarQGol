// Rotas públicas: saúde, tabela de preços da página de venda, cadastro, login,
// confirmação de e-mail, convite e redefinição de senha.
const express = require('express');
const seg = require('../seguranca');
const { ErroRegra } = require('../servicos/agenda');
const limites = require('../limites');

// Tabela de preços do plano on demand como as telas precisam (calculadora do
// site, cadastro, assinatura). O servidor recalcula tudo na hora de gravar.
function precosPublicos(t) {
    return {
        preco_placar_centavos: t.preco_placar_centavos,
        preco_pacote_usuarios_centavos: t.preco_pacote_usuarios_centavos,
        usuarios_por_pacote: t.usuarios_por_pacote,
        precos_recursos: t.precos_recursos,
        jogos_por_placar: t.jogos_por_placar,
        armazenamento_mb_por_placar: t.armazenamento_mb_por_placar,
        dias_teste: t.dias_teste,
        max_placares_autoatendimento: t.max_placares_autoatendimento,
        max_pacotes_autoatendimento: t.max_pacotes_autoatendimento,
        recursos: Object.fromEntries(Object.entries(limites.RECURSOS).map(([k, v]) => [k, v.rotulo]))
    };
}

function rotasPublicas({ repos, contas }) {
    const r = express.Router();
    const limiteLogin = seg.criarLimitador({ janelaMs: 15 * 60 * 1000, maximo: 10 });
    const limiteCadastro = seg.criarLimitador({ janelaMs: 60 * 60 * 1000, maximo: 5 });
    const limiteSenha = seg.criarLimitador({ janelaMs: 60 * 60 * 1000, maximo: 5 });

    // Barata e sem banco: é o healthcheck do Compose e do script da VPS.
    r.get('/api/health', (_req, res) => res.json({ ok: true }));

    r.get('/api/publico/precos', async (_req, res) => res.json(precosPublicos(await repos.precos.obter())));

    function iniciarSessao(req, usuario) {
        return new Promise((resolve, reject) => {
            // Novo id de sessão no login (evita fixação de sessão).
            req.session.regenerate((e) => {
                if (e) return reject(e);
                req.session.usuarioId = usuario.id;
                req.session.save((e2) => e2 ? reject(e2) : resolve());
            });
        });
    }

    const destinoDoUsuario = (u) => u.papel === 'superadmin' ? '/admin/' : '/app/';

    r.post('/api/auth/cadastro', async (req, res) => {
        const ip = seg.ipDoPedido(req);
        if (!limiteCadastro.permitir(ip)) throw new ErroRegra('Muitos cadastros a partir desta rede. Tente mais tarde.', 429);
        const b = req.body || {};
        const { usuario } = await contas.cadastrar({
            nomeCliente: b.nomeCliente, documento: b.documento, telefone: b.telefone,
            nome: b.nome, email: b.email, senha: b.senha, composicao: b.composicao, ip
        });
        await repos.usuarios.atualizar(usuario.id, { ultimo_login_em: new Date() });
        await iniciarSessao(req, usuario);
        res.status(201).json({ ok: true, destino: '/app/' });
    });

    r.post('/api/auth/entrar', async (req, res) => {
        const ip = seg.ipDoPedido(req);
        const b = req.body || {};
        const chave = ip + '|' + seg.normalizarEmail(b.email);
        if (!limiteLogin.permitir(chave)) throw new ErroRegra('Muitas tentativas. Aguarde alguns minutos e tente de novo.', 429);
        const usuario = await contas.autenticar(b.email, b.senha);
        if (!usuario) throw new ErroRegra('E-mail ou senha incorretos.', 401);
        limiteLogin.limpar(chave);
        await iniciarSessao(req, usuario);
        res.json({ ok: true, destino: destinoDoUsuario(usuario) });
    });

    r.post('/api/auth/sair', (req, res) => {
        if (!req.session) return res.json({ ok: true });
        req.session.destroy(() => res.json({ ok: true }));
    });

    r.get('/api/auth/eu', (req, res) => {
        const u = req.usuario;
        if (!u) return res.status(401).json({ erro: 'Não autenticado' });
        res.json({
            id: u.id, nome: u.nome, email: u.email, papel: u.papel, superadmin: u.superadmin,
            impersonando: u.impersonando, emailVerificado: u.emailVerificado,
            // Sem SMTP, as telas oferecem "definir senha" no lugar de convite por e-mail.
            emailAtivo: contas.emailAtivo,
            cliente: u.cliente ? { id: u.cliente.id, nome: u.cliente.nome, status: u.cliente.status, teste_ate: u.cliente.teste_ate } : null
        });
    });

    // Link do e-mail: confirma e leva para o app.
    r.get('/api/auth/verificar-email', async (req, res) => {
        const ok = await contas.verificarEmail(String(req.query.token || ''));
        res.redirect(ok ? '/app/?email=confirmado' : '/entrar?email=link-invalido');
    });

    r.post('/api/auth/reenviar-verificacao', async (req, res) => {
        if (!req.usuario) throw new ErroRegra('Faça login.', 401);
        const u = await repos.usuarios.obter(req.usuario.id);
        if (u.email_verificado_em) return res.json({ ok: true, jaVerificado: true });
        if (!limiteSenha.permitir('verif|' + u.id)) throw new ErroRegra('Aguarde antes de pedir outro e-mail.', 429);
        await contas.enviarVerificacao(u);
        res.json({ ok: true });
    });

    r.post('/api/auth/esqueci-senha', async (req, res) => {
        const ip = seg.ipDoPedido(req);
        if (!limiteSenha.permitir(ip)) throw new ErroRegra('Muitos pedidos. Tente mais tarde.', 429);
        await contas.pedirRedefinicao(String((req.body || {}).email || ''));
        res.json({ ok: true });
    });

    r.post('/api/auth/redefinir-senha', async (req, res) => {
        const b = req.body || {};
        const u = await contas.redefinir(String(b.token || ''), b.senha);
        await iniciarSessao(req, u);
        res.json({ ok: true, destino: destinoDoUsuario(u) });
    });

    r.get('/api/auth/convite', async (req, res) => {
        const c = await contas.consultarConvite(String(req.query.token || ''));
        if (!c) throw new ErroRegra('Convite inválido ou vencido.', 410);
        res.json(c);
    });

    r.post('/api/auth/aceitar-convite', async (req, res) => {
        const b = req.body || {};
        const u = await contas.aceitarConvite(String(b.token || ''), b.senha);
        await iniciarSessao(req, u);
        res.json({ ok: true, destino: '/app/' });
    });

    return r;
}

module.exports = { rotasPublicas, precosPublicos };
