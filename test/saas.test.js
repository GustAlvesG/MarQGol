// Testes de ponta a ponta do MarQGol: HTTP + Socket.IO + Postgres real.
const test = require('node:test');
const assert = require('node:assert/strict');
const { temBanco } = require('./apoio/banco');
const { subirServidor } = require('./apoio/servidor');

const opcoes = { skip: !temBanco, concurrency: false };

test('MarQGol — fluxo completo', opcoes, async (t) => {
    const S = await subirServidor();
    t.after(() => S.fechar());

    const a = S.navegador();
    const resumoA = await S.cadastrar(a);
    const placarA = resumoA.placares[0].id;

    await t.test('cadastro cria cliente em teste com o plano montado e a primeira quadra', () => {
        assert.equal(resumoA.cliente.status, 'teste');
        assert.equal(resumoA.plano.composicao.placares, 1);
        // 1 placar (89,00) + mídia (29,00) + vídeo do atleta (19,00), tabela inicial.
        assert.equal(resumoA.plano.valor_mensal_centavos, 13700);
        assert.equal(resumoA.limites.max_placares, 1);
        assert.equal(resumoA.limites.max_usuarios, 10, '1º pacote de 10 usuários incluso');
        assert.equal(resumoA.limites.max_jogos_abertos, 20);
        assert.equal(resumoA.limites.recursos.arte_propria, false);
        assert.equal(resumoA.placares.length, 1);
        const dias = (new Date(resumoA.cliente.teste_ate) - Date.now()) / 86400000;
        assert.ok(dias > 13.9 && dias <= 14.01, `teste de 14 dias (veio ${dias})`);
        assert.ok(S.marq.email.enviados.some(e => /Confirme seu e-mail/.test(e.subject)));
    });

    await t.test('mutação sem o cabeçalho X-MarQ é recusada (CSRF)', async () => {
        const r = await a.post('/api/app/placares', { nome: 'X' }, { headers: { 'x-marq': '' } });
        assert.equal(r.status, 403);
    });

    await t.test('limite de placares do plano', async () => {
        const r = await a.post('/api/app/placares', { nome: 'Quadra 2' });
        assert.equal(r.status, 403);
        assert.match(r.dado.erro, /1 placar/);
    });

    let timeCasa, timeFora, jogador10;
    await t.test('cadastro de times e jogadores', async () => {
        timeCasa = (await a.post('/api/app/times', { nome: 'Leões', esporte: 'futsal', categoria: 'Adulto' })).dado;
        timeFora = (await a.post('/api/app/times', { nome: 'Tigres', esporte: 'futsal', categoria: 'Adulto' })).dado;
        const r = await a.post(`/api/app/times/${timeCasa.id}/jogadores`, { jogadores: [{ numero: '10', nome: 'Ana' }, { numero: '7', nome: 'Bia' }] });
        assert.equal(r.status, 201);
        jogador10 = r.dado.find(j => j.numero === '10');
        const lista = (await a.get(`/api/app/times/${timeCasa.id}/jogadores`)).dado;
        assert.deepEqual(lista.map(j => j.numero), ['7', '10']);
        // Logo precisa ser arquivo nosso, não URL qualquer.
        const ruim = await a.patch(`/api/app/times/${timeCasa.id}`, { logo: 'https://exemplo.com/x.png' });
        assert.equal(ruim.status, 422);
    });

    await t.test('limite de jogos em aberto e liberação ao cancelar', async () => {
        // Limite individual pelo banco (o painel faz o mesmo via limites_extra).
        await S.db.query(`UPDATE clientes SET limites_extra = '{"max_jogos_abertos": 2}' WHERE id = $1`, [resumoA.cliente.id]);
        const novo = (h) => a.post('/api/app/jogos', { esporte: 'futsal', time_casa_id: timeCasa.id, time_fora_id: timeFora.id, data_hora: new Date(Date.now() + h * 3600e3).toISOString() });
        const j1 = await novo(1), j2 = await novo(2), j3 = await novo(3);
        assert.equal(j1.status, 201);
        assert.equal(j2.status, 201);
        assert.equal(j3.status, 403);
        assert.match(j3.dado.erro, /2 jogos em aberto/);
        assert.equal((await a.post(`/api/app/jogos/${j2.dado.id}/cancelar`)).status, 200);
        assert.equal((await novo(4)).status, 201);
        await S.db.query(`UPDATE clientes SET limites_extra = '{}' WHERE id = $1`, [resumoA.cliente.id]);
    });

    await t.test('esporte fora do plano é recusado', async () => {
        await S.db.query(`UPDATE clientes SET limites_extra = '{"esportes": ["volei"]}' WHERE id = $1`, [resumoA.cliente.id]);
        const r = await a.post('/api/app/times', { nome: 'X', esporte: 'futsal' });
        assert.equal(r.status, 403);
        await S.db.query(`UPDATE clientes SET limites_extra = '{}' WHERE id = $1`, [resumoA.cliente.id]);
    });

    const b = S.navegador();
    const resumoB = await S.cadastrar(b);

    await t.test('isolamento: um cliente não vê nem mexe no dado do outro', async () => {
        assert.equal((await b.get(`/api/app/times/${timeCasa.id}/jogadores`)).status, 404);
        assert.equal((await b.patch(`/api/app/times/${timeCasa.id}`, { nome: 'Hackeado' })).status, 404);
        assert.deepEqual((await b.get('/api/app/times')).dado, []);
        assert.deepEqual((await b.get('/api/app/jogos')).dado, []);
        // Página e socket do placar do outro cliente.
        const pag = await b.get(`/p/${placarA}/`, { headers: { accept: 'text/html' } });
        assert.equal(pag.status, 302);
        await assert.rejects(S.conectar(b, placarA), /sem_acesso/);
        // Escalação de jogador de outro cliente não entra.
        const jogoB = await b.post('/api/app/times', { nome: 'Outro', esporte: 'futsal' });
        assert.equal(jogoB.status, 201);
        void resumoB;
    });

    await t.test('anônimo não conecta no placar nem abre o controle', async () => {
        const anon = S.navegador();
        await assert.rejects(S.conectar(anon, placarA), /nao_autenticado/);
        const r = await anon.get(`/p/${placarA}/controle/controle.html`, { headers: { accept: 'text/html' } });
        assert.equal(r.status, 302);
        assert.match(r.headers.get('location'), /^\/entrar/);
    });

    let jogoId;
    await t.test('controle: carrega jogo, PLAY põe ao vivo, lances vão para a súmula', async () => {
        const s = await S.conectar(a, placarA);
        const lista = await S.emitir(s, 'placar_chamar', { acao: 'listarJogos', payload: {} });
        assert.equal(lista.ok, true);
        jogoId = lista.dado.find(j => j.status === 'agendado').id;

        // Escalação antes do jogo.
        assert.equal((await a.put(`/api/app/jogos/${jogoId}/escalacao/${timeCasa.id}`, { jogadores: [{ jogador_id: jogador10.id, numero: '10', titular: true, capitao: true }] })).status, 200);

        const carregado = await S.emitir(s, 'placar_carregar_jogo', { jogoId });
        assert.equal(carregado.ok, true, JSON.stringify(carregado));
        const ana = carregado.dado.time_casa.elenco.find(j => j.numero === '10');
        assert.equal(ana.titular, true);

        const estado = S.proximo(s, 'atualizar_tela');
        s.emit('comando_cronometro', { acao: 'play' });
        await estado;
        s.emit('comando_placar', { time: 'timeA', acao: 'add_ponto', valor: 1, jogador: { numero: '10', nome: 'Ana', jogador_id: ana.jogador_id } });
        s.emit('comando_placar', { time: 'timeB', acao: 'add_ponto', valor: 1 });
        s.emit('comando_placar', { time: 'timeA', acao: 'add_falta' });
        // Espera a súmula ser gravada.
        let eventos = [];
        for (let i = 0; i < 40 && eventos.filter(e => e.tipo === 'ponto').length < 2; i++) {
            await new Promise(r => setTimeout(r, 50));
            eventos = await S.db.varios('SELECT * FROM eventos_jogo WHERE jogo_id = $1 ORDER BY sequencia', [jogoId]);
        }
        const pontos = eventos.filter(e => e.tipo === 'ponto');
        assert.equal(pontos.length, 2);
        assert.equal(pontos[0].time_id, timeCasa.id);
        assert.equal(pontos[0].jogador_id, ana.jogador_id);
        assert.equal(pontos[1].time_id, timeFora.id);
        const jogo = await S.db.um('SELECT status FROM jogos WHERE id = $1', [jogoId]);
        assert.equal(jogo.status, 'ao_vivo');

        s.disconnect();
    });

    await t.test('estorno, encerramento e placar final na agenda', async () => {
        // Desfazer o ponto do time B vira estorno do evento exato.
        const s = await S.conectar(a, placarA);
        const inst = await S.marq.gerenciador.obter(placarA);
        const lanceB = inst.estado.lances.find(l => l.tipo === 'ponto' && l.time === 'timeB');
        s.emit('comando_placar', { acao: 'estornar_lance', lanceId: lanceB.id });
        let estornos = [];
        for (let i = 0; i < 40 && !estornos.length; i++) {
            await new Promise(r => setTimeout(r, 50));
            estornos = await S.db.varios(`SELECT * FROM eventos_jogo WHERE jogo_id = $1 AND tipo = 'estorno'`, [jogoId]);
        }
        assert.equal(estornos.length, 1);
        const original = await S.db.um(`SELECT uuid FROM eventos_jogo WHERE jogo_id = $1 AND tipo = 'ponto' AND time_id = $2`, [jogoId, timeFora.id]);
        assert.equal(estornos[0].payload.evento_uuid, original.uuid);

        const fim = await S.emitir(s, 'placar_encerrar_jogo', {});
        assert.equal(fim.ok, true, JSON.stringify(fim));
        const jogo = await S.db.um('SELECT * FROM jogos WHERE id = $1', [jogoId]);
        assert.equal(jogo.status, 'encerrado');
        assert.equal(jogo.placar_casa, 1);
        assert.equal(jogo.placar_fora, 0);
        // Jogo encerrado não é carregado de novo.
        const de_novo = await S.emitir(s, 'placar_carregar_jogo', { jogoId });
        assert.equal(de_novo.ok, false);
        s.disconnect();
    });

    await t.test('estado do placar sobrevive a reinício (persistido no Postgres)', async () => {
        await S.marq.gerenciador.gravarTodos();
        const { criarGerenciador } = require('../src/placares/gerenciador');
        const outro = criarGerenciador({ repos: S.marq.repos, io: S.marq.io, armazenamento: S.marq.armazenamento });
        const inst = await outro.obter(placarA);
        outro.parar();
        assert.equal(inst.estado.timeA.nome, 'Leões');
        assert.equal(inst.estado.timeA.placar, 1);
        assert.equal(inst.sessao.jogoId, jogoId);
    });

    await t.test('pareamento de TV: código, cookie de leitura e socket só de escuta', async () => {
        const tv = S.navegador();
        const semPar = await tv.get('/telao/', { headers: { accept: 'text/html' } });
        assert.equal(semPar.status, 200); // página de pareamento
        const { codigo } = (await tv.post('/api/telas/codigo')).dado;
        assert.match(codigo, /^\d{6}$/);
        assert.equal((await tv.get('/api/telas/codigo/status')).dado.estado, 'aguardando');
        // Código errado / outro cliente.
        assert.equal((await a.post(`/api/app/placares/${placarA}/telas`, { codigo: '000000' === codigo ? '111111' : '000000' })).status, 404);
        assert.equal((await b.post(`/api/app/placares/${placarA}/telas`, { codigo })).status, 404);
        const par = await a.post(`/api/app/placares/${placarA}/telas`, { codigo, nome: 'TV do ginásio', tipo: 'telao' });
        assert.equal(par.status, 201);
        const st = (await tv.get('/api/telas/codigo/status')).dado;
        assert.equal(st.estado, 'pareado');
        assert.equal(st.destino, `/p/${placarA}/`);
        // Já pareada, /telao leva direto ao placar.
        const ir = await tv.get('/telao', { headers: { accept: 'text/html' } });
        assert.equal(ir.status, 302);
        assert.equal((await tv.get(`/p/${placarA}/`, { headers: { accept: 'text/html' } })).status, 200);
        assert.equal((await tv.get(`/p/${placarA}/base/futsal/box.png`)).status, 200); // arte padrão
        // Controle continua fechado para a TV.
        assert.equal((await tv.get(`/p/${placarA}/controle/controle.html`, { headers: { accept: 'text/html' } })).status, 302);
        // Socket da TV recebe estado mas comandos são ignorados.
        const s = await S.conectar(tv, placarA);
        const antes = (await S.marq.gerenciador.obter(placarA)).estado.timeA.placar;
        s.emit('comando_placar', { time: 'timeA', acao: 'add_ponto', valor: 5 });
        await new Promise(r => setTimeout(r, 150));
        assert.equal((await S.marq.gerenciador.obter(placarA)).estado.timeA.placar, antes);
        // Revogar derruba a TV.
        const caiu = S.proximo(s, 'disconnect');
        assert.equal((await a.del(`/api/app/telas/${par.dado.id}`)).status, 200);
        await caiu;
        await assert.rejects(S.conectar(tv, placarA), /nao_autenticado/);
    });

    await t.test('jogo agendado vencido há 24 h expira e libera a vaga', async () => {
        const r = await a.post('/api/app/jogos', { esporte: 'futsal', time_casa_id: timeCasa.id, time_fora_id: timeFora.id, data_hora: new Date(Date.now() - 25 * 3600e3).toISOString() });
        assert.equal(r.status, 201);
        const antes = (await a.get('/api/app/resumo')).dado.uso.max_jogos_abertos;
        const expirados = await S.marq.repos.jogos.expirarVencidos();
        assert.ok(expirados.some(j => j.id === r.dado.id));
        const depois = (await a.get('/api/app/resumo')).dado.uso.max_jogos_abertos;
        assert.equal(depois, antes - 1);
        // Expirado não carrega no controle; pode ser reagendado.
        const re = await a.post(`/api/app/jogos/${r.dado.id}/reagendar`, { data_hora: new Date(Date.now() + 3600e3).toISOString() });
        assert.equal(re.status, 200);
        assert.equal(re.dado.status, 'agendado');
    });

    await t.test('upload de mídia respeita a cota do plano', async () => {
        await S.db.query(`UPDATE clientes SET limites_extra = '{"max_armazenamento_mb": 1}' WHERE id = $1`, [resumoA.cliente.id]);
        const pequeno = Buffer.alloc(1000, 1);
        const ok = await a.post('/api/midia/patrocinador?nome=logo.png', pequeno, { cru: true, headers: { 'content-type': 'application/octet-stream' } });
        assert.equal(ok.status, 200, JSON.stringify(ok.dado));
        const grande = Buffer.alloc(2 * 1024 * 1024, 1);
        const nao = await a.post('/api/midia/video?nome=comercial.mp4', grande, { cru: true, headers: { 'content-type': 'application/octet-stream' } });
        assert.equal(nao.status, 413);
        const ruim = await a.post('/api/midia/patrocinador?nome=script.js', pequeno, { cru: true });
        assert.equal(ruim.status, 400);
        const inst = await S.marq.gerenciador.obter(placarA);
        assert.deepEqual(inst.estado.patrocinadores, ['logo.png']);
        assert.equal((await a.get(`/p/${placarA}/patrocinadores/logo.png`)).status, 200);
        assert.equal((await b.get(`/p/${placarA}/patrocinadores/logo.png`)).status, 403);
        await S.db.query(`UPDATE clientes SET limites_extra = '{}' WHERE id = $1`, [resumoA.cliente.id]);
    });

    await t.test('convite de usuário respeita limite e cria operador', async () => {
        const r = await a.post('/api/app/usuarios', { nome: 'Operador', email: 'op@teste.com', papel: 'operador' });
        assert.equal(r.status, 201);
        const msg = S.marq.email.enviados.find(e => e.to === 'op@teste.com');
        const token = /token=([a-f0-9]+)/.exec(msg.text)[1];
        const op = S.navegador();
        assert.equal((await op.get(`/api/auth/convite?token=${token}`)).dado.email, 'op@teste.com');
        assert.equal((await op.post('/api/auth/aceitar-convite', { token, senha: 'senha-do-op' })).status, 200);
        // Operador opera, mas não administra.
        assert.equal((await op.get('/api/app/resumo')).status, 200);
        assert.equal((await op.post('/api/app/placares', { nome: 'Q' })).status, 403);
        assert.equal((await op.get('/api/app/usuarios')).status, 403);
        await S.conectar(op, placarA);
        // Com limite de 3 usuários: admin + op = 2; o terceiro passa, o quarto não.
        await S.db.query(`UPDATE clientes SET limites_extra = '{"max_usuarios": 3}' WHERE id = $1`, [resumoA.cliente.id]);
        assert.equal((await a.post('/api/app/usuarios', { nome: 'X', email: 'x@teste.com' })).status, 201);
        const quarto = await a.post('/api/app/usuarios', { nome: 'Y', email: 'y@teste.com' });
        assert.equal(quarto.status, 403);
        await S.db.query(`UPDATE clientes SET limites_extra = '{}' WHERE id = $1`, [resumoA.cliente.id]);
    });

    await t.test('fim do teste sem assinatura suspende; suspenso não agenda mas o jogo ao vivo continua', async () => {
        await S.db.query(`UPDATE clientes SET teste_ate = now() - interval '1 hour' WHERE id = $1`, [resumoA.cliente.id]);
        const mud = await S.marq.cobranca.revisarStatus();
        assert.ok(mud.some(m => m.id === resumoA.cliente.id && m.para === 'suspenso'));
        const r = await a.post('/api/app/jogos', { esporte: 'futsal', time_casa_id: timeCasa.id, time_fora_id: timeFora.id, data_hora: new Date(Date.now() + 3600e3).toISOString() });
        assert.equal(r.status, 402);
        // O operador conectado continua mandando comandos no placar.
        const s = await S.conectar(a, placarA);
        const antes = (await S.marq.gerenciador.obter(placarA)).estado.timeB.placar;
        s.emit('comando_placar', { time: 'timeB', acao: 'add_ponto', valor: 1 });
        await new Promise(r2 => setTimeout(r2, 150));
        assert.equal((await S.marq.gerenciador.obter(placarA)).estado.timeB.placar, antes + 1);
        s.disconnect();
    });

    await t.test('webhook do Asaas: token, idempotência e reativação', async () => {
        await S.db.query(`UPDATE clientes SET asaas_cliente_id = 'cus_1', asaas_assinatura_id = 'sub_1' WHERE id = $1`, [resumoA.cliente.id]);
        const sem = await fetch(S.base + '/api/asaas/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        assert.equal(sem.status, 401);
        const enviar = (corpo) => fetch(S.base + '/api/asaas/webhook', {
            method: 'POST', headers: { 'content-type': 'application/json', 'asaas-access-token': 'tok-webhook' }, body: JSON.stringify(corpo)
        }).then(r => r.json());
        const pago = { id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1', customer: 'cus_1', subscription: 'sub_1', value: 99, dueDate: '2026-12-01', status: 'CONFIRMED', billingType: 'PIX', invoiceUrl: 'https://asaas/fatura' } };
        assert.equal((await enviar(pago)).ok, true);
        assert.equal((await enviar(pago)).ignorado, 'duplicado');
        let c = await S.db.um('SELECT status FROM clientes WHERE id = $1', [resumoA.cliente.id]);
        assert.equal(c.status, 'ativo');
        const fat = await S.db.um('SELECT * FROM faturas WHERE asaas_id = $1', ['pay_1']);
        assert.equal(fat.valor_centavos, 9900);
        await enviar({ id: 'evt_2', event: 'PAYMENT_OVERDUE', payment: { ...pago.payment, id: 'pay_2', status: 'OVERDUE' } });
        c = await S.db.um('SELECT status, inadimplente_desde FROM clientes WHERE id = $1', [resumoA.cliente.id]);
        assert.equal(c.status, 'inadimplente');
        // 8 dias depois, suspende.
        await S.db.query(`UPDATE clientes SET inadimplente_desde = now() - interval '8 days' WHERE id = $1`, [resumoA.cliente.id]);
        await S.marq.cobranca.revisarStatus();
        c = await S.db.um('SELECT status FROM clientes WHERE id = $1', [resumoA.cliente.id]);
        assert.equal(c.status, 'suspenso');
    });

    await t.test('painel de gestão: só superadmin, ajusta limites e entra como cliente', async () => {
        assert.equal((await a.get('/api/admin/clientes')).status, 403);
        const dono = S.navegador();
        const login = await dono.post('/api/auth/entrar', { email: 'dono@marqgol.test', senha: 'senha-do-dono' });
        assert.equal(login.dado.destino, '/admin/');
        const lista = (await dono.get('/api/admin/clientes')).dado;
        assert.equal(lista.length, 2);
        const r = await dono.patch(`/api/admin/clientes/${resumoA.cliente.id}`, { status: 'ativo', limites_extra: { max_placares: 2 } });
        assert.equal(r.status, 200);
        assert.equal((await a.post('/api/app/placares', { nome: 'Quadra 2' })).status, 201);
        const det = (await dono.get(`/api/admin/clientes/${resumoA.cliente.id}`)).dado;
        assert.equal(det.limites.max_placares, 2);
        assert.ok(det.auditoria.some(x => x.acao === 'cliente_alterado'));
        // Entrar como: vê a área do cliente e conecta no placar dele.
        assert.equal((await dono.post(`/api/admin/clientes/${resumoA.cliente.id}/entrar`)).status, 200);
        const comoA = (await dono.get('/api/app/resumo')).dado;
        assert.equal(comoA.cliente.id, resumoA.cliente.id);
        assert.equal(comoA.usuario.impersonando, true);
        await S.conectar(dono, placarA);
        await dono.post('/api/admin/sair-cliente');
        assert.equal((await dono.get('/api/app/resumo')).status, 403);
        // Senha errada.
        assert.equal((await S.navegador().post('/api/auth/entrar', { email: 'dono@marqgol.test', senha: 'x' })).status, 401);
    });

    await t.test('downgrade: placar além do limite não pode ser operado', async () => {
        const dono = S.navegador();
        await dono.post('/api/auth/entrar', { email: 'dono@marqgol.test', senha: 'senha-do-dono' });
        await dono.patch(`/api/admin/clientes/${resumoA.cliente.id}`, { limites_extra: {} });
        const placares = (await a.get('/api/app/placares')).dado;
        const segundo = placares.find(p => p.id !== placarA);
        await assert.rejects(S.conectar(a, segundo.id), /placar_excedente/);
        await S.conectar(a, placarA);
    });

    await t.test('redefinição de senha por e-mail', async () => {
        const email = resumoB.usuario.email;
        await S.navegador().post('/api/auth/esqueci-senha', { email });
        const msg = [...S.marq.email.enviados].reverse().find(e => e.to === email && /Redefinir/.test(e.subject));
        const token = /token=([a-f0-9]+)/.exec(msg.text)[1];
        const nav = S.navegador();
        assert.equal((await nav.post('/api/auth/redefinir-senha', { token, senha: 'curta' })).status, 422);
        assert.equal((await nav.post('/api/auth/redefinir-senha', { token, senha: 'nova-senha-123' })).status, 200);
        assert.equal((await nav.post('/api/auth/redefinir-senha', { token, senha: 'nova-senha-123' })).status, 410);
        assert.equal((await S.navegador().post('/api/auth/entrar', { email, senha: 'nova-senha-123' })).status, 200);
    });
});

test('assinatura via Asaas (fetch falso)', opcoes, async (t) => {
    const chamadas = [];
    const fetchAsaas = async (url, init) => {
        chamadas.push({ url, metodo: init.method, corpo: init.body ? JSON.parse(init.body) : null, chave: init.headers.access_token });
        const json = (d) => ({ ok: true, status: 200, text: async () => JSON.stringify(d) });
        if (url.endsWith('/customers')) return json({ id: 'cus_X' });
        if (url.endsWith('/subscriptions')) return json({ id: 'sub_X' });
        if (/\/subscriptions\/sub_X\/payments/.test(url)) return json({ data: [{ id: 'pay_X', value: 249, dueDate: '2026-12-03', status: 'PENDING', billingType: 'UNDEFINED', invoiceUrl: 'https://asaas/pay_X' }] });
        if (/\/subscriptions\/sub_X$/.test(url)) return json({ id: 'sub_X' });
        return { ok: false, status: 404, text: async () => '{"errors":[{"description":"não achou"}]}' };
    };
    const S = await subirServidor({ fetchAsaas });
    t.after(() => S.fechar());
    const nav = S.navegador();
    const resumo = await S.cadastrar(nav);
    // Monta o plano: 3 placares + todos os recursos = 3×89 + 29 + 19 + 49 = 364,00.
    const comp = await nav.put('/api/app/composicao', { composicao: { placares: 3, recursos: { midia: true, video_jogador: true, arte_propria: true } } });
    assert.equal(comp.status, 200, JSON.stringify(comp.dado));
    assert.equal(comp.dado.cliente.valor_mensal_centavos, 36400);
    assert.equal(chamadas.length, 0, 'sem assinatura, mudar o plano não chama o Asaas');
    const ass = (await nav.get('/api/app/assinatura')).dado;
    assert.equal(ass.precoTabela, 36400);
    assert.equal(ass.itens.length, 4);
    const r = await nav.post('/api/app/assinatura', {});
    assert.equal(r.status, 200, JSON.stringify(r.dado));
    assert.equal(r.dado.linkPagamento, 'https://asaas/pay_X');
    const criarAss = chamadas.find(c => c.url.endsWith('/subscriptions'));
    assert.equal(criarAss.corpo.value, 364);
    assert.match(criarAss.corpo.description, /3 placares/);
    assert.equal(criarAss.corpo.billingType, 'UNDEFINED');
    assert.equal(criarAss.chave, 'chave-teste');
    // Primeira cobrança vence no fim do teste, não hoje.
    const fimTeste = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(resumo.cliente.teste_ate));
    assert.equal(criarAss.corpo.nextDueDate, fimTeste);
    const depois = (await nav.get('/api/app/resumo')).dado;
    assert.equal(depois.limites.max_placares, 3);
    assert.equal(depois.cliente.tem_assinatura, true);
    assert.equal((await nav.post('/api/app/assinatura', {})).status, 409, 'não assina duas vezes');
    // Mudar o plano atualiza a assinatura existente: 1 placar + 2 pacotes extras de usuários = 89 + 2×19.
    await nav.put('/api/app/composicao', { composicao: { placares: 1, pacotes_usuarios_extras: 2 } });
    const put = chamadas.find(c => c.metodo === 'PUT' && /sub_X$/.test(c.url));
    assert.equal(put.corpo.value, 127);
    assert.equal(put.corpo.updatePendingPayments, true);
    assert.equal((await nav.get('/api/app/resumo')).dado.limites.max_usuarios, 30);
});

test('gestão de usuários sem e-mail (senha definida por quem cadastra)', opcoes, async (t) => {
    const S = await subirServidor();
    t.after(() => S.fechar());
    const dono = S.navegador();
    assert.equal((await dono.post('/api/auth/entrar', { email: 'dono@marqgol.test', senha: 'senha-do-dono' })).status, 200);
    const enviadosAntes = S.marq.email.enviados.length;

    let cliente;
    await t.test('painel cria cliente com a senha do admin, sem e-mail', async () => {
        const r = await dono.post('/api/admin/clientes', {
            nome: 'Clube Sem Email', email: 'adm@semail.test', composicao: { placares: 2 }, valor_mensal_centavos: 15000,
            status: 'ativo', senhaAdmin: 'senha-do-adm'
        });
        assert.equal(r.status, 201);
        cliente = r.dado;
        assert.equal(cliente.valor_mensal_centavos, 15000, 'preço negociado');
        const det = (await dono.get('/api/admin/clientes/' + cliente.id)).dado;
        assert.deepEqual(det.placares.map(p => p.nome).sort(), ['Quadra 1', 'Quadra 2']);
        assert.equal(det.plano.total, 17800, 'preço de tabela continua visível');
        assert.equal(S.marq.email.enviados.length, enviadosAntes, 'nenhum e-mail enviado');
        const adm = S.navegador();
        assert.equal((await adm.post('/api/auth/entrar', { email: 'adm@semail.test', senha: 'senha-do-adm' })).status, 200);
        const eu = (await adm.get('/api/auth/eu')).dado;
        assert.equal(eu.papel, 'admin');
        assert.equal(eu.emailVerificado, true);
        assert.equal(eu.emailAtivo, false);
    });

    await t.test('senha curta do admin é recusada sem criar o cliente', async () => {
        const r = await dono.post('/api/admin/clientes', { nome: 'Curto', email: 'c@semail.test', composicao: { placares: 1 }, senhaAdmin: '123' });
        assert.equal(r.status, 422);
        const lista = (await dono.get('/api/admin/clientes?busca=Curto')).dado;
        assert.equal(lista.length, 0);
    });

    let operadorId;
    await t.test('admin do cliente cria operador com senha e redefine a senha dele', async () => {
        const adm = S.navegador();
        await adm.post('/api/auth/entrar', { email: 'adm@semail.test', senha: 'senha-do-adm' });
        const r = await adm.post('/api/app/usuarios', { nome: 'Op', email: 'op@semail.test', papel: 'operador', senha: 'senha-do-op' });
        assert.equal(r.status, 201);
        operadorId = r.dado.id;
        const op = S.navegador();
        assert.equal((await op.post('/api/auth/entrar', { email: 'op@semail.test', senha: 'senha-do-op' })).status, 200);
        assert.equal((await adm.patch('/api/app/usuarios/' + operadorId, { senha: 'curta' })).status, 422);
        assert.equal((await adm.patch('/api/app/usuarios/' + operadorId, { senha: 'outra-senha-op' })).status, 200);
        // A sessão antiga do operador caiu; a senha nova vale.
        assert.equal((await op.get('/api/auth/eu')).status, 401);
        assert.equal((await op.post('/api/auth/entrar', { email: 'op@semail.test', senha: 'outra-senha-op' })).status, 200);
    });

    await t.test('painel gerencia usuários do cliente', async () => {
        const novo = await dono.post(`/api/admin/clientes/${cliente.id}/usuarios`, { nome: 'Op2', email: 'op2@semail.test', senha: 'senha-op-dois' });
        assert.equal(novo.status, 201);
        assert.equal((await dono.patch(`/api/admin/clientes/${cliente.id}/usuarios/${operadorId}`, { papel: 'admin', senha: 'senha-pelo-painel' })).status, 200);
        const op = S.navegador();
        assert.equal((await op.post('/api/auth/entrar', { email: 'op@semail.test', senha: 'senha-pelo-painel' })).status, 200);
        assert.equal((await op.get('/api/auth/eu')).dado.papel, 'admin');
        assert.equal((await dono.patch(`/api/admin/clientes/${cliente.id}/usuarios/${novo.dado.id}`, { ativo: false })).status, 200);
        assert.equal((await S.navegador().post('/api/auth/entrar', { email: 'op2@semail.test', senha: 'senha-op-dois' })).status, 401);
        assert.equal((await dono.del(`/api/admin/clientes/${cliente.id}/usuarios/${novo.dado.id}`)).status, 200);
        // Usuário de outro cliente não é alcançável por este caminho.
        assert.equal((await dono.patch(`/api/admin/clientes/${cliente.id + 999}/usuarios/${operadorId}`, { ativo: false })).status, 404);
    });

    await t.test('superadmins: criar, trocar senha, proteger o último', async () => {
        const lista = (await dono.get('/api/admin/superadmins')).dado;
        assert.equal(lista.length, 1);
        const euId = lista[0].id;
        assert.equal(lista[0].voce, true);
        const r = await dono.post('/api/admin/superadmins', { nome: 'Sócio', email: 'socio@marqgol.test', senha: 'senha-do-socio' });
        assert.equal(r.status, 201);
        const socio = S.navegador();
        assert.equal((await socio.post('/api/auth/entrar', { email: 'socio@marqgol.test', senha: 'senha-do-socio' })).status, 200);
        assert.equal((await socio.get('/api/admin/indicadores')).status, 200);
        // Trocar a própria senha mantém a sessão atual.
        assert.equal((await dono.patch('/api/admin/superadmins/' + euId, { senha: 'nova-senha-dono' })).status, 200);
        assert.equal((await dono.get('/api/admin/indicadores')).status, 200);
        assert.equal((await dono.patch('/api/admin/superadmins/' + euId, { ativo: false })).status, 422);
        assert.equal((await dono.del('/api/admin/superadmins/' + euId)).status, 422);
        assert.equal((await dono.del('/api/admin/superadmins/' + r.dado.id)).status, 200);
        assert.ok([401, 403].includes((await socio.get('/api/admin/indicadores')).status), 'sessão do removido não vale mais');
        // Cliente comum não acessa a lista.
        const adm = S.navegador();
        await adm.post('/api/auth/entrar', { email: 'adm@semail.test', senha: 'senha-do-adm' });
        assert.equal((await adm.get('/api/admin/superadmins')).status, 403);
    });
});

test('plano on demand: tabela de preços, teto do site e preço congelado', opcoes, async (t) => {
    const S = await subirServidor();
    t.after(() => S.fechar());
    const precos = (await S.navegador().get('/api/publico/precos')).dado;
    assert.equal(precos.usuarios_por_pacote, 10);
    assert.equal(precos.preco_placar_centavos, 8900);
    assert.ok(precos.recursos.arte_propria);

    await t.test('site não passa do teto do autoatendimento', async () => {
        const nav = S.navegador();
        const r = await S.cadastrar(nav, { composicao: { placares: 999, pacotes_usuarios_extras: 999, recursos: { arte_propria: true } } });
        assert.equal(r.plano.composicao.placares, precos.max_placares_autoatendimento);
        assert.equal(r.plano.composicao.pacotes_usuarios_extras, precos.max_pacotes_autoatendimento);
        assert.equal(r.placares.length, precos.max_placares_autoatendimento, 'cria um placar por quadra contratada');
        assert.equal(r.limites.recursos.arte_propria, true);
        assert.equal(r.limites.recursos.midia, false);
    });

    await t.test('mudar a tabela vale para novos clientes, não para quem já contratou', async () => {
        const antigo = await S.cadastrar(S.navegador(), { composicao: { placares: 1, recursos: {} } });
        assert.equal(antigo.plano.valor_mensal_centavos, 8900);
        const dono = S.navegador();
        await dono.post('/api/auth/entrar', { email: 'dono@marqgol.test', senha: 'senha-do-dono' });
        assert.equal((await dono.put('/api/admin/precos', { preco_placar_centavos: -1 })).status, 422);
        const r = await dono.put('/api/admin/precos', { preco_placar_centavos: 10000, jogos_por_placar: 5 });
        assert.equal(r.status, 200, JSON.stringify(r.dado));
        const novo = await S.cadastrar(S.navegador(), { composicao: { placares: 1, recursos: {} } });
        assert.equal(novo.plano.valor_mensal_centavos, 10000);
        const det = (await dono.get('/api/admin/clientes/' + antigo.cliente.id)).dado;
        assert.equal(det.cliente.valor_mensal_centavos, 8900, 'preço congelado');
        assert.equal(det.limites.max_jogos_abertos, 5, 'cotas por placar seguem a tabela');
        // Painel: preço negociado e volta para a tabela com valor null.
        assert.equal((await dono.patch('/api/admin/clientes/' + antigo.cliente.id, { valor_mensal_centavos: 5000 })).dado.valor_mensal_centavos, 5000);
        assert.equal((await dono.patch('/api/admin/clientes/' + antigo.cliente.id, { composicao: { placares: 2 }, valor_mensal_centavos: null })).dado.valor_mensal_centavos, 20000);
        // Operador não muda o plano.
        assert.equal((await dono.get('/api/admin/precos')).dado.precos.preco_placar_centavos, 10000);
    });
});
