// Páginas e arquivos servidos por placar, e uploads dos clientes.
//
//   /p/<placar>/                 telão (public/placar/index.html)          usuário do cliente ou TV pareada
//   /p/<placar>/static.html      placar simples                             idem
//   /p/<placar>/placar-neutro.html                                           idem
//   /p/<placar>/base/<slot>.png  arte do telão (do cliente ou a padrão)     idem
//   /p/<placar>/videos|slides|patrocinadores/<nome>                          idem
//   /p/<placar>/controle/...     controle, configuração, mídia               só usuário do cliente
//   /arquivos/<cliente>/fotos|videos-jogador/<nome>                          usuário do cliente ou TV do cliente
//
// Como as páginas usam caminhos relativos (style.css, base/..., ui.css), elas
// funcionam iguais sob /p/<placar>/ sem saber em que placar estão.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logic = require('../../gameLogic');
const arm = require('../armazenamento');
const limites = require('../limites');
const { resolverTela, lerCookies } = require('../auth');
const { ErroRegra } = require('../servicos/agenda');
const seg = require('../seguranca');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const ARTE_PADRAO = path.join(PUBLIC, 'arte-padrao');

// html/css/js revalidam sempre (a TV fica dias aberta e precisa pegar deploy).
const opcoesEstatico = {
    setHeaders(res, arquivo) {
        if (/\.(html|css|js)$/i.test(arquivo)) res.setHeader('Cache-Control', 'no-cache');
    }
};

function rotasArquivos({ repos, armazenamento, gerenciador, cfg, mw }) {
    const r = express.Router({ mergeParams: true });

    function guardaPlacar({ permitirTela }) {
        return async (req, res, next) => {
            const placarId = Number(req.params.placarId);
            const placar = Number.isInteger(placarId) && placarId > 0 ? await repos.placares.obterInterno(placarId) : null;
            if (!placar) return res.status(404).send('Placar não encontrado');
            if (req.usuario && req.usuario.clienteId === placar.cliente_id) {
                req.placar = placar;
                return next();
            }
            if (permitirTela) {
                const tela = await resolverTela(repos, lerCookies(req.headers.cookie));
                if (tela && tela.placar_id === placar.id) {
                    req.placar = placar;
                    return next();
                }
            }
            const html = (req.headers.accept || '').includes('text/html');
            if (!html) return res.status(403).send('Sem acesso');
            if (req.usuario) return res.redirect('/app/');
            // TV sem pareamento vai para o pareamento; pessoa vai para o login.
            return res.redirect(permitirTela && !req.originalUrl.includes('/controle') ? '/telao' : '/entrar?voltar=' + encodeURIComponent(req.originalUrl));
        };
    }

    // As páginas usam caminhos relativos: /p/7 precisa virar /p/7/.
    r.get('/p/:placarId', (req, res, next) => {
        const i = req.originalUrl.indexOf('?');
        const caminho = i < 0 ? req.originalUrl : req.originalUrl.slice(0, i);
        if (caminho.endsWith('/')) return next(); // sem barra estrita, /p/7/ também casa aqui
        res.redirect(301, caminho + '/' + (i < 0 ? '' : req.originalUrl.slice(i)));
    });

    // ---- Arte do telão ----
    // O telão pede `base/futsal/box.png`; o slot é o caminho sem extensão.
    r.get('/p/:placarId/base/*caminho', guardaPlacar({ permitirTela: true }), async (req, res) => {
        const caminho = [].concat(req.params.caminho).join('/');
        const slot = caminho.replace(/\.[a-z0-9]+$/i, '');
        if (!arm.SLOTS_ARTE.includes(slot)) return res.status(404).end();
        res.setHeader('Cache-Control', 'no-cache');
        const doCliente = await armazenamento.arquivoArte(req.placar.cliente_id, slot);
        if (doCliente) return res.type(arm.tipoConteudo(doCliente)).sendFile(doCliente);
        const padrao = path.join(ARTE_PADRAO, slot + '.svg');
        if (fs.existsSync(padrao)) return res.type('image/svg+xml').sendFile(padrao);
        res.status(404).end();
    });

    // ---- Mídia do cliente vista pelo telão ----
    for (const [tipo, def] of Object.entries(arm.TIPOS_MIDIA)) {
        r.get(`/p/:placarId/${def.pasta}/:nome`, guardaPlacar({ permitirTela: true }), (req, res) => {
            const nome = logic.sanitizarNomeArquivo(req.params.nome);
            if (!nome) return res.status(400).end();
            res.sendFile(path.join(armazenamento.pasta(req.placar.cliente_id, def.pasta), nome), (e) => {
                if (e && !res.headersSent) res.status(e.statusCode || 404).end();
            });
        });
        void tipo;
    }

    r.use('/p/:placarId/controle', guardaPlacar({ permitirTela: false }), express.static(path.join(PUBLIC, 'controle'), opcoesEstatico));
    r.use('/p/:placarId', guardaPlacar({ permitirTela: true }), express.static(path.join(PUBLIC, 'placar'), opcoesEstatico));

    // ---- Fotos e vídeos de cadastro ----
    r.get('/arquivos/:clienteId/:pasta/:nome', async (req, res) => {
        const clienteId = Number(req.params.clienteId);
        const def = Object.values(arm.TIPOS_CADASTRO).find(d => d.pasta === req.params.pasta);
        const nome = logic.sanitizarNomeArquivo(req.params.nome);
        if (!def || !nome) return res.status(404).end();
        let ok = req.usuario && req.usuario.clienteId === clienteId;
        if (!ok) {
            const tela = await resolverTela(repos, lerCookies(req.headers.cookie));
            ok = !!tela && tela.cliente_id === clienteId;
        }
        if (!ok) return res.status(403).end();
        res.setHeader('Cache-Control', 'private, max-age=86400');
        res.sendFile(path.join(armazenamento.pasta(clienteId, def.pasta), nome), (e) => {
            if (e && !res.headersSent) res.status(e.statusCode || 404).end();
        });
    });

    // ---- Uploads ----
    // Confere a cota: tamanho declarado (Content-Length) antes de começar e o
    // tamanho real durante a gravação.
    async function limiteDeBytes(clienteId, req) {
        const lim = await repos.clientes.limites(clienteId);
        const usado = await armazenamento.usoBytes(clienteId);
        const restante = lim.max_armazenamento_mb * 1024 * 1024 - usado;
        const maxArquivo = cfg.maxUploadMb * 1024 * 1024;
        const declarado = Number(req.headers['content-length'] || 0);
        if (declarado > restante || restante <= 0) {
            throw new ErroRegra(`Sem espaço: seu plano permite ${lim.max_armazenamento_mb} MB de arquivos. Apague arquivos antigos ou troque de plano.`, 413, 'limite');
        }
        if (declarado > maxArquivo) throw new ErroRegra(`Arquivo grande demais (máximo ${cfg.maxUploadMb} MB por arquivo).`, 413);
        return { lim, maximo: Math.min(restante, maxArquivo) };
    }

    async function aposMudancaMidia(clienteId, tipo) {
        if (tipo === 'patrocinador') return gerenciador.aposMudancaPatrocinadores(clienteId);
        const def = arm.TIPOS_MIDIA[tipo];
        const nomes = await armazenamento.listar(clienteId, def.pasta);
        if (tipo === 'slide') {
            const lista = logic.filtrarSlides(nomes).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
            gerenciador.emitirParaCliente(clienteId, 'lista_slides', lista);
        } else {
            gerenciador.emitirParaCliente(clienteId, 'lista_videos', logic.filtrarVideos(nomes));
        }
    }

    // Mídia (comerciais, slides, patrocinadores): nome escolhido pelo operador.
    r.post('/api/midia/:tipo', mw.exigirCliente, mw.exigirOperante, async (req, res) => {
        const def = arm.TIPOS_MIDIA[req.params.tipo];
        if (!def) throw new ErroRegra('Tipo de upload desconhecido', 404);
        const clienteId = req.usuario.clienteId;
        const { lim, maximo } = await limiteDeBytes(clienteId, req);
        if (!limites.recursoPermitido('midia', lim)) throw new ErroRegra('Comerciais, slides e patrocinadores não fazem parte do seu plano.', 403, 'limite');
        const nome = logic.sanitizarNomeArquivo(req.query.nome);
        if (!nome || !def.extensoes.includes(path.extname(nome).toLowerCase())) {
            throw new ErroRegra(`Nome inválido ou extensão não permitida (aceitas: ${def.extensoes.join(', ')})`, 400);
        }
        const dir = await armazenamento.garantirPasta(armazenamento.pasta(clienteId, def.pasta));
        await armazenamento.gravarStream(req, path.join(dir, nome), maximo);
        armazenamento.invalidarUso(clienteId);
        await aposMudancaMidia(clienteId, req.params.tipo);
        res.json({ ok: true, nome });
    });

    r.delete('/api/midia/:tipo/:nome', mw.exigirCliente, async (req, res) => {
        const def = arm.TIPOS_MIDIA[req.params.tipo];
        if (!def) throw new ErroRegra('Tipo desconhecido', 404);
        try {
            await armazenamento.remover(req.usuario.clienteId, def.pasta, req.params.nome);
        } catch (e) {
            throw new ErroRegra(e.code === 'ENOENT' ? 'Arquivo não encontrado' : e.message, e.code === 'ENOENT' ? 404 : (e.status || 500));
        }
        await aposMudancaMidia(req.usuario.clienteId, req.params.tipo);
        res.json({ ok: true });
    });

    // Foto de jogador / logo de time / vídeo de jogador: nome gerado aqui.
    r.post('/api/app/arquivos/:tipo', mw.exigirCliente, mw.exigirOperante, async (req, res) => {
        const def = arm.TIPOS_CADASTRO[req.params.tipo];
        if (!def) throw new ErroRegra('Tipo desconhecido', 404);
        const clienteId = req.usuario.clienteId;
        const { lim, maximo } = await limiteDeBytes(clienteId, req);
        if (req.params.tipo === 'video-jogador' && !limites.recursoPermitido('video_jogador', lim)) {
            throw new ErroRegra('Vídeo de jogador não faz parte do seu plano.', 403, 'limite');
        }
        const ext = path.extname(logic.sanitizarNomeArquivo(req.query.nome) || '').toLowerCase();
        if (!def.extensoes.includes(ext)) throw new ErroRegra(`Extensão não permitida (aceitas: ${def.extensoes.join(', ')})`, 400);
        const nome = crypto.randomBytes(12).toString('hex') + ext;
        const dir = await armazenamento.garantirPasta(armazenamento.pasta(clienteId, def.pasta));
        await armazenamento.gravarStream(req, path.join(dir, nome), Math.min(maximo, 60 * 1024 * 1024));
        armazenamento.invalidarUso(clienteId);
        res.status(201).json({ ok: true, url: `/arquivos/${clienteId}/${def.pasta}/${nome}` });
    });

    r.get('/api/midia', mw.exigirCliente, async (req, res) => {
        const clienteId = req.usuario.clienteId;
        const [videos, slides, patrocinadores, bytes] = await Promise.all([
            armazenamento.listar(clienteId, 'videos'), armazenamento.listar(clienteId, 'slides'),
            armazenamento.listar(clienteId, 'patrocinadores'), armazenamento.usoBytes(clienteId, { semCache: true })
        ]);
        res.json({
            videos: logic.filtrarVideos(videos), slides: logic.filtrarSlides(slides),
            patrocinadores: logic.filtrarImagens(patrocinadores), usoBytes: bytes
        });
    });

    // ---- Arte do telão (cliente com o recurso, ou o superadmin pelo painel) ----
    async function salvarArte(clienteId, slot, req, usuario) {
        if (!arm.SLOTS_ARTE.includes(slot)) throw new ErroRegra('Parte da arte desconhecida.', 404);
        const ext = path.extname(logic.sanitizarNomeArquivo(req.query.nome) || '').toLowerCase();
        const aceitas = slot === 'espera' ? arm.EXTENSOES_ESPERA : arm.EXTENSOES_ARTE;
        if (!aceitas.includes(ext)) throw new ErroRegra(`Formato não aceito (use ${aceitas.join(', ')}).`, 400);
        const { maximo } = await limiteDeBytes(clienteId, req);
        const dir = await armazenamento.garantirPasta(path.join(armazenamento.pasta(clienteId, 'arte'), path.dirname(slot)));
        const destinoTemp = path.join(dir, path.basename(slot) + '.novo' + ext);
        await armazenamento.gravarStream(req, destinoTemp, maximo);
        await armazenamento.removerArte(clienteId, slot); // troca a extensão se mudou
        fs.renameSync(destinoTemp, path.join(dir, path.basename(slot) + ext));
        await incrementarVersaoArte(clienteId);
        await repos.auditoria.registrar({ usuarioId: usuario.id, clienteId, acao: 'arte_alterada', dados: { slot }, ip: seg.ipDoPedido(req) });
    }

    async function incrementarVersaoArte(clienteId, extras = {}) {
        const c = await repos.clientes.obter(clienteId);
        const arte = { ...(c.arte || {}), ...extras, versao: ((c.arte && c.arte.versao) || 0) + 1 };
        await repos.clientes.atualizar(clienteId, { arte });
        armazenamento.invalidarUso(clienteId);
        await gerenciador.aposMudancaArte(clienteId);
        return arte;
    }

    async function descreverArte(clienteId) {
        const c = await repos.clientes.obter(clienteId);
        const slots = [];
        for (const slot of arm.SLOTS_ARTE) {
            const f = await armazenamento.arquivoArte(clienteId, slot);
            slots.push({ slot, personalizado: !!f, padrao: fs.existsSync(path.join(ARTE_PADRAO, slot + '.svg')) });
        }
        return { versao: (c.arte && c.arte.versao) || 0, bordas: (c.arte && c.arte.bordas) || null, slots };
    }

    // Bordas: gradientes CSS que pintam a sobra da tela em volta da arte 2:1.
    function validarBordas(b) {
        if (!b) return null;
        const ok = (v) => typeof v === 'string' && v.length < 600 && /^[#a-zA-Z0-9(),.%\s-]+$/.test(v);
        const r = {};
        for (const k of ['topo', 'base', 'lados']) {
            if (b[k] == null || b[k] === '') continue;
            if (!ok(b[k])) throw new ErroRegra(`Cor da borda "${k}" inválida.`);
            r[k] = b[k];
        }
        return Object.keys(r).length ? r : null;
    }

    async function exigirArtePropria(req) {
        if (req.usuario.impersonando) return; // suporte pode sempre
        const lim = await repos.clientes.limites(req.usuario.clienteId);
        if (!limites.recursoPermitido('arte_propria', lim)) {
            throw new ErroRegra('Arte própria não faz parte do seu plano. Fale com o suporte ou troque de plano.', 403, 'limite');
        }
    }

    r.get('/api/app/arte', mw.exigirCliente, async (req, res) => res.json(await descreverArte(req.usuario.clienteId)));
    r.put('/api/app/arte/*slot', mw.exigirCliente, mw.exigirAdminCliente, mw.exigirOperante, async (req, res) => {
        await exigirArtePropria(req);
        await salvarArte(req.usuario.clienteId, [].concat(req.params.slot).join('/'), req, req.usuario);
        res.json(await descreverArte(req.usuario.clienteId));
    });
    r.delete('/api/app/arte/*slot', mw.exigirCliente, mw.exigirAdminCliente, async (req, res) => {
        await exigirArtePropria(req);
        await armazenamento.removerArte(req.usuario.clienteId, [].concat(req.params.slot).join('/'));
        await incrementarVersaoArte(req.usuario.clienteId);
        res.json(await descreverArte(req.usuario.clienteId));
    });
    r.post('/api/app/arte-bordas', mw.exigirCliente, mw.exigirAdminCliente, async (req, res) => {
        await exigirArtePropria(req);
        await incrementarVersaoArte(req.usuario.clienteId, { bordas: validarBordas((req.body || {}).bordas) });
        res.json(await descreverArte(req.usuario.clienteId));
    });

    // Mesmas operações pelo painel de gestão.
    r.get('/api/admin/clientes/:id/arte', mw.exigirSuperadmin, async (req, res) => res.json(await descreverArte(Number(req.params.id))));
    r.put('/api/admin/clientes/:id/arte/*slot', mw.exigirSuperadmin, async (req, res) => {
        const clienteId = Number(req.params.id);
        if (!(await repos.clientes.obter(clienteId))) throw new ErroRegra('Cliente não encontrado', 404);
        await salvarArte(clienteId, [].concat(req.params.slot).join('/'), req, req.usuario);
        res.json(await descreverArte(clienteId));
    });
    r.delete('/api/admin/clientes/:id/arte/*slot', mw.exigirSuperadmin, async (req, res) => {
        const clienteId = Number(req.params.id);
        await armazenamento.removerArte(clienteId, [].concat(req.params.slot).join('/'));
        await incrementarVersaoArte(clienteId);
        res.json(await descreverArte(clienteId));
    });
    r.post('/api/admin/clientes/:id/arte-bordas', mw.exigirSuperadmin, async (req, res) => {
        const clienteId = Number(req.params.id);
        await incrementarVersaoArte(clienteId, { bordas: validarBordas((req.body || {}).bordas) });
        res.json(await descreverArte(clienteId));
    });

    return r;
}

module.exports = { rotasArquivos, PUBLIC, opcoesEstatico };
