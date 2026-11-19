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
| `planos` | preço, `max_placares`, `max_jogos_abertos`, `max_usuarios`, `max_armazenamento_mb`, `esportes`, `recursos` (`midia`, `video_jogador`, `arte_propria`), `dias_teste`, `publico`, `ativo` |
| `clientes` | dados de cobrança, `status` (`teste`, `ativo`, `inadimplente`, `suspenso`, `cancelado`), `plano_id`, `teste_ate`, `limites_extra` (ajuste individual), `arte` (versão/bordas), ids do Asaas |
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

Públicas: `GET /api/health`, `GET /api/publico/planos`, `POST /api/auth/cadastro|entrar|sair|esqueci-senha|redefinir-senha|aceitar-convite|reenviar-verificacao`,
`GET /api/auth/eu|convite|verificar-email`, `POST /api/asaas/webhook`.

Área do cliente (`/api/app`, sessão de cliente; ✱ = só admin):
`GET resumo`; `PATCH conta`✱, `PATCH perfil`; placares (`GET`, `POST`✱, `PATCH :id`✱,
`DELETE :id`✱, telas: `GET/POST placares/:id/telas`, `DELETE telas/:id`);
times (`GET`, `POST`, `PATCH :id`, `DELETE :id`, `GET/POST :id/jogadores`), `PATCH/DELETE jogadores/:id`;
jogos (`GET ?data&de&ate&status&placar`, `POST`, `GET :id` com súmula, `PATCH :id`,
`POST :id/cancelar`, `POST :id/reagendar`, `PUT :id/escalacao/:timeId`);
usuários✱ (`GET`, `POST` convite, `PATCH :id`, `DELETE :id`, `POST :id/reenviar`);
assinatura (`GET`, `POST`✱ `{planoId}`, `POST atualizar`✱, `POST cancelar`✱);
arquivos (`POST arquivos/foto|video-jogador?nome=`); arte (`GET arte`, `PUT/DELETE arte/<slot>`✱, `POST arte-bordas`✱).

Mídia: `GET /api/midia`, `POST /api/midia/:tipo?nome=`, `DELETE /api/midia/:tipo/:nome`.

Painel (`/api/admin`, só superadmin): `indicadores`, `clientes` (lista, detalhe,
criar, `PATCH`, `DELETE` com slug, `:id/entrar`, `:id/reenviar-acesso`, `:id/arte*`),
`sair-cliente`, `planos` (`GET`, `POST`, `PUT :id`), `auditoria`, `revisar-status`.

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
cadastro ─▶ teste (dias_teste do plano)
teste ──assina + paga──▶ ativo
teste vencido ──sem assinatura──▶ suspenso
teste vencido ──com fatura aberta──▶ inadimplente
ativo ──PAYMENT_OVERDUE──▶ inadimplente ──7 dias──▶ suspenso
inadimplente/suspenso ──PAYMENT_CONFIRMED/RECEIVED──▶ ativo
cancelar (cliente ou painel) ──▶ cancelado
```

- Assinar: cria cliente e assinatura no Asaas (`billingType: UNDEFINED`, mensal,
  1º vencimento no fim do teste). Trocar de plano: `PUT /subscriptions/:id` com
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
3. O `pos_subida` roda `migrate`: cria tabelas, os 3 planos iniciais e o superadmin.
4. Entre em `https://marqgol.artzan.tech/entrar` com o superadmin e ajuste planos/preços.
5. No Asaas (produção): chave de API em `ASAAS_API_KEY`, `ASAAS_API_URL=https://api.asaas.com/v3`,
   webhook apontando para `/api/asaas/webhook` com o token do `.env`.

Atualizar: `site atualizar marqgol`.

## 8. Testes

`npm test` sobe um Postgres descartável e roda tudo: unitários de regra de jogo e
`test/saas.test.js` (ponta a ponta: cadastro, limites, isolamento entre clientes,
controle + súmula, persistência, pareamento, expiração, cota de upload, convites,
suspensão, webhook, painel, downgrade, senha, assinatura com Asaas falso).
