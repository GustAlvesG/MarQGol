// Executor de migrações mínimo: aplica, em ordem, os arquivos .sql de
// src/db/migrations que ainda não estão em `schema_migrations`. Cada arquivo
// roda numa transação. Sem "down": correção é uma migração nova.
//
// Uso: `node src/db/migrar.js` (serviço `migrate` do Compose de produção) ou
// `migrar(db)` (testes e dev).
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'migrations');

async function migrar(db, { log = () => {} } = {}) {
    // Uma conexão só do começo ao fim: a trava consultiva pertence à sessão,
    // e com o pool o unlock poderia cair noutra conexão.
    const c = await db.pool.connect();
    try {
        await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
            nome text PRIMARY KEY,
            aplicada_em timestamptz NOT NULL DEFAULT now()
        )`);
        // Dois processos subindo ao mesmo tempo não aplicam a mesma migração duas vezes.
        await c.query('SELECT pg_advisory_lock(424242)');
        try {
            const feitas = new Set((await c.query('SELECT nome FROM schema_migrations')).rows.map(r => r.nome));
            const arquivos = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
            for (const arquivo of arquivos) {
                if (feitas.has(arquivo)) continue;
                const sql = fs.readFileSync(path.join(DIR, arquivo), 'utf8');
                await c.query('BEGIN');
                try {
                    await c.query(sql);
                    await c.query('INSERT INTO schema_migrations (nome) VALUES ($1)', [arquivo]);
                    await c.query('COMMIT');
                } catch (erro) {
                    await c.query('ROLLBACK');
                    erro.message = `${arquivo}: ${erro.message}`;
                    throw erro;
                }
                log(`migração aplicada: ${arquivo}`);
            }
        } finally {
            await c.query('SELECT pg_advisory_unlock(424242)');
        }
    } finally {
        c.release();
    }
}

if (require.main === module) {
    const { config } = require('../config');
    const { criarDb } = require('./index');
    const db = criarDb(config().databaseUrl);
    migrar(db, { log: console.log })
        .then(async () => {
            const { garantirDadosIniciais } = require('../seed');
            await garantirDadosIniciais(db, config(), { log: console.log });
            await db.fechar();
            console.log('Banco atualizado.');
        })
        .catch(async (erro) => {
            console.error('Falha na migração:', erro);
            await db.fechar().catch(() => {});
            process.exit(1);
        });
}

module.exports = { migrar };
