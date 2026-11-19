// Agenda de jogos: criação com conferência de limites e o "formato de jogo"
// que as telas de controle/configuração já entendiam (herdado da API Laravel:
// { jogo, time_casa, time_fora } com elenco). Manter esse formato deixou o
// controle praticamente intacto na troca da API externa pelo banco interno.
const limites = require('../limites');

class ErroRegra extends Error {
    constructor(mensagem, status = 422, codigo = 'regra') {
        super(mensagem);
        this.status = status;
        this.codigo = codigo;
    }
}

function criarAgenda(repos) {
    const { db } = repos;

    async function exigirOperante(clienteId) {
        const cliente = await repos.clientes.obter(clienteId);
        if (!cliente) throw new ErroRegra('Cliente não encontrado', 404);
        if (!limites.clienteOperante(cliente)) {
            throw new ErroRegra('A assinatura está suspensa. Regularize o pagamento para agendar ou iniciar jogos.', 402, 'assinatura_suspensa');
        }
        return cliente;
    }

    function validarDataHora(valor) {
        const d = new Date(valor);
        if (!valor || isNaN(d)) throw new ErroRegra('Data e hora do jogo inválidas.');
        return d;
    }

    // Cria um jogo agendado. Conta o limite de jogos em aberto dentro da
    // mesma transação, com o registro do cliente travado: dois agendamentos
    // simultâneos não passam juntos do limite.
    async function criarJogo(clienteId, dados, usuarioId = null) {
        const cliente = await exigirOperante(clienteId);
        const lim = await repos.clientes.limites(cliente);
        const esporte = dados.esporte;
        if (!limites.ESPORTES.includes(esporte)) throw new ErroRegra('Esporte inválido.');
        if (!limites.esportePermitido(esporte, lim)) throw new ErroRegra(`O esporte ${esporte} não faz parte do seu plano.`, 403, 'limite');
        const casaId = Number(dados.time_casa_id), foraId = Number(dados.time_fora_id);
        if (!casaId || !foraId || casaId === foraId) throw new ErroRegra('Escolha dois times diferentes.');
        const [casa, fora] = await Promise.all([repos.times.obter(clienteId, casaId), repos.times.obter(clienteId, foraId)]);
        if (!casa || !fora) throw new ErroRegra('Time não encontrado.', 404);
        let placarId = dados.placar_id ? Number(dados.placar_id) : null;
        if (placarId && !(await repos.placares.obter(clienteId, placarId))) throw new ErroRegra('Placar não encontrado.', 404);
        const dataHora = validarDataHora(dados.data_hora);

        return db.transacao(async (tx) => {
            await tx.query('SELECT id FROM clientes WHERE id = $1 FOR UPDATE', [clienteId]);
            const { n } = await repos.jogos.contarAbertos(clienteId, tx);
            const v = limites.verificar('max_jogos_abertos', n, lim);
            if (!v.ok) throw new ErroRegra(v.mensagem, 403, 'limite');
            return repos.jogos.criar(clienteId, {
                esporte, time_casa_id: casaId, time_fora_id: foraId, data_hora: dataHora,
                local: String(dados.local || '').slice(0, 200), placar_id: placarId, criado_por: usuarioId
            }, tx);
        });
    }

    async function reagendarJogo(clienteId, id, dataHora) {
        const cliente = await exigirOperante(clienteId);
        const lim = await repos.clientes.limites(cliente);
        const d = validarDataHora(dataHora);
        return db.transacao(async (tx) => {
            await tx.query('SELECT id FROM clientes WHERE id = $1 FOR UPDATE', [clienteId]);
            const { n } = await repos.jogos.contarAbertos(clienteId, tx);
            const v = limites.verificar('max_jogos_abertos', n, lim);
            if (!v.ok) throw new ErroRegra(v.mensagem, 403, 'limite');
            const r = await repos.jogos.reagendar(clienteId, id, d, tx);
            if (!r) throw new ErroRegra('Só jogos cancelados ou expirados podem ser reagendados.');
            return r;
        });
    }

    // Lista no formato antigo (`data_hora`, `time_casa.nome_exibicao`...).
    function jogoParaLista(j) {
        return {
            id: j.id,
            esporte: j.esporte,
            data_hora: j.data_hora instanceof Date ? j.data_hora.toISOString() : j.data_hora,
            local: j.local,
            status: j.status,
            placar_id: j.placar_id,
            placar_nome: j.placar_nome || null,
            placar_casa: j.placar_casa, placar_fora: j.placar_fora,
            sets_casa: j.sets_casa, sets_fora: j.sets_fora,
            time_casa: { id: j.time_casa_id, nome_exibicao: j.casa_nome, categoria: j.casa_categoria, logo_url: j.casa_logo },
            time_fora: { id: j.time_fora_id, nome_exibicao: j.fora_nome, categoria: j.fora_categoria, logo_url: j.fora_logo }
        };
    }

    async function elencoDoJogo(clienteId, jogoId, timeId) {
        const [jogadores, escalacao] = await Promise.all([
            repos.jogadores.doTime(clienteId, timeId),
            jogoId ? repos.jogos.escalacao(jogoId) : []
        ]);
        const esc = new Map(escalacao.filter(e => e.time_id === timeId).map(e => [e.jogador_id, e]));
        return jogadores.map(j => {
            const e = esc.get(j.id);
            return {
                jogador_id: j.id,
                numero: e && e.numero ? e.numero : j.numero,
                nome_exibicao: j.nome,
                foto_url: j.foto,
                video_url: j.video,
                titular: !!(e && e.titular),
                capitao: !!(e && e.capitao)
            };
        });
    }

    // { jogo, time_casa, time_fora } com elenco — o que `placar_carregar_jogo` aplica.
    async function jogoCompleto(clienteId, id) {
        const j = await repos.jogos.obter(clienteId, id);
        if (!j) throw new ErroRegra('Jogo não encontrado.', 404);
        const lista = jogoParaLista(j);
        const [elencoCasa, elencoFora] = await Promise.all([
            elencoDoJogo(clienteId, j.id, j.time_casa_id),
            elencoDoJogo(clienteId, j.id, j.time_fora_id)
        ]);
        return {
            jogo: { ...lista, ultima_sequencia: j.ultima_sequencia, parciais: j.parciais },
            time_casa: { ...lista.time_casa, elenco: elencoCasa },
            time_fora: { ...lista.time_fora, elenco: elencoFora }
        };
    }

    return { criarJogo, reagendarJogo, jogoParaLista, jogoCompleto, elencoDoJogo, exigirOperante };
}

module.exports = { criarAgenda, ErroRegra };
