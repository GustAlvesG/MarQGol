// Banco próprio para cada arquivo de teste: cria `t_<aleatório>` no Postgres
// de TEST_DATABASE_URL, aplica as migrações e devolve o `db`. Sem
// TEST_DATABASE_URL (ex.: `node --test` puro), os testes de banco são pulados.
const crypto = require('crypto');
const { Client } = require('pg');
const { criarDb } = require('../../src/db');
const { migrar } = require('../../src/db/migrar');

const URL_BASE = process.env.TEST_DATABASE_URL || '';
const temBanco = !!URL_BASE;

async function criarBancoDeTeste({ semMigrar = false } = {}) {
    const nome = 't_' + crypto.randomBytes(6).toString('hex');
    const admin = new Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${nome}`);
    await admin.end();
    const url = new URL(URL_BASE);
    url.pathname = '/' + nome;
    const db = criarDb(url.toString());
    if (!semMigrar) await migrar(db);
    db.url = url.toString();
    const fecharOriginal = db.fechar;
    db.fechar = async () => {
        await fecharOriginal();
        const a = new Client({ connectionString: URL_BASE });
        await a.connect();
        await a.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`).catch(() => {});
        await a.end();
    };
    return db;
}

module.exports = { temBanco, criarBancoDeTeste };
