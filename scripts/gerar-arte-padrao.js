// Gera a arte padrão (neutra) do telão em public/arte-padrao/*.svg.
// `node scripts/gerar-arte-padrao.js`
//
// É o GABARITO para quem for criar arte própria: proporção 2:1 (viewBox
// 2000×1000), caixas nas mesmas posições (o telão escreve placar, tempo,
// faltas e sets por cima delas em %), faixa de patrocinadores a partir de
// y = 888,7 (88,87 % da altura). As bordas de cima/baixo/laterais são cores
// lisas para casar com --borda-arte-* do style.css.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'arte-padrao');
const COR = {
    topo: '#0d1a38', meio: '#13285a', fimArte: '#0f1f44', faixa: '#060a14',
    painel: '#0a1222', borda1: '#e6edf7', borda2: '#7f8ca3', destaque: '#f5b82e', texto: '#ffffff'
};
const FONTE = `font-family="'Arial Narrow', 'Roboto Condensed', Arial, sans-serif" font-weight="700"`;

function svg(viewBox, corpo) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n${corpo}\n</svg>\n`;
}

// ---------- Fundo ----------
function fundo() {
    const listras = [];
    for (let i = 0; i < 9; i++) {
        const x = 150 + i * 230;
        listras.push(`<path d="M${x} 60 L${x + 120} 60 L${x - 260} 860 L${x - 380} 860 Z" fill="#fff" opacity="${(0.018 + (i % 3) * 0.012).toFixed(3)}"/>`);
    }
    return svg('0 0 2000 1000', `<defs>
  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${COR.topo}"/><stop offset=".45" stop-color="${COR.meio}"/><stop offset="1" stop-color="${COR.fimArte}"/>
  </linearGradient>
  <radialGradient id="luz" cx=".5" cy=".42" r=".55">
    <stop offset="0" stop-color="#2d5bb8" stop-opacity=".45"/><stop offset="1" stop-color="#2d5bb8" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#000"/><stop offset=".08" stop-color="#fff"/><stop offset=".92" stop-color="#fff"/><stop offset="1" stop-color="#000"/>
  </linearGradient>
  <mask id="m"><rect x="0" y="0" width="2000" height="889" fill="url(#fade)"/></mask>
</defs>
<rect width="2000" height="889" fill="url(#g)"/>
<rect width="2000" height="889" fill="url(#luz)"/>
<g mask="url(#m)">${listras.join('')}</g>
<rect y="886" width="2000" height="3" fill="${COR.destaque}" opacity=".55"/>
<rect y="889" width="2000" height="111" fill="${COR.faixa}"/>`);
}

// ---------- Caixas ----------
const defsPainel = `<defs>
  <linearGradient id="bd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${COR.borda1}"/><stop offset="1" stop-color="${COR.borda2}"/></linearGradient>
  <linearGradient id="pn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#132240"/><stop offset="1" stop-color="${COR.painel}"/></linearGradient>
</defs>`;

function painel(x1, y1, x2, y2, r) {
    return `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" rx="${r}" fill="url(#pn)" fill-opacity=".92" stroke="url(#bd)" stroke-width="5"/>
<rect x="${x1 + 14}" y="${y1 + 8}" width="${x2 - x1 - 28}" height="4" rx="2" fill="#fff" opacity=".12"/>`;
}

function rotulo(x, y, texto, tam = 40, extra = '') {
    return `<text x="${x}" y="${y}" text-anchor="middle" ${FONTE} font-size="${tam}" letter-spacing="3" fill="${COR.texto}" fill-opacity=".9" ${extra}>${texto}</text>`;
}

const xis = (x, y) => `<path d="M${x - 40} ${y - 38} L${x + 40} ${y + 38} M${x + 40} ${y - 38} L${x - 40} ${y + 38}" stroke="#fff" stroke-width="12" stroke-linecap="square"/>`;

function boxComFaltas(nomeEsporte) {
    return svg('0 0 2000 1000', `${defsPainel}
${rotulo(868, 168, 'TEMPO')}${rotulo(1193, 168, 'PERÍODO')}
${painel(673, 202, 1325, 358, 22)}
${painel(670, 408, 1322, 724, 22)}${xis(996, 566)}
${painel(283, 200, 445, 362, 30)}${rotulo(364, 404, 'FALTAS', 34)}
${painel(1548, 200, 1710, 362, 30)}${rotulo(1629, 404, 'FALTAS', 34)}
${painel(200, 428, 530, 760, 60)}
${painel(1465, 428, 1795, 760, 60)}
${rotulo(996, 815, nomeEsporte, 52, 'font-style="italic" fill-opacity=".55"')}`);
}

function boxVolei() {
    const sets = (x1, x2, qx, textoX) => `<path d="M${x1} 740 L${x2} 740 L${x2 - 32} 838 L${x1 + 32} 838 Z" fill="url(#pn)" fill-opacity=".92" stroke="url(#bd)" stroke-width="4"/>
<rect x="${qx}" y="720" width="122" height="130" rx="14" fill="#05080f" stroke="url(#bd)" stroke-width="5"/>
${rotulo(textoX, 806, 'SETS', 54)}`;
    return svg('0 0 2000 1000', `${defsPainel}
${rotulo(1000, 106, 'TEMPO')}
${painel(805, 128, 1195, 248, 22)}
${painel(675, 298, 1325, 613, 22)}${xis(1000, 455)}
${painel(675, 655, 1325, 848, 22)}
${painel(202, 293, 532, 625, 60)}
${painel(1467, 293, 1797, 625, 60)}
${sets(155, 582, 388, 280)}
${sets(1418, 1845, 1490, 1718)}`);
}

// ---------- Elementos decorativos (branco translúcido) ----------
function emblema(texto) {
    // Escudo com o nome do esporte, ao fundo à direita (element-1).
    return svg('0 0 1000 860', `<g fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="22" stroke-linejoin="round">
  <path d="M500 40 L880 150 L860 470 Q820 700 500 820 Q180 700 140 470 L120 150 Z"/>
  <path d="M500 110 L810 200 L795 465 Q760 650 500 750 Q240 650 205 465 L190 200 Z" stroke-width="8"/>
</g>
<text x="500" y="500" text-anchor="middle" ${FONTE} font-size="150" letter-spacing="6" fill="#fff" fill-opacity=".16" transform="rotate(-12 500 470)">${texto}</text>`);
}

const bolas = {
    futsal: `<circle cx="500" cy="500" r="440" fill="none" stroke="#fff" stroke-width="26"/>
<polygon points="500,300 620,385 575,525 425,525 380,385" fill="#fff"/>
<path d="M500 300 L500 70 M620 385 L830 300 M575 525 L700 720 M425 525 L300 720 M380 385 L170 300" stroke="#fff" stroke-width="22"/>`,
    basquete: `<circle cx="500" cy="500" r="440" fill="none" stroke="#fff" stroke-width="26"/>
<path d="M60 500 H940 M500 60 V940" stroke="#fff" stroke-width="22"/>
<path d="M190 190 Q420 500 190 810 M810 190 Q580 500 810 810" fill="none" stroke="#fff" stroke-width="22"/>`,
    volei: `<circle cx="500" cy="500" r="440" fill="none" stroke="#fff" stroke-width="26"/>
<path d="M500 60 Q420 330 500 500 Q300 600 150 760 M500 500 Q690 590 860 740 M500 500 Q640 300 820 200" fill="none" stroke="#fff" stroke-width="22"/>`
};
const bola = (esporte) => svg('0 0 1000 1000', `<g opacity=".14">${bolas[esporte]}</g>`);

// Indicador de saque (vôlei): fundo + bola que pisca.
const saqueFundo = () => svg('0 0 460 460', `<circle cx="230" cy="230" r="215" fill="#0a1222" stroke="#e6edf7" stroke-width="14"/>`);
const bolaSaque = (cor) => svg('0 0 300 300', `<circle cx="150" cy="150" r="135" fill="${cor}"/>
<path d="M150 18 Q120 110 150 150 Q80 190 40 250 M150 150 Q220 185 265 235 M150 150 Q200 90 255 65" fill="none" stroke="#0a1222" stroke-width="14" stroke-opacity=".55"/>`);

const arquivos = {
    'background.svg': fundo(),
    'futsal/box.svg': boxComFaltas('FUTSAL'),
    'basquete/box.svg': boxComFaltas('BASQUETE'),
    'volei/box.svg': boxVolei(),
    'futsal/element-1.svg': emblema('FUTSAL'),
    'basquete/element-1.svg': emblema('BASQUETE'),
    'volei/element-1.svg': emblema('VÔLEI'),
    'futsal/element-2.svg': bola('futsal'),
    'basquete/element-2.svg': bola('basquete'),
    'volei/element-2.svg': bola('volei'),
    'volei/element-3.svg': saqueFundo(),
    'volei/element-4-on.svg': bolaSaque(COR.destaque),
    'volei/element-4-off.svg': bolaSaque('#56627a')
};

for (const [nome, conteudo] of Object.entries(arquivos)) {
    const destino = path.join(DIR, nome);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, conteudo);
}
console.log(`${Object.keys(arquivos).length} arquivos em ${DIR}`);
console.log('Bordas para o style.css:', JSON.stringify({ topo: COR.topo, base: COR.faixa }));
