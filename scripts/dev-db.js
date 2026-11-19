// `npm run db`: Postgres de desenvolvimento persistente em .pgdata/ (porta
// 5433), sem Docker. Deixe rodando num terminal; no .env use
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/marqgol
// Ctrl+C para parar.
const path = require('path');
const { iniciarPg } = require('./pg-embutido');

const PORTA = Number(process.env.DEV_DB_PORT) || 5433;

async function main() {
    const pg = await iniciarPg({ dir: path.join(__dirname, '..', '.pgdata'), porta: PORTA, persistente: true });
    await pg.criarBanco('marqgol');
    console.log(`Postgres de dev no ar: ${pg.url('marqgol')}`);
    const sair = () => { console.log('\nParando o Postgres…'); pg.parar(); process.exit(0); };
    process.on('SIGINT', sair);
    process.on('SIGTERM', sair);
    setInterval(() => {}, 1 << 30);
}

main().catch((e) => { console.error(e); process.exit(1); });
