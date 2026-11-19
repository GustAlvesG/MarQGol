// Senhas, tokens e pequenos utilitários de segurança — só `crypto` nativo.
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 16384, r: 8, p: 1 };

async function gerarHashSenha(senha) {
    const sal = crypto.randomBytes(16);
    const hash = await scrypt(String(senha), sal, 64, PARAMS);
    return `scrypt$${PARAMS.N}$${sal.toString('hex')}$${hash.toString('hex')}`;
}

async function conferirSenha(senha, armazenado) {
    if (!armazenado || typeof armazenado !== 'string') return false;
    const [alg, n, salHex, hashHex] = armazenado.split('$');
    if (alg !== 'scrypt' || !salHex || !hashHex) return false;
    const esperado = Buffer.from(hashHex, 'hex');
    const obtido = await scrypt(String(senha), Buffer.from(salHex, 'hex'), esperado.length, { ...PARAMS, N: Number(n) });
    return crypto.timingSafeEqual(esperado, obtido);
}

// Senha mínima razoável sem frustrar quem cadastra no tablet do ginásio.
function senhaValida(senha) {
    return typeof senha === 'string' && senha.length >= 8 && senha.length <= 200;
}

function gerarToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}

// Tokens (e-mail, telas) ficam no banco só como hash: um vazamento do banco
// não entrega acesso.
function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function emailValido(email) {
    return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizarEmail(email) {
    return String(email || '').trim().toLowerCase();
}

// Só dígitos; aceita CPF (11) ou CNPJ (14). Validação dos dígitos verificadores
// incluída para não mandar documento inválido ao Asaas.
function documentoValido(doc) {
    const d = String(doc || '').replace(/\D/g, '');
    if (d.length === 11) return cpfValido(d);
    if (d.length === 14) return cnpjValido(d);
    return false;
}

function cpfValido(c) {
    if (/^(\d)\1+$/.test(c)) return false;
    const calc = (base) => {
        let soma = 0;
        for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i);
        const r = (soma * 10) % 11;
        return r === 10 ? 0 : r;
    };
    return calc(c.slice(0, 9)) === Number(c[9]) && calc(c.slice(0, 10)) === Number(c[10]);
}

function cnpjValido(c) {
    if (/^(\d)\1+$/.test(c)) return false;
    const calc = (base) => {
        const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
        const soma = base.split('').reduce((s, n, i) => s + Number(n) * pesos[i], 0);
        const r = soma % 11;
        return r < 2 ? 0 : 11 - r;
    };
    return calc(c.slice(0, 12)) === Number(c[12]) && calc(c.slice(0, 13)) === Number(c[13]);
}

// "Clube Atlético São José" -> "clube-atletico-sao-jose"
function gerarSlug(texto) {
    return String(texto || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'cliente';
}

// IP do visitante atrás do edge (Caddy): X-Real-IP / X-Forwarded-For já vêm
// com um único valor tratado (snippet `ip_real` da VPS).
function ipDoPedido(req) {
    const h = req.headers || {};
    return String(h['x-real-ip'] || (h['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '').trim();
}

// Limitador simples em memória (login, cadastro, recuperação de senha).
// Um processo só na VPS: não precisa de Redis.
function criarLimitador({ janelaMs, maximo }) {
    const mapa = new Map();
    return {
        permitir(chave, agora = Date.now()) {
            const reg = mapa.get(chave);
            if (!reg || agora - reg.inicio > janelaMs) {
                mapa.set(chave, { inicio: agora, n: 1 });
                return true;
            }
            reg.n += 1;
            if (mapa.size > 10000) mapa.clear(); // não deixa crescer sem fim
            return reg.n <= maximo;
        },
        limpar(chave) { mapa.delete(chave); }
    };
}

module.exports = {
    gerarHashSenha,
    conferirSenha,
    senhaValida,
    gerarToken,
    hashToken,
    emailValido,
    normalizarEmail,
    documentoValido,
    gerarSlug,
    ipDoPedido,
    criarLimitador
};
