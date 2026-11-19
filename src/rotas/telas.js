// Pareamento de TVs (telão, placar simples, placar neutro).
//
// 1. A TV abre /telao. Sem cookie válido, a página pede um código
//    (POST /api/telas/codigo) e mostra 6 dígitos grandes na tela.
// 2. Alguém logado digita o código em "Placares → Parear tela" (ou no
//    controle) e escolhe o placar e o tipo de tela.
// 3. A TV, consultando /api/telas/codigo/status, recebe o cookie marq_tela
//    (token só daquele placar, só leitura) e vai para o placar.
//
// Os códigos vivem em memória (expiram em 10 min): um processo só.
const express = require('express');
const crypto = require('crypto');
const seg = require('../seguranca');
const { resolverTela, lerCookies, COOKIE_TELA } = require('../auth');
const { ErroRegra } = require('../servicos/agenda');

const VALIDADE_CODIGO_MS = 10 * 60 * 1000;
const COOKIE_PAR = 'marq_par';
const CAMINHO_TIPO = { telao: '', simples: 'static.html', neutro: 'placar-neutro.html' };

function rotasTelas({ repos, cfg, mw, gerenciador }) {
    const r = express.Router();
    const codigos = new Map(); // codigo -> { segredo, criadoEm, tela?: {token, placarId, tipo} }
    const porSegredo = new Map(); // segredo -> codigo
    const limiteCodigo = seg.criarLimitador({ janelaMs: 10 * 60 * 1000, maximo: 30 });

    function limparVencidos() {
        const agora = Date.now();
        for (const [codigo, c] of codigos) {
            if (agora - c.criadoEm > VALIDADE_CODIGO_MS) { codigos.delete(codigo); porSegredo.delete(c.segredo); }
        }
    }

    const opcoesCookie = (maxAge) => ({ httpOnly: true, sameSite: 'lax', secure: cfg.producao, maxAge, path: '/' });
    const destino = (placarId, tipo) => `/p/${placarId}/${CAMINHO_TIPO[tipo] || ''}`;

    // A TV abre sempre /telao: já pareada, vai direto para o placar.
    r.get('/telao', async (req, res, next) => {
        const tela = await resolverTela(repos, lerCookies(req.headers.cookie));
        if (tela && tela.placar_ativo) return res.redirect(destino(tela.placar_id, tela.tipo));
        next(); // cai no estático public/telao/index.html (página de pareamento)
    });

    r.post('/api/telas/codigo', (req, res) => {
        if (!limiteCodigo.permitir(seg.ipDoPedido(req))) throw new ErroRegra('Muitos códigos pedidos. Aguarde.', 429);
        limparVencidos();
        let codigo;
        do { codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); } while (codigos.has(codigo));
        const segredo = seg.gerarToken(16);
        codigos.set(codigo, { segredo, criadoEm: Date.now() });
        porSegredo.set(segredo, codigo);
        res.cookie(COOKIE_PAR, segredo, opcoesCookie(VALIDADE_CODIGO_MS));
        res.json({ codigo, expiraEmSegundos: VALIDADE_CODIGO_MS / 1000 });
    });

    // A TV consulta a cada 2 s se alguém já digitou o código.
    r.get('/api/telas/codigo/status', (req, res) => {
        limparVencidos();
        const segredo = lerCookies(req.headers.cookie)[COOKIE_PAR];
        const codigo = segredo && porSegredo.get(segredo);
        const c = codigo && codigos.get(codigo);
        if (!c) return res.json({ estado: 'expirado' });
        if (!c.tela) return res.json({ estado: 'aguardando', codigo });
        codigos.delete(codigo);
        porSegredo.delete(segredo);
        // Cookie de longa duração (o máximo que os navegadores aceitam: ~400 dias).
        res.cookie(COOKIE_TELA, c.tela.token, opcoesCookie(400 * 24 * 3600 * 1000));
        res.clearCookie(COOKIE_PAR, { path: '/' });
        res.json({ estado: 'pareado', destino: destino(c.tela.placarId, c.tela.tipo) });
    });

    // Quem está logado digita o código mostrado na TV.
    r.post('/api/app/placares/:id/telas', mw.exigirCliente, mw.exigirOperante, async (req, res) => {
        limparVencidos();
        const clienteId = req.usuario.clienteId;
        const placar = await repos.placares.obter(clienteId, Number(req.params.id));
        if (!placar) throw new ErroRegra('Placar não encontrado.', 404);
        const b = req.body || {};
        const codigo = String(b.codigo || '').replace(/\D/g, '');
        const c = codigos.get(codigo);
        if (!c || c.tela) throw new ErroRegra('Código não encontrado ou vencido. Confira o número na TV.', 404);
        const tipo = CAMINHO_TIPO[b.tipo] !== undefined ? b.tipo : 'telao';
        const token = seg.gerarToken();
        const tela = await repos.telas.criar({
            cliente_id: clienteId, placar_id: placar.id, tipo,
            nome: String(b.nome || '').trim().slice(0, 60) || `TV ${codigo.slice(-3)}`,
            token_hash: seg.hashToken(token)
        });
        c.tela = { token, placarId: placar.id, tipo };
        await repos.auditoria.registrar({ usuarioId: req.usuario.id, clienteId, acao: 'tela_pareada', dados: { placar: placar.id, tela: tela.id }, ip: seg.ipDoPedido(req) });
        res.status(201).json({ id: tela.id, nome: tela.nome, tipo: tela.tipo });
    });

    r.get('/api/app/placares/:id/telas', mw.exigirCliente, async (req, res) => {
        res.json(await repos.telas.listar(req.usuario.clienteId, Number(req.params.id)));
    });

    r.delete('/api/app/telas/:id', mw.exigirCliente, async (req, res) => {
        const tela = await repos.telas.revogar(req.usuario.clienteId, Number(req.params.id));
        if (!tela) throw new ErroRegra('Tela não encontrada.', 404);
        gerenciador.desconectarTela(tela.placar_id, tela.id);
        res.json({ ok: true });
    });

    // A própria TV pode "esquecer" o pareamento (botão na página de pareamento).
    r.post('/api/telas/esquecer', (req, res) => {
        res.clearCookie(COOKIE_TELA, { path: '/' });
        res.json({ ok: true });
    });

    return r;
}

module.exports = { rotasTelas };
