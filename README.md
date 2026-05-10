# Galactic Salvage

Two-player Space-Invaders-style web game. Each browser runs the game locally; only scores cross the network. Designed so two friends in different parts of the world can race against the same enemy patterns and watch each other's score climb in real time.

## Run locally

```bash
npm install
npm run dev
```

- Vite dev server: http://localhost:5173
- Node WebSocket server: http://localhost:3001 (proxied from Vite at `/session` and `/ws`)

Open `http://localhost:5173` in two browser windows to test pairing.

## Production build

```bash
npm run build
npm start
```

Now everything is served from the Node server on port 3001.

## Sharing a session with a remote friend

Run the production build, then expose port 3001 with a tunnel:

```bash
# cloudflared (free, no account needed)
cloudflared tunnel --url http://localhost:3001

# or ngrok
ngrok http 3001
```

Share the resulting public URL. Your friend opens the link, joins via the session URL you give them, and you play.

## How the game works

- Player 1 enters their name and creates a session → gets a shareable link.
- Player 2 opens the link, enters their name → both see each other in a lobby.
- Host clicks Start → server picks a random seed → both clients spawn the **same** invader pattern.
- Race to score the most points in 90 seconds. Watch your opponent's score tick up alongside yours.
- Avoid civilian ships (−50 if shot), falling debris (−25 if hit), and decoy powerups (−30 if collected).
- After 90s, totals are compared and a winner is announced.

## Stack

- Backend: Node + Express 5 + ws (WebSockets), in-memory session store
- Frontend: Phaser 4 + Vite (vanilla JS, no framework)
