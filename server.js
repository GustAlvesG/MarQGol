// Ponto de entrada do MarQGol. Toda a montagem está em src/app.js; aqui só
// banco, migrações (em dev), porta e desligamento limpo.
const { config } = require('./src/config');
const { criarDb } = require('./src/db');
const { migrar } = require('./src/db/migrar');
const { garantirDadosIniciais } = require('./src/seed');
const { criarApp } = require('./src/app');
const { iniciarTarefas } = require('./src/tarefas');

async function main() {
    const cfg = config();
    if (!cfg.databaseUrl) {
        console.error('DATABASE_URL não definida. Em dev: `npm run db` num terminal e DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/marqgol no .env.');
        process.exit(1);
    }
    const db = criarDb(cfg.databaseUrl);
    // Em produção quem migra é o serviço `migrate` (pos_subida do deploy);
    // em dev, migra sozinho para não esquecer.
    if (!cfg.producao) {
        await migrar(db, { log: console.log });
        await garantirDadosIniciais(db, cfg, { log: console.log });
    }
    const marq = criarApp({ db, cfg });
    const tarefas = iniciarTarefas({ repos: marq.repos, cobranca: marq.cobranca });

    marq.server.listen(cfg.porta, '0.0.0.0', () => {
        console.log(`MarQGol no ar na porta ${cfg.porta} (${cfg.urlPublica})`);
    });

    let saindo = false;
    async function sair(sinal) {
        if (saindo) return;
        saindo = true;
        console.log(`${sinal} recebido: gravando placares e saindo…`);
        tarefas.parar();
        await marq.encerrar().catch(e => console.error(e));
        marq.server.close();
        await db.fechar().catch(() => {});
        process.exit(0);
    }
    process.on('SIGTERM', () => sair('SIGTERM'));
    process.on('SIGINT', () => sair('SIGINT'));
}

main().catch((e) => {
    console.error('Falha ao iniciar:', e);
    process.exit(1);
});
