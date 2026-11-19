// Regras de limites e acessos dos planos — funções puras, sem banco.
// O servidor SEMPRE confere aqui antes de criar algo; a tela só mostra.
//
// Limite efetivo = valor do plano, sobrescrito por `clientes.limites_extra`
// (ajuste individual feito no painel de gestão).

const ESPORTES = ['futsal', 'basquete', 'volei'];

// Funcionalidades que um plano liga/desliga. Valor padrão quando o plano não
// diz nada.
const RECURSOS = {
    midia: { rotulo: 'Comerciais, slides e patrocinadores', padrao: true },
    video_jogador: { rotulo: 'Vídeo de apresentação do jogador', padrao: true },
    arte_propria: { rotulo: 'Cliente envia a própria arte do telão', padrao: false }
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
    d.setDate(d.getDate() + (Number(dias) || 14));
    return d;
}

module.exports = {
    ESPORTES,
    RECURSOS,
    CAMPOS_NUMERICOS,
    STATUS_JOGO_ABERTO,
    STATUS_OPERANTES,
    limitesEfetivos,
    verificar,
    esportePermitido,
    recursoPermitido,
    clienteOperante,
    fimDoTeste
};
