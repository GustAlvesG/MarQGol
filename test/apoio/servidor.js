// Sobe o MarQGol inteiro numa porta livre, com banco próprio, pasta de dados
// temporária, e-mail em memória e Asaas falso. Devolve helpers de HTTP (com
// cookie) e de Socket.IO.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { io: ioCliente } = require('socket.io-client');
const { criarBancoDeTeste } = require('./banco');
const { lerConfig } = require('../../src/config');
const { criarApp } = require('../../src/app');
const { garantirDadosIniciais } = require('../../src/seed');

async function subirServidor({ fetchAsaas, env = {} } = {}) {
    const db = await criarBancoDeTeste();
    const dirDados = fs.mkdtempSync(path.join(os.tmpdir(), 'marqgol-dados-'));
    const cfg = lerConfig({
        NODE_ENV: 'test', DATA_DIR: dirDados, SESSION_SECRET: 'teste',
        SUPERADMIN_EMAIL: 'dono@marqgol.test', SUPERADMIN_SENHA: 'senha-do-dono',
        ASAAS_API_KEY: fetchAsaas ? 'chave-teste' : '', ASAAS_WEBHOOK_TOKEN: 'tok-webhook',
        ...env
    });
    await garantirDadosIniciais(db, cfg);
    const marq = criarApp({ db, cfg, fetchAsaas });
    await new Promise(r => marq.server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${marq.server.address().port}`;
    cfg.urlPublica = base;
    const sockets = [];

    // Cliente HTTP com "pote" de cookies, como um navegador.
    function navegador() {
        const cookies = {};
        async function pedir(metodo, url, corpo, { headers = {}, cru = false } = {}) {
            const h = { 'x-marq': '1', cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '), ...headers };
            let body;
            if (corpo !== undefined && !cru) { h['content-type'] = 'application/json'; body = JSON.stringify(corpo); }
            else if (cru) body = corpo;
            const resp = await fetch(base + url, { method: metodo, headers: h, body, redirect: 'manual' });
            for (const c of resp.headers.getSetCookie()) {
                const [par] = c.split(';');
                const i = par.indexOf('=');
                const k = par.slice(0, i), v = par.slice(i + 1);
                if (v === '' || /Expires=Thu, 01 Jan 1970/i.test(c)) delete cookies[k]; else cookies[k] = v;
            }
            const tipo = resp.headers.get('content-type') || '';
            const dado = tipo.includes('json') ? await resp.json() : await resp.text();
            return { status: resp.status, dado, headers: resp.headers };
        }
        return {
            cookies,
            get: (u, o) => pedir('GET', u, undefined, o),
            post: (u, c, o) => pedir('POST', u, c, o),
            put: (u, c, o) => pedir('PUT', u, c, o),
            patch: (u, c, o) => pedir('PATCH', u, c, o),
            del: (u, c, o) => pedir('DELETE', u, c, o),
            cabecalhoCookie: () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
        };
    }

    // Conecta ao placar com os cookies do navegador. Resolve no 'connect' ou
    // rejeita com a mensagem do connect_error.
    function conectar(nav, placarId) {
        return new Promise((resolve, reject) => {
            const s = ioCliente(base, {
                query: { placar: placarId }, extraHeaders: { cookie: nav.cabecalhoCookie() },
                transports: ['websocket'], reconnection: false, forceNew: true
            });
            sockets.push(s);
            s.once('connect', () => resolve(s));
            s.once('connect_error', (e) => reject(e));
        });
    }

    const emitir = (s, evento, dados) => new Promise(r => s.emit(evento, dados, r));
    const proximo = (s, evento) => new Promise(r => s.once(evento, r));

    async function cadastrar(nav, extra = {}) {
        const n = Math.random().toString(36).slice(2, 8);
        const r = await nav.post('/api/auth/cadastro', {
            nomeCliente: `Clube ${n}`, documento: '529.982.247-25', nome: `Admin ${n}`,
            email: `admin-${n}@teste.com`, senha: 'senha-segura', ...extra
        });
        if (r.status !== 201) throw new Error('cadastro falhou: ' + JSON.stringify(r.dado));
        const resumo = await nav.get('/api/app/resumo');
        return resumo.dado;
    }

    async function fechar() {
        for (const s of sockets) s.disconnect();
        await marq.encerrar();
        await new Promise(r => marq.server.close(r));
        await db.fechar();
        fs.rmSync(dirDados, { recursive: true, force: true });
    }

    return { marq, db, cfg, base, navegador, conectar, emitir, proximo, cadastrar, fechar };
}

module.exports = { subirServidor };
