// Gerenciador de placares: substitui o `gameState` global único do sistema
// antigo. Cada placar (quadra) tem seu estado de jogo, sua sala no Socket.IO
// (`placar:<id>`) e seu bookkeeping de súmula. O estado é gravado no
// Postgres (agrupado a cada ~1 s) e recarregado sob demanda — reiniciar o
// servidor não perde mais o placar nem os eventos ainda não gravados.
//
// A regra de jogo continua toda em gameLogic.js; aqui é só transporte.
const logic = require('../../gameLogic');
const placarEventos = require('../../placarEventos');
const path = require('path');

const ATRASO_GRAVACAO_MS = 1000;

function sessaoVazia() {
    return {
        jogoId: null,
        timeAId: null,
        timeBId: null,
        fila: placarEventos.criarEstadoFila(0),
        iniciado: false,
        uuidPorLance: {},
        statusConexao: 'ocioso',
        ultimoErro: null
    };
}

// O que vai para o banco: a fila inteira (inclusive pendentes) — é o que
// garante que um evento não gravado sobreviva a um reinício.
function sessaoParaBanco(s) {
    return {
        jogoId: s.jogoId, timeAId: s.timeAId, timeBId: s.timeBId, iniciado: s.iniciado,
        uuidPorLance: s.uuidPorLance,
        fila: { sequencia: s.fila.sequencia, pendentes: s.fila.pendentes, ultimosPorChave: s.fila.ultimosPorChave }
    };
}

function sessaoDoBanco(salva) {
    const s = sessaoVazia();
    if (!salva || typeof salva !== 'object') return s;
    s.jogoId = salva.jogoId ?? null;
    s.timeAId = salva.timeAId ?? null;
    s.timeBId = salva.timeBId ?? null;
    s.iniciado = !!salva.iniciado;
    s.uuidPorLance = salva.uuidPorLance || {};
    if (salva.fila) {
        s.fila = placarEventos.criarEstadoFila(salva.fila.sequencia || 0);
        s.fila.pendentes = Array.isArray(salva.fila.pendentes) ? salva.fila.pendentes : [];
        s.fila.ultimosPorChave = salva.fila.ultimosPorChave || {};
    }
    s.statusConexao = s.jogoId ? (s.fila.pendentes.length ? 'sincronizando' : 'sincronizado') : 'ocioso';
    return s;
}

// Estado salvo de uma versão anterior pode não ter campos novos: completa com
// o estado inicial em vez de quebrar o telão.
function estadoDoBanco(salvo) {
    const base = logic.criarEstadoInicial();
    if (!salvo || typeof salvo !== 'object') return base;
    return {
        ...base, ...salvo,
        timeA: { ...base.timeA, ...(salvo.timeA || {}) },
        timeB: { ...base.timeB, ...(salvo.timeB || {}) },
        cronometro: { ...base.cronometro, ...(salvo.cronometro || {}) },
        slides: { ...base.slides, ...(salvo.slides || {}) }
    };
}

function criarGerenciador({ repos, io, armazenamento }) {
    const placares = new Map();     // id -> instância carregada
    const carregando = new Map();   // id -> Promise (evita carregar duas vezes)
    const sala = (id) => `placar:${id}`;

    async function patrocinadoresDoCliente(clienteId) {
        const nomes = logic.filtrarImagens(await armazenamento.listar(clienteId, 'patrocinadores'));
        return nomes.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    }

    // Arte do cliente: versão (para furar cache do telão), cores de borda e o
    // vídeo de espera, se houver.
    async function arteDoCliente(clienteId) {
        const cliente = await repos.clientes.obter(clienteId);
        const arte = (cliente && cliente.arte) || {};
        const espera = await armazenamento.arquivoArte(clienteId, 'espera');
        return {
            versao: arte.versao || 0,
            bordas: arte.bordas || null,
            videoStandby: espera ? 'espera' + path.extname(espera) : null
        };
    }

    async function carregar(id) {
        const row = await repos.placares.obterInterno(id);
        if (!row) return null;
        const inst = {
            id: row.id,
            clienteId: row.cliente_id,
            nome: row.nome,
            ativo: row.ativo,
            estado: estadoDoBanco(row.estado),
            sessao: sessaoDoBanco(row.sessao),
            arte: null,
            timerGravar: null,
            timerParcial: null
        };
        inst.estado.patrocinadores = await patrocinadoresDoCliente(inst.clienteId);
        inst.arte = await arteDoCliente(inst.clienteId);
        inst.estado.videoStandby = inst.arte.videoStandby;
        placares.set(id, inst);
        return inst;
    }

    async function obter(id) {
        id = Number(id);
        if (!Number.isInteger(id) || id <= 0) return null;
        if (placares.has(id)) return placares.get(id);
        if (!carregando.has(id)) {
            carregando.set(id, carregar(id).finally(() => carregando.delete(id)));
        }
        return carregando.get(id);
    }

    function payloadEstado(inst) {
        const s = inst.estado;
        return {
            ...s,
            serverTime: Date.now(),
            parcialFechavel: logic.parcialFechavel(s),
            parcialAtual: logic.numeroParcialAtual(s),
            totalParciais: logic.quantidadeParciais(s),
            parcialEmAndamento: logic.parcialEmAndamento(s),
            setPoint: logic.pontoDeParcial(s),
            lances: logic.lancesParaTela(s),
            limiteFaltas: logic.limiteFaltas(s),
            alertaFaltas: logic.alertaFaltas(s),
            // Novidades do SaaS: identidade do placar e arte do cliente.
            placar: { id: inst.id, nome: inst.nome },
            arte: { versao: inst.arte ? inst.arte.versao : 0, bordas: inst.arte ? inst.arte.bordas : null }
        };
    }

    function statusIntegracao(inst) {
        const s = inst.sessao;
        return {
            // Sempre "configurada": a agenda agora é interna. O nome do evento
            // ficou o mesmo para o controle não mudar.
            configurada: true,
            jogoId: s.jogoId,
            statusConexao: s.statusConexao,
            pendentes: s.fila.pendentes.length,
            ultimoErro: s.ultimoErro ? String(s.ultimoErro.message || s.ultimoErro) : null
        };
    }

    function emitir(inst, evento, dados) {
        io.to(sala(inst.id)).emit(evento, dados);
    }

    function agendarGravacao(inst) {
        if (inst.timerGravar) return;
        inst.timerGravar = setTimeout(() => {
            inst.timerGravar = null;
            gravar(inst).catch(e => console.error(`Falha ao gravar placar ${inst.id}:`, e.message));
        }, ATRASO_GRAVACAO_MS);
        inst.timerGravar.unref?.();
    }

    async function gravar(inst) {
        await repos.placares.salvarEstado(inst.id, inst.estado, sessaoParaBanco(inst.sessao));
        // Andamento do jogo ao vivo na agenda (placar parcial).
        if (inst.sessao.jogoId && inst.sessao.iniciado) {
            const e = inst.estado;
            await repos.jogos.atualizarParcial(inst.sessao.jogoId, {
                placar_casa: e.timeA.placar, placar_fora: e.timeB.placar, sets_casa: e.timeA.sets, sets_fora: e.timeB.sets,
                periodos_jogados: e.periodo, parciais: e.parciais
            });
        }
    }

    function broadcast(inst) {
        emitir(inst, 'atualizar_tela', payloadEstado(inst));
        agendarGravacao(inst);
    }

    function broadcastIntegracao(inst) {
        emitir(inst, 'integracao_status', statusIntegracao(inst));
        agendarGravacao(inst);
    }

    // ---------------- Súmula (eventos do jogo) ----------------

    // Mesmo contrato do cliente HTTP antigo, gravando no Postgres.
    function apiDaSumula(inst) {
        return { enviarEventos: (_cfg, jogoId, lote) => repos.jogos.gravarEventos(inst.clienteId, jogoId, lote) };
    }

    async function gravarPendentes(inst) {
        const s = inst.sessao;
        if (!s.jogoId || s.fila.pendentes.length === 0 || s.fila.enviando) return;
        try {
            s.statusConexao = 'sincronizando';
            // Lances que chegaram enquanto o lote anterior gravava entram na
            // volta seguinte — sem esperar o retry de 5 s.
            for (let i = 0; i < 50 && s.fila.pendentes.length; i++) {
                await placarEventos.enviarPendentes(apiDaSumula(inst), null, s.jogoId, s.fila);
            }
            s.statusConexao = 'sincronizado';
            s.ultimoErro = null;
        } catch (erro) {
            s.statusConexao = 'erro';
            s.ultimoErro = erro;
            console.error(`Placar ${inst.id}: falha ao gravar súmula:`, erro.message);
        } finally {
            broadcastIntegracao(inst);
        }
    }

    function idDoTime(inst, chave) {
        if (chave === 'timeA') return inst.sessao.timeAId;
        if (chave === 'timeB') return inst.sessao.timeBId;
        return undefined;
    }

    function aplicarTraducao(inst, trad) {
        if (!trad || trad.modo === 'ignorar') return null;
        const s = inst.sessao;
        let evento = null;
        if (trad.modo === 'estornar') {
            evento = placarEventos.criarEstorno(s.fila, trad.chaveEstorno, trad.motivo);
        } else if (trad.modo === 'registrar') {
            const timeId = trad.time ? idDoTime(inst, trad.time) : undefined;
            evento = placarEventos.registrarEvento(s.fila, { ...trad.campos, time_id: timeId, chaveEstorno: trad.chaveEstorno });
        }
        broadcastIntegracao(inst);
        gravarPendentes(inst);
        return evento;
    }

    function registrarAcaoPlacar(inst, payload = {}) {
        if (!inst.sessao.jogoId) return null;
        return aplicarTraducao(inst, placarEventos.traduzirAcaoPlacar({
            acao: payload.acao,
            time: payload.time,
            valor: payload.valor,
            jogador: payload.jogador,
            periodo: inst.estado.periodo,
            cronometroMs: logic.tempoDecorrido(inst.estado.cronometro),
            parcial: payload.parcial
        }));
    }

    function registrarEstornoDeLance(inst, lance) {
        const s = inst.sessao;
        if (!s.jogoId || !lance) return;
        const uuid = s.uuidPorLance[lance.id];
        if (!uuid) return; // lance de antes de carregar o jogo: só o placar local muda
        delete s.uuidPorLance[lance.id];
        const motivo = lance.tipo === 'falta' ? 'falta desfeita pelo operador' : 'ponto desfeito pelo operador';
        placarEventos.estornarEvento(s.fila, uuid, motivo);
        broadcastIntegracao(inst);
        gravarPendentes(inst);
    }

    function registrarCronometro(inst, payload = {}) {
        if (!inst.sessao.jogoId) return;
        aplicarTraducao(inst, placarEventos.traduzirAcaoCronometro({ acao: payload.acao, periodo: inst.estado.periodo }));
    }

    // ---------------- Jogo carregado ----------------

    function mapearElenco(elenco = []) {
        return elenco.map(j => ({
            numero: String(j.numero ?? ''),
            nome: j.nome_exibicao || '',
            foto: j.foto_url || '',
            video: j.video_url || '',
            jogador_id: j.jogador_id,
            titular: !!j.titular,
            capitao: !!j.capitao
        }));
    }

    function aplicarJogo(inst, resposta) {
        const { jogo, time_casa, time_fora } = resposta;
        const e = inst.estado;
        logic.comandoPlacar(e, { acao: 'zerar_tudo' });
        e.esporte = jogo.esporte;
        e.timeA.nome = time_casa.nome_exibicao;
        e.timeA.logo = time_casa.logo_url || '';
        e.timeA.elenco = mapearElenco(time_casa.elenco);
        e.timeB.nome = time_fora.nome_exibicao;
        e.timeB.logo = time_fora.logo_url || '';
        e.timeB.elenco = mapearElenco(time_fora.elenco);
        const s = sessaoVazia();
        s.jogoId = jogo.id;
        s.timeAId = time_casa.id;
        s.timeBId = time_fora.id;
        // Retoma a sequência da súmula se o jogo já teve eventos (recarregar
        // no meio da partida não pode reaproveitar números).
        s.fila = placarEventos.criarEstadoFila(jogo.ultima_sequencia || 0);
        s.iniciado = jogo.status === 'ao_vivo';
        s.statusConexao = 'carregado';
        inst.sessao = s;
    }

    async function iniciarJogo(inst) {
        const s = inst.sessao;
        if (!s.jogoId) return null;
        const r = await repos.jogos.iniciar(inst.clienteId, s.jogoId, inst.id);
        if (!r) throw Object.assign(new Error('Este jogo não pode mais ser iniciado (encerrado ou cancelado).'), { status: 409 });
        s.iniciado = true;
        s.statusConexao = 'sincronizado';
        broadcastIntegracao(inst);
        return r;
    }

    function zerarTudo(inst) {
        const { patrocinadores, videoStandby } = inst.estado;
        inst.estado = logic.criarEstadoInicial();
        inst.estado.patrocinadores = patrocinadores;
        inst.estado.videoStandby = videoStandby;
        inst.sessao = sessaoVazia();
    }

    // ---------------- Mudanças vindas de fora (uploads, painel) ----------------

    async function aposMudancaPatrocinadores(clienteId) {
        const lista = await patrocinadoresDoCliente(clienteId);
        for (const inst of placares.values()) {
            if (inst.clienteId !== clienteId) continue;
            inst.estado.patrocinadores = lista;
            broadcast(inst);
        }
    }

    async function aposMudancaArte(clienteId) {
        const arte = await arteDoCliente(clienteId);
        for (const inst of placares.values()) {
            if (inst.clienteId !== clienteId) continue;
            inst.arte = arte;
            inst.estado.videoStandby = arte.videoStandby;
            broadcast(inst);
        }
    }

    function emitirParaCliente(clienteId, evento, dados) {
        for (const inst of placares.values()) if (inst.clienteId === clienteId) emitir(inst, evento, dados);
    }

    // Placar renomeado/desativado/removido no painel do cliente.
    async function recarregarPlacar(id) {
        const inst = placares.get(Number(id));
        if (!inst) return;
        const row = await repos.placares.obterInterno(inst.id);
        if (!row) {
            clearTimeout(inst.timerGravar);
            placares.delete(inst.id);
            io.in(sala(inst.id)).disconnectSockets(true);
            return;
        }
        inst.nome = row.nome;
        inst.ativo = row.ativo;
        broadcast(inst);
    }

    function desconectarTela(placarId, telaId) {
        for (const s of io.sockets.sockets.values()) {
            if (s.data && s.data.telaId === telaId) s.disconnect(true);
        }
    }

    async function gravarTodos() {
        for (const inst of placares.values()) {
            clearTimeout(inst.timerGravar);
            inst.timerGravar = null;
            await gravarPendentes(inst).catch(() => {});
            await gravar(inst).catch(e => console.error(`Falha ao gravar placar ${inst.id}:`, e.message));
        }
    }

    // Retry periódico da súmula (falha passageira do banco).
    const intervalo = setInterval(() => {
        for (const inst of placares.values()) if (inst.sessao.fila.pendentes.length) gravarPendentes(inst);
    }, 5000);
    intervalo.unref();

    function parar() { clearInterval(intervalo); }

    return {
        sala, obter, payloadEstado, statusIntegracao, emitir, broadcast, broadcastIntegracao,
        gravarPendentes, registrarAcaoPlacar, registrarEstornoDeLance, registrarCronometro,
        aplicarJogo, iniciarJogo, zerarTudo, aposMudancaPatrocinadores, aposMudancaArte,
        emitirParaCliente, recarregarPlacar, desconectarTela, gravar, gravarTodos, parar,
        carregados: () => placares
    };
}

module.exports = { criarGerenciador, sessaoVazia, sessaoParaBanco, sessaoDoBanco, estadoDoBanco };
