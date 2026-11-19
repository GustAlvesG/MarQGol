// Repositórios: todo SQL de negócio fica aqui. Regra de ouro do multi-cliente:
// função que toca dado de cliente recebe `clienteId` e o coloca no WHERE —
// mesmo quando o id do registro já seria único. É isso que impede um clube de
// enxergar (ou alterar) o dado de outro por um id adivinhado.
const { limitesEfetivos, STATUS_JOGO_ABERTO } = require('./limites');

// placarEventos formata `ocorrido_em` como 'Y-m-d H:i:s.v' na hora LOCAL do
// Node; sem o 'Z', o Date do JS também lê como hora local — volta ao mesmo
// instante independentemente do fuso do Postgres.
function dataDoEvento(texto) {
    const d = texto ? new Date(String(texto).replace(' ', 'T')) : new Date();
    return isNaN(d) ? new Date() : d;
}

function criarRepos(db) {
    // ---------------- Planos ----------------
    const planos = {
        listar: ({ soAtivos = false, soPublicos = false } = {}) => db.varios(
            `SELECT * FROM planos WHERE ($1::bool = false OR ativo) AND ($2::bool = false OR publico)
             ORDER BY ordem, id`, [soAtivos, soPublicos]),
        obter: (id) => db.um('SELECT * FROM planos WHERE id = $1', [id]),
        criar: (p) => db.um(
            `INSERT INTO planos (nome, descricao, preco_centavos, max_placares, max_jogos_abertos, max_usuarios,
                max_armazenamento_mb, esportes, recursos, dias_teste, publico, ativo, ordem)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [p.nome, p.descricao || '', p.preco_centavos, p.max_placares, p.max_jogos_abertos, p.max_usuarios,
                p.max_armazenamento_mb, p.esportes, p.recursos || {}, p.dias_teste ?? 14, p.publico ?? true, p.ativo ?? true, p.ordem ?? 0]),
        atualizar: (id, p) => db.um(
            `UPDATE planos SET nome=$2, descricao=$3, preco_centavos=$4, max_placares=$5, max_jogos_abertos=$6,
                max_usuarios=$7, max_armazenamento_mb=$8, esportes=$9, recursos=$10, dias_teste=$11, publico=$12,
                ativo=$13, ordem=$14
             WHERE id=$1 RETURNING *`,
            [id, p.nome, p.descricao || '', p.preco_centavos, p.max_placares, p.max_jogos_abertos, p.max_usuarios,
                p.max_armazenamento_mb, p.esportes, p.recursos || {}, p.dias_teste ?? 14, p.publico ?? true, p.ativo ?? true, p.ordem ?? 0])
    };

    // ---------------- Clientes ----------------
    const clientes = {
        obter: (id) => db.um('SELECT * FROM clientes WHERE id = $1', [id]),
        porAsaasCliente: (asaasId) => db.um('SELECT * FROM clientes WHERE asaas_cliente_id = $1', [asaasId]),
        porAsaasAssinatura: (asaasId) => db.um('SELECT * FROM clientes WHERE asaas_assinatura_id = $1', [asaasId]),
        async slugDisponivel(base) {
            let slug = base;
            for (let i = 2; await db.um('SELECT 1 FROM clientes WHERE slug = $1', [slug]); i++) slug = `${base}-${i}`;
            return slug;
        },
        criar: (c, tx = db) => tx.um(
            `INSERT INTO clientes (nome, slug, documento, email, telefone, status, plano_id, teste_ate, limites_extra, observacoes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [c.nome, c.slug, c.documento || '', c.email, c.telefone || '', c.status || 'teste', c.plano_id,
                c.teste_ate || null, c.limites_extra || {}, c.observacoes || '']),
        // Só os campos passados mudam.
        async atualizar(id, campos) {
            const permitidos = ['nome', 'documento', 'email', 'telefone', 'status', 'plano_id', 'teste_ate',
                'inadimplente_desde', 'limites_extra', 'observacoes', 'arte', 'asaas_cliente_id',
                'asaas_assinatura_id', 'proximo_vencimento'];
            const sets = [], valores = [id];
            for (const k of permitidos) {
                if (campos[k] === undefined) continue;
                valores.push(campos[k]);
                sets.push(`${k} = $${valores.length}`);
            }
            if (!sets.length) return clientes.obter(id);
            return db.um(`UPDATE clientes SET ${sets.join(', ')}, atualizado_em = now() WHERE id = $1 RETURNING *`, valores);
        },
        // Lista do painel de gestão com o uso de cada cliente.
        listarComUso: ({ busca = '', status = '' } = {}) => db.varios(
            `SELECT c.*, p.nome AS plano_nome,
                (SELECT count(*) FROM placares x WHERE x.cliente_id = c.id AND x.ativo) AS uso_placares,
                (SELECT count(*) FROM jogos j WHERE j.cliente_id = c.id AND j.status = ANY($3)) AS uso_jogos_abertos,
                (SELECT count(*) FROM usuarios u WHERE u.cliente_id = c.id AND u.ativo) AS uso_usuarios,
                (SELECT max(u.ultimo_login_em) FROM usuarios u WHERE u.cliente_id = c.id) AS ultimo_acesso_em
             FROM clientes c LEFT JOIN planos p ON p.id = c.plano_id
             WHERE ($1 = '' OR c.nome ILIKE '%' || $1 || '%' OR c.email ILIKE '%' || $1 || '%' OR c.slug ILIKE '%' || $1 || '%')
               AND ($2 = '' OR c.status = $2)
             ORDER BY c.criado_em DESC`, [busca, status, STATUS_JOGO_ABERTO]),
        // Para tarefas periódicas.
        testesVencidos: (agora = new Date()) => db.varios(
            `SELECT * FROM clientes WHERE status = 'teste' AND teste_ate IS NOT NULL AND teste_ate < $1`, [agora]),
        inadimplentesHaMais: (dias, agora = new Date()) => db.varios(
            `SELECT * FROM clientes WHERE status = 'inadimplente' AND inadimplente_desde IS NOT NULL
               AND inadimplente_desde < $1::timestamptz - make_interval(days => $2)`, [agora, dias]),
        testesTerminandoEm: (dias, agora = new Date()) => db.varios(
            `SELECT * FROM clientes WHERE status = 'teste' AND teste_ate::date = ($1::timestamptz + make_interval(days => $2))::date`,
            [agora, dias]),
        async limites(clienteOuId) {
            const c = typeof clienteOuId === 'object' ? clienteOuId : await clientes.obter(clienteOuId);
            if (!c) return null;
            const plano = c.plano_id ? await planos.obter(c.plano_id) : null;
            return limitesEfetivos(plano, c.limites_extra);
        },
        async uso(clienteId) {
            return db.um(
                `SELECT
                    (SELECT count(*) FROM placares WHERE cliente_id = $1 AND ativo) AS max_placares,
                    (SELECT count(*) FROM jogos WHERE cliente_id = $1 AND status = ANY($2)) AS max_jogos_abertos,
                    (SELECT count(*) FROM usuarios WHERE cliente_id = $1 AND ativo) AS max_usuarios`,
                [clienteId, STATUS_JOGO_ABERTO]);
        },
        // Painel: números gerais.
        indicadores: () => db.um(
            `SELECT
                (SELECT count(*) FROM clientes) AS total,
                (SELECT count(*) FROM clientes WHERE status = 'teste') AS em_teste,
                (SELECT count(*) FROM clientes WHERE status = 'ativo') AS ativos,
                (SELECT count(*) FROM clientes WHERE status = 'inadimplente') AS inadimplentes,
                (SELECT count(*) FROM clientes WHERE status IN ('suspenso', 'cancelado')) AS inativos,
                (SELECT coalesce(sum(p.preco_centavos), 0) FROM clientes c JOIN planos p ON p.id = c.plano_id
                   WHERE c.status IN ('ativo', 'inadimplente')) AS receita_mensal_centavos,
                (SELECT count(*) FROM jogos WHERE status = 'ao_vivo') AS jogos_ao_vivo,
                (SELECT count(*) FROM jogos WHERE status = 'encerrado' AND encerrado_em > now() - interval '30 days') AS jogos_30_dias`)
    };

    // ---------------- Usuários ----------------
    const usuarios = {
        porEmail: (email) => db.um('SELECT * FROM usuarios WHERE lower(email) = lower($1)', [email]),
        obter: (id) => db.um('SELECT * FROM usuarios WHERE id = $1', [id]),
        doCliente: (clienteId, id) => db.um('SELECT * FROM usuarios WHERE cliente_id = $1 AND id = $2', [clienteId, id]),
        listar: (clienteId) => db.varios(
            `SELECT id, nome, email, papel, ativo, email_verificado_em, ultimo_login_em, criado_em,
                    (senha_hash IS NULL) AS convite_pendente
             FROM usuarios WHERE cliente_id = $1 ORDER BY papel, nome`, [clienteId]),
        criar: (u, tx = db) => tx.um(
            `INSERT INTO usuarios (cliente_id, nome, email, senha_hash, papel, email_verificado_em)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [u.cliente_id ?? null, u.nome, u.email, u.senha_hash ?? null, u.papel, u.email_verificado_em ?? null]),
        atualizar: (id, campos) => {
            const permitidos = ['nome', 'papel', 'ativo', 'senha_hash', 'email_verificado_em', 'ultimo_login_em'];
            const sets = [], valores = [id];
            for (const k of permitidos) {
                if (campos[k] === undefined) continue;
                valores.push(campos[k]);
                sets.push(`${k} = $${valores.length}`);
            }
            if (!sets.length) return usuarios.obter(id);
            return db.um(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, valores);
        },
        remover: (clienteId, id) => db.query('DELETE FROM usuarios WHERE cliente_id = $1 AND id = $2', [clienteId, id]),
        adminsDoCliente: (clienteId) => db.varios(
            `SELECT * FROM usuarios WHERE cliente_id = $1 AND papel = 'admin' AND ativo`, [clienteId])
    };

    // ---------------- Tokens de e-mail ----------------
    const tokens = {
        criar: (usuarioId, tipo, tokenHash, expiraEm) => db.um(
            `INSERT INTO tokens (usuario_id, tipo, token_hash, expira_em) VALUES ($1,$2,$3,$4) RETURNING *`,
            [usuarioId, tipo, tokenHash, expiraEm]),
        // Consome (marca usado) e devolve o token válido, ou null.
        consumir: (tipo, tokenHash) => db.um(
            `UPDATE tokens SET usado_em = now()
             WHERE tipo = $1 AND token_hash = $2 AND usado_em IS NULL AND expira_em > now()
             RETURNING *`, [tipo, tokenHash]),
        consultar: (tipo, tokenHash) => db.um(
            `SELECT * FROM tokens WHERE tipo = $1 AND token_hash = $2 AND usado_em IS NULL AND expira_em > now()`,
            [tipo, tokenHash])
    };

    // ---------------- Placares ----------------
    const placares = {
        listar: (clienteId) => db.varios(
            `SELECT p.id, p.nome, p.ativo, p.criado_em, p.atualizado_em,
                    p.sessao->>'jogoId' AS jogo_id,
                    (SELECT count(*) FROM telas t WHERE t.placar_id = p.id AND t.revogada_em IS NULL) AS telas
             FROM placares p WHERE p.cliente_id = $1 ORDER BY p.id`, [clienteId]),
        obter: (clienteId, id) => db.um('SELECT * FROM placares WHERE cliente_id = $1 AND id = $2', [clienteId, id]),
        // Sem cliente: só para o carregamento interno do gerenciador e a
        // autorização (que depois compara cliente_id).
        obterInterno: (id) => db.um('SELECT * FROM placares WHERE id = $1', [id]),
        criar: (clienteId, nome) => db.um(
            `INSERT INTO placares (cliente_id, nome) VALUES ($1, $2) RETURNING *`, [clienteId, nome]),
        atualizar: (clienteId, id, { nome, ativo }) => db.um(
            `UPDATE placares SET nome = coalesce($3, nome), ativo = coalesce($4, ativo), atualizado_em = now()
             WHERE cliente_id = $1 AND id = $2 RETURNING *`, [clienteId, id, nome ?? null, ativo ?? null]),
        remover: (clienteId, id) => db.query('DELETE FROM placares WHERE cliente_id = $1 AND id = $2', [clienteId, id]),
        salvarEstado: (id, estado, sessao) => db.query(
            `UPDATE placares SET estado = $2, sessao = $3, atualizado_em = now() WHERE id = $1`, [id, estado, sessao])
    };

    // ---------------- Telas pareadas ----------------
    const telas = {
        criar: (t) => db.um(
            `INSERT INTO telas (cliente_id, placar_id, nome, tipo, token_hash) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [t.cliente_id, t.placar_id, t.nome || '', t.tipo || 'telao', t.token_hash]),
        porToken: (tokenHash) => db.um(
            `SELECT t.*, p.ativo AS placar_ativo FROM telas t JOIN placares p ON p.id = t.placar_id
             WHERE t.token_hash = $1 AND t.revogada_em IS NULL`, [tokenHash]),
        tocar: (id) => db.query('UPDATE telas SET ultimo_acesso_em = now() WHERE id = $1', [id]),
        listar: (clienteId, placarId) => db.varios(
            `SELECT id, nome, tipo, ultimo_acesso_em, criado_em FROM telas
             WHERE cliente_id = $1 AND placar_id = $2 AND revogada_em IS NULL ORDER BY id`, [clienteId, placarId]),
        revogar: (clienteId, id) => db.um(
            `UPDATE telas SET revogada_em = now() WHERE cliente_id = $1 AND id = $2 AND revogada_em IS NULL RETURNING *`,
            [clienteId, id])
    };

    // ---------------- Times e jogadores ----------------
    const times = {
        listar: (clienteId, { esporte = '', busca = '' } = {}) => db.varios(
            `SELECT t.*, (SELECT count(*) FROM jogadores j WHERE j.time_id = t.id AND j.ativo) AS jogadores
             FROM times t WHERE t.cliente_id = $1 AND t.ativo AND ($2 = '' OR t.esporte = $2)
               AND ($3 = '' OR t.nome ILIKE '%' || $3 || '%')
             ORDER BY t.nome, t.categoria`, [clienteId, esporte, busca]),
        obter: (clienteId, id) => db.um('SELECT * FROM times WHERE cliente_id = $1 AND id = $2', [clienteId, id]),
        criar: (clienteId, t) => db.um(
            `INSERT INTO times (cliente_id, nome, esporte, categoria, logo) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [clienteId, t.nome, t.esporte, t.categoria || '', t.logo || '']),
        // Jogo rápido: reaproveita o time de mesmo nome/esporte/categoria.
        async obterOuCriar(clienteId, t) {
            const existe = await db.um(
                `SELECT * FROM times WHERE cliente_id = $1 AND lower(nome) = lower($2) AND esporte = $3
                   AND lower(categoria) = lower($4) AND ativo ORDER BY id LIMIT 1`,
                [clienteId, t.nome, t.esporte, t.categoria || '']);
            return existe || times.criar(clienteId, t);
        },
        atualizar: (clienteId, id, t) => db.um(
            `UPDATE times SET nome = coalesce($3, nome), esporte = coalesce($4, esporte),
                categoria = coalesce($5, categoria), logo = coalesce($6, logo)
             WHERE cliente_id = $1 AND id = $2 RETURNING *`,
            [clienteId, id, t.nome ?? null, t.esporte ?? null, t.categoria ?? null, t.logo ?? null]),
        // Exclusão lógica: jogos antigos continuam apontando para o time.
        remover: (clienteId, id) => db.query('UPDATE times SET ativo = false WHERE cliente_id = $1 AND id = $2', [clienteId, id])
    };

    const jogadores = {
        doTime: (clienteId, timeId) => db.varios(
            `SELECT * FROM jogadores WHERE cliente_id = $1 AND time_id = $2 AND ativo
             ORDER BY NULLIF(regexp_replace(numero, '\\D', '', 'g'), '')::int NULLS LAST, nome`, [clienteId, timeId]),
        obter: (clienteId, id) => db.um('SELECT * FROM jogadores WHERE cliente_id = $1 AND id = $2', [clienteId, id]),
        criar: (clienteId, timeId, j) => db.um(
            `INSERT INTO jogadores (cliente_id, time_id, numero, nome, foto, video) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [clienteId, timeId, String(j.numero ?? ''), j.nome, j.foto || '', j.video || '']),
        atualizar: (clienteId, id, j) => db.um(
            `UPDATE jogadores SET numero = coalesce($3, numero), nome = coalesce($4, nome),
                foto = coalesce($5, foto), video = coalesce($6, video)
             WHERE cliente_id = $1 AND id = $2 RETURNING *`,
            [clienteId, id, j.numero != null ? String(j.numero) : null, j.nome ?? null, j.foto ?? null, j.video ?? null]),
        remover: (clienteId, id) => db.query('UPDATE jogadores SET ativo = false WHERE cliente_id = $1 AND id = $2', [clienteId, id])
    };

    // ---------------- Jogos ----------------
    const SELECT_JOGO = `
        SELECT j.*,
            tc.nome AS casa_nome, tc.categoria AS casa_categoria, tc.logo AS casa_logo,
            tf.nome AS fora_nome, tf.categoria AS fora_categoria, tf.logo AS fora_logo,
            pl.nome AS placar_nome
        FROM jogos j
        JOIN times tc ON tc.id = j.time_casa_id
        JOIN times tf ON tf.id = j.time_fora_id
        LEFT JOIN placares pl ON pl.id = j.placar_id`;

    const jogos = {
        // Filtros: data (YYYY-MM-DD, no fuso de São Paulo), de/ate, status, placarId.
        listar: (clienteId, { data = '', de = '', ate = '', status = '', placarId = null, limite = 500 } = {}) => db.varios(
            `${SELECT_JOGO}
             WHERE j.cliente_id = $1
               AND ($2 = '' OR (j.data_hora AT TIME ZONE 'America/Sao_Paulo')::date = $2::date)
               AND ($3 = '' OR j.data_hora >= $3::timestamptz)
               AND ($4 = '' OR j.data_hora < $4::timestamptz)
               AND ($5 = '' OR j.status = $5)
               AND ($6::int IS NULL OR j.placar_id = $6 OR j.placar_id IS NULL)
             ORDER BY j.data_hora, j.id
             LIMIT $7`,
            [clienteId, data, de, ate, status, placarId, limite]),
        obter: (clienteId, id) => db.um(`${SELECT_JOGO} WHERE j.cliente_id = $1 AND j.id = $2`, [clienteId, id]),
        contarAbertos: (clienteId, tx = db) => tx.um(
            `SELECT count(*) AS n FROM jogos WHERE cliente_id = $1 AND status = ANY($2)`, [clienteId, STATUS_JOGO_ABERTO]),
        criar: (clienteId, j, tx = db) => tx.um(
            `INSERT INTO jogos (cliente_id, placar_id, esporte, time_casa_id, time_fora_id, data_hora, local, criado_por)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [clienteId, j.placar_id || null, j.esporte, j.time_casa_id, j.time_fora_id, j.data_hora, j.local || '', j.criado_por || null]),
        atualizar: (clienteId, id, j) => db.um(
            `UPDATE jogos SET placar_id = CASE WHEN $3::bool THEN $4::int ELSE placar_id END,
                data_hora = coalesce($5, data_hora), local = coalesce($6, local),
                time_casa_id = coalesce($7, time_casa_id), time_fora_id = coalesce($8, time_fora_id),
                esporte = coalesce($9, esporte)
             WHERE cliente_id = $1 AND id = $2 AND status = 'agendado' RETURNING *`,
            [clienteId, id, j.placar_id !== undefined, j.placar_id || null, j.data_hora ?? null, j.local ?? null,
                j.time_casa_id ?? null, j.time_fora_id ?? null, j.esporte ?? null]),
        cancelar: (clienteId, id) => db.um(
            `UPDATE jogos SET status = 'cancelado' WHERE cliente_id = $1 AND id = $2 AND status IN ('agendado', 'expirado')
             RETURNING *`, [clienteId, id]),
        // Reabre um jogo expirado/cancelado para a data nova (conta de novo no limite).
        reagendar: (clienteId, id, dataHora, tx = db) => tx.um(
            `UPDATE jogos SET status = 'agendado', data_hora = $3 WHERE cliente_id = $1 AND id = $2
               AND status IN ('expirado', 'cancelado') RETURNING *`, [clienteId, id, dataHora]),
        iniciar: (clienteId, id, placarId) => db.um(
            `UPDATE jogos SET status = 'ao_vivo', iniciado_em = coalesce(iniciado_em, now()),
                placar_id = coalesce($3, placar_id)
             WHERE cliente_id = $1 AND id = $2 AND status IN ('agendado', 'ao_vivo', 'expirado') RETURNING *`,
            [clienteId, id, placarId || null]),
        encerrar: (clienteId, id, r) => db.um(
            `UPDATE jogos SET status = 'encerrado', encerrado_em = now(), placar_casa = $3, placar_fora = $4,
                sets_casa = $5, sets_fora = $6, periodos_jogados = $7, parciais = $8, observacoes = $9
             WHERE cliente_id = $1 AND id = $2 AND status IN ('agendado', 'ao_vivo', 'expirado') RETURNING *`,
            [clienteId, id, r.placar_casa | 0, r.placar_fora | 0, r.sets_casa | 0, r.sets_fora | 0,
                r.periodos_jogados | 0, JSON.stringify(r.parciais || []), r.observacoes || '']),
        // Placar parcial gravado durante o jogo (para a agenda mostrar o andamento).
        atualizarParcial: (id, r) => db.query(
            `UPDATE jogos SET placar_casa = $2, placar_fora = $3, sets_casa = $4, sets_fora = $5,
                periodos_jogados = $6, parciais = $7
             WHERE id = $1 AND status = 'ao_vivo'`,
            [id, r.placar_casa | 0, r.placar_fora | 0, r.sets_casa | 0, r.sets_fora | 0, r.periodos_jogados | 0,
                JSON.stringify(r.parciais || [])]),
        // Agendado há mais de 24 h do horário previsto sem começar: expira e
        // libera a vaga (decisão do produto).
        expirarVencidos: (agora = new Date()) => db.varios(
            `UPDATE jogos SET status = 'expirado'
             WHERE status = 'agendado' AND data_hora < $1::timestamptz - interval '24 hours'
             RETURNING id, cliente_id`, [agora]),
        escalacao: (jogoId) => db.varios('SELECT * FROM escalacoes WHERE jogo_id = $1', [jogoId]),
        async salvarEscalacao(clienteId, jogoId, timeId, lista) {
            return db.transacao(async (tx) => {
                const jogo = await tx.um('SELECT id FROM jogos WHERE cliente_id = $1 AND id = $2', [clienteId, jogoId]);
                if (!jogo) return null;
                await tx.query('DELETE FROM escalacoes WHERE jogo_id = $1 AND time_id = $2', [jogoId, timeId]);
                for (const j of lista) {
                    // Só jogador do próprio cliente e do time certo entra.
                    const ok = await tx.um('SELECT 1 FROM jogadores WHERE cliente_id = $1 AND id = $2 AND time_id = $3',
                        [clienteId, j.jogador_id, timeId]);
                    if (!ok) continue;
                    await tx.query(
                        `INSERT INTO escalacoes (jogo_id, time_id, jogador_id, numero, titular, capitao)
                         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (jogo_id, jogador_id) DO UPDATE
                         SET numero = EXCLUDED.numero, titular = EXCLUDED.titular, capitao = EXCLUDED.capitao`,
                        [jogoId, timeId, j.jogador_id, String(j.numero ?? ''), !!j.titular, !!j.capitao]);
                }
                return true;
            });
        },
        eventos: (clienteId, jogoId) => db.varios(
            `SELECT * FROM eventos_jogo WHERE cliente_id = $1 AND jogo_id = $2 ORDER BY sequencia`, [clienteId, jogoId]),
        // Gravação em lote dos eventos da súmula. Idempotente pelo uuid.
        async gravarEventos(clienteId, jogoId, lote) {
            const aceitos = [], duplicados = [];
            await db.transacao(async (tx) => {
                for (const e of lote) {
                    const r = await tx.um(
                        `INSERT INTO eventos_jogo (uuid, cliente_id, jogo_id, sequencia, tipo, time_id, jogador_id, valor,
                            periodo, cronometro_ms, ocorrido_em, payload)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                         ON CONFLICT (uuid) DO NOTHING RETURNING uuid`,
                        [e.uuid, clienteId, jogoId, e.sequencia, e.tipo, e.time_id ?? null, e.jogador_id ?? null,
                            e.valor ?? null, e.periodo ?? null, e.cronometro_ms ?? null, dataDoEvento(e.ocorrido_em),
                            e.payload ?? null]);
                    (r ? aceitos : duplicados).push(e.uuid);
                }
                await tx.query(
                    `UPDATE jogos SET ultima_sequencia = greatest(ultima_sequencia, $2) WHERE id = $1`,
                    [jogoId, Math.max(0, ...lote.map(e => e.sequencia))]);
            });
            return { aceitos, duplicados, rejeitados: [] };
        }
    };

    // ---------------- Faturas / Asaas ----------------
    const faturas = {
        listar: (clienteId) => db.varios(
            'SELECT * FROM faturas WHERE cliente_id = $1 ORDER BY vencimento DESC NULLS LAST, id DESC LIMIT 36', [clienteId]),
        upsert: (clienteId, f) => db.um(
            `INSERT INTO faturas (cliente_id, asaas_id, valor_centavos, vencimento, status, forma, link, pago_em)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (asaas_id) DO UPDATE SET valor_centavos = EXCLUDED.valor_centavos,
                vencimento = EXCLUDED.vencimento, status = EXCLUDED.status, forma = EXCLUDED.forma,
                link = EXCLUDED.link, pago_em = coalesce(EXCLUDED.pago_em, faturas.pago_em), atualizado_em = now()
             RETURNING *`,
            [clienteId, f.asaas_id, f.valor_centavos, f.vencimento || null, f.status, f.forma || '', f.link || '', f.pago_em || null]),
        // Registra o webhook; devolve false se já tinha sido processado.
        async registrarWebhook(id, evento, payload) {
            const r = await db.um(
                `INSERT INTO webhooks_asaas (id, evento, payload) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING RETURNING id`,
                [id, evento, payload]);
            return !!r;
        }
    };

    // ---------------- Auditoria ----------------
    const auditoria = {
        registrar: ({ usuarioId = null, clienteId = null, acao, dados = {}, ip = '' }) => db.query(
            `INSERT INTO auditoria (usuario_id, cliente_id, acao, dados, ip) VALUES ($1,$2,$3,$4,$5)`,
            [usuarioId, clienteId, acao, dados, ip]),
        listar: ({ clienteId = null, limite = 200 } = {}) => db.varios(
            `SELECT a.*, u.nome AS usuario_nome, u.email AS usuario_email, c.nome AS cliente_nome
             FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id LEFT JOIN clientes c ON c.id = a.cliente_id
             WHERE ($1::int IS NULL OR a.cliente_id = $1) ORDER BY a.id DESC LIMIT $2`, [clienteId, limite])
    };

    return { db, planos, clientes, usuarios, tokens, placares, telas, times, jogadores, jogos, faturas, auditoria };
}

module.exports = { criarRepos };
