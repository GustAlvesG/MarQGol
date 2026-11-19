// E-mails transacionais (verificação, convite, senha, avisos de cobrança).
// Sem SMTP configurado (dev/testes), o e-mail vai para o console e para a
// lista `enviados` — os testes leem o link de lá.
const nodemailer = require('nodemailer');

function criarEmail(cfg) {
    const enviados = [];
    const transporte = cfg.email.host
        ? nodemailer.createTransport({
            host: cfg.email.host,
            port: cfg.email.porta,
            secure: cfg.email.porta === 465,
            auth: cfg.email.usuario ? { user: cfg.email.usuario, pass: cfg.email.senha } : undefined
        })
        : null;

    function moldura(titulo, corpoHtml) {
        return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#0f141c;font-family:Arial,sans-serif;color:#e8edf4">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
<div style="font-size:24px;font-weight:800;letter-spacing:.02em;margin-bottom:24px">MarQ<span style="color:#f5b82e">Gol</span></div>
<div style="background:#18202c;border-radius:16px;padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${titulo}</h1>${corpoHtml}</div>
<p style="color:#8a96a8;font-size:12px;margin-top:24px">Você recebeu este e-mail porque tem uma conta no MarQGol. Se não reconhece esta mensagem, ignore.</p>
</div></body></html>`;
    }

    function botao(url, texto) {
        return `<p style="margin:24px 0"><a href="${url}" style="background:#f5b82e;color:#111;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:700">${texto}</a></p>
<p style="color:#8a96a8;font-size:13px">Se o botão não funcionar, copie este endereço: <br><span style="color:#c9d3e0">${url}</span></p>`;
    }

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    async function enviar({ para, assunto, html, texto }) {
        const msg = { from: cfg.email.remetente, to: para, subject: assunto, html, text: texto };
        enviados.push(msg);
        if (enviados.length > 200) enviados.shift();
        if (!transporte) {
            if (!process.env.NODE_TEST_CONTEXT) console.log(`[e-mail para ${para}] ${assunto}\n${texto}\n`);
            return;
        }
        try {
            await transporte.sendMail(msg);
        } catch (e) {
            // E-mail nunca derruba o fluxo (cadastro, convite): fica no log.
            console.error(`Falha ao enviar e-mail para ${para}:`, e.message);
        }
    }

    return {
        enviados,
        verificacao: (para, nome, url) => enviar({
            para, assunto: 'Confirme seu e-mail no MarQGol',
            html: moldura(`Olá, ${esc(nome)}!`, `<p>Falta só confirmar seu e-mail para ativar sua conta. Seu período de teste de 14 dias já começou.</p>${botao(url, 'Confirmar e-mail')}`),
            texto: `Olá, ${nome}! Confirme seu e-mail no MarQGol: ${url}`
        }),
        convite: (para, nomeCliente, quemConvidou, url) => enviar({
            para, assunto: `Convite para o placar de ${nomeCliente}`,
            html: moldura('Você foi convidado', `<p>${esc(quemConvidou)} convidou você para operar os placares de <b>${esc(nomeCliente)}</b> no MarQGol.</p>${botao(url, 'Aceitar convite e criar senha')}<p style="color:#8a96a8;font-size:13px">O convite vale por 7 dias.</p>`),
            texto: `${quemConvidou} convidou você para o MarQGol (${nomeCliente}). Crie sua senha: ${url}`
        }),
        redefinirSenha: (para, nome, url) => enviar({
            para, assunto: 'Redefinir sua senha do MarQGol',
            html: moldura('Redefinir senha', `<p>Olá, ${esc(nome)}. Recebemos um pedido para redefinir sua senha.</p>${botao(url, 'Criar nova senha')}<p style="color:#8a96a8;font-size:13px">O link vale por 1 hora. Se não foi você, ignore este e-mail.</p>`),
            texto: `Redefina sua senha do MarQGol (vale 1 hora): ${url}`
        }),
        aviso: (para, assunto, paragrafo, url, textoBotao) => enviar({
            para, assunto,
            html: moldura(esc(assunto), `<p>${esc(paragrafo)}</p>${url ? botao(url, textoBotao || 'Abrir') : ''}`),
            texto: `${paragrafo}${url ? ' ' + url : ''}`
        })
    };
}

module.exports = { criarEmail };
