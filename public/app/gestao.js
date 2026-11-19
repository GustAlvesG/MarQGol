// Área do cliente — telas de gestão: Arte do telão, Usuários, Assinatura e
// Conta/Perfil.
(function () {
    const { num, ESPORTES, RECURSOS } = APP;

    // ================= Arte do telão =================
    const ROTULO_SLOT = {
        background: 'Fundo', espera: 'Vídeo de espera', box: 'Caixa do placar',
        'element-1': 'Elemento 1', 'element-2': 'Elemento 2', 'element-3': 'Elemento 3',
        'element-4-on': 'Elemento 4 (aceso)', 'element-4-off': 'Elemento 4 (apagado)'
    };
    const BORDAS = { topo: 'Faixa de cima', base: 'Faixa de baixo', lados: 'Laterais' };

    APP.tela('arte', async (ctx) => {
        const el = ctx.el;
        const R = APP.S.resumo;
        const pode = !!R.limites.recursos.arte_propria || !!R.usuario.impersonando;
        const placarId = (R.placares || [])[0] && R.placares[0].id;
        let arte = await MARQ.api('GET', '/api/app/arte');
        if (!ctx.ativo()) return;

        const prevSlot = (s) => {
            if (!placarId) return '<span>Crie um placar para ver a prévia.</span>';
            if (!s.personalizado && !s.padrao) return `<span>${s.slot === 'espera' ? 'Sem vídeo de espera' : 'Sem arte'}</span>`;
            const url = `/p/${placarId}/base/${s.slot}.png?v=${arte.versao}`;
            return s.slot === 'espera'
                ? `<video src="${esc(url)}" muted loop playsinline preload="metadata" controls></video>`
                : `<img src="${esc(url)}" alt="" loading="lazy">`;
        };
        const cartaoSlot = (s) => {
            const nome = ROTULO_SLOT[s.slot.split('/').pop()] || s.slot;
            return `<div class="arte-slot">
                <div class="nome"><span>${esc(nome)}</span>${s.personalizado ? '<span class="tag marca">Sua arte</span>' : '<span class="tag">Padrão</span>'}</div>
                <div class="arte-prev xadrez">${prevSlot(s)}</div>
                ${pode ? `<div class="acoes">
                    <button type="button" class="btn peq" data-enviar="${esc(s.slot)}">${ic('upload')}Enviar</button>
                    ${s.personalizado ? `<button type="button" class="btn peq leve" data-restaurar="${esc(s.slot)}">${ic('reset')}Padrão</button>` : ''}
                </div>` : ''}
            </div>`;
        };

        function desenhar() {
            const porGrupo = { geral: [], futsal: [], basquete: [], volei: [] };
            for (const s of arte.slots) {
                const g = s.slot.includes('/') ? s.slot.split('/')[0] : 'geral';
                if (g !== 'geral' && !R.limites.esportes.includes(g)) continue;
                (porGrupo[g] || (porGrupo[g] = [])).push(s);
            }
            const b = arte.bordas || {};
            el.innerHTML = `
            ${APP.tituloPagina('Arte do telão', 'O visual que aparece nas TVs de todos os seus placares.')}
            ${pode ? '' : `<div class="aviso-caixa">${ic('lock')}<div><b>Seu plano não inclui arte própria.</b> Você pode ver a arte atual abaixo. Para personalizar, troque de plano em Assinatura ou peça ao suporte para aplicar sua arte.</div></div>`}
            <section class="cartao">
                <div class="cartao-cab"><div><h2>Gabarito</h2><p>Siga o gabarito para que os números e nomes caiam nos lugares certos.</p></div></div>
                <div class="grade-2">
                    <ul class="ajuda" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
                        <li>Arte na proporção <b>2:1</b> (ex.: <b>2048 × 1024</b> px). PNG ou WebP com transparência, SVG ou JPG.</li>
                        <li>A <b>caixa do placar</b> deve ter as áreas (nomes, números, faltas, cronômetro) <b>nos mesmos lugares da arte padrão</b> — baixe a prévia padrão e desenhe por cima.</li>
                        <li>A <b>faixa de patrocinadores</b> começa em <b>88,87%</b> da altura (a partir de 910 px numa arte de 1024 px). Deixe essa faixa livre.</li>
                        <li>O vídeo de espera (MP4 ou WebM) toca enquanto não há jogo.</li>
                        <li>As TVs recebem a arte nova na hora, sem recarregar.</li>
                    </ul>
                    <div class="gabarito xadrez" aria-hidden="true">
                        <span class="rot" style="left:10px;top:8px">2048 × 1024 (2:1)</span>
                        <div class="faixa-pat"></div>
                        <span class="rot" style="left:10px;bottom:2px">Patrocinadores · 88,87%</span>
                    </div>
                </div>
            </section>
            ${Object.entries(porGrupo).filter(([, l]) => l.length).map(([g, lista]) => `
            <section class="cartao grupo-arte">
                <h3>${g === 'geral' ? 'Geral' : esc(ESPORTES[g])}</h3>
                <div class="grade-arte">${lista.map(cartaoSlot).join('')}</div>
            </section>`).join('')}
            <section class="cartao">
                <div class="cartao-cab"><div><h2>Bordas</h2><p>Quando a TV não é 2:1, sobra espaço em volta da arte. Pinte essas sobras com uma cor ou um gradiente CSS (ex.: <code>linear-gradient(90deg, #0b1a3a, #1d3f8a)</code>). Vazio = preto.</p></div></div>
                <form id="form-bordas" class="grade-2">
                    <div class="form-grade" style="grid-template-columns:1fr">
                        ${Object.entries(BORDAS).map(([k, r]) => `<label><span class="rotulo">${esc(r)}</span><input class="campo" name="${k}" maxlength="590" value="${esc(b[k] || '')}" placeholder="#000000" ${pode ? '' : 'disabled'}></label>`).join('')}
                        ${pode ? `<div class="acoes"><button type="submit" class="btn claro">${ic('save')}Salvar bordas</button></div>` : ''}
                    </div>
                    <div><span class="rotulo">Prévia</span><div class="bordas-prev" id="bordas-prev"></div></div>
                </form>
            </section>`;
            previaBordas();
        }

        function previaBordas() {
            const f = el.querySelector('#form-bordas');
            const v = (k) => f[k].value.trim() || '#000';
            el.querySelector('#bordas-prev').innerHTML = `
                <div class="b-topo" style="background:${esc(v('topo'))}"></div>
                <div style="background:${esc(v('lados'))}"></div><div class="b-meio">Arte 2:1</div><div style="background:${esc(v('lados'))}"></div>
                <div class="b-base" style="background:${esc(v('base'))}"></div>`;
        }

        el.oninput = (ev) => { if (ev.target.closest('#form-bordas')) previaBordas(); };
        el.onsubmit = async (ev) => {
            ev.preventDefault();
            const f = ev.target;
            if (f.id !== 'form-bordas') return;
            await APP.acao(f.querySelector('[type=submit]'), async () => {
                arte = await MARQ.api('POST', '/api/app/arte-bordas', { bordas: { topo: f.topo.value.trim(), base: f.base.value.trim(), lados: f.lados.value.trim() } });
                toast('Bordas salvas. As TVs já mostram a cor nova.');
                desenhar();
            });
        };
        el.onclick = async (ev) => {
            const env = ev.target.closest('[data-enviar]');
            if (env) {
                const slot = env.dataset.enviar;
                const f = await APP.escolherArquivo(slot === 'espera' ? '.mp4,.webm,video/mp4,video/webm' : '.svg,.png,.webp,.jpg,.jpeg,image/*');
                if (!f) return;
                await APP.acao(env, async () => {
                    toast('Enviando…');
                    arte = await MARQ.enviarArquivoPut('/api/app/arte/' + slot + '?nome=' + encodeURIComponent(f.name), f);
                    toast('Arte atualizada.');
                    desenhar();
                });
                return;
            }
            const rest = ev.target.closest('[data-restaurar]');
            if (rest) {
                const ok = await confirmar({ titulo: 'Voltar ao padrão?', texto: 'Sua imagem desta parte é apagada e o telão volta a usar a arte padrão do MarQGol.', sim: 'Restaurar padrão', perigo: true });
                if (!ok) return;
                await APP.acao(rest, async () => {
                    arte = await MARQ.api('DELETE', '/api/app/arte/' + rest.dataset.restaurar);
                    toast('Arte padrão restaurada.');
                    desenhar();
                });
            }
        };
        desenhar();
    });

    // ================= Usuários =================
    APP.tela('usuarios', async (ctx) => {
        const el = ctx.el;
        async function desenhar() {
            const [lista, R] = await Promise.all([MARQ.api('GET', '/api/app/usuarios'), APP.atualizarResumo()]);
            if (!ctx.ativo()) return;
            const eu = R.usuario.id;
            const uso = num(R.uso.max_usuarios), lim = num(R.limites.max_usuarios);
            el.innerHTML = `
            ${APP.tituloPagina('Usuários', 'Quem pode entrar na conta. <b>Administrador</b> gerencia tudo; <b>operador</b> agenda jogos, cadastra times e opera os placares.',
                `<span class="contador ${uso >= lim ? 'cheio' : ''}"><b>${uso}</b> de <b>${lim}</b> usuários</span>
                 <button type="button" class="btn claro" data-acao="convidar">${ic('plus')}Novo usuário</button>`)}
            <section class="cartao"><div class="lista">${lista.map(u => `
                <div class="usuario-linha" data-id="${u.id}">
                    <div class="txt"><b>${esc(u.nome)}${u.id === eu ? ' <span class="tag info">Você</span>' : ''}</b><span>${esc(u.email)}</span>
                        <div class="linha" style="gap:6px;margin-top:4px">
                            ${u.ativo ? '' : '<span class="tag perigo">Desativado</span>'}
                            ${u.convite_pendente ? '<span class="tag alerta">Convite pendente</span>' : ''}
                            ${!u.convite_pendente && !u.email_verificado_em && R.usuario.emailAtivo ? '<span class="tag">E-mail não confirmado</span>' : ''}
                            <span class="ajuda" style="margin:0">${u.ultimo_login_em ? 'Último acesso ' + esc(MARQ.dataHora(u.ultimo_login_em)) : 'Nunca entrou'}</span>
                        </div></div>
                    ${u.id === eu ? `<span class="tag ${u.papel === 'admin' ? 'marca' : ''}">${u.papel === 'admin' ? 'Administrador' : 'Operador'}</span>` : `<div class="acoes">
                        <select class="campo" data-papel aria-label="Papel de ${esc(u.nome)}">
                            <option value="operador" ${u.papel === 'operador' ? 'selected' : ''}>Operador</option>
                            <option value="admin" ${u.papel === 'admin' ? 'selected' : ''}>Administrador</option>
                        </select>
                        ${u.convite_pendente ? `<button type="button" class="btn peq" data-acao="reenviar">${ic('refresh')}Reenviar convite</button>` : ''}
                        <button type="button" class="btn peq" data-acao="senha">${ic('lock')}Senha</button>
                        <button type="button" class="btn peq" data-acao="ativo" data-ativo="${u.ativo}">${ic('power')}${u.ativo ? 'Desativar' : 'Ativar'}</button>
                        <button type="button" class="btn peq icone perigo" data-acao="remover" aria-label="Remover ${esc(u.nome)}" title="Remover">${ic('trash')}</button>
                    </div>`}
                </div>`).join('')}</div></section>`;
        }

        el.onchange = async (ev) => {
            if (!ev.target.matches('[data-papel]')) return;
            const id = ev.target.closest('[data-id]').dataset.id;
            try { await MARQ.api('PATCH', '/api/app/usuarios/' + id, { papel: ev.target.value }); toast('Papel alterado.'); }
            catch (e) { await APP.falhou(e); }
            await desenhar();
        };
        el.onclick = async (ev) => {
            const b = ev.target.closest('[data-acao]');
            if (!b) return;
            const linha = b.closest('[data-id]');
            const id = linha && linha.dataset.id;
            const nome = linha && linha.querySelector('.txt b').firstChild.textContent;
            switch (b.dataset.acao) {
                case 'convidar': convidar(() => desenhar().catch(APP.falhou)); break;
                case 'senha': definirSenha(id, nome, () => desenhar().catch(APP.falhou)); break;
                case 'reenviar':
                    await APP.acao(b, async () => { await MARQ.api('POST', `/api/app/usuarios/${id}/reenviar`); toast('Convite reenviado.'); });
                    break;
                case 'ativo': {
                    const ativar = b.dataset.ativo !== 'true';
                    if (!ativar && !(await confirmar({ titulo: 'Desativar usuário?', texto: `${nome} não consegue mais entrar até ser reativado.`, sim: 'Desativar', perigo: true }))) return;
                    await APP.acao(b, async () => { await MARQ.api('PATCH', '/api/app/usuarios/' + id, { ativo: ativar }); toast(ativar ? 'Usuário ativado.' : 'Usuário desativado.'); await desenhar(); });
                    break;
                }
                case 'remover':
                    if (!(await confirmar({ titulo: 'Remover usuário?', texto: `${nome} perde o acesso e sai da lista. Isso não pode ser desfeito.`, sim: 'Remover', perigo: true }))) return;
                    await APP.acao(b, async () => { await MARQ.api('DELETE', '/api/app/usuarios/' + id); toast('Usuário removido.'); await desenhar(); });
                    break;
            }
        };
        await desenhar();
    });

    // Campo de senha visível com gerador: quem cadastra passa a senha para a pessoa.
    const campoSenha = (rotulo) => `<label class="inteira"><span class="rotulo">${esc(rotulo)}</span>
        <div class="acoes" style="flex-wrap:nowrap"><input class="campo" name="senha" autocomplete="off" spellcheck="false" minlength="8" placeholder="Mínimo de 8 caracteres" style="font-family:ui-monospace,Consolas,monospace">
        <button type="button" class="btn" data-gerar>${ic('refresh')}Gerar</button></div>
        <span class="ajuda">Anote e passe para a pessoa. Ela pode trocar depois em “Minha conta”.</span></label>`;
    function ligarSenha(f) {
        f.senha.value = MARQ.gerarSenha();
        f.querySelector('[data-gerar]').addEventListener('click', () => { f.senha.value = MARQ.gerarSenha(); f.senha.select(); });
    }
    const dadosDeAcesso = (nome, email, senha) =>
        avisar('Pronto', `Passe o acesso para ${nome}:\n\nEndereço: ${location.origin}/entrar\nE-mail: ${email}\nSenha: ${senha}`);

    async function convidar(aposSalvar) {
        let porEmail = false;
        try { porEmail = !!(await MARQ.api('GET', '/api/auth/eu')).emailAtivo; } catch { /* sem e-mail */ }
        APP.folha({
            titulo: 'Novo usuário',
            sub: 'Defina a senha agora e passe para a pessoa, ou envie um convite por e-mail para ela criar a própria.',
            classe: 'media',
            corpo: `<div class="form-grade">
                <label><span class="rotulo">Nome</span><input class="campo" name="nome" maxlength="120" required></label>
                <label><span class="rotulo">E-mail (login)</span><input class="campo" type="email" name="email" required autocomplete="off"></label>
                <div class="inteira"><span class="rotulo">Papel</span><div class="segmentos" role="radiogroup">
                    <label class="segmento"><input type="radio" name="papel" value="operador" checked>Operador<small>Agenda, times e placares</small></label>
                    <label class="segmento"><input type="radio" name="papel" value="admin">Administrador<small>Tudo, inclusive assinatura</small></label>
                </div></div>
                <div class="inteira"><span class="rotulo">Acesso</span><div class="segmentos" role="radiogroup">
                    <label class="segmento"><input type="radio" name="acesso" value="senha" ${porEmail ? '' : 'checked'}>Definir senha agora<small>Você passa a senha</small></label>
                    <label class="segmento"><input type="radio" name="acesso" value="convite" ${porEmail ? 'checked' : ''} ${porEmail ? '' : 'disabled'}>Convite por e-mail<small>${porEmail ? 'A pessoa cria a senha' : 'Indisponível no momento'}</small></label>
                </div></div>
                <div class="inteira" data-bloco-senha>${campoSenha('Senha inicial')}</div></div>`,
            botoes: [{ rotulo: 'Cancelar', cancelar: true }, { rotulo: 'Criar usuário', classe: 'claro', enviar: true }],
            aoAbrir: (f) => {
                ligarSenha(f);
                const atualizar = () => { f.querySelector('[data-bloco-senha]').hidden = f.querySelector('input[name=acesso]:checked').value !== 'senha'; };
                f.querySelectorAll('input[name=acesso]').forEach(r => r.addEventListener('change', atualizar));
                atualizar();
            },
            aoEnviar: async (f) => {
                if (!f.nome.value.trim() || !f.email.value.trim()) { await avisar('Faltam dados', 'Informe o nome e o e-mail.'); return false; }
                const corpo = { nome: f.nome.value.trim(), email: f.email.value.trim(), papel: f.querySelector('input[name=papel]:checked').value };
                const comSenha = f.querySelector('input[name=acesso]:checked').value === 'senha';
                if (comSenha) {
                    corpo.senha = f.senha.value.trim();
                    if (corpo.senha.length < 8) { await avisar('Senha curta', 'A senha precisa ter pelo menos 8 caracteres.'); return false; }
                }
                await MARQ.api('POST', '/api/app/usuarios', corpo);
                aposSalvar();
                if (comSenha) dadosDeAcesso(corpo.nome, corpo.email, corpo.senha); else toast('Convite enviado.');
            }
        });
    }

    function definirSenha(id, nome, aposSalvar) {
        APP.folha({
            titulo: `Nova senha — ${nome}`,
            sub: 'As sessões abertas dessa pessoa são encerradas; ela entra de novo com a senha nova.',
            classe: 'media',
            corpo: `<div class="form-grade">${campoSenha('Nova senha')}</div>`,
            botoes: [{ rotulo: 'Cancelar', cancelar: true }, { rotulo: 'Definir senha', classe: 'claro', enviar: true }],
            aoAbrir: ligarSenha,
            aoEnviar: async (f) => {
                const senha = f.senha.value.trim();
                if (senha.length < 8) { await avisar('Senha curta', 'A senha precisa ter pelo menos 8 caracteres.'); return false; }
                await MARQ.api('PATCH', '/api/app/usuarios/' + id, { senha });
                aposSalvar();
                avisar('Senha definida', `Nova senha de ${nome}:\n${senha}\n\nPasse para a pessoa por um canal seguro.`);
            }
        });
    }

    // ================= Assinatura =================
    const STATUS_FATURA = {
        PENDING: ['Em aberto', 'info'], RECEIVED: ['Paga', 'ok'], CONFIRMED: ['Paga', 'ok'], RECEIVED_IN_CASH: ['Paga', 'ok'],
        OVERDUE: ['Vencida', 'perigo'], REFUNDED: ['Estornada', ''], REFUND_REQUESTED: ['Estorno pedido', ''],
        REFUND_IN_PROGRESS: ['Estornando', ''], CHARGEBACK_REQUESTED: ['Contestada', 'perigo'], CHARGEBACK_DISPUTE: ['Em disputa', 'perigo'],
        AWAITING_CHARGEBACK_REVERSAL: ['Em disputa', 'perigo'], DUNNING_REQUESTED: ['Em cobrança', 'alerta'], DUNNING_RECEIVED: ['Paga', 'ok'],
        AWAITING_RISK_ANALYSIS: ['Em análise', 'alerta'], DELETED: ['Cancelada', '']
    };
    const FORMA = { PIX: 'Pix', BOLETO: 'Boleto', CREDIT_CARD: 'Cartão', UNDEFINED: 'Pix, boleto ou cartão', DEBIT_CARD: 'Débito' };
    const PAGA = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED'];

    function cartaoPlano(p, atual, podeAssinar, temAssinatura) {
        const esportes = (p.esportes && p.esportes.length ? p.esportes : Object.keys(ESPORTES)).map(e => ESPORTES[e] || e).join(', ');
        const rec = p.recursos || {};
        return `<div class="plano ${atual ? 'atual' : ''}">
            <h3>${esc(p.nome)}${atual ? '<span class="tag marca">Seu plano</span>' : ''}</h3>
            <div class="preco">${esc(MARQ.dinheiro(p.preco_centavos))} <small>/ mês</small></div>
            ${p.descricao ? `<p class="ajuda" style="margin:0">${esc(p.descricao)}</p>` : ''}
            <ul>
                <li>${ic('check')}${num(p.max_placares)} placar${num(p.max_placares) === 1 ? '' : 'es'} simultâneo${num(p.max_placares) === 1 ? '' : 's'}</li>
                <li>${ic('check')}${num(p.max_jogos_abertos)} jogos em aberto</li>
                <li>${ic('check')}${num(p.max_usuarios)} usuário${num(p.max_usuarios) === 1 ? '' : 's'}</li>
                <li>${ic('check')}${esc(APP.mb(p.max_armazenamento_mb))} de arquivos</li>
                <li>${ic('check')}${esc(esportes)}</li>
                ${Object.entries(RECURSOS).map(([k, r]) => rec[k] ? `<li>${ic('check')}${esc(r)}</li>` : `<li class="nao">${ic('x')}${esc(r)}</li>`).join('')}
            </ul>
            ${podeAssinar ? (atual && temAssinatura
                ? '<button type="button" class="btn bloco" disabled>Plano atual</button>'
                : `<button type="button" class="btn bloco ${atual ? 'marca' : 'claro'}" data-assinar="${p.id}" data-nome="${esc(p.nome)}">${atual ? 'Assinar' : (temAssinatura ? 'Trocar para este plano' : 'Assinar este plano')}</button>`) : ''}
        </div>`;
    }

    APP.tela('assinatura', async (ctx) => {
        const el = ctx.el;
        async function desenhar() {
            const [a] = await Promise.all([MARQ.api('GET', '/api/app/assinatura'), APP.atualizarResumo()]);
            if (!ctx.ativo()) return;
            const c = a.cliente;
            const [stR, stC] = APP.STATUS_CLIENTE[c.status] || [c.status, ''];
            const atual = a.planos.find(p => p.id === c.plano_id);
            const suporte = APP.S.resumo.usuario.impersonando;
            const podeAssinar = a.pagamentoOnline && !suporte;
            const aberta = a.faturas.find(f => !PAGA.includes(f.status) && f.link && ['PENDING', 'OVERDUE'].includes(f.status));
            el.innerHTML = `
            ${APP.tituloPagina('Assinatura', 'Plano, pagamento e faturas.', `<button type="button" class="btn" data-acao="atualizar">${ic('refresh')}Atualizar</button>`)}
            <section class="cartao">
                <div class="cartao-cab"><div><h2>Situação</h2></div><span class="tag ${stC}" style="font-size:15px">${esc(stR)}</span></div>
                <dl class="dl">
                    <dt>Plano</dt><dd>${atual ? esc(atual.nome) + ' · ' + esc(MARQ.dinheiro(atual.preco_centavos)) + '/mês' : 'Nenhum'}</dd>
                    ${c.status === 'teste' ? `<dt>Teste até</dt><dd>${esc(MARQ.data(c.teste_ate))}</dd>` : ''}
                    ${c.proximo_vencimento ? `<dt>Próximo vencimento</dt><dd>${esc(MARQ.data(c.proximo_vencimento))}</dd>` : ''}
                    <dt>Assinatura</dt><dd>${c.tem_assinatura ? 'Registrada' : 'Ainda não assinada'}</dd>
                </dl>
                ${aberta ? `<div class="acoes"><a class="btn marca" href="${esc(aberta.link)}" target="_blank" rel="noopener">${ic('card')}Pagar fatura em aberto (${esc(MARQ.dinheiro(aberta.valor_centavos))})</a></div>` : ''}
                ${a.pagamentoOnline
                    ? `<div class="aviso-caixa info">${ic('info')}<div>${c.status === 'teste' ? 'A primeira cobrança vence no fim do teste. ' : ''}Pague por <b>Pix, boleto ou cartão</b>. A fatura chega por e-mail e também aparece aqui.</div></div>`
                    : `<div class="aviso-caixa">${ic('alert')}<div><b>O pagamento online ainda não está ativo.</b> Para assinar ou trocar de plano, fale com o suporte do MarQGol.</div></div>`}
                ${suporte ? `<div class="aviso-caixa">${ic('shield')}<div>Como suporte, altere o plano pelo painel de gestão.</div></div>` : ''}
            </section>
            <section class="cartao">
                <div class="cartao-cab"><div><h2>Planos</h2><p>Trocar de plano vale a partir da próxima cobrança.</p></div></div>
                <div class="grade-planos">${a.planos.map(p => cartaoPlano(p, p.id === c.plano_id, podeAssinar, c.tem_assinatura)).join('')}</div>
            </section>
            <section class="cartao">
                <div class="cartao-cab"><div><h2>Faturas</h2></div></div>
                ${a.faturas.length ? `<div class="rola-x"><table class="tabela">
                    <thead><tr><th>Vencimento</th><th>Valor</th><th>Situação</th><th>Forma</th><th></th></tr></thead>
                    <tbody>${a.faturas.map(f => { const [r, cl] = STATUS_FATURA[f.status] || [f.status, '']; return `<tr>
                        <td>${esc(MARQ.data(f.vencimento))}</td><td class="num">${esc(MARQ.dinheiro(f.valor_centavos))}</td>
                        <td><span class="tag ${cl}">${esc(r)}</span>${f.pago_em ? ` <span class="ajuda">em ${esc(MARQ.data(f.pago_em))}</span>` : ''}</td>
                        <td>${esc(FORMA[f.forma] || f.forma || '—')}</td>
                        <td>${f.link ? `<a class="btn peq ${PAGA.includes(f.status) ? '' : 'marca'}" href="${esc(f.link)}" target="_blank" rel="noopener">${PAGA.includes(f.status) ? 'Ver' : 'Pagar'}</a>` : ''}</td>
                    </tr>`; }).join('')}</tbody></table></div>`
                : APP.vazio('file', 'Nenhuma fatura ainda.', c.status === 'teste' ? 'A primeira aparece quando você assinar.' : '')}
            </section>
            ${c.tem_assinatura && c.status !== 'cancelado' && !suporte ? `<section class="cartao">
                <div class="cartao-cab"><div><h2>Cancelar assinatura</h2><p>As cobranças futuras são canceladas e o acesso aos placares é encerrado.</p></div>
                <button type="button" class="btn perigo" data-acao="cancelar">${ic('x')}Cancelar assinatura</button></div>
            </section>` : ''}`;
        }

        el.onclick = async (ev) => {
            const as = ev.target.closest('[data-assinar]');
            if (as) {
                const ok = await confirmar({ titulo: `Assinar o plano ${as.dataset.nome}?`, texto: 'Geramos a cobrança mensal. A primeira vence no fim do teste (ou hoje, se o teste já acabou). Pague por Pix, boleto ou cartão.', sim: 'Assinar' });
                if (!ok) return;
                await APP.acao(as, async () => {
                    const r = await MARQ.api('POST', '/api/app/assinatura', { planoId: Number(as.dataset.assinar) });
                    await desenhar();
                    if (r.linkPagamento) {
                        APP.folha({
                            titulo: 'Assinatura registrada',
                            corpo: '<p>Sua fatura está pronta. Você pode pagar agora ou depois pelo e-mail que enviamos.</p>',
                            botoes: [{ rotulo: 'Depois', cancelar: true }],
                            aoAbrir: (f) => f.querySelector('.folha-pe').insertAdjacentHTML('beforeend',
                                `<a class="btn marca" href="${esc(r.linkPagamento)}" target="_blank" rel="noopener">${ic('card')}Pagar fatura</a>`)
                        });
                    } else toast('Plano atualizado.');
                });
                return;
            }
            const b = ev.target.closest('[data-acao]');
            if (!b) return;
            if (b.dataset.acao === 'atualizar') {
                await APP.acao(b, async () => { await MARQ.api('POST', '/api/app/assinatura/atualizar'); await desenhar(); toast('Faturas atualizadas.'); });
            } else if (b.dataset.acao === 'cancelar') {
                APP.folha({
                    titulo: 'Cancelar assinatura',
                    sub: 'Esta ação encerra o acesso aos placares. Seus dados ficam guardados caso queira voltar.',
                    corpo: `<label><span class="rotulo">Digite CANCELAR para confirmar</span><input class="campo" name="confirmacao" autocomplete="off" required></label>`,
                    botoes: [{ rotulo: 'Voltar', cancelar: true }, { rotulo: 'Cancelar assinatura', classe: 'perigo', enviar: true }],
                    aoEnviar: async (f) => {
                        if (f.confirmacao.value.trim().toUpperCase() !== 'CANCELAR') { await avisar('Confirmação', 'Digite CANCELAR para confirmar.'); return false; }
                        await MARQ.api('POST', '/api/app/assinatura/cancelar', { confirmacao: f.confirmacao.value.trim() });
                        toast('Assinatura cancelada.');
                        await desenhar();
                    }
                });
            }
        };
        await desenhar();
    });

    // ================= Conta e perfil =================
    APP.tela('conta', async (ctx) => {
        const el = ctx.el;
        const R = await APP.atualizarResumo();
        if (!ctx.ativo()) return;
        const admin = APP.ehAdmin();
        const c = R.cliente, u = R.usuario;
        const docFmt = (d) => {
            const s = String(d || '').replace(/\D/g, '');
            if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
            if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
            return s;
        };
        el.innerHTML = `
        ${APP.tituloPagina(admin ? 'Conta' : 'Meu perfil')}
        <div class="grade-2">
        ${admin ? `<section class="cartao">
            <div class="cartao-cab"><div><h2>Dados do cliente</h2><p>Usados na cobrança e nas notas.</p></div></div>
            <form id="form-conta" class="form-grade" style="grid-template-columns:1fr">
                <label><span class="rotulo">Nome do clube / empresa</span><input class="campo" name="nome" maxlength="120" required value="${esc(c.nome)}"></label>
                <label><span class="rotulo">CPF ou CNPJ</span><input class="campo" name="documento" inputmode="numeric" maxlength="18" value="${esc(docFmt(c.documento))}"></label>
                <label><span class="rotulo">E-mail de cobrança</span><input class="campo" type="email" name="email" value="${esc(c.email || '')}"></label>
                <label><span class="rotulo">Telefone</span><input class="campo" type="tel" name="telefone" maxlength="20" value="${esc(c.telefone || '')}"></label>
                <div class="acoes"><button type="submit" class="btn claro">${ic('save')}Salvar dados</button></div>
            </form>
        </section>` : ''}
        <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
        <section class="cartao">
            <div class="cartao-cab"><div><h2>Meu perfil</h2><p>${esc(u.email)} · ${u.papel === 'admin' ? 'Administrador' : 'Operador'}</p></div></div>
            <form id="form-perfil" class="form-grade" style="grid-template-columns:1fr">
                <label><span class="rotulo">Seu nome</span><input class="campo" name="nome" maxlength="120" required value="${esc(u.nome)}"></label>
                <div class="acoes"><button type="submit" class="btn claro">${ic('save')}Salvar nome</button></div>
            </form>
        </section>
        <section class="cartao">
            <div class="cartao-cab"><div><h2>Trocar senha</h2><p>Mínimo de 8 caracteres.</p></div></div>
            ${u.impersonando ? '<p class="ajuda">O suporte não troca a senha de usuários.</p>' : `
            <form id="form-senha" class="form-grade" style="grid-template-columns:1fr">
                <label><span class="rotulo">Senha atual</span><input class="campo" type="password" name="senhaAtual" autocomplete="current-password" required></label>
                <label><span class="rotulo">Nova senha</span><input class="campo" type="password" name="novaSenha" autocomplete="new-password" minlength="8" required></label>
                <label><span class="rotulo">Repita a nova senha</span><input class="campo" type="password" name="repetir" autocomplete="new-password" required></label>
                <div class="acoes"><button type="submit" class="btn claro">${ic('lock')}Trocar senha</button></div>
            </form>`}
        </section>
        <section class="cartao">
            <div class="cartao-cab" style="align-items:center"><div><h2>Sair</h2><p>Encerra a sessão neste aparelho.</p></div>
                <button type="button" class="btn" data-acao="sair">${ic('logout')}Sair</button></div>
        </section>
        </div></div>`;

        el.onclick = (ev) => { if (ev.target.closest('[data-acao=sair]')) APP.sair(); };
        el.onsubmit = async (ev) => {
            ev.preventDefault();
            const f = ev.target;
            const botao = f.querySelector('[type=submit]');
            if (f.id === 'form-conta') {
                await APP.acao(botao, async () => {
                    await MARQ.api('PATCH', '/api/app/conta', { nome: f.nome.value.trim(), documento: f.documento.value, email: f.email.value.trim(), telefone: f.telefone.value });
                    toast('Dados salvos.');
                    await APP.atualizarResumo();
                });
            } else if (f.id === 'form-perfil') {
                await APP.acao(botao, async () => {
                    await MARQ.api('PATCH', '/api/app/perfil', { nome: f.nome.value.trim() });
                    toast('Nome salvo.');
                    await APP.atualizarResumo();
                });
            } else if (f.id === 'form-senha') {
                if (f.novaSenha.value.length < 8) { avisar('Senha curta', 'A nova senha precisa ter pelo menos 8 caracteres.'); return; }
                if (f.novaSenha.value !== f.repetir.value) { avisar('Senhas diferentes', 'A nova senha e a repetição não conferem.'); return; }
                await APP.acao(botao, async () => {
                    await MARQ.api('PATCH', '/api/app/perfil', { senhaAtual: f.senhaAtual.value, novaSenha: f.novaSenha.value });
                    f.reset();
                    toast('Senha trocada.');
                });
            }
        };
    });
})();
