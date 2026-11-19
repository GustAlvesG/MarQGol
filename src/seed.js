// Dados mínimos para o sistema funcionar: o superadmin a partir de
// SUPERADMIN_EMAIL/SUPERADMIN_SENHA. A tabela de preços do plano on demand
// nasce na migração 002 (valores de exemplo; ajuste em /admin → Preços).
// Idempotente: roda em todo `migrate` sem duplicar nada.
const { gerarHashSenha, normalizarEmail } = require('./seguranca');

async function garantirDadosIniciais(db, cfg, { log = () => {} } = {}) {
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

module.exports = { garantirDadosIniciais };
