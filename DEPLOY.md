# Deployment (Render — free)

The whole app is **one Node process** (`server/index.js`) that serves the built client
(`dist/`), the `POST /session` endpoint, and the `/ws` WebSocket relay — all on one port.
There is no database; **all session state is in memory**.

Because state is in memory and not shared between instances, this **must run as a single
instance** (`numInstances: 1` in `render.yaml`). Never scale to 2+ — players in the same room
could land on different instances and not see each other.

## Deploy with the Blueprint (recommended)

1. Push this repo to GitHub (Render deploys from a Git repo).
2. In the [Render dashboard](https://dashboard.render.com): **New → Blueprint**, pick this repo.
   Render reads `render.yaml` and creates one free Docker web service.
3. Click **Apply**. Render builds the `Dockerfile` (multi-stage: `vite build` → runtime image)
   and gives you a `https://<name>.onrender.com` URL. HTTPS and WebSocket (`wss://`) are routed
   automatically — no extra config needed.

Subsequent pushes to the default branch auto-deploy (`autoDeploy: true`).

### Or set it up manually (no Blueprint)
**New → Web Service** → connect the repo → **Runtime: Docker** → **Instance type: Free** →
Health check path `/`. Render uses the `Dockerfile` automatically.

## Verify

Open the `onrender.com` URL in two browsers/devices: create a session in one, join from the
other, start any mode, and confirm play syncs. In DevTools → Network → WS you should see a
`101` upgrade. Render's **Logs** tab should show `[server] listening on http://0.0.0.0:3001`.

## Important: free-tier behaviour

- **Spin-down:** a free service sleeps after ~15 min with no traffic. The **first** request
  after that takes ~50s to wake (cold start), then it's instant. Fine for a casual game — just
  warn the first player they may wait a few seconds.
- **Sessions reset** on every spin-down and on every deploy. This is expected — there's nothing
  to persist; players just re-create the room.
- **Conquest world map** (`/world*`, `server/world-state.json`) is dead code (not wired into the
  client router) and isn't persisted. If revived, it'd need a persistent disk (a paid Render
  feature) or an external store.

## Local container parity check (optional, before deploying)

Builds and runs the exact production image locally:

```bash
docker build -t game .
docker run --rm -p 3001:3001 game
# then open http://localhost:3001
```
