#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

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

echo "▶ Running Prisma migrations inside backend container"
compose run --rm backend pnpm exec prisma migrate deploy

echo "▶ Seeding admin user (idempotent)"
compose run --rm backend node dist/utils/seed.js

echo "▶ Ensuring Caddy admin endpoint is running"
compose up -d caddy

echo "▶ Regenerating/pushing Caddy router config"
if ! compose run --rm backend node dist/scripts/generateCaddyfile.js; then
  cat <<'WARN'
⚠️  Failed to push router config via Caddy admin API.
    Ensure the caddy service is running (e.g., `docker compose up -d caddy`)
    and rerun:
      docker compose run --rm backend node dist/scripts/generateCaddyfile.js
WARN
fi

if [[ ${#COMPOSE_FILE_FLAG[@]} -gt 0 ]]; then
  echo "✅ Done. Bring the stack online with '${COMPOSE_BIN} ${COMPOSE_FILE_FLAG[*]} up -d'."
else
  echo "✅ Done. Bring the stack online with '${COMPOSE_BIN} up -d'."
fi
