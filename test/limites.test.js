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

const tabela = {
    preco_placar_centavos: 8900, preco_pacote_usuarios_centavos: 1900, usuarios_por_pacote: 10,
    precos_recursos: { midia: 2900, video_jogador: 1900, arte_propria: 4900 },
    jogos_por_placar: 20, armazenamento_mb_por_placar: 2048, dias_teste: 14,
    max_placares_autoatendimento: 20, max_pacotes_autoatendimento: 10
};

test('composição on demand: limites crescem por placar e o 1º pacote de usuários é incluso', () => {
    const l = lim.limitesDaComposicao({ placares: 3, pacotes_usuarios_extras: 1, recursos: { arte_propria: true } }, tabela);
    assert.equal(l.max_placares, 3);
    assert.equal(l.max_jogos_abertos, 60);
    assert.equal(l.max_armazenamento_mb, 6144);
    assert.equal(l.max_usuarios, 20);
    assert.deepEqual(l.recursos, { midia: false, video_jogador: false, arte_propria: true });
});

test('composição on demand: preço detalhado', () => {
    const p = lim.precoDaComposicao({ placares: 2, pacotes_usuarios_extras: 2, recursos: { midia: true } }, tabela);
    assert.equal(p.total, 2 * 8900 + 2 * 1900 + 2900);
    assert.deepEqual(p.itens.map(i => i.chave), ['placares', 'usuarios', 'midia']);
});

test('composição on demand: entrada inválida vira o mínimo, teto só no autoatendimento', () => {
    assert.deepEqual(lim.normalizarComposicao({ placares: 'x', pacotes_usuarios_extras: -3 }, tabela),
        { placares: 1, pacotes_usuarios_extras: 0, recursos: { midia: false, video_jogador: false, arte_propria: false } });
    assert.equal(lim.normalizarComposicao({ placares: 50 }, tabela).placares, 20);
    assert.equal(lim.normalizarComposicao({ placares: 50 }, tabela, { teto: false }).placares, 50);
    assert.equal(lim.resumoDaComposicao({ placares: 2, pacotes_usuarios_extras: 1, recursos: { midia: true } }, tabela), '2 placares · 20 usuários · mídia');
});
