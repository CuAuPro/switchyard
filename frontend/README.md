# Switchyard Frontend

Angular 21 standalone dashboard that visualizes a single staging/prod service, shows deployment history, and triggers deploy/switch flows against the backend API.

## Prerequisites
- Node.js 20+ (Angular CLI 21)
- Backend API reachable on port `4201` (the client auto-points to `http://localhost:4201` / `ws://localhost:4201` whenever it detects `localhost` or `127.0.0.1`; otherwise it uses same-origin URLs so reverse proxies can handle routing).

## Getting Started
```bash
cd frontend
npm install
npm start   # ng serve
```
Visit `http://localhost:4200`. Local builds talk directly to `http://localhost:4201` for REST and `ws://localhost:4201/ws` for realtime updates with no extra proxy config.

## NPM Scripts
| Script | Description |
| --- | --- |
| `npm start` | Angular dev server. |
| `npm test` | Karma + Jasmine unit tests (`ng test`). |
| `npm run build` | Production build via Angular CLI. |
| `npm run watch` | Builds in watch/development configuration. |

## Directory Highlights
- `src/app/core/models` - TypeScript interfaces representing backend entities. Update when API schema changes.
- `src/app/core/services` - Auth, API, and realtime (WebSocket) services. All REST calls (login, deployments, switches) live here.
- `src/app/core/config/app-env.ts` - Centralized detection of API/WebSocket base URLs (maps localhost -> port 4201, otherwise same-origin).
- `src/app/pages/dashboard` - Main UI: single service card, staging deploy form (Docker image only, version derived automatically), environment health, switch buttons, plus an empty-state wizard to register the first service by specifying a docker image and container `APP_PORT`.
- `src/app/pages/login` - Sign-in form pointing to `/auth/login` (external HTML template + hero panel).

## Responding to Backend Schema Changes
1. Regenerate the backend spec: `cd backend && npm run swagger:generate`.
2. Refresh the generated Angular client: `cd frontend && npm run swagger:generate`.
3. Update local models/components only if the new responses diverge from what the UI expects.
4. Re-run `npm test -- --watch=false` and `npm run build`.

## Deployment UX Expectations
- Operators deploy Docker images to the staging slot (form only captures `dockerImage`; the backend logs `STARTING DOCKER IMAGE: ...`). During service creation you can also pass optional repository and health endpoint values so the backend starts monitoring immediately.
- When no service exists yet, the dashboard prompts you to enter the name, docker image, and container `APP_PORT`. Switchyard selects host ports automatically, updates Caddy, and (if enabled) spins up containers for each slot.
- When `DOCKER_AUTOSTART=true` on the backend, submitting the form triggers `docker run` for both staging/prod containers so you do not have to start them manually.
- Staging host: `staging.<service>.switchyard.localhost`.
- Prod host: `<service>.switchyard.localhost` (reflects whichever slot is active).
- Switch buttons call `/services/:id/switch` so prod follows staging once validated.

## Testing & Builds
- `npm test -- --watch=false` - run unit specs headlessly.
- `npm run build` - verify production compilation (Angular CLI 21).


