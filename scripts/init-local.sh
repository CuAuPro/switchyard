#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🚀 Switchyard init starting..."

if [ ! -f "$ROOT/backend/.env" ] && [ -f "$ROOT/backend/.env.host.example" ]; then
  echo "🧾 Creating backend/.env from .env.host.example"
  cp "$ROOT/backend/.env.host.example" "$ROOT/backend/.env"
fi

approve_builds_if_interactive() {
  if [ -t 0 ]; then
    pnpm approve-builds || true
  else
    echo "⚠️ Non-interactive shell: skipping 'pnpm approve-builds'"
  fi
}

has_better_sqlite3_native() {
  find node_modules/.pnpm -path "*/better-sqlite3/build/Release/better_sqlite3.node" -print -quit 2>/dev/null | grep -q .
}

if [ -f "$ROOT/backend/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/backend/.env"
  set +a
fi

NETWORK_NAME="${DOCKER_NETWORK:-switchyard-net}"

if command -v docker >/dev/null 2>&1; then
  if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
    echo "🔌 Creating Docker network $NETWORK_NAME"
    docker network create "$NETWORK_NAME"
  else
    echo "🔌 Docker network $NETWORK_NAME already exists"
  fi
else
  echo "⚠️ Docker CLI not found; skipping network creation"
fi

echo "🛠 Installing backend dependencies"
cd "$ROOT/backend"
pnpm install
approve_builds_if_interactive
echo "🔧 Rebuilding backend native/tooling dependencies"
pnpm rebuild better-sqlite3 @prisma/engines prisma
echo "🧬 Regenerating Prisma client"
pnpm exec prisma generate
if ! has_better_sqlite3_native; then
  echo "⚠️ better-sqlite3 native binding missing; forcing backend reinstall/rebuild"
  pnpm install --force
  pnpm rebuild better-sqlite3 @prisma/engines prisma
  pnpm exec prisma generate
fi

echo "🗃 Applying Prisma migrations"
if ! pnpm exec prisma migrate deploy; then
  echo "ℹ️ migrate deploy failed (likely first run), falling back to migrate dev"
  pnpm exec prisma migrate dev --name init
fi

echo "🌱 Seeding database"
pnpm run seed

if command -v docker >/dev/null 2>&1; then
  echo "🧱 Starting caddy service from docker-compose.dev.yml"
  docker compose -f "$ROOT/docker-compose.dev.yml" up -d caddy
else
  echo "⚠️ Docker CLI not found; skipping caddy startup"
fi

echo "🌐 Pushing router config via Caddy admin API"
pnpm run caddyfile

echo "🛠 Installing frontend dependencies"
cd "$ROOT/frontend"
pnpm install
approve_builds_if_interactive

echo "🛠 Installing sample app dependencies"
cd "$ROOT/sample-app"
pnpm install
approve_builds_if_interactive

if command -v docker >/dev/null 2>&1; then
  echo "🧪 Building sample app image (switchyard-sample:latest)"
  docker build -t switchyard-sample .
else
  echo "⚠️ Docker CLI not found; skipping sample image build"
fi

cd "$ROOT"
echo "✅ Init complete. Start docker compose or individual processes when ready."
