# Switchyard Backend

Switchyard backend is an Express API that manages slot-based deployments, container lifecycle, health checks, and Caddy router generation.

## Tech Stack
- Node.js 22
- Express 5
- Prisma 7
- SQLite (default) or PostgreSQL
- WebSockets (`/ws`) for realtime events

## Responsibilities
- Register and update one managed service with `slot-a` and `slot-b`.
- Start/stop slot containers via Docker CLI.
- Switch active traffic between slots.
- Generate and push Caddy config through the admin API.
- Emit service/deployment/health events for the UI.

## Runtime Endpoints
- API base: `http://localhost:4201/api`
- Health: `GET /healthz`
- WebSocket: `ws://localhost:4201/ws`
- API docs: `/docs` (enabled only when `ENABLE_API_DOCS=true`)

## Environment Presets
- `backend/.env.host.example`
  - Backend runs on host, Caddy admin at `http://localhost:2019`
- `backend/.env.docker.example`
  - Backend runs in Docker, Caddy admin at `http://caddy:2019`

## Environment Variable Reference
Use `backend/.env.host.example` or `backend/.env.docker.example` as the base.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | `file:./dev.db` | Prisma datasource URL. Supports SQLite (`file:`) and PostgreSQL (`postgresql://...`). |
| `JWT_SECRET` | Yes | `dev-secret-change-me` | Secret used to sign JWT tokens. Set a strong value in non-dev environments. |
| `JWT_EXPIRES_IN` | No | `1h` | JWT TTL (for example `15m`, `1h`, `24h`). |
| `CADDY_ADMIN_URL` | Yes | `http://caddy:2019` | Caddy admin API endpoint used when pushing generated router configs. |
| `ROUTER_DOMAIN` | Yes | `switchyard.localhost` | Base domain for service and console hosts. |
| `ROUTER_CONSOLE_SUBDOMAIN` | Yes | `console` | Console subdomain prefix. Produces `console.<ROUTER_DOMAIN>`. |
| `CONSOLE_TARGET_ORIGIN` | Yes | `http://frontend:80` | Upstream target for console UI traffic inside generated Caddy config. |
| `ROUTER_TARGET_HOST` | Yes | `http://localhost` | Host fallback for host-port targets (when container DNS is unavailable). |
| `DOCKER_AUTOSTART` | No | `true` | If `true`, backend will create/manage workload containers via Docker CLI. |
| `DOCKER_NETWORK` | No | empty | Docker network name for started workload containers (recommended for Caddy DNS routing). |
| `HEALTH_CHECK_INTERVAL_MS` | No | `30000` | Health polling interval in milliseconds. |
| `HEALTH_USE_CONTAINER_TARGETS` | No | auto | If `true`, health checks prefer container DNS target before host-port fallback. |
| `PORT_RANGE_START` | No | `4100` | First host port considered for slot allocation. |
| `PORT_RANGE_END` | No | `4700` | Last host port considered for slot allocation. |
| `ENABLE_API_DOCS` | No | `false` | Enables `/docs` and `/swagger.json` at runtime. |
| `SHADOW_DATABASE_URL` | No | empty | Optional Prisma shadow DB URL for `prisma migrate dev`. |

## Local Run
```bash
cd backend
cp .env.host.example .env
pnpm install
pnpm exec prisma migrate dev --name init
pnpm run seed
pnpm run dev
```

## Docker Runtime Notes
The runtime image is intentionally slim:
- includes `dist/`, production dependencies, and Docker CLI
- excludes Prisma migration files and Prisma CLI

Operational implication:
- run migrations/seed during init or CI/CD before long-running startup
- example:
```bash
docker compose run --rm backend pnpm exec prisma migrate deploy
docker compose run --rm backend pnpm run seed
```

For host Docker control from the backend container, mount:
- `/var/run/docker.sock:/var/run/docker.sock`

And set:
- `DOCKER_AUTOSTART=true`
- `DOCKER_NETWORK=<your-network>`

## Key Env Vars
- `DATABASE_URL`
- `JWT_SECRET`
- `CADDY_ADMIN_URL`
- `ROUTER_DOMAIN`
- `ROUTER_CONSOLE_SUBDOMAIN`
- `ROUTER_TARGET_HOST`
- `DOCKER_AUTOSTART`
- `DOCKER_NETWORK`
- `PORT_RANGE_START` / `PORT_RANGE_END`
- `ENABLE_API_DOCS`

## Routing Behavior
Generated Caddy routes include:
- `slot-a.<service>.<domain>`
- `slot-b.<service>.<domain>`
- `staging.<service>.<domain>` (non-active slot)
- `<service>.<domain>` (active slot)
- `console.<domain>` for UI + API reverse proxy

## PNPM Scripts
- `pnpm run dev` - watch mode
- `pnpm run build` - production compile
- `pnpm run test` - Jest test suite
- `pnpm run prisma:generate` - regenerate Prisma client
- `pnpm run prisma:migrate` - run Prisma migrate dev
- `pnpm run seed` - seed default data
- `pnpm run caddyfile` - regenerate and push Caddy config
- `pnpm run swagger:generate` - rebuild OpenAPI specs

## Directory Highlights
- `src/services/serviceRegistry.ts` - core orchestration logic
- `src/jobs/healthMonitor.ts` - periodic health checks and failover signals
- `src/lib/caddyfile.ts` - Caddy config generation and push
- `src/lib/docker.ts` - Docker command wrapper
- `src/openapi/*` - schema + OpenAPI generation
