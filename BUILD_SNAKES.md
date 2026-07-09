# Build guide — Snakes & Ladders

Implementation handoff for a fresh session. Build the game described in **`SNAKES_AND_LADDERS.md`** (read it first — it's the source of truth for rules; this file is *how* to wire it into the hub). Read **`CLAUDE.md`** too for the architecture and commands.

> Game id `snakes` · route `#/snakes` · 2–3P "Versus" + 1P "Solo" + asymmetric "Watched".

## 0. Orientation (read before coding)

- **Run it:** `npm run dev` → Vite on :5173, Node server on :3001. No build step needed during dev; no tests, no linter. Test by opening **two browser windows** to the Vite URL (one host, one guest); for 3P open three.
- **The model:** the server holds **no game state** — it relays validated messages and ships both clients an identical `seed` + config in a `begin` message. All game logic is client-side and **deterministic from `seed`** via `client/src/game/seededRng.js` (`makeRng`/`rngInt`/`rngPick`). Anything random that must agree on both screens MUST come from the seed, advanced in lockstep.
- **Copy from the closest existing games** — don't invent patterns:
  - `client/src/screens/dice.js` — turn-based rolling, the **intensity slider**, forfeit countdown, 2–3P "who suffers". Closest template for the turn loop.
  - `client/src/game/wizardIslandGame.js` + `screens/wizardisland.js` — **board rendering, roll handshake (`wi_roll_ready`/`wi_roll_go`), powerup/held-spell hand, cooperate/betray, forfeit cards**. Closest template for board + decks.
  - `client/src/screens/beatdealer.js` — **solo (vs computer)** flow and a controller driving the other player's vibe; custom-forfeit textarea parsing.
  - `client/src/screens/hilo1p.js` — the **single-client solo** pattern (no opponent messages, self-vibe).
  - `client/src/haptics.js` — `pulse()`, `setIntensity()` (or equivalent), `winPattern()`/`losePattern()`. Reuse as-is.

## 1. Phasing — build in vertical slices, verify each before moving on

Each phase should leave the game runnable. Don't build all files then debug at the end.

1. **Plumbing skeleton** — lobby tile + minimal config + state fields + route + `begin` wiring + server `validGameTypes`. Goal: select Snakes in the lobby, press Start, land on a blank `#/snakes` screen that logs the received `seed`/config. (No gameplay yet.)
2. **Board + movement (Versus 2P)** — `generateBoard`, render the grid, roll handshake, token movement, snakes/ladders teleport. No stakes yet. Goal: two clients roll in turn and both see identical boards and positions.
3. **Stakes** — tier calc, vibe (slider + haptics) and the forfeit deck/modal on snakes; climber's punish-choice on ladders; Forfeit tiles. Goal: a full 2P game to a winner with vibe **and** forfeits.
4. **Powerups + Fork** — pick-up tiles, the hand UI, each powerup, optional Fork tiles.
5. **3P** — turn rotation, targeting (who-drives-the-slider rule + climber target pick), podium finale.
6. **Solo** and **Watched** modes — branch in `renderSnakes` on `snlMode`/`role`.

## 2. Exact integration points

### `client/src/shared/messages.js`
Add to the `MSG` object (group them, mirror the `WI_*` block style):
```
SNL_ROLL_READY, SNL_ROLL_GO, SNL_MOVE_DONE, SNL_POWERUP,
SNL_FORFEIT_DRAW, SNL_FORFEIT_ACK, SNL_OPP_FORFEIT_ACK, SNL_FORFEIT_ASSIGN,
SNL_COOP_CHOICE, SNL_COOP_REVEAL, SNL_VIBE_CTRL, SNL_VIBE_STOP
```
(values = the lower-case string, e.g. `SNL_ROLL_READY: 'snl_roll_ready'`.)

### `client/src/state.js`
Add fields to `state` **and** reset them in `reset()` (the file keeps the two lists in sync — match that):
```
snlMode: 'versus', snlBoardSize: 'standard', snlDensity: 'even', snlStakeMix: 'mixed',
snlVibeScale: 'full', snlWinCondition: 'race', snlFinalRule: 'exact',
snlPowerups: true, snlCoopBetray: false,
snlForfeitCards: ['vibe','edge','strip','control','task','surrender'],
snlForfeitLines: [], snlAmbient: false, snlTapOut: false,
```
(`forfeitDuration`, `playerCount`, `guest2Name`, `seed`, `startAt` already exist — reuse them. The 3P "who suffers" rule can reuse `diceVibeRule`, which also already exists.)

### `client/src/main.js`
1. `import { renderSnakes } from './screens/snakes.js';` (with the other screen imports).
2. Add a route block (copy the `#/wizardisland` block):
   ```js
   if (hash === '#/snakes') {
     if (!state.seed) { navigate('#/'); return; }
     renderSnakes(app);
     return;
   }
   ```
3. In the `begin` handler, read the config into state (next to the other `state.snl…`/`state.wi…` lines):
   ```js
   state.snlMode = ev.detail.snlMode || 'versus';
   state.snlBoardSize = ev.detail.snlBoardSize || 'standard';
   // …one line per snl* field…
   ```
4. In the routing switch at the bottom of the `begin` handler: `else if (gt === 'snakes') navigate('#/snakes');` — the single screen branches internally on `state.snlMode`/`state.role`, so **no** `#/snakes1p` route is needed.

### `client/src/screens/lobby.js`
This is the biggest edit; follow the existing per-game recipe exactly:
1. **Game tile** — add a `.game-tile-selectable` with `data-game="snakes"` under the **Strategy** `game-category-grid` (copy the Wizard Island tile). Add a `3P` badge span like Hi-Lo's.
2. **Config block** — add a hidden `<div id="snl-config" style="display:none">` with the rows from the spec's *Lobby configuration* table. Reuse existing row markup (`mm-rounds-row` / `mm-rounds-btns`) and the Split-Loot card-toggle markup for forfeit categories; the custom-forfeit textarea can copy `#btd-forfeits-input`.
3. **`selected*` locals** — declare `let selectedSnlMode = 'versus'` etc. at the top with the other `selected…` vars.
4. **`paintOptions()`** — show/hide `#snl-config` when `selectedGame === 'snakes'`; paint each row's selected state and gate buttons with `b.disabled = state.role !== 'host'` (copy any existing block). Hide Fork + the 3P "who suffers" rows unless `selectedSnlMode === 'versus'`; show Ambient/Tap-out only for `solo`/`watched`.
5. **`sendConfig()`** and the **Start** payload — add every `snl*` field (both the `LOBBY_CONFIG` send and the `START` send carry the full set; copy how `wi*`/`lc*` are threaded through both).
6. **`onLobbyConfig`** — read each `snl*` back into the `selected*` locals (copy the `if (ev.detail.wi…)` lines).
7. **Click handlers** — one `addEventListener` per row, host-gated, calling `paintOptions(); sendConfig();` (copy `wiWinBtns` etc.).
8. **Solo gating** — find `_soloGames` (~line 671) and add `'snakes'`. BUT Watched needs exactly 2 connected and Versus needs ≥2, while Solo is host-only — so add a small rule: when `selectedGame === 'snakes'`, treat it as solo-capable only if `selectedSnlMode === 'solo'`; if `watched`/`versus`, require a guest. Adjust the `_canStart`/button-label logic accordingly.

### `server/index.js`
1. **`validGameTypes`** appears **twice** — in the `start` handler (~line 194) and the `lobby_config` handler (~line 267). Add `'snakes'` to **both**.
2. **`begin` broadcast** (~line 232) — validate and append the `snl*` fields. Reuse helpers in the same style:
   ```js
   const snlMode = ['versus','solo','watched'].includes(msg.snlMode) ? msg.snlMode : 'versus';
   const snlBoardSize = ['short','standard','long'].includes(msg.snlBoardSize) ? msg.snlBoardSize : 'standard';
   const snlDensity = ['tame','even','brutal'].includes(msg.snlDensity) ? msg.snlDensity : 'even';
   const snlStakeMix = ['vibe','forfeits','mixed'].includes(msg.snlStakeMix) ? msg.snlStakeMix : 'mixed';
   const snlForfeitCards = Array.isArray(msg.snlForfeitCards) ? msg.snlForfeitCards.filter(c => typeof c==='string').slice(0,8) : [];
   const snlForfeitLines = Array.isArray(msg.snlForfeitLines) ? msg.snlForfeitLines.filter(c => typeof c==='string').map(c=>c.slice(0,200)).slice(0,100) : [];
   // …booleans via !!msg.x; enums via includes() with a default…
   ```
   Then add them to the `broadcast(s, { type:'begin', … })` object.
   - **Note on `playerCount`:** it's derived server-side (~line 211) from guest presence, so it can't distinguish *Watched* (2 connected, 1 climber) from *Versus 2P*. The client must branch on **`snlMode`**, not `playerCount`, for that. No server change needed beyond carrying `snlMode`.
3. **`lobby_config` broadcast** (~line 270) — add the same validated `snl*` fields so the guest's lobby mirrors the host's selection.
4. **Relays** — add a `// ── Snakes & Ladders ──` block of `if (msg.type === 'snl_…')` handlers (copy the `wi_*` / `dice_*` blocks). Rules:
   - `snl_roll_ready` → set a per-role flag; when the active player is ready, broadcast `snl_roll_go` **with a server-incremented `turnIndex`** so a client can't choose its own roll.
   - `snl_vibe_ctrl` → clamp `intensity` to `0..1` before re-broadcast (see `dice_intensity`).
   - `snl_forfeit_draw` → draw the card index server-side (or just relay the host-chosen index) and broadcast so all clients show the **same** card.
   - everything else → validate types, attach `role` (and `target` role where present), re-broadcast to peers with `broadcast(s, payload, ws)`.

## 3. New files

### `client/src/game/snakesGame.js` (pure logic, deterministic)
Export:
- `BOARD_SIZES = { short:60, standard:100, long:150 }`, density presets, `POWERUPS`, `FORFEITS` (the tiered tables from the spec, each line tagged with `category` + `tier`).
- `generateBoard(seed, opts)` → `{ n, snakes:{head:tail}, ladders:{bottom:top}, forfeitTiles:Set, pickupTiles:Set, forkTiles:Set }`. Use `makeRng(seed)`. **Validate**: no snake head on tile 1, no ladder top on tile n, no two specials on one cell, no snake tail < 1; retry placement until valid (cap attempts, fall back to fewer specials).
- `rollFor(seed, turnIndex)` → 1–6 deterministically (e.g. `rngInt(makeRng(seed ^ (turnIndex*0x9e3779b1)), 1, 6)`), so both clients agree given the same `turnIndex`.
- `buildForfeitDeck(seed, categories, customLines)` → seed-shuffled array; parse `[1]/[2]/[3]` tier prefixes from custom lines (copy Beat the Dealer's parser).
- `buildPowerupDeck(seed)` → seed-shuffled powerup ids.
- helpers: `tierFor(distance, tileIndex, n)` (the spec's clamp formula), `heightFactor(tileIndex, n)`, `vibeSeconds(distance, tileIndex, n, scale)`, `d3(rng)`/`d6(rng)`.

### `client/src/screens/snakes.js`
`export function renderSnakes(root)`:
- Read `state.snlMode`/`state.role`; branch to the climber board view vs the Watched **Controller** view.
- `socket.connect()` is already open from the lobby; `socket.addEventListener(MSG.SNL_*, …)` and **remove every listener on `hashchange`** (copy the cleanup pattern at the bottom of any screen — leaks here cause double-handling).
- Build board via `generateBoard(state.seed, …)`; render the grid (CSS grid or the canvas approach Wizard Island uses).
- Turn loop with the roll handshake; animate the step; resolve tiles per the spec.
- Wire vibe through `haptics.js`; show forfeit/fork as full-screen modals requiring ack.
- On game end, send `final` and route to `#/results` (copy how dice/hilo finish).

## 4. Suggested defaults (so you're not blocked on tuning)

- Specials on a Standard (100) board, **Even** density: ~7 ladders, ~7 snakes, ~6 forfeit tiles, ~6 pick-ups, ~2 fork tiles. **Tame**: 9/4. **Brutal**: 5/10 with longer average snakes.
- `vibeScale`: Full = 1.0 s/tile, Half = 0.5 s/tile. `heightFactor = 1 + tileIndex/n` (→ up to ~2× at the summit).
- Powerup hand cap = 3. Pick-up draw cadence: leader every 3rd pick-up, trailing player every 2nd.
- Finale (Race): vibe burst = lobby `forfeitDuration` + one tier-3 forfeit card.

## 5. Test checklist

- **2P Versus:** two windows, both boards/rolls identical; a snake buzzes the right person and the opponent drives the slider; a ladder lets the climber choose punish; forfeit modal blocks both until acked; reaching the end routes both to results.
- **Forfeits only / Vibe only** stake mixes behave (Forfeits-only must be fully playable with **no** device connected).
- **3P:** three windows, turn rotates correctly; ladder target picker works; podium finale (3rd harsher than 2nd).
- **Solo:** starts host-only; random vibe fires; ladders give relief/Mercy; tap-out ends the run.
- **Watched:** host+guest; guest gets the Controller view (slider + forfeit picker, no dice); board only advances on the climber's rolls; Controller's ambient slider works.
- **Reconnect/cleanup:** navigating away and back doesn't double-fire handlers (watch the console).

## 6. Gotchas

- **Determinism:** never use `Math.random()` for anything both clients must agree on — only the seeded RNG, advanced identically. The die comes from `turnIndex`, not a local counter that could drift.
- **Listener leaks:** every `socket.addEventListener` needs a matching remove in the `hashchange` cleanup, or a second game in the same session double-handles messages.
- **Host-only lobby controls:** all config buttons must check `state.role !== 'host'` and be `disabled` for the guest (the guest mirrors via `lobby_config`).
- **`snlMode` vs `playerCount`:** Watched is 2 connections but 1 player — branch UI on `snlMode`, not `playerCount`.
- **No server state:** keep all game state client-side; the server only validates + relays. If you're tempted to store board state on the server, don't — re-derive from `seed`.
- **Deploy note:** stays within the existing single-instance, in-memory model — no persistence is added (see `DEPLOY.md`). Nothing to change there.
</content>
