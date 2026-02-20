# Switchyard

Switchyard is a reference blue/green deployment control plane: a Node.js API with Angular console, Prisma/Postgres persistence, Docker-based app orchestration, and Caddy-managed routing (staging + prod hostnames).

![Switchyard Dashboard](images/user-interface.jpeg)

## Production Quickstart (Docker Compose)
Use Docker only—no need to install Node or build the sample workload.

1. **Create a workspace and pull the compose artifacts**
   ```bash
   mkdir switchyard && cd switchyard
   curl -LO https://raw.githubusercontent.com/<your-org>/switchyard/main/docker-compose.yml
   curl -LO https://raw.githubusercontent.com/<your-org>/switchyard/main/.env.example
   mkdir -p scripts
   curl -L https://raw.githubusercontent.com/<your-org>/switchyard/main/scripts/init.sh -o scripts/init.sh
   chmod +x scripts/init.sh
   cp .env.example .env
   ```
   Update `.env` once copied:
   - `JWT_SECRET` – random string for API tokens.
   - `ROUTER_DOMAIN` – default `switchyard.localhost` works for local testing because `*.localhost` resolves to `127.0.0.1`.
   - `CONSOLE_TARGET_ORIGIN` – leave as `http://frontend:80` unless you change the frontend container.

2. **Prime the database/router using containers (no pnpm install required)**
   ```bash
   ./scripts/init.sh
   ```
   On Windows PowerShell (preinstalled), run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\init.ps1
   ```
   This runs `docker compose run --rm backend ...` to apply Prisma migrations, seed the admin user, and bring up Caddy just long enough to push the router config through its admin API.

3. **Start the stack**
   ```bash
   docker compose pull
   docker compose up -d
   ```

4. **Log in and create your first service**
   - Console: `http://console.switchyard.localhost:8080` (or your `ROUTER_CONSOLE_SUBDOMAIN.ROUTER_DOMAIN`).
   - API: `http://localhost:4201`.
   - Default admin user (created by migrations/seed): `admin@switchyard.dev / Switchyard!123`.

That’s it—you can now register a service (Docker image + container `APP_PORT`), deploy to staging, and switch prod traffic between the two slots. Caddy automatically exposes:
- `staging.<service>.switchyard.localhost` → staging slot
- `<service>.switchyard.localhost` → whichever slot is active

Need to refresh the router or DB later? Re-run `docker compose exec backend pnpm run caddyfile` or `pnpm run seed` inside the backend container as required.

## Local Development Bootstrap
If you plan to hack on the repo (compile TypeScript, run Jest, etc.), use the helper script that now lives at `scripts/init-local.sh`:

```bash
cd scripts
./init-local.sh
```

It handles everything the compose stack doesn’t:
1. Installs dependencies in `backend/`, `frontend/`, and `sample-app/`.
2. Applies Prisma migrations (deploy → dev fallback) and seeds the admin user.
3. Runs `pnpm run caddyfile` for preview/testing.
4. Builds the sample workload (`switchyard-sample:latest`) when Docker CLI is present so autostarted containers have an image to run.
5. Ensures the `switchyard-net` Docker network exists for local Docker workflows.

Use this script only on dev machines—it isn’t required when you deploy the compose stack directly on a server.

## Need more detail?
- Backend internals, schema changes, and API contracts: `backend/README.md`.
- Frontend development workflow: `frontend/README.md` (see repo).
- Initialization notes: `INIT.md` (mirrors the `init-local.sh` flow above).
- Building/pushing container images (backend, frontend, sample workload): `scripts/dev/publish-images.sh`.

## Building & Publishing Images
Switchyard’s compose file expects two images: one for the backend API and one for the Angular console. When you’re ready to produce deployable artifacts:

### Build
```bash
# Backend (Node/Express API)
docker build -t your-dockerhub-username/switchyard-backend:latest ./backend

# Frontend (Angular static bundle served via nginx)
docker build -t your-dockerhub-username/switchyard-frontend:latest ./frontend

# Sample workload (optional demo app)
docker build -t your-dockerhub-username/switchyard-sample:latest ./sample-app
```
Adjust the tag names as needed (e.g., `:v1.0.0`). Sample apps are not required for production deployments, so there’s no need to build `sample-app/` unless you plan to use it for demos.

### Publish to Docker Hub
```bash
docker login
docker push your-dockerhub-username/switchyard-backend:latest
docker push your-dockerhub-username/switchyard-frontend:latest
docker push your-dockerhub-username/switchyard-sample:latest  # optional demo

# or use the helper script (accepts backend/frontend/sample-app targets)
scripts/dev/publish-images.sh your-dockerhub-username backend frontend sample-app
scripts/dev/publish-images.ps1 -Registry your-dockerhub-username -Targets backend,frontend,sample-app
```
Set `BACKEND_IMAGE` and `FRONTEND_IMAGE` in your `.env` (or deployment environment) to point at the pushed tags, then rerun `docker compose up -d` to pull them.

Happy shipping!
