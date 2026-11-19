# Documentação do MarQGol

| Documento | Para quem | Conteúdo |
|---|---|---|
| [Planejamento do SaaS](saas/planejamento.md) | dono do produto | decisões, regras de limite, fases |
| [Arquitetura do SaaS](saas/arquitetura.md) | desenvolvedores | banco, rotas, autenticação, pareamento, cobrança Asaas, deploy |
| [Manual do Usuário](manual-do-usuario.md) | clientes e operadores | preparar o telão, configurar o jogo, operar o Controle, regras por esporte, mídia, problemas comuns, roteiro rápido |
| [Documentação Técnica](documentacao-tecnica.md) | desenvolvedores | arquitetura, estado, `gameLogic.js`, `server.js`, contrato Socket.IO, agenda e súmula, frontend, telão, testes, deploy, limitações, receitas de manutenção |
| [CLAUDE.md](../CLAUDE.md) | agentes Claude (Claude Code) | mapa do código, invariantes, armadilhas e convenções para alterar o projeto com segurança |

Visão geral e instalação rápida: [README do projeto](../README.md).

## Mantendo a documentação em dia

- Mudou uma regra de jogo, evento Socket.IO, rota, limite ou cobrança → atualize a
  **Documentação Técnica** (e o `CLAUDE.md`, se for uma invariante listada lá).
- Mudou um botão, rótulo ou fluxo de tela → atualize o **Manual do Usuário**.
- A contagem de testes citada nos documentos sai de `npm test`.
