#!/usr/bin/env bash
# Backup diário do Postgres do MarQGol (cron do root, via deploy.conf).
# Guarda os últimos 14 dumps em backups/ na pasta do projeto.
# Os arquivos dos clientes (volume `dados`) NÃO entram aqui: são grandes;
# faça snapshot do volume/VPS para eles.
set -euo pipefail
cd "$(dirname "$0")/.."
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
mkdir -p backups
arquivo="backups/marqgol-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U marqgol -d marqgol --no-owner | gzip > "$arquivo"
ls -1t backups/marqgol-*.sql.gz | tail -n +15 | xargs -r rm --
echo "Backup gravado: $arquivo"
