#!/usr/bin/env bash
set -euo pipefail
if [[ -z "${BASH_VERSION:-}" ]]; then
  echo "❌ Please run with bash: bash scripts/init.sh"
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

COMPOSE_BIN="${COMPOSE_BIN:-docker compose}"
COMPOSE_FILE_FLAG=()
if [[ -n "${COMPOSE_FILE:-}" ]]; then
  COMPOSE_FILE_FLAG=(-f "$COMPOSE_FILE")
elif [[ -f "docker-compose.yml" ]]; then
  COMPOSE_FILE_FLAG=(-f docker-compose.yml)
fi

compose() {
  ${COMPOSE_BIN} "${COMPOSE_FILE_FLAG[@]}" "$@"
}

echo "▶ Preparing local bind-mount paths"
mkdir -p backend caddy/config caddy/data
if [[ -d backend/switchyard.db ]]; then
  echo "❌ backend/switchyard.db is a directory. Remove it and rerun."
  exit 1
fi
touch backend/switchyard.db

echo "▶ Running Prisma migrations inside backend container"
compose run --rm --entrypoint /bin/sh backend -lc '\
if [ -x ./node_modules/.bin/prisma ]; then \
  ./node_modules/.bin/prisma migrate deploy; \
else \
  echo "❌ Prisma CLI not found in backend image."; \
  echo "   Rebuild/pull backend image with prisma included."; \
  exit 1; \
fi'

echo "▶ Seeding admin user (idempotent)"
compose run --rm --entrypoint node backend dist/utils/seed.js

echo "▶ Ensuring Caddy admin endpoint is running"
compose up -d caddy

echo "▶ Regenerating/pushing Caddy router config"
if ! compose run --rm --entrypoint node backend dist/scripts/generateCaddyfile.js; then
  cat <<'WARN'
⚠️  Failed to push router config via Caddy admin API.
    Ensure the caddy service is running (e.g., `docker compose up -d caddy`)
    and rerun:
      docker compose run --rm --entrypoint node backend dist/scripts/generateCaddyfile.js
WARN
fi

if [[ ${#COMPOSE_FILE_FLAG[@]} -gt 0 ]]; then
  echo "✅ Done. Bring the stack online with '${COMPOSE_BIN} ${COMPOSE_FILE_FLAG[*]} up -d'."
else
  echo "✅ Done. Bring the stack online with '${COMPOSE_BIN} up -d'."
fi
