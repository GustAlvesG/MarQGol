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
        const { n } = await db.um('SELECT count(*) AS n FROM planos');
        assert.equal(n, 3);
        const admins = await db.varios(`SELECT email, papel, cliente_id FROM usuarios`);
        assert.deepEqual(admins, [{ email: 'dono@exemplo.com', papel: 'superadmin', cliente_id: null }]);
    } finally {
        await db.fechar();
    }
});
