// Área do cliente do MarQGol (/app/): núcleo da página única.
//
// Este arquivo monta a casca (cabeçalho, menu, faixas de aviso), o roteador
// pelo hash (#inicio, #agenda, #times/12…) e os utilitários usados pelas telas.
// Cada tela fica no próprio arquivo (agenda.js, times.js, placares.js,
// midia.js, arte.js, gestao.js) e se registra com APP.tela(id, render).
//
// Todo texto vindo da API passa por esc() antes de virar HTML.
(function () {
    const $ = (sel, raiz = document) => raiz.querySelector(sel);

    const ESPORTES = { futsal: 'Futsal', basquete: 'Basquete', volei: 'Vôlei' };
    const RECURSOS = {
        midia: 'Comerciais, slides e patrocinadores',
        video_jogador: 'Vídeo de apresentação do jogador',
        arte_propria: 'Arte própria no telão'
    };
    const STATUS_CLIENTE = {
        teste: ['Em teste', 'info'], ativo: ['Ativo', 'ok'], inadimplente: ['Pagamento pendente', 'alerta'],
        suspenso: ['Suspenso', 'perigo'], cancelado: ['Cancelado', 'perigo']
    };

    // Menu: `admin` = só aparece para o administrador da conta.
    const ABAS = [
        { id: 'inicio', rotulo: 'Início', icone: 'home' },
        { id: 'agenda', rotulo: 'Agenda', icone: 'calendar' },
        { id: 'times', rotulo: 'Times', icone: 'users' },
        { id: 'placares', rotulo: 'Placares', icone: 'tv' },
        { id: 'midia', rotulo: 'Mídia', icone: 'film' },
        { id: 'arte', rotulo: 'Arte do telão', icone: 'palette', admin: true, grupo: 'Administração' },
        { id: 'usuarios', rotulo: 'Usuários', icone: 'shield', admin: true },
        { id: 'assinatura', rotulo: 'Assinatura', icone: 'card', admin: true },
        { id: 'conta', rotulo: 'Conta', rotuloOperador: 'Meu perfil', icone: 'user' }
    ];

    const S = { resumo: null };
    const folhasAbertas = new Set();
    const telas = {};
    let geracao = 0;

    // ---------------- Utilitários ----------------
    const num = (v) => Number(v) || 0;
    const ehAdmin = () => !!S.resumo && S.resumo.usuario.papel === 'admin';
    const pad = (n) => String(n).padStart(2, '0');

    // 'YYYY-MM-DD' no fuso do navegador.
    function dataLocal(d = new Date()) {
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    // ISO → valor de <input type="datetime-local">.
    function isoParaLocal(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return `${dataLocal(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    // Valor de <input type="datetime-local"> → ISO (com o fuso do navegador).
    function localParaIso(valor) {
        if (!valor) return '';
        const d = new Date(valor);
        return isNaN(d) ? '' : d.toISOString();
    }
    const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const diaExtenso = (iso) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    function tamanho(bytes) {
        const b = num(bytes);
        if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
        if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
        return `${(b / 1024 / 1024 / 1024).toFixed(2).replace('.', ',')} GB`;
    }
    const mb = (v) => num(v) >= 1024 ? `${(num(v) / 1024).toFixed(num(v) % 1024 ? 1 : 0).replace('.', ',')} GB` : `${num(v)} MB`;

    // Barra de uso × limite.
    function barra(uso, limite) {
        const p = limite > 0 ? Math.min(100, (uso / limite) * 100) : 100;
        const cls = p >= 100 ? 'cheio' : p >= 80 ? 'alto' : '';
        return `<div class="barra ${cls}" role="progressbar" aria-valuemin="0" aria-valuemax="${limite}" aria-valuenow="${uso}"><i style="width:${p}%"></i></div>`;
    }

    function vazio(icone, titulo, texto = '') {
        return `<div class="vazio">${ic(icone)}<b>${esc(titulo)}</b>${texto ? esc(texto) : ''}</div>`;
    }
    const carregando = (txt = 'Carregando…') => `<div class="carregando"><span class="girando"></span>${esc(txt)}</div>`;

    // Erro de uma chamada: mostra a mensagem do servidor com o título certo.
    function falhou(e, titulo = 'Não deu certo') {
        console.error(e);
        if (e && (e.codigo === 'assinatura_suspensa' || e.status === 402)) {
            return avisar('Assinatura suspensa', (e.message || '') + '\nVá em Assinatura para regularizar.');
        }
        if (e && (e.codigo === 'limite' || e.status === 413)) return avisar('Limite do plano', e.message);
        return avisar(titulo, (e && e.message) || 'Erro inesperado. Tente de novo.');
    }

    // Executa uma ação de botão: desabilita enquanto roda e trata o erro.
    async function acao(botao, fn) {
        if (botao) botao.disabled = true;
        try { return await fn(); } catch (e) { falhou(e); return undefined; } finally { if (botao) botao.disabled = false; }
    }

    // Folha (diálogo) com formulário. `botoes`: [{ rotulo, classe, cancelar, enviar, aoClicar }].
    // O botão `enviar` dispara `aoEnviar(form)`; se ela devolver false ou
    // lançar, a folha continua aberta (o erro aparece por cima).
    function folha({ titulo, sub = '', corpo = '', classe = '', botoes, aoEnviar, aoAbrir, aoFechar }) {
        const lista = botoes || [
            { rotulo: 'Cancelar', cancelar: true },
            { rotulo: 'Salvar', classe: 'claro', enviar: true }
        ];
        const veu = document.createElement('div');
        veu.className = 'veu';
        veu.innerHTML = `<form class="folha ${classe}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}" novalidate>
            <div class="folha-cab"><h2>${esc(titulo)}</h2>${sub ? `<p>${sub}</p>` : ''}</div>
            <div class="folha-corpo">${corpo}</div>
            ${lista.length ? `<div class="folha-pe">${lista.map((b, i) => `<button type="${b.enviar ? 'submit' : 'button'}" class="btn ${b.classe || ''}" data-b="${i}">${b.icone ? ic(b.icone) : ''}${esc(b.rotulo)}</button>`).join('')}</div>` : ''}
        </form>`;
        const form = veu.querySelector('form');
        let fechado = false;
        const fechar = () => {
            if (fechado) return;
            fechado = true;
            folhasAbertas.delete(fechar);
            veu.remove();
            document.removeEventListener('keydown', teclas);
            if (aoFechar) aoFechar();
        };
        // Esc só fecha se esta for a folha de cima (um avisar() pode estar aberto).
        const teclas = (ev) => {
            if (ev.key !== 'Escape') return;
            const veus = document.querySelectorAll('.veu');
            if (veus[veus.length - 1] === veu) fechar();
        };
        veu.addEventListener('mousedown', (ev) => { if (ev.target === veu) fechar(); });
        form.addEventListener('click', async (ev) => {
            const b = ev.target.closest('[data-b]');
            if (!b) return;
            const def = lista[Number(b.dataset.b)];
            if (def.cancelar) { ev.preventDefault(); fechar(); return; }
            if (def.aoClicar) { ev.preventDefault(); await acao(b, () => def.aoClicar(form, fechar)); }
        });
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const b = form.querySelector('button[type="submit"]');
            if (!aoEnviar) return fechar();
            if (b) b.disabled = true;
            try {
                const r = await aoEnviar(form, fechar);
                if (r !== false) fechar();
            } catch (e) { falhou(e); } finally { if (b) b.disabled = false; }
        });
        document.addEventListener('keydown', teclas);
        folhasAbertas.add(fechar);
        document.body.appendChild(veu);
        if (aoAbrir) aoAbrir(form, fechar);
        const primeiro = form.querySelector('.folha-corpo input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox]), .folha-corpo select, .folha-corpo textarea');
        if (primeiro && matchMedia('(pointer: fine)').matches) primeiro.focus();
        return { form, fechar };
    }

    // Lê um <input type=file> escondido sem montar formulário.
    function escolherArquivo(accept, multiplo = false) {
        return new Promise((resolve) => {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = accept;
            inp.multiple = multiplo;
            inp.addEventListener('change', () => resolve(multiplo ? [...inp.files] : inp.files[0] || null));
            inp.click();
        });
    }

    // Foto de jogador / logo de time → URL /arquivos/... para gravar no cadastro.
    async function enviarFoto(arquivo) {
        const r = await MARQ.enviarArquivo('/api/app/arquivos/foto?nome=' + encodeURIComponent(arquivo.name), arquivo);
        return r.url;
    }

    // ---------------- Resumo, cabeçalho e faixas ----------------
    async function atualizarResumo() {
        S.resumo = await MARQ.api('GET', '/api/app/resumo');
        S.resumoEm = Date.now();
        desenharCasca();
        return S.resumo;
    }

    function diasAte(iso) {
        if (!iso) return null;
        return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
    }

    function desenharCasca() {
        const R = S.resumo;
        const u = R.usuario, c = R.cliente;
        $('#topo-cliente').textContent = c.nome;
        $('#topo-usuario').innerHTML = `${ic('user')}<span>${esc(u.nome)} <small>· ${u.papel === 'admin' ? 'Administrador' : 'Operador'}</small></span>`;
        const tagPlano = $('#topo-plano');
        tagPlano.hidden = !R.plano;
        if (R.plano) {
            // Plano on demand não tem nome: o chip mostra o essencial e o resumo completo fica no title.
            const n = num(R.limites && R.limites.max_placares) || num(R.plano.composicao && R.plano.composicao.placares);
            tagPlano.textContent = n ? `Plano · ${n} placar${n === 1 ? '' : 'es'}` : 'Plano sob medida';
            tagPlano.title = R.plano.resumo || '';
        }
        document.title = `MarQGol — ${c.nome}`;

        // Menu
        const aba = (location.hash.slice(1).split('/')[0]) || 'inicio';
        let grupoAtual = '';
        $('#menu-itens').innerHTML = ABAS.filter(a => !a.admin || ehAdmin()).map(a => {
            let sep = '';
            if (a.grupo && a.grupo !== grupoAtual) { grupoAtual = a.grupo; sep = `<div class="menu-sep">${esc(a.grupo)}</div>`; }
            const rot = !ehAdmin() && a.rotuloOperador ? a.rotuloOperador : a.rotulo;
            return `${sep}<a class="menu-item" href="#${a.id}" ${a.id === aba ? 'aria-current="page"' : ''}>${ic(a.icone)}<span>${esc(rot)}</span></a>`;
        }).join('');
        $('#btn-sair-menu').innerHTML = `${ic('logout')}<span>Sair</span>`;

        desenharFaixas();
    }

    function desenharFaixas() {
        const R = S.resumo;
        const u = R.usuario, c = R.cliente;
        const f = [];
        const botaoAssinar = (txt) => ehAdmin()
            ? `<a class="btn marca" href="#assinatura">${ic('card')}${esc(txt)}</a>`
            : '<span>Peça ao administrador da conta para regularizar.</span>';
        if (u.impersonando) {
            f.push(`<div class="faixa suporte">${ic('shield')}<span class="faixa-txt"><b>Você está como suporte neste cliente.</b> O que você fizer aqui fica registrado como suporte.</span>
                <button type="button" class="btn" data-faixa="sair-suporte">${ic('voltar')}Voltar ao painel</button></div>`);
        }
        if (c.status === 'suspenso' || c.status === 'cancelado') {
            f.push(`<div class="faixa perigo">${ic('lock')}<span class="faixa-txt"><b>${c.status === 'suspenso' ? 'Assinatura suspensa.' : 'Assinatura cancelada.'}</b> Você pode consultar seus dados, mas agendar jogos, operar placares e enviar arquivos fica bloqueado até regularizar.</span>${botaoAssinar('Ir para Assinatura')}</div>`);
        } else if (c.status === 'inadimplente') {
            const tol = num(R.diasTolerancia);
            let prazo = `em até ${tol} dias`;
            if (c.inadimplente_desde && tol) {
                const resta = diasAte(new Date(new Date(c.inadimplente_desde).getTime() + tol * 86400000).toISOString());
                prazo = resta > 0 ? `em até ${resta} dia${resta === 1 ? '' : 's'}` : 'o quanto antes';
            }
            f.push(`<div class="faixa alerta">${ic('alert')}<span class="faixa-txt"><b>Há uma fatura em atraso.</b> Pague ${esc(prazo)} para não ter o acesso suspenso.</span>${botaoAssinar('Ver faturas')}</div>`);
        } else if (c.status === 'teste') {
            const d = diasAte(c.teste_ate);
            const txt = d === null ? 'Você está no período de teste.'
                : d > 0 ? `Seu teste grátis termina em ${d} dia${d === 1 ? '' : 's'} (${MARQ.data(c.teste_ate)}).`
                : 'Seu teste grátis terminou hoje.';
            f.push(`<div class="faixa info">${ic('info')}<span class="faixa-txt"><b>${esc(txt)}</b> ${c.tem_assinatura ? 'Sua assinatura já está registrada.' : 'Assine para continuar usando sem interrupção.'}</span>${c.tem_assinatura ? '' : botaoAssinar('Assinar')}</div>`);
        }
        if (!u.emailVerificado && !u.impersonando && u.emailAtivo) {
            f.push(`<div class="faixa alerta">${ic('alert')}<span class="faixa-txt">Confirme seu e-mail <b>${esc(u.email)}</b> pelo link que enviamos.</span>
                <button type="button" class="btn" data-faixa="reenviar">${ic('refresh')}Reenviar e-mail</button></div>`);
        }
        $('#faixas').innerHTML = f.join('');
    }

    document.addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-faixa]');
        if (!b) return;
        if (b.dataset.faixa === 'reenviar') {
            await acao(b, async () => {
                const r = await MARQ.api('POST', '/api/auth/reenviar-verificacao');
                if (r && r.jaVerificado) { toast('Seu e-mail já está confirmado.'); await atualizarResumo(); }
                else toast('E-mail de confirmação enviado.');
            });
        } else if (b.dataset.faixa === 'sair-suporte') {
            await acao(b, async () => {
                const r = await MARQ.api('POST', '/api/admin/sair-cliente');
                location.href = (r && r.destino) || '/admin/';
            });
        }
    });

    async function sair() {
        try { await MARQ.api('POST', '/api/auth/sair'); } catch { /* sai mesmo assim */ }
        location.href = '/entrar';
    }

    // ---------------- Menu em tela estreita ----------------
    function abrirMenu(abrir) {
        document.body.classList.toggle('menu-aberto', abrir);
        $('#menu-veu').hidden = !abrir;
        $('#btn-menu').setAttribute('aria-expanded', String(abrir));
    }

    // ---------------- Roteador ----------------
    async function navegar() {
        const [id, ...resto] = (location.hash.slice(1) || 'inicio').split('/');
        let def = ABAS.find(a => a.id === id) || (id === 'perfil' ? ABAS.find(a => a.id === 'conta') : null);
        if (!def || (def.admin && !ehAdmin()) || !telas[def.id]) {
            if (location.hash && location.hash !== '#inicio') { location.replace('#inicio'); return; }
            def = ABAS[0];
        }
        abrirMenu(false);
        // Diálogo aberto não sobrevive à troca de tela.
        for (const f of [...folhasAbertas]) f();
        document.querySelectorAll('#menu-itens .menu-item').forEach(a => {
            if (a.getAttribute('href') === '#' + def.id) a.setAttribute('aria-current', 'page');
            else a.removeAttribute('aria-current');
        });
        const el = $('#conteudo');
        el.onclick = el.onchange = el.oninput = el.onsubmit = null;
        el.innerHTML = carregando();
        const tok = ++geracao;
        // Plano, limites e status podem ter mudado (outra aba, suporte, cobrança).
        if (Date.now() - (S.resumoEm || 0) > 5000) await atualizarResumo().catch(() => {});
        const ctx = { el, param: resto.join('/'), ativo: () => tok === geracao };
        try {
            await telas[def.id](ctx);
        } catch (e) {
            if (!ctx.ativo()) return;
            console.error(e);
            el.innerHTML = `<div class="cartao">${vazio('alert', 'Não foi possível carregar esta tela.', e.message || '')}
                <div class="acoes" style="justify-content:center"><button type="button" class="btn" onclick="APP.recarregar()">${ic('refresh')}Tentar de novo</button></div></div>`;
        }
    }

    function tituloPagina(titulo, sub = '', direita = '') {
        return `<div class="titulo-pagina"><div><h1>${esc(titulo)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${direita ? `<div class="acoes">${direita}</div>` : ''}</div>`;
    }

    // ---------------- Início ----------------
    function cartaoUso(icone, titulo, uso, limite, rotulo, ajuda = '') {
        return `<div class="uso">
            <div class="uso-cab">${ic(icone)}${esc(titulo)}</div>
            <div class="uso-num">${esc(rotulo ? rotulo(uso) : uso)} <small>de ${esc(rotulo ? rotulo(limite) : limite)}</small></div>
            ${barra(num(uso), num(limite))}
            ${ajuda ? `<div class="ajuda">${ajuda}</div>` : ''}
        </div>`;
    }

    function linkControle(id) { return `/p/${id}/controle/controle.html#preparar`; }
    function linkTelao(id) { return `/p/${id}/`; }

    telas.inicio = async (ctx) => {
        const agora = new Date().toISOString();
        const [R, proximos, aoVivo] = await Promise.all([
            atualizarResumo(),
            MARQ.api('GET', '/api/app/jogos?de=' + encodeURIComponent(agora)),
            MARQ.api('GET', '/api/app/jogos?status=ao_vivo')
        ]);
        if (!ctx.ativo()) return;
        const { limites: L, uso: U } = R;
        const jogos = [...aoVivo, ...proximos.filter(j => j.status === 'agendado' && !aoVivo.some(v => v.id === j.id))].slice(0, 8);
        const placares = R.placares || [];

        ctx.el.innerHTML = `
        ${tituloPagina('Olá, ' + (R.usuario.nome || '').split(' ')[0], 'Visão geral de ' + esc(R.cliente.nome) + (R.plano && R.plano.resumo ? ' · ' + esc(R.plano.resumo) : ''))}
        <section class="grade-uso" aria-label="Uso do plano">
            ${cartaoUso('tv', 'Placares ativos', num(U.max_placares), num(L.max_placares))}
            ${cartaoUso('calendar', 'Jogos em aberto', num(U.max_jogos_abertos), num(L.max_jogos_abertos), null, 'Agendados ou ao vivo')}
            ${cartaoUso('users', 'Usuários', num(U.max_usuarios), num(L.max_usuarios))}
            ${cartaoUso('upload', 'Armazenamento', num(U.max_armazenamento_mb), num(L.max_armazenamento_mb), mb, 'Mídia, fotos e arte')}
        </section>

        <section class="cartao">
            <div class="cartao-cab"><div><h2>Seus placares</h2><p>Abra o controle no tablet do operador e o telão na TV do ginásio.</p></div>
                <a class="btn" href="#placares">${ic('gear')}Gerenciar</a></div>
            ${placares.length ? `<div class="grade-placares">${placares.map(p => `
                <div class="placar-card ${p.ativo ? '' : 'inativo'}">
                    <div class="cab"><h3>${esc(p.nome)}</h3>${p.ativo ? '<span class="tag ok">Ativo</span>' : '<span class="tag">Desativado</span>'}</div>
                    <div class="meta"><span class="tag">${num(p.telas)} TV${num(p.telas) === 1 ? '' : 's'} pareada${num(p.telas) === 1 ? '' : 's'}</span>${p.jogo_id ? '<span class="tag vivo">Jogo carregado</span>' : ''}</div>
                    <div class="acoes">
                        ${p.ativo ? `<a class="btn claro" href="${linkControle(p.id)}">${ic('board')}Abrir controle</a>
                        <a class="btn" href="${linkTelao(p.id)}" target="_blank" rel="noopener">${ic('tv')}Abrir telão</a>`
                        : '<span class="ajuda">Ative este placar em Placares para usá-lo.</span>'}
                    </div>
                </div>`).join('')}</div>`
            : vazio('tv', 'Nenhum placar ainda.', ehAdmin() ? 'Crie o primeiro em Placares.' : 'Peça ao administrador para criar um placar.')}
        </section>

        <section class="cartao">
            <div class="cartao-cab"><div><h2>Próximos jogos</h2><p>Os jogos aparecem no controle para carregar com um toque.</p></div>
                <a class="btn" href="#agenda">${ic('calendar')}Ver agenda</a></div>
            ${jogos.length ? `<div class="lista">${jogos.map(j => APP.linhaJogo(j, { compacta: true })).join('')}</div>`
            : vazio('calendar', 'Nenhum jogo agendado.', 'Agende jogos na Agenda.')}
        </section>`;
    };

    // ---------------- Inicialização ----------------
    async function iniciar() {
        $('#btn-menu').addEventListener('click', () => abrirMenu(!document.body.classList.contains('menu-aberto')));
        $('#menu-veu').addEventListener('click', () => abrirMenu(false));
        $('#btn-sair-menu').addEventListener('click', sair);

        const q = new URLSearchParams(location.search);
        if (q.get('email') === 'confirmado') {
            history.replaceState(null, '', location.pathname + location.hash);
            setTimeout(() => toast('E-mail confirmado. Obrigado!'), 300);
        }
        try {
            await atualizarResumo();
        } catch (e) {
            if (e.status === 401) return; // MARQ.api já leva ao login
            $('#conteudo').innerHTML = `<div class="cartao">${vazio('alert', 'Não foi possível abrir a área do cliente.', e.message)}
                <div class="acoes" style="justify-content:center"><button type="button" class="btn" onclick="location.reload()">${ic('refresh')}Tentar de novo</button></div></div>`;
            return;
        }
        window.addEventListener('hashchange', navegar);
        navegar();
    }

    window.APP = {
        S, ESPORTES, RECURSOS, STATUS_CLIENTE, num, ehAdmin, dataLocal, isoParaLocal, localParaIso, hora, diaExtenso,
        tamanho, mb, barra, vazio, carregando, falhou, acao, folha, escolherArquivo, enviarFoto, atualizarResumo,
        tituloPagina, linkControle, linkTelao, sair,
        tela: (id, fn) => { telas[id] = fn; },
        recarregar: navegar
    };

    document.addEventListener('DOMContentLoaded', iniciar);
})();
