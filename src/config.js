// Configuração do MarQGol, toda vinda do ambiente (.env em dev, .env do
// Compose em produção). Nenhum outro módulo lê `process.env` direto: assim os
// testes montam uma configuração própria sem mexer no ambiente do processo.
const path = require('path');
const { carregarEnv } = require('../env');

function lerConfig(env = process.env) {
    const producao = env.NODE_ENV === 'production';
    const dominio = env.DOMAIN || 'localhost:4000';
    return {
        producao,
        porta: Number(env.PORT) || 4000,
        dominio,
        // URL pública usada em e-mails, links de pagamento e redirecionamentos.
        // Sai do domínio do .env, nunca fixa no código (contrato da VPS).
        urlPublica: (env.APP_URL || (producao ? `https://${dominio}` : `http://${dominio}`)).replace(/\/+$/, ''),
        databaseUrl: env.DATABASE_URL || '',
        segredoSessao: env.SESSION_SECRET || (producao ? '' : 'dev-inseguro-troque-em-producao'),
        // Uploads dos clientes (mídia, arte, fotos). Em produção é um volume
        // nomeado do Docker; nunca dentro da imagem.
        dirDados: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'dados')),
        superadmin: {
            email: env.SUPERADMIN_EMAIL || '',
            senha: env.SUPERADMIN_SENHA || '',
            nome: env.SUPERADMIN_NOME || 'Administrador MarQGol'
        },
        asaas: {
            // Sandbox por padrão: produção só com a URL explícita no .env.
            url: (env.ASAAS_API_URL || 'https://api-sandbox.asaas.com/v3').replace(/\/+$/, ''),
            chave: env.ASAAS_API_KEY || '',
            tokenWebhook: env.ASAAS_WEBHOOK_TOKEN || ''
        },
        email: {
            host: env.SMTP_HOST || '',
            porta: Number(env.SMTP_PORT) || 587,
            usuario: env.SMTP_USER || '',
            senha: env.SMTP_PASS || '',
            remetente: env.EMAIL_FROM || 'MarQGol <nao-responda@marqgol.artzan.tech>'
        },
        // Tamanho máximo de um único arquivo enviado (MB). A cota total por
        // cliente vem do plano.
        maxUploadMb: Number(env.MAX_UPLOAD_MB) || 500
    };
}

let atual = null;
function config() {
    if (!atual) {
        carregarEnv();
        atual = lerConfig();
    }
    return atual;
}

module.exports = { config, lerConfig };
