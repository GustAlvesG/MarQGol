# MarQGol 🏀⚽🏐

Placar eletrônico em tempo real **como serviço** para **futsal, basquete e vôlei**:
telão em qualquer TV (pareada por código), controle no tablet, agenda de jogos
com súmula, times e jogadores, comerciais, slides e patrocinadores — para vários
clientes, cada um com seus placares (quadras), usuários, arte e plano.

`https://marqgol.artzan.tech` · branch `saas` (o sistema original do Clube dos
Funcionários fica no branch `cfcsn`).

## Documentação

- 📋 **[Planejamento do SaaS](docs/saas/planejamento.md)** — decisões de produto e fases
- 🏗️ **[Arquitetura do SaaS](docs/saas/arquitetura.md)** — banco, rotas, autenticação, cobrança, deploy
- 📘 **[Manual do Usuário](docs/manual-do-usuario.md)** — para clientes e operadores
- 🛠️ **[Documentação Técnica](docs/documentacao-tecnica.md)** — regra de jogo, socket, telão, telas
- 🤖 **[CLAUDE.md](CLAUDE.md)** — guia para agentes Claude

## Tecnologias

Node.js 22+ · Express 5 · Socket.IO 4 · PostgreSQL · HTML/CSS/JavaScript puro
(sem build) · Asaas (cobrança) · testes com `node:test`.

## Desenvolvimento

```bash
npm install
cp .env.example .env
npm run db      # terminal 1: Postgres embutido (porta 5433), sem Docker
npm run dev     # terminal 2: http://localhost:4000 (migra e cria o superadmin do .env)
npm test        # Postgres descartável + todos os testes
```

## Produção

Docker na VPS ArtZan, atrás do Caddy "edge": `docker-compose.prod.yml`,
`deploy/` e `.env.production.example`. Passo a passo na
[arquitetura](docs/saas/arquitetura.md#7-deploy-vps-artzan).
