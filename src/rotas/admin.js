// API do painel de gestão (/admin) — só superadmin. Clientes, tabela de preços do plano on demand,
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
        const tabela = await repos.precos.obter();
        res.json(lista.map(c => ({
            id: c.id, nome: c.nome, slug: c.slug, email: c.email, status: c.status,
            plano_resumo: limites.resumoDaComposicao(c.composicao, tabela), valor_mensal_centavos: c.valor_mensal_centavos,
            teste_ate: c.teste_ate, criado_em: c.criado_em, ultimo_acesso_em: c.ultimo_acesso_em,
            uso: { placares: c.uso_placares, jogos_abertos: c.uso_jogos_abertos, usuarios: c.uso_usuarios },
            tem_limites_extra: Object.keys(c.limites_extra || {}).length > 0
        })));
    });

    r.get('/api/admin/clientes/:id', async (req, res) => {
        const c = await repos.clientes.obter(num(req.params.id));
        if (!c) throw new ErroRegra('Cliente não encontrado.', 404);
        const [tabela, lim, uso, bytes, usuarios, placares, faturas, auditoria] = await Promise.all([
            repos.precos.obter(),
            repos.clientes.limites(c), repos.clientes.uso(c.id), armazenamento.usoBytes(c.id, { semCache: true }),
            repos.usuarios.listar(c.id), repos.placares.listar(c.id), repos.faturas.listar(c.id),
            repos.auditoria.listar({ clienteId: c.id, limite: 50 })
        ]);
        res.json({
            cliente: c, limites: lim,
            // Preço da composição atual pela tabela de hoje (o cliente pode pagar
            // outro valor: preço congelado da contratação ou negociado).
            plano: { resumo: limites.resumoDaComposicao(c.composicao, tabela), ...limites.precoDaComposicao(c.composicao, tabela) },
            precos: tabela, recursos: limites.RECURSOS,
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
        // Plano on demand montado por você (sem o teto do autoatendimento) e,
        // se houver, o valor negociado; senão vale a tabela de preços.
        const tabela = await repos.precos.obter();
        const preco = limites.precoDaComposicao(limites.normalizarComposicao(b.composicao, tabela, { teto: false }), tabela);
        const valor = b.valor_mensal_centavos === undefined || b.valor_mensal_centavos === null || b.valor_mensal_centavos === ''
            ? preco.total : Math.round(Number(b.valor_mensal_centavos));
        if (!Number.isInteger(valor) || valor < 0) throw new ErroRegra('Valor mensal inválido.');
        // Acesso do administrador: senha definida agora (sem e-mail) ou convite.
        const senhaAdmin = b.senhaAdmin ? String(b.senhaAdmin) : '';
        if (senhaAdmin && !seg.senhaValida(senhaAdmin)) throw new ErroRegra('A senha do administrador precisa ter pelo menos 8 caracteres.');
        // Confere antes de criar: o convite falharia depois e deixaria o cliente órfão.
        if (b.convidarAdmin !== false && await repos.usuarios.porEmail(email)) {
            throw new ErroRegra('Este e-mail já tem uma conta no MarQGol. Use outro e-mail para o administrador.', 409);
        }
        const status = STATUS.includes(b.status) ? b.status : 'teste';
        const testeAte = status === 'teste' ? (b.teste_ate ? new Date(b.teste_ate) : limites.fimDoTeste(new Date(), tabela.dias_teste)) : null;
        const cliente = await repos.clientes.criar({
            nome, slug: await repos.clientes.slugDisponivel(seg.gerarSlug(nome)), documento, email,
            telefone: String(b.telefone || '').replace(/[^\d+]/g, ''), status, composicao: preco.composicao,
            valor_mensal_centavos: valor, teste_ate: testeAte,
            limites_extra: validarLimitesExtra(b.limites_extra), observacoes: texto(b.observacoes, 2000)
        });
        for (let i = 1; i <= preco.composicao.placares; i++) await repos.placares.criar(cliente.id, `Quadra ${i}`);
        if (b.convidarAdmin !== false) {
            const pessoa = { nome: texto(b.nomeAdmin) || nome, email, papel: 'admin' };
            if (senhaAdmin) await contas.criarComSenha(cliente.id, { ...pessoa, senha: senhaAdmin });
            else await contas.convidar(cliente.id, pessoa, req.usuario);
        }
        await auditar(req, cliente.id, 'cliente_criado', { plano: limites.resumoDaComposicao(preco.composicao, tabela), valor: valor / 100, status });
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
        // Plano on demand (itens e/ou valor negociado; valor null = preço da
        // tabela). Com assinatura, o Asaas é atualizado antes de gravar.
        if (b.composicao !== undefined || b.valor_mensal_centavos !== undefined) {
            await cobranca.aplicarComposicao(id, b.composicao !== undefined ? b.composicao : atual.composicao, req.usuario, {
                teto: false, valorCentavos: b.valor_mensal_centavos === '' ? null : b.valor_mensal_centavos
            }).catch(e => { throw e instanceof ErroRegra ? e : new ErroRegra(`O Asaas recusou a mudança: ${e.message}`, 502); });
        }
        const c = await repos.clientes.atualizar(id, campos);
        // Só o plano mudou? aplicarComposicao já registrou "composicao_alterada".
        if (Object.keys(campos).length) {
            await auditar(req, id, 'cliente_alterado', { campos: Object.keys(campos), ...(campos.status ? { de: atual.status, para: campos.status } : {}) });
        }
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

    // ---------------- Usuários de um cliente ----------------
    // Mesmo que o admin do cliente faz em /app, para o suporte e para quando
    // não há e-mail: criar com senha, trocar papel/nome, (des)ativar, senha nova.
    async function usuarioDoCliente(req) {
        const c = await repos.clientes.obter(num(req.params.id));
        if (!c) throw new ErroRegra('Cliente não encontrado.', 404);
        const u = req.params.uid ? await repos.usuarios.doCliente(c.id, num(req.params.uid)) : null;
        if (req.params.uid && !u) throw new ErroRegra('Usuário não encontrado.', 404);
        return { c, u };
    }

    r.post('/api/admin/clientes/:id/usuarios', async (req, res) => {
        const { c } = await usuarioDoCliente(req);
        const b = req.body || {};
        const comSenha = !!b.senha;
        const u = comSenha ? await contas.criarComSenha(c.id, b) : await contas.convidar(c.id, b, req.usuario);
        await auditar(req, c.id, comSenha ? 'usuario_criado' : 'usuario_convidado', { id: u.id, email: u.email, papel: u.papel });
        res.status(201).json({ id: u.id, nome: u.nome, email: u.email, papel: u.papel });
    });

    r.patch('/api/admin/clientes/:id/usuarios/:uid', async (req, res) => {
        const { c, u } = await usuarioDoCliente(req);
        const b = req.body || {};
        const campos = {};
        if (b.nome !== undefined) { campos.nome = texto(b.nome); if (!campos.nome) throw new ErroRegra('Nome obrigatório.'); }
        if (b.papel !== undefined) campos.papel = b.papel === 'admin' ? 'admin' : 'operador';
        if (typeof b.ativo === 'boolean') campos.ativo = b.ativo;
        if (b.senha !== undefined) await contas.definirSenha(u.id, b.senha);
        const novo = await repos.usuarios.atualizar(u.id, campos);
        await auditar(req, c.id, 'usuario_alterado', { id: u.id, ...campos, ...(b.senha !== undefined ? { senha: 'redefinida' } : {}) });
        res.json({ id: novo.id, nome: novo.nome, papel: novo.papel, ativo: novo.ativo });
    });

    r.delete('/api/admin/clientes/:id/usuarios/:uid', async (req, res) => {
        const { c, u } = await usuarioDoCliente(req);
        await repos.usuarios.remover(c.id, u.id);
        await auditar(req, c.id, 'usuario_removido', { id: u.id, email: u.email });
        res.json({ ok: true });
    });

    // ---------------- Superadmins (equipe do painel) ----------------
    r.get('/api/admin/superadmins', async (req, res) => {
        const lista = await repos.usuarios.superadmins();
        res.json(lista.map(u => ({ ...u, voce: u.id === req.usuario.id })));
    });

    r.post('/api/admin/superadmins', async (req, res) => {
        const u = await contas.criarComSenha(null, req.body || {});
        await auditar(req, null, 'superadmin_criado', { id: u.id, email: u.email });
        res.status(201).json({ id: u.id, nome: u.nome, email: u.email });
    });

    async function outroSuperadminAtivo(id) {
        const lista = await repos.usuarios.superadmins();
        return lista.some(s => s.ativo && s.id !== id);
    }

    r.patch('/api/admin/superadmins/:sid', async (req, res) => {
        const id = num(req.params.sid);
        const u = await repos.usuarios.obter(id);
        if (!u || u.papel !== 'superadmin') throw new ErroRegra('Superadmin não encontrado.', 404);
        const b = req.body || {};
        const campos = {};
        if (b.nome !== undefined) { campos.nome = texto(b.nome); if (!campos.nome) throw new ErroRegra('Nome obrigatório.'); }
        if (typeof b.ativo === 'boolean' && b.ativo !== u.ativo) {
            if (id === req.usuario.id) throw new ErroRegra('Você não pode desativar a si mesmo.');
            if (!b.ativo && !(await outroSuperadminAtivo(id))) throw new ErroRegra('Precisa sobrar ao menos um superadmin ativo.');
            campos.ativo = b.ativo;
        }
        if (b.senha !== undefined) {
            // A própria senha continua logada nesta sessão; as outras caem.
            await contas.definirSenha(id, b.senha, { manterSessao: id === req.usuario.id ? req.sessionID : '' });
        }
        const novo = await repos.usuarios.atualizar(id, campos);
        await auditar(req, null, 'superadmin_alterado', { id, ...campos, ...(b.senha !== undefined ? { senha: 'redefinida' } : {}) });
        res.json({ id: novo.id, nome: novo.nome, ativo: novo.ativo });
    });

    r.delete('/api/admin/superadmins/:sid', async (req, res) => {
        const id = num(req.params.sid);
        if (id === req.usuario.id) throw new ErroRegra('Você não pode remover a si mesmo.');
        const u = await repos.usuarios.obter(id);
        if (!u || u.papel !== 'superadmin') throw new ErroRegra('Superadmin não encontrado.', 404);
        if (u.ativo && !(await outroSuperadminAtivo(id))) throw new ErroRegra('Precisa sobrar ao menos um superadmin ativo.');
        await repos.usuarios.removerSuperadmin(id);
        await auditar(req, null, 'superadmin_removido', { id, email: u.email });
        res.json({ ok: true });
    });

    // ---------------- Tabela de preços (plano on demand) ----------------
    function validarPrecos(b) {
        const p = {};
        const inteiro = (k, min, max, rot) => {
            if (b[k] === undefined) return;
            const n = Number(b[k]);
            if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) throw new ErroRegra(`${rot}: valor inválido.`);
            p[k] = n;
        };
        inteiro('preco_placar_centavos', 0, undefined, 'Preço do placar');
        inteiro('preco_pacote_usuarios_centavos', 0, undefined, 'Preço do pacote de usuários');
        inteiro('usuarios_por_pacote', 1, 1000, 'Usuários por pacote');
        inteiro('jogos_por_placar', 0, 100000, 'Jogos por placar');
        inteiro('armazenamento_mb_por_placar', 0, 10000000, 'Armazenamento por placar');
        inteiro('dias_teste', 0, 90, 'Dias de teste');
        inteiro('max_placares_autoatendimento', 1, 1000, 'Máximo de placares no site');
        inteiro('max_pacotes_autoatendimento', 0, 1000, 'Máximo de pacotes no site');
        if (b.precos_recursos !== undefined) {
            p.precos_recursos = {};
            for (const k of Object.keys(limites.RECURSOS)) {
                const n = Number((b.precos_recursos || {})[k] ?? 0);
                if (!Number.isInteger(n) || n < 0) throw new ErroRegra(`Preço de "${limites.RECURSOS[k].rotulo}" inválido.`);
                p.precos_recursos[k] = n;
            }
        }
        return p;
    }

    r.get('/api/admin/precos', async (_req, res) => {
        const tabela = await repos.precos.obter();
        const { n } = await repos.db.um(`SELECT count(*) AS n FROM clientes WHERE status <> 'cancelado'`);
        res.json({ precos: tabela, recursos: limites.RECURSOS, clientes: n });
    });

    // Vale para novos cadastros e para quem mudar o plano depois; quem já é
    // cliente continua pagando o valor contratado.
    r.put('/api/admin/precos', async (req, res) => {
        const p = await repos.precos.atualizar(validarPrecos(req.body || {}));
        await auditar(req, null, 'precos_alterados', {});
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
