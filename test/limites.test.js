const test = require('node:test');
const assert = require('node:assert/strict');
const lim = require('../src/limites');

const plano = { max_placares: 3, max_jogos_abertos: 10, max_usuarios: 5, max_armazenamento_mb: 1024,
    esportes: ['futsal', 'volei'], recursos: { arte_propria: true } };

test('limitesEfetivos usa o plano e os padrões de recursos', () => {
    const l = lim.limitesEfetivos(plano, {});
    assert.equal(l.max_placares, 3);
    assert.deepEqual(l.esportes, ['futsal', 'volei']);
    assert.equal(l.recursos.arte_propria, true);
    assert.equal(l.recursos.midia, true); // padrão
});

test('limites_extra sobrescreve campo a campo', () => {
    const l = lim.limitesEfetivos(plano, { max_placares: 7, recursos: { midia: false }, esportes: ['basquete'] });
    assert.equal(l.max_placares, 7);
    assert.equal(l.max_jogos_abertos, 10);
    assert.equal(l.recursos.midia, false);
    assert.deepEqual(l.esportes, ['basquete']);
});

test('extra vazio ou nulo não zera o limite do plano', () => {
    const l = lim.limitesEfetivos(plano, { max_placares: '', max_usuarios: null });
    assert.equal(l.max_placares, 3);
    assert.equal(l.max_usuarios, 5);
});

test('verificar bloqueia ao atingir o limite', () => {
    const l = lim.limitesEfetivos(plano);
    assert.equal(lim.verificar('max_jogos_abertos', 9, l).ok, true);
    const r = lim.verificar('max_jogos_abertos', 10, l);
    assert.equal(r.ok, false);
    assert.match(r.mensagem, /10 jogos em aberto/);
    assert.equal(lim.verificar('max_armazenamento_mb', 1000, l, 30).ok, false);
});

test('clienteOperante: suspenso e cancelado não operam', () => {
    for (const s of ['teste', 'ativo', 'inadimplente']) assert.equal(lim.clienteOperante({ status: s }), true);
    for (const s of ['suspenso', 'cancelado']) assert.equal(lim.clienteOperante({ status: s }), false);
});

test('fimDoTeste soma os dias', () => {
    const fim = lim.fimDoTeste(new Date('2026-01-01T12:00:00Z'), 14);
    assert.equal(fim.toISOString().slice(0, 10), '2026-01-15');
});

test('fimDoTeste aceita 0 dias (plano sem teste)', () => {
    const inicio = new Date('2026-01-01T12:00:00Z');
    assert.equal(lim.fimDoTeste(inicio, 0).toISOString(), inicio.toISOString());
    assert.equal(lim.fimDoTeste(inicio, undefined).toISOString().slice(0, 10), '2026-01-15');
});
