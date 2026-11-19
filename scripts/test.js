// `npm test`: sobe um Postgres descartável (embedded-postgres), exporta
// TEST_DATABASE_URL e roda `node --test`. Cada arquivo de teste que usa banco
// cria o próprio database (test/apoio/banco.js), então rodam em paralelo sem
// se atrapalhar. Com TEST_DATABASE_URL já definida (CI, Docker), usa ela.
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { iniciarPg } = require('./pg-embutido');

async function main() {
    const extras = process.argv.slice(2);
    let pg = null;
    const env = { ...process.env };
    if (!env.TEST_DATABASE_URL) {
        const porta = 55000 + Math.floor(Math.random() * 1000);
        const dir = path.join(os.tmpdir(), `marqgol-test-pg-${process.pid}`);
        pg = await iniciarPg({ dir, porta, persistente: false });
        env.TEST_DATABASE_URL = pg.url('postgres');
    }
    const args = ['--test', ...(extras.length ? extras : ['test/**/*.test.js'])];
    const filho = spawn(process.execPath, args, { stdio: 'inherit', env, cwd: path.join(__dirname, '..') });
    const codigo = await new Promise(r => filho.on('exit', (c) => r(c ?? 1)));
    if (pg) pg.parar();
    process.exit(codigo);
}

main().catch((e) => { console.error(e); process.exit(1); });
