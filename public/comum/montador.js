// Montador do plano on demand (site, cadastro, área do cliente e painel).
// Sem dependências além de ui.js (esc, ic) e marq.js (MARQ.dinheiro).
//
//   const m = MONTADOR.criar(elemento, {
//       tabela,            // GET /api/publico/precos (ou o mesmo formato)
//       composicao,        // { placares, pacotes_usuarios_extras, recursos: {..} }
//       teto: true,        // limita ao autoatendimento (false no painel)
//       compacto: false,   // sem o detalhamento do total
//       aoMudar: (comp, preco) => {}
//   });
//   m.composicao()  → composição atual
//   m.preco()       → { total, itens }
//
// O cálculo espelha src/limites.js (precoDaComposicao). Só mostra: quem decide
// o valor é sempre o servidor.
(function () {
    const CURTO = { midia: 'Comerciais, slides e patrocinadores', video_jogador: 'Vídeo do atleta', arte_propria: 'Arte própria do telão' };
    const DETALHE = {
        midia: 'Vídeos e slides em tela cheia e carrossel de logos dos patrocinadores.',
        video_jogador: 'Atleta com vídeo de apresentação aparece antes da faixa de ponto.',
        arte_propria: 'Fundo, cores e caixas do placar com a identidade do clube.'
    };
    const RECURSOS = ['midia', 'video_jogador', 'arte_propria'];

    function normalizar(c, tabela, teto) {
        const x = c && typeof c === 'object' ? c : {};
        const inteiro = (v, min) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(n, min) : min; };
        let placares = inteiro(x.placares, 1), pacotes = inteiro(x.pacotes_usuarios_extras, 0);
        if (teto) {
            placares = Math.min(placares, tabela.max_placares_autoatendimento);
            pacotes = Math.min(pacotes, tabela.max_pacotes_autoatendimento);
        }
        const recursos = {};
        for (const k of RECURSOS) recursos[k] = !!(x.recursos && x.recursos[k]);
        return { placares, pacotes_usuarios_extras: pacotes, recursos };
    }

    function preco(c, tabela) {
        const comp = normalizar(c, tabela, false);
        const itens = [{ rotulo: `${comp.placares} placar${comp.placares === 1 ? '' : 'es'}`, subtotal: comp.placares * tabela.preco_placar_centavos }];
        const n = comp.pacotes_usuarios_extras;
        itens.push({
            rotulo: n ? `+${n * tabela.usuarios_por_pacote} usuários (${n} pacote${n === 1 ? '' : 's'})` : `${tabela.usuarios_por_pacote} usuários`,
            subtotal: n * tabela.preco_pacote_usuarios_centavos, incluso: !n
        });
        for (const k of RECURSOS) {
            if (comp.recursos[k]) itens.push({ rotulo: CURTO[k], subtotal: Number((tabela.precos_recursos || {})[k]) || 0 });
        }
        return { composicao: comp, itens, total: itens.reduce((s, i) => s + i.subtotal, 0) };
    }

    function resumo(c, tabela) {
        const comp = normalizar(c, tabela, false);
        const curtos = { midia: 'mídia', video_jogador: 'vídeo do atleta', arte_propria: 'arte própria' };
        const rec = RECURSOS.filter(k => comp.recursos[k]).map(k => curtos[k]);
        const usuarios = (1 + comp.pacotes_usuarios_extras) * ((tabela && tabela.usuarios_por_pacote) || 10);
        return [`${comp.placares} placar${comp.placares === 1 ? '' : 'es'}`, `${usuarios} usuários`, ...(rec.length ? [rec.join(', ')] : [])].join(' · ');
    }

    const gb = (mb) => mb >= 1024 ? `${Math.round(mb / 1024 * 10) / 10} GB`.replace('.', ',') : `${mb} MB`;

    function criar(el, { tabela, composicao, teto = true, compacto = false, aoMudar } = {}) {
        let comp = normalizar(composicao || { placares: 1 }, tabela, teto);
        const maxPl = teto ? tabela.max_placares_autoatendimento : 999;
        const maxPac = teto ? tabela.max_pacotes_autoatendimento : 999;
        const din = (c) => MARQ.dinheiro(c);

        el.classList.add('montador');
        el.innerHTML = `
            <div class="mt-linha">
                <div class="mt-txt"><b>Placares</b><span>${esc(din(tabela.preco_placar_centavos))} por placar/mês. Cada um traz ${tabela.jogos_por_placar} jogos agendados em aberto e ${esc(gb(tabela.armazenamento_mb_por_placar))} para fotos e vídeos.</span></div>
                <div class="mt-passo" role="group" aria-label="Quantidade de placares">
                    <button type="button" data-p="-1" aria-label="Menos um placar">−</button>
                    <output data-v="placares" aria-live="polite"></output>
                    <button type="button" data-p="1" aria-label="Mais um placar">+</button>
                </div>
            </div>
            <div class="mt-linha">
                <div class="mt-txt"><b>Usuários</b><span>${tabela.usuarios_por_pacote} incluídos. Mais ${tabela.usuarios_por_pacote} por ${esc(din(tabela.preco_pacote_usuarios_centavos))}/mês.</span></div>
                <div class="mt-passo" role="group" aria-label="Quantidade de usuários">
                    <button type="button" data-u="-1" aria-label="Menos ${tabela.usuarios_por_pacote} usuários">−</button>
                    <output data-v="usuarios" aria-live="polite"></output>
                    <button type="button" data-u="1" aria-label="Mais ${tabela.usuarios_por_pacote} usuários">+</button>
                </div>
            </div>
            <div class="mt-rotulo">Recursos especiais</div>
            <div class="mt-recursos">${RECURSOS.map(k => `
                <label class="mt-recurso"><input type="checkbox" data-r="${k}">
                    <span class="mt-check">${ic('check')}</span>
                    <span class="mt-txt"><b>${esc(CURTO[k])}</b><span>${esc(DETALHE[k])}</span></span>
                    <span class="mt-preco">+ ${esc(din((tabela.precos_recursos || {})[k] || 0))}</span>
                </label>`).join('')}
            </div>
            <div class="mt-total">
                ${compacto ? '' : '<ul class="mt-itens" data-v="itens"></ul>'}
                <div class="mt-soma"><span>Total</span><b data-v="total"></b><small>/mês</small></div>
            </div>`;

        function desenhar() {
            const p = preco(comp, tabela);
            el.querySelector('[data-v=placares]').textContent = comp.placares;
            el.querySelector('[data-v=usuarios]').textContent = (1 + comp.pacotes_usuarios_extras) * tabela.usuarios_por_pacote;
            el.querySelector('[data-p="-1"]').disabled = comp.placares <= 1;
            el.querySelector('[data-p="1"]').disabled = comp.placares >= maxPl;
            el.querySelector('[data-u="-1"]').disabled = comp.pacotes_usuarios_extras <= 0;
            el.querySelector('[data-u="1"]').disabled = comp.pacotes_usuarios_extras >= maxPac;
            for (const k of RECURSOS) el.querySelector(`[data-r="${k}"]`).checked = comp.recursos[k];
            el.querySelector('[data-v=total]').textContent = din(p.total);
            const ul = el.querySelector('[data-v=itens]');
            if (ul) ul.innerHTML = p.itens.map(i => `<li><span>${esc(i.rotulo)}</span><span>${i.incluso ? 'incluso' : esc(din(i.subtotal))}</span></li>`).join('');
            return p;
        }

        el.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-p],[data-u]');
            if (!b || b.disabled) return;
            if (b.dataset.p) comp.placares = Math.min(Math.max(comp.placares + Number(b.dataset.p), 1), maxPl);
            else comp.pacotes_usuarios_extras = Math.min(Math.max(comp.pacotes_usuarios_extras + Number(b.dataset.u), 0), maxPac);
            const p = desenhar();
            if (aoMudar) aoMudar(api.composicao(), p);
        });
        el.addEventListener('change', (ev) => {
            const r = ev.target.closest('[data-r]');
            if (!r) return;
            comp.recursos[r.dataset.r] = r.checked;
            const p = desenhar();
            if (aoMudar) aoMudar(api.composicao(), p);
        });

        const api = {
            composicao: () => JSON.parse(JSON.stringify(comp)),
            preco: () => preco(comp, tabela),
            definir(c) { comp = normalizar(c, tabela, teto); desenhar(); }
        };
        desenhar();
        return api;
    }

    // Composição na URL (site → cadastro): ?placares=2&usuarios=1&recursos=midia,arte_propria
    function daUrl(params) {
        if (!params.has('placares')) return null;
        const rec = String(params.get('recursos') || '').split(',');
        return {
            placares: Number(params.get('placares')), pacotes_usuarios_extras: Number(params.get('usuarios') || 0),
            recursos: Object.fromEntries(RECURSOS.map(k => [k, rec.includes(k)]))
        };
    }
    function paraUrl(c) {
        const rec = RECURSOS.filter(k => c.recursos && c.recursos[k]);
        return `placares=${c.placares}&usuarios=${c.pacotes_usuarios_extras || 0}${rec.length ? '&recursos=' + rec.join(',') : ''}`;
    }

    window.MONTADOR = { criar, preco, resumo, normalizar, daUrl, paraUrl, RECURSOS, CURTO };
})();
