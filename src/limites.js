// Regras de limites e acessos dos planos — funções puras, sem banco.
// O servidor SEMPRE confere aqui antes de criar algo; a tela só mostra.
//
// Limite efetivo = o que a composição contratada dá (limitesDaComposicao),
// sobrescrito por `clientes.limites_extra` (ajuste individual do painel).

const ESPORTES = ['futsal', 'basquete', 'volei'];

// Recursos especiais: cada um é contratado à parte (valor fixo por conta, ver
// tabela_precos). `padrao` só vale para limitesEfetivos() chamado sem recursos.
const RECURSOS = {
    midia: { rotulo: 'Comerciais, slides e patrocinadores', padrao: true },
    video_jogador: { rotulo: 'Vídeo de apresentação do atleta', padrao: true },
    arte_propria: { rotulo: 'Arte própria do telão', padrao: false }
};

const CAMPOS_NUMERICOS = ['max_placares', 'max_jogos_abertos', 'max_usuarios', 'max_armazenamento_mb'];

// Jogos que ocupam vaga do limite: ainda não aconteceram ou estão em andamento.
const STATUS_JOGO_ABERTO = ['agendado', 'ao_vivo'];

// Status em que o cliente opera normalmente (inadimplente ainda opera, com
// aviso, até a suspensão automática).
const STATUS_OPERANTES = ['teste', 'ativo', 'inadimplente'];

function limitesEfetivos(plano, extra = {}) {
    const p = plano || {};
    const e = extra || {};
    const lim = {};
    for (const campo of CAMPOS_NUMERICOS) {
        const valorExtra = e[campo];
        lim[campo] = Number.isFinite(Number(valorExtra)) && valorExtra !== null && valorExtra !== ''
            ? Number(valorExtra)
            : Number(p[campo] || 0);
    }
    const esportes = Array.isArray(e.esportes) && e.esportes.length ? e.esportes : (p.esportes || ESPORTES);
    lim.esportes = esportes.filter(x => ESPORTES.includes(x));
    lim.recursos = {};
    for (const [nome, def] of Object.entries(RECURSOS)) {
        const doExtra = e.recursos && typeof e.recursos[nome] === 'boolean' ? e.recursos[nome] : undefined;
        const doPlano = p.recursos && typeof p.recursos[nome] === 'boolean' ? p.recursos[nome] : undefined;
        lim.recursos[nome] = doExtra ?? doPlano ?? def.padrao;
    }
    return lim;
}

const MENSAGENS = {
    max_placares: (l) => `Seu plano permite ${l} placar${l === 1 ? '' : 'es'} ativo${l === 1 ? '' : 's'}.`,
    max_jogos_abertos: (l) => `Seu plano permite ${l} jogo${l === 1 ? '' : 's'} em aberto (agendados ou ao vivo). Encerre ou cancele um jogo para liberar vaga.`,
    max_usuarios: (l) => `Seu plano permite ${l} usuário${l === 1 ? '' : 's'}.`,
    max_armazenamento_mb: (l) => `Seu plano permite ${l} MB de arquivos.`
};

// `uso` = quanto já está ocupado; `acrescimo` = quanto a operação quer somar.
// Devolve { ok, limite, uso, mensagem }.
function verificar(campo, uso, limites, acrescimo = 1) {
    const limite = limites[campo];
    const ok = uso + acrescimo <= limite;
    return { ok, limite, uso, mensagem: ok ? '' : MENSAGENS[campo](limite) };
}

function esportePermitido(esporte, limites) {
    return limites.esportes.includes(esporte);
}

function recursoPermitido(recurso, limites) {
    return !!(limites.recursos && limites.recursos[recurso]);
}

function clienteOperante(cliente) {
    return !!cliente && STATUS_OPERANTES.includes(cliente.status);
}

// Data em que o teste termina, a partir do cadastro.
function fimDoTeste(inicio, dias) {
    const d = new Date(inicio);
    const n = Number(dias);
    d.setDate(d.getDate() + (dias !== null && dias !== undefined && dias !== '' && Number.isFinite(n) ? n : 14));
    return d;
}

// ---------------- Plano on demand ----------------
// O cliente monta o plano: `composicao` = { placares, pacotes_usuarios_extras,
// recursos: { midia, video_jogador, arte_propria } }. A `tabela` (tabela_precos)
// diz o preço de cada peça e as cotas por placar.

// Limpa o que veio de fora (tela, API). `teto` limita o autoatendimento;
// o painel passa teto = null (sem limite de venda).
function normalizarComposicao(c, tabela, { teto = true } = {}) {
    const x = c && typeof c === 'object' ? c : {};
    const inteiro = (v, min) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(n, min) : min; };
    let placares = inteiro(x.placares, 1);
    let pacotes = inteiro(x.pacotes_usuarios_extras, 0);
    if (teto && tabela) {
        placares = Math.min(placares, tabela.max_placares_autoatendimento);
        pacotes = Math.min(pacotes, tabela.max_pacotes_autoatendimento);
    }
    const recursos = {};
    for (const k of Object.keys(RECURSOS)) recursos[k] = !!(x.recursos && x.recursos[k]);
    return { placares, pacotes_usuarios_extras: pacotes, recursos };
}

// Limites "do plano" para limitesEfetivos(): o ajuste individual
// (limites_extra) continua por cima.
function limitesDaComposicao(c, tabela) {
    const comp = normalizarComposicao(c, tabela, { teto: false });
    return {
        max_placares: comp.placares,
        max_jogos_abertos: comp.placares * tabela.jogos_por_placar,
        max_usuarios: (1 + comp.pacotes_usuarios_extras) * tabela.usuarios_por_pacote,
        max_armazenamento_mb: comp.placares * tabela.armazenamento_mb_por_placar,
        esportes: ESPORTES,
        recursos: comp.recursos
    };
}

// Preço mensal com o detalhamento (para mostrar e para a descrição no Asaas).
function precoDaComposicao(c, tabela) {
    const comp = normalizarComposicao(c, tabela, { teto: false });
    const itens = [{
        chave: 'placares', rotulo: `${comp.placares} placar${comp.placares === 1 ? '' : 'es'}`,
        quantidade: comp.placares, unitario: tabela.preco_placar_centavos, subtotal: comp.placares * tabela.preco_placar_centavos
    }];
    if (comp.pacotes_usuarios_extras) {
        const n = comp.pacotes_usuarios_extras;
        itens.push({
            chave: 'usuarios', rotulo: `${n} pacote${n === 1 ? '' : 's'} extra${n === 1 ? '' : 's'} de ${tabela.usuarios_por_pacote} usuários`,
            quantidade: n, unitario: tabela.preco_pacote_usuarios_centavos, subtotal: n * tabela.preco_pacote_usuarios_centavos
        });
    }
    for (const [k, def] of Object.entries(RECURSOS)) {
        if (!comp.recursos[k]) continue;
        const v = Number((tabela.precos_recursos || {})[k]) || 0;
        itens.push({ chave: k, rotulo: def.rotulo, quantidade: 1, unitario: v, subtotal: v });
    }
    return { composicao: comp, itens, total: itens.reduce((s, i) => s + i.subtotal, 0) };
}

// Uma linha curta: "2 placares · 20 usuários · mídia, arte própria".
function resumoDaComposicao(c, tabela) {
    const comp = normalizarComposicao(c, tabela, { teto: false });
    const curtos = { midia: 'mídia', video_jogador: 'vídeo do atleta', arte_propria: 'arte própria' };
    const rec = Object.keys(curtos).filter(k => comp.recursos[k]).map(k => curtos[k]);
    const usuarios = (1 + comp.pacotes_usuarios_extras) * (tabela ? tabela.usuarios_por_pacote : 10);
    return [`${comp.placares} placar${comp.placares === 1 ? '' : 'es'}`, `${usuarios} usuários`, ...(rec.length ? [rec.join(', ')] : [])].join(' · ');
}

module.exports = {
    ESPORTES,
    RECURSOS,
    CAMPOS_NUMERICOS,
    normalizarComposicao,
    limitesDaComposicao,
    precoDaComposicao,
    resumoDaComposicao,
    STATUS_JOGO_ABERTO,
    STATUS_OPERANTES,
    limitesEfetivos,
    verificar,
    esportePermitido,
    recursoPermitido,
    clienteOperante,
    fimDoTeste
};
