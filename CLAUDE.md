# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite (port 5173) + Node server (port 3001) concurrently
npm run build    # Vite build → dist/
npm start        # Serve production build from dist/ on port 3001
```

No test suite exists. No linter is configured.

For external testing with ngrok: `ngrok http 5173`. Vite is configured with `allowedHosts: true` so any tunnel URL works without config changes.

## Deployment

Deployed to Render (free tier) as a single Docker web service (`Dockerfile` + `render.yaml`).
See [DEPLOY.md](DEPLOY.md). Because all session state is in-memory and unshared, the app **must
stay at one instance** (`numInstances: 1`). The Dockerfile runs `vite build` then serves `dist/`
+ `/ws` from `server/index.js`. The server reads `process.env.PORT` (Render injects it). Free
services spin down after ~15 min idle (~50s cold start) and drop in-memory sessions — expected.

## Architecture

Single `package.json` at root. Frontend source lives in `client/src/`, server in `server/`. Vite is configured (`vite.config.js`) with `root: 'client'` and proxies `/session` and `/ws` to the Node server during dev. Production: Node serves the `dist/` static build and handles WebSocket on the same port (3001).

### Multiplayer model

The server holds no game state beyond session metadata. Both clients receive an identical random `seed` and a synchronized `startAt` timestamp at game start. `client/src/game/seededRng.js` (32-bit LCG) ensures both players generate identical enemy spawn patterns from that seed. Only **scores** cross the network (~12×/s, 80ms throttle). This means adding new game mechanics requires no server changes — only the client and the seeded spawn logic.

### Client routing

Hash-based (`#/`, `#/session/:id`, `#/game`, `#/results`). The router lives in `client/src/main.js`. Each screen is a function (`renderLanding`, `renderLobby`, `renderGame`, `renderResults`) that takes the root DOM element and tears itself down on `hashchange`.

### WebSocket message flow

`client/src/net/socket.js` wraps a native `WebSocket` as an `EventTarget`, dispatching a `CustomEvent` per message type. Screens subscribe with `socket.addEventListener(MSG.TYPE, handler)` and clean up on navigation. Message type constants are in `client/src/shared/messages.js`.

Session lifecycle: `join → joined → lobby → begin → [score/opp_score loop] → final/opp_final`.

### Game scene

`client/src/game/MainScene.js` is a Phaser 4 scene. It receives `onScore(totalScore)` and `onEnd(finalScore)` callbacks from `client/src/screens/game.js`. All textures are generated programmatically in `preload()` — no asset files.

### Haptics

`client/src/haptics.js` wraps `buttplug-wasm` (Web Bluetooth, no Intiface Central needed) + `buttplug@3`. The "Connect Vibe" button is in the lobby screen. Vibration is triggered in `game.js` by:
- Score delta going negative (your damage) → `pulse(0.8, 200ms)`
- Opponent score increasing → `pulse(0.5–0.9, 120–300ms)` scaled by delta
- Win/loss at results screen → `winPattern()` / `losePattern()`

Web Bluetooth only works on `localhost` or HTTPS origins. `buttplug-wasm` loads as a lazy Vite chunk (~5MB) only when the user clicks "Connect Vibe".
