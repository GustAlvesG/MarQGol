// Assinatura e cobrança via Asaas.
//
// Ciclo de vida do cliente:
//   teste (14 dias) ──assina e paga──▶ ativo
//   teste vencido sem assinatura ──▶ suspenso
//   teste vencido com assinatura, fatura em aberto ──▶ inadimplente
//   ativo ──fatura vencida (webhook PAYMENT_OVERDUE)──▶ inadimplente
//   inadimplente há mais de DIAS_TOLERANCIA ──▶ suspenso
//   suspenso/inadimplente ──pagamento confirmado──▶ ativo
// Suspensão nunca derruba um jogo ao vivo: só bloqueia novos jogos e cadastros.
const { faturaDoPagamento, STATUS_PAGO } = require('./asaas');
const { ErroRegra } = require('./agenda');
const limites = require('../limites');

const DIAS_TOLERANCIA = 7;

function hojeIso(d = new Date()) {
    // Data no fuso de São Paulo (o Asaas trabalha com datas locais).
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}

function criarCobranca({ repos, asaas, email, cfg }) {
    // Aparece na fatura do Asaas: "MarQGol — 2 placares · 10 usuários · mídia".
    function descricao(composicao, tabela) {
        return `MarQGol — ${limites.resumoDaComposicao(composicao, tabela)}`;
    }

    async function garantirClienteAsaas(cliente) {
        if (cliente.asaas_cliente_id) return cliente.asaas_cliente_id;
        if (!cliente.documento) throw new ErroRegra('Cadastre o CPF ou CNPJ da conta antes de assinar.');
        const r = await asaas.criarCliente({
            nome: cliente.nome, documento: cliente.documento, email: cliente.email,
            telefone: cliente.telefone, referencia: cliente.id
        });
        await repos.clientes.atualizar(cliente.id, { asaas_cliente_id: r.id });
        return r.id;
    }

    async function sincronizarFaturas(cliente) {
        if (!cliente.asaas_assinatura_id) return [];
        const r = await asaas.cobrancasDaAssinatura(cliente.asaas_assinatura_id);
        const lista = (r && r.data) || [];
        for (const p of lista) await repos.faturas.upsert(cliente.id, faturaDoPagamento(p));
        return lista;
    }

    // Muda o que o cliente contrata (plano on demand). O valor é recalculado
    // pela tabela de preços atual — ou `valorCentavos` (preço negociado, só
    // pelo painel). Com assinatura no Asaas, o valor é atualizado lá também.
    // Reduzir placares não apaga nada: o excedente fica sem operar até o
    // cliente desativar um placar (placar_excedente).
    async function aplicarComposicao(clienteId, composicao, usuario, { teto = true, valorCentavos } = {}) {
        const cliente = await repos.clientes.obter(clienteId);
        if (cliente.status === 'cancelado' && teto) throw new ErroRegra('Conta cancelada. Fale com o suporte para reativar.', 409);
        const tabela = await repos.precos.obter();
        const preco = limites.precoDaComposicao(limites.normalizarComposicao(composicao, tabela, { teto }), tabela);
        const valor = valorCentavos === undefined || valorCentavos === null ? preco.total : Math.round(Number(valorCentavos));
        if (!Number.isInteger(valor) || valor < 0) throw new ErroRegra('Valor mensal inválido.');
        if (cliente.asaas_assinatura_id) {
            if (valor <= 0) throw new ErroRegra('Com assinatura no Asaas o valor mensal precisa ser maior que zero.');
            await asaas.atualizarAssinatura(cliente.asaas_assinatura_id, { valorCentavos: valor, descricao: descricao(preco.composicao, tabela) });
        }
        const c = await repos.clientes.atualizar(clienteId, { composicao: preco.composicao, valor_mensal_centavos: valor });
        await repos.auditoria.registrar({
            usuarioId: usuario?.id, clienteId, acao: 'composicao_alterada',
            dados: { plano: limites.resumoDaComposicao(preco.composicao, tabela), valor: valor / 100, ...(valor !== preco.total ? { preco_negociado: true } : {}) }
        });
        return c;
    }

    // Assina com a composição e o valor atuais do cliente. A primeira cobrança
    // vence no fim do teste — quem assina no 3º dia não perde os outros 11.
    async function assinar(clienteId, usuario) {
        const cliente = await repos.clientes.obter(clienteId);
        if (cliente.status === 'cancelado') throw new ErroRegra('Conta cancelada. Fale com o suporte para reativar.', 409);
        if (cliente.asaas_assinatura_id) throw new ErroRegra('A assinatura já está ativa. Para mudar o plano, altere os itens contratados.', 409);
        const valor = Number(cliente.valor_mensal_centavos) || 0;
        if (valor <= 0) throw new ErroRegra('Monte o plano (placares e recursos) antes de assinar.');
        const tabela = await repos.precos.obter();
        const clienteAsaas = await garantirClienteAsaas(cliente);
        const hoje = hojeIso();
        const fimTeste = cliente.status === 'teste' && cliente.teste_ate ? hojeIso(new Date(cliente.teste_ate)) : hoje;
        const vencimento = fimTeste > hoje ? fimTeste : hoje;
        const r = await asaas.criarAssinatura({
            clienteAsaas, valorCentavos: valor, proximoVencimento: vencimento,
            descricao: descricao(cliente.composicao, tabela), referencia: cliente.id
        });
        await repos.clientes.atualizar(clienteId, { asaas_assinatura_id: r.id, proximo_vencimento: vencimento });
        await repos.auditoria.registrar({ usuarioId: usuario?.id, clienteId, acao: 'assinatura', dados: { plano: limites.resumoDaComposicao(cliente.composicao, tabela), valor: valor / 100 } });
        const atualizado = await repos.clientes.obter(clienteId);
        await sincronizarFaturas(atualizado).catch(() => {});
        return atualizado;
    }

    async function cancelar(clienteId, usuario) {
        const cliente = await repos.clientes.obter(clienteId);
        if (cliente.asaas_assinatura_id) await asaas.cancelarAssinatura(cliente.asaas_assinatura_id);
        await repos.clientes.atualizar(clienteId, { asaas_assinatura_id: null, status: 'cancelado' });
        await repos.auditoria.registrar({ usuarioId: usuario?.id, clienteId, acao: 'cancelamento', dados: {} });
    }

    async function avisarAdmins(clienteId, assunto, texto, caminho, botao) {
        const admins = await repos.usuarios.adminsDoCliente(clienteId);
        for (const a of admins) await email.aviso(a.email, assunto, texto, caminho ? cfg.urlPublica + caminho : null, botao);
    }

    // Webhook do Asaas. Idempotente: o mesmo evento duas vezes não faz nada.
    async function processarWebhook(corpo) {
        const evento = corpo && corpo.event;
        if (!evento) return { ignorado: 'sem evento' };
        const pagamento = corpo.payment;
        const assinatura = corpo.subscription;
        const idEvento = corpo.id || `${evento}:${pagamento?.id || assinatura?.id}:${pagamento?.status || ''}`;
        if (!(await repos.faturas.registrarWebhook(idEvento, evento, corpo))) return { ignorado: 'duplicado' };

        const refCliente = pagamento?.customer || assinatura?.customer;
        let cliente = refCliente ? await repos.clientes.porAsaasCliente(refCliente) : null;
        if (!cliente && pagamento?.subscription) cliente = await repos.clientes.porAsaasAssinatura(pagamento.subscription);
        const ref = Number(pagamento?.externalReference || assinatura?.externalReference);
        if (!cliente && ref) cliente = await repos.clientes.obter(ref);
        if (!cliente) return { ignorado: 'cliente desconhecido' };

        if (pagamento) await repos.faturas.upsert(cliente.id, faturaDoPagamento(pagamento));

        if (['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'].includes(evento) || (pagamento && STATUS_PAGO.includes(pagamento.status) && evento === 'PAYMENT_UPDATED')) {
            if (cliente.status !== 'cancelado') {
                await repos.clientes.atualizar(cliente.id, { status: 'ativo', inadimplente_desde: null });
                if (cliente.status !== 'ativo') {
                    await repos.auditoria.registrar({ clienteId: cliente.id, acao: 'status_automatico', dados: { de: cliente.status, para: 'ativo', motivo: evento } });
                }
            }
        } else if (evento === 'PAYMENT_OVERDUE') {
            if (['ativo', 'teste'].includes(cliente.status)) {
                await repos.clientes.atualizar(cliente.id, { status: 'inadimplente', inadimplente_desde: new Date() });
                await repos.auditoria.registrar({ clienteId: cliente.id, acao: 'status_automatico', dados: { de: cliente.status, para: 'inadimplente', motivo: evento } });
                await avisarAdmins(cliente.id, 'Fatura do MarQGol vencida',
                    `A fatura do seu plano venceu. Pague em até ${DIAS_TOLERANCIA} dias para não ter o acesso suspenso.`,
                    '/app/#assinatura', 'Ver faturas');
            }
        } else if (['SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED'].includes(evento)) {
            if (assinatura && assinatura.id === cliente.asaas_assinatura_id) {
                await repos.clientes.atualizar(cliente.id, { asaas_assinatura_id: null });
            }
        }
        return { ok: true, clienteId: cliente.id };
    }

    // Tarefa periódica: fim do teste e inadimplência prolongada.
    async function revisarStatus(agora = new Date()) {
        const mudancas = [];
        for (const c of await repos.clientes.testesVencidos(agora)) {
            const para = c.asaas_assinatura_id ? 'inadimplente' : 'suspenso';
            await repos.clientes.atualizar(c.id, { status: para, inadimplente_desde: para === 'inadimplente' ? agora : null });
            await repos.auditoria.registrar({ clienteId: c.id, acao: 'status_automatico', dados: { de: 'teste', para, motivo: 'fim do teste' } });
            await avisarAdmins(c.id, 'Seu período de teste do MarQGol terminou',
                para === 'suspenso'
                    ? 'O período de teste terminou. Assine um plano para voltar a agendar e operar jogos — seus dados continuam guardados.'
                    : `O teste terminou e a primeira fatura está em aberto. Pague em até ${DIAS_TOLERANCIA} dias para manter o acesso.`,
                '/app/#assinatura', 'Assinar agora');
            mudancas.push({ id: c.id, para });
        }
        for (const c of await repos.clientes.inadimplentesHaMais(DIAS_TOLERANCIA, agora)) {
            await repos.clientes.atualizar(c.id, { status: 'suspenso' });
            await repos.auditoria.registrar({ clienteId: c.id, acao: 'status_automatico', dados: { de: 'inadimplente', para: 'suspenso', motivo: 'inadimplência' } });
            await avisarAdmins(c.id, 'Acesso ao MarQGol suspenso',
                'Não identificamos o pagamento da fatura. O acesso foi suspenso; seus dados continuam guardados e tudo volta assim que o pagamento for confirmado.',
                '/app/#assinatura', 'Regularizar');
            mudancas.push({ id: c.id, para: 'suspenso' });
        }
        // Lembrete 3 dias antes do fim do teste (uma vez só por cliente).
        for (const c of await repos.clientes.testesTerminandoEm(3, agora)) {
            const ja = await repos.db.um(`SELECT 1 FROM auditoria WHERE cliente_id = $1 AND acao = 'aviso_fim_teste'`, [c.id]);
            if (ja || c.asaas_assinatura_id) continue;
            await repos.auditoria.registrar({ clienteId: c.id, acao: 'aviso_fim_teste', dados: {} });
            await avisarAdmins(c.id, 'Seu teste do MarQGol termina em 3 dias',
                'Assine um plano para continuar sem interrupção. A primeira cobrança só vence no fim do teste.',
                '/app/#assinatura', 'Escolher plano');
        }
        return mudancas;
    }

    return { aplicarComposicao, assinar, cancelar, processarWebhook, revisarStatus, sincronizarFaturas, DIAS_TOLERANCIA };
}

module.exports = { criarCobranca, hojeIso, DIAS_TOLERANCIA };
