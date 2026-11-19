const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../src/seguranca');

test('hash de senha confere e rejeita senha errada', async () => {
    const h = await s.gerarHashSenha('segredo123');
    assert.match(h, /^scrypt\$/);
    assert.equal(await s.conferirSenha('segredo123', h), true);
    assert.equal(await s.conferirSenha('outra', h), false);
    assert.equal(await s.conferirSenha('x', null), false);
});

test('documentos: CPF e CNPJ válidos e inválidos', () => {
    assert.equal(s.documentoValido('529.982.247-25'), true);
    assert.equal(s.documentoValido('111.111.111-11'), false);
    assert.equal(s.documentoValido('11.222.333/0001-81'), true);
    assert.equal(s.documentoValido('11.222.333/0001-82'), false);
    assert.equal(s.documentoValido('123'), false);
});

test('slug sem acentos e limitado', () => {
    assert.equal(s.gerarSlug('Clube Atlético São José!'), 'clube-atletico-sao-jose');
    assert.equal(s.gerarSlug('***'), 'cliente');
});

test('limitador bloqueia depois do máximo e reabre na janela seguinte', () => {
    const l = s.criarLimitador({ janelaMs: 1000, maximo: 2 });
    assert.equal(l.permitir('ip', 0), true);
    assert.equal(l.permitir('ip', 10), true);
    assert.equal(l.permitir('ip', 20), false);
    assert.equal(l.permitir('ip', 2000), true);
});
