// Arquivos dos clientes em disco (volume do Docker em produção):
//
//   <DATA_DIR>/clientes/<clienteId>/
//       videos/           comerciais
//       slides/           slides (imagem ou vídeo)
//       patrocinadores/   logos do carrossel
//       arte/             arte do telão por "slot" (ex.: futsal/box.svg)
//       fotos/            fotos de jogadores e logos de times (nome aleatório)
//       videos-jogador/   vídeo de apresentação do jogador
//
// Um cliente nunca escreve fora da própria pasta: todo nome passa por
// `sanitizarNomeArquivo` (sem caminho) ou é gerado aqui.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const logic = require('../gameLogic');

// Tipos que o operador sobe pela tela de Mídia (nome escolhido por ele).
const TIPOS_MIDIA = {
    video: { pasta: 'videos', extensoes: logic.EXTENSOES_VIDEO },
    patrocinador: { pasta: 'patrocinadores', extensoes: logic.EXTENSOES_IMAGEM },
    slide: { pasta: 'slides', extensoes: logic.EXTENSOES_SLIDE }
};

// Arquivos de cadastro (nome gerado, referenciado por URL).
const TIPOS_CADASTRO = {
    foto: { pasta: 'fotos', extensoes: logic.EXTENSOES_IMAGEM },
    'video-jogador': { pasta: 'videos-jogador', extensoes: ['.mp4', '.webm'] }
};

// Slots da arte do telão. O telão pede `base/<slot>.png` (nome histórico); o
// servidor procura o slot com qualquer extensão aceita. `espera` é o vídeo da
// tela de espera.
const SLOTS_ARTE = [
    'background',
    'futsal/box', 'futsal/element-1', 'futsal/element-2',
    'basquete/box', 'basquete/element-1', 'basquete/element-2',
    'volei/box', 'volei/element-1', 'volei/element-2', 'volei/element-3', 'volei/element-4-on', 'volei/element-4-off',
    'espera'
];
const EXTENSOES_ARTE = ['.svg', '.png', '.webp', '.jpg', '.jpeg'];
const EXTENSOES_ESPERA = ['.mp4', '.webm'];

const TIPOS_CONTEUDO = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska'
};

function criarArmazenamento(dirDados) {
    const raiz = path.join(dirDados, 'clientes');
    const pastaCliente = (clienteId) => path.join(raiz, String(Number(clienteId)));
    const pasta = (clienteId, sub) => path.join(pastaCliente(clienteId), sub);

    async function garantirPasta(dir) {
        await fsp.mkdir(dir, { recursive: true });
        return dir;
    }

    async function listar(clienteId, sub) {
        try { return await fsp.readdir(pasta(clienteId, sub)); } catch { return []; }
    }

    // Soma dos tamanhos de tudo do cliente (para a cota). Em cache por 60 s:
    // percorrer a pasta a cada upload seria desperdício.
    const cacheUso = new Map();
    async function usoBytes(clienteId, { semCache = false } = {}) {
        const c = cacheUso.get(clienteId);
        if (!semCache && c && Date.now() - c.em < 60000) return c.bytes;
        let total = 0;
        async function andar(dir) {
            let itens;
            try { itens = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
            for (const it of itens) {
                const p = path.join(dir, it.name);
                if (it.isDirectory()) await andar(p);
                else { try { total += (await fsp.stat(p)).size; } catch {} }
            }
        }
        await andar(pastaCliente(clienteId));
        cacheUso.set(clienteId, { bytes: total, em: Date.now() });
        return total;
    }
    const invalidarUso = (clienteId) => cacheUso.delete(clienteId);

    // Grava o corpo do pedido por stream, abortando se passar de `maxBytes`.
    // Devolve { bytes } ou lança { status, message }.
    function gravarStream(req, destino, maxBytes) {
        return new Promise((resolve, reject) => {
            const temp = destino + '.parcial-' + crypto.randomBytes(4).toString('hex');
            const saida = fs.createWriteStream(temp);
            let bytes = 0, encerrado = false;
            const falhar = (status, message) => {
                if (encerrado) return;
                encerrado = true;
                req.unpipe(saida);
                saida.destroy();
                fs.unlink(temp, () => {});
                req.resume(); // descarta o resto do corpo
                reject(Object.assign(new Error(message), { status }));
            };
            req.on('data', (parte) => {
                bytes += parte.length;
                if (bytes > maxBytes) falhar(413, 'Arquivo maior que o permitido (limite do plano ou do envio).');
            });
            req.on('aborted', () => falhar(400, 'Envio interrompido.'));
            saida.on('error', (e) => falhar(500, e.message));
            saida.on('finish', () => {
                if (encerrado) return;
                encerrado = true;
                fs.rename(temp, destino, (e) => e ? reject(e) : resolve({ bytes }));
            });
            req.pipe(saida);
        });
    }

    async function remover(clienteId, sub, nome) {
        const n = logic.sanitizarNomeArquivo(nome);
        if (!n) throw Object.assign(new Error('Nome inválido'), { status: 400 });
        await fsp.unlink(path.join(pasta(clienteId, sub), n));
        invalidarUso(clienteId);
    }

    // Caminho do arquivo do slot de arte do cliente, se existir.
    async function arquivoArte(clienteId, slot) {
        if (!SLOTS_ARTE.includes(slot)) return null;
        const dir = path.join(pasta(clienteId, 'arte'), path.dirname(slot));
        const base = path.basename(slot);
        const itens = await fsp.readdir(dir).catch(() => []);
        const achado = itens.find(f => path.parse(f).name === base);
        return achado ? path.join(dir, achado) : null;
    }

    async function removerArte(clienteId, slot) {
        const atual = await arquivoArte(clienteId, slot);
        if (atual) await fsp.unlink(atual);
        invalidarUso(clienteId);
    }

    async function removerCliente(clienteId) {
        await fsp.rm(pastaCliente(clienteId), { recursive: true, force: true });
        invalidarUso(clienteId);
    }

    return {
        raiz, pasta, garantirPasta, listar, usoBytes, invalidarUso, gravarStream, remover,
        arquivoArte, removerArte, removerCliente
    };
}

function tipoConteudo(arquivo) {
    return TIPOS_CONTEUDO[path.extname(arquivo).toLowerCase()] || 'application/octet-stream';
}

module.exports = {
    criarArmazenamento, tipoConteudo,
    TIPOS_MIDIA, TIPOS_CADASTRO, SLOTS_ARTE, EXTENSOES_ARTE, EXTENSOES_ESPERA
};
