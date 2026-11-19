// Postgres "de verdade" para dev e testes, sem Docker nem instalação: usa o
// pacote embedded-postgres (devDependency), que traz os binários oficiais.
// Em produção o banco é o container `db` do docker-compose.prod.yml.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

function carregarEmbedded() {
    try {
        return require('embedded-postgres').default;
    } catch {
        throw new Error('embedded-postgres não instalado (rode `npm install`). Ou defina DATABASE_URL apontando para um Postgres.');
    }
}

// pg_ctl do pacote da plataforma — usado para parar o servidor: o stop() do
// pacote às vezes não retorna no Windows.
function caminhoPgCtl() {
    const plataforma = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
    const exe = process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl';
    const c = path.join(__dirname, '..', 'node_modules', '@embedded-postgres', plataforma, 'native', 'bin', exe);
    return fs.existsSync(c) ? c : null;
}

async function iniciarPg({ dir, porta, persistente }) {
    const EmbeddedPostgres = carregarEmbedded();
    const jaExiste = fs.existsSync(path.join(dir, 'PG_VERSION'));
    const pg = new EmbeddedPostgres({
        databaseDir: dir,
        user: 'postgres',
        password: 'postgres',
        port: porta,
        persistent: persistente,
        // UTF-8 sempre: sem isso o cluster herda WIN1252 do Windows em pt-BR.
        initdbFlags: ['--encoding=UTF8', '--locale=C'],
        onLog: () => {},
        onError: () => {}
    });
    if (!jaExiste) await pg.initialise();
    await pg.start();
    return {
        pg,
        url: (db = 'postgres') => `postgres://postgres:postgres@127.0.0.1:${porta}/${db}`,
        async criarBanco(nome) {
            try { await pg.createDatabase(nome); } catch (e) { if (!/already exists/.test(e.message)) throw e; }
        },
        parar() {
            const pgCtl = caminhoPgCtl();
            if (pgCtl) {
                try { execFileSync(pgCtl, ['-D', dir, 'stop', '-m', 'fast', '-w', '-t', '20'], { stdio: 'ignore' }); } catch {}
            }
            if (!persistente) fs.rmSync(dir, { recursive: true, force: true });
        }
    };
}

module.exports = { iniciarPg };
