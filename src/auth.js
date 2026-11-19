// Autenticação e autorização.
//
// - Pessoas (superadmin, admin e operador do cliente): sessão em cookie
//   httpOnly, guardada no Postgres (connect-pg-simple).
// - TVs (telão, placar simples, placar neutro): não têm login; são pareadas
//   uma vez e recebem um token de leitura num cookie de longa duração
//   (`marq_tela`), válido só para o placar pareado.
// - "Entrar como" (suporte): o superadmin assume a visão de um cliente; fica
//   em `session.comoClienteId` e é registrado na auditoria.
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const { hashToken } = require('./seguranca');

const COOKIE_TELA = 'marq_tela';
const COOKIE_SESSAO = 'marq_sessao';

function criarSessao({ db, cfg }) {
    return session({
        name: COOKIE_SESSAO,
        store: new PgStore({ pool: db.pool, tableName: 'sessoes', createTableIfMissing: false, pruneSessionInterval: 3600 }),
        secret: cfg.segredoSessao,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        proxy: cfg.producao,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: cfg.producao,
            maxAge: 30 * 24 * 3600 * 1000
        }
    });
}

function lerCookies(cabecalho = '') {
    const r = {};
    for (const parte of String(cabecalho).split(';')) {
        const i = parte.indexOf('=');
        if (i < 0) continue;
        const k = parte.slice(0, i).trim();
        try { r[k] = decodeURIComponent(parte.slice(i + 1).trim()); } catch { r[k] = parte.slice(i + 1).trim(); }
    }
    return r;
}

// Monta o "usuário efetivo" a partir da sessão. Devolve null se não logado,
// desativado ou se o cliente foi removido.
async function resolverUsuario(repos, sess) {
    if (!sess || !sess.usuarioId) return null;
    const u = await repos.usuarios.obter(sess.usuarioId);
    if (!u || !u.ativo) return null;
    const superadmin = u.papel === 'superadmin';
    let clienteId = u.cliente_id;
    let papel = u.papel;
    if (superadmin && sess.comoClienteId) {
        clienteId = sess.comoClienteId;
        papel = 'admin'; // dentro do cliente, o suporte age como admin
    }
    const cliente = clienteId ? await repos.clientes.obter(clienteId) : null;
    if (clienteId && !cliente) return null;
    return {
        id: u.id, nome: u.nome, email: u.email,
        papel, superadmin,
        impersonando: superadmin && !!sess.comoClienteId,
        clienteId: cliente ? cliente.id : null,
        cliente,
        emailVerificado: !!u.email_verificado_em
    };
}

// Resolve uma TV pareada pelo cookie. Devolve a linha de `telas` ou null.
async function resolverTela(repos, cookies) {
    const token = cookies[COOKIE_TELA];
    if (!token) return null;
    const tela = await repos.telas.porToken(hashToken(token));
    if (!tela) return null;
    repos.telas.tocar(tela.id).catch(() => {});
    return tela;
}

function middlewares(repos) {
    async function carregarUsuario(req, _res, next) {
        try {
            req.usuario = await resolverUsuario(repos, req.session);
            next();
        } catch (e) { next(e); }
    }

    const pedeHtml = (req) => req.method === 'GET' && (req.headers.accept || '').includes('text/html');

    function exigirLogin(req, res, next) {
        if (req.usuario) return next();
        if (pedeHtml(req)) return res.redirect('/entrar?voltar=' + encodeURIComponent(req.originalUrl));
        res.status(401).json({ erro: 'Faça login para continuar.', codigo: 'nao_autenticado' });
    }

    // Usuário de cliente (ou superadmin "entrando como").
    function exigirCliente(req, res, next) {
        if (!req.usuario) return exigirLogin(req, res, next);
        if (req.usuario.clienteId) return next();
        if (pedeHtml(req)) return res.redirect('/admin/');
        res.status(403).json({ erro: 'Área exclusiva de clientes.' });
    }

    function exigirAdminCliente(req, res, next) {
        if (req.usuario && req.usuario.clienteId && req.usuario.papel === 'admin') return next();
        res.status(403).json({ erro: 'Só o administrador da conta pode fazer isso.' });
    }

    function exigirSuperadmin(req, res, next) {
        if (req.usuario && req.usuario.superadmin) return next();
        if (pedeHtml(req)) return res.redirect(req.usuario ? '/app/' : '/entrar?voltar=' + encodeURIComponent(req.originalUrl));
        res.status(403).json({ erro: 'Acesso restrito.' });
    }

    // Mutação com o cliente suspenso/cancelado: só a área de assinatura passa.
    function exigirOperante(req, res, next) {
        const c = req.usuario && req.usuario.cliente;
        if (c && ['teste', 'ativo', 'inadimplente'].includes(c.status)) return next();
        res.status(402).json({ erro: 'A assinatura está suspensa. Regularize o pagamento em Assinatura para voltar a usar.', codigo: 'assinatura_suspensa' });
    }

    // Proteção simples contra CSRF: toda requisição que muda dados precisa do
    // cabeçalho X-MarQ (um formulário de outro site não consegue mandá-lo sem
    // passar pelo preflight de CORS, que não liberamos).
    function exigirCabecalhoApi(req, res, next) {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
        if (req.headers['x-marq'] === '1') return next();
        res.status(403).json({ erro: 'Requisição recusada (cabeçalho ausente).' });
    }

    return { carregarUsuario, exigirLogin, exigirCliente, exigirAdminCliente, exigirSuperadmin, exigirOperante, exigirCabecalhoApi };
}

module.exports = { criarSessao, lerCookies, resolverUsuario, resolverTela, middlewares, COOKIE_TELA, COOKIE_SESSAO };
