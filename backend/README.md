# Switchyard Backend

TypeScript/Express API that orchestrates staging -> prod deployments, persists state via Prisma, streams events over WebSockets, and regenerates the Caddy router on demand.

## Prerequisites
- Node.js 22+
- Docker (only if you want Postgres locally or plan to run the compose stack)
- Docker CLI on your PATH if you enable `DOCKER_AUTOSTART=true`

### Database Options
- **Default dev**: SQLite (`DATABASE_URL="file:./dev.db"`) - no Docker required.
- **Postgres**: set `DATABASE_URL="postgresql://user:pass@host:5432/db?schema=public"` and update `datasource db { provider = "postgresql" }` inside `prisma/schema.prisma`. After switching, rerun `pnpm exec prisma migrate deploy` and `pnpm run prisma:generate`.
- The backend automatically selects the correct Prisma driver adapter (better-sqlite3 vs. pg) based on `DATABASE_URL`.
- Prisma CLI reads connection strings from `prisma.config.ts`, so updating `.env` is enough for both runtime and migrations.

## Getting Started
### Choose an env file
Two ready-to-copy presets live alongside this README:

| File | Use case | Key differences |
| --- | --- | --- |
| `.env.host.example` | Running the backend directly on your host (outside Docker). | Talks to the Caddy admin API via `http://localhost:2019`, disables container-based health probes, and uses host loopback ports for health checks. |
| `.env.docker.example` | Running the backend inside Docker Compose. | Points at `http://caddy:2019`, keeps `ROUTER_TARGET_HOST=http://host.docker.internal`, and plays nicely with compose networking. |

For host development:
```bash
cd backend
cp .env.host.example .env
```

For Compose/containers:
```bash
cd backend
cp .env.docker.example .env.docker
```
`docker-compose.dev.yml` automatically loads `backend/.env.docker`, so keep both files side-by-side if you switch between workflows.

### Install & run
```bash
cd backend
pnpm install
pnpm exec prisma migrate dev --name init   # or pull existing migrations
pnpm run seed
pnpm run dev          # tsx watch src/server.ts (ESM)
```
API runs at `http://localhost:4201`, WebSockets at `/ws`, Swagger UI at `/docs`. The server always listens on port `4201`; expose/remap it via Docker or reverse proxies if you need a different public port.

## PNPM Scripts
| Script | Description |
| --- | --- |
| `pnpm run clean` / `clean:all` | Remove `dist` (and optionally `node_modules`). |
| `pnpm run dev` | Run `tsx watch src/server.ts`. |
| `pnpm run build` | Compile with `tsconfig.build.json` (no maps/declarations). |
| `pnpm run typecheck` | Execute `tsc --noEmit`. |
| `pnpm run lint` / `lint:fix` | ESLint flat config + Prettier. |
| `pnpm run format` / `format:check` | Prettier 3 formatting. |
| `pnpm run test` / `test:watch` | Jest (ts-jest ESM). |
| `pnpm run prisma:generate` | `prisma generate`. |
| `pnpm run prisma:migrate` | `prisma migrate dev`. |
| `pnpm run swagger:generate` | Produce `openapi/swagger.(json|yaml)`. |
| `pnpm run caddyfile` | Push a freshly generated config to the running Caddy admin API. |
| `pnpm run seed` | Seed admin user + sample service. |

## Schema Changes (Prisma)
1. Edit `prisma/schema.prisma`.
2. Run `pnpm exec prisma migrate dev --name <change>` to create/apply a migration.
3. Run `pnpm run prisma:generate` so `@prisma/client` picks up the update.
4. Update services that touch the new fields (e.g., `src/services/serviceRegistry.ts`).

## API Contracts & Swagger
- Request/response schemas live in `src/utils/validators.ts` (Zod). Keep these aligned with the Prisma models.
- OpenAPI wiring is in `src/openapi/*`. After editing validators, run `pnpm run swagger:generate` to refresh `/docs` and `openapi/swagger.yaml`.
- Auth endpoints:
  - `POST /api/auth/login` – returns `{ token, role, name }`.
  - `GET /api/auth/me` – requires `Authorization: Bearer <token>` and returns the authenticated user profile. Frontend calls this on load to restore the dashboard session.

### Service Registration Payloads
- `POST /api/services` expects both `staging` and `prod` entries inside `environments`.
- Each entry must provide a `label` and `dockerImage`, plus an optional `appPort` (defaults to `4000`). Switchyard picks a free host port for every slot, stores it in the environment metadata, and regenerates the Caddyfile using `ROUTER_TARGET_HOST`.
- When `DOCKER_AUTOSTART=true`, the backend issues `docker rm -f` + `docker run -d --name switchyard-<service>-<env> -p <hostPort>:<appPort> -e APP_PORT=<appPort>` so both slots are running immediately after registration/update.
- `healthEndpoint` can be supplied as an absolute `http(s)` URL or as a relative path such as `/healthz`. Relative paths are automatically combined with the host:port that Switchyard reserved for each slot so the health monitor probes the correct instance.

### Docker Autostart & networking
- `.env` exposes `DOCKER_AUTOSTART` (default `true`). Set it to `false` to disable automatic container management (useful in CI).
- When autostart is enabled inside Docker, the backend container must have access to the host Docker daemon. The default compose files mount `/var/run/docker.sock` and the runtime image includes `docker-cli` so Switchyard can run `docker run ...`. **Treat this as root access to the host**; only enable it on trusted infrastructure.
- `DOCKER_NETWORK` lets you attach spawned containers to a specific Docker network (e.g., the `switchyard-net` declared in `docker-compose.yml`) instead of NAT’ing through the host. The init script auto-creates `switchyard-net`, and every workload container joins it so Caddy can resolve names like `switchyard-demo-prod`.
- The default `docker-compose.yml` mounts `./caddy/Caddyfile.generated` into `/etc/caddy/Caddyfile` (plus `./caddy/{data,config}` for TLS state). Switchyard only talks to Caddy via the admin API, so whatever Caddy is running is reflected in that mounted file without the backend touching it.
- Build the reference workload once via `docker build -t switchyard-sample ./sample-app`, then use `switchyard-sample:latest` as the docker image when registering your first service through the dashboard or API.
- `ROUTER_TARGET_HOST` tells Switchyard which host to use when it needs to reach a container via its published host port (e.g., when the backend runs directly on your laptop and can’t resolve Docker DNS). When you run everything inside Docker, this value matters only as a fallback because Caddy and health checks talk to containers by name.
- Health checks automatically try the container target first and then fall back to `${ROUTER_TARGET_HOST}:<reserved host port>` if the container DNS lookup fails. Control this behavior via `HEALTH_USE_CONTAINER_TARGETS` (set it to `false` on host-only setups where Docker DNS isn’t available).
- `ROUTER_DOMAIN` controls the public hostnames that Caddy serves (default `switchyard.localhost`, producing `sample-api.switchyard.localhost` and `staging.sample-api.switchyard.localhost`). Point it at your internal DNS zone if you own one.
- Caddy always proxies to `http://<containerName>:<appPort>` when metadata contains those fields, so routing stays stable even if host-port fallbacks are enabled for health checking.
- `PORT_RANGE_START`/`PORT_RANGE_END` define the inclusive host-port range Switchyard scans when assigning staging/prod host ports.

## Service Scope
- Switchyard currently manages a single service pair (staging + prod). Calling `POST /api/services` creates the initial pair if none exists or overwrites the existing pair; additional pairs are blocked for now to keep the workflow simple.

## Routing Automation (Caddy)
- `src/lib/caddyfile.ts` emits router configs for both staging and prod subdomains:
  - `staging.<service>.switchyard.localhost` -> staging slot
  - `<service>.switchyard.localhost` -> active prod slot
- Service registration, deployment switches, and the CLI script all call the generator. Run `pnpm run caddyfile` manually after seeding if you need a fresh file.
- Configs are delivered exclusively via the Caddy admin API (`POST /load?adapter=caddyfile`). Set `CADDY_ADMIN_URL` to the admin endpoint inside your compose network (e.g., `http://caddy:2019`). Mount `/etc/caddy` from the container if you want to keep a host-side view of whatever Caddy is currently running.

## Deployment Workflow Guidelines
1. Deploy Docker images to the staging slot (`/services/:id/deployments`). The backend currently logs `STARTING DOCKER IMAGE: ...` as a placeholder for the future Docker SDK.
2. Validate the staging endpoint.
3. Promote staging to prod with `/services/:id/switch` (or the UI). Rolling back simply switches traffic back to the other slot.

## Container Lifecycle Controls
- `POST /services/:id/environments/:label/start` / `stop` – launch or tear down the Docker container that backs a slot. Both operations are always available, but switching traffic to a stopped slot is rejected, so plan your cutovers accordingly.
- `PATCH /services/:id` – edit service metadata and individual environment settings (Docker image + `APP_PORT`). Switching the internal `APP_PORT` requires the slot to be stopped first so host-port mappings remain accurate.
- `DELETE /services/:id` – removes the service pair entirely, stopping both containers and regenerating the Caddy config so the corresponding hostnames disappear.
- Service-level metadata (description, repository URL, health endpoint) can only be edited when **both** staging and prod containers are stopped. This keeps the health monitor, router, and operators aligned on which build is live.

## Directory Highlights
- `src/services/serviceRegistry.ts` – core business logic (registration, deploy, switch, health checks).
- `src/jobs/healthMonitor.ts` – periodic health polling + automatic failover.
- `src/scripts/generateCaddyfile.ts` – CLI entry for router regeneration.
- `src/tests/` – Jest specs (config in `jest.config.ts`).

