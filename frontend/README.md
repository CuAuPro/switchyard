# Switchyard Frontend

Switchyard frontend is an Angular dashboard for operating slot-based deployments.

## Tech Stack
- Angular 21 (standalone)
- RxJS
- Generated API client from backend OpenAPI spec

## Responsibilities
- Authentication and session restore
- Service registration and metadata editing
- Slot operations (start/stop/switch)
- Realtime state updates via WebSocket
- Activity and health visibility

## Local Development
```bash
cd frontend
pnpm install
pnpm start
```

App URL:
- `http://localhost:4200`

## API Base Resolution
Runtime API/WebSocket behavior:
- on `localhost:4200` / `127.0.0.1:4200` -> uses backend at `:4201`
- otherwise -> same-origin (`/api`, `/ws`) so Caddy/reverse proxy handles routing

This keeps local Angular dev simple while working cleanly behind `console.<domain>:<caddy-port>`.

## Frontend Runtime Config Reference
The frontend can run with zero extra config in most setups. These are the runtime knobs:

| Variable / Source | Required | Default Behavior | Description |
| --- | --- | --- | --- |
| Browser location (`window.location`) | Yes | used automatically | Determines whether app uses local-dev direct backend (`:4201`) or same-origin API routing. |
| `SWITCHYARD_API_BASE` (container env) | No | empty | Compose-level override for API base if your runtime injects it into the page bootstrap config. |
| `SWITCHYARD_WS_BASE` (container env) | No | empty | Compose-level override for WebSocket base if your runtime injects it into bootstrap config. |
| `window.__SWITCHYARD_API_BASE__` | No | unset | Explicit browser global override for API base URL. |
| `window.__SWITCHYARD_WS_BASE__` | No | unset | Explicit browser global override for WebSocket base URL. |

Notes:
- In Docker/Caddy mode, keep overrides empty and use same-origin routing through Caddy.
- In pure local Angular dev (`pnpm start`), the app auto-targets `http://localhost:4201` and `ws://localhost:4201/ws`.
- If you host frontend behind a different gateway, set API/WS overrides to that gateway origin.

## Scripts
- `pnpm start` - Angular dev server
- `pnpm run build` - production build
- `pnpm run watch` - build watch mode
- `pnpm test` - Karma/Jasmine tests
- `pnpm run swagger:generate` - regenerate typed API client

## OpenAPI Client Workflow
When backend API schemas change:
1. `cd backend && pnpm run swagger:generate`
2. `cd frontend && pnpm run swagger:generate`
3. update UI code only if model shapes changed
4. run `pnpm test -- --watch=false` and `pnpm run build`

## Key Areas
- `src/app/core/config/app-env.ts` - runtime API/WS base resolution
- `src/app/core/services/*` - auth, API, realtime services
- `src/app/pages/dashboard/*` - operator UI
- `src/app/pages/login/*` - login flow
- `src/app/rest-api/*` - generated OpenAPI client

## UI Semantics
- `Slot A` and `Slot B` are stable slot identities.
- `PROD` / `STAGING` badges reflect traffic role (active vs non-active), not permanent environment names.
