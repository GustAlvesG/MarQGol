// API do painel de gestão (/admin) — só superadmin. Clientes, planos,
// limites individuais, status, "entrar como" e auditoria.
const express = require('express');
const limites = require('../limites');
const seg = require('../seguranca');
const { ErroRegra } = require('../servicos/agenda');

const STATUS = ['teste', 'ativo', 'inadimplente', 'suspenso', 'cancelado'];

function rotasAdmin({ repos, contas, cobranca, armazenamento, gerenciador, mw }) {
    const r = express.Router();
    r.use('/api/admin', mw.exigirSuperadmin);
    const num = (v) => Number(v);
    const texto = (v, max = 120) => String(v ?? '').trim().slice(0, max);
    const auditar = (req, clienteId, acao, dados = {}) => repos.auditoria.registrar({
        usuarioId: req.usuario.id, clienteId, acao, dados, ip: seg.ipDoPedido(req)
    });

    r.get('/api/admin/indicadores', async (_req, res) => res.json(await repos.clientes.indicadores()));

    r.get('/api/admin/clientes', async (req, res) => {
        const lista = await repos.clientes.listarComUso({ busca: texto(req.query.busca, 80), status: texto(req.query.status, 20) });
        res.json(lista.map(c => ({
            id: c.id, nome: c.nome, slug: c.slug, email: c.email, status: c.status, plano_id: c.plano_id, plano_nome: c.plano_nome,
            teste_ate: c.teste_ate, criado_em: c.criado_em, ultimo_acesso_em: c.ultimo_acesso_em,
            uso: { placares: c.uso_placares, jogos_abertos: c.uso_jogos_abertos, usuarios: c.uso_usuarios },
            tem_limites_extra: Object.keys(c.limites_extra || {}).length > 0
        })));
    });

    r.get('/api/admin/clientes/:id', async (req, res) => {
        const c = await repos.clientes.obter(num(req.params.id));
        if (!c) throw new ErroRegra('Cliente não encontrado.', 404);
        const [plano, lim, uso, bytes, usuarios, placares, faturas, auditoria] = await Promise.all([
            c.plano_id ? repos.planos.obter(c.plano_id) : null,
            repos.clientes.limites(c), repos.clientes.uso(c.id), armazenamento.usoBytes(c.id, { semCache: true }),
            repos.usuarios.listar(c.id), repos.placares.listar(c.id), repos.faturas.listar(c.id),
            repos.auditoria.listar({ clienteId: c.id, limite: 50 })
        ]);
        res.json({
            cliente: c, plano, limites: lim,
            uso: { ...uso, max_armazenamento_mb: Math.round(bytes / 1024 / 1024 * 10) / 10 },
            usuarios, placares, faturas, auditoria
        });
    });

    function validarLimitesExtra(e) {
        if (!e || typeof e !== 'object') return {};
        const r = {};
        for (const k of limites.CAMPOS_NUMERICOS) {
            if (e[k] === undefined || e[k] === null || e[k] === '') continue;
            const n = Number(e[k]);
            if (!Number.isInteger(n) || n < 0) throw new ErroRegra(`Limite ${k} inválido.`);
            r[k] = n;
        }
        if (Array.isArray(e.esportes) && e.esportes.length) {
            r.esportes = e.esportes.filter(x => limites.ESPORTES.includes(x));
        }
        if (e.recursos && typeof e.recursos === 'object') {
            const rec = {};
            for (const k of Object.keys(limites.RECURSOS)) if (typeof e.recursos[k] === 'boolean') rec[k] = e.recursos[k];
            if (Object.keys(rec).length) r.recursos = rec;
        }
        return r;
    }

    // Cadastro manual (venda feita por você): cria o cliente e convida o admin.
    r.post('/api/admin/clientes', async (req, res) => {
        const b = req.body || {};
        const nome = texto(b.nome);
        if (!nome) throw new ErroRegra('Informe o nome do cliente.');
        const email = seg.normalizarEmail(b.email);
        if (!seg.emailValido(email)) throw new ErroRegra('E-mail inválido.');
        const documento = String(b.documento || '').replace(/\D/g, '');
        if (documento && !seg.documentoValido(documento)) throw new ErroRegra('CPF ou CNPJ inválido.');
        const plano = await repos.planos.obter(num(b.plano_id));
        if (!plano) throw new ErroRegra('Escolha um plano.');
        // Confere antes de criar: o convite falharia depois e deixaria o cliente órfão.
        if (b.convidarAdmin !== false && await repos.usuarios.porEmail(email)) {
            throw new ErroRegra('Este e-mail já tem uma conta no MarQGol. Use outro e-mail para o administrador.', 409);
        }
        const status = STATUS.includes(b.status) ? b.status : 'teste';
        const testeAte = status === 'teste' ? (b.teste_ate ? new Date(b.teste_ate) : limites.fimDoTeste(new Date(), plano.dias_teste)) : null;
        const cliente = await repos.clientes.criar({
            nome, slug: await repos.clientes.slugDisponivel(seg.gerarSlug(nome)), documento, email,
            telefone: String(b.telefone || '').replace(/[^\d+]/g, ''), status, plano_id: plano.id, teste_ate: testeAte,
            limites_extra: validarLimitesExtra(b.limites_extra), observacoes: texto(b.observacoes, 2000)
        });
        await repos.placares.criar(cliente.id, 'Quadra 1');
        if (b.convidarAdmin !== false) {
            await contas.convidar(cliente.id, { nome: texto(b.nomeAdmin) || nome, email, papel: 'admin' }, req.usuario);
        }
        await auditar(req, cliente.id, 'cliente_criado', { plano: plano.nome, status });
        res.status(201).json(cliente);
    });

    r.patch('/api/admin/clientes/:id', async (req, res) => {
        const id = num(req.params.id);
        const atual = await repos.clientes.obter(id);
        if (!atual) throw new ErroRegra('Cliente não encontrado.', 404);
        const b = req.body || {};
        const campos = {};
        if (b.nome !== undefined) { campos.nome = texto(b.nome); if (!campos.nome) throw new ErroRegra('Nome obrigatório.'); }
        if (b.email !== undefined) { campos.email = seg.normalizarEmail(b.email); if (!seg.emailValido(campos.email)) throw new ErroRegra('E-mail inválido.'); }
        if (b.telefone !== undefined) campos.telefone = String(b.telefone).replace(/[^\d+]/g, '').slice(0, 20);
        if (b.documento !== undefined) {
            campos.documento = String(b.documento).replace(/\D/g, '');
            if (campos.documento && !seg.documentoValido(campos.documento)) throw new ErroRegra('CPF ou CNPJ inválido.');
        }
        if (b.plano_id !== undefined) {
            const p = await repos.planos.obter(num(b.plano_id));
            if (!p) throw new ErroRegra('Plano inexistente.');
            campos.plano_id = p.id;
        }
        if (b.status !== undefined) {
            if (!STATUS.includes(b.status)) throw new ErroRegra('Status inválido.');
            campos.status = b.status;
            if (b.status !== 'inadimplente') campos.inadimplente_desde = null;
            else if (atual.status !== 'inadimplente') campos.inadimplente_desde = new Date();
        }
        if (b.teste_ate !== undefined) {
            const d = b.teste_ate ? new Date(b.teste_ate) : null;
            if (d && isNaN(d)) throw new ErroRegra('Data de fim do teste inválida.');
            campos.teste_ate = d;
        }
        if (b.limites_extra !== undefined) campos.limites_extra = validarLimitesExtra(b.limites_extra);
        if (b.observacoes !== undefined) campos.observacoes = texto(b.observacoes, 4000);
        const c = await repos.clientes.atualizar(id, campos);
        // Mudança de plano pelo painel também atualiza o valor no Asaas.
        if (campos.plano_id && campos.plano_id !== atual.plano_id && atual.asaas_assinatura_id && b.atualizarCobranca !== false) {
            await cobranca.assinar(id, campos.plano_id, req.usuario).catch(e => { throw new ErroRegra(`Plano trocado, mas o Asaas recusou: ${e.message}`, 502); });
        }
        await auditar(req, id, 'cliente_alterado', { campos: Object.keys(campos), ...(campos.status ? { de: atual.status, para: campos.status } : {}) });
        res.json(c);
    });

    r.delete('/api/admin/clientes/:id', async (req, res) => {
        const id = num(req.params.id);
        const c = await repos.clientes.obter(id);
        if (!c) throw new ErroRegra('Cliente não encontrado.', 404);
        if (String((req.body || {}).confirmacao || '') !== c.slug) throw new ErroRegra(`Para excluir, digite o identificador do cliente: ${c.slug}`);
        if (c.asaas_assinatura_id) throw new ErroRegra('Cancele a assinatura no Asaas (status Cancelado) antes de excluir.', 409);
        for (const p of await repos.placares.listar(id)) { await repos.placares.remover(id, p.id); await gerenciador.recarregarPlacar(p.id); }
        await repos.db.query('DELETE FROM clientes WHERE id = $1', [id]);
        await armazenamento.removerCliente(id);
        await auditar(req, null, 'cliente_excluido', { id, nome: c.nome, slug: c.slug });
        res.json({ ok: true });
    });

    // Suporte: abre a área do cliente como admin dele.
    r.post('/api/admin/clientes/:id/entrar', async (req, res) => {
        const c = await repos.clientes.obter(num(req.params.id));
        if (!c) throw new ErroRegra('Cliente não encontrado.', 404);
        req.session.comoClienteId = c.id;
        await auditar(req, c.id, 'entrar_como', {});
        res.json({ ok: true, destino: '/app/' });
    });

    r.post('/api/admin/sair-cliente', (req, res) => {
        delete req.session.comoClienteId;
        res.json({ ok: true, destino: '/admin/' });
    });

    r.post('/api/admin/clientes/:id/reenviar-acesso', async (req, res) => {
        const id = num(req.params.id);
        const admins = await repos.usuarios.adminsDoCliente(id);
        for (const a of admins) {
            if (a.senha_hash) await contas.pedirRedefinicao(a.email);
            else await contas.reenviarConvite(id, a.id, req.usuario);
        }
        await auditar(req, id, 'acesso_reenviado', { admins: admins.length });
        res.json({ ok: true, enviados: admins.length });
    });

    // ---------------- Planos ----------------
    function validarPlano(b) {
        const p = {
            nome: texto(b.nome, 60), descricao: texto(b.descricao, 400),
            preco_centavos: Math.round(Number(b.preco_centavos)),
            dias_teste: b.dias_teste === undefined ? 14 : Number(b.dias_teste),
            publico: b.publico !== false, ativo: b.ativo !== false, ordem: Number(b.ordem) || 0,
            esportes: Array.isArray(b.esportes) ? b.esportes.filter(x => limites.ESPORTES.includes(x)) : limites.ESPORTES,
            recursos: {}
        };
        if (!p.nome) throw new ErroRegra('Nome do plano obrigatório.');
        if (!Number.isInteger(p.preco_centavos) || p.preco_centavos < 0) throw new ErroRegra('Preço inválido.');
        if (!Number.isInteger(p.dias_teste) || p.dias_teste < 0 || p.dias_teste > 90) throw new ErroRegra('Dias de teste entre 0 e 90.');
        if (!p.esportes.length) throw new ErroRegra('Escolha ao menos um esporte.');
        for (const k of limites.CAMPOS_NUMERICOS) {
            const n = Number(b[k]);
            if (!Number.isInteger(n) || n < 0) throw new ErroRegra(`Valor inválido em ${k}.`);
            p[k] = n;
        }
        for (const k of Object.keys(limites.RECURSOS)) p.recursos[k] = !!(b.recursos && b.recursos[k]);
        return p;
    }

    r.get('/api/admin/planos', async (_req, res) => {
        const planos = await repos.planos.listar();
        const uso = await repos.db.varios(`SELECT plano_id, count(*) AS n FROM clientes GROUP BY plano_id`);
        const porPlano = Object.fromEntries(uso.map(u => [u.plano_id, u.n]));
        res.json({ planos: planos.map(p => ({ ...p, clientes: porPlano[p.id] || 0 })), recursos: limites.RECURSOS });
    });
    r.post('/api/admin/planos', async (req, res) => {
        const p = await repos.planos.criar(validarPlano(req.body || {}));
        await auditar(req, null, 'plano_criado', { id: p.id, nome: p.nome });
        res.status(201).json(p);
    });
    r.put('/api/admin/planos/:id', async (req, res) => {
        const p = await repos.planos.atualizar(num(req.params.id), validarPlano(req.body || {}));
        if (!p) throw new ErroRegra('Plano não encontrado.', 404);
        await auditar(req, null, 'plano_alterado', { id: p.id, nome: p.nome });
        res.json(p);
    });

    r.get('/api/admin/auditoria', async (req, res) => {
        res.json(await repos.auditoria.listar({ clienteId: req.query.cliente ? num(req.query.cliente) : null, limite: 300 }));
    });

    // Roda a revisão de status agora (útil para conferir sem esperar a tarefa).
    r.post('/api/admin/revisar-status', async (req, res) => {
        res.json(await cobranca.revisarStatus());
    });

    return r;
}

module.exports = { rotasAdmin };
