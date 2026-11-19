// Cliente HTTP do Asaas (https://docs.asaas.com). Sem estado; `fetchImpl`
// injetável nos testes. Só o que o MarQGol usa: cliente, assinatura e
// cobranças da assinatura.
//
// Autenticação: cabeçalho `access_token`. Sandbox: https://api-sandbox.asaas.com/v3
// Produção: https://api.asaas.com/v3 (ASAAS_API_URL no .env).

class ErroAsaas extends Error {
    constructor(mensagem, status, corpo) {
        super(mensagem);
        this.status = status;
        this.corpo = corpo;
    }
}

function criarAsaas(cfgAsaas, fetchImpl = globalThis.fetch) {
    const configurado = !!cfgAsaas.chave;

    async function chamar(metodo, caminho, corpo) {
        if (!configurado) throw new ErroAsaas('Pagamento online ainda não configurado (ASAAS_API_KEY).', 503);
        const resp = await fetchImpl(cfgAsaas.url + caminho, {
            method: metodo,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'MarQGol',
                access_token: cfgAsaas.chave
            },
            body: corpo ? JSON.stringify(corpo) : undefined
        });
        const texto = await resp.text();
        let dado = null;
        try { dado = texto ? JSON.parse(texto) : null; } catch { dado = { bruto: texto }; }
        if (!resp.ok) {
            const msg = dado && Array.isArray(dado.errors) && dado.errors.length
                ? dado.errors.map(e => e.description).join(' ')
                : `Asaas respondeu ${resp.status}`;
            throw new ErroAsaas(msg, resp.status, dado);
        }
        return dado;
    }

    return {
        configurado,
        criarCliente: ({ nome, documento, email, telefone, referencia }) => chamar('POST', '/customers', {
            name: nome, cpfCnpj: documento, email, mobilePhone: telefone || undefined,
            externalReference: String(referencia), notificationDisabled: false
        }),
        atualizarCliente: (id, { nome, documento, email }) => chamar('PUT', `/customers/${id}`, {
            name: nome, cpfCnpj: documento, email
        }),
        // billingType UNDEFINED: quem paga escolhe Pix, boleto ou cartão na fatura.
        criarAssinatura: ({ clienteAsaas, valorCentavos, proximoVencimento, descricao, referencia }) => chamar('POST', '/subscriptions', {
            customer: clienteAsaas, billingType: 'UNDEFINED', value: valorCentavos / 100,
            nextDueDate: proximoVencimento, cycle: 'MONTHLY', description: descricao,
            externalReference: String(referencia)
        }),
        atualizarAssinatura: (id, { valorCentavos, descricao }) => chamar('PUT', `/subscriptions/${id}`, {
            value: valorCentavos / 100, description: descricao, updatePendingPayments: true
        }),
        cancelarAssinatura: (id) => chamar('DELETE', `/subscriptions/${id}`),
        cobrancasDaAssinatura: (id) => chamar('GET', `/subscriptions/${id}/payments?limit=20`)
    };
}

// Status de cobrança do Asaas → rótulo curto usado no MarQGol.
const STATUS_PAGO = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];

function faturaDoPagamento(p) {
    return {
        asaas_id: p.id,
        valor_centavos: Math.round(Number(p.value || 0) * 100),
        vencimento: p.dueDate || null,
        status: p.status || 'PENDING',
        forma: p.billingType || '',
        link: p.invoiceUrl || '',
        pago_em: STATUS_PAGO.includes(p.status) ? (p.clientPaymentDate || p.paymentDate || new Date().toISOString().slice(0, 10)) : null
    };
}

module.exports = { criarAsaas, ErroAsaas, faturaDoPagamento, STATUS_PAGO };
