-- MarQGol — esquema inicial.
-- Convenção: toda tabela de dados de um cliente tem `cliente_id` (tenancy por
-- coluna). Datas em timestamptz. Nomes em português, como o resto do código.

CREATE TABLE planos (
    id                    serial PRIMARY KEY,
    nome                  text NOT NULL,
    descricao             text NOT NULL DEFAULT '',
    preco_centavos        integer NOT NULL DEFAULT 0 CHECK (preco_centavos >= 0),
    max_placares          integer NOT NULL CHECK (max_placares >= 0),
    max_jogos_abertos     integer NOT NULL CHECK (max_jogos_abertos >= 0),
    max_usuarios          integer NOT NULL CHECK (max_usuarios >= 0),
    max_armazenamento_mb  integer NOT NULL CHECK (max_armazenamento_mb >= 0),
    esportes              text[] NOT NULL DEFAULT '{futsal,basquete,volei}',
    -- Liga/desliga funcionalidades: { midia, arte_propria, video_jogador }.
    recursos              jsonb NOT NULL DEFAULT '{}',
    dias_teste            integer NOT NULL DEFAULT 14,
    -- Aparece na página pública/cadastro? Planos sob medida ficam ocultos.
    publico               boolean NOT NULL DEFAULT true,
    ativo                 boolean NOT NULL DEFAULT true,
    ordem                 integer NOT NULL DEFAULT 0,
    criado_em             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clientes (
    id                    serial PRIMARY KEY,
    nome                  text NOT NULL,
    slug                  text NOT NULL UNIQUE,
    documento             text NOT NULL DEFAULT '',      -- CPF ou CNPJ, só dígitos
    email                 text NOT NULL,
    telefone              text NOT NULL DEFAULT '',
    status                text NOT NULL DEFAULT 'teste'
                          CHECK (status IN ('teste', 'ativo', 'inadimplente', 'suspenso', 'cancelado')),
    plano_id              integer REFERENCES planos(id),
    teste_ate             timestamptz,
    inadimplente_desde    timestamptz,
    -- Sobrescreve limites/recursos do plano só para este cliente (painel de gestão).
    limites_extra         jsonb NOT NULL DEFAULT '{}',
    observacoes           text NOT NULL DEFAULT '',
    -- Arte do telão: { versao, bordas: {topo, base, lados}, slots: [..] }.
    arte                  jsonb NOT NULL DEFAULT '{}',
    asaas_cliente_id      text,
    asaas_assinatura_id   text,
    proximo_vencimento    date,
    criado_em             timestamptz NOT NULL DEFAULT now(),
    atualizado_em         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
    id                    serial PRIMARY KEY,
    cliente_id            integer REFERENCES clientes(id) ON DELETE CASCADE,
    nome                  text NOT NULL,
    email                 text NOT NULL,
    senha_hash            text,
    papel                 text NOT NULL CHECK (papel IN ('superadmin', 'admin', 'operador')),
    ativo                 boolean NOT NULL DEFAULT true,
    email_verificado_em   timestamptz,
    ultimo_login_em       timestamptz,
    criado_em             timestamptz NOT NULL DEFAULT now(),
    -- superadmin não pertence a cliente; os demais sempre pertencem.
    CHECK ((papel = 'superadmin') = (cliente_id IS NULL))
);
CREATE UNIQUE INDEX usuarios_email_unico ON usuarios (lower(email));
CREATE INDEX usuarios_cliente ON usuarios (cliente_id);

-- Tokens de uso único enviados por e-mail (verificação, redefinição, convite).
CREATE TABLE tokens (
    id                    serial PRIMARY KEY,
    usuario_id            integer NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo                  text NOT NULL CHECK (tipo IN ('verificar_email', 'redefinir_senha', 'convite')),
    token_hash            text NOT NULL UNIQUE,
    expira_em             timestamptz NOT NULL,
    usado_em              timestamptz,
    criado_em             timestamptz NOT NULL DEFAULT now()
);

-- Sessões de login (connect-pg-simple).
CREATE TABLE sessoes (
    sid                   varchar NOT NULL PRIMARY KEY,
    sess                  json NOT NULL,
    expire                timestamp(6) NOT NULL
);
CREATE INDEX sessoes_expire ON sessoes (expire);

CREATE TABLE faturas (
    id                    serial PRIMARY KEY,
    cliente_id            integer NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    asaas_id              text UNIQUE,
    valor_centavos        integer NOT NULL,
    vencimento            date,
    status                text NOT NULL,
    forma                 text NOT NULL DEFAULT '',
    link                  text NOT NULL DEFAULT '',
    pago_em               timestamptz,
    criado_em             timestamptz NOT NULL DEFAULT now(),
    atualizado_em         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX faturas_cliente ON faturas (cliente_id, vencimento DESC);

-- Webhooks recebidos do Asaas (idempotência e trilha).
CREATE TABLE webhooks_asaas (
    id                    text PRIMARY KEY,
    evento                text NOT NULL,
    payload               jsonb NOT NULL,
    recebido_em           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE times (
    id                    serial PRIMARY KEY,
    cliente_id            integer NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    nome                  text NOT NULL,
    esporte               text NOT NULL CHECK (esporte IN ('futsal', 'basquete', 'volei')),
    categoria             text NOT NULL DEFAULT '',
    logo                  text NOT NULL DEFAULT '',
    ativo                 boolean NOT NULL DEFAULT true,
    criado_em             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX times_cliente ON times (cliente_id, esporte);

CREATE TABLE jogadores (
    id                    serial PRIMARY KEY,
    cliente_id            integer NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    time_id               integer NOT NULL REFERENCES times(id) ON DELETE CASCADE,
    numero                text NOT NULL DEFAULT '',
    nome                  text NOT NULL,
    foto                  text NOT NULL DEFAULT '',
    video                 text NOT NULL DEFAULT '',
    ativo                 boolean NOT NULL DEFAULT true,
    criado_em             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jogadores_time ON jogadores (time_id);

CREATE TABLE placares (
    id                    serial PRIMARY KEY,
    cliente_id            integer NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    nome                  text NOT NULL,
    ativo                 boolean NOT NULL DEFAULT true,
    -- O antigo `gameState` (gameLogic.criarEstadoInicial) deste placar.
    estado                jsonb,
    -- Bookkeeping do jogo carregado: ids, fila de eventos da súmula, uuid por lance.
    sessao                jsonb NOT NULL DEFAULT '{}',
    criado_em             timestamptz NOT NULL DEFAULT now(),
    atualizado_em         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX placares_cliente ON placares (cliente_id);

-- Telas pareadas (TV do telão, placar simples, placar neutro). O token fica no
-- cookie da TV; aqui só o hash.
CREATE TABLE telas (
    id                    serial PRIMARY KEY,
    cliente_id            integer NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    placar_id             integer NOT NULL REFERENCES placares(id) ON DELETE CASCADE,
    nome                  text NOT NULL DEFAULT '',
    tipo                  text NOT NULL DEFAULT 'telao' CHECK (tipo IN ('telao', 'simples', 'neutro')),
    token_hash            text NOT NULL UNIQUE,
    ultimo_acesso_em      timestamptz,
    revogada_em           timestamptz,
    criado_em             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX telas_placar ON telas (placar_id);

CREATE TABLE jogos (
    id                    serial PRIMARY KEY,
    cliente_id            integer NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    placar_id             integer REFERENCES placares(id) ON DELETE SET NULL,
    esporte               text NOT NULL CHECK (esporte IN ('futsal', 'basquete', 'volei')),
    time_casa_id          integer NOT NULL REFERENCES times(id),
    time_fora_id          integer NOT NULL REFERENCES times(id),
    data_hora             timestamptz NOT NULL,
    local                 text NOT NULL DEFAULT '',
    -- 'agendado' e 'ao_vivo' ocupam vaga do limite de jogos em aberto.
    status                text NOT NULL DEFAULT 'agendado'
                          CHECK (status IN ('agendado', 'ao_vivo', 'encerrado', 'cancelado', 'expirado')),
    placar_casa           integer NOT NULL DEFAULT 0,
    placar_fora           integer NOT NULL DEFAULT 0,
    sets_casa             integer NOT NULL DEFAULT 0,
    sets_fora             integer NOT NULL DEFAULT 0,
    periodos_jogados      integer NOT NULL DEFAULT 0,
    parciais              jsonb NOT NULL DEFAULT '[]',
    ultima_sequencia      integer NOT NULL DEFAULT 0,
    observacoes           text NOT NULL DEFAULT '',
    criado_por            integer REFERENCES usuarios(id) ON DELETE SET NULL,
    iniciado_em           timestamptz,
    encerrado_em          timestamptz,
    criado_em             timestamptz NOT NULL DEFAULT now(),
    CHECK (time_casa_id <> time_fora_id)
);
CREATE INDEX jogos_cliente_status ON jogos (cliente_id, status);
CREATE INDEX jogos_cliente_data ON jogos (cliente_id, data_hora);

CREATE TABLE escalacoes (
    jogo_id               integer NOT NULL REFERENCES jogos(id) ON DELETE CASCADE,
    time_id               integer NOT NULL REFERENCES times(id) ON DELETE CASCADE,
    jogador_id            integer NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
    numero                text NOT NULL DEFAULT '',
    titular               boolean NOT NULL DEFAULT false,
    capitao               boolean NOT NULL DEFAULT false,
    PRIMARY KEY (jogo_id, jogador_id)
);

-- Súmula: log append-only. Correção = evento 'estorno' com payload.evento_uuid.
CREATE TABLE eventos_jogo (
    uuid                  uuid PRIMARY KEY,
    cliente_id            integer NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    jogo_id               integer NOT NULL REFERENCES jogos(id) ON DELETE CASCADE,
    sequencia             integer NOT NULL,
    tipo                  text NOT NULL,
    time_id               integer,
    jogador_id            integer,
    valor                 integer,
    periodo               integer,
    cronometro_ms         integer,
    ocorrido_em           timestamptz NOT NULL,
    payload               jsonb,
    recebido_em           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX eventos_jogo_seq ON eventos_jogo (jogo_id, sequencia);

CREATE TABLE auditoria (
    id                    bigserial PRIMARY KEY,
    usuario_id            integer REFERENCES usuarios(id) ON DELETE SET NULL,
    cliente_id            integer REFERENCES clientes(id) ON DELETE SET NULL,
    acao                  text NOT NULL,
    dados                 jsonb NOT NULL DEFAULT '{}',
    ip                    text NOT NULL DEFAULT '',
    criado_em             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_cliente ON auditoria (cliente_id, criado_em DESC);
