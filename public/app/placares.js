// Área do cliente — Placares (criar, renomear, ativar, excluir, parear TVs)
// e Mídia (comerciais, slides, patrocinadores).
(function () {
    const { num } = APP;
    const TIPOS_TELA = {
        telao: ['Telão', 'Arte completa, vídeos e patrocinadores'],
        simples: ['Placar simples', 'Só os números, fundo preto'],
        neutro: ['Placar neutro', 'Claro ou escuro, sem arte']
    };

    // ================= Placares =================
    APP.tela('placares', async (ctx) => {
        const el = ctx.el;
        const admin = APP.ehAdmin();

        async function desenhar() {
            const R = await APP.atualizarResumo();
            if (!ctx.ativo()) return;
            const placares = R.placares || [];
            const uso = num(R.uso.max_placares), lim = num(R.limites.max_placares);
            const telasPorPlacar = await Promise.all(placares.map(p => MARQ.api('GET', `/api/app/placares/${p.id}/telas`).catch(() => [])));
            if (!ctx.ativo()) return;
            el.innerHTML = `
            ${APP.tituloPagina('Placares', 'Cada placar é uma quadra: tem o próprio controle e as próprias TVs.',
                `<span class="contador ${uso >= lim ? 'cheio' : ''}"><b>${uso}</b> de <b>${lim}</b> placares ativos</span>
                 ${admin ? `<button type="button" class="btn claro" data-acao="novo">${ic('plus')}Novo placar</button>` : ''}`)}
            <div class="aviso-caixa info">${ic('tv')}<div><b>Para ligar uma TV:</b> na TV (ou no computador ligado a ela), abra <b>marqgol.artzan.tech/telao</b>. Aparece um código de 6 dígitos — toque em <b>Parear TV</b> no placar abaixo e digite o código.</div></div>
            ${placares.length ? `<div class="grade-placares">${placares.map((p, i) => cartaoPlacar(p, telasPorPlacar[i], admin)).join('')}</div>`
                : `<div class="cartao">${APP.vazio('tv', 'Nenhum placar ainda.', admin ? 'Crie o primeiro no botão “Novo placar”.' : 'Peça ao administrador da conta para criar um placar.')}</div>`}`;
        }

        el.onclick = async (ev) => {
            const b = ev.target.closest('[data-acao]');
            if (!b) return;
            const id = Number(b.dataset.id);
            const placar = (APP.S.resumo.placares || []).find(p => p.id === id);
            const atualizar = () => desenhar().catch(APP.falhou);
            switch (b.dataset.acao) {
                case 'novo': formNome(null, atualizar); break;
                case 'renomear': formNome(placar, atualizar); break;
                case 'ativo': {
                    const ativar = !placar.ativo;
                    if (!ativar) {
                        const ok = await confirmar({ titulo: 'Desativar placar?', texto: `O controle e as TVs de “${placar.nome}” param de funcionar até você reativar. Libera a vaga do plano.`, sim: 'Desativar', perigo: true });
                        if (!ok) return;
                    }
                    await APP.acao(b, async () => { await MARQ.api('PATCH', '/api/app/placares/' + id, { ativo: ativar }); toast(ativar ? 'Placar ativado.' : 'Placar desativado.'); await desenhar(); });
                    break;
                }
                case 'excluir': {
                    const ok = await confirmar({ titulo: 'Excluir placar?', texto: `“${placar.nome}” será apagado com as TVs pareadas e o estado do jogo. Os jogos da agenda continuam, sem placar definido.\nIsso não pode ser desfeito.`, sim: 'Excluir para sempre', perigo: true });
                    if (!ok) return;
                    await APP.acao(b, async () => { await MARQ.api('DELETE', '/api/app/placares/' + id); toast('Placar excluído.'); await desenhar(); });
                    break;
                }
                case 'parear': parear(placar, atualizar); break;
                case 'revogar': {
                    const ok = await confirmar({ titulo: 'Desconectar esta TV?', texto: `“${b.dataset.nome}” sai do placar na hora e volta a mostrar um código de pareamento.`, sim: 'Desconectar', perigo: true });
                    if (!ok) return;
                    await APP.acao(b, async () => { await MARQ.api('DELETE', '/api/app/telas/' + b.dataset.tela); toast('TV desconectada.'); await desenhar(); });
                    break;
                }
            }
        };
        await desenhar();
    });

    function cartaoPlacar(p, telas, admin) {
        const listaTelas = telas.length
            ? `<div class="telas-lista">${telas.map(t => `<div class="item">
                    ${ic('tv')}<div class="txt"><b>${esc(t.nome)}</b><span>${esc((TIPOS_TELA[t.tipo] || [t.tipo])[0])} · ${t.ultimo_acesso_em ? 'visto em ' + esc(MARQ.dataHora(t.ultimo_acesso_em)) : 'pareada em ' + esc(MARQ.dataHora(t.criado_em))}</span></div>
                    <button type="button" class="btn peq icone perigo" data-acao="revogar" data-tela="${t.id}" data-nome="${esc(t.nome)}" aria-label="Desconectar ${esc(t.nome)}" title="Desconectar">${ic('x')}</button>
                </div>`).join('')}</div>`
            : '<p class="ajuda">Nenhuma TV pareada.</p>';
        return `<div class="placar-card ${p.ativo ? '' : 'inativo'}">
            <div class="cab"><h3 title="${esc(p.nome)}">${esc(p.nome)}</h3>
                ${admin ? `<label class="chave-rot">${p.ativo ? 'Ativo' : 'Desativado'}<button type="button" class="chave ${p.ativo ? 'on' : ''}" role="switch" aria-checked="${p.ativo}" aria-label="Placar ativo" data-acao="ativo" data-id="${p.id}"></button></label>`
                : (p.ativo ? '<span class="tag ok">Ativo</span>' : '<span class="tag">Desativado</span>')}</div>
            ${p.ativo ? `<div class="acoes">
                <a class="btn claro" href="${APP.linkControle(p.id)}">${ic('board')}Abrir controle</a>
                <a class="btn" href="${APP.linkTelao(p.id)}" target="_blank" rel="noopener">${ic('tv')}Abrir telão</a>
            </div>` : '<p class="ajuda">Desativado: o controle e as TVs deste placar não abrem.</p>'}
            <div class="cartao-cab" style="align-items:center"><span class="rotulo" style="margin:0">TVs pareadas (${telas.length})</span>
                <button type="button" class="btn peq" data-acao="parear" data-id="${p.id}" ${p.ativo ? '' : 'disabled'}>${ic('link')}Parear TV</button></div>
            ${listaTelas}
            ${admin ? `<div class="acoes" style="border-top:1px solid var(--line);padding-top:10px">
                <button type="button" class="btn peq leve" data-acao="renomear" data-id="${p.id}">${ic('edit')}Renomear</button>
                <button type="button" class="btn peq leve" data-acao="excluir" data-id="${p.id}" style="color:#ffb4b4">${ic('trash')}Excluir</button>
            </div>` : ''}
        </div>`;
    }

    function formNome(placar, aposSalvar) {
        const R = APP.S.resumo;
        APP.folha({
            titulo: placar ? 'Renomear placar' : 'Novo placar',
            sub: placar ? '' : `Usa uma vaga do plano: ${num(R.uso.max_placares)} de ${num(R.limites.max_placares)} placares ativos.`,
            corpo: `<label><span class="rotulo">Nome</span><input class="campo" name="nome" maxlength="60" required value="${esc(placar ? placar.nome : '')}" placeholder="Ex.: Quadra 1"></label>`,
            botoes: [{ rotulo: 'Cancelar', cancelar: true }, { rotulo: placar ? 'Salvar' : 'Criar placar', classe: 'claro', enviar: true }],
            aoEnviar: async (form) => {
                const nome = form.nome.value.trim();
                if (!nome) { await avisar('Falta o nome', 'Dê um nome ao placar (ex.: Quadra 2).'); return false; }
                if (placar) await MARQ.api('PATCH', '/api/app/placares/' + placar.id, { nome });
                else await MARQ.api('POST', '/api/app/placares', { nome });
                toast(placar ? 'Placar renomeado.' : 'Placar criado.');
                aposSalvar();
            }
        });
    }

    function parear(placar, aposSalvar) {
        APP.folha({
            titulo: 'Parear TV',
            sub: `Placar <b>${esc(placar.nome)}</b>`,
            classe: 'media',
            corpo: `<div class="aviso-caixa info" style="margin-bottom:14px">${ic('info')}<div>Na TV, abra <b>marqgol.artzan.tech/telao</b>: aparece um código de 6 dígitos. Digite-o aqui. O código vale 10 minutos.</div></div>
                <div class="form-grade">
                    <label class="inteira"><span class="rotulo">Código mostrado na TV</span><input class="campo codigo-tv" name="codigo" inputmode="numeric" autocomplete="off" maxlength="7" placeholder="000000" required></label>
                    <div class="inteira"><span class="rotulo">O que a TV vai mostrar</span>
                        <div class="segmentos" role="radiogroup">${Object.entries(TIPOS_TELA).map(([k, [r, d]], i) => `<label class="segmento"><input type="radio" name="tipo" value="${k}" ${i === 0 ? 'checked' : ''}>${esc(r)}<small>${esc(d)}</small></label>`).join('')}</div></div>
                    <label class="inteira"><span class="rotulo">Nome da TV (opcional)</span><input class="campo" name="nome" maxlength="60" placeholder="Ex.: TV da arquibancada"></label>
                </div>`,
            botoes: [{ rotulo: 'Cancelar', cancelar: true }, { rotulo: 'Parear', classe: 'claro', enviar: true, icone: 'link' }],
            aoEnviar: async (form) => {
                const codigo = form.codigo.value.replace(/\D/g, '');
                if (codigo.length !== 6) { await avisar('Código incompleto', 'O código da TV tem 6 dígitos.'); return false; }
                const r = await MARQ.api('POST', `/api/app/placares/${placar.id}/telas`, {
                    codigo, tipo: (form.querySelector('input[name=tipo]:checked') || {}).value, nome: form.nome.value.trim()
                });
                toast(`“${r.nome}” pareada. A TV abre o placar em instantes.`);
                aposSalvar();
            }
        });
    }

    // ================= Mídia =================
    const TIPOS_MIDIA = {
        video: { titulo: 'Comerciais (vídeos)', chave: 'videos', pasta: 'videos', icone: 'film', aceita: '.mp4,.webm,.mov,.avi,.mkv,video/*', ajuda: 'Vídeos que você toca no intervalo, em tela cheia no telão.' },
        slide: { titulo: 'Slides', chave: 'slides', pasta: 'slides', icone: 'image', aceita: '.png,.jpg,.jpeg,.gif,.webp,.svg,.mp4,.webm,.mov,image/*,video/*', ajuda: 'Imagens (ou vídeos curtos) em sequência no telão. Para PDF, use a aba Mídia do controle, que converte em imagens.' },
        patrocinador: { titulo: 'Patrocinadores', chave: 'patrocinadores', pasta: 'patrocinadores', icone: 'star', aceita: '.png,.jpg,.jpeg,.gif,.webp,.svg,image/*', ajuda: 'Logos que giram na faixa de baixo do telão durante o jogo.' }
    };
    const ehImagem = (n) => /\.(png|jpe?g|gif|webp|svg)$/i.test(n);

    APP.tela('midia', async (ctx) => {
        const el = ctx.el;
        const R = APP.S.resumo;
        const permitido = !!R.limites.recursos.midia;
        const placarId = (R.placares || [])[0] && R.placares[0].id;
        let enviando = false;

        async function desenhar() {
            const m = await MARQ.api('GET', '/api/midia');
            if (!ctx.ativo()) return;
            const limMb = num(APP.S.resumo.limites.max_armazenamento_mb);
            const usoMb = num(m.usoBytes) / 1024 / 1024;
            el.querySelector('#midia-uso').innerHTML = `<div class="uso" style="padding:12px 14px">
                <div class="uso-cab">${ic('upload')}Armazenamento usado</div>
                <div class="linha" style="justify-content:space-between"><b>${esc(APP.tamanho(m.usoBytes))}</b><span class="ajuda">de ${esc(APP.mb(limMb))} (inclui fotos e arte)</span></div>
                ${APP.barra(usoMb, limMb)}</div>`;
            for (const [tipo, def] of Object.entries(TIPOS_MIDIA)) {
                const nomes = m[def.chave] || [];
                el.querySelector(`[data-lista="${tipo}"]`).innerHTML = nomes.length
                    ? `<div class="midia-lista">${nomes.map(n => {
                        const url = placarId ? `/p/${placarId}/${def.pasta}/${encodeURIComponent(n)}` : '';
                        const mini = url && ehImagem(n)
                            ? `<span class="miniatura ${tipo === 'patrocinador' ? 'contida' : ''}"><img src="${esc(url)}" alt="" loading="lazy"></span>`
                            : `<span class="miniatura">${ic(ehImagem(n) ? 'image' : 'film')}</span>`;
                        return `<div class="midia-item">${mini}<span class="txt">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" style="color:inherit">${esc(n)}</a>` : esc(n)}</span>
                            <button type="button" class="btn peq icone perigo" data-apagar="${tipo}" data-nome="${esc(n)}" aria-label="Apagar ${esc(n)}" title="Apagar">${ic('trash')}</button></div>`;
                    }).join('')}</div>`
                    : `<p class="ajuda">Nenhum arquivo.</p>`;
            }
        }

        el.innerHTML = `
        ${APP.tituloPagina('Mídia', 'Comerciais, slides e patrocinadores valem para todos os seus placares.')}
        ${permitido ? '' : `<div class="aviso-caixa">${ic('lock')}<div><b>Seu plano não inclui comerciais, slides e patrocinadores.</b> Inclua a mídia no seu plano em Assinatura para enviar arquivos. Os arquivos já enviados continuam listados abaixo e podem ser apagados.</div></div>`}
        <div class="aviso-caixa info">${ic('info')}<div>Aqui você só envia e organiza os arquivos. Para <b>tocar</b> um comercial ou os slides durante o jogo, use a aba <b>Telão</b> no controle do placar.</div></div>
        <div id="midia-uso"></div>
        <div id="midia-progresso"></div>
        ${Object.entries(TIPOS_MIDIA).map(([tipo, def]) => `
        <section class="cartao">
            <div class="cartao-cab"><div><h2>${esc(def.titulo)}</h2><p>${esc(def.ajuda)}</p></div>
                ${permitido ? `<button type="button" class="btn" data-enviar="${tipo}">${ic('upload')}Enviar</button>` : ''}</div>
            <div data-lista="${tipo}">${APP.carregando()}</div>
        </section>`).join('')}`;

        el.onclick = async (ev) => {
            const env = ev.target.closest('[data-enviar]');
            if (env) {
                if (enviando) { toast('Aguarde o envio atual terminar.'); return; }
                const tipo = env.dataset.enviar;
                const arquivos = await APP.escolherArquivo(TIPOS_MIDIA[tipo].aceita, true);
                if (!arquivos.length) return;
                enviando = true;
                try { await enviar(tipo, arquivos); } finally { enviando = false; }
                await desenhar().catch(APP.falhou);
                APP.atualizarResumo().catch(() => {});
                return;
            }
            const ap = ev.target.closest('[data-apagar]');
            if (ap) {
                const ok = await confirmar({ titulo: 'Apagar arquivo?', texto: `“${ap.dataset.nome}” sai de todos os placares.`, sim: 'Apagar', perigo: true });
                if (!ok) return;
                await APP.acao(ap, async () => {
                    await MARQ.api('DELETE', `/api/midia/${ap.dataset.apagar}/${encodeURIComponent(ap.dataset.nome)}`);
                    toast('Arquivo apagado.');
                    await desenhar();
                });
            }
        };

        async function enviar(tipo, arquivos) {
            const caixa = el.querySelector('#midia-progresso');
            let ok = 0;
            for (let i = 0; i < arquivos.length; i++) {
                const f = arquivos[i];
                caixa.innerHTML = `<div class="progresso"><div class="linha" style="justify-content:space-between"><span>Enviando <b>${esc(f.name)}</b>${arquivos.length > 1 ? ` (${i + 1} de ${arquivos.length})` : ''}</span><span id="pct">0%</span></div><div class="barra"><i style="width:0%"></i></div></div>`;
                const barraEl = caixa.querySelector('.barra > i'), pct = caixa.querySelector('#pct');
                try {
                    await MARQ.enviarArquivo(`/api/midia/${tipo}?nome=` + encodeURIComponent(f.name), f, (p) => {
                        barraEl.style.width = (p * 100).toFixed(0) + '%';
                        pct.textContent = (p * 100).toFixed(0) + '%';
                    });
                    ok++;
                } catch (e) {
                    caixa.innerHTML = '';
                    await APP.falhou(e, `Falha ao enviar ${f.name}`);
                    if (e.status === 413) break; // sem espaço: não adianta tentar os próximos
                }
            }
            caixa.innerHTML = '';
            if (ok) toast(ok === 1 ? 'Arquivo enviado.' : `${ok} arquivos enviados.`);
        }

        await desenhar();
    });
})();
