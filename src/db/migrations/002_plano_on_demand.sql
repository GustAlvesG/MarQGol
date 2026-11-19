-- Plano "on demand": no lugar de pacotes fixos, cada cliente monta o próprio
-- plano — quantos placares, recursos especiais e pacotes extras de usuários.
-- Preço mensal = placares × preço do placar
--              + pacotes extras de usuários × preço do pacote (o 1º vem incluso)
--              + soma dos recursos ligados (valor fixo por conta).
-- Jogos em aberto e armazenamento crescem por placar contratado.

-- Tabela de preços: uma linha só, editada no painel (/admin → Preços).
CREATE TABLE tabela_precos (
    id                              integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    preco_placar_centavos           integer NOT NULL CHECK (preco_placar_centavos >= 0),
    preco_pacote_usuarios_centavos  integer NOT NULL CHECK (preco_pacote_usuarios_centavos >= 0),
    usuarios_por_pacote             integer NOT NULL CHECK (usuarios_por_pacote > 0),
    -- { midia: centavos, video_jogador: centavos, arte_propria: centavos }
    precos_recursos                 jsonb NOT NULL DEFAULT '{}',
    jogos_por_placar                integer NOT NULL CHECK (jogos_por_placar >= 0),
    armazenamento_mb_por_placar     integer NOT NULL CHECK (armazenamento_mb_por_placar >= 0),
    dias_teste                      integer NOT NULL CHECK (dias_teste BETWEEN 0 AND 90),
    -- Teto do que o cliente monta sozinho (acima disso, venda pelo painel).
    max_placares_autoatendimento    integer NOT NULL CHECK (max_placares_autoatendimento > 0),
    max_pacotes_autoatendimento     integer NOT NULL CHECK (max_pacotes_autoatendimento >= 0),
    atualizado_em                   timestamptz NOT NULL DEFAULT now()
);

-- Valores iniciais de exemplo — ajuste no painel antes de vender.
INSERT INTO tabela_precos (preco_placar_centavos, preco_pacote_usuarios_centavos, usuarios_por_pacote,
                           precos_recursos, jogos_por_placar, armazenamento_mb_por_placar, dias_teste,
                           max_placares_autoatendimento, max_pacotes_autoatendimento)
VALUES (8900, 1900, 10, '{"midia": 2900, "video_jogador": 1900, "arte_propria": 4900}', 20, 2048, 14, 20, 10);

-- O que o cliente contratou: { placares, pacotes_usuarios_extras, recursos: {..} }.
-- `valor_mensal_centavos` congela o preço no momento da contratação: mudar a
-- tabela de preços não altera quem já é cliente (só quando ele muda a composição).
ALTER TABLE clientes ADD COLUMN composicao jsonb NOT NULL DEFAULT '{}';
ALTER TABLE clientes ADD COLUMN valor_mensal_centavos integer NOT NULL DEFAULT 0 CHECK (valor_mensal_centavos >= 0);

-- Clientes que já existiam: a composição equivalente ao plano antigo, mantendo
-- o preço que pagavam. Jogos/armazenamento/esportes do plano antigo que
-- passariam dos novos valores por placar viram ajuste individual (limites_extra).
UPDATE clientes c SET
    composicao = jsonb_build_object(
        'placares', greatest(p.max_placares, 1),
        'pacotes_usuarios_extras', greatest(ceil(p.max_usuarios / 10.0)::int - 1, 0),
        'recursos', jsonb_build_object(
            'midia', coalesce((p.recursos->>'midia')::boolean, true),
            'video_jogador', coalesce((p.recursos->>'video_jogador')::boolean, true),
            'arte_propria', coalesce((p.recursos->>'arte_propria')::boolean, false))),
    valor_mensal_centavos = p.preco_centavos,
    limites_extra = jsonb_build_object(
        'max_jogos_abertos', p.max_jogos_abertos,
        'max_armazenamento_mb', p.max_armazenamento_mb) || c.limites_extra
FROM planos p WHERE p.id = c.plano_id;

UPDATE clientes SET composicao = '{"placares": 1, "pacotes_usuarios_extras": 0, "recursos": {}}'
WHERE composicao = '{}';

ALTER TABLE clientes DROP COLUMN plano_id;
DROP TABLE planos;
