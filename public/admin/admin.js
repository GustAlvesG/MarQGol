// Painel de gestão do MarQGol (dono do SaaS). Single page sem framework: a
// aba atual vive no hash e cada tela é uma função que desenha `#conteudo`.
//
//   #visao                 indicadores gerais + revisão de status
//   #clientes[?status=x]   lista com busca e filtro; "Novo cliente"
//   #cliente/<id>          detalhe: dados, plano, status, limites, arte...
//   #planos                planos de assinatura (criar/editar)
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
        plano_alterado: 'Plano alterado', arte_alterada: 'Arte alterada', status_automatico: 'Status automático',
        aviso_fim_teste: 'Aviso de fim do teste', cadastro: 'Cadastro pelo site', assinatura: 'Assinatura',
        cancelamento: 'Cancelamento', tela_pareada: 'Tela pareada', zerar_tudo: 'Placar zerado',
        conta_alterada: 'Conta alterada', placar_criado: 'Placar criado', placar_alterado: 'Placar alterado',
        placar_excluido: 'Placar excluído', usuario_convidado: 'Usuário convidado', usuario_alterado: 'Usuário alterado',
        usuario_removido: 'Usuário removido'
    };
    const NOME_CAMPO = {
        nome: 'nome', email: 'e-mail', telefone: 'telefone', documento: 'documento', plano_id: 'plano', status: 'status',
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
            if (k === 'campos' && Array.isArray(v)) { partes.push('alterou: ' + v.map(x => NOME_CAMPO[x] || x).join(', ')); continue; }
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
                try { const r = await aoEnviar(form); fechar(r === undefined ? true : r); }
                catch (e) { erro.textContent = e.message; erro.hidden = false; erro.scrollIntoView({ block: 'nearest' }); btn.disabled = false; }
            });
            document.addEventListener('keydown', tecla);
            document.body.appendChild(veu);
            if (aoAbrir) aoAbrir(form);
            form.querySelector('input:not([type=hidden]), select, textarea')?.focus();
        });
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
    let cachePlanos = null;     // { planos, recursos }

    async function carregarPlanos(forcar = false) {
        if (!cachePlanos || forcar) cachePlanos = await api('GET', '/api/admin/planos');
        return cachePlanos;
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
            else if (tela === 'planos') await telaPlanos(vivo);
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
                ${kpi('Receita mensal (MRR)', 'card', MARQ.dinheiro(ind.receita_mensal_centavos), { classe: 'destaque', det: 'Soma dos planos de clientes ativos e inadimplentes' })}
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
                <th>Cliente</th><th>Status</th><th>Plano</th><th>Uso</th><th>Fim do teste</th><th>Último acesso</th>
            </tr></thead><tbody>${lista.map(c => `<tr class="clicavel" data-id="${Number(c.id)}" tabindex="0">
                <td class="princ"><b>${esc(c.nome)}</b><span>${esc(c.email)}</span></td>
                <td>${tagStatus(c.status)}</td>
                <td class="nw">${esc(c.plano_nome || '—')}${c.tem_limites_extra ? ` <span class="ic-extra" title="Tem limites individuais">${ic('star')}</span>` : ''}</td>
                <td><span class="uso-mini">
                    <span title="Placares ativos">${ic('tv')}<b>${Number(c.uso.placares)}</b></span>
                    <span title="Jogos em aberto (agendados ou ao vivo)">${ic('calendar')}<b>${Number(c.uso.jogos_abertos)}</b></span>
                    <span title="Usuários">${ic('users')}<b>${Number(c.uso.usuarios)}</b></span></span></td>
                <td class="nw">${fimDoTesteHtml(c)}</td>
                <td class="nw" title="${esc(MARQ.dataHora(c.ultimo_acesso_em))}">${relativo(c.ultimo_acesso_em)}</td>
            </tr>`).join('')}</tbody></table>`;
    }

    async function novoCliente() {
        let dados;
        try { dados = await carregarPlanos(true); } catch (e) { return avisar('Não foi possível carregar os planos', e.message); }
        const planos = dados.planos.filter(p => p.ativo);
        if (!planos.length) return avisar('Nenhum plano ativo', 'Crie ou ative um plano na aba Planos antes de cadastrar um cliente.');
        const corpo = `<p>Cadastro de uma venda feita por você. O administrador recebe um convite por e-mail para criar a senha. O primeiro placar (“Quadra 1”) já é criado.</p>
            <div class="grade-form">
                <label class="inteiro"><span class="rotulo">Nome do cliente (clube, escola…)</span><input class="campo" name="nome" required maxlength="120"></label>
                <label><span class="rotulo">Nome do administrador</span><input class="campo" name="nomeAdmin" maxlength="120" placeholder="Opcional"></label>
                <label><span class="rotulo">E-mail do administrador</span><input class="campo" name="email" type="email" required></label>
                <label><span class="rotulo">CPF ou CNPJ</span><input class="campo" name="documento" inputmode="numeric" placeholder="Opcional"></label>
                <label><span class="rotulo">Telefone</span><input class="campo" name="telefone" inputmode="tel" placeholder="Opcional"></label>
                <label class="inteiro"><span class="rotulo">Plano</span><select class="campo" name="plano_id">
                    ${planos.map(p => `<option value="${Number(p.id)}" data-dias="${Number(p.dias_teste)}">${esc(p.nome)} — ${esc(MARQ.dinheiro(p.preco_centavos))}/mês${p.publico ? '' : ' (sob medida)'}</option>`).join('')}
                </select></label>
                <label><span class="rotulo">Status inicial</span><select class="campo" name="status">
                    <option value="teste">Em teste</option><option value="ativo">Ativo</option></select></label>
                <label data-teste><span class="rotulo">Fim do teste</span><input class="campo" name="teste_ate" type="date"></label>
                <label class="inteiro"><span class="rotulo">Observações (só você vê)</span><textarea class="campo" name="observacoes" maxlength="2000"></textarea></label>
            </div>`;
        const criado = await abrirFolha({
            titulo: 'Novo cliente', corpo, sim: 'Cadastrar e convidar', larga: true,
            aoAbrir: (f) => {
                const atualizarData = () => {
                    const dias = Number(f.plano_id.selectedOptions[0].dataset.dias) || 14;
                    f.teste_ate.value = paraInputData(somarDias(new Date(), dias));
                };
                const atualizarStatus = () => { f.querySelector('[data-teste]').hidden = f.status.value !== 'teste'; };
                f.plano_id.addEventListener('change', atualizarData);
                f.status.addEventListener('change', atualizarStatus);
                atualizarData(); atualizarStatus();
            },
            aoEnviar: async (f) => {
                if (!f.nome.value.trim()) throw new Error('Informe o nome do cliente.');
                if (!f.email.value.trim()) throw new Error('Informe o e-mail do administrador.');
                const corpoReq = {
                    nome: f.nome.value.trim(), nomeAdmin: f.nomeAdmin.value.trim(), email: f.email.value.trim(),
                    documento: f.documento.value, telefone: f.telefone.value, plano_id: Number(f.plano_id.value),
                    status: f.status.value, observacoes: f.observacoes.value
                };
                if (corpoReq.status === 'teste') corpoReq.teste_ate = deInputData(f.teste_ate.value);
                return api('POST', '/api/admin/clientes', corpoReq);
            }
        });
        if (criado && criado.id) {
            toast(`Cliente criado. Convite enviado para ${criado.email}.`);
            location.hash = '#cliente/' + criado.id;
        }
    }

    // ================================================================ DETALHE DO CLIENTE
    async function telaCliente(id, vivo) {
        conteudo.innerHTML = `<a class="voltar" href="#clientes">${ic('voltar')} Clientes</a>${carregando()}`;
        const [d, planosResp, arte] = await Promise.all([
            api('GET', '/api/admin/clientes/' + id),
            carregarPlanos(true),
            api('GET', `/api/admin/clientes/${id}/arte`).catch(e => ({ erro: e.message }))
        ]);
        if (!vivo()) return;
        const c = d.cliente;
        document.title = `${c.nome} — MarQGol`;
        const planoAtual = d.plano;
        const recursos = planosResp.recursos || {};

        conteudo.innerHTML = `
            <div class="cab-cliente">
                <div>
                    <a class="voltar" href="#clientes">${ic('voltar')} Clientes</a>
                    <div class="secao-cab"><h1>${esc(c.nome)} ${tagStatus(c.status)}</h1></div>
                    <div class="meta">
                        <span>Identificador <code>${esc(c.slug)}</code></span>
                        <span>Cliente desde ${esc(MARQ.data(c.criado_em))}</span>
                        <span>Plano <b>${esc(planoAtual ? planoAtual.nome : '—')}</b></span>
                        ${c.asaas_assinatura_id ? `<span>Assinatura Asaas <code>${esc(c.asaas_assinatura_id)}</code></span>` : '<span>Sem assinatura no Asaas</span>'}
                        ${c.proximo_vencimento ? `<span>Próximo vencimento ${esc(dataCurta(c.proximo_vencimento))}</span>` : ''}
                    </div>
                </div>
                <div class="acoes">
                    <button type="button" class="btn" id="btn-reenviar">${ic('refresh')} Reenviar acesso</button>
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
                        <div class="linha-campo">
                            <select class="campo" id="sel-plano" aria-label="Plano">
                                ${planosResp.planos.map(p => `<option value="${Number(p.id)}" ${p.id === c.plano_id ? 'selected' : ''}>${esc(p.nome)} — ${esc(MARQ.dinheiro(p.preco_centavos))}/mês${p.ativo ? '' : ' (inativo)'}</option>`).join('')}
                                ${c.plano_id ? '' : '<option value="" selected>— sem plano —</option>'}
                            </select>
                            <button type="button" class="btn" id="btn-plano">Trocar</button>
                        </div>
                        <p class="ajuda">${c.asaas_assinatura_id ? 'Este cliente tem assinatura no Asaas: ao trocar, o valor é atualizado lá também.' : 'Sem assinatura no Asaas: a troca muda só os limites e recursos.'}</p>
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

            <div class="grade-detalhe">
                <section class="cartao">
                    <div class="cartao-cab"><h2>${ic('users')} Usuários</h2><span class="tag">${d.usuarios.length}</span></div>
                    <div class="tabela-caixa">${tabelaUsuarios(d.usuarios)}</div>
                </section>
                <section class="cartao">
                    <div class="cartao-cab"><h2>${ic('tv')} Placares</h2><span class="tag">${d.placares.length}</span></div>
                    <div class="tabela-caixa">${tabelaPlacares(d.placares)}</div>
                </section>
            </div>

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
        conteudo.querySelector('#btn-reenviar').addEventListener('click', async (ev) => {
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
        conteudo.querySelector('#btn-plano').addEventListener('click', async (ev) => {
            const novo = planosResp.planos.find(p => p.id === Number(conteudo.querySelector('#sel-plano').value));
            if (!novo) return;
            if (novo.id === c.plano_id) return toast('Esse já é o plano do cliente.');
            const ok = await confirmar({
                titulo: `Trocar para ${novo.nome}?`,
                texto: `Novo valor: ${MARQ.dinheiro(novo.preco_centavos)}/mês. Os limites e recursos passam a ser os do novo plano (ajustes individuais continuam valendo).\n` +
                    (c.asaas_assinatura_id ? 'O cliente tem assinatura no Asaas: o valor da assinatura será atualizado lá também.' : 'Sem assinatura no Asaas: nada muda na cobrança.'),
                sim: 'Trocar plano'
            });
            if (!ok) return;
            await comBotao(ev.currentTarget, async () => { await patch({ plano_id: novo.id }); toast('Plano trocado'); recarregar(); });
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

        desenharLimites(conteudo.querySelector('#cartao-limites'), d, planoAtual, recursos, patch, recarregar);
        desenharArte(conteudo.querySelector('#cartao-arte'), c.id, arte);
    }

    function tabelaUsuarios(lista) {
        if (!lista.length) return '<div class="vazio">Nenhum usuário.</div>';
        return `<table class="tabela"><thead><tr><th>Usuário</th><th>Papel</th><th>Último login</th></tr></thead><tbody>
            ${lista.map(u => `<tr>
                <td class="princ"><b>${esc(u.nome)}</b><span>${esc(u.email)}</span></td>
                <td><div class="tags"><span class="tag ${u.papel === 'admin' ? 'amarelo' : ''}">${u.papel === 'admin' ? 'Admin' : 'Operador'}</span>
                    ${u.convite_pendente ? '<span class="tag alerta">Convite pendente</span>' : ''}
                    ${u.ativo ? '' : '<span class="tag perigo">Inativo</span>'}</div></td>
                <td class="nw" title="${esc(MARQ.dataHora(u.ultimo_login_em))}">${relativo(u.ultimo_login_em)}</td>
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
                <p>Ajustes só para este cliente, por cima do plano. Campo vazio = usa o valor do plano.</p></div></div>
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

    // ================================================================ PLANOS
    async function telaPlanos(vivo) {
        document.title = 'Planos — MarQGol';
        conteudo.innerHTML = `<div class="secao-cab"><div><h1>Planos</h1></div></div>${carregando()}`;
        const { planos, recursos } = await carregarPlanos(true);
        if (!vivo()) return;
        conteudo.innerHTML = `
            <div class="secao-cab"><div><h1>Planos</h1><p>Limites e recursos de cada assinatura. Planos públicos aparecem no site e no cadastro; os outros são sob medida.</p></div>
                <button type="button" class="btn ok" id="btn-novo-plano">${ic('plus')} Novo plano</button></div>
            ${planos.length ? `<div class="planos-grade">${planos.map(p => `
                <article class="plano ${p.ativo ? '' : 'inativo'}">
                    <div class="plano-cab"><div><h2>${esc(p.nome)}</h2>
                        <div class="tags" style="margin-top:6px">
                            ${p.ativo ? '' : '<span class="tag perigo">Inativo</span>'}
                            ${p.publico ? '<span class="tag info">Público</span>' : '<span class="tag">Sob medida</span>'}
                            <span class="tag">${plural(Number(p.clientes) || 0, 'cliente', 'clientes')}</span>
                        </div></div>
                        <button type="button" class="btn icone" data-editar="${Number(p.id)}" title="Editar plano" aria-label="Editar ${esc(p.nome)}">${ic('edit')}</button>
                    </div>
                    <div class="preco">${esc(MARQ.dinheiro(p.preco_centavos))} <small>/mês</small></div>
                    ${p.descricao ? `<p class="desc">${esc(p.descricao)}</p>` : ''}
                    <dl>
                        ${CAMPOS.map(([k, rot]) => `<dt>${esc(rot)}</dt><dd>${esc(p[k])}</dd>`).join('')}
                        <dt>Dias de teste</dt><dd>${esc(p.dias_teste)}</dd>
                        <dt>Ordem</dt><dd>${esc(p.ordem)}</dd>
                    </dl>
                    <div class="tags">${(p.esportes || []).map(e => `<span class="tag">${esc(ESPORTES[e] || e)}</span>`).join('')}</div>
                    <div class="tags">${Object.entries(recursos).map(([k, def]) => {
                        const on = p.recursos && typeof p.recursos[k] === 'boolean' ? p.recursos[k] : def.padrao;
                        return `<span class="tag ${on ? 'ok' : ''}" title="${esc(def.rotulo)}">${on ? '✓' : '✕'} ${esc(def.rotulo)}</span>`;
                    }).join('')}</div>
                </article>`).join('')}</div>` : '<div class="cartao"><div class="vazio">Nenhum plano. Crie o primeiro.</div></div>'}`;
        conteudo.querySelector('#btn-novo-plano').addEventListener('click', () => editarPlano(null, recursos));
        conteudo.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', () =>
            editarPlano(planos.find(p => p.id === Number(b.dataset.editar)), recursos)));
    }

    async function editarPlano(plano, recursos) {
        const p = plano || { nome: '', descricao: '', preco_centavos: 0, max_placares: 1, max_jogos_abertos: 10, max_usuarios: 3, max_armazenamento_mb: 1024, esportes: Object.keys(ESPORTES), recursos: {}, dias_teste: 14, publico: true, ativo: true, ordem: 0 };
        const recOn = (k) => p.recursos && typeof p.recursos[k] === 'boolean' ? p.recursos[k] : recursos[k].padrao;
        const corpo = `
            ${plano && plano.clientes ? `<div class="aviso-caixa info" style="margin-bottom:12px">${ic('info')}<div>${plural(Number(plano.clientes), 'cliente usa', 'clientes usam')} este plano: novos limites valem na hora. Mudar o preço aqui <b>não</b> altera assinaturas já criadas no Asaas.</div></div>` : ''}
            <div class="grade-form">
                <label><span class="rotulo">Nome</span><input class="campo" name="nome" value="${esc(p.nome)}" maxlength="60" required></label>
                <label><span class="rotulo">Preço mensal (R$)</span><input class="campo" name="preco" inputmode="decimal" value="${esc(precoParaCampo(p.preco_centavos))}"></label>
                <label class="inteiro"><span class="rotulo">Descrição</span><textarea class="campo" name="descricao" maxlength="400" style="min-height:72px">${esc(p.descricao)}</textarea></label>
                ${CAMPOS.map(([k, rot]) => `<label><span class="rotulo">${esc(rot)}</span><input class="campo" type="number" min="0" step="1" name="${k}" value="${esc(p[k])}"></label>`).join('')}
                <label><span class="rotulo">Dias de teste</span><input class="campo" type="number" min="0" max="90" step="1" name="dias_teste" value="${esc(p.dias_teste)}"></label>
                <label><span class="rotulo">Ordem (no site)</span><input class="campo" type="number" step="1" name="ordem" value="${esc(p.ordem)}"></label>
                <div class="inteiro"><span class="rotulo">Esportes</span><div class="opcoes-linha">
                    ${Object.entries(ESPORTES).map(([k, rot]) => `<label class="marcar"><input type="checkbox" name="esporte" value="${k}" ${(p.esportes || []).includes(k) ? 'checked' : ''}> ${rot}</label>`).join('')}
                </div></div>
                <div class="inteiro"><span class="rotulo">Recursos</span><div class="opcoes-linha">
                    ${Object.entries(recursos).map(([k, def]) => `<label class="marcar"><input type="checkbox" name="recurso" value="${esc(k)}" ${recOn(k) ? 'checked' : ''}> ${esc(def.rotulo)}</label>`).join('')}
                </div></div>
                <div class="inteiro"><span class="rotulo">Visibilidade</span><div class="opcoes-linha">
                    <label class="marcar"><input type="checkbox" name="publico" ${p.publico ? 'checked' : ''}> Público (aparece no site e no cadastro)</label>
                    <label class="marcar"><input type="checkbox" name="ativo" ${p.ativo ? 'checked' : ''}> Ativo (pode ser escolhido)</label>
                </div></div>
            </div>`;
        const salvo = await abrirFolha({
            titulo: plano ? `Editar ${plano.nome}` : 'Novo plano', corpo, larga: true, sim: plano ? 'Salvar plano' : 'Criar plano',
            aoEnviar: async (f) => {
                const preco = lerPreco(f.preco.value);
                if (!Number.isFinite(preco) || preco < 0) throw new Error('Preço inválido. Use, por exemplo, 49,90.');
                const corpoReq = {
                    nome: f.nome.value.trim(), descricao: f.descricao.value.trim(), preco_centavos: preco,
                    dias_teste: Number(f.dias_teste.value), ordem: Number(f.ordem.value) || 0,
                    esportes: [...f.querySelectorAll('[name=esporte]:checked')].map(i => i.value),
                    recursos: Object.fromEntries(Object.keys(recursos).map(k => [k, !!f.querySelector(`[name=recurso][value="${k}"]`).checked])),
                    publico: f.publico.checked, ativo: f.ativo.checked
                };
                if (!corpoReq.nome) throw new Error('Informe o nome do plano.');
                if (!corpoReq.esportes.length) throw new Error('Escolha ao menos um esporte.');
                for (const [k, rot] of CAMPOS) {
                    const n = Number(f[k].value);
                    if (f[k].value === '' || !Number.isInteger(n) || n < 0) throw new Error(`“${rot}” precisa ser um número inteiro (0 ou mais).`);
                    corpoReq[k] = n;
                }
                return plano ? api('PUT', '/api/admin/planos/' + plano.id, corpoReq) : api('POST', '/api/admin/planos', corpoReq);
            }
        });
        if (salvo) { toast(plano ? 'Plano salvo' : 'Plano criado'); rotear(); }
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
        const rotulos = { visao: ['chart', 'Visão geral'], clientes: ['users', 'Clientes'], planos: ['card', 'Planos'], auditoria: ['shield', 'Auditoria'] };
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
