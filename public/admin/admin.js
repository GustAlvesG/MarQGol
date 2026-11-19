// Painel de gestão do MarQGol (dono do SaaS). Single page sem framework: a
// aba atual vive no hash e cada tela é uma função que desenha `#conteudo`.
//
//   #visao                 indicadores gerais + revisão de status
//   #clientes[?status=x]   lista com busca e filtro; "Novo cliente"
//   #cliente/<id>          detalhe: dados, plano, status, limites, arte...
//   #precos                tabela de preços do plano on demand
//   #equipe                superadmins
//   #auditoria[?cliente=x] trilha de auditoria
//
// Toda chamada usa MARQ.api (cabeçalho X-MarQ). Todo texto vindo da API passa
// por esc() antes de ir para o HTML.
(function () {
    'use strict';

    const conteudo = document.getElementById('conteudo');
    const api = (metodo, url, corpo) => MARQ.api(metodo, url, corpo);

    // ---------------------------------------------------------------- textos
    const STATUS = ['teste', 'ativo', 'inadimplente', 'suspenso', 'cancelado'];
    const ROTULO_STATUS = { teste: 'Em teste', ativo: 'Ativo', inadimplente: 'Inadimplente', suspenso: 'Suspenso', cancelado: 'Cancelado' };
    const CLASSE_STATUS = { teste: 'info', ativo: 'ok', inadimplente: 'alerta', suspenso: 'perigo', cancelado: 'perigo' };
    const EFEITO_STATUS = {
        teste: 'O cliente opera normalmente até a data de fim do teste. Quando a data passar, a revisão automática suspende (ou marca inadimplente, se houver assinatura). Confira a data de fim do teste.',
        ativo: 'O cliente opera normalmente, sem avisos de cobrança.',
        inadimplente: 'O cliente continua operando, com aviso de pagamento pendente. Se continuar inadimplente por 7 dias, a revisão automática suspende o acesso.',
        suspenso: 'Bloqueia agendar e iniciar novos jogos. Um jogo que esteja ao vivo agora NÃO é derrubado — termina normalmente. Os dados continuam guardados e tudo volta ao reativar.',
        cancelado: 'Encerra o contrato: bloqueia novos jogos (um jogo ao vivo agora não é derrubado). Os dados continuam guardados até a exclusão. Se houver assinatura no Asaas, cancele-a lá também.'
    };
    const ESPORTES = { futsal: 'Futsal', basquete: 'Basquete', volei: 'Vôlei' };
    const CAMPOS = [
        ['max_placares', 'Placares ativos'],
        ['max_jogos_abertos', 'Jogos em aberto'],
        ['max_usuarios', 'Usuários'],
        ['max_armazenamento_mb', 'Armazenamento (MB)']
    ];
    const STATUS_FATURA = {
        PENDING: ['Em aberto', 'info'], RECEIVED: ['Paga', 'ok'], CONFIRMED: ['Paga', 'ok'], RECEIVED_IN_CASH: ['Paga', 'ok'],
        OVERDUE: ['Vencida', 'alerta'], REFUNDED: ['Estornada', 'perigo']
    };
    const FORMA_PAGTO = { BOLETO: 'Boleto', PIX: 'Pix', CREDIT_CARD: 'Cartão', UNDEFINED: 'A escolher' };
    const ACOES = {
        cliente_criado: 'Cliente criado', cliente_alterado: 'Cliente alterado', cliente_excluido: 'Cliente excluído',
        entrar_como: 'Entrou como cliente', acesso_reenviado: 'Acesso reenviado', plano_criado: 'Plano criado',
        plano_alterado: 'Plano alterado', composicao_alterada: 'Plano alterado', precos_alterados: 'Tabela de preços alterada',
        arte_alterada: 'Arte alterada', status_automatico: 'Status automático',
        aviso_fim_teste: 'Aviso de fim do teste', cadastro: 'Cadastro pelo site', assinatura: 'Assinatura',
        cancelamento: 'Cancelamento', tela_pareada: 'Tela pareada', zerar_tudo: 'Placar zerado',
        conta_alterada: 'Conta alterada', placar_criado: 'Placar criado', placar_alterado: 'Placar alterado',
        placar_excluido: 'Placar excluído', usuario_convidado: 'Usuário convidado', usuario_alterado: 'Usuário alterado',
        usuario_removido: 'Usuário removido', usuario_criado: 'Usuário criado com senha',
        superadmin_criado: 'Superadmin criado', superadmin_alterado: 'Superadmin alterado', superadmin_removido: 'Superadmin removido'
    };
    const NOME_CAMPO = {
        nome: 'nome', email: 'e-mail', telefone: 'telefone', documento: 'documento', plano_id: 'plano', status: 'status',
        composicao: 'plano', valor_mensal_centavos: 'valor mensal',
        teste_ate: 'fim do teste', limites_extra: 'limites', observacoes: 'observações', inadimplente_desde: 'inadimplência'
    };
    const NOME_SLOT = {
        background: 'Fundo do telão', espera: 'Vídeo de espera', box: 'Caixa do placar',
        'element-1': 'Elemento 1', 'element-2': 'Elemento 2', 'element-3': 'Elemento 3',
        'element-4-on': 'Elemento 4 (aceso)', 'element-4-off': 'Elemento 4 (apagado)'
    };
    const GRUPO_SLOT = { '': 'Geral', futsal: 'Futsal', basquete: 'Basquete', volei: 'Vôlei' };

    // ---------------------------------------------------------------- utilidades
    const tagStatus = (s) => `<span class="tag ${CLASSE_STATUS[s] || ''}">${esc(ROTULO_STATUS[s] || s)}</span>`;
    const carregando = (txt = 'Carregando…') => `<div class="carregando">${esc(txt)}</div>`;
    const erroHtml = (e) => `<div class="erro-caixa" role="alert">${ic('alert')}<div><b>Não foi possível carregar.</b><br>${esc(e && e.message || e)}</div></div>`;
    const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

    // Datas "só dia" (vencimento de fatura) vêm como 'AAAA-MM-DD': não passam
    // por Date, senão viram o dia anterior no fuso de Brasília.
    function dataCurta(v) {
        if (!v) return '—';
        const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : MARQ.data(v);
    }
    function diasAte(iso) {
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        const d = new Date(iso); d.setHours(0, 0, 0, 0);
        return Math.round((d - hoje) / 86400000);
    }
    function relativo(iso) {
        if (!iso) return '<span class="fraco">Nunca</span>';
        const n = -diasAte(iso);
        if (n <= 0) return 'Hoje';
        if (n === 1) return 'Ontem';
        if (n < 30) return `Há ${n} dias`;
        return MARQ.data(iso);
    }
    // <input type="date"> trabalha no dia local.
    function paraInputData(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
    // Fim do teste vale até o fim do dia escolhido (hora local).
    function deInputData(v) {
        if (!v) return null;
        const [a, m, d] = v.split('-').map(Number);
        return new Date(a, m - 1, d, 23, 59, 59).toISOString();
    }
    function somarDias(base, dias) { const d = new Date(base); d.setDate(d.getDate() + dias); return d; }
    function fmtDocumento(d) {
        d = String(d || '').replace(/\D/g, '');
        if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
        if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
        return d;
    }
    function lerPreco(txt) {
        let s = String(txt || '').replace(/[^\d.,]/g, '');
        if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
        const n = Number(s);
        return s && Number.isFinite(n) ? Math.round(n * 100) : NaN;
    }
    const precoParaCampo = (c) => (Number(c || 0) / 100).toFixed(2).replace('.', ',');

    function fimDoTesteHtml(c) {
        if (!c.teste_ate) return '<span class="fraco">—</span>';
        const data = MARQ.data(c.teste_ate);
        if (c.status !== 'teste') return `<span class="fraco">${data}</span>`;
        const n = diasAte(c.teste_ate);
        const nota = n < 0 ? '<span class="tag perigo">vencido</span>' : n <= 3 ? `<span class="tag alerta">${n === 0 ? 'hoje' : n + 'd'}</span>` : `<span class="fraco">${n}d</span>`;
        return `${data} ${nota}`;
    }

    function resumirDados(d) {
        if (!d || typeof d !== 'object') return '';
        const partes = [];
        if (d.de && d.para) partes.push(`${ROTULO_STATUS[d.de] || d.de} → ${ROTULO_STATUS[d.para] || d.para}`);
        for (const [k, v] of Object.entries(d)) {
            if (k === 'de' || k === 'para') continue;
            if (k === 'campos' && Array.isArray(v)) { if (v.length) partes.push('alterou: ' + v.map(x => NOME_CAMPO[x] || x).join(', ')); continue; }
            // `valor` (plano on demand) vem em reais na auditoria.
            if (k === 'valor' && Number.isFinite(Number(v))) { partes.push(`${MARQ.dinheiro(Math.round(Number(v) * 100))}/mês`); continue; }
            if (k === 'preco_negociado') { if (v) partes.push('preço negociado'); continue; }
            const val = Array.isArray(v) ? v.join(', ') : (v && typeof v === 'object') ? JSON.stringify(v) : String(v);
            partes.push(`${k}: ${val}`);
        }
        return esc(partes.join(' · ').slice(0, 300));
    }

    function tabelaAuditoria(linhas, { comCliente = true } = {}) {
        if (!linhas.length) return '<div class="vazio">Nenhum registro.</div>';
        return `<table class="tabela"><thead><tr><th>Quando</th><th>Quem</th>${comCliente ? '<th>Cliente</th>' : ''}<th>Ação</th><th>Dados</th></tr></thead><tbody>
            ${linhas.map(a => `<tr>
                <td class="nw">${esc(MARQ.dataHora(a.criado_em))}</td>
                <td class="princ">${a.usuario_id ? `<b>${esc(a.usuario_nome || '—')}</b><span>${esc(a.usuario_email || '')}</span>` : '<span class="fraco">Sistema</span>'}</td>
                ${comCliente ? `<td>${a.cliente_id ? `<a class="link" href="#cliente/${Number(a.cliente_id)}">${esc(a.cliente_nome || '#' + a.cliente_id)}</a>` : '<span class="fraco">—</span>'}</td>` : ''}
                <td class="nw">${esc(ACOES[a.acao] || String(a.acao || '').replace(/_/g, ' '))}</td>
                <td class="dados">${resumirDados(a.dados)}${a.ip ? `<br><span class="fraco">IP ${esc(a.ip)}</span>` : ''}</td>
            </tr>`).join('')}</tbody></table>`;
    }

    // Folha (diálogo) com formulário. `aoEnviar(form)` pode lançar: a mensagem
    // aparece dentro da folha e ela continua aberta (não perde o que foi digitado).
    // Devolver MANTER_ABERTA também mantém a folha (ex.: confirmação recusada).
    const MANTER_ABERTA = Symbol('manter');
    function abrirFolha({ titulo, corpo, sim = 'Salvar', larga = false, perigo = false, aoAbrir, aoEnviar }) {
        return new Promise((resolve) => {
            const veu = document.createElement('div');
            veu.className = 'veu';
            veu.innerHTML = `<div class="folha ${larga ? 'larga' : ''}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}"><form novalidate>
                <div class="folha-cab"><h2>${esc(titulo)}</h2></div>
                <div class="folha-corpo">${corpo}<div class="erro-form" role="alert" hidden></div></div>
                <div class="folha-pe">
                    <button type="button" class="btn grande" data-cancelar>Cancelar</button>
                    <button type="submit" class="btn grande ${perigo ? 'perigo' : 'ok'}">${ic('check')} ${esc(sim)}</button>
                </div></form></div>`;
            const form = veu.querySelector('form');
            const erro = veu.querySelector('.erro-form');
            const btn = veu.querySelector('[type="submit"]');
            const fechar = (v) => { veu.remove(); document.removeEventListener('keydown', tecla); resolve(v); };
            const tecla = (ev) => { if (ev.key === 'Escape' && !document.querySelector('.veu + .veu, [role="alertdialog"]')) fechar(null); };
            veu.querySelector('[data-cancelar]').addEventListener('click', () => fechar(null));
            form.addEventListener('submit', async (ev) => {
                ev.preventDefault();
                erro.hidden = true; btn.disabled = true;
                try {
                    const r = await aoEnviar(form);
                    if (r === MANTER_ABERTA) { btn.disabled = false; return; }
                    fechar(r === undefined ? true : r);
                }
                catch (e) { erro.textContent = e.message; erro.hidden = false; erro.scrollIntoView({ block: 'nearest' }); btn.disabled = false; }
            });
            document.addEventListener('keydown', tecla);
            document.body.appendChild(veu);
            if (aoAbrir) aoAbrir(form);
            form.querySelector('input:not([type=hidden]), select, textarea')?.focus();
        });
    }

    // ---------------------------------------------------------------- senhas
    // Sem SMTP, quem cadastra define a senha e a passa para a pessoa (WhatsApp,
    // pessoalmente). O campo é visível de propósito, com um gerador legível.
    const gerarSenha = () => MARQ.gerarSenha();
    const campoSenha = (nome = 'senha', rotulo = 'Senha') => `<label class="inteiro"><span class="rotulo">${esc(rotulo)}</span>
        <div class="senha-linha"><input class="campo" name="${nome}" autocomplete="off" minlength="8" spellcheck="false" placeholder="Mínimo de 8 caracteres">
        <button type="button" class="btn" data-gerar="${nome}">${ic('refresh')} Gerar</button></div>
        <span class="ajuda">Anote e passe para a pessoa. Ela pode trocar depois em “Minha conta”.</span></label>`;
    function ligarGerador(f) {
        f.querySelectorAll('[data-gerar]').forEach(b => b.addEventListener('click', () => {
            const campo = f.elements[b.dataset.gerar];
            campo.value = gerarSenha();
            campo.focus(); campo.select();
        }));
    }
    // Bloco "acesso": senha agora (padrão sem SMTP) ou convite por e-mail.
    function blocoAcesso(nomeSenha = 'senha') {
        const porEmail = !!(EU && EU.emailAtivo);
        return `<div class="inteiro"><span class="rotulo">Acesso</span><div class="segmentos" role="radiogroup">
                <label class="segmento"><input type="radio" name="acesso" value="senha" ${porEmail ? '' : 'checked'}>Definir senha agora<small>Sem e-mail; você passa a senha</small></label>
                <label class="segmento"><input type="radio" name="acesso" value="convite" ${porEmail ? 'checked' : ''}>Convite por e-mail<small>${porEmail ? 'A pessoa cria a senha' : 'SMTP não configurado'}</small></label>
            </div></div>
            <div class="inteiro" data-bloco-senha>${campoSenha(nomeSenha, 'Senha inicial')}</div>`;
    }
    function ligarAcesso(f) {
        ligarGerador(f);
        const atualizar = () => {
            const comSenha = f.querySelector('input[name=acesso]:checked').value === 'senha';
            f.querySelector('[data-bloco-senha]').hidden = !comSenha;
        };
        f.querySelectorAll('input[name=acesso]').forEach(r => r.addEventListener('change', atualizar));
        atualizar();
        const senha = f.querySelector('[data-bloco-senha] input');
        if (!senha.value) senha.value = gerarSenha();
    }
    const usaSenha = (f) => f.querySelector('input[name=acesso]:checked').value === 'senha';
    function lerSenha(f, nome = 'senha') {
        const v = f.elements[nome].value.trim();
        if (v.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
        return v;
    }
    // Folha "definir senha" para um usuário existente.
    async function folhaSenha(nome, url, extra = {}) {
        const r = await abrirFolha({
            titulo: `Nova senha — ${nome}`, sim: 'Definir senha',
            corpo: `<p>As sessões abertas dessa pessoa são encerradas; ela entra de novo com a senha nova.</p><div class="grade-form">${campoSenha('senha', 'Nova senha')}</div>`,
            aoAbrir: (f) => { ligarGerador(f); f.senha.value = gerarSenha(); },
            aoEnviar: async (f) => { const senha = lerSenha(f); await api('PATCH', url, { ...extra, senha }); return { senha }; }
        });
        if (r && r.senha) await avisar('Senha definida', `Nova senha de ${nome}:\n${r.senha}\n\nPasse para a pessoa por um canal seguro.`);
        return r;
    }

    // Executa uma ação de botão com estado "ocupado" e toast de erro.
    async function comBotao(btn, fn) {
        if (btn) btn.disabled = true;
        try { return await fn(); }
        catch (e) { avisar('Não deu certo', e.message); return undefined; }
        finally { if (btn && btn.isConnected) btn.disabled = false; }
    }

    // ---------------------------------------------------------------- roteador
    let geracao = 0;            // descarta respostas de telas já abandonadas
    const filtroClientes = { busca: '', status: '' };
    let filtroAuditoria = '';
    let EU = null;              // /api/auth/eu (emailAtivo decide convite x senha)

    // Tabela de preços do plano on demand: { precos, recursos, clientes }.
    const carregarPrecos = () => api('GET', '/api/admin/precos');

    // Limites "do plano" que a composição dá (espelha limitesDaComposicao em
    // src/limites.js). Só para mostrar ao lado do ajuste individual.
    function limitesDaComposicao(comp, precos) {
        const c = MONTADOR.normalizar(comp, precos, false);
        return {
            max_placares: c.placares,
            max_jogos_abertos: c.placares * precos.jogos_por_placar,
            max_usuarios: (1 + c.pacotes_usuarios_extras) * precos.usuarios_por_pacote,
            max_armazenamento_mb: c.placares * precos.armazenamento_mb_por_placar,
            esportes: Object.keys(ESPORTES),
            recursos: c.recursos
        };
    }

    // Campo "Valor negociado (R$/mês)": vazio = preço de tabela (null).
    function lerValorNegociado(campo) {
        const v = campo.value.trim();
        if (!v) return null;
        const n = lerPreco(v);
        if (!Number.isFinite(n) || n < 0) throw new Error('Valor negociado inválido. Use, por exemplo, 149,90 — ou deixe vazio para usar o preço de tabela.');
        return n;
    }

    function lerHash() {
        const h = location.hash.replace(/^#/, '') || 'visao';
        const [caminho, qs] = h.split('?');
        const partes = caminho.split('/');
        return { tela: partes[0], arg: partes[1], q: new URLSearchParams(qs || '') };
    }

    function marcarAba(tela) {
        const aba = tela === 'cliente' ? 'clientes' : tela;
        document.querySelectorAll('.adm-topo .aba').forEach(a => {
            if (a.dataset.aba === aba) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        });
    }

    async function rotear() {
        const { tela, arg, q } = lerHash();
        const g = ++geracao;
        const vivo = () => g === geracao;
        marcarAba(tela);
        window.scrollTo(0, 0);
        try {
            if (tela === 'clientes') {
                if (q.has('status')) filtroClientes.status = q.get('status');
                await telaClientes(vivo);
            } else if (tela === 'cliente' && Number(arg)) await telaCliente(Number(arg), vivo);
            else if (tela === 'precos') await telaPrecos(vivo);
            else if (tela === 'equipe') await telaEquipe(vivo);
            else if (tela === 'auditoria') {
                if (q.has('cliente')) filtroAuditoria = q.get('cliente');
                await telaAuditoria(vivo);
            } else await telaVisao(vivo);
        } catch (e) {
            if (vivo()) conteudo.innerHTML = erroHtml(e);
        }
    }

    // ================================================================ VISÃO GERAL
    async function telaVisao(vivo) {
        document.title = 'Visão geral — MarQGol';
        conteudo.innerHTML = `<div class="secao-cab"><div><h1>Visão geral</h1><p>Como está a base de clientes agora.</p></div></div>${carregando()}`;
        const ind = await api('GET', '/api/admin/indicadores');
        if (!vivo()) return;
        const kpi = (rot, icone, val, { classe = '', det = '', href = '' } = {}) => {
            const tag = href ? 'a' : 'div';
            return `<${tag} class="kpi ${classe}" ${href ? `href="${href}"` : ''}><span class="rot">${ic(icone)} ${esc(rot)}</span><span class="val">${esc(val)}</span>${det ? `<span class="det">${esc(det)}</span>` : ''}</${tag}>`;
        };
        conteudo.innerHTML = `
            <div class="secao-cab"><div><h1>Visão geral</h1><p>Como está a base de clientes agora.</p></div>
                <button type="button" class="btn" id="btn-atualizar">${ic('refresh')} Atualizar</button></div>
            <div class="kpis">
                ${kpi('Receita mensal (MRR)', 'card', MARQ.dinheiro(ind.receita_mensal_centavos), { classe: 'destaque', det: 'Soma do valor mensal contratado dos clientes ativos e inadimplentes' })}
                ${kpi('Jogos ao vivo', 'tv', ind.jogos_ao_vivo, { classe: ind.jogos_ao_vivo ? 'ok' : '', det: 'Agora, em todos os clientes' })}
                ${kpi('Jogos em 30 dias', 'calendar', ind.jogos_30_dias, { det: 'Encerrados nos últimos 30 dias' })}
            </div>
            <div class="kpis cinco">
                ${kpi('Clientes', 'users', ind.total, { href: '#clientes?status=', det: 'Total cadastrado' })}
                ${kpi('Em teste', 'info', ind.em_teste, { classe: 'info', href: '#clientes?status=teste' })}
                ${kpi('Ativos', 'check', ind.ativos, { classe: 'ok', href: '#clientes?status=ativo' })}
                ${kpi('Inadimplentes', 'alert', ind.inadimplentes, { classe: ind.inadimplentes ? 'alerta' : '', href: '#clientes?status=inadimplente' })}
                ${kpi('Inativos', 'lock', ind.inativos, { classe: ind.inativos ? 'perigo' : '', href: '#clientes?status=suspenso', det: 'Suspensos e cancelados' })}
            </div>
            <section class="cartao">
                <div class="cartao-cab"><div><h2>${ic('shield')} Revisão de status</h2>
                    <p>Roda agora a mesma revisão automática: testes vencidos viram suspensos (ou inadimplentes, se houver assinatura) e inadimplentes há mais de 7 dias são suspensos. Também envia o lembrete de fim de teste.</p></div>
                    <button type="button" class="btn claro" id="btn-revisar">${ic('refresh')} Revisar status agora</button></div>
                <div id="revisao" hidden></div>
            </section>`;
        conteudo.querySelector('#btn-atualizar').addEventListener('click', () => rotear());
        conteudo.querySelector('#btn-revisar').addEventListener('click', async (ev) => {
            const caixa = conteudo.querySelector('#revisao');
            await comBotao(ev.currentTarget, async () => {
                const mudancas = await api('POST', '/api/admin/revisar-status');
                caixa.hidden = false;
                if (!mudancas || !mudancas.length) {
                    caixa.innerHTML = `<div class="aviso-caixa ok">${ic('check')}<div>Nenhuma mudança: todos os status já estão em dia.</div></div>`;
                    return;
                }
                const nomes = Object.fromEntries((await api('GET', '/api/admin/clientes')).map(c => [c.id, c.nome]));
                caixa.innerHTML = `<div class="aviso-caixa">${ic('alert')}<div><b>${plural(mudancas.length, 'cliente mudou', 'clientes mudaram')} de status:</b></div></div>
                    <div class="lista mudancas">${mudancas.map(m => `<a class="item" href="#cliente/${Number(m.id)}" style="text-decoration:none;color:inherit">
                        <div class="txt"><b>${esc(nomes[m.id] || 'Cliente #' + m.id)}</b></div>${tagStatus(m.para)}</a>`).join('')}</div>`;
                if (vivo()) toast('Revisão concluída');
            });
        });
    }

    // ================================================================ CLIENTES
    async function telaClientes(vivo) {
        document.title = 'Clientes — MarQGol';
        conteudo.innerHTML = `
            <div class="secao-cab"><div><h1>Clientes</h1><p>Clique em um cliente para ver detalhes, limites e cobrança.</p></div>
                <button type="button" class="btn ok" id="btn-novo">${ic('plus')} Novo cliente</button></div>
            <div class="filtros">
                <label class="busca">${ic('search')}<input class="campo" type="search" id="f-busca" placeholder="Buscar por nome, e-mail ou documento" aria-label="Buscar clientes" value="${esc(filtroClientes.busca)}"></label>
                <select class="campo" id="f-status" aria-label="Filtrar por status">
                    <option value="">Todos os status</option>
                    ${STATUS.map(s => `<option value="${s}" ${filtroClientes.status === s ? 'selected' : ''}>${ROTULO_STATUS[s]}</option>`).join('')}
                </select>
            </div>
            <div class="tabela-caixa" id="tabela-clientes">${carregando()}</div>`;
        conteudo.querySelector('#btn-novo').addEventListener('click', novoCliente);
        let espera = null;
        conteudo.querySelector('#f-busca').addEventListener('input', (ev) => {
            filtroClientes.busca = ev.target.value;
            clearTimeout(espera);
            espera = setTimeout(() => carregarTabelaClientes(vivo), 300);
        });
        conteudo.querySelector('#f-status').addEventListener('change', (ev) => {
            filtroClientes.status = ev.target.value;
            carregarTabelaClientes(vivo);
        });
        const tabela = conteudo.querySelector('#tabela-clientes');
        const abrir = (tr) => { if (tr) location.hash = '#cliente/' + tr.dataset.id; };
        tabela.addEventListener('click', (ev) => abrir(ev.target.closest('tr[data-id]')));
        tabela.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') abrir(ev.target.closest('tr[data-id]')); });
        await carregarTabelaClientes(vivo);
    }

    let pedidoTabela = 0;
    async function carregarTabelaClientes(vivo) {
        const caixa = conteudo.querySelector('#tabela-clientes');
        if (!caixa) return;
        const n = ++pedidoTabela;
        const qs = new URLSearchParams({ busca: filtroClientes.busca.trim(), status: filtroClientes.status });
        let lista;
        try { lista = await api('GET', '/api/admin/clientes?' + qs); }
        catch (e) { if (vivo() && n === pedidoTabela) caixa.innerHTML = erroHtml(e); return; }
        if (!vivo() || n !== pedidoTabela) return;
        if (!lista.length) {
            const filtrando = filtroClientes.busca.trim() || filtroClientes.status;
            caixa.innerHTML = `<div class="vazio">${filtrando ? 'Nenhum cliente encontrado com esses filtros.' : 'Nenhum cliente ainda. Use “Novo cliente” para cadastrar uma venda.'}</div>`;
            return;
        }
        caixa.innerHTML = `<table class="tabela"><thead><tr>
                <th>Cliente</th><th>Status</th><th>Plano</th><th class="num">Mensal</th><th>Uso</th><th>Fim do teste</th><th>Último acesso</th>
            </tr></thead><tbody>${lista.map(c => `<tr class="clicavel" data-id="${Number(c.id)}" tabindex="0">
                <td class="princ"><b>${esc(c.nome)}</b><span>${esc(c.email)}</span></td>
                <td>${tagStatus(c.status)}</td>
                <td class="plano-resumo">${esc(c.plano_resumo || '—')}${c.tem_limites_extra ? ` <span class="ic-extra" title="Tem limites individuais">${ic('star')}</span>` : ''}</td>
                <td class="num">${c.valor_mensal_centavos == null ? '<span class="fraco">—</span>' : esc(MARQ.dinheiro(c.valor_mensal_centavos))}</td>
                <td><span class="uso-mini">
                    <span title="Placares ativos">${ic('tv')}<b>${Number(c.uso.placares)}</b></span>
                    <span title="Jogos em aberto (agendados ou ao vivo)">${ic('calendar')}<b>${Number(c.uso.jogos_abertos)}</b></span>
                    <span title="Usuários">${ic('users')}<b>${Number(c.uso.usuarios)}</b></span></span></td>
                <td class="nw">${fimDoTesteHtml(c)}</td>
                <td class="nw" title="${esc(MARQ.dataHora(c.ultimo_acesso_em))}">${relativo(c.ultimo_acesso_em)}</td>
            </tr>`).join('')}</tbody></table>`;
    }

    // Bloco do plano on demand nas folhas (novo cliente, alterar plano):
    // montador sem o teto do autoatendimento + valor negociado opcional.
    const blocoPlano = () => `
        <div class="inteiro"><span class="rotulo">Plano</span><div data-montador></div></div>
        <div class="inteiro">
            <label class="rotulo" for="in-valor-negociado">Valor negociado (R$/mês)</label>
            <div class="linha-campo">
                <input class="campo" id="in-valor-negociado" name="valor_negociado" inputmode="decimal" placeholder="Vazio = preço de tabela" autocomplete="off">
                <button type="button" class="btn" data-usar-tabela>Usar preço de tabela</button>
            </div>
            <span class="ajuda" data-total-tabela></span>
        </div>`;
    function ligarPlano(f, precos, composicao) {
        const ajuda = f.querySelector('[data-total-tabela]');
        const campo = f.elements.valor_negociado;
        const mostrar = (p) => {
            const v = campo.value.trim();
            const n = v ? lerPreco(v) : NaN;
            ajuda.innerHTML = `Preço de tabela desta composição: <b>${esc(MARQ.dinheiro(p.total))}/mês</b>. ` +
                (!v ? 'Campo vazio: o cliente paga o preço de tabela.'
                    : Number.isFinite(n) && n !== p.total ? `O cliente vai pagar <b class="sobrescrito">${esc(MARQ.dinheiro(n))}/mês</b> (negociado).`
                    : 'Valor igual ao de tabela.');
        };
        const m = MONTADOR.criar(f.querySelector('[data-montador]'), {
            tabela: precos, composicao: composicao || { placares: 1 }, teto: false, aoMudar: (_c, p) => mostrar(p)
        });
        campo.addEventListener('input', () => mostrar(m.preco()));
        f.querySelector('[data-usar-tabela]').addEventListener('click', () => { campo.value = ''; mostrar(m.preco()); campo.focus(); });
        mostrar(m.preco());
        return m;
    }

    async function novoCliente() {
        let dados;
        try { dados = await carregarPrecos(); } catch (e) { return avisar('Não foi possível carregar a tabela de preços', e.message); }
        const precos = dados.precos;
        let montador = null;
        const corpo = `<p>Cadastro de uma venda feita por você. Os placares (“Quadra 1”, “Quadra 2”…) já são criados. O administrador entra com o e-mail e a senha definidos aqui (ou recebe um convite por e-mail, se o SMTP estiver configurado).</p>
            <div class="grade-form">
                <label class="inteiro"><span class="rotulo">Nome do cliente (clube, escola…)</span><input class="campo" name="nome" required maxlength="120"></label>
                <label><span class="rotulo">Nome do administrador</span><input class="campo" name="nomeAdmin" maxlength="120" placeholder="Opcional"></label>
                <label><span class="rotulo">E-mail do administrador</span><input class="campo" name="email" type="email" required></label>
                <label><span class="rotulo">CPF ou CNPJ</span><input class="campo" name="documento" inputmode="numeric" placeholder="Opcional"></label>
                <label><span class="rotulo">Telefone</span><input class="campo" name="telefone" inputmode="tel" placeholder="Opcional"></label>
                ${blocoPlano()}
                <label><span class="rotulo">Status inicial</span><select class="campo" name="status">
                    <option value="teste">Em teste</option><option value="ativo">Ativo</option></select></label>
                <label data-teste><span class="rotulo">Fim do teste</span><input class="campo" name="teste_ate" type="date"></label>
                ${blocoAcesso('senhaAdmin')}
                <label class="inteiro"><span class="rotulo">Observações (só você vê)</span><textarea class="campo" name="observacoes" maxlength="2000"></textarea></label>
            </div>`;
        const criado = await abrirFolha({
            titulo: 'Novo cliente', corpo, sim: 'Cadastrar', larga: true,
            aoAbrir: (f) => {
                ligarAcesso(f);
                montador = ligarPlano(f, precos, { placares: 1 });
                const dias = Number.isFinite(Number(precos.dias_teste)) ? Number(precos.dias_teste) : 14;
                f.teste_ate.value = paraInputData(somarDias(new Date(), dias));
                const atualizarStatus = () => { f.querySelector('[data-teste]').hidden = f.status.value !== 'teste'; };
                f.status.addEventListener('change', atualizarStatus);
                atualizarStatus();
            },
            aoEnviar: async (f) => {
                if (!f.nome.value.trim()) throw new Error('Informe o nome do cliente.');
                if (!f.email.value.trim()) throw new Error('Informe o e-mail do administrador.');
                const corpoReq = {
                    nome: f.nome.value.trim(), nomeAdmin: f.nomeAdmin.value.trim(), email: f.email.value.trim(),
                    documento: f.documento.value, telefone: f.telefone.value, composicao: montador.composicao(),
                    status: f.status.value, observacoes: f.observacoes.value
                };
                const valor = lerValorNegociado(f.valor_negociado);
                if (valor !== null) corpoReq.valor_mensal_centavos = valor;
                if (corpoReq.status === 'teste') corpoReq.teste_ate = deInputData(f.teste_ate.value);
                if (usaSenha(f)) corpoReq.senhaAdmin = lerSenha(f, 'senhaAdmin');
                const c = await api('POST', '/api/admin/clientes', corpoReq);
                return { ...c, senhaAdmin: corpoReq.senhaAdmin };
            }
        });
        if (criado && criado.id) {
            if (criado.senhaAdmin) {
                await avisar('Cliente criado', `Passe o acesso para o administrador:\n\nEndereço: ${location.origin}/entrar\nE-mail: ${criado.email}\nSenha: ${criado.senhaAdmin}`);
            } else toast(`Cliente criado. Convite enviado para ${criado.email}.`);
            location.hash = '#cliente/' + criado.id;
        }
    }

    // ================================================================ DETALHE DO CLIENTE
    async function telaCliente(id, vivo) {
        conteudo.innerHTML = `<a class="voltar" href="#clientes">${ic('voltar')} Clientes</a>${carregando()}`;
        const [d, arte] = await Promise.all([
            api('GET', '/api/admin/clientes/' + id),
            api('GET', `/api/admin/clientes/${id}/arte`).catch(e => ({ erro: e.message }))
        ]);
        if (!vivo()) return;
        const c = d.cliente;
        document.title = `${c.nome} — MarQGol`;
        const plano = d.plano || {};
        const recursos = d.recursos || {};
        // O valor contratado pode diferir da tabela de hoje: congelado na
        // contratação (a tabela mudou depois) ou negociado por você.
        const valor = c.valor_mensal_centavos == null ? null : Number(c.valor_mensal_centavos);
        const difereTabela = valor !== null && Number.isFinite(Number(plano.total)) && valor !== Number(plano.total);

        conteudo.innerHTML = `
            <div class="cab-cliente">
                <div>
                    <a class="voltar" href="#clientes">${ic('voltar')} Clientes</a>
                    <div class="secao-cab"><h1>${esc(c.nome)} ${tagStatus(c.status)}</h1></div>
                    <div class="meta">
                        <span>Identificador <code>${esc(c.slug)}</code></span>
                        <span>Cliente desde ${esc(MARQ.data(c.criado_em))}</span>
                        <span>Plano <b>${esc(plano.resumo || '—')}</b></span>
                        ${c.asaas_assinatura_id ? `<span>Assinatura Asaas <code>${esc(c.asaas_assinatura_id)}</code></span>` : '<span>Sem assinatura no Asaas</span>'}
                        ${c.proximo_vencimento ? `<span>Próximo vencimento ${esc(dataCurta(c.proximo_vencimento))}</span>` : ''}
                    </div>
                </div>
                <div class="acoes">
                    ${EU && EU.emailAtivo ? `<button type="button" class="btn" id="btn-reenviar">${ic('refresh')} Reenviar acesso</button>` : ''}
                    <button type="button" class="btn claro" id="btn-entrar">${ic('user')} Entrar como cliente</button>
                </div>
            </div>

            <div class="grade-detalhe">
                <section class="cartao">
                    <div class="cartao-cab"><h2>${ic('edit')} Dados</h2></div>
                    <form class="grade-form" id="form-dados" novalidate>
                        <label class="inteiro"><span class="rotulo">Nome</span><input class="campo" name="nome" value="${esc(c.nome)}" maxlength="120"></label>
                        <label><span class="rotulo">E-mail de contato</span><input class="campo" name="email" type="email" value="${esc(c.email)}"></label>
                        <label><span class="rotulo">CPF ou CNPJ</span><input class="campo" name="documento" inputmode="numeric" value="${esc(fmtDocumento(c.documento))}"></label>
                        <label><span class="rotulo">Telefone</span><input class="campo" name="telefone" inputmode="tel" value="${esc(c.telefone)}"></label>
                        <label class="inteiro"><span class="rotulo">Observações (só você vê)</span><textarea class="campo" name="observacoes" maxlength="4000">${esc(c.observacoes)}</textarea></label>
                        <div class="inteiro linha"><button type="submit" class="btn ok">${ic('save')} Salvar dados</button></div>
                    </form>
                </section>

                <section class="cartao">
                    <div class="cartao-cab"><h2>${ic('card')} Plano e status</h2></div>
                    <div class="subbloco">
                        <span class="rotulo">Plano</span>
                        <div class="plano-atual">
                            <div class="plano-txt">
                                <b>${esc(plano.resumo || '—')}</b>
                                ${(plano.itens || []).length ? `<ul class="plano-itens">${plano.itens.map(i => `<li><span>${esc(i.rotulo)}</span><span>${esc(MARQ.dinheiro(i.subtotal))}</span></li>`).join('')}</ul>` : ''}
                            </div>
                            <button type="button" class="btn" id="btn-plano">${ic('edit')} Alterar plano</button>
                        </div>
                        <div class="valor-mensal">
                            <span class="rotulo">Valor mensal</span>
                            <span class="valor">${valor === null ? '—' : esc(MARQ.dinheiro(valor))}<small>/mês</small></span>
                            ${difereTabela ? `<span class="tag amarelo" title="O cliente paga um valor diferente da tabela de hoje">negociado/congelado</span>` : ''}
                        </div>
                        ${difereTabela ? `<p class="ajuda">Preço de tabela hoje: <b>${esc(MARQ.dinheiro(plano.total))}/mês</b>. O cliente continua pagando o valor contratado até você alterar o plano.</p>` : ''}
                        <p class="ajuda">${c.asaas_assinatura_id ? 'Este cliente tem assinatura no Asaas: ao alterar o plano, o valor é atualizado lá também.' : 'Sem assinatura no Asaas: alterar o plano muda só os limites, recursos e o valor registrado.'}</p>
                    </div>
                    <div class="subbloco">
                        <span class="rotulo">Status</span>
                        <div class="status-escolha" role="group" aria-label="Status do cliente">
                            ${STATUS.map(s => `<button type="button" data-s="${s}" aria-pressed="${s === c.status}">${ROTULO_STATUS[s]}</button>`).join('')}
                        </div>
                        <p class="ajuda">${esc(EFEITO_STATUS[c.status] || '')}${c.inadimplente_desde ? ` Inadimplente desde ${esc(MARQ.data(c.inadimplente_desde))}.` : ''}</p>
                    </div>
                    <div class="subbloco">
                        <span class="rotulo">Fim do teste</span>
                        <div class="linha-campo">
                            <input class="campo" type="date" id="in-teste" value="${paraInputData(c.teste_ate)}" aria-label="Fim do teste">
                            <button type="button" class="btn" id="btn-mais7">+7 dias</button>
                            <button type="button" class="btn" id="btn-teste">Salvar</button>
                        </div>
                        <p class="ajuda">${c.status === 'teste'
                            ? (!c.teste_ate ? 'Sem data de fim definida.'
                                : diasAte(c.teste_ate) < 0 ? `Terminou em ${esc(MARQ.data(c.teste_ate))} — a próxima revisão de status suspende o cliente.`
                                : `Termina em ${esc(MARQ.data(c.teste_ate))} (${diasAte(c.teste_ate) === 0 ? 'hoje' : plural(diasAte(c.teste_ate), 'dia', 'dias')}).`)
                            : 'Só vale enquanto o status for “Em teste”.'}</p>
                    </div>
                </section>
            </div>

            <section class="cartao" id="cartao-limites"></section>
            <section class="cartao" id="cartao-arte"></section>

                <section class="cartao">
                    <div class="cartao-cab"><h2>${ic('users')} Usuários <span class="tag">${d.usuarios.length} de ${Number(d.limites.max_usuarios)}</span></h2>
                        <button type="button" class="btn" id="btn-novo-usuario">${ic('plus')} Novo usuário</button></div>
                    <div class="tabela-caixa" id="tab-usuarios">${tabelaUsuarios(d.usuarios)}</div>
                </section>
                <section class="cartao">
                    <div class="cartao-cab"><h2>${ic('tv')} Placares</h2><span class="tag">${d.placares.length}</span></div>
                    <div class="tabela-caixa">${tabelaPlacares(d.placares)}</div>
                </section>

            <section class="cartao">
                <div class="cartao-cab"><h2>${ic('card')} Faturas</h2></div>
                <div class="tabela-caixa">${tabelaFaturas(d.faturas)}</div>
            </section>

            <section class="cartao">
                <div class="cartao-cab"><h2>${ic('shield')} Auditoria recente</h2>
                    <a class="btn leve" href="#auditoria?cliente=${Number(c.id)}">Ver tudo</a></div>
                <div class="tabela-caixa">${tabelaAuditoria(d.auditoria, { comCliente: false })}</div>
            </section>

            <section class="cartao perigo-zona">
                <div class="cartao-cab"><div><h2>${ic('trash')} Zona de perigo</h2>
                    <p>Excluir apaga o cliente, usuários, placares, jogos, arquivos e faturas registradas. Não tem volta.
                    ${c.asaas_assinatura_id ? ' Este cliente tem assinatura no Asaas: cancele-a (status Cancelado) antes.' : ''}</p></div></div>
                <div class="linha-campo" style="max-width:640px">
                    <input class="campo" id="in-excluir" placeholder="Digite ${esc(c.slug)} para confirmar" aria-label="Digite o identificador para confirmar" autocomplete="off">
                    <button type="button" class="btn perigo" id="btn-excluir" disabled>${ic('trash')} Excluir cliente</button>
                </div>
            </section>`;

        const recarregar = () => { if (vivo()) rotear(); };
        const patch = (corpo) => api('PATCH', '/api/admin/clientes/' + c.id, corpo);

        // ---- Ações do topo ----
        conteudo.querySelector('#btn-entrar').addEventListener('click', async (ev) => {
            const ok = await confirmar({
                titulo: 'Entrar como cliente',
                texto: `Você vai abrir a área de ${c.nome} como administrador dele, para dar suporte.\nO acesso fica registrado na auditoria. Para voltar ao painel, use “Sair do modo cliente”.`,
                sim: 'Entrar'
            });
            if (!ok) return;
            await comBotao(ev.currentTarget, async () => {
                const r = await api('POST', `/api/admin/clientes/${c.id}/entrar`);
                location.href = (r && r.destino) || '/app/';
            });
        });
        conteudo.querySelector('#btn-reenviar')?.addEventListener('click', async (ev) => {
            const ok = await confirmar({
                titulo: 'Reenviar acesso',
                texto: 'Cada administrador do cliente recebe um e-mail: quem ainda não criou a senha recebe o convite de novo; quem já tem senha recebe um link para redefini-la.',
                sim: 'Enviar e-mails'
            });
            if (!ok) return;
            await comBotao(ev.currentTarget, async () => {
                const r = await api('POST', `/api/admin/clientes/${c.id}/reenviar-acesso`);
                if (!r.enviados) avisar('Nenhum e-mail enviado', 'Este cliente não tem administrador ativo. Convide um pela área do cliente (Entrar como cliente).');
                else toast(`Enviado para ${plural(r.enviados, 'administrador', 'administradores')}.`);
            });
        });

        // ---- Usuários ----
        const urlUsuario = (uid) => `/api/admin/clientes/${c.id}/usuarios/${uid}`;
        conteudo.querySelector('#btn-novo-usuario').addEventListener('click', async () => {
            const criado = await abrirFolha({
                titulo: `Novo usuário — ${c.nome}`, sim: 'Criar usuário',
                corpo: `<div class="grade-form">
                    <label><span class="rotulo">Nome</span><input class="campo" name="nome" maxlength="120" required></label>
                    <label><span class="rotulo">E-mail (login)</span><input class="campo" name="email" type="email" required autocomplete="off"></label>
                    <label class="inteiro"><span class="rotulo">Papel</span><select class="campo" name="papel">
                        <option value="operador">Operador — agenda, times e placares</option>
                        <option value="admin">Administrador — tudo, inclusive assinatura e usuários</option></select></label>
                    ${blocoAcesso('senha')}</div>`,
                aoAbrir: ligarAcesso,
                aoEnviar: async (f) => {
                    if (!f.nome.value.trim() || !f.email.value.trim()) throw new Error('Informe o nome e o e-mail.');
                    const corpo = { nome: f.nome.value.trim(), email: f.email.value.trim(), papel: f.papel.value };
                    if (usaSenha(f)) corpo.senha = lerSenha(f);
                    await api('POST', `/api/admin/clientes/${c.id}/usuarios`, corpo);
                    return corpo;
                }
            });
            if (!criado) return;
            if (criado.senha) await avisar('Usuário criado', `Passe o acesso para ${criado.nome}:\n\nEndereço: ${location.origin}/entrar\nE-mail: ${criado.email}\nSenha: ${criado.senha}`);
            else toast(`Convite enviado para ${criado.email}.`);
            recarregar();
        });
        conteudo.querySelector('#tab-usuarios').addEventListener('click', async (ev) => {
            const b = ev.target.closest('[data-u]');
            if (!b) return;
            const tr = b.closest('[data-uid]');
            const uid = tr.dataset.uid, nome = tr.dataset.nome;
            if (b.dataset.u === 'senha') { if (await folhaSenha(nome, urlUsuario(uid))) recarregar(); return; }
            if (b.dataset.u === 'papel') {
                const papel = tr.dataset.papel === 'admin' ? 'operador' : 'admin';
                await comBotao(b, async () => { await api('PATCH', urlUsuario(uid), { papel }); toast(`${nome}: ${papel === 'admin' ? 'administrador' : 'operador'}`); recarregar(); });
                return;
            }
            if (b.dataset.u === 'ativo') {
                const ativo = tr.dataset.ativo !== 'true';
                if (!ativo && !(await confirmar({ titulo: `Desativar ${nome}?`, texto: 'A pessoa não consegue mais entrar até ser reativada.', sim: 'Desativar', perigo: true }))) return;
                await comBotao(b, async () => { await api('PATCH', urlUsuario(uid), { ativo }); toast(ativo ? 'Usuário ativado' : 'Usuário desativado'); recarregar(); });
                return;
            }
            if (b.dataset.u === 'remover') {
                if (!(await confirmar({ titulo: `Remover ${nome}?`, texto: 'A pessoa perde o acesso e sai da lista. Não tem volta.', sim: 'Remover', perigo: true }))) return;
                await comBotao(b, async () => { await api('DELETE', urlUsuario(uid)); toast('Usuário removido'); recarregar(); });
            }
        });

        // ---- Dados ----
        conteudo.querySelector('#form-dados').addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const f = ev.currentTarget;
            await comBotao(f.querySelector('[type=submit]'), async () => {
                // Só o que mudou: a auditoria registra os campos enviados.
                const so = (v) => String(v || '').replace(/\D/g, '');
                const corpo = {};
                if (f.nome.value.trim() !== c.nome) corpo.nome = f.nome.value;
                if (f.email.value.trim().toLowerCase() !== String(c.email).toLowerCase()) corpo.email = f.email.value;
                if (so(f.documento.value) !== so(c.documento)) corpo.documento = f.documento.value;
                if (f.telefone.value.replace(/[^\d+]/g, '') !== (c.telefone || '')) corpo.telefone = f.telefone.value;
                if (f.observacoes.value.trim() !== (c.observacoes || '')) corpo.observacoes = f.observacoes.value;
                if (!Object.keys(corpo).length) return toast('Nada mudou.');
                await patch(corpo);
                toast('Dados salvos');
                recarregar();
            });
        });

        // ---- Plano ----
        conteudo.querySelector('#btn-plano').addEventListener('click', async () => {
            let montador = null;
            const salvo = await abrirFolha({
                titulo: `Alterar plano — ${c.nome}`, sim: 'Salvar plano', larga: true,
                corpo: `<p>Monte os itens do plano. Os limites e recursos passam a ser os da nova composição (ajustes individuais continuam valendo).
                    ${c.asaas_assinatura_id ? ' <b>Este cliente tem assinatura no Asaas: o valor da assinatura será atualizado lá.</b>' : ''}</p>
                    <div class="grade-form">${blocoPlano()}</div>`,
                aoAbrir: (f) => {
                    // Valor diferente da tabela de hoje (negociado ou congelado) já vem preenchido.
                    if (difereTabela) f.elements.valor_negociado.value = precoParaCampo(valor);
                    montador = ligarPlano(f, d.precos, c.composicao || { placares: 1 });
                },
                aoEnviar: async (f) => {
                    const composicao = montador.composicao();
                    const negociado = lerValorNegociado(f.elements.valor_negociado);
                    const total = montador.preco().total;
                    const novoValor = negociado === null ? total : negociado;
                    if (c.asaas_assinatura_id && novoValor <= 0) throw new Error('Com assinatura no Asaas o valor mensal precisa ser maior que zero.');
                    const ok = await confirmar({
                        titulo: 'Alterar o plano?',
                        texto: `${MONTADOR.resumo(composicao, d.precos)}\n` +
                            `Novo valor: ${MARQ.dinheiro(novoValor)}/mês${negociado === null ? ' (preço de tabela)' : negociado !== total ? ` (negociado; tabela: ${MARQ.dinheiro(total)})` : ''}.` +
                            (valor !== null ? ` Hoje: ${MARQ.dinheiro(valor)}/mês.` : '') + '\n' +
                            (c.asaas_assinatura_id ? 'O cliente tem assinatura no Asaas: o valor da assinatura será alterado lá também.' : 'Sem assinatura no Asaas: nada muda na cobrança.'),
                        sim: 'Alterar plano'
                    });
                    if (!ok) return MANTER_ABERTA;
                    await patch({ composicao, valor_mensal_centavos: negociado });
                }
            });
            if (salvo) { toast('Plano alterado'); recarregar(); }
        });

        // ---- Status ----
        conteudo.querySelector('.status-escolha').addEventListener('click', async (ev) => {
            const b = ev.target.closest('[data-s]');
            if (!b || b.dataset.s === c.status) return;
            const s = b.dataset.s;
            const perigo = s === 'suspenso' || s === 'cancelado';
            const ok = await confirmar({
                titulo: `Mudar para “${ROTULO_STATUS[s]}”?`,
                texto: `${ROTULO_STATUS[c.status]} → ${ROTULO_STATUS[s]}.\n${EFEITO_STATUS[s]}`,
                sim: 'Mudar status', perigo
            });
            if (!ok) return;
            await comBotao(b, async () => {
                const corpo = { status: s };
                // Voltar para teste sem data deixaria o teste sem fim: sugere +7 dias.
                if (s === 'teste' && (!c.teste_ate || diasAte(c.teste_ate) < 0)) corpo.teste_ate = deInputData(paraInputData(somarDias(new Date(), 7)));
                await patch(corpo);
                toast(`Status: ${ROTULO_STATUS[s]}`);
                recarregar();
            });
        });

        // ---- Fim do teste ----
        const inTeste = conteudo.querySelector('#in-teste');
        conteudo.querySelector('#btn-teste').addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
            await patch({ teste_ate: deInputData(inTeste.value) });
            toast(inTeste.value ? 'Fim do teste salvo' : 'Fim do teste removido');
            recarregar();
        }));
        conteudo.querySelector('#btn-mais7').addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
            const atual = inTeste.value ? new Date(deInputData(inTeste.value)) : null;
            const base = atual && atual > new Date() ? atual : new Date();
            const nova = paraInputData(somarDias(base, 7));
            await patch({ teste_ate: deInputData(nova) });
            toast(`Teste estendido até ${dataCurta(nova)}`);
            recarregar();
        }));

        // ---- Excluir ----
        const inExcluir = conteudo.querySelector('#in-excluir');
        const btnExcluir = conteudo.querySelector('#btn-excluir');
        inExcluir.addEventListener('input', () => { btnExcluir.disabled = inExcluir.value.trim() !== c.slug; });
        btnExcluir.addEventListener('click', async () => {
            const ok = await confirmar({
                titulo: `Excluir ${c.nome}?`,
                texto: 'Apaga de vez o cliente e tudo dele (usuários, placares, jogos, arquivos, faturas registradas). Telas pareadas param na hora. Não dá para desfazer.',
                sim: 'Excluir de vez', perigo: true
            });
            if (!ok) return;
            await comBotao(btnExcluir, async () => {
                await api('DELETE', '/api/admin/clientes/' + c.id, { confirmacao: inExcluir.value.trim() });
                toast('Cliente excluído');
                location.hash = '#clientes';
            });
        });

        desenharLimites(conteudo.querySelector('#cartao-limites'), d, limitesDaComposicao(c.composicao, d.precos), recursos, patch, recarregar);
        desenharArte(conteudo.querySelector('#cartao-arte'), c.id, arte);
    }

    function tabelaUsuarios(lista) {
        if (!lista.length) return '<div class="vazio">Nenhum usuário.</div>';
        return `<table class="tabela"><thead><tr><th>Usuário</th><th>Papel</th><th>Último login</th><th></th></tr></thead><tbody>
            ${lista.map(u => `<tr data-uid="${Number(u.id)}" data-nome="${esc(u.nome)}" data-papel="${esc(u.papel)}" data-ativo="${u.ativo}">
                <td class="princ"><b>${esc(u.nome)}</b><span>${esc(u.email)}</span></td>
                <td><div class="tags"><span class="tag ${u.papel === 'admin' ? 'amarelo' : ''}">${u.papel === 'admin' ? 'Admin' : 'Operador'}</span>
                    ${u.convite_pendente ? '<span class="tag alerta">Sem senha</span>' : ''}
                    ${u.ativo ? '' : '<span class="tag perigo">Inativo</span>'}</div></td>
                <td class="nw" title="${esc(MARQ.dataHora(u.ultimo_login_em))}">${relativo(u.ultimo_login_em)}</td>
                <td><div class="acoes-linha">
                    <button type="button" class="btn peq" data-u="senha" title="Definir senha">${ic('lock')} Senha</button>
                    <button type="button" class="btn peq" data-u="papel" title="Trocar papel">${u.papel === 'admin' ? 'Tornar operador' : 'Tornar admin'}</button>
                    <button type="button" class="btn peq icone" data-u="ativo" title="${u.ativo ? 'Desativar' : 'Ativar'}" aria-label="${u.ativo ? 'Desativar' : 'Ativar'} ${esc(u.nome)}">${ic('power')}</button>
                    <button type="button" class="btn peq icone perigo" data-u="remover" title="Remover" aria-label="Remover ${esc(u.nome)}">${ic('trash')}</button>
                </div></td>
            </tr>`).join('')}</tbody></table>`;
    }

    function tabelaPlacares(lista) {
        if (!lista.length) return '<div class="vazio">Nenhum placar.</div>';
        return `<table class="tabela"><thead><tr><th>Placar</th><th>Situação</th><th class="num">Telas</th><th>Criado</th></tr></thead><tbody>
            ${lista.map(p => `<tr>
                <td class="princ"><b>${esc(p.nome)}</b><span>#${Number(p.id)}${p.jogo_id ? ` · jogo #${esc(p.jogo_id)} carregado` : ''}</span></td>
                <td>${p.ativo ? '<span class="tag ok">Ativo</span>' : '<span class="tag">Desativado</span>'}</td>
                <td class="num">${Number(p.telas) || 0}</td>
                <td class="nw">${esc(MARQ.data(p.criado_em))}</td>
            </tr>`).join('')}</tbody></table>`;
    }

    function tabelaFaturas(lista) {
        if (!lista.length) return '<div class="vazio">Nenhuma fatura registrada (o cliente ainda não assinou pelo Asaas).</div>';
        return `<table class="tabela"><thead><tr><th>Vencimento</th><th class="num">Valor</th><th>Situação</th><th>Forma</th><th>Pago em</th><th></th></tr></thead><tbody>
            ${lista.map(f => {
                const [rot, cls] = STATUS_FATURA[f.status] || [f.status, ''];
                return `<tr>
                    <td class="nw">${esc(dataCurta(f.vencimento))}</td>
                    <td class="num">${esc(MARQ.dinheiro(f.valor_centavos))}</td>
                    <td><span class="tag ${cls}">${esc(rot)}</span></td>
                    <td>${esc(FORMA_PAGTO[f.forma] || f.forma || '—')}</td>
                    <td class="nw">${esc(MARQ.data(f.pago_em))}</td>
                    <td>${/^https:\/\//.test(f.link || '') ? `<a class="link" href="${esc(f.link)}" target="_blank" rel="noopener">${ic('link')} Abrir</a>` : ''}</td>
                </tr>`;
            }).join('')}</tbody></table>`;
    }

    // ---- Limites individuais (limites_extra) ----
    // `plano` = limites que a composição dá (limitesDaComposicao).
    function desenharLimites(caixa, d, plano, recursos, patch, recarregar) {
        const extra = d.cliente.limites_extra || {};
        const efetivo = d.limites || {};
        const uso = d.uso || {};
        const p = plano || {};
        const esportesPlano = p.esportes || Object.keys(ESPORTES);
        const extraEsportes = Array.isArray(extra.esportes) ? extra.esportes : [];
        const extraRec = extra.recursos || {};

        const barra = (usado, limite, marca = '') => {
            const pct = limite > 0 ? Math.min(100, usado / limite * 100) : (usado > 0 ? 100 : 0);
            const cls = usado > limite ? 'cheio' : pct >= 80 ? 'quase' : '';
            return `<div class="barra-uso ${cls}"><div class="trilho"><div class="enchido" style="width:${pct.toFixed(0)}%"></div></div><span>${esc(usado)} / ${esc(limite)}${marca}</span></div>`;
        };

        caixa.innerHTML = `
            <div class="cartao-cab"><div><h2>${ic('star')} Limites individuais</h2>
                <p>Ajustes só para este cliente, por cima do plano. Os valores do plano vêm da composição (placares, pacotes de usuários e recursos contratados) e da tabela de preços. Campo vazio = usa o valor do plano.</p></div></div>
            <div class="tabela-caixa"><table class="tabela tabela-limites"><thead><tr>
                <th>Limite</th><th class="num">Plano</th><th>Individual</th><th>Uso × limite efetivo</th>
            </tr></thead><tbody>
                ${CAMPOS.map(([k, rot]) => `<tr>
                    <td>${esc(rot)}</td>
                    <td class="num">${esc(p[k] ?? '—')}</td>
                    <td><input class="campo" type="number" min="0" step="1" name="${k}" value="${extra[k] ?? ''}" placeholder="${esc(p[k] ?? '')}" aria-label="${esc(rot)} individual"></td>
                    <td>${barra(Number(uso[k]) || 0, Number(efetivo[k]) || 0, extra[k] !== undefined ? ' <span class="sobrescrito" title="Ajuste individual">' + ic('star') + '</span>' : '')}</td>
                </tr>`).join('')}
            </tbody></table></div>
            <div class="subbloco">
                <span class="rotulo">Esportes</span>
                <div class="opcoes-linha" id="lim-esportes">
                    ${Object.entries(ESPORTES).map(([k, rot]) => `<label class="marcar"><input type="checkbox" value="${k}" ${extraEsportes.includes(k) ? 'checked' : ''}> ${rot}</label>`).join('')}
                </div>
                <p class="ajuda">Nenhum marcado = usa os do plano (${esc(esportesPlano.map(e => ESPORTES[e] || e).join(', '))}). Liberados agora: <b>${esc((efetivo.esportes || []).map(e => ESPORTES[e] || e).join(', ') || 'nenhum')}</b>.</p>
            </div>
            <div class="subbloco">
                <span class="rotulo">Recursos</span>
                <div id="lim-recursos">
                    ${Object.entries(recursos).map(([k, def]) => {
                        const doPlano = p.recursos && typeof p.recursos[k] === 'boolean' ? p.recursos[k] : def.padrao;
                        const v = typeof extraRec[k] === 'boolean' ? (extraRec[k] ? 'liga' : 'desliga') : 'plano';
                        return `<div class="recurso-linha" data-k="${esc(k)}">
                            <div class="txt"><b>${esc(def.rotulo)}</b><span>No plano: ${doPlano ? 'incluído' : 'não incluído'} · Agora: ${efetivo.recursos && efetivo.recursos[k] ? '<span style="color:var(--ok)">liberado</span>' : 'bloqueado'}</span></div>
                            <div class="tri" role="group" aria-label="${esc(def.rotulo)}">
                                ${[['plano', 'Do plano'], ['liga', 'Liga'], ['desliga', 'Desliga']].map(([val, rot]) => `<button type="button" data-v="${val}" aria-pressed="${v === val}">${rot}</button>`).join('')}
                            </div></div>`;
                    }).join('')}
                </div>
            </div>
            <div class="linha">
                <button type="button" class="btn ok" id="btn-limites">${ic('save')} Salvar limites</button>
                <button type="button" class="btn leve" id="btn-limites-limpar">Voltar tudo ao plano</button>
            </div>`;

        caixa.querySelector('#lim-recursos').addEventListener('click', (ev) => {
            const b = ev.target.closest('.tri button');
            if (!b) return;
            b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        });

        caixa.querySelector('#btn-limites').addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
            const novo = {};
            for (const [k, rot] of CAMPOS) {
                const v = caixa.querySelector(`[name="${k}"]`).value.trim();
                if (v === '') continue;
                const n = Number(v);
                if (!Number.isInteger(n) || n < 0) throw new Error(`“${rot}” precisa ser um número inteiro (0 ou mais).`);
                novo[k] = n;
            }
            const esportes = [...caixa.querySelectorAll('#lim-esportes input:checked')].map(i => i.value);
            if (esportes.length) novo.esportes = esportes;
            const rec = {};
            caixa.querySelectorAll('.recurso-linha').forEach(l => {
                const v = l.querySelector('[aria-pressed="true"]').dataset.v;
                if (v !== 'plano') rec[l.dataset.k] = v === 'liga';
            });
            if (Object.keys(rec).length) novo.recursos = rec;
            await patch({ limites_extra: novo });
            toast(Object.keys(novo).length ? 'Limites individuais salvos' : 'Cliente usa só os limites do plano');
            recarregar();
        }));

        caixa.querySelector('#btn-limites-limpar').addEventListener('click', async (ev) => {
            if (!Object.keys(extra).length) return toast('Este cliente já usa só os limites do plano.');
            const ok = await confirmar({ titulo: 'Voltar tudo ao plano?', texto: 'Remove todos os ajustes individuais deste cliente. Ele passa a seguir só os limites e recursos do plano.', sim: 'Remover ajustes' });
            if (!ok) return;
            await comBotao(ev.currentTarget, async () => { await patch({ limites_extra: {} }); toast('Ajustes removidos'); recarregar(); });
        });
    }

    // ---- Arte do telão ----
    function desenharArte(caixa, clienteId, arte) {
        const base = `/api/admin/clientes/${clienteId}`;
        if (!arte || arte.erro) {
            caixa.innerHTML = `<div class="cartao-cab"><h2>${ic('palette')} Arte do telão</h2></div>${erroHtml(arte ? arte.erro : 'Sem resposta')}`;
            return;
        }
        const grupos = {};
        for (const s of arte.slots) {
            const g = s.slot.includes('/') ? s.slot.split('/')[0] : '';
            (grupos[g] = grupos[g] || []).push(s);
        }
        const personalizados = arte.slots.filter(s => s.personalizado).length;
        const bordas = arte.bordas || {};
        caixa.innerHTML = `
            <div class="cartao-cab"><div><h2>${ic('palette')} Arte do telão</h2>
                <p>Peças próprias do cliente substituem a arte padrão MarQGol. Imagens: SVG, PNG, WebP ou JPG; vídeo de espera: MP4 ou WebM. As telas atualizam sozinhas.</p></div>
                <div class="tags"><span class="tag ${personalizados ? 'amarelo' : ''}">${plural(personalizados, 'peça personalizada', 'peças personalizadas')}</span><span class="tag">versão ${Number(arte.versao) || 0}</span></div></div>
            <div class="arte-grupos">
                ${Object.entries(GRUPO_SLOT).filter(([g]) => grupos[g]).map(([g, rot]) => `<div class="arte-grupo"><h3>${esc(rot)}</h3>
                    ${grupos[g].map(s => {
                        const nome = s.slot.split('/').pop();
                        const aceita = s.slot === 'espera' ? '.mp4,.webm' : '.svg,.png,.webp,.jpg,.jpeg';
                        return `<div class="arte-slot" data-slot="${esc(s.slot)}">
                            <div class="nome"><b>${esc(NOME_SLOT[nome] || nome)}</b><code>${esc(s.slot)}</code></div>
                            ${s.personalizado ? '<span class="tag amarelo">Personalizada</span>' : `<span class="tag">${s.padrao ? 'Padrão' : 'Sem arte'}</span>`}
                            <label class="btn" title="Enviar arquivo">${ic('upload')} Enviar<input type="file" accept="${aceita}"></label>
                            ${s.personalizado ? `<button type="button" class="btn icone perigo" data-restaurar title="Restaurar padrão" aria-label="Restaurar padrão">${ic('reset')}</button>` : ''}
                        </div>`;
                    }).join('')}</div>`).join('')}
            </div>
            <div class="subbloco">
                <span class="rotulo">Bordas (sobra da tela em volta da arte 2:1)</span>
                <div class="bordas-linha">
                    ${[['topo', 'Topo'], ['base', 'Base'], ['lados', 'Lados']].map(([k, rot]) => `<label><span class="rotulo">${rot}</span>
                        <input class="campo compacto" name="borda-${k}" value="${esc(bordas[k] || '')}" placeholder="#0b1220 ou linear-gradient(…)" maxlength="590">
                        <div class="amostra" data-amostra="${k}"></div></label>`).join('')}
                </div>
                <p class="ajuda">Cor ou gradiente CSS. Vazio = cor padrão.</p>
                <div class="linha"><button type="button" class="btn" id="btn-bordas">${ic('save')} Salvar bordas</button></div>
            </div>`;

        const pintar = (k) => {
            const v = caixa.querySelector(`[name="borda-${k}"]`).value.trim();
            const el = caixa.querySelector(`[data-amostra="${k}"]`);
            el.style.background = '';
            if (v) el.style.background = v;
        };
        ['topo', 'base', 'lados'].forEach(k => { pintar(k); caixa.querySelector(`[name="borda-${k}"]`).addEventListener('input', () => pintar(k)); });

        caixa.addEventListener('change', async (ev) => {
            const input = ev.target.closest('input[type=file]');
            if (!input || !input.files[0]) return;
            const slot = input.closest('[data-slot]').dataset.slot;
            const arquivo = input.files[0];
            const label = input.closest('label');
            label.setAttribute('aria-disabled', 'true');
            try {
                const novo = await MARQ.enviarArquivoPut(`${base}/arte/${slot}?nome=${encodeURIComponent(arquivo.name)}`, arquivo);
                toast('Arte enviada');
                desenharArte(caixa, clienteId, novo);
            } catch (e) {
                label.removeAttribute('aria-disabled');
                input.value = '';
                avisar('Não foi possível enviar', e.message);
            }
        });
        caixa.addEventListener('click', async (ev) => {
            const b = ev.target.closest('[data-restaurar]');
            if (!b) return;
            const slot = b.closest('[data-slot]').dataset.slot;
            const nome = NOME_SLOT[slot.split('/').pop()] || slot;
            const ok = await confirmar({ titulo: 'Restaurar arte padrão?', texto: `Apaga a peça personalizada “${nome}” (${slot}) e volta a usar a arte padrão MarQGol.`, sim: 'Restaurar', perigo: true });
            if (!ok) return;
            await comBotao(b, async () => {
                const novo = await api('DELETE', `${base}/arte/${slot}`);
                toast('Arte padrão restaurada');
                desenharArte(caixa, clienteId, novo);
            });
        });
        caixa.querySelector('#btn-bordas').addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
            const val = (k) => caixa.querySelector(`[name="borda-${k}"]`).value.trim();
            const novo = await api('POST', `${base}/arte-bordas`, { bordas: { topo: val('topo'), base: val('base'), lados: val('lados') } });
            toast('Bordas salvas');
            desenharArte(caixa, clienteId, novo);
        }));
    }

    // ================================================================ PREÇOS
    // Tabela única do plano on demand. Vale para novos cadastros e para quem
    // alterar o plano depois; quem já é cliente continua pagando o valor
    // contratado (valor_mensal_centavos congelado).
    const gbTexto = (mb) => {
        const n = Number(mb);
        if (!Number.isFinite(n) || n <= 0) return '';
        return n >= 1024 ? `≈ ${String(Math.round(n / 1024 * 10) / 10).replace('.', ',')} GB por placar` : `${n} MB por placar`;
    };

    async function telaPrecos(vivo) {
        document.title = 'Preços — MarQGol';
        conteudo.innerHTML = `<div class="secao-cab"><div><h1>Preços</h1></div></div>${carregando()}`;
        const { precos: p, recursos, clientes } = await carregarPrecos();
        if (!vivo()) return;
        const nClientes = Number(clientes) || 0;
        const recPrecos = p.precos_recursos || {};
        const reais = (nome, rot, centavos, ajuda = '') => `<label><span class="rotulo">${esc(rot)}</span>
            <div class="campo-reais"><span>R$</span><input class="campo" name="${nome}" inputmode="decimal" value="${esc(precoParaCampo(centavos))}" autocomplete="off"></div>
            ${ajuda ? `<span class="ajuda">${ajuda}</span>` : ''}</label>`;
        const inteiro = (nome, rot, v, { min = 0, max = '', ajuda = '' } = {}) => `<label><span class="rotulo">${esc(rot)}</span>
            <input class="campo" type="number" name="${nome}" min="${min}" ${max !== '' ? `max="${max}"` : ''} step="1" value="${esc(v)}">
            ${ajuda ? `<span class="ajuda" ${ajuda === true ? `data-ajuda="${nome}"` : ''}>${ajuda === true ? '' : ajuda}</span>` : ''}</label>`;

        conteudo.innerHTML = `
            <div class="secao-cab"><div><h1>Preços</h1><p>Tabela do plano on demand: o cliente monta o plano com placares, usuários e recursos especiais.</p></div></div>
            <div class="aviso-caixa info">${ic('info')}<div>Mudanças valem para <b>novos cadastros</b> e para clientes que <b>alterarem o plano</b> depois.
                ${nClientes ? `Os ${plural(nClientes, 'cliente atual', 'clientes atuais')} continuam pagando o valor contratado.` : 'Clientes atuais continuam pagando o valor contratado.'}</div></div>
            <form class="cartao" id="form-precos" novalidate>
                <div class="subbloco">
                    <h3>Itens do plano</h3>
                    <div class="grade-3">
                        ${reais('preco_placar', 'Preço por placar (mês)', p.preco_placar_centavos)}
                        ${reais('preco_pacote', 'Pacote extra de usuários (mês)', p.preco_pacote_usuarios_centavos, 'O primeiro pacote vem incluído.')}
                        ${inteiro('usuarios_por_pacote', 'Usuários por pacote', p.usuarios_por_pacote, { min: 1, max: 1000 })}
                    </div>
                </div>
                <div class="subbloco">
                    <h3>Recursos especiais</h3>
                    <p class="ajuda">Valor fixo mensal por conta, independente da quantidade de placares.</p>
                    <div class="grade-3">
                        ${Object.entries(recursos).map(([k, def]) => reais('recurso_' + k, def.rotulo, recPrecos[k] || 0)).join('')}
                    </div>
                </div>
                <div class="subbloco">
                    <h3>Cotas por placar</h3>
                    <div class="grade-3">
                        ${inteiro('jogos_por_placar', 'Jogos em aberto por placar', p.jogos_por_placar, { ajuda: 'Agendados ou ao vivo.' })}
                        ${inteiro('armazenamento_mb_por_placar', 'Armazenamento por placar (MB)', p.armazenamento_mb_por_placar, { ajuda: true })}
                    </div>
                </div>
                <div class="subbloco">
                    <h3>Teste e autoatendimento</h3>
                    <div class="grade-3">
                        ${inteiro('dias_teste', 'Dias de teste', p.dias_teste, { max: 90, ajuda: 'De 0 a 90.' })}
                        ${inteiro('max_placares_autoatendimento', 'Máx. de placares no site', p.max_placares_autoatendimento, { min: 1, ajuda: 'Acima disso, só por você.' })}
                        ${inteiro('max_pacotes_autoatendimento', 'Máx. de pacotes extras no site', p.max_pacotes_autoatendimento, { ajuda: 'Pacotes de usuários.' })}
                    </div>
                </div>
                <div class="subbloco">
                    <div class="exemplo-preco" id="exemplo-preco" aria-live="polite"></div>
                    <div class="linha">
                        <button type="submit" class="btn ok">${ic('save')} Salvar preços</button>
                        ${p.atualizado_em ? `<span class="ajuda">Última alteração: ${esc(MARQ.dataHora(p.atualizado_em))}</span>` : ''}
                    </div>
                </div>
            </form>`;

        const f = conteudo.querySelector('#form-precos');
        const RECS = Object.keys(recursos);
        // estrito = valida e lança (salvar); senão, tolera campo inválido (exemplo ao vivo).
        function lerTabela(estrito) {
            const reaisCampo = (nome, rot) => {
                const n = lerPreco(f.elements[nome].value);
                if (Number.isFinite(n) && n >= 0) return n;
                if (estrito) throw new Error(`“${rot}”: valor inválido. Use, por exemplo, 49,90.`);
                return 0;
            };
            const inteiroCampo = (nome, rot, min, max) => {
                const v = f.elements[nome].value.trim();
                const n = Number(v);
                if (v !== '' && Number.isInteger(n) && n >= min && (max === undefined || n <= max)) return n;
                if (estrito) throw new Error(`“${rot}” precisa ser um número inteiro${max !== undefined ? ` de ${min} a ${max}` : ` (${min} ou mais)`}.`);
                return Math.max(min, Number.isFinite(n) ? Math.round(n) : min);
            };
            return {
                preco_placar_centavos: reaisCampo('preco_placar', 'Preço por placar'),
                preco_pacote_usuarios_centavos: reaisCampo('preco_pacote', 'Pacote extra de usuários'),
                usuarios_por_pacote: inteiroCampo('usuarios_por_pacote', 'Usuários por pacote', 1, 1000),
                precos_recursos: Object.fromEntries(RECS.map(k => [k, reaisCampo('recurso_' + k, recursos[k].rotulo)])),
                jogos_por_placar: inteiroCampo('jogos_por_placar', 'Jogos em aberto por placar', 0),
                armazenamento_mb_por_placar: inteiroCampo('armazenamento_mb_por_placar', 'Armazenamento por placar', 0),
                dias_teste: inteiroCampo('dias_teste', 'Dias de teste', 0, 90),
                max_placares_autoatendimento: inteiroCampo('max_placares_autoatendimento', 'Máx. de placares no site', 1, 1000),
                max_pacotes_autoatendimento: inteiroCampo('max_pacotes_autoatendimento', 'Máx. de pacotes extras no site', 0, 1000)
            };
        }
        const exemplo = conteudo.querySelector('#exemplo-preco');
        const ajudaGb = f.querySelector('[data-ajuda="armazenamento_mb_por_placar"]');
        function atualizarExemplo() {
            const t = lerTabela(false);
            const ex = (comp) => MARQ.dinheiro(MONTADOR.preco(comp, t).total);
            exemplo.innerHTML = `${ic('info')}<div>
                <span>Ex.: <b>1 placar</b> = ${esc(ex({ placares: 1 }))}/mês</span>
                <span><b>2 placares + mídia</b> = ${esc(ex({ placares: 2, recursos: { midia: true } }))}/mês</span>
                <span><b>3 placares + ${t.usuarios_por_pacote} usuários extras + todos os recursos</b> = ${esc(ex({ placares: 3, pacotes_usuarios_extras: 1, recursos: Object.fromEntries(RECS.map(k => [k, true])) }))}/mês</span></div>`;
            if (ajudaGb) ajudaGb.textContent = gbTexto(f.elements.armazenamento_mb_por_placar.value);
        }
        f.addEventListener('input', atualizarExemplo);
        atualizarExemplo();

        f.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            await comBotao(f.querySelector('[type=submit]'), async () => {
                const novo = lerTabela(true);
                const ok = await confirmar({
                    titulo: 'Salvar a tabela de preços?',
                    texto: 'Os novos valores aparecem no site e valem para novos cadastros e para clientes que alterarem o plano.\n' +
                        `Quem já é cliente${nClientes ? ` (${plural(nClientes, 'cliente', 'clientes')})` : ''} continua pagando o valor contratado; nenhuma assinatura no Asaas muda.`,
                    sim: 'Salvar preços'
                });
                if (!ok) return;
                await api('PUT', '/api/admin/precos', novo);
                toast('Tabela de preços salva');
                if (vivo()) rotear();
            });
        });
    }

    // ================================================================ EQUIPE (superadmins)
    async function telaEquipe(vivo) {
        document.title = 'Equipe — MarQGol';
        conteudo.innerHTML = `<div class="secao-cab"><div><h1>Equipe</h1></div></div>${carregando()}`;
        const lista = await api('GET', '/api/admin/superadmins');
        if (!vivo()) return;
        conteudo.innerHTML = `
            <div class="secao-cab"><div><h1>Equipe</h1><p>Quem acessa este painel (superadmins). Têm acesso total a todos os clientes.</p></div>
                <button type="button" class="btn claro" id="btn-novo-sa">${ic('plus')} Novo superadmin</button></div>
            <div class="tabela-caixa"><table class="tabela"><thead><tr><th>Pessoa</th><th>Situação</th><th>Último login</th><th></th></tr></thead><tbody>
                ${lista.map(u => `<tr data-sid="${Number(u.id)}" data-nome="${esc(u.nome)}" data-ativo="${u.ativo}">
                    <td class="princ"><b>${esc(u.nome)}${u.voce ? ' <span class="tag info">Você</span>' : ''}</b><span>${esc(u.email)}</span></td>
                    <td>${u.ativo ? '<span class="tag ok">Ativo</span>' : '<span class="tag perigo">Inativo</span>'}</td>
                    <td class="nw">${relativo(u.ultimo_login_em)}</td>
                    <td><div class="acoes-linha">
                        <button type="button" class="btn peq" data-a="senha">${ic('lock')} ${u.voce ? 'Trocar minha senha' : 'Senha'}</button>
                        ${u.voce ? '' : `<button type="button" class="btn peq icone" data-a="ativo" title="${u.ativo ? 'Desativar' : 'Ativar'}" aria-label="${u.ativo ? 'Desativar' : 'Ativar'} ${esc(u.nome)}">${ic('power')}</button>
                        <button type="button" class="btn peq icone perigo" data-a="remover" title="Remover" aria-label="Remover ${esc(u.nome)}">${ic('trash')}</button>`}
                    </div></td>
                </tr>`).join('')}</tbody></table></div>`;

        conteudo.querySelector('#btn-novo-sa').addEventListener('click', async () => {
            const criado = await abrirFolha({
                titulo: 'Novo superadmin', sim: 'Criar',
                corpo: `<p>Acesso total ao painel: clientes, preços, cobrança e “entrar como”. Dê só a quem é da sua equipe.</p>
                    <div class="grade-form">
                    <label><span class="rotulo">Nome</span><input class="campo" name="nome" maxlength="120" required></label>
                    <label><span class="rotulo">E-mail (login)</span><input class="campo" name="email" type="email" required autocomplete="off"></label>
                    ${campoSenha('senha', 'Senha inicial')}</div>`,
                aoAbrir: (f) => { ligarGerador(f); f.senha.value = gerarSenha(); },
                aoEnviar: async (f) => {
                    if (!f.nome.value.trim() || !f.email.value.trim()) throw new Error('Informe o nome e o e-mail.');
                    const corpo = { nome: f.nome.value.trim(), email: f.email.value.trim(), senha: lerSenha(f) };
                    await api('POST', '/api/admin/superadmins', corpo);
                    return corpo;
                }
            });
            if (!criado) return;
            await avisar('Superadmin criado', `Passe o acesso para ${criado.nome}:\n\nEndereço: ${location.origin}/entrar\nE-mail: ${criado.email}\nSenha: ${criado.senha}`);
            rotear();
        });
        conteudo.querySelector('tbody').addEventListener('click', async (ev) => {
            const b = ev.target.closest('[data-a]');
            if (!b) return;
            const tr = b.closest('[data-sid]');
            const id = tr.dataset.sid, nome = tr.dataset.nome, url = '/api/admin/superadmins/' + id;
            if (b.dataset.a === 'senha') { if (await folhaSenha(nome, url)) rotear(); return; }
            if (b.dataset.a === 'ativo') {
                const ativo = tr.dataset.ativo !== 'true';
                if (!ativo && !(await confirmar({ titulo: `Desativar ${nome}?`, texto: 'A pessoa perde o acesso ao painel até ser reativada.', sim: 'Desativar', perigo: true }))) return;
                await comBotao(b, async () => { await api('PATCH', url, { ativo }); toast(ativo ? 'Ativado' : 'Desativado'); rotear(); });
                return;
            }
            if (b.dataset.a === 'remover') {
                if (!(await confirmar({ titulo: `Remover ${nome}?`, texto: 'A pessoa perde o acesso ao painel. Os registros de auditoria continuam.', sim: 'Remover', perigo: true }))) return;
                await comBotao(b, async () => { await api('DELETE', url); toast('Removido'); rotear(); });
            }
        });
    }

    // ================================================================ AUDITORIA
    async function telaAuditoria(vivo) {
        document.title = 'Auditoria — MarQGol';
        conteudo.innerHTML = `<div class="secao-cab"><div><h1>Auditoria</h1></div></div>${carregando()}`;
        const [clientes, linhas] = await Promise.all([
            api('GET', '/api/admin/clientes'),
            api('GET', '/api/admin/auditoria' + (filtroAuditoria ? '?cliente=' + encodeURIComponent(filtroAuditoria) : ''))
        ]);
        if (!vivo()) return;
        clientes.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        conteudo.innerHTML = `
            <div class="secao-cab"><div><h1>Auditoria</h1><p>Quem fez o quê: ações suas, dos clientes e automáticas. Últimos 300 registros.</p></div>
                <button type="button" class="btn" id="btn-atualizar">${ic('refresh')} Atualizar</button></div>
            <div class="filtros">
                <select class="campo" id="f-cliente" aria-label="Filtrar por cliente">
                    <option value="">Todos os clientes</option>
                    ${clientes.map(c => `<option value="${Number(c.id)}" ${String(c.id) === String(filtroAuditoria) ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
                </select>
                <span class="fraco" style="color:var(--muted)">${plural(linhas.length, 'registro', 'registros')}</span>
            </div>
            <div class="tabela-caixa">${tabelaAuditoria(linhas)}</div>`;
        conteudo.querySelector('#f-cliente').addEventListener('change', (ev) => {
            filtroAuditoria = ev.target.value;
            const alvo = '#auditoria' + (filtroAuditoria ? '?cliente=' + filtroAuditoria : '');
            if (location.hash === alvo) rotear(); else location.hash = alvo;
        });
        conteudo.querySelector('#btn-atualizar').addEventListener('click', () => rotear());
    }

    // ================================================================ INÍCIO
    async function iniciar() {
        const rotulos = { visao: ['chart', 'Visão geral'], clientes: ['users', 'Clientes'], precos: ['card', 'Preços'], equipe: ['lock', 'Equipe'], auditoria: ['shield', 'Auditoria'] };
        document.querySelectorAll('.adm-topo .aba').forEach(a => { const [i, t] = rotulos[a.dataset.aba]; a.innerHTML = `${ic(i)} ${t}`; });
        document.getElementById('btn-sair').innerHTML = ic('logout');
        document.getElementById('btn-sair').addEventListener('click', async () => {
            try { await api('POST', '/api/auth/sair'); } catch { /* sai mesmo assim */ }
            location.href = '/entrar';
        });

        let eu;
        try { eu = await api('GET', '/api/auth/eu'); }
        catch (e) {
            if (e.status === 401) { location.href = '/entrar?voltar=' + encodeURIComponent('/admin/'); return; }
            conteudo.innerHTML = erroHtml(e);
            return;
        }
        if (!eu.superadmin) { location.href = '/app/'; return; }
        EU = eu;
        const quem = document.getElementById('quem');
        quem.textContent = eu.email;
        quem.title = `${eu.nome || ''} <${eu.email}>`;

        // Ainda em "entrar como": avisa e oferece voltar (senão /app/ continua no cliente).
        if (eu.impersonando && eu.cliente) {
            const faixa = document.createElement('div');
            faixa.className = 'pagina adm-pagina';
            faixa.style.paddingBottom = '0';
            faixa.innerHTML = `<div class="aviso-caixa">${ic('user')}<div style="flex:1">Você ainda está no modo suporte de <b>${esc(eu.cliente.nome)}</b> (a área do cliente abre como ele).</div>
                <a class="btn" href="/app/" style="min-height:40px">Abrir área do cliente</a>
                <button type="button" class="btn alerta" id="btn-sair-cliente" style="min-height:40px">Sair do modo cliente</button></div>`;
            conteudo.before(faixa);
            faixa.querySelector('#btn-sair-cliente').addEventListener('click', async (ev) => {
                await comBotao(ev.currentTarget, async () => { await api('POST', '/api/admin/sair-cliente'); faixa.remove(); toast('Modo cliente encerrado'); });
            });
        }

        window.addEventListener('hashchange', rotear);
        rotear();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})();
