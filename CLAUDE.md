# CLAUDE.md

Guia para agentes Claude (Claude Code) trabalhando neste repositório. Escrito em
português, como o código, os comentários e a interface. **Responda ao usuário em
português.**

> Branch `saas`: **MarQGol**, o placar vendido como serviço
> (`https://marqgol.artzan.tech`). O sistema original do Clube dos Funcionários,
> com a integração Laravel, continua no branch `cfcsn` — não misture.

Documentação completa:
- [docs/saas/planejamento.md](docs/saas/planejamento.md) — decisões de produto e fases
- [docs/documentacao-tecnica.md](docs/documentacao-tecnica.md) — arquitetura, contratos, módulos, telão
- [docs/manual-do-usuario.md](docs/manual-do-usuario.md) — como clientes e operadores usam o sistema

Este arquivo resume o que um agente precisa saber **antes** de mexer no código:
o mapa, as invariantes e as armadilhas. Ao mudar comportamento, atualize também
a documentação em `docs/` (e este arquivo, se a mudança afetar algo listado aqui).

---

## Visão geral

Placar eletrônico em tempo real para **futsal, basquete e vôlei**, multi-cliente.
Cada **cliente** (clube, escola, liga) tem **placares** (quadras), cada placar
tem seu jogo, seu controle (tablet) e suas TVs pareadas. O cliente agenda jogos,
cadastra times e jogadores, e monta o próprio **plano on demand** (placares,
pacotes de usuários, recursos especiais). O dono do SaaS (superadmin) gerencia
clientes, a tabela de preços e limites em `/admin`.

- Backend: Node.js 22+ + Express 5 + Socket.IO 4 + **PostgreSQL** (`pg`).
- Frontend: HTML/CSS/JS puro em `public/`. **Sem build, sem framework, sem bundler.**
- Cobrança: **Asaas** (assinatura recorrente + webhooks). E-mail: SMTP (nodemailer).
- Hospedagem: VPS Hostinger com Docker, atrás do Caddy "edge" (seção Deploy).

## Comandos

```bash
npm run db             # Postgres de dev embutido (porta 5433, pasta .pgdata/) — deixe num terminal
npm run dev            # nodemon; em dev o servidor migra e cria o superadmin sozinho
npm start              # node server.js
npm test               # sobe Postgres descartável e roda node --test (unitários + ponta a ponta)
npm run test:unit      # só node --test (testes de banco são pulados sem TEST_DATABASE_URL)
npm run migrate        # aplica migrações + dados iniciais (produção usa o serviço `migrate`)
node scripts/gerar-arte-padrao.js   # regera public/arte-padrao/*.svg
```

`.env` de dev: copie `.env.example` (`DATABASE_URL`, `SUPERADMIN_EMAIL/SENHA`).
Não há Docker na máquina de dev: o Postgres vem do pacote `embedded-postgres`
(devDependency). No Windows o `stop()` dele trava; `scripts/pg-embutido.js` para
pelo `pg_ctl`. Não há lint.

Para verificar telas de ponta a ponta: suba um Postgres e o servidor isolados
(outra porta, `DATA_DIR` temporário) e dirija com Playwright (devDependency).
A porta 4000 costuma estar ocupada pelo servidor de dev do usuário.

## Mapa do código

| Arquivo | Papel |
|---|---|
| [gameLogic.js](gameLogic.js) | **Toda** regra de jogo. Funções puras sobre um `state`. Igual ao do branch `cfcsn` — correção de regra vale para os dois (`git cherry-pick`). |
| [placarEventos.js](placarEventos.js) | Tradução de ação → evento da súmula (uuid/sequência no momento da ação, estorno). Agora grava no Postgres, não numa API. |
| [server.js](server.js) | Entrada: banco, migração em dev, porta, desligamento limpo (grava os placares). |
| [src/app.js](src/app.js) | Monta tudo (`criarApp({ db, cfg, email, fetchAsaas })`) sem escutar porta — os testes usam. |
| [src/config.js](src/config.js) | Única leitura de `process.env`. |
| [src/db/](src/db/) | Pool `pg`, migrador (`migrations/*.sql`, sem "down"). |
| [src/repos.js](src/repos.js) | **Todo SQL de negócio.** Funções de dado de cliente recebem `clienteId` e o põem no WHERE. |
| [src/limites.js](src/limites.js) | Limites/recursos e plano on demand: `normalizarComposicao`, `limitesDaComposicao`, `precoDaComposicao` (puro; espelhado só para exibição em `public/comum/montador.js`). |
| [src/auth.js](src/auth.js) | Sessão (Postgres), papéis, "entrar como", cookie de TV (`marq_tela`), CSRF por cabeçalho `X-MarQ`. |
| [src/placares/gerenciador.js](src/placares/gerenciador.js) | Um estado por placar em memória + gravação no banco (~1 s), sala Socket.IO `placar:<id>`, súmula. |
| [src/placares/sockets.js](src/placares/sockets.js) | Autorização do socket e handlers (mesmos eventos do sistema antigo, por sala). |
| [src/servicos/](src/servicos/) | `agenda` (limite de jogos, formato de jogo), `contas` (cadastro, convite, criar com senha sem e-mail, definir senha), `cobranca` (Asaas, ciclo de status), `asaas`, `email`. |
| [src/rotas/](src/rotas/) | `publico` (auth), `telas` (pareamento), `arquivos` (páginas por placar, mídia, arte, uploads), `app` (área do cliente), `admin` (painel). |
| [src/tarefas.js](src/tarefas.js) | A cada 5 min expira jogos; a cada hora revisa teste/inadimplência. |
| `public/site/` | Venda, entrar, cadastro, senha, convite, termos (servido na raiz, `/entrar` → `entrar.html`). |
| `public/app/` | Área do cliente (`/app/`). |
| `public/admin/` | Painel de gestão (`/admin/`), só superadmin. |
| `public/telao/` | Página de pareamento de TV (`/telao`). |
| `public/placar/` | Telão (`index.html` + `style.css`), `static.html`, `placar-neutro.html` — servidos em `/p/<id>/`. |
| `public/controle/` | Controle, configuração, mídia — servidos em `/p/<id>/controle/`. |
| `public/comum/` | `ui.css`/`ui.js` (base visual e diálogos), `marq.js` (API, socket do placar), `site.css`. |
| `public/arte-padrao/` | Arte neutra (SVG, gerada por script) e **gabarito** da arte de cliente. |

**Onde mexer:** regra de jogo → `gameLogic.js` + teste. SQL → `src/repos.js`.
Limite/recurso → `src/limites.js` + conferência no servidor. Algo que o telão
precisa → `payloadEstado()` em `gerenciador.js`; **não reimplemente regra no HTML**.

## Multi-cliente e segurança (NÃO afrouxar)

- Toda tabela de cliente tem `cliente_id`; repositório **sempre** filtra por ele,
  mesmo buscando por id. Teste de isolamento em `test/saas.test.js`.
- Limites são conferidos **no servidor** (a tela só mostra). Criar jogo trava a
  linha do cliente (`FOR UPDATE`) antes de contar os jogos em aberto.
- Socket: o cliente diz o placar (`io({ query: { placar } })`, via `MARQ.conectar()`).
  Operador = usuário do cliente dono; TV = cookie `marq_tela` daquele placar
  (só recebe — nenhum handler de comando é registrado para ela). Depois de
  downgrade, só os N primeiros placares ativos operam (`placar_excedente`).
- Toda mutação em `/api` exige o cabeçalho `X-MarQ: 1` (CSRF). Webhook do Asaas
  é a exceção, autenticado por `asaas-access-token`.
- Logo/foto de time e jogador: só URL `/arquivos/<cliente>/...` gerada pelo upload.
- Suspensão/inadimplência **nunca derruba jogo ao vivo**: bloqueia agendar,
  carregar e cadastrar (HTTP 402 `assinatura_suspensa`), não os comandos de placar.
- "Entrar como" (suporte) fica na sessão (`comoClienteId`) e na auditoria.

## Regras de produto do SaaS

- Limite de **placares** = placares ativos. Limite de **jogos** = jogos com status
  `agendado` ou `ao_vivo`; encerrar/cancelar libera. Agendado vencido há **24 h**
  sem começar vira `expirado` (libera; pode ser reagendado).
- **Plano on demand** (sem planos fixos): `clientes.composicao` = `{ placares,
  pacotes_usuarios_extras, recursos }`; preço = placares × preço do placar +
  pacotes extras (o 1º pacote de usuários é incluso) + recursos ligados (valor
  fixo por conta). Jogos em aberto e armazenamento = cota por placar. Tudo vem
  da `tabela_precos` (uma linha, editada em /admin → Preços). O valor fica
  congelado em `clientes.valor_mensal_centavos` (ou negociado no painel): mudar
  a tabela não altera quem já é cliente. Mudança de composição passa por
  `cobranca.aplicarComposicao` (atualiza o Asaas se houver assinatura).
- Teste de **14 dias** (`tabela_precos.dias_teste`), sem marca d'água. Fim do teste:
  sem assinatura → `suspenso`; com fatura aberta → `inadimplente`. Inadimplente
  há 7 dias → `suspenso`. Pagamento confirmado (webhook) → `ativo`.
- A primeira cobrança vence no fim do teste. `billingType: UNDEFINED` (quem paga
  escolhe Pix/boleto/cartão).
- Arte do telão por cliente: slots em `armazenamento.SLOTS_ARTE`; o telão pede
  `base/<slot>.png` e o servidor serve o arquivo do cliente (qualquer extensão)
  ou o SVG padrão. Mudou a arte → `arte.versao` sobe e o telão recarrega.
- Súmula/estatística pública ficam **fora** (outro app vai se integrar depois).

## Fluxo de dados

Controle → evento Socket.IO → handler em `src/placares/sockets.js` → função de
`gameLogic` muta o estado **daquele placar** → animações e `atualizar_tela`
(estado + `serverTime` + derivados) para **a sala do placar**. Depois, se houver
jogo da agenda carregado, a ação vira evento da súmula (atualização **otimista**).

Um estado por placar, em memória no `GerenciadorDePlacares` e gravado no
Postgres (`placares.estado`/`sessao`, ~1 s depois da mudança e no desligamento).
Reiniciar o processo **não** perde placar nem eventos pendentes da súmula.
Um processo só (sem Redis): escalar horizontalmente exigiria adapter do Socket.IO.

Formato do estado: ver `criarEstadoInicial()` e a seção 5 da documentação técnica.
Campos derivados em `atualizar_tela`: `parcialFechavel`, `parcialAtual`,
`totalParciais`, `parcialEmAndamento`, `setPoint`, `lances` (com `estornavel`),
`limiteFaltas`, `alertaFaltas`, e do SaaS: `placar {id, nome}`, `clienteNome`,
`arte {versao, bordas}`.

## Invariantes e decisões que NÃO devem ser desfeitas

### Regras de jogo
- **Fechar set/quarto é sempre manual** (ação `fechar_set`). Atingir 25 com 2 de
  vantagem (15 no 5º set) só torna `parcialFechavel` verdadeiro, habilitando o
  botão na mesa. Nada fecha sozinho; `fechar_set` também não valida a regra (WO,
  jogo interrompido). `reabrir_set` desfaz o último fechamento.
- Parciais: `REGRAS_PARCIAL` em `gameLogic.js` (vôlei = set, melhor de 5; basquete
  = quarto, fecha pelo cronômetro, sem teto). Futsal não tem parciais.
- Set point (`pontoDeParcial`) simula +1 ponto e pergunta a `parcialFechavel` —
  não duplique a regra.
- `add_ponto` sempre emite `animacao_ponto` (`tipo: 'ponto'` com jogador,
  `'ponto_time'` sem). `add_falta` só emite com jogador (`tipo: 'falta'`).
- Textos: futsal `GOL!`, basquete `CESTA!`, vôlei `PONTO!`.
- Cronômetro: futsal regressivo MM:SS; basquete regressivo MM:SS.cc; vôlei
  crescente. Funções que dependem de tempo recebem `now` injetável (testes).
- **Lances**: `add_ponto`, `add_falta` e `fechar_set` registram um lance em
  `state.lances` (jogador sem foto). Correção = `estornar_lance` (marca
  `estornado`, nunca apaga) ou `reabrir_set`. O que pode ser corrigido é
  `lanceEstornavel` (ponto só da parcial atual, falta só do período atual, set só
  o último). `seqLance` não zera no `zerar_tudo` (ids ligam lance → uuid na súmula).
- Faltas: `REGRAS_FALTA` (futsal 5, basquete 4) só gera **aviso** (`alertaFaltas`).
  `zerar_faltas` é ação separada de `add_periodo` de propósito (± período corrige
  sem apagar faltas).

### Dois "zerar", ambos necessários
- `comando_placar` / `zerar_tudo` (mesa): zera números e cronômetro, **preserva**
  times, elenco, transmissão e o jogo carregado.
- `zerar_configuracao_completa` (configuração): estado inicial + descarrega o
  jogo; preserva só `patrocinadores` e `videoStandby` (vêm do cliente).

### Sincronização do relógio
Clientes fazem `clockOffset = Date.now() - serverTime` e somam em
`cronometro.inicioTimestamp`. Bloco repetido em `public/index.html`,
`public/placar-neutro.html` e
`public/controle/controle.html` — mude nos três.

### Agenda e súmula (antes: API Laravel)
- O contrato de socket do controle é o **mesmo** da época da API externa
  (`placar_chamar`, `placar_carregar_jogo`, `placar_criar_jogo`,
  `placar_iniciar_jogo`, `placar_salvar_escalacao`, `placar_encerrar_jogo`,
  `integracao_status`), respondido pelo Postgres. O formato de jogo
  (`{ jogo, time_casa, time_fora }` com elenco) vem de `servicos/agenda.js`.
  Mantido assim de propósito: o controle quase não mudou.
- `placar_chamar` aceita: `ping`, `listarJogos`, `listarTimes`, `elencoDoTime`,
  `criarTime` (por nome, reaproveita), `agendarJogo` (Agendar do controle).
- Súmula **append-only** em `eventos_jogo`: correção = evento `estorno` com o uuid
  original, nunca update/delete. `zerar_tudo` não entra.
- `cronometro_ms` é **obrigatório** em `ponto`/`falta`: `logic.tempoDecorrido`.
- uuid/sequência gerados no momento da ação; a gravação é em lote e idempotente
  (uuid é PK). Lances que chegam durante uma gravação entram na volta seguinte.
- O **primeiro PLAY** marca o jogo como `ao_vivo` (`gerenciador.iniciarJogo`).
- Só jogo `agendado`/`ao_vivo` carrega no controle; `expirado` precisa ser reagendado.
- O fluxo **pela agenda é o principal**; o manual (sem súmula) é fallback.

### Tela de configuração (`public/controle/configuracao.html`)
- `enviarConfiguracao()` = só emite. `salvarConfig()` = emite + valida + **trava**
  o formulário. `aplicarRespostaJogoNaTela` (Carregar e avulso) chama
  `enviarConfiguracao()` e **não trava** — editar elenco logo após carregar é
  normal. Não coloque a trava dentro de `enviarConfiguracao`.
- O cartão de transmissão fica logo abaixo do cartão do jogo; `#lista-jogos` tem
  altura limitada com rolagem própria.
- O esporte marcado e não salvo não é desfeito por `atualizar_tela`
  (`esporteEditado`) — enviar uma logo dispara broadcast.

### Configuração e mídia (base comum)
- Mesmo desenho da mesa (escuro, tablet, sem Tailwind) via `ui.css`/`ui.js`. A
  mesa tem CSS próprio com os **mesmos tokens** — mude cores nos dois lugares.
- Paleta da marca = apresentação do produto: fundo `#0D1017`, coral `--marca`
  `#FF4D5E` (texto escuro em cima), âmbar `--amarelo` `#FFB020`, azul
  `--azul-marca` `#5AA9FF`, seções claras `--creme` `#F4F3EF` com `--tinta` e
  carmim `--marca-forte` `#C8102E`. Logotipo: "Mar<span>Q</span>Gol" em Barlow
  Condensed 800, Q em coral. Tokens em `ui.css`; não redefina `--marca` local.
- Nenhuma tela de operação usa `alert()`/`confirm()`: use `avisar()`,
  `confirmar()` (Promise) e `toast()` de `ui.js`. Destrutivo de verdade (zerar
  tudo) é `data-segurar` (evento `segurado`).

### Controle (`public/controle/controle.html`)
- Na interface o nome é **Controle**, nunca "Mesa" (pedido do usuário). Nomes
  internos antigos (`.mesa`, `renderMesa`) podem ficar.
- Feita para **tablet** (paisagem; funciona em pé). CSS próprio, **sem Tailwind**,
  tema escuro fixo. Três abas no hash: `#preparar` (jogos da agenda + checklist + Agendar),
  `#controle` (o antigo `#mesa` ainda funciona), `#telao` (cenas placar/slides/espera, comerciais, slides). Sem hash e
  sem jogo carregado, abre em Preparar. "Ir para o controle"
  pergunta se põe o jogo no telão quando a transmissão está desligada.
- O que muda por esporte vive no objeto `ESPORTES` no topo do script
  (`botoes` com valor/rótulo, `verbo`, `faltas`/`avisoFalta`, `periodo`/`periodos`,
  `sets`, `parciais`, `crono`, `presets`). Para um esporte novo ou regra de UI por
  esporte, edite ali — **não** duplique a página.
- Layout por frequência de uso: relógio no topo (toque = play/pause), botão de
  ponto ocupando o painel, rodapé com **último lance + Desfazer** e a ação do
  momento (fechar set / próximo período); o resto atrás de **Mais**.
- **Desfazer não tem prazo** (pedido explícito do usuário — não volte a um
  "desfazer por 5 s"). Age só sobre o último lance não estornado e só acende se
  ele for `estornavel`; nunca pula para um lance mais antigo. Ponto/falta →
  `estornar_lance`; set → `reabrir_set`. Lances antigos: gaveta **Lances**.
- Ações destrutivas no Mais (zerar, zerar faltas, encerrar jogo) são de
  **segurar 1,2 s** (`data-segurar`). A tela não usa `alert()`/`confirm()`:
  avisos abrem uma folha (`avisar()`), retornos rápidos usam `toast()`.
- Cores dos times são **variáveis CSS** (`.tema-azul`/`.tema-vermelho`, via
  `aplicarTemas()` em `[data-lado]`), para a cor seguir o time ao inverter lados.
  Não use cores fixas nos painéis.
- Inverter lados e modo rápido são só do aparelho (`localStorage`), nunca do
  servidor/telão.
- Folha de jogador: "Marcar sem jogador" marca sem creditar; "Cancelar"/Esc/toque
  fora não envia nada e limpa `pendente`.

### Telão (`public/index.html` + `public/style.css`)
- **Escala uniforme 2:1**: `.placar-container` com `width: min(100vw, 200vh)`;
  tudo dentro em `%`/`cqw`. Não estique nem use `cover`. Sobra pintada com
  `--borda-arte-topo/-base/-lados` (topo do `style.css`); o vídeo de espera usa
  `.preenche-sobra`. **Se a arte mudar, remeça essas bordas.**
- Qualquer coisa sobre o placar mede em `cqw`; `vh`/`vw` só para tela cheia real
  (standby, slides, comerciais, vídeo do jogador).
- Carrossel de patrocinadores: faixa escura da arte começa em **88,87 %** (y=455/512,
  igual nos 3 esportes) — é o `top` de `.sponsor-carousel-container`. Não suba.
  Medidas em `cqw`. Assinatura da lista evita reconstruir o DOM a cada broadcast.
- Faixa de ponto (`#anim-overlay`, z 40) mostra **todos** os patrocinadores
  (`montarPatrocinadoresAnim`); um único keyframe de 5 s. Faixa de parcial
  (`#set-overlay`, z 41), 9 s. Vídeo do jogador (`#anim-video-overlay`, z 88) só
  em ponto, nunca em falta.
- **Basquete: tempo e placar nunca somem.** Com faixa/vídeo em cena,
  `manterJogoVisivel()` (laço de 50 ms) troca para `#tempo-flutuante` e
  `#placar-flutuante` (que repete o relógio no centro, `#pf-tempo` — o tempo fica
  em cima **e** embaixo); `atualizarPlacarFlutuante()` roda a cada `atualizar_tela`.
  Não vale para futsal/vôlei; comerciais/slides/standby cobrem tudo de propósito.
- Vídeo de espera: slot `espera` da arte do cliente (`base/espera.mp4`), em
  `videoStandby`. `aplicarStandby()` só troca `src` quando o nome muda e pausa
  durante a transmissão. Sem vídeo → cartão `#standby-texto` com o nome do cliente.
- Bordas da arte (`--borda-arte-*`): o padrão casa com `public/arte-padrao`; arte
  de cliente manda as dela em `arte.bordas` e `aplicarArte()` sobrescreve.
- Tela cheia pedida no primeiro gesto (uma vez); depois duplo-clique alterna.
  `resize` com debounce re-roda `ajustarNome()`.
- Autoplay: vídeos começam mudos se preciso (`tocarSemGesto`), som liga quando
  permitido; aviso "🔇 Som bloqueado" até um clique.
- Basquete ainda não exibe parciais: para ligar, `extraAreas: [areaFault, areaParciais]`
  em `sportConfig.basquete` (index.html) e `parciais: true` em `ESPORTES` (controle.html).

### Arquivos e uploads
- Tudo do cliente fica em `DATA_DIR/clientes/<id>/` (volume `dados` em produção):
  `videos/`, `slides/`, `patrocinadores/`, `arte/`, `fotos/`, `videos-jogador/`.
- `POST /api/midia/:tipo?nome=` / `DELETE /api/midia/:tipo/:nome` (`video |
  patrocinador | slide`), corpo cru gravado por stream; cota do plano conferida
  pelo `Content-Length` e durante a gravação (413). Nome por `sanitizarNomeArquivo()`.
- Fotos/logos/vídeo de jogador: `POST /api/app/arquivos/foto|video-jogador`
  (nome aleatório) → URL `/arquivos/<cliente>/...`, vista por usuário ou TV do cliente.
- O telão lê a mídia por caminho **relativo** (`videos/x.mp4` sob `/p/<id>/`).
  Não use caminho absoluto nessas páginas.
- Estáticos `.html/.css/.js` saem com `Cache-Control: no-cache` (telão fica dias
  aberto e precisa pegar deploys).
- `comando_video` (com `loop`) é repasse puro para `executar_video`; slides têm
  estado no estado do placar (telão que reconecta sincroniza).

## Limitações conhecidas

Um processo só (estado dos placares em memória + Postgres; sem Redis); se a
internet do ginásio cair, o telão congela no último estado (há faixa "sem
conexão"); arquivos dos clientes em disco (sem S3); o backup diário cobre só o
banco; importar planilha e PDF dependem de CDN (SheetJS, pdf.js); bloco de
`clockOffset` repetido no telão, controle e placar neutro.

## Convenções

- Código, comentários, mensagens de commit e UI em **português**.
- Comentários explicam o **porquê** (há muitos — leia-os antes de alterar um trecho).
- Testes com `node:test` + `node:assert/strict`; injete `now` e `fetchImpl` em
  vez de mockar módulos. Ponta a ponta: `test/apoio/servidor.js` sobe o app
  inteiro com banco próprio, e-mail em memória e Asaas falso.
- Depois de mudar comportamento visível, rode `npm test` e verifique as telas.



## Deploy: arquitetura da VPS ArtZan (siga ao criar ou alterar o deploy)

Este projeto roda numa VPS compartilhada com outros sites. Cada site fica num subdomínio
próprio de `artzan.tech` e sobe pelo script `site` da VPS (`site novo <repo>` /
`site atualizar <slug>`). Um único Caddy, o "edge" (`/srv/edge`), é dono das portas 80/443,
emite os certificados e encaminha cada subdomínio ao container certo pela rede Docker
externa `edge`. O projeto precisa cumprir o contrato abaixo, que o `site verificar` confere.

### Arquivos obrigatórios no repositório

- `docker-compose.prod.yml`: o compose de produção. O `docker-compose.yml` fica livre para o dev.
- `.env.production.example`: todas as variáveis de produção, com comentários. O `.env` real
  nunca vai para o git.
- `deploy/deploy.conf`: arquivo bash lido pelo script (modelo abaixo).
- `deploy/site.caddy`: os blocos de site do Caddy para este projeto (modelo abaixo).

### Regras do `docker-compose.prod.yml`

- `name: <slug>` no topo. O slug é igual ao `SLUG` do `deploy.conf` e usa só `a-z`, `0-9` e `-`.
  Não mude o slug depois do primeiro deploy: o nome dos volumes depende dele.
- Nenhuma porta publicada para a internet. Nada de `ports:` com `80`, `443` ou `0.0.0.0`; só
  `127.0.0.1:PORTA:PORTA` (para túnel SSH), e mesmo assim comentado por padrão. Porta publicada
  pelo Docker passa por fora do UFW.
- Só os serviços que o Caddy precisa alcançar entram na rede `edge`, sempre com um alias
  único `<slug>-<serviço>`. A rede `edge` é compartilhada por todos os sites; sem o alias,
  dois projetos com um serviço `web` colidiriam no DNS do Docker.

  ```yaml
  services:
    web:
      networks:
        interno:
        edge:
          aliases: [meusite-web]
  networks:
    interno:
    edge:
      external: true
  ```

- Banco, cache, filas e serviços internos ficam só em redes privadas do projeto, nunca na
  `edge`. Se o banco não precisa de internet, use uma rede com `internal: true`.
- Todo serviço de longa duração: `restart: unless-stopped`, `healthcheck`, e log com rotação
  (`driver: json-file`, `max-size: 10m`, `max-file: 3`).
- O `healthcheck` não pode depender das migrations: o script espera os healthchecks
  (`up -d --build --wait`) e só depois roda o `pos_subida`.
- Sem `container_name` (nomes de container são globais na VPS). Serviço com `build:` e
  `image:` usa `image: <slug>/<serviço>`, senão dois projetos com `image: app` se sobrescrevem.
- Toda variável usada no compose existe no `.env.production.example` (mesmo vazia): o
  `site verificar` roda `docker compose config` com um `.env` fictício gerado do exemplo.
- Dados persistentes em volumes nomeados (banco, uploads), nunca dentro da imagem.
- Ferramentas avulsas (migrations, primeira carga) como serviços com `profiles: [tools]`,
  rodados com `docker compose run --rm <serviço>`.
- As URLs públicas saem das variáveis de domínio do `.env` (ex.: `https://${DOMAIN}`), nunca
  fixas no código.
- Não inclua Caddy, Nginx, Traefik nem certbot no projeto: o edge cuida de HTTPS e proxy.

### `deploy/site.caddy`

Contém só blocos de site, sem o bloco global `{ ... }`. O script troca `${VAR}` pelos valores
do `.env` do projeto; só as variáveis que aparecem no arquivo são trocadas (linhas só de
comentário são descartadas). Não use `{$VAR}`: isso é variável de ambiente do container do
Caddy, que não tem o `.env` do projeto. Os upstreams usam o alias da rede `edge`. Snippets
próprios ficam globais no edge: prefixe com `<slug>_`. Dois snippets do edge estão
disponíveis (não os redefina):

- `import seguranca`: HSTS, `nosniff`, `Referrer-Policy`, remove `Server` e `X-Powered-By`.
- `import ip_real` (dentro de `reverse_proxy`): sobrescreve `X-Forwarded-For` e `X-Real-IP`
  com um único IP, o do visitante, já resolvido inclusive atrás da Cloudflare.

```caddy
${DOMAIN} {
	encode zstd gzip
	import seguranca
	reverse_proxy meusite-web:3000 {
		import ip_real
	}
}
```

### `deploy/deploy.conf`

```bash
SLUG="meusite"                          # = name: do compose
DOMAIN_VARS="DOMAIN"                    # variáveis do .env com os subdomínios públicos
REQUIRED_VARS="DOMAIN DB_PASSWORD"      # o script não sobe se alguma estiver vazia
SECRET_VARS="DB_PASSWORD APP_SECRET"    # vazias: o script gera com `openssl rand -hex 32`
HEALTH_URLS='https://${DOMAIN}/api/health'  # conferidas depois de subir (aspas simples)
# Opcionais:
# COMPOSE_FILE="docker-compose.prod.yml"
# ENV_EXAMPLE=".env.production.example"
# BACKUP_CMD="scripts/backup-db.sh"     # vai para o cron do root
# BACKUP_CRON="0 3 * * *"

# Ganchos opcionais: rodam num bash novo com `set -euo pipefail`, na pasta do projeto, depois
# do `up -d --build --wait`, com COMPOSE_FILE exportado (o `docker compose` puro já usa o de
# produção). Um erro interrompe o deploy. primeira_vez roda uma vez e grava .site/instalado
# (ignorado pelo git); se os volumes do projeto já existirem, o script pergunta antes.
# Os ganchos são lidos com `source`: no nível do arquivo, só atribuições.
primeira_vez() {   # só no primeiro deploy
  docker compose run --rm setup
}
pos_subida() {     # em todo deploy e atualização
  docker compose run --rm migrate
}
```

### Regras da aplicação

- Escuta em `0.0.0.0` numa porta interna. O app não faz TLS: o HTTPS termina no edge.
- Tem uma rota de saúde barata (`/api/health` ou `/health`), sem autenticação. É a mesma que
  o `healthcheck` do compose e o `HEALTH_URLS` usam. O script confere `HEALTH_URLS` direto
  no edge da própria VPS (sem depender do DNS) e espera HTTP 2xx/3xx.
- Atrás do proxy, o IP do visitante vem de `X-Forwarded-For` (um único valor, já tratado pelo
  edge) ou `X-Real-IP`. Rate limit e log de IP leem desses headers.
- Segredos gerados em hex (`openssl rand -hex 32`), porque `@ / : #` quebram URLs de conexão.
  No `.env` do Compose, valores com `$` vão entre aspas simples (`'$abc'`), senão o `$` vira
  variável.
- Build e start não podem depender de outro site da VPS. Se precisar de outro serviço da VPS,
  use a URL pública dele.

### Subdomínio

- Cada site tem seu subdomínio, no formato `<nome>.artzan.tech`. Se tiver API ou painel em
  host separado, use `<nome>-api.artzan.tech` ou `painel-<nome>.artzan.tech`. Só um nível:
  o SSL gratuito da Cloudflare cobre `*.artzan.tech`, mas não `*.<nome>.artzan.tech`.
- O domínio raiz `artzan.tech` (e `www.artzan.tech`) é reservado à landing page da ArtZan.
- DNS na Hostinger (hPanel → Domínios → artzan.tech → DNS): registro A com o nome do
  subdomínio apontando para o IP da VPS, TTL 300 (para o raiz, o nome é `@`). Não crie AAAA.
