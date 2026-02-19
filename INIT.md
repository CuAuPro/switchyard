# Switchyard Initialization Guide

Run this once before bringing up the full docker-compose stack to ensure dependencies are installed, the database is migrated/seeded, and the Caddy router is generated.

## Quick Start
```bash
cd scripts
./init-local.sh
```

This script performs:
1. `npm install` inside `backend/`, `frontend/`, and `sample-app/`.
2. `npx prisma migrate deploy` (falls back to `migrate dev` on first run).
3. `npm run seed` to create the admin user.
4. `npm run caddyfile` to emit the latest Caddyfile preview and push it via the admin API if configured.
5. `docker build -t switchyard-sample ./sample-app` (if Docker CLI is detected) so the backend can launch sample containers automatically.

Once it finishes (intended for local development), start the whole stack:
```powershell
docker compose up --build
```

## Notes
- Run the script from Git Bash/WSL on Windows or any POSIX shell (macOS/Linux). For PowerShell-only environments, mirror the steps manually.
- Re-run the script whenever you pull new migrations or want a fresh seed.
- Feel free to edit `scripts/init-local.sh` if your environment requires extra setup steps.
