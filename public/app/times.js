// Área do cliente — Times e jogadores: lista por esporte com busca,
// cadastro de time (com logo), elenco (número, nome, foto, vídeo) e importação
// de elenco por .txt/.csv.
(function () {
    const { ESPORTES, num } = APP;
    const filtro = { esporte: '', busca: '' };
    const ACEITA_IMAGEM = '.png,.jpg,.jpeg,.gif,.webp,.svg,image/*';

    const logoHtml = (url, grande = false) => `<span class="logo ${grande ? 'grande' : ''}">${url ? `<img src="${esc(url)}" alt="">` : ic('shield')}</span>`;

    APP.tela('times', async (ctx) => {
        if (ctx.param) return detalheTime(ctx, Number(ctx.param));
        const el = ctx.el;
        const esportes = APP.S.resumo.limites.esportes;
        if (filtro.esporte && !esportes.includes(filtro.esporte)) filtro.esporte = '';

        el.innerHTML = `
        ${APP.tituloPagina('Times e jogadores', 'Cadastre os times uma vez e use em todos os jogos.', `<button type="button" class="btn claro" data-acao="novo">${ic('plus')}Novo time</button>`)}
        <section class="cartao">
            <div class="filtros">
                <div class="segmentos compacto" role="radiogroup" aria-label="Esporte" style="flex:2 1 320px">
                    <label class="segmento"><input type="radio" name="f-esporte" value="" ${!filtro.esporte ? 'checked' : ''}>Todos</label>
                    ${esportes.map(e => `<label class="segmento"><input type="radio" name="f-esporte" value="${e}" ${filtro.esporte === e ? 'checked' : ''}>${esc(ESPORTES[e])}</label>`).join('')}
                </div>
                <label class="busca" style="flex:1 1 220px"><span class="rotulo" hidden>Buscar</span>${ic('search')}<input class="campo" type="search" name="f-busca" placeholder="Buscar time…" value="${esc(filtro.busca)}" aria-label="Buscar time"></label>
            </div>
            <div id="times-lista">${APP.carregando()}</div>
        </section>`;

        let atraso = null;
        async function desenhar() {
            const p = new URLSearchParams();
            if (filtro.esporte) p.set('esporte', filtro.esporte);
            if (filtro.busca) p.set('busca', filtro.busca);
            const times = await MARQ.api('GET', '/api/app/times?' + p);
            if (!ctx.ativo()) return;
            const lista = el.querySelector('#times-lista');
            if (!times.length) {
                lista.innerHTML = filtro.busca || filtro.esporte
                    ? APP.vazio('search', 'Nenhum time encontrado.', 'Mude a busca ou o esporte.')
                    : APP.vazio('users', 'Nenhum time cadastrado.', 'Crie o primeiro time no botão “Novo time”.');
                return;
            }
            lista.innerHTML = `<div class="grade-times">${times.map(t => `
                <a class="time-card" href="#times/${t.id}">
                    ${logoHtml(t.logo)}
                    <span class="txt"><b>${esc(t.nome)}</b><span>${esc(ESPORTES[t.esporte] || t.esporte)}${t.categoria ? ' · ' + esc(t.categoria) : ''} · ${num(t.jogadores)} jogador${num(t.jogadores) === 1 ? '' : 'es'}</span></span>
                    ${ic('right')}
                </a>`).join('')}</div>`;
        }
        el.onchange = (ev) => {
            if (ev.target.name === 'f-esporte') { filtro.esporte = ev.target.value; desenhar().catch(APP.falhou); }
        };
        el.oninput = (ev) => {
            if (ev.target.name !== 'f-busca') return;
            clearTimeout(atraso);
            atraso = setTimeout(() => { filtro.busca = ev.target.value.trim(); desenhar().catch(APP.falhou); }, 250);
        };
        el.onclick = (ev) => {
            if (ev.target.closest('[data-acao=novo]')) formTime(null, (t) => { location.hash = '#times/' + t.id; });
        };
        await desenhar();
    });

    // ---------------- Formulário de time ----------------
    function formTime(time, aposSalvar) {
        const esportes = APP.S.resumo.limites.esportes;
        const esporte0 = time ? time.esporte : (filtro.esporte || esportes[0]);
        let logo = time ? time.logo || '' : '';
        APP.folha({
            titulo: time ? 'Editar time' : 'Novo time',
            classe: 'media',
            corpo: `<div class="form-grade">
                <label class="inteira"><span class="rotulo">Nome do time</span><input class="campo" name="nome" maxlength="80" required value="${esc(time ? time.nome : '')}" placeholder="Ex.: Tigres FC"></label>
                <div class="inteira"><span class="rotulo">Esporte</span>
                    <div class="segmentos compacto" role="radiogroup">${esportes.map(e => `<label class="segmento"><input type="radio" name="esporte" value="${e}" ${e === esporte0 ? 'checked' : ''}>${esc(ESPORTES[e])}</label>`).join('')}</div></div>
                <label><span class="rotulo">Categoria (opcional)</span><input class="campo" name="categoria" maxlength="40" value="${esc(time ? time.categoria || '' : '')}" placeholder="Ex.: Sub-17, Feminino"></label>
                <div><span class="rotulo">Escudo / logo</span>
                    <div class="linha"><span id="logo-prev">${logoHtml(logo)}</span>
                    <button type="button" class="btn peq" data-logo="trocar">${ic('upload')}Enviar imagem</button>
                    <button type="button" class="btn peq leve" data-logo="tirar" ${logo ? '' : 'hidden'}>${ic('trash')}Tirar</button></div></div>
            </div>`,
            aoAbrir: (form) => {
                form.addEventListener('click', async (ev) => {
                    const b = ev.target.closest('[data-logo]');
                    if (!b) return;
                    if (b.dataset.logo === 'tirar') logo = '';
                    else {
                        const f = await APP.escolherArquivo(ACEITA_IMAGEM);
                        if (!f) return;
                        const url = await APP.acao(b, () => APP.enviarFoto(f));
                        if (!url) return;
                        logo = url;
                    }
                    form.querySelector('#logo-prev').innerHTML = logoHtml(logo);
                    form.querySelector('[data-logo=tirar]').hidden = !logo;
                });
            },
            aoEnviar: async (form) => {
                const nome = form.nome.value.trim();
                if (!nome) { await avisar('Falta o nome', 'Informe o nome do time.'); return false; }
                const corpo = { nome, esporte: (form.querySelector('input[name=esporte]:checked') || {}).value, categoria: form.categoria.value.trim(), logo };
                const t = time ? await MARQ.api('PATCH', '/api/app/times/' + time.id, corpo) : await MARQ.api('POST', '/api/app/times', corpo);
                toast(time ? 'Time atualizado.' : 'Time criado.');
                aposSalvar(t);
            }
        });
    }

    // ---------------- Detalhe do time e elenco ----------------
    async function detalheTime(ctx, id) {
        const el = ctx.el;
        const temVideo = !!APP.S.resumo.limites.recursos.video_jogador;
        const [times, jogadores] = await Promise.all([MARQ.api('GET', '/api/app/times'), MARQ.api('GET', `/api/app/times/${id}/jogadores`)]);
        if (!ctx.ativo()) return;
        let time = times.find(t => t.id === id);
        if (!time) {
            el.innerHTML = `<div class="cartao">${APP.vazio('users', 'Time não encontrado.', 'Ele pode ter sido removido.')}<div class="acoes" style="justify-content:center"><a class="btn" href="#times">${ic('voltar')}Voltar aos times</a></div></div>`;
            return;
        }

        const linhaJogador = (j) => `<div class="jogador" data-id="${j.id}">
            <button type="button" class="foto ${j.foto ? 'tem' : ''}" data-j="foto" aria-label="Foto de ${esc(j.nome)}" title="Foto">${j.foto ? `<img src="${esc(j.foto)}" alt="">` : ic('camera')}</button>
            <input class="campo num" name="numero" value="${esc(j.numero)}" maxlength="4" inputmode="numeric" aria-label="Número">
            <input class="campo nome" name="nome" value="${esc(j.nome)}" maxlength="80" aria-label="Nome">
            ${temVideo ? `<button type="button" class="foto video ${j.video ? 'tem' : ''}" data-j="video" aria-label="Vídeo de apresentação" title="${j.video ? 'Vídeo enviado' : 'Enviar vídeo de apresentação'}">${ic('video')}</button>` : ''}
            <button type="button" class="btn peq icone perigo" data-j="remover" aria-label="Remover ${esc(j.nome)}" title="Remover">${ic('trash')}</button>
        </div>`;

        function desenharTopo() {
            el.querySelector('#time-topo').innerHTML = `
                <div class="linha" style="gap:16px;align-items:center">
                    ${logoHtml(time.logo, true)}
                    <div style="flex:1;min-width:200px"><h2 style="margin:0;font-family:var(--f-rot);font-weight:800;font-size:30px;text-transform:uppercase;letter-spacing:.03em">${esc(time.nome)}</h2>
                        <p class="ajuda">${esc(ESPORTES[time.esporte] || time.esporte)}${time.categoria ? ' · ' + esc(time.categoria) : ''}</p></div>
                    <div class="acoes"><button type="button" class="btn" data-acao="editar">${ic('edit')}Editar</button>
                        <button type="button" class="btn perigo" data-acao="remover-time">${ic('trash')}Remover</button></div>
                </div>`;
        }
        function desenharElenco(lista) {
            el.querySelector('#elenco-n').textContent = `${lista.length} jogador${lista.length === 1 ? '' : 'es'}`;
            el.querySelector('#elenco').innerHTML = lista.length
                ? lista.map(linhaJogador).join('')
                : APP.vazio('users', 'Nenhum jogador ainda.', 'Adicione abaixo ou importe uma lista.');
        }
        async function recarregarElenco() {
            const lista = await MARQ.api('GET', `/api/app/times/${id}/jogadores`);
            if (ctx.ativo()) desenharElenco(lista);
        }

        el.innerHTML = `
        <div><a class="btn leve peq" href="#times">${ic('voltar')}Todos os times</a></div>
        <section class="cartao" id="time-topo"></section>
        <section class="cartao">
            <div class="cartao-cab"><div><h2>Elenco</h2><p><span id="elenco-n"></span> · alterações de número e nome são salvas ao sair do campo.</p></div>
                <button type="button" class="btn" data-acao="importar">${ic('file')}Importar lista</button></div>
            <form class="novo-jogador" id="novo-jogador">
                <input class="campo num" name="numero" maxlength="4" inputmode="numeric" placeholder="Nº" aria-label="Número do novo jogador">
                <input class="campo nome" name="nome" maxlength="80" placeholder="Nome do jogador" aria-label="Nome do novo jogador">
                <button type="submit" class="btn claro">${ic('plus')}<span>Adicionar</span></button>
            </form>
            <div class="jogadores" id="elenco"></div>
            <details class="ajuda-import"><summary>Como importar uma lista</summary>
                <p class="ajuda">Arquivo <b>.txt</b> ou <b>.csv</b>, um jogador por linha: número e nome separados por ponto e vírgula, vírgula ou TAB. O número é opcional.</p>
                <pre class="exemplo">10;João da Silva\n7;Pedro Souza\n1,Carlos Lima\nMárcio Alves</pre>
            </details>
        </section>`;
        desenharTopo();
        desenharElenco(jogadores);

        el.onsubmit = async (ev) => {
            ev.preventDefault();
            const f = ev.target;
            if (f.id !== 'novo-jogador') return;
            const nome = f.nome.value.trim();
            if (!nome) { f.nome.focus(); return; }
            await APP.acao(f.querySelector('button'), async () => {
                await MARQ.api('POST', `/api/app/times/${id}/jogadores`, { numero: f.numero.value.trim(), nome });
                f.reset();
                f.numero.focus();
                await recarregarElenco();
            });
        };

        // Número/nome: salva ao sair do campo.
        el.onchange = async (ev) => {
            const linha = ev.target.closest('.jogador[data-id]');
            if (!linha || !['numero', 'nome'].includes(ev.target.name)) return;
            const valor = ev.target.value.trim();
            if (ev.target.name === 'nome' && !valor) { toast('O nome não pode ficar vazio.'); await recarregarElenco(); return; }
            try {
                await MARQ.api('PATCH', '/api/app/jogadores/' + linha.dataset.id, { [ev.target.name]: valor });
                toast('Salvo.');
            } catch (e) { APP.falhou(e); }
        };

        el.onclick = async (ev) => {
            const b = ev.target.closest('[data-acao], [data-j]');
            if (!b) return;
            const linha = b.closest('.jogador[data-id]');
            const jid = linha && Number(linha.dataset.id);
            switch (b.dataset.acao || b.dataset.j) {
                case 'editar':
                    formTime(time, (t) => { time = { ...time, ...t }; desenharTopo(); });
                    break;
                case 'remover-time': {
                    const ok = await confirmar({ titulo: 'Remover time?', texto: `“${time.nome}” sai da lista de times. Jogos antigos continuam com o nome dele.`, sim: 'Remover', perigo: true });
                    if (!ok) return;
                    await APP.acao(b, async () => { await MARQ.api('DELETE', '/api/app/times/' + id); toast('Time removido.'); location.hash = '#times'; });
                    break;
                }
                case 'importar': await importar(b); break;
                case 'foto': {
                    const f = await APP.escolherArquivo(ACEITA_IMAGEM);
                    if (!f) return;
                    await APP.acao(b, async () => {
                        const url = await APP.enviarFoto(f);
                        await MARQ.api('PATCH', '/api/app/jogadores/' + jid, { foto: url });
                        toast('Foto atualizada.');
                        await recarregarElenco();
                    });
                    break;
                }
                case 'video': await video(b, jid, linha); break;
                case 'remover': {
                    const nome = linha.querySelector('[name=nome]').value;
                    const ok = await confirmar({ titulo: 'Remover jogador?', texto: `${nome} sai do elenco deste time.`, sim: 'Remover', perigo: true });
                    if (!ok) return;
                    await APP.acao(b, async () => { await MARQ.api('DELETE', '/api/app/jogadores/' + jid); await recarregarElenco(); });
                    break;
                }
            }
        };

        async function enviarVideo(jid) {
            const f = await APP.escolherArquivo('.mp4,.webm,video/mp4,video/webm');
            if (!f) return false;
            toast('Enviando vídeo…');
            const r = await MARQ.enviarArquivo('/api/app/arquivos/video-jogador?nome=' + encodeURIComponent(f.name), f);
            await MARQ.api('PATCH', '/api/app/jogadores/' + jid, { video: r.url });
            toast('Vídeo enviado.');
            await recarregarElenco();
            return true;
        }

        async function video(b, jid) {
            const lista = await MARQ.api('GET', `/api/app/times/${id}/jogadores`);
            const j = lista.find(x => x.id === jid);
            if (!j || !j.video) { await APP.acao(b, () => enviarVideo(jid)); return; }
            APP.folha({
                titulo: 'Vídeo de apresentação',
                sub: esc(j.nome),
                corpo: `<video src="${esc(j.video)}" controls preload="metadata" style="width:100%;border-radius:12px;background:#000;max-height:50vh"></video>`,
                botoes: [
                    { rotulo: 'Remover vídeo', classe: 'perigo', aoClicar: async (_f, fechar) => { await MARQ.api('PATCH', '/api/app/jogadores/' + jid, { video: '' }); fechar(); toast('Vídeo removido.'); await recarregarElenco(); } },
                    { rotulo: 'Trocar vídeo', aoClicar: async (_f, fechar) => { fechar(); await enviarVideo(jid); } },
                    { rotulo: 'Fechar', cancelar: true, classe: 'claro' }
                ]
            });
        }

        async function importar(b) {
            const f = await APP.escolherArquivo('.txt,.csv,text/plain,text/csv');
            if (!f) return;
            const texto = await f.text();
            const lista = lerLista(texto);
            if (!lista.length) { await avisar('Nada para importar', 'Não encontramos jogadores no arquivo. Use uma linha por jogador: número;nome.'); return; }
            const amostra = lista.slice(0, 6).map(j => `${j.numero ? j.numero + ' — ' : ''}${j.nome}`).join('\n');
            const ok = await confirmar({ titulo: `Importar ${lista.length} jogador${lista.length === 1 ? '' : 'es'}?`, texto: `Eles serão adicionados ao elenco de ${time.nome}.\n${amostra}${lista.length > 6 ? '\n…' : ''}`, sim: 'Importar' });
            if (!ok) return;
            await APP.acao(b, async () => {
                for (let i = 0; i < lista.length; i += 200) {
                    await MARQ.api('POST', `/api/app/times/${id}/jogadores`, { jogadores: lista.slice(i, i + 200) });
                }
                toast(`${lista.length} jogador${lista.length === 1 ? '' : 'es'} importado${lista.length === 1 ? '' : 's'}.`);
                await recarregarElenco();
            });
        }
    }

    // "número;nome" por linha (separadores ; , TAB). Ignora cabeçalho e linhas vazias.
    function lerLista(texto) {
        const saida = [];
        for (const bruta of String(texto).replace(/^﻿/, '').split(/\r?\n/)) {
            const linha = bruta.trim();
            if (!linha) continue;
            const partes = linha.split(/[;,\t]/).map(s => s.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
            if (!partes.length) continue;
            let numero = '', nome;
            if (partes.length > 1 && /^\d{1,4}$/.test(partes[0])) { numero = partes[0]; nome = partes.slice(1).join(' '); }
            else if (partes.length > 1 && /^\d{1,4}$/.test(partes[partes.length - 1])) { numero = partes.pop(); nome = partes.join(' '); }
            else nome = partes.join(' ');
            if (/^(n[uú]mero|n[º°o]?|num)$/i.test(partes[0]) || /^nome$/i.test(nome)) continue; // cabeçalho
            saida.push({ numero, nome: nome.slice(0, 80) });
        }
        return saida;
    }
})();
