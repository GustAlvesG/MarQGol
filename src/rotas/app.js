// API da área do cliente (/app): conta, placares, times, jogadores, agenda,
// usuários e assinatura. Tudo escopado por `req.usuario.clienteId`.
const express = require('express');
const limites = require('../limites');
const seg = require('../seguranca');
const { ErroRegra } = require('../servicos/agenda');
const { planoPublico } = require('./publico');

function rotasApp({ repos, agenda, contas, cobranca, armazenamento, gerenciador, asaas, mw }) {
    const r = express.Router();
    r.use('/api/app', mw.exigirCliente);
    const cid = (req) => req.usuario.clienteId;
    const num = (v) => Number(v);
    const texto = (v, max = 120) => String(v ?? '').trim().slice(0, max);
    const auditar = (req, acao, dados = {}) => repos.auditoria.registrar({
        usuarioId: req.usuario.id, clienteId: cid(req), acao, dados: { ...dados, ...(req.usuario.impersonando ? { suporte: true } : {}) },
        ip: seg.ipDoPedido(req)
    });

    // ---------------- Resumo / conta ----------------
    function clientePublico(c) {
        return {
            id: c.id, nome: c.nome, slug: c.slug, documento: c.documento, email: c.email, telefone: c.telefone,
            status: c.status, teste_ate: c.teste_ate, plano_id: c.plano_id, proximo_vencimento: c.proximo_vencimento,
            inadimplente_desde: c.inadimplente_desde, tem_assinatura: !!c.asaas_assinatura_id
        };
    }

    r.get('/api/app/resumo', async (req, res) => {
        const c = req.usuario.cliente;
        const [plano, lim, uso, bytes, placares] = await Promise.all([
            c.plano_id ? repos.planos.obter(c.plano_id) : null,
            repos.clientes.limites(c),
            repos.clientes.uso(c.id),
            armazenamento.usoBytes(c.id),
            repos.placares.listar(c.id)
        ]);
        res.json({
            usuario: { id: req.usuario.id, nome: req.usuario.nome, email: req.usuario.email, papel: req.usuario.papel,
                impersonando: req.usuario.impersonando, emailVerificado: req.usuario.emailVerificado },
            cliente: clientePublico(c),
            plano: plano ? planoPublico(plano) : null,
            limites: lim,
            uso: { ...uso, max_armazenamento_mb: Math.round(bytes / 1024 / 1024 * 10) / 10 },
            placares,
            diasTolerancia: cobranca.DIAS_TOLERANCIA
        });
    });

    r.patch('/api/app/conta', mw.exigirAdminCliente, async (req, res) => {
        const b = req.body || {};
        const campos = {};
        if (b.nome !== undefined) { campos.nome = texto(b.nome); if (!campos.nome) throw new ErroRegra('Nome obrigatório.'); }
        if (b.telefone !== undefined) campos.telefone = String(b.telefone).replace(/[^\d+]/g, '').slice(0, 20);
        if (b.email !== undefined) {
            campos.email = seg.normalizarEmail(b.email);
            if (!seg.emailValido(campos.email)) throw new ErroRegra('E-mail inválido.');
        }
        if (b.documento !== undefined) {
            campos.documento = String(b.documento).replace(/\D/g, '');
            if (!seg.documentoValido(campos.documento)) throw new ErroRegra('CPF ou CNPJ inválido.');
            if (req.usuario.cliente.asaas_cliente_id && campos.documento !== req.usuario.cliente.documento) {
                throw new ErroRegra('O documento não pode mudar depois da assinatura. Fale com o suporte.');
            }
        }
        const c = await repos.clientes.atualizar(cid(req), campos);
        await auditar(req, 'conta_alterada', Object.keys(campos));
        res.json(clientePublico(c));
    });

    r.patch('/api/app/perfil', async (req, res) => {
        const b = req.body || {};
        const campos = {};
        if (b.nome !== undefined) { campos.nome = texto(b.nome); if (!campos.nome) throw new ErroRegra('Nome obrigatório.'); }
        if (b.novaSenha !== undefined) {
            if (req.usuario.impersonando) throw new ErroRegra('O suporte não troca senha de usuário.', 403);
            const u = await repos.usuarios.obter(req.usuario.id);
            if (!(await seg.conferirSenha(b.senhaAtual || '', u.senha_hash))) throw new ErroRegra('Senha atual incorreta.', 403);
            if (!seg.senhaValida(b.novaSenha)) throw new ErroRegra('A nova senha precisa ter pelo menos 8 caracteres.');
            campos.senha_hash = await seg.gerarHashSenha(b.novaSenha);
        }
        const u = req.usuario.impersonando && campos.nome ? null : await repos.usuarios.atualizar(req.usuario.id, campos);
        res.json({ ok: true, nome: u ? u.nome : req.usuario.nome });
    });

    // ---------------- Placares ----------------
    async function conferirLimitePlacares(clienteId, acrescimo = 1) {
        const [lim, uso] = await Promise.all([repos.clientes.limites(clienteId), repos.clientes.uso(clienteId)]);
        const v = limites.verificar('max_placares', uso.max_placares, lim, acrescimo);
        if (!v.ok) throw new ErroRegra(v.mensagem + ' Desative outro placar ou troque de plano.', 403, 'limite');
    }

    r.get('/api/app/placares', async (req, res) => res.json(await repos.placares.listar(cid(req))));

    r.post('/api/app/placares', mw.exigirAdminCliente, mw.exigirOperante, async (req, res) => {
        const nome = texto((req.body || {}).nome, 60);
        if (!nome) throw new ErroRegra('Dê um nome ao placar (ex.: Quadra 2).');
        await conferirLimitePlacares(cid(req));
        const p = await repos.placares.criar(cid(req), nome);
        await auditar(req, 'placar_criado', { id: p.id, nome });
        res.status(201).json(p);
    });

    r.patch('/api/app/placares/:id', mw.exigirAdminCliente, async (req, res) => {
        const b = req.body || {};
        const atual = await repos.placares.obter(cid(req), num(req.params.id));
        if (!atual) throw new ErroRegra('Placar não encontrado.', 404);
        if (b.ativo === true && !atual.ativo) await conferirLimitePlacares(cid(req));
        const nome = b.nome !== undefined ? texto(b.nome, 60) : undefined;
        if (nome === '') throw new ErroRegra('O nome não pode ficar vazio.');
        const p = await repos.placares.atualizar(cid(req), atual.id, { nome, ativo: typeof b.ativo === 'boolean' ? b.ativo : undefined });
        await gerenciador.recarregarPlacar(p.id);
        await auditar(req, 'placar_alterado', { id: p.id, nome: p.nome, ativo: p.ativo });
        res.json(p);
    });

    r.delete('/api/app/placares/:id', mw.exigirAdminCliente, async (req, res) => {
        const id = num(req.params.id);
        const p = await repos.placares.obter(cid(req), id);
        if (!p) throw new ErroRegra('Placar não encontrado.', 404);
        const aoVivo = await repos.db.um(`SELECT 1 FROM jogos WHERE cliente_id = $1 AND placar_id = $2 AND status = 'ao_vivo'`, [cid(req), id]);
        if (aoVivo) throw new ErroRegra('Há um jogo ao vivo neste placar. Encerre o jogo antes de excluir.', 409);
        await repos.placares.remover(cid(req), id);
        await gerenciador.recarregarPlacar(id);
        await auditar(req, 'placar_excluido', { id, nome: p.nome });
        res.json({ ok: true });
    });

    // ---------------- Times e jogadores ----------------
    async function validarEsporte(clienteId, esporte) {
        if (!limites.ESPORTES.includes(esporte)) throw new ErroRegra('Esporte inválido.');
        const lim = await repos.clientes.limites(clienteId);
        if (!limites.esportePermitido(esporte, lim)) throw new ErroRegra(`O esporte ${esporte} não faz parte do seu plano.`, 403, 'limite');
    }
    // Logo/foto: só URL dos nossos arquivos (ou vazio), nunca base64 gigante.
    function urlArquivo(v, clienteId) {
        if (v === undefined) return undefined;
        const s = String(v || '');
        if (!s) return '';
        if (!s.startsWith(`/arquivos/${clienteId}/`)) throw new ErroRegra('Arquivo inválido. Envie a imagem pelo botão de upload.');
        return s;
    }

    r.get('/api/app/times', async (req, res) => {
        res.json(await repos.times.listar(cid(req), { esporte: texto(req.query.esporte, 20), busca: texto(req.query.busca, 60) }));
    });

    r.post('/api/app/times', mw.exigirOperante, async (req, res) => {
        const b = req.body || {};
        const nome = texto(b.nome, 80);
        if (!nome) throw new ErroRegra('Informe o nome do time.');
        await validarEsporte(cid(req), b.esporte);
        const t = await repos.times.criar(cid(req), { nome, esporte: b.esporte, categoria: texto(b.categoria, 40), logo: urlArquivo(b.logo, cid(req)) });
        res.status(201).json(t);
    });

    r.patch('/api/app/times/:id', mw.exigirOperante, async (req, res) => {
        const b = req.body || {};
        if (b.esporte !== undefined) await validarEsporte(cid(req), b.esporte);
        const t = await repos.times.atualizar(cid(req), num(req.params.id), {
            nome: b.nome !== undefined ? texto(b.nome, 80) || undefined : undefined,
            esporte: b.esporte, categoria: b.categoria !== undefined ? texto(b.categoria, 40) : undefined,
            logo: urlArquivo(b.logo, cid(req))
        });
        if (!t) throw new ErroRegra('Time não encontrado.', 404);
        res.json(t);
    });

    r.delete('/api/app/times/:id', async (req, res) => {
        await repos.times.remover(cid(req), num(req.params.id));
        res.json({ ok: true });
    });

    r.get('/api/app/times/:id/jogadores', async (req, res) => {
        const t = await repos.times.obter(cid(req), num(req.params.id));
        if (!t) throw new ErroRegra('Time não encontrado.', 404);
        res.json(await repos.jogadores.doTime(cid(req), t.id));
    });

    // Aceita um jogador ou uma lista (importação de planilha).
    r.post('/api/app/times/:id/jogadores', mw.exigirOperante, async (req, res) => {
        const t = await repos.times.obter(cid(req), num(req.params.id));
        if (!t) throw new ErroRegra('Time não encontrado.', 404);
        const b = req.body || {};
        const lista = Array.isArray(b.jogadores) ? b.jogadores : [b];
        if (lista.length > 200) throw new ErroRegra('Importe no máximo 200 jogadores por vez.');
        const criados = [];
        for (const j of lista) {
            const nome = texto(j.nome, 80);
            if (!nome) continue;
            criados.push(await repos.jogadores.criar(cid(req), t.id, {
                numero: texto(j.numero, 4), nome, foto: urlArquivo(j.foto, cid(req)) || '', video: urlArquivo(j.video, cid(req)) || ''
            }));
        }
        if (!criados.length) throw new ErroRegra('Informe o nome do jogador.');
        res.status(201).json(Array.isArray(b.jogadores) ? criados : criados[0]);
    });

    r.patch('/api/app/jogadores/:id', mw.exigirOperante, async (req, res) => {
        const b = req.body || {};
        const j = await repos.jogadores.atualizar(cid(req), num(req.params.id), {
            numero: b.numero !== undefined ? texto(b.numero, 4) : undefined,
            nome: b.nome !== undefined ? texto(b.nome, 80) || undefined : undefined,
            foto: urlArquivo(b.foto, cid(req)), video: urlArquivo(b.video, cid(req))
        });
        if (!j) throw new ErroRegra('Jogador não encontrado.', 404);
        res.json(j);
    });

    r.delete('/api/app/jogadores/:id', async (req, res) => {
        await repos.jogadores.remover(cid(req), num(req.params.id));
        res.json({ ok: true });
    });

    // ---------------- Agenda ----------------
    r.get('/api/app/jogos', async (req, res) => {
        const q = req.query;
        const lista = await repos.jogos.listar(cid(req), {
            data: texto(q.data, 10), de: texto(q.de, 40), ate: texto(q.ate, 40), status: texto(q.status, 20),
            placarId: q.placar ? num(q.placar) : null
        });
        res.json(lista.map(agenda.jogoParaLista));
    });

    r.post('/api/app/jogos', async (req, res) => {
        const j = await agenda.criarJogo(cid(req), req.body || {}, req.usuario.id);
        res.status(201).json(agenda.jogoParaLista(await repos.jogos.obter(cid(req), j.id)));
    });

    r.get('/api/app/jogos/:id', async (req, res) => {
        const id = num(req.params.id);
        const completo = await agenda.jogoCompleto(cid(req), id);
        const eventos = await repos.jogos.eventos(cid(req), id);
        res.json({ ...completo, eventos });
    });

    r.patch('/api/app/jogos/:id', mw.exigirOperante, async (req, res) => {
        const b = req.body || {};
        const id = num(req.params.id);
        const campos = {};
        if (b.data_hora !== undefined) {
            const d = new Date(b.data_hora);
            if (isNaN(d)) throw new ErroRegra('Data inválida.');
            campos.data_hora = d;
        }
        if (b.local !== undefined) campos.local = texto(b.local, 200);
        if (b.placar_id !== undefined) {
            campos.placar_id = b.placar_id ? num(b.placar_id) : null;
            if (campos.placar_id && !(await repos.placares.obter(cid(req), campos.placar_id))) throw new ErroRegra('Placar não encontrado.', 404);
        }
        for (const k of ['time_casa_id', 'time_fora_id']) {
            if (b[k] === undefined) continue;
            if (!(await repos.times.obter(cid(req), num(b[k])))) throw new ErroRegra('Time não encontrado.', 404);
            campos[k] = num(b[k]);
        }
        if (b.esporte !== undefined) { await validarEsporte(cid(req), b.esporte); campos.esporte = b.esporte; }
        let j;
        try { j = await repos.jogos.atualizar(cid(req), id, campos); }
        catch (e) { if (e.code === '23514') throw new ErroRegra('Escolha dois times diferentes.'); throw e; }
        if (!j) throw new ErroRegra('Só jogos agendados podem ser editados.', 409);
        res.json(agenda.jogoParaLista(await repos.jogos.obter(cid(req), id)));
    });

    r.post('/api/app/jogos/:id/cancelar', async (req, res) => {
        const j = await repos.jogos.cancelar(cid(req), num(req.params.id));
        if (!j) throw new ErroRegra('Só jogos agendados (ou expirados) podem ser cancelados.', 409);
        res.json({ ok: true });
    });

    r.post('/api/app/jogos/:id/reagendar', async (req, res) => {
        await agenda.reagendarJogo(cid(req), num(req.params.id), (req.body || {}).data_hora);
        res.json(agenda.jogoParaLista(await repos.jogos.obter(cid(req), num(req.params.id))));
    });

    r.put('/api/app/jogos/:id/escalacao/:timeId', mw.exigirOperante, async (req, res) => {
        const lista = Array.isArray((req.body || {}).jogadores) ? req.body.jogadores : [];
        const ok = await repos.jogos.salvarEscalacao(cid(req), num(req.params.id), num(req.params.timeId), lista);
        if (!ok) throw new ErroRegra('Jogo não encontrado.', 404);
        res.json({ ok: true });
    });

    // ---------------- Usuários (admin) ----------------
    r.get('/api/app/usuarios', mw.exigirAdminCliente, async (req, res) => res.json(await repos.usuarios.listar(cid(req))));

    r.post('/api/app/usuarios', mw.exigirAdminCliente, mw.exigirOperante, async (req, res) => {
        const u = await contas.convidar(cid(req), req.body || {}, req.usuario);
        await auditar(req, 'usuario_convidado', { id: u.id, email: u.email, papel: u.papel });
        res.status(201).json({ id: u.id, nome: u.nome, email: u.email, papel: u.papel });
    });

    r.post('/api/app/usuarios/:id/reenviar', mw.exigirAdminCliente, async (req, res) => {
        await contas.reenviarConvite(cid(req), num(req.params.id), req.usuario);
        res.json({ ok: true });
    });

    r.patch('/api/app/usuarios/:id', mw.exigirAdminCliente, async (req, res) => {
        const id = num(req.params.id);
        if (id === req.usuario.id) throw new ErroRegra('Você não pode alterar o próprio papel ou desativar a si mesmo.');
        const u = await repos.usuarios.doCliente(cid(req), id);
        if (!u) throw new ErroRegra('Usuário não encontrado.', 404);
        const b = req.body || {};
        const campos = {};
        if (b.papel !== undefined) campos.papel = b.papel === 'admin' ? 'admin' : 'operador';
        if (typeof b.ativo === 'boolean') {
            if (b.ativo && !u.ativo) {
                const [lim, uso] = await Promise.all([repos.clientes.limites(cid(req)), repos.clientes.uso(cid(req))]);
                const v = limites.verificar('max_usuarios', uso.max_usuarios, lim);
                if (!v.ok) throw new ErroRegra(v.mensagem, 403, 'limite');
            }
            campos.ativo = b.ativo;
        }
        const atualizado = await repos.usuarios.atualizar(id, campos);
        await auditar(req, 'usuario_alterado', { id, ...campos });
        res.json({ id: atualizado.id, papel: atualizado.papel, ativo: atualizado.ativo });
    });

    r.delete('/api/app/usuarios/:id', mw.exigirAdminCliente, async (req, res) => {
        const id = num(req.params.id);
        if (id === req.usuario.id) throw new ErroRegra('Você não pode remover a si mesmo.');
        await repos.usuarios.remover(cid(req), id);
        await auditar(req, 'usuario_removido', { id });
        res.json({ ok: true });
    });

    // ---------------- Assinatura ----------------
    r.get('/api/app/assinatura', mw.exigirAdminCliente, async (req, res) => {
        const c = await repos.clientes.obter(cid(req));
        const [planos, faturas] = await Promise.all([
            repos.planos.listar({ soAtivos: true }),
            repos.faturas.listar(c.id)
        ]);
        res.json({
            cliente: clientePublico(c),
            pagamentoOnline: asaas.configurado,
            // Planos públicos + o plano atual (mesmo que seja sob medida).
            planos: planos.filter(p => p.publico || p.id === c.plano_id).map(planoPublico),
            faturas
        });
    });

    r.post('/api/app/assinatura', mw.exigirAdminCliente, async (req, res) => {
        if (req.usuario.impersonando) throw new ErroRegra('O suporte não assina pelo cliente. Altere o plano pelo painel.', 403);
        const c = await cobranca.assinar(cid(req), num((req.body || {}).planoId), req.usuario);
        const faturas = await repos.faturas.listar(c.id);
        const aberta = faturas.find(f => !['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(f.status) && f.link);
        res.json({ ok: true, cliente: clientePublico(c), linkPagamento: aberta ? aberta.link : null });
    });

    r.post('/api/app/assinatura/atualizar', mw.exigirAdminCliente, async (req, res) => {
        await cobranca.sincronizarFaturas(await repos.clientes.obter(cid(req)));
        res.json(await repos.faturas.listar(cid(req)));
    });

    r.post('/api/app/assinatura/cancelar', mw.exigirAdminCliente, async (req, res) => {
        if (req.usuario.impersonando) throw new ErroRegra('Cancele pelo painel de gestão.', 403);
        if (String((req.body || {}).confirmacao || '').trim().toLowerCase() !== 'cancelar') {
            throw new ErroRegra('Digite CANCELAR para confirmar.');
        }
        await cobranca.cancelar(cid(req), req.usuario);
        res.json({ ok: true });
    });

    return r;
}

module.exports = { rotasApp };
