# MarQGol — arquitetura do SaaS

Público: desenvolvedores. Complementa a [documentação técnica](../documentacao-tecnica.md),
que continua valendo para regra de jogo (`gameLogic.js`), telão e controle.
Decisões de produto: [planejamento.md](planejamento.md).

## 1. Visão geral

```
TV (telão)  ──cookie marq_tela──┐
Tablet (controle) ──sessão──────┼──▶ Express + Socket.IO (um processo)
Área do cliente /app ──sessão───┤        │  GerenciadorDePlacares (estado por placar, sala placar:<id>)
Painel /admin ──sessão──────────┘        │  gameLogic.js (puro)
                                         ├──▶ PostgreSQL (dados, sessões, estado dos placares, súmula)
Asaas ──webhook──▶ /api/asaas/webhook    ├──▶ DATA_DIR/clientes/<id>/ (mídia, arte, fotos)
                                         └──▶ Asaas (assinaturas), SMTP (e-mails)
```

## 2. Banco de dados

Esquema em [src/db/migrations/001_inicial.sql](../../src/db/migrations/001_inicial.sql).
Migração nova = arquivo `NNN_nome.sql` (sem "down"); `npm run migrate` aplica.

| Tabela | Conteúdo |
|---|---|
| `tabela_precos` | uma linha (migração 002): preço por placar, preço e tamanho do pacote de usuários, `precos_recursos` (`midia`, `video_jogador`, `arte_propria`), jogos e MB por placar, `dias_teste`, tetos do autoatendimento |
| `clientes` | dados de cobrança, `status` (`teste`, `ativo`, `inadimplente`, `suspenso`, `cancelado`), `composicao` (plano on demand), `valor_mensal_centavos` (congelado ou negociado), `teste_ate`, `limites_extra` (ajuste individual), `arte` (versão/bordas), ids do Asaas |
| `usuarios` | `papel` `superadmin` (sem cliente), `admin`, `operador`; senha scrypt |
| `tokens` | verificação de e-mail, convite, redefinição de senha (só hash) |
| `sessoes` | sessões (connect-pg-simple) |
| `placares` | quadras; `estado` (o antigo `gameState`) e `sessao` (jogo carregado + fila da súmula) |
| `telas` | TVs pareadas (hash do token do cookie), tipo `telao`/`simples`/`neutro` |
| `times`, `jogadores` | cadastro (exclusão lógica) |
| `jogos`, `escalacoes` | agenda; `status` `agendado`/`ao_vivo`/`encerrado`/`cancelado`/`expirado` |
| `eventos_jogo` | súmula append-only (uuid PK, sequência, estorno por `payload.evento_uuid`) |
| `faturas`, `webhooks_asaas` | espelho das cobranças e idempotência dos webhooks |
| `auditoria` | ações administrativas, "entrar como", mudanças automáticas de status |

## 3. Autenticação e autorização

- **Sessão** (`marq_sessao`, httpOnly, `SameSite=Lax`, `Secure` em produção, 30 dias rolantes).
  `req.usuario` = usuário efetivo (`resolverUsuario`): superadmin com
  `session.comoClienteId` age como admin daquele cliente ("entrar como").
- **TV**: `marq_tela` (400 dias) com token de leitura de um placar. Pareamento:
  `POST /api/telas/codigo` (TV) → código de 6 dígitos em memória (10 min) →
  `POST /api/app/placares/:id/telas {codigo, tipo, nome}` (pessoa logada) →
  `GET /api/telas/codigo/status` (TV) devolve o cookie e o destino.
- **CSRF**: mutações em `/api` exigem `X-MarQ: 1`.
- **Limitadores** em memória: login (10/15 min por IP+e-mail), cadastro, senha, códigos.

## 4. Rotas HTTP

Públicas: `GET /api/health`, `GET /api/publico/precos`, `POST /api/auth/cadastro|entrar|sair|esqueci-senha|redefinir-senha|aceitar-convite|reenviar-verificacao`,
`GET /api/auth/eu|convite|verificar-email`, `POST /api/asaas/webhook`.

Área do cliente (`/api/app`, sessão de cliente; ✱ = só admin):
`GET resumo`; `PATCH conta`✱, `PATCH perfil`; placares (`GET`, `POST`✱, `PATCH :id`✱,
`DELETE :id`✱, telas: `GET/POST placares/:id/telas`, `DELETE telas/:id`);
times (`GET`, `POST`, `PATCH :id`, `DELETE :id`, `GET/POST :id/jogadores`), `PATCH/DELETE jogadores/:id`;
jogos (`GET ?data&de&ate&status&placar`, `POST`, `GET :id` com súmula, `PATCH :id`,
`POST :id/cancelar`, `POST :id/reagendar`, `PUT :id/escalacao/:timeId`);
usuários✱ (`GET`, `POST` — com `senha` cria já com acesso, sem `senha` manda convite —, `PATCH :id` (`papel`, `ativo`, `nome`, `senha`), `DELETE :id`, `POST :id/reenviar`);
`PUT composicao`✱ `{composicao}` (monta/muda o plano; atualiza o Asaas se assinado);
assinatura (`GET` com tabela e detalhamento, `POST`✱ assina o valor atual, `POST atualizar`✱, `POST cancelar`✱);
arquivos (`POST arquivos/foto|video-jogador?nome=`); arte (`GET arte`, `PUT/DELETE arte/<slot>`✱, `POST arte-bordas`✱).

Mídia: `GET /api/midia`, `POST /api/midia/:tipo?nome=`, `DELETE /api/midia/:tipo/:nome`.

Painel (`/api/admin`, só superadmin): `indicadores`, `clientes` (lista, detalhe,
criar — com `senhaAdmin` o admin do cliente já nasce com senha —, `PATCH`, `DELETE` com slug, `:id/entrar`,
`:id/reenviar-acesso`, `:id/arte*`, `:id/usuarios` `POST` e `:id/usuarios/:uid` `PATCH`/`DELETE`),
`superadmins` (`GET`, `POST`, `PATCH :id`, `DELETE :id`; não remove/desativa a si mesmo nem o último ativo),
`sair-cliente`, `precos` (`GET`, `PUT`), `auditoria`, `revisar-status`. Criar/alterar cliente aceita
`composicao` (sem teto) e `valor_mensal_centavos` (negociado; `null` = preço de tabela).

**Sem SMTP** (`SMTP_HOST` vazio): `GET /api/auth/eu` e o resumo trazem `emailAtivo: false`; as telas
passam a oferecer "Definir senha agora" no lugar do convite e escondem o aviso de confirmar e-mail.
Senha definida por administrador marca o e-mail como confirmado e derruba as sessões abertas da pessoa.

Páginas: `/` (site), `/entrar`, `/cadastro`, `/esqueci-senha`, `/redefinir-senha`,
`/convite`, `/termos`, `/app/`, `/admin/`, `/telao`, `/p/<placar>/` (telão),
`/p/<placar>/static.html`, `/p/<placar>/placar-neutro.html`,
`/p/<placar>/controle/{controle,configuracao,controle_anuncios}.html`.

## 5. Socket.IO

O cliente conecta com `io({ query: { placar } })` (`MARQ.conectar()`). Erros de
conexão: `nao_autenticado`, `sem_acesso`, `placar_inexistente`, `placar_inativo`,
`placar_excedente`. Eventos e payloads: os mesmos da seção 8 da documentação
técnica, agora por sala. `placar_chamar` atende `ping`, `listarJogos`,
`listarTimes`, `elencoDoTime`, `criarTime`, `agendarJogo`.

## 6. Ciclo do cliente e cobrança

```
cadastro ─▶ teste (dias_teste da tabela de preços)
teste ──assina + paga──▶ ativo
teste vencido ──sem assinatura──▶ suspenso
teste vencido ──com fatura aberta──▶ inadimplente
ativo ──PAYMENT_OVERDUE──▶ inadimplente ──7 dias──▶ suspenso
inadimplente/suspenso ──PAYMENT_CONFIRMED/RECEIVED──▶ ativo
cancelar (cliente ou painel) ──▶ cancelado
```

- Assinar: cria cliente e assinatura no Asaas (`billingType: UNDEFINED`, mensal,
  1º vencimento no fim do teste). Mudar a composição: `PUT /subscriptions/:id` com
  `updatePendingPayments`.
- Webhook: cadastre no painel do Asaas `https://<DOMAIN>/api/asaas/webhook` com o
  token `ASAAS_WEBHOOK_TOKEN`. Eventos tratados: `PAYMENT_CREATED/UPDATED/CONFIRMED/RECEIVED/OVERDUE/DELETED/REFUNDED`, `SUBSCRIPTION_DELETED/INACTIVATED`.
- Tarefas (`src/tarefas.js`): expiração de jogos (5 min) e revisão de status +
  lembrete 3 dias antes do fim do teste (1 h).

## 7. Deploy (VPS ArtZan)

Segue o contrato da seção "Deploy" do `CLAUDE.md`. Arquivos:
`Dockerfile`, `docker-compose.prod.yml` (slug `marqgol`; `web` na rede `edge` com
alias `marqgol-web`, `db` só na rede interna `banco`; serviço `migrate` em
`profiles: [tools]`), `.env.production.example`, `deploy/deploy.conf`,
`deploy/site.caddy`, `scripts/backup-db.sh` (cron 3h, 14 dumps).

Primeiro deploy:
1. DNS na Hostinger: registro A `marqgol` → IP da VPS (TTL 300).
2. Na VPS: `site novo <url do repositório>` (branch `saas`); preencha o `.env`
   (`SUPERADMIN_EMAIL`, dados do Asaas e SMTP). Segredos vazios são gerados.
3. O `pos_subida` roda `migrate`: cria tabelas, a tabela de preços (valores de exemplo) e o superadmin.
4. Entre em `https://marqgol.artzan.tech/entrar` com o superadmin e ajuste a tabela de preços (/admin → Preços).
5. No Asaas (produção): chave de API em `ASAAS_API_KEY`, `ASAAS_API_URL=https://api.asaas.com/v3`,
   webhook apontando para `/api/asaas/webhook` com o token do `.env`.

Atualizar: `site atualizar marqgol`.

## 8. Testes

`npm test` sobe um Postgres descartável e roda tudo: unitários de regra de jogo e
`test/saas.test.js` (ponta a ponta: cadastro, limites, isolamento entre clientes,
controle + súmula, persistência, pareamento, expiração, cota de upload, convites,
suspensão, webhook, painel, downgrade, senha, assinatura com Asaas falso).
