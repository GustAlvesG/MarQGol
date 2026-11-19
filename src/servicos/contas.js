// Contas: autocadastro (cliente em teste + admin), confirmação de e-mail,
// convites, redefinição de senha.
const seg = require('../seguranca');
const limites = require('../limites');
const { ErroRegra } = require('./agenda');

const HORA = 3600 * 1000;

function criarContas({ repos, email, cfg }) {
    const { db } = repos;

    async function emitirToken(usuarioId, tipo, validadeMs) {
        const token = seg.gerarToken();
        await repos.tokens.criar(usuarioId, tipo, seg.hashToken(token), new Date(Date.now() + validadeMs));
        return token;
    }

    function validarPessoa({ nome, email: e, senha }) {
        if (!String(nome || '').trim()) throw new ErroRegra('Informe seu nome.');
        if (!seg.emailValido(seg.normalizarEmail(e))) throw new ErroRegra('E-mail inválido.');
        if (senha !== undefined && !seg.senhaValida(senha)) throw new ErroRegra('A senha precisa ter pelo menos 8 caracteres.');
    }

    // Cadastro público: cria o cliente em teste (14 dias, limites do plano
    // escolhido), o usuário admin e a primeira quadra.
    async function cadastrar(d) {
        const nomeCliente = String(d.nomeCliente || '').trim();
        if (!nomeCliente) throw new ErroRegra('Informe o nome do clube ou da organização.');
        validarPessoa(d);
        const documento = String(d.documento || '').replace(/\D/g, '');
        if (!seg.documentoValido(documento)) throw new ErroRegra('CPF ou CNPJ inválido.');
        const emailNorm = seg.normalizarEmail(d.email);
        if (await repos.usuarios.porEmail(emailNorm)) throw new ErroRegra('Já existe uma conta com este e-mail. Use "Esqueci a senha" se precisar.', 409);
        const plano = d.planoId ? await repos.planos.obter(Number(d.planoId)) : (await repos.planos.listar({ soAtivos: true, soPublicos: true }))[0];
        if (!plano || !plano.ativo || !plano.publico) throw new ErroRegra('Plano indisponível.');

        const slug = await repos.clientes.slugDisponivel(seg.gerarSlug(nomeCliente));
        const senhaHash = await seg.gerarHashSenha(d.senha);
        const { cliente, usuario } = await db.transacao(async (tx) => {
            const cliente = await repos.clientes.criar({
                nome: nomeCliente.slice(0, 120), slug, documento, email: emailNorm,
                telefone: String(d.telefone || '').replace(/[^\d+]/g, '').slice(0, 20),
                status: 'teste', plano_id: plano.id, teste_ate: limites.fimDoTeste(new Date(), plano.dias_teste)
            }, tx);
            const usuario = await repos.usuarios.criar({
                cliente_id: cliente.id, nome: String(d.nome).trim().slice(0, 120), email: emailNorm,
                senha_hash: senhaHash, papel: 'admin'
            }, tx);
            await tx.query('INSERT INTO placares (cliente_id, nome) VALUES ($1, $2)', [cliente.id, 'Quadra 1']);
            return { cliente, usuario };
        });
        await enviarVerificacao(usuario);
        await repos.auditoria.registrar({ usuarioId: usuario.id, clienteId: cliente.id, acao: 'cadastro', dados: { plano: plano.nome }, ip: d.ip || '' });
        return { cliente, usuario };
    }

    async function enviarVerificacao(usuario) {
        const token = await emitirToken(usuario.id, 'verificar_email', 7 * 24 * HORA);
        await email.verificacao(usuario.email, usuario.nome, `${cfg.urlPublica}/api/auth/verificar-email?token=${token}`);
    }

    async function verificarEmail(token) {
        const t = await repos.tokens.consumir('verificar_email', seg.hashToken(token));
        if (!t) return false;
        await repos.usuarios.atualizar(t.usuario_id, { email_verificado_em: new Date() });
        return true;
    }

    async function convidar(clienteId, d, quem) {
        validarPessoa(d);
        const papel = d.papel === 'admin' ? 'admin' : 'operador';
        const emailNorm = seg.normalizarEmail(d.email);
        if (await repos.usuarios.porEmail(emailNorm)) throw new ErroRegra('Este e-mail já tem uma conta no MarQGol.', 409);
        const cliente = await repos.clientes.obter(clienteId);
        const lim = await repos.clientes.limites(cliente);
        const uso = await repos.clientes.uso(clienteId);
        const v = limites.verificar('max_usuarios', uso.max_usuarios, lim);
        if (!v.ok) throw new ErroRegra(v.mensagem, 403, 'limite');
        const usuario = await repos.usuarios.criar({ cliente_id: clienteId, nome: String(d.nome).trim().slice(0, 120), email: emailNorm, papel });
        const token = await emitirToken(usuario.id, 'convite', 7 * 24 * HORA);
        await email.convite(emailNorm, cliente.nome, quem.nome, `${cfg.urlPublica}/convite?token=${token}`);
        return usuario;
    }

    // Sem e-mail: quem cadastra já define a senha (combinada por fora com a
    // pessoa). `clienteId` null = superadmin. O e-mail fica dado como
    // confirmado: foi um administrador que o informou.
    async function criarComSenha(clienteId, d) {
        validarPessoa(d);
        if (!seg.senhaValida(d.senha)) throw new ErroRegra('A senha precisa ter pelo menos 8 caracteres.');
        const emailNorm = seg.normalizarEmail(d.email);
        if (await repos.usuarios.porEmail(emailNorm)) throw new ErroRegra('Este e-mail já tem uma conta no MarQGol.', 409);
        let papel = 'superadmin';
        if (clienteId) {
            papel = d.papel === 'admin' ? 'admin' : 'operador';
            const cliente = await repos.clientes.obter(clienteId);
            const [lim, uso] = await Promise.all([repos.clientes.limites(cliente), repos.clientes.uso(clienteId)]);
            const v = limites.verificar('max_usuarios', uso.max_usuarios, lim);
            if (!v.ok) throw new ErroRegra(v.mensagem, 403, 'limite');
        }
        return repos.usuarios.criar({
            cliente_id: clienteId || null, nome: String(d.nome).trim().slice(0, 120), email: emailNorm, papel,
            senha_hash: await seg.gerarHashSenha(d.senha), email_verificado_em: new Date()
        });
    }

    // Senha definida por um administrador (sem link por e-mail). Derruba as
    // sessões abertas desse usuário, menos `manterSessao` (quem troca a própria).
    async function definirSenha(usuarioId, senha, { manterSessao = '' } = {}) {
        if (!seg.senhaValida(senha)) throw new ErroRegra('A senha precisa ter pelo menos 8 caracteres.');
        await db.query(`DELETE FROM sessoes WHERE (sess->>'usuarioId')::int = $1 AND sid <> $2`, [usuarioId, manterSessao]);
        return repos.usuarios.atualizar(usuarioId, { senha_hash: await seg.gerarHashSenha(senha), email_verificado_em: new Date() });
    }

    async function reenviarConvite(clienteId, usuarioId, quem) {
        const u = await repos.usuarios.doCliente(clienteId, usuarioId);
        if (!u || u.senha_hash) throw new ErroRegra('Convite não encontrado ou já aceito.', 404);
        const cliente = await repos.clientes.obter(clienteId);
        const token = await emitirToken(u.id, 'convite', 7 * 24 * HORA);
        await email.convite(u.email, cliente.nome, quem.nome, `${cfg.urlPublica}/convite?token=${token}`);
    }

    async function consultarConvite(token) {
        const t = await repos.tokens.consultar('convite', seg.hashToken(token));
        if (!t) return null;
        const u = await repos.usuarios.obter(t.usuario_id);
        const c = u && u.cliente_id ? await repos.clientes.obter(u.cliente_id) : null;
        return u ? { nome: u.nome, email: u.email, cliente: c ? c.nome : '' } : null;
    }

    async function aceitarConvite(token, senha) {
        if (!seg.senhaValida(senha)) throw new ErroRegra('A senha precisa ter pelo menos 8 caracteres.');
        const t = await repos.tokens.consumir('convite', seg.hashToken(token));
        if (!t) throw new ErroRegra('Convite inválido ou vencido. Peça um novo ao administrador.', 410);
        return repos.usuarios.atualizar(t.usuario_id, { senha_hash: await seg.gerarHashSenha(senha), email_verificado_em: new Date() });
    }

    // Sempre "ok" para quem pede (não revela se o e-mail existe).
    async function pedirRedefinicao(emailInformado) {
        const u = await repos.usuarios.porEmail(seg.normalizarEmail(emailInformado));
        if (!u || !u.ativo || !u.senha_hash) return;
        const token = await emitirToken(u.id, 'redefinir_senha', HORA);
        await email.redefinirSenha(u.email, u.nome, `${cfg.urlPublica}/redefinir-senha?token=${token}`);
    }

    async function redefinir(token, senha) {
        if (!seg.senhaValida(senha)) throw new ErroRegra('A senha precisa ter pelo menos 8 caracteres.');
        const t = await repos.tokens.consumir('redefinir_senha', seg.hashToken(token));
        if (!t) throw new ErroRegra('Link inválido ou vencido. Peça um novo.', 410);
        // Troca de senha derruba as outras sessões desse usuário.
        await db.query(`DELETE FROM sessoes WHERE (sess->>'usuarioId')::int = $1`, [t.usuario_id]);
        return repos.usuarios.atualizar(t.usuario_id, { senha_hash: await seg.gerarHashSenha(senha), email_verificado_em: new Date() });
    }

    async function autenticar(emailInformado, senha) {
        const u = await repos.usuarios.porEmail(seg.normalizarEmail(emailInformado));
        // Confere a senha mesmo sem usuário (tempo de resposta parecido).
        const ok = await seg.conferirSenha(senha, u ? u.senha_hash : 'scrypt$16384$00$00');
        if (!u || !ok || !u.ativo) return null;
        await repos.usuarios.atualizar(u.id, { ultimo_login_em: new Date() });
        return u;
    }

    return { emailAtivo: !!(cfg.email && cfg.email.host), cadastrar, enviarVerificacao, verificarEmail, convidar, criarComSenha, definirSenha, reenviarConvite, consultarConvite, aceitarConvite, pedirRedefinicao, redefinir, autenticar };
}

module.exports = { criarContas };
