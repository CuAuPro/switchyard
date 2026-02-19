#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🚀 Switchyard init starting..."

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

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
npm install

echo "🗃 Applying Prisma migrations"
if ! npx prisma migrate deploy; then
  echo "ℹ️ migrate deploy failed (likely first run), falling back to migrate dev"
  npx prisma migrate dev --name init
fi

echo "🌱 Seeding database"
npm run seed

echo "🌐 Pushing router config via Caddy admin API"
npm run caddyfile

echo "🛠 Installing frontend dependencies"
cd "$ROOT/frontend"
npm install

echo "🛠 Installing sample app dependencies"
cd "$ROOT/sample-app"
npm install

if command -v docker >/dev/null 2>&1; then
  echo "🧪 Building sample app image (switchyard-sample:latest)"
  docker build -t switchyard-sample .
else
  echo "⚠️ Docker CLI not found; skipping sample image build"
fi

cd "$ROOT"
echo "✅ Init complete. Start docker compose or individual processes when ready."
