// Área do cliente — Agenda: jogos por dia, criar/editar/cancelar/reagendar,
// escalação e súmula dos jogos encerrados.
(function () {
    const { ESPORTES, num } = APP;

    const STATUS = {
        agendado: ['Agendado', 'info'], ao_vivo: ['Ao vivo', 'vivo'], encerrado: ['Encerrado', ''],
        cancelado: ['Cancelado', 'perigo'], expirado: ['Expirado', 'alerta']
    };
    const PARCIAL = { futsal: 'tempo', basquete: 'quarto', volei: 'set' };
    const PONTO = { futsal: 'Gol', basquete: 'Cesta', volei: 'Ponto' };

    // Filtros da tela (ficam enquanto a página estiver aberta).
    const filtro = { de: APP.dataLocal(), ate: '', status: '' };

    const tagStatus = (s) => { const [r, c] = STATUS[s] || [s, '']; return `<span class="tag ${c}">${esc(r)}</span>`; };
    const nomeTime = (t) => esc(t.nome_exibicao || '?') + (t.categoria ? ` <small style="color:var(--muted)">${esc(t.categoria)}</small>` : '');

    // Linha de um jogo (usada também no Início).
    APP.linhaJogo = function (j, { compacta = false } = {}) {
        const temPlacar = j.status === 'encerrado' || j.status === 'ao_vivo';
        const meio = temPlacar
            ? `<span class="pl">${num(j.placar_casa)}<span class="x">×</span>${num(j.placar_fora)}</span>`
            : '<span class="x">×</span>';
        const dia = new Date(j.data_hora).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        let botoes = '';
        if (compacta) {
            botoes = j.status === 'ao_vivo' && j.placar_id
                ? `<a class="btn peq ok" href="${APP.linkControle(j.placar_id)}">${ic('board')}Controle</a>`
                : `<a class="btn peq" href="#agenda" data-ver-dia="${esc(APP.dataLocal(new Date(j.data_hora)))}">${ic('right')}</a>`;
        } else {
            const b = [];
            if (j.status === 'encerrado') b.push(`<button type="button" class="btn peq" data-acao="detalhe" data-id="${j.id}">${ic('file')}Súmula</button>`);
            else b.push(`<button type="button" class="btn peq" data-acao="detalhe" data-id="${j.id}">${ic('users')}Escalação</button>`);
            if (j.status === 'agendado') {
                b.push(`<button type="button" class="btn peq icone" data-acao="editar" data-id="${j.id}" aria-label="Editar jogo" title="Editar">${ic('edit')}</button>`);
            }
            if (j.status === 'agendado' || j.status === 'expirado') {
                b.push(`<button type="button" class="btn peq icone perigo" data-acao="cancelar" data-id="${j.id}" aria-label="Cancelar jogo" title="Cancelar jogo">${ic('x')}</button>`);
            }
            if (j.status === 'expirado' || j.status === 'cancelado') {
                b.push(`<button type="button" class="btn peq" data-acao="reagendar" data-id="${j.id}">${ic('repeat')}Reagendar</button>`);
            }
            if (j.status === 'ao_vivo' && j.placar_id) b.push(`<a class="btn peq ok" href="${APP.linkControle(j.placar_id)}">${ic('board')}Controle</a>`);
            botoes = b.join('');
        }
        return `<div class="jogo ${esc(j.status)}">
            <div class="hora">${esc(APP.hora(j.data_hora))}<small>${compacta ? esc(dia) : esc(ESPORTES[j.esporte] || j.esporte)}</small></div>
            <div style="min-width:0">
                <div class="confronto">${nomeTime(j.time_casa)} ${meio} ${nomeTime(j.time_fora)}</div>
                <div class="linha-meta">${tagStatus(j.status)}${compacta ? `<span class="tag">${esc(ESPORTES[j.esporte] || j.esporte)}</span>` : ''}
                    ${j.placar_nome ? `<span>${ic('tv')} ${esc(j.placar_nome)}</span>` : ''}${j.local ? `<span>· ${esc(j.local)}</span>` : ''}</div>
            </div>
            <div class="acoes">${botoes}</div>
        </div>`;
    };

    // Clique em "ver dia" a partir do Início.
    document.addEventListener('click', (ev) => {
        const a = ev.target.closest('[data-ver-dia]');
        if (!a) return;
        filtro.de = a.dataset.verDia; filtro.ate = a.dataset.verDia; filtro.status = '';
    });

    function cabecalhoContador() {
        const R = APP.S.resumo;
        const uso = num(R.uso.max_jogos_abertos), lim = num(R.limites.max_jogos_abertos);
        return `<span class="contador ${uso >= lim ? 'cheio' : ''}" title="Agendados ou ao vivo"><b>${uso}</b> de <b>${lim}</b> jogos em aberto</span>`;
    }

    function intervaloIso() {
        const p = new URLSearchParams();
        if (filtro.de) p.set('de', new Date(filtro.de + 'T00:00').toISOString());
        if (filtro.ate) { const d = new Date(filtro.ate + 'T00:00'); d.setDate(d.getDate() + 1); p.set('ate', d.toISOString()); }
        if (filtro.status) p.set('status', filtro.status);
        return p.toString();
    }

    APP.tela('agenda', async (ctx) => {
        const el = ctx.el;
        async function desenhar() {
            const lista = el.querySelector('#agenda-lista');
            lista.innerHTML = APP.carregando();
            const [jogos] = await Promise.all([MARQ.api('GET', '/api/app/jogos?' + intervaloIso()), APP.atualizarResumo()]);
            if (!ctx.ativo()) return;
            el.querySelector('#agenda-contador').innerHTML = cabecalhoContador();
            if (!jogos.length) {
                lista.innerHTML = `<div class="cartao">${APP.vazio('calendar', 'Nenhum jogo neste período.', 'Mude os filtros ou agende um jogo novo.')}</div>`;
                return;
            }
            const dias = new Map();
            for (const j of jogos) {
                const k = APP.dataLocal(new Date(j.data_hora));
                if (!dias.has(k)) dias.set(k, []);
                dias.get(k).push(j);
            }
            const hoje = APP.dataLocal();
            lista.innerHTML = `<div class="cartao">${[...dias].map(([k, js]) => `
                <div class="dia"><div class="dia-cab">${esc(APP.diaExtenso(js[0].data_hora))}${k === hoje ? ' <span class="tag marca">Hoje</span>' : ''}<small>${js.length} jogo${js.length === 1 ? '' : 's'}</small></div>
                ${js.map(j => APP.linhaJogo(j)).join('')}</div>`).join('')}
                ${jogos.length >= 500 ? '<p class="ajuda">Mostrando os primeiros 500 jogos. Use os filtros para refinar.</p>' : ''}</div>`;
        }

        el.innerHTML = `
        ${APP.tituloPagina('Agenda', 'Jogos agendados aparecem no controle para carregar com um toque.',
            `<span id="agenda-contador">${cabecalhoContador()}</span><button type="button" class="btn claro" data-acao="novo">${ic('plus')}Agendar jogo</button>`)}
        <div class="aviso-caixa info">${ic('info')}<div>Cada jogo agendado ou ao vivo ocupa uma vaga do plano. <b>Um jogo agendado expira 24 h depois do horário se não começar</b> e libera a vaga — dá para reagendá-lo depois.</div></div>
        <section class="cartao">
            <form class="filtros" id="agenda-filtros">
                <label><span class="rotulo">De</span><input class="campo" type="date" name="de" value="${esc(filtro.de)}"></label>
                <label><span class="rotulo">Até</span><input class="campo" type="date" name="ate" value="${esc(filtro.ate)}"></label>
                <label><span class="rotulo">Situação</span><select class="campo" name="status">
                    <option value="">Todas</option>${Object.entries(STATUS).map(([k, [r]]) => `<option value="${k}" ${filtro.status === k ? 'selected' : ''}>${esc(r)}</option>`).join('')}
                </select></label>
            </form>
            <div class="acoes">
                <button type="button" class="btn peq" data-periodo="hoje">Hoje</button>
                <button type="button" class="btn peq" data-periodo="semana">Próximos 7 dias</button>
                <button type="button" class="btn peq" data-periodo="futuro">Daqui em diante</button>
                <button type="button" class="btn peq" data-periodo="passado">Últimos 30 dias</button>
                <button type="button" class="btn peq leve" data-periodo="tudo">Tudo</button>
            </div>
        </section>
        <div id="agenda-lista"></div>`;

        const form = el.querySelector('#agenda-filtros');
        el.onchange = (ev) => {
            if (!form.contains(ev.target)) return;
            filtro.de = form.de.value; filtro.ate = form.ate.value; filtro.status = form.status.value;
            desenhar().catch(APP.falhou);
        };
        el.onclick = async (ev) => {
            const per = ev.target.closest('[data-periodo]');
            if (per) {
                const hoje = new Date();
                const mais = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return APP.dataLocal(d); };
                ({
                    hoje: () => { filtro.de = APP.dataLocal(hoje); filtro.ate = APP.dataLocal(hoje); },
                    semana: () => { filtro.de = APP.dataLocal(hoje); filtro.ate = mais(6); },
                    futuro: () => { filtro.de = APP.dataLocal(hoje); filtro.ate = ''; },
                    passado: () => { filtro.de = mais(-30); filtro.ate = APP.dataLocal(hoje); },
                    tudo: () => { filtro.de = ''; filtro.ate = ''; }
                })[per.dataset.periodo]();
                form.de.value = filtro.de; form.ate.value = filtro.ate;
                desenhar().catch(APP.falhou);
                return;
            }
            const b = ev.target.closest('[data-acao]');
            if (!b) return;
            const id = Number(b.dataset.id);
            const aposMudar = () => desenhar().catch(APP.falhou);
            if (b.dataset.acao === 'novo') formJogo(null, aposMudar);
            else if (b.dataset.acao === 'editar') {
                await APP.acao(b, async () => formJogo((await MARQ.api('GET', '/api/app/jogos/' + id)).jogo, aposMudar));
            } else if (b.dataset.acao === 'cancelar') {
                const ok = await confirmar({ titulo: 'Cancelar jogo?', texto: 'O jogo sai da agenda do controle e libera a vaga do plano.\nDá para reagendá-lo depois.', sim: 'Cancelar jogo', nao: 'Voltar', perigo: true });
                if (!ok) return;
                await APP.acao(b, async () => { await MARQ.api('POST', `/api/app/jogos/${id}/cancelar`); toast('Jogo cancelado.'); await desenhar(); });
            } else if (b.dataset.acao === 'reagendar') reagendar(id, aposMudar);
            else if (b.dataset.acao === 'detalhe') await APP.acao(b, () => detalheJogo(id, aposMudar));
        };
        await desenhar();
    });

    // ---------------- Criar / editar ----------------
    async function formJogo(jogo, aposSalvar) {
        const R = APP.S.resumo;
        const esportes = R.limites.esportes;
        const esporte0 = jogo ? jogo.esporte : esportes[0];
        const placares = (R.placares || []).filter(p => p.ativo || (jogo && p.id === jogo.placar_id));
        const corpo = `<div class="form-grade">
            <div class="inteira"><span class="rotulo">Esporte</span>
                <div class="segmentos compacto" role="radiogroup">${esportes.map(e => `<label class="segmento"><input type="radio" name="esporte" value="${e}" ${e === esporte0 ? 'checked' : ''}>${esc(ESPORTES[e])}</label>`).join('')}</div></div>
            <label><span class="rotulo">Time da casa</span><select class="campo" name="time_casa_id" required></select></label>
            <label><span class="rotulo">Visitante</span><select class="campo" name="time_fora_id" required></select></label>
            <p class="ajuda inteira" id="sem-times" hidden>Nenhum time deste esporte. <a href="#times" style="color:var(--info)">Cadastre times</a> primeiro.</p>
            <label><span class="rotulo">Data e hora</span><input class="campo" type="datetime-local" name="data_hora" required value="${esc(jogo ? APP.isoParaLocal(jogo.data_hora) : '')}"></label>
            <label><span class="rotulo">Local (opcional)</span><input class="campo" name="local" maxlength="200" value="${esc(jogo ? jogo.local || '' : '')}" placeholder="Ex.: Ginásio municipal"></label>
            <label class="inteira"><span class="rotulo">Placar (opcional)</span><select class="campo" name="placar_id">
                <option value="">Escolher na hora, no controle</option>
                ${placares.map(p => `<option value="${p.id}" ${jogo && jogo.placar_id === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}
            </select></label>
        </div>
        ${jogo ? '' : `<p class="ajuda" style="margin-top:12px">Ocupa 1 vaga: ${num(R.uso.max_jogos_abertos)} de ${num(R.limites.max_jogos_abertos)} jogos em aberto.</p>`}`;

        async function carregarTimes(form, esporte, manter) {
            const times = await MARQ.api('GET', '/api/app/times?esporte=' + encodeURIComponent(esporte));
            const opcoes = (sel) => '<option value="">Escolha…</option>' + times.map(t => `<option value="${t.id}" ${String(t.id) === String(sel) ? 'selected' : ''}>${esc(t.nome)}${t.categoria ? ' — ' + esc(t.categoria) : ''}</option>`).join('');
            form.time_casa_id.innerHTML = opcoes(manter ? manter.casa : '');
            form.time_fora_id.innerHTML = opcoes(manter ? manter.fora : '');
            form.querySelector('#sem-times').hidden = times.length > 0;
        }

        APP.folha({
            titulo: jogo ? 'Editar jogo' : 'Agendar jogo',
            classe: 'media',
            corpo,
            botoes: [{ rotulo: 'Cancelar', cancelar: true }, { rotulo: jogo ? 'Salvar' : 'Agendar', classe: 'claro', enviar: true }],
            aoAbrir: (form) => {
                carregarTimes(form, esporte0, jogo ? { casa: jogo.time_casa.id, fora: jogo.time_fora.id } : null).catch(APP.falhou);
                form.addEventListener('change', (ev) => {
                    if (ev.target.name === 'esporte') carregarTimes(form, ev.target.value).catch(APP.falhou);
                });
            },
            aoEnviar: async (form) => {
                const esporte = (form.querySelector('input[name=esporte]:checked') || {}).value;
                const casa = Number(form.time_casa_id.value), fora = Number(form.time_fora_id.value);
                if (!casa || !fora) { await avisar('Faltam os times', 'Escolha o time da casa e o visitante.'); return false; }
                if (casa === fora) { await avisar('Times iguais', 'Escolha dois times diferentes.'); return false; }
                const dataHora = APP.localParaIso(form.data_hora.value);
                if (!dataHora) { await avisar('Falta a data', 'Informe a data e a hora do jogo.'); return false; }
                const corpoReq = {
                    esporte, time_casa_id: casa, time_fora_id: fora, data_hora: dataHora,
                    local: form.local.value.trim(), placar_id: form.placar_id.value ? Number(form.placar_id.value) : null
                };
                if (jogo) await MARQ.api('PATCH', '/api/app/jogos/' + jogo.id, corpoReq);
                else await MARQ.api('POST', '/api/app/jogos', corpoReq);
                toast(jogo ? 'Jogo atualizado.' : 'Jogo agendado.');
                aposSalvar();
            }
        });
    }

    function reagendar(id, aposSalvar) {
        APP.folha({
            titulo: 'Reagendar jogo',
            sub: 'O jogo volta para a agenda e ocupa de novo uma vaga do plano.',
            corpo: `<label><span class="rotulo">Nova data e hora</span><input class="campo" type="datetime-local" name="data_hora" required></label>`,
            botoes: [{ rotulo: 'Cancelar', cancelar: true }, { rotulo: 'Reagendar', classe: 'claro', enviar: true }],
            aoEnviar: async (form) => {
                const d = APP.localParaIso(form.data_hora.value);
                if (!d) { await avisar('Falta a data', 'Informe a nova data e hora.'); return false; }
                await MARQ.api('POST', `/api/app/jogos/${id}/reagendar`, { data_hora: d });
                toast('Jogo reagendado.');
                aposSalvar();
            }
        });
    }

    // ---------------- Escalação e súmula ----------------
    function tempo(ms) {
        if (ms == null) return '';
        const s = Math.floor(num(ms) / 1000);
        return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
    }
    const pad2 = (n) => String(n).padStart(2, '0');

    function sumula(d) {
        const j = d.jogo;
        const casa = d.time_casa, fora = d.time_fora;
        const jogadores = new Map([...casa.elenco, ...fora.elenco].map(x => [x.jogador_id, x]));
        const nomeT = (id) => id === casa.id ? casa.nome_exibicao : id === fora.id ? fora.nome_exibicao : '';
        const estornados = new Set(d.eventos.filter(e => e.tipo === 'estorno' && e.payload && e.payload.evento_uuid).map(e => e.payload.evento_uuid));
        const parcial = PARCIAL[j.esporte] || 'período';
        const quem = (e) => {
            const p = e.jogador_id && jogadores.get(e.jogador_id);
            const jog = p ? `${p.numero ? '#' + esc(p.numero) + ' ' : ''}${esc(p.nome_exibicao)}` : '';
            const t = nomeT(e.time_id);
            return [jog, t ? `<span style="color:var(--muted)">${esc(t)}</span>` : ''].filter(Boolean).join(' · ');
        };
        const desc = (e) => {
            switch (e.tipo) {
                case 'ponto': return `<b>${PONTO[j.esporte] || 'Ponto'}${num(e.valor) > 1 ? ` (+${num(e.valor)})` : ''}</b> ${quem(e)}`;
                case 'falta': return `<b>Falta</b> ${quem(e)}`;
                case 'set': {
                    const p = e.payload || {};
                    const plac = p.placar_casa != null ? ` — ${num(p.placar_casa)} × ${num(p.placar_visitante)}` : '';
                    return `<b>Fim do ${p.numero || e.periodo || ''}º ${parcial}</b>${plac}${e.time_id ? ' · venceu ' + esc(nomeT(e.time_id)) : ''}`;
                }
                case 'periodo': return `Início do ${num(e.periodo)}º ${parcial}`;
                case 'crono_play': return 'Cronômetro iniciado';
                case 'crono_pause': return 'Cronômetro pausado';
                case 'crono_set': return 'Cronômetro ajustado';
                case 'estorno': return `Correção: lance anterior desfeito${e.payload && e.payload.motivo ? ' (' + esc(e.payload.motivo) + ')' : ''}`;
                default: return esc(e.tipo);
            }
        };
        const sistema = (t) => /^crono_|^periodo$|^estorno$/.test(t);
        const parciais = Array.isArray(j.parciais) ? j.parciais : [];
        const volei = j.esporte === 'volei';
        return `
        <div class="placar-final">
            <div class="t">${esc(casa.nome_exibicao)}</div>
            <div class="n">${volei ? `${num(j.sets_casa)} × ${num(j.sets_fora)}<small>sets</small>` : `${num(j.placar_casa)} × ${num(j.placar_fora)}`}</div>
            <div class="t">${esc(fora.nome_exibicao)}</div>
        </div>
        ${parciais.length ? `<div class="parciais">${parciais.map((p, i) => `<span class="tag">${i + 1}º ${parcial}: ${num(p.a ?? p.placar_casa)} × ${num(p.b ?? p.placar_visitante ?? p.placar_fora)}</span>`).join('')}</div>` : ''}
        <h3 style="margin:18px 0 0;font-family:var(--f-rot);text-transform:uppercase;letter-spacing:.05em">Súmula</h3>
        ${d.eventos.length ? `<div class="sumula">${d.eventos.map(e => `
            <div class="ev ${estornados.has(e.uuid) ? 'estornado' : ''} ${sistema(e.tipo) ? 'sistema' : ''}">
                <span class="tempo">${e.periodo ? num(e.periodo) + 'º' : ''}</span>
                <span class="tempo">${esc(tempo(e.cronometro_ms))}</span>
                <span class="desc">${desc(e)}${estornados.has(e.uuid) ? ' <span class="tag perigo">estornado</span>' : ''}</span>
            </div>`).join('')}</div>`
            : '<p class="ajuda">Nenhum lance registrado neste jogo.</p>'}`;
    }

    function editorEscalacao(time) {
        if (!time.elenco.length) return `<div><h3>${esc(time.nome_exibicao)}</h3><p class="ajuda">Este time não tem jogadores. Cadastre o elenco em <a href="#times/${time.id}" style="color:var(--info)">Times</a>.</p></div>`;
        return `<div data-time="${time.id}"><h3>${esc(time.nome_exibicao)}</h3>
            ${time.elenco.map(p => `<div class="esc-linha" data-jogador="${p.jogador_id}">
                <input class="campo" name="numero" value="${esc(p.numero)}" maxlength="4" inputmode="numeric" aria-label="Número de ${esc(p.nome_exibicao)}">
                <span class="nome">${esc(p.nome_exibicao)}</span>
                <label class="marca-toggle" title="Titular"><input type="checkbox" name="titular" ${p.titular ? 'checked' : ''}>T</label>
                <label class="marca-toggle" title="Capitão"><input type="checkbox" name="capitao" ${p.capitao ? 'checked' : ''}>C</label>
            </div>`).join('')}</div>`;
    }

    async function detalheJogo(id, aposSalvar) {
        const d = await MARQ.api('GET', '/api/app/jogos/' + id);
        const j = d.jogo;
        const titulo = `${d.time_casa.nome_exibicao} × ${d.time_fora.nome_exibicao}`;
        const sub = `${esc(ESPORTES[j.esporte] || j.esporte)} · ${esc(MARQ.dataHora(j.data_hora))}${j.local ? ' · ' + esc(j.local) : ''} · ${(STATUS[j.status] || [j.status])[0]}`;
        if (j.status === 'encerrado') {
            APP.folha({ titulo, sub, classe: 'larga', corpo: sumula(d), botoes: [{ rotulo: 'Fechar', cancelar: true, classe: 'claro' }] });
            return;
        }
        const editavel = j.status === 'agendado' || j.status === 'ao_vivo';
        APP.folha({
            titulo, sub, classe: 'larga',
            corpo: `<p>Escalação deste jogo: número da camisa, titulares (<b>T</b>) e capitão (<b>C</b>). O controle já abre o jogo com ela.</p>
                <div class="escalacao">${editorEscalacao(d.time_casa)}${editorEscalacao(d.time_fora)}</div>
                ${d.eventos.length ? `<details style="margin-top:12px"><summary class="rotulo" style="cursor:pointer">Lances registrados (${d.eventos.length})</summary>${sumula(d)}</details>` : ''}`,
            botoes: editavel
                ? [{ rotulo: 'Fechar', cancelar: true }, { rotulo: 'Salvar escalação', classe: 'claro', enviar: true }]
                : [{ rotulo: 'Fechar', cancelar: true, classe: 'claro' }],
            aoAbrir: (form) => {
                // Um capitão por time.
                form.addEventListener('change', (ev) => {
                    if (ev.target.name !== 'capitao' || !ev.target.checked) return;
                    ev.target.closest('[data-time]').querySelectorAll('input[name=capitao]').forEach(c => { if (c !== ev.target) c.checked = false; });
                });
                if (!editavel) form.querySelectorAll('.escalacao input').forEach(i => { i.disabled = true; });
            },
            aoEnviar: async (form) => {
                for (const bloco of form.querySelectorAll('[data-time]')) {
                    const jogadores = [...bloco.querySelectorAll('[data-jogador]')].map(l => ({
                        jogador_id: Number(l.dataset.jogador),
                        numero: l.querySelector('[name=numero]').value.trim(),
                        titular: l.querySelector('[name=titular]').checked,
                        capitao: l.querySelector('[name=capitao]').checked
                    }));
                    await MARQ.api('PUT', `/api/app/jogos/${id}/escalacao/${bloco.dataset.time}`, { jogadores });
                }
                toast('Escalação salva.');
                if (aposSalvar) aposSalvar();
            }
        });
    }
})();
