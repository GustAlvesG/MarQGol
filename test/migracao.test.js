const test = require('node:test');
const assert = require('node:assert/strict');
const { temBanco, criarBancoDeTeste } = require('./apoio/banco');
const { migrar } = require('../src/db/migrar');
const { garantirDadosIniciais } = require('../src/seed');

test('migrações e dados iniciais são idempotentes', { skip: !temBanco }, async () => {
    const db = await criarBancoDeTeste();
    try {
        await migrar(db); // segunda vez: nada a fazer
        const cfg = { superadmin: { email: 'Dono@Exemplo.com', senha: 'senha-forte-1', nome: 'Dono' } };
        await garantirDadosIniciais(db, cfg);
        await garantirDadosIniciais(db, cfg);
        const { n } = await db.um('SELECT count(*) AS n FROM tabela_precos');
        assert.equal(n, 1);
        const admins = await db.varios(`SELECT email, papel, cliente_id FROM usuarios`);
        assert.deepEqual(admins, [{ email: 'dono@exemplo.com', papel: 'superadmin', cliente_id: null }]);
    } finally {
        await db.fechar();
    }
});

test('migração 002 converte clientes de planos fixos em composição on demand', { skip: !temBanco }, async () => {
    const fs = require('fs');
    const path = require('path');
    const db = await criarBancoDeTeste({ semMigrar: true });
    try {
        // Estado antigo: só a 001, com um plano fixo e um cliente nele.
        const dir = path.join(__dirname, '..', 'src', 'db', 'migrations');
        await db.query(fs.readFileSync(path.join(dir, '001_inicial.sql'), 'utf8'));
        await db.query(`CREATE TABLE schema_migrations (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())`);
        await db.query(`INSERT INTO schema_migrations (nome) VALUES ('001_inicial.sql')`);
        const { id: planoId } = await db.um(
            `INSERT INTO planos (nome, preco_centavos, max_placares, max_jogos_abertos, max_usuarios, max_armazenamento_mb, recursos)
             VALUES ('Profissional', 24900, 3, 60, 12, 10240, '{"midia": true, "video_jogador": false, "arte_propria": true}') RETURNING id`);
        const { id } = await db.um(
            `INSERT INTO clientes (nome, slug, email, plano_id, limites_extra) VALUES ('C', 'c', 'c@x', $1, '{"max_placares": 5}') RETURNING id`, [planoId]);
        await migrar(db);
        const c = await db.um('SELECT composicao, valor_mensal_centavos, limites_extra FROM clientes WHERE id = $1', [id]);
        assert.deepEqual(c.composicao, { placares: 3, pacotes_usuarios_extras: 1, recursos: { midia: true, video_jogador: false, arte_propria: true } });
        assert.equal(c.valor_mensal_centavos, 24900, 'mantém o preço que pagava');
        assert.equal(c.limites_extra.max_placares, 5, 'ajuste individual preservado');
        assert.equal(c.limites_extra.max_jogos_abertos, 60);
        const { n } = await db.um(`SELECT count(*) AS n FROM information_schema.tables WHERE table_name = 'planos'`);
        assert.equal(n, 0);
    } finally {
        await db.fechar();
    }
});
