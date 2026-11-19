// Acesso ao Postgres. Um pool por processo; quem precisa de transação usa
// `transacao(async (c) => ...)`, que devolve o cliente com o mesmo `query`.
//
// Isolamento entre clientes (tenancy): toda tabela de cliente tem
// `cliente_id`, e os repositórios em src/repos.js SEMPRE recebem o
// `clienteId` como primeiro argumento e o colocam no WHERE. Nenhuma rota faz
// SQL "solto" sobre tabela de cliente.
const { Pool, types } = require('pg');

// bigint (count(*), soma de tamanhos) vem como string por padrão no driver;
// os números do MarQGol cabem com folga em Number.
types.setTypeParser(20, (v) => Number(v));
// `date` como string 'YYYY-MM-DD' — sem converter para Date no fuso do
// servidor (que deslocaria o dia de vencimento).
types.setTypeParser(1082, (v) => v);

function criarDb(databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl, max: 10 });
    pool.on('error', (erro) => console.error('Erro no pool do Postgres:', erro.message));

    const db = {
        pool,
        query: (sql, params) => pool.query(sql, params),
        async um(sql, params) {
            const r = await pool.query(sql, params);
            return r.rows[0] || null;
        },
        async varios(sql, params) {
            return (await pool.query(sql, params)).rows;
        },
        async transacao(fn) {
            const c = await pool.connect();
            try {
                await c.query('BEGIN');
                const tx = {
                    query: (sql, params) => c.query(sql, params),
                    um: async (sql, params) => (await c.query(sql, params)).rows[0] || null,
                    varios: async (sql, params) => (await c.query(sql, params)).rows
                };
                const resultado = await fn(tx);
                await c.query('COMMIT');
                return resultado;
            } catch (erro) {
                await c.query('ROLLBACK').catch(() => {});
                throw erro;
            } finally {
                c.release();
            }
        },
        fechar: () => pool.end()
    };
    return db;
}

module.exports = { criarDb };
