// Socket.IO por placar. Cada conexão diz de qual placar é
// (`io({ query: { placar } })`, ver public/js/marq.js) e entra na sala dele.
//
// Quem pode conectar:
//   - usuário logado do cliente dono do placar (ou superadmin "entrando como")
//     → papel 'operador': manda comandos;
//   - TV pareada com esse placar (cookie marq_tela) → papel 'tela': só recebe.
//
// Os eventos e payloads são os mesmos do sistema de um jogo só (ver
// docs/documentacao-tecnica.md, seção "Contrato Socket.IO"); a diferença é que
// tudo acontece dentro da sala do placar.
const logic = require('../../gameLogic');
const { lerCookies, resolverUsuario, resolverTela } = require('../auth');
const { ErroRegra } = require('../servicos/agenda');
const limites = require('../limites');

function registrarSockets({ io, repos, gerenciador, agenda, armazenamento, sessao }) {
    // A sessão do Express também vale no handshake do Socket.IO.
    io.engine.use(sessao);

    io.use(async (socket, next) => {
        try {
            const placarId = Number(socket.handshake.query.placar || socket.handshake.auth?.placar);
            const inst = await gerenciador.obter(placarId);
            if (!inst) return next(new Error('placar_inexistente'));

            const usuario = await resolverUsuario(repos, socket.request.session);
            if (usuario && (usuario.clienteId === inst.clienteId)) {
                if (!inst.ativo) return next(new Error('placar_inativo'));
                // Depois de um downgrade, só os N primeiros placares ativos
                // (N = limite do plano) podem ser operados.
                const lim = await repos.clientes.limites(inst.clienteId);
                const ativos = (await repos.placares.listar(inst.clienteId)).filter(p => p.ativo).map(p => p.id);
                if (ativos.indexOf(inst.id) >= lim.max_placares) return next(new Error('placar_excedente'));
                socket.data = { placarId: inst.id, clienteId: inst.clienteId, papel: 'operador', usuario };
                return next();
            }
            const tela = await resolverTela(repos, lerCookies(socket.request.headers.cookie));
            if (tela && tela.placar_id === inst.id) {
                socket.data = { placarId: inst.id, clienteId: inst.clienteId, papel: 'tela', telaId: tela.id };
                return next();
            }
            next(new Error(usuario ? 'sem_acesso' : 'nao_autenticado'));
        } catch (e) {
            console.error('Falha na autorização do socket:', e.message);
            next(new Error('erro_interno'));
        }
    });

    io.on('connection', async (socket) => {
        const inst = await gerenciador.obter(socket.data.placarId);
        if (!inst) return socket.disconnect(true);
        const operador = socket.data.papel === 'operador';
        socket.join(gerenciador.sala(inst.id));
        socket.emit('atualizar_tela', gerenciador.payloadEstado(inst));
        socket.emit('integracao_status', gerenciador.statusIntegracao(inst));

        // Telas só escutam. Nenhum handler de comando é registrado para elas.
        if (!operador) return;

        // Envolve cada handler: payload malformado não derruba o processo, e
        // eventos com ack sempre recebem resposta.
        const on = (evento, fn) => socket.on(evento, async (dados, ack) => {
            const responder = typeof ack === 'function' ? ack : () => {};
            try {
                const r = await fn(dados || {}, responder);
                if (r !== undefined) responder(r);
            } catch (erro) {
                if (!(erro instanceof ErroRegra) && !erro.status) console.error(`Erro em ${evento} (placar ${inst.id}):`, erro);
                responder({ ok: false, status: erro.status || 500, erro: erro.message || 'Erro interno', codigo: erro.codigo });
            }
        });

        const clienteId = inst.clienteId;
        const usuario = socket.data.usuario;

        // ---- Agenda (antes: API Laravel) ----
        const ACOES = {
            ping: async () => ({ ok: true }),
            listarJogos: async (p) => {
                const lista = await repos.jogos.listar(clienteId, {
                    data: p.data || '', status: p.status || '', placarId: p.todosPlacares ? null : inst.id
                });
                return lista.map(agenda.jogoParaLista);
            },
            listarTimes: async (p) => repos.times.listar(clienteId, { esporte: p.esporte || p.modalidade || '', busca: p.busca || '' }),
            elencoDoTime: async (p) => (await agenda.elencoDoJogo(clienteId, null, Number(p.timeId))),
            // Jogo rápido: cria (ou reaproveita) o time pelo nome.
            criarTime: async (p) => {
                const esporte = p.esporte || p.modalidade;
                const nome = String(p.nome || p.equipe_nome || '').trim();
                if (!nome) throw new ErroRegra('Informe o nome do time.');
                if (!limites.ESPORTES.includes(esporte)) throw new ErroRegra('Esporte inválido.');
                const lim = await repos.clientes.limites(clienteId);
                if (!limites.esportePermitido(esporte, lim)) throw new ErroRegra(`O esporte ${esporte} não faz parte do seu plano.`, 403);
                return repos.times.obterOuCriar(clienteId, { nome: nome.slice(0, 80), esporte, categoria: String(p.categoria || '').slice(0, 40) });
            },
            agendarJogo: async (p) => {
                const jogo = await agenda.criarJogo(clienteId, { ...p, placar_id: p.placar_id ?? inst.id }, usuario.id);
                return agenda.jogoParaLista(await repos.jogos.obter(clienteId, jogo.id));
            }
        };

        on('placar_chamar', async ({ acao, payload }) => {
            const fn = ACOES[acao];
            if (!fn) return { ok: false, erro: `Ação desconhecida: ${acao}` };
            return { ok: true, dado: await fn(payload || {}) };
        });

        async function carregar(jogoId) {
            await agenda.exigirOperante(clienteId);
            const resposta = await agenda.jogoCompleto(clienteId, Number(jogoId));
            if (!['agendado', 'ao_vivo'].includes(resposta.jogo.status)) {
                throw new ErroRegra(resposta.jogo.status === 'expirado'
                    ? 'Este jogo expirou (passou 24 h do horário sem começar). Reagende-o na agenda.'
                    : `Este jogo está ${resposta.jogo.status} e não pode ser carregado.`, 409);
            }
            // Antes de trocar, grava o que restou do jogo anterior.
            await gerenciador.gravarPendentes(inst);
            gerenciador.aplicarJogo(inst, resposta);
            gerenciador.broadcast(inst);
            gerenciador.broadcastIntegracao(inst);
            return resposta;
        }

        on('placar_carregar_jogo', async ({ jogoId }) => ({ ok: true, dado: await carregar(jogoId) }));

        on('placar_criar_jogo', async ({ dados = {} }) => {
            const jogo = await agenda.criarJogo(clienteId, {
                esporte: dados.esporte || dados.modalidade,
                time_casa_id: dados.time_casa_id,
                time_fora_id: dados.time_fora_id,
                local: dados.local,
                data_hora: dados.data_hora || new Date().toISOString(),
                placar_id: inst.id
            }, usuario.id);
            return { ok: true, dado: await carregar(jogo.id) };
        });

        on('placar_iniciar_jogo', async () => {
            if (!inst.sessao.jogoId) return { ok: false, erro: 'Nenhum jogo carregado' };
            await agenda.exigirOperante(clienteId);
            return { ok: true, dado: await gerenciador.iniciarJogo(inst) };
        });

        on('placar_salvar_escalacao', async ({ time_id, jogadores }) => {
            const jogoId = inst.sessao.jogoId;
            if (!jogoId) return { ok: false, erro: 'Nenhum jogo carregado' };
            const timeId = Number(time_id);
            if (![inst.sessao.timeAId, inst.sessao.timeBId].includes(timeId)) return { ok: false, erro: 'Time não pertence ao jogo' };
            await repos.jogos.salvarEscalacao(clienteId, jogoId, timeId, Array.isArray(jogadores) ? jogadores : []);
            return { ok: true, dado: { salvo: true } };
        });

        on('placar_encerrar_jogo', async (dados) => {
            const jogoId = inst.sessao.jogoId;
            if (!jogoId) return { ok: false, erro: 'Nenhum jogo carregado' };
            // Esvazia a súmula antes de fechar o resultado.
            await gerenciador.gravarPendentes(inst);
            if (inst.sessao.fila.pendentes.length) return { ok: false, erro: 'Ainda há lances não gravados. Tente de novo em alguns segundos.' };
            const e = inst.estado;
            const r = await repos.jogos.encerrar(clienteId, jogoId, {
                placar_casa: dados.placar_casa ?? e.timeA.placar,
                placar_fora: dados.placar_fora ?? e.timeB.placar,
                sets_casa: dados.sets_casa ?? e.timeA.sets,
                sets_fora: dados.sets_fora ?? e.timeB.sets,
                periodos_jogados: dados.periodos_jogados ?? e.periodo,
                parciais: e.parciais
            });
            if (!r) return { ok: false, erro: 'Este jogo já estava encerrado ou cancelado.' };
            gerenciador.broadcastIntegracao(inst);
            return { ok: true, dado: { jogo: agenda.jogoParaLista({ ...r, ...(await repos.jogos.obter(clienteId, jogoId)) }), observacoes: null } };
        });

        // ---- Mídia ----
        const listarVideos = async () => logic.filtrarVideos(await armazenamento.listar(clienteId, 'videos'));
        const listarSlides = async () => logic.filtrarSlides(await armazenamento.listar(clienteId, 'slides'))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

        on('solicitar_videos', async () => { socket.emit('lista_videos', await listarVideos()); });
        on('solicitar_slides', async () => { socket.emit('lista_slides', await listarSlides()); });
        on('comando_video', async (dados) => { gerenciador.emitir(inst, 'executar_video', dados); });
        on('comando_slides', async (dados) => { logic.comandoSlides(inst.estado, dados); gerenciador.broadcast(inst); });
        on('comando_transmissao', async (dados) => { logic.comandoTransmissao(inst.estado, dados); gerenciador.broadcast(inst); });

        // ---- Jogo ----
        on('configurar_jogo', async (dados) => {
            logic.configurarJogo(inst.estado, dados);
            gerenciador.broadcast(inst);
        });

        on('comando_placar', async (payload) => {
            const acao = payload.acao;
            if (['add_ponto', 'sub_ponto', 'add_set', 'sub_set', 'add_falta', 'sub_falta'].includes(acao)
                && !['timeA', 'timeB'].includes(payload.time)) return; // time inválido: ignora
            const e = inst.estado;
            const antesDoFechamento = acao === 'fechar_set'
                ? { time: logic.vencedorParcial(e), parcial: { numero: logic.numeroParcialAtual(e), a: e.timeA.placar, b: e.timeB.placar } }
                : null;

            const { animacoes, lance, estornado } = logic.comandoPlacar(e, payload, Date.now());
            animacoes.forEach(a => gerenciador.emitir(inst, a.name, a.payload));
            gerenciador.broadcast(inst);

            let evento = null;
            if (antesDoFechamento) evento = gerenciador.registrarAcaoPlacar(inst, { ...payload, ...antesDoFechamento });
            else if (acao === 'reabrir_set') gerenciador.registrarAcaoPlacar(inst, { ...payload, time: logic.vencedorParcial(inst.estado) });
            else if (acao === 'estornar_lance') gerenciador.registrarEstornoDeLance(inst, estornado);
            else evento = gerenciador.registrarAcaoPlacar(inst, payload);
            if (lance && evento) inst.sessao.uuidPorLance[lance.id] = evento.uuid;
        });

        on('comando_cronometro', async (payload) => {
            logic.comandoCronometro(inst.estado, payload, Date.now());
            gerenciador.broadcast(inst);
            gerenciador.registrarCronometro(inst, payload);
            // O primeiro PLAY marca o jogo como ao vivo na agenda.
            if (payload.acao === 'play' && inst.sessao.jogoId && !inst.sessao.iniciado) {
                gerenciador.iniciarJogo(inst).catch(erro => {
                    inst.sessao.ultimoErro = erro;
                    gerenciador.broadcastIntegracao(inst);
                });
            }
        });

        on('zerar_configuracao_completa', async () => {
            await gerenciador.gravarPendentes(inst);
            gerenciador.zerarTudo(inst);
            gerenciador.broadcast(inst);
            gerenciador.broadcastIntegracao(inst);
        });
    });
}

module.exports = { registrarSockets };
