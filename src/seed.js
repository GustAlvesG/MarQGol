// Dados mínimos para o sistema funcionar: planos iniciais (só se não houver
// nenhum) e o superadmin a partir de SUPERADMIN_EMAIL/SUPERADMIN_SENHA.
// Idempotente: roda em todo `migrate` sem duplicar nada.
const { gerarHashSenha, normalizarEmail } = require('./seguranca');

// Valores iniciais — você ajusta preço e limites no painel de gestão.
const PLANOS_INICIAIS = [
    {
        nome: 'Básico', descricao: 'Uma quadra, ideal para escolas e clubes pequenos.',
        preco_centavos: 9900, max_placares: 1, max_jogos_abertos: 15, max_usuarios: 3, max_armazenamento_mb: 2048,
        recursos: { midia: true, video_jogador: false, arte_propria: false }, ordem: 1
    },
    {
        nome: 'Profissional', descricao: 'Até três quadras simultâneas e arte própria no telão.',
        preco_centavos: 24900, max_placares: 3, max_jogos_abertos: 60, max_usuarios: 10, max_armazenamento_mb: 10240,
        recursos: { midia: true, video_jogador: true, arte_propria: true }, ordem: 2
    },
    {
        nome: 'Arena', descricao: 'Para ligas e complexos esportivos com várias quadras.',
        preco_centavos: 59900, max_placares: 10, max_jogos_abertos: 200, max_usuarios: 30, max_armazenamento_mb: 30720,
        recursos: { midia: true, video_jogador: true, arte_propria: true }, ordem: 3
    }
];

async function garantirDadosIniciais(db, cfg, { log = () => {} } = {}) {
    const { n } = await db.um('SELECT count(*) AS n FROM planos');
    if (n === 0) {
        for (const p of PLANOS_INICIAIS) {
            await db.query(
                `INSERT INTO planos (nome, descricao, preco_centavos, max_placares, max_jogos_abertos, max_usuarios,
                                     max_armazenamento_mb, recursos, ordem)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [p.nome, p.descricao, p.preco_centavos, p.max_placares, p.max_jogos_abertos, p.max_usuarios,
                    p.max_armazenamento_mb, p.recursos, p.ordem]
            );
        }
        log(`planos iniciais criados (${PLANOS_INICIAIS.length})`);
    }

    const email = normalizarEmail(cfg.superadmin.email);
    if (email && cfg.superadmin.senha) {
        const existe = await db.um('SELECT id FROM usuarios WHERE lower(email) = $1', [email]);
        if (!existe) {
            await db.query(
                `INSERT INTO usuarios (nome, email, senha_hash, papel, email_verificado_em)
                 VALUES ($1, $2, $3, 'superadmin', now())`,
                [cfg.superadmin.nome, email, await gerarHashSenha(cfg.superadmin.senha)]
            );
            log(`superadmin criado: ${email}`);
        }
    }
}

module.exports = { garantirDadosIniciais, PLANOS_INICIAIS };
