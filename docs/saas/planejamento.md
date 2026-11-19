# Placar SaaS — Planejamento

Status: **aprovado — em execução** · Branch: `saas` · Criado em 2026-11-19

Objetivo: transformar o Placar Clube num produto comercializável por assinatura,
em que cada cliente (clube, escola, liga, arena) tem seus placares, sua agenda de
jogos, seus times e sua arte, com limites definidos pelo plano contratado.

A versão do Clube dos Funcionários **não entra no SaaS**: fica congelada no branch
`cfcsn` (criado a partir da `main`), com a integração Laravel como está hoje.

---

## 1. Decisões já tomadas

| Tema | Decisão |
|---|---|
| Hospedagem | **Nuvem central**: um servidor atende todos os clientes; telões e tablets acessam pela internet, com login. |
| API Laravel | **Sai do SaaS.** Times, jogadores, agenda e súmula passam a viver no Postgres do próprio sistema. O Clube segue no branch `cfcsn`. |
| Banco | **PostgreSQL**. |
| Limite de placares | Conta **placares (quadras) cadastrados**. Cada placar tem seu jogo em andamento, seus telões e seu controle. Plano com 3 placares = até 3 jogos simultâneos. |
| Limite de jogos | Conta **jogos em aberto** (agendados ou ao vivo). Encerrar ou cancelar um jogo libera a vaga. |
| Cobrança | **Autocadastro + período de teste**, pagamento online recorrente. |
| Arte do telão | **Totalmente personalizada por cliente** (enviada por você ou pelo próprio cliente), seguindo um gabarito. |
| Usuários | **Vários usuários por cliente, com papéis** (admin e operador). |
| Stack | **Sem build** no frontend, como hoje. Node + Express + Socket.IO + Postgres. |

---

## 2. Visão geral da arquitetura

```
                         ┌──────────────────────────────────────────────┐
  Painel de gestão ─────▶│                                              │
  (você, /admin)         │  Servidor Node (Express + Socket.IO)         │
                         │                                              │
  Área do cliente ──────▶│  • auth (sessão em cookie, papéis)           │
  (/app: agenda, times,  │  • API REST (cadastros, agenda, admin)       │──▶ PostgreSQL
   placares, usuários)   │  • GerenciadorDePlacares                     │
                         │      placar 1 ─ gameState ─ sala socket      │──▶ Armazenamento de
  Controle (tablet) ────▶│      placar 2 ─ gameState ─ sala socket      │    arquivos (S3/R2)
                         │      ...                                     │
  Telões (TV) ◀──────────│  • gameLogic.js (inalterado, puro)           │──▶ Gateway de pagamento
                         │  • limites do plano                          │    (webhooks)
                         └──────────────────────────────────────────────┘
```

O que **se reaproveita quase sem mudança**: `gameLogic.js` (toda a regra de jogo,
já pura e testada), o telão (`index.html`/`style.css`), o controle
(`controle.html`), a mídia, os placares paralelos, `ui.css`/`ui.js`.

O que **muda de verdade**:

1. **Um jogo por processo → vários placares por processo.** O `gameState` global
   vira um objeto por placar dentro de um `GerenciadorDePlacares`; cada placar é
   uma *sala* do Socket.IO e `broadcast()` passa a emitir só para a sala.
2. **Estado em memória → persistido.** O estado do placar é gravado no Postgres
   (snapshot `jsonb`, com gravação agrupada a cada ~1 s) e recarregado no boot. Os
   lances viram linhas na súmula. Isso resolve de quebra a perda de dados ao
   reiniciar (item de alta prioridade do roadmap atual).
3. **Fila para API externa → gravação direta.** `placarApi.js` e a fila de
   `placarEventos.js` deixam de existir: o evento vai para a tabela `eventos_jogo`
   na mesma operação do lance. As ideias boas continuam (log *append-only*,
   estorno referenciando o evento original, `cronometro_ms` obrigatório).
4. **Sem autenticação → tudo autenticado e isolado por cliente.**

### Multi-cliente (tenancy)

Banco único, esquema único, coluna `cliente_id` em toda tabela do cliente. Todo
acesso passa por uma camada de repositório que exige o `cliente_id` da sessão —
nenhuma rota consulta tabela de cliente "solta". Numa segunda etapa, dá para
reforçar com *Row Level Security* do Postgres.

### Telão sem login

TV não digita senha. O telão é **pareado**: abre `app.<dominio>/telao`, mostra um
código de 6 dígitos; no controle/área do cliente alguém digita o código e escolhe
o placar. O telão recebe um token de leitura daquele placar (revogável, guardado
na TV). Mesma ideia para `static.html` e `placar-neutro.html`.

### Dependência de internet

Com nuvem central, se a internet do ginásio cair o telão congela no último estado
(o relógio continua andando localmente, porque já é calculado no cliente) e o
controle não consegue marcar. Mitigações no MVP: aviso visível de "sem conexão"
no controle e no telão, reenvio automático dos comandos feitos offline (o
Socket.IO já guarda emits enquanto desconectado) e reconexão automática. Um
agente local para funcionar 100% offline fica fora do escopo inicial.

---

## 3. Modelo de dados (primeira versão)

| Tabela | Campos principais | Observações |
|---|---|---|
| `planos` | nome, preço, `max_placares`, `max_jogos_abertos`, `max_usuarios`, `max_armazenamento_mb`, `esportes` (array), `recursos` (jsonb), `dias_teste`, ativo | Você cria e edita no painel. |
| `clientes` | nome, slug, documento (CPF/CNPJ), e-mail, telefone, `status` (`teste`/`ativo`/`inadimplente`/`suspenso`/`cancelado`), `plano_id`, `teste_ate`, `limites_extra` (jsonb) | `limites_extra` sobrescreve o plano para um cliente específico. |
| `usuarios` | `cliente_id` (nulo para superadmin), nome, e-mail, `senha_hash`, `papel` (`superadmin`/`admin`/`operador`), ativo, `email_verificado_em` | |
| `sessoes` | | Sessões em Postgres (`connect-pg-simple`). |
| `assinaturas` | `cliente_id`, gateway, id no gateway, status, próximo vencimento | Atualizada por webhook. |
| `faturas` | `cliente_id`, valor, vencimento, status, link de pagamento | |
| `placares` | `cliente_id`, nome ("Quadra 1"), `tema_id`, `estado` (jsonb), `jogo_atual_id`, ativo | `estado` = o antigo `gameState`. |
| `telas` | `placar_id`, nome, `token_hash`, tipo (telão/estático/neutro), último acesso | Dispositivos pareados. |
| `times` | `cliente_id`, nome, esporte, categoria, logo | |
| `jogadores` | `cliente_id`, `time_id`, número, nome, foto, vídeo | |
| `jogos` | `cliente_id`, `placar_id` (opcional), esporte, `time_casa_id`, `time_fora_id`, data/hora prevista, local, `status` (`agendado`/`ao_vivo`/`encerrado`/`cancelado`), placares, sets, `parciais` (jsonb), iniciado/encerrado em | Conta no limite enquanto `agendado` ou `ao_vivo`. |
| `escalacoes` | `jogo_id`, `time_id`, `jogador_id`, número, titular, capitão | |
| `eventos_jogo` | uuid, `jogo_id`, sequência, tipo, time, `jogador_id`, valor, período, `cronometro_ms`, payload, `estorno_de` | Súmula *append-only*. |
| `temas` | `cliente_id`, nome, arquivos por esporte, cores de borda, posição da faixa de patrocinadores | Arte personalizada (seção 6). |
| `arquivos` | `cliente_id`, tipo (vídeo/slide/patrocinador/arte/foto/logo), caminho no storage, tamanho | Soma para a cota de armazenamento. |
| `auditoria` | quem, cliente, ação, dados, quando | Ações do painel de gestão e "entrar como". |

Fotos e logos passam a ser **arquivos com URL**, não base64 no estado — corta o
tamanho de cada `atualizar_tela` (item de média prioridade do roadmap atual).

---

## 4. Limites e acessos

Limite efetivo = valor do plano, sobrescrito por `limites_extra` do cliente.
Verificado **no servidor**, sempre; a tela só mostra.

| Limite | Quando é verificado | Ao atingir |
|---|---|---|
| Placares | criar/reativar placar | bloqueia com mensagem e convite para trocar de plano |
| Jogos em aberto | agendar jogo, criar jogo rápido no controle | idem; encerrar/cancelar libera |
| Usuários | convidar usuário | idem |
| Armazenamento | upload de mídia/arte/foto | idem |
| Esportes | criar jogo/time | esporte fora do plano não aparece |
| Recursos (jsonb) | ex.: vídeo do jogador, placar neutro, arte própria, telões por placar | recurso some da interface e é recusado no servidor |

Regras de transição:

- **Downgrade com excesso** (ex.: tinha 5 placares, plano novo permite 3): nada é
  apagado; o cliente escolhe quais ficam ativos, os demais ficam inativos.
- **Suspensão/inadimplência nunca derruba jogo ao vivo.** Bloqueia novos jogos e
  novos logins de operador; o jogo em andamento termina normalmente.
- **Fim do teste sem pagamento**: cliente vai para `suspenso`, dados preservados
  por um prazo (ex.: 60 dias) antes de qualquer exclusão.

---

## 5. Telas

### 5.1 Painel de gestão (você) — `/admin`

- **Clientes**: lista com status, plano, uso (placares, jogos em aberto,
  armazenamento, último acesso); criar/editar cliente; trocar plano; ajustar
  limites individuais; estender teste; suspender/reativar; ver faturas.
- **Entrar como cliente** (para suporte), sempre registrado na auditoria.
- **Planos**: criar/editar planos e seus limites/recursos.
- **Artes**: subir e atribuir temas a um cliente.
- **Indicadores**: clientes por status, em teste, receita mensal, jogos ao vivo agora.
- Login separado com papel `superadmin` (2FA numa fase seguinte).

### 5.2 Área do cliente — `/app` (papel admin)

- **Agenda**: lista/calendário de jogos; agendar (esporte, times, data/hora,
  local, placar/quadra); editar, cancelar; ver súmula dos encerrados.
- **Times e jogadores**: cadastro, logos/fotos, importação de planilha
  (reaproveita o `importarElenco` atual).
- **Placares**: cadastrar quadras, parear e revogar telões.
- **Usuários**: convidar admin/operador.
- **Mídia** (a tela atual de mídia, agora por cliente) e **Arte do telão**.
- **Assinatura**: plano atual, uso x limite, faturas, trocar plano.

### 5.3 Controle — `/app/placar/:id/controle` (operador ou admin)

A tela atual, escopada a um placar. A aba **Preparar** passa a listar os jogos do
banco para aquela quadra/dia (no lugar de `listarJogos` da API Laravel) e ganha
**"Agendar jogo"** — o formulário de agendamento dentro do próprio controle, como
pedido, respeitando o limite de jogos em aberto. O "jogo rápido" (antigo modo
manual/avulso) também cria um registro em `jogos`.

A configuração (`configuracao.html`) perde o modo API e passa a editar o jogo
carregado e o elenco salvo no banco.

### 5.4 Telão e placares paralelos

Mesmas telas, mais o fluxo de pareamento e a arte vinda do tema do placar.

### 5.5 Site público

Página de apresentação com planos, **cadastro** (cria cliente em teste + usuário
admin, com verificação de e-mail), login, recuperação de senha, termos de uso e
política de privacidade.

---

## 6. Arte personalizada

Hoje o posicionamento do telão é calibrado para a arte do Clube: proporção 2:1,
áreas de nome/placar/relógio em `%`/`cqw`, faixa de patrocinadores começando em
88,87 %, cores de borda medidas na arte (`--borda-arte-*`). Por isso arte
personalizada precisa de um **gabarito**:

1. Publicar um gabarito (1024×512 ou 2048×1024, com as áreas marcadas) por esporte.
2. Cada tema guarda: `background`, `box`/`CAIXA`/`element-*` por esporte, cores de
   borda e posição da faixa de patrocinadores. O telão lê esses valores como
   variáveis CSS em vez de constantes no `style.css`.
3. Upload pelo painel (você) ou pela área do cliente (recurso do plano), com
   prévia antes de aplicar.
4. É preciso uma **arte padrão neutra** do produto para clientes em teste e para
   quem não enviar a sua — a arte atual tem marcas do Clube e da CBC e não pode ser
   usada.

---

## 7. Fases

Cada fase termina com testes passando e algo demonstrável. As fases 0–5 formam um
produto que já pode ser vendido com cadastro feito por você no painel; a fase 6
liga o autocadastro e a cobrança automática.

| Fase | Entrega | Principais tarefas |
|---|---|---|
| **0. Fundação** | Projeto rodando com Postgres | `docker-compose` com Postgres para dev; migrações (`node-pg-migrate`) e driver `pg`; configuração por `.env` (`DATABASE_URL`, porta, segredo de sessão); reorganizar o backend em `src/` (rotas, repositórios, sockets); remover `placarApi.js` e a integração Laravel; ajustar CLAUDE.md e docs. |
| **1. Vários placares** | N jogos simultâneos num processo, sobrevivendo a reinício | `GerenciadorDePlacares`; salas do Socket.IO; `broadcast` por sala; estado persistido em `placares.estado`; URLs com id do placar; testes de isolamento (ação no placar 1 não chega ao 2). |
| **2. Contas e acesso** | Login, papéis, isolamento por cliente | `usuarios`, sessões, senhas com hash; middleware de papel; autenticação no handshake do Socket.IO (operador só entra em placar do próprio cliente); pareamento de telão; upload/exclusão de arquivos autenticados e com limite de tamanho. |
| **3. Cadastros e agenda** | Agenda funcionando de ponta a ponta | times, jogadores, jogos, escalação, súmula em `eventos_jogo`; Preparar lendo do banco; "Agendar jogo" no controle; fotos/logos como URL; limites de placares e jogos em aberto. |
| **4. Painel de gestão** | Você cadastra e controla clientes | `/admin` com clientes, planos, limites individuais, status, uso, auditoria e "entrar como". |
| **5. Mídia e arte por cliente** | Cada cliente com sua mídia e seu telão | Armazenamento por cliente (camada que funciona em disco e em S3/R2); cota de armazenamento; temas e gabarito; arte padrão neutra. |
| **6. Autocadastro, teste e cobrança** | Venda sem você no meio | Página pública e cadastro; e-mails transacionais (verificação, convite, senha, aviso de fim de teste); integração com gateway (assinatura + webhooks); regras de inadimplência/suspensão. |
| **7. Produção** | No ar com segurança | Hospedagem com HTTPS, Postgres gerenciado com backup, monitoramento de erros, logs, rate limit no login, termos/LGPD, documentação para clientes. |

---

## 8. Riscos e cuidados

- **Internet no ginásio** (ver seção 2). É a maior mudança em relação a hoje; vale
  testar num jogo real antes de vender.
- **Dados de atletas** (nome, foto, vídeo — possivelmente de menores): LGPD exige
  termos claros, base legal e exclusão a pedido. O cliente é o controlador, o
  SaaS é operador; isso precisa estar no contrato/termos.
- **Isolamento entre clientes**: um bug de `cliente_id` vaza dados de um clube para
  outro. Mitigar com a camada de repositório obrigatória e testes específicos.
- **Custo de vídeo**: comerciais e vídeos de jogador pesam em armazenamento e
  tráfego; por isso a cota por plano.
- **Divergência com `cfcsn`**: correções de regra de jogo (`gameLogic.js`) feitas
  em um branch precisarão ser levadas ao outro. Manter `gameLogic.js` idêntico nos
  dois facilita (`git cherry-pick`).

---

## 9. Decisões complementares (2026-11-19)

| Tema | Decisão |
|---|---|
| Nome e domínio | **MarQGol** — `https://marqgol.artzan.tech` |
| Gateway | **Asaas** (Pix, boleto, cartão; assinatura recorrente + webhooks) |
| Jogo agendado vencido | **Expira sozinho 24 h** depois do horário previsto se não foi iniciado (libera a vaga) |
| Período de teste | **14 dias**, sem marca d'água no telão |
| Arte padrão neutra | Produzida no próprio projeto (SVG) |
| Hospedagem | VPS Hostinger com Docker, compartilhada — segue o contrato de deploy do `CLAUDE.md` (edge Caddy, rede `edge`, script `site`) |
| Súmula/estatísticas públicas | **Fora do escopo** — outro app vai se integrar depois (deixar a API/estrutura de dados preparada) |
