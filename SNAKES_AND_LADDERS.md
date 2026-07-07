# Snakes & Ladders

A 2–3 player race up a 100-tile board, played in a single session. Roll, climb, and slide — but the board has teeth. **Climb a ladder and you punish your opponent; hit a snake and you pay.** Stakes are a mix of **vibe** (live haptics) and **forfeits** (edge orders, strip, control, naked tasks) drawn in the flavour of the Wizard Island deck — and the higher up the board you are, the harder both bite. First to the summit wins; the rest take the finale.

> Internal id: `snakes` · route `#/snakes` · theme: "Vipers & Vines"

---

## Why it fits the hub

Classic Snakes & Ladders is pure luck — no decisions, no stakes. This redesign keeps the instantly-recognisable board (like UNO and Battleships kept their familiar shells) but rebuilds it on the hub's proven building blocks so every roll *matters*:

| Hub concept (seen in…) | How it's used here |
|---|---|
| **Seeded RNG sync** (every game) | Board layout, the dice-roll sequence, and the forfeit/powerup draw order are all derived from `seed` — both clients stay identical with zero game state on the server. |
| **Vibe escalation** (Hi-Lo, Dice, Tug of War) | Snake/ladder stakes scale with **distance × board height** — a snake near the top is brutal, like Dice's `15 × 2^losses` ramp but spatial. |
| **Forfeit deck** (Wizard Island, Split Loot) | A 6-category deck in the Wizard-Island flavour (vibe/edge/strip/control/task/surrender) is woven into snakes *and* dedicated tiles, tiered by severity. |
| **Dice-scaled forfeits `d3/d6`** (Wizard Island) | Edge counts, vibe durations and task amounts roll on seeded dice, so the same card still varies. |
| **Forfeit tiers `[1]/[2]/[3]`** (Beat the Dealer) | Each forfeit line carries a severity; the board picks the tier from how far/high you fell. |
| **Powerups / special cards** (Hi-Lo, Last Call, Battleships) | Pick-up tiles deal powerups from a seeded deck: Loaded Die, Antivenom, Greased Rung, Swap, Double Move, **Hijack**. |
| **Cooperate / Betray** (Wizard Island) | Optional "Fork" tiles present the co-op-or-shove matrix when both players are in reach of a shared shortcut. |
| **Intensity slider** (Dice, Beat the Dealer) | When a snake fires a vibe, the *climber* (or a Hijack holder) drives a live 0–100% slider for the duration. |
| **Win modes + lobby config** (Wizard Island, Hi-Lo) | Race / Endurance win conditions, board size, density, stake mix, deck toggles. |
| **2P + optional 3P** (Dice, Hi-Lo, Mastermind) | Host/guest/guest2 tokens; "who suffers" rules mirror Dice. |

---

## Stakes: vibe *and* forfeits

The core change over a plain vibe game: **every snake (and every Forfeit tile) rolls on a stake table**, not just the buzzer. The lobby sets the mix:

- **Vibe only** — snakes fire haptics (the original loop).
- **Forfeits only** — snakes draw a forfeit card; no toy required (playable with no devices connected).
- **Mixed** (default) — the seed decides per-event: roughly half vibe, half forfeit, weighted harsher higher up.

Both stake types share one **severity tier (1–3)** derived from the event, so vibe length and forfeit harshness escalate together:

```
tier = clamp(1 + floor( (slideOrClimbDistance / N) * 3 + (tileIndex / N) * 2 ), 1, 3)
```
i.e. a long fall from near the summit → tier 3; a short early slide → tier 1.

---

## The Board

- A boustrophedon grid (snaking 1→N like the real game). Size is a lobby option:
  - **Short** 60 (6×10) · **Standard** 100 (10×10) · **Long** 150 (10×15).
- The seed places, per game:
  - **Ladders** (🪜) — bottom → top jumps.
  - **Snakes** (🐍) — head → tail drops.
  - **Forfeit tiles** (🎴) — draw a forfeit on landing.
  - **Pick-up tiles** (⭐) — collect a powerup.
  - **Fork tiles** (🔱, optional) — trigger a cooperate/betray choice.
- Placement is seeded but validated so the board is always finishable: no snake head on tile 1, no ladder top on the final tile, no two specials on one cell, snakes never drop below tile 1.
- **Density** controls the snake:ladder mix and total count: **Tame** (ladder-heavy), **Even** (default), **Brutal** (snake-heavy, longer slides).

---

## A Turn

Turn-based, alternating (3P: clockwise). The Wizard-Island roll handshake is reused so both screens animate the same number.

1. **Active player taps ROLL** → sends `SNL_ROLL_READY`; server echoes `SNL_ROLL_GO` carrying the turn index. Both clients compute the die value locally from `seed` + turn index → identical result, no trust needed.
2. **Press-your-luck (optional):** after seeing the roll you may **push** — roll again to keep moving, but a snake hit on a pushed turn resolves one tier harsher. Turns passive luck into a stop/go decision.
3. **Token advances**, then resolve the landing tile:

### 🪜 Ladder bottom — you climb
You jump to the top, and **you choose how to punish** (climber's agency):
- **Vibe** — drive the opponent's intensity slider for `seconds = ceil(climbDistance × vibeScale × heightFactor)`.
- **Assign a forfeit** — hand the opponent a forfeit at this event's tier (pick a category you've unlocked, or draw blind).

### 🐍 Snake head — you slide
You drop to the tail and **you pay**, per the stake mix and tier:
- **Vibe** — your opponent (or auto-ramp, config) drives *your* slider for the scaled duration.
- **Forfeit** — draw a tier-`n` card from the agreed deck and do it; both acknowledge (`SNL_FORFEIT_ACK`) before play resumes.
- **Antivenom** powerup, if held, negates the whole bite.

### 🎴 Forfeit tile — draw a card
Always a forfeit (never vibe), tier scaled by board height. The flavour tile for people playing **Forfeits only** with no toys.

### ⭐ Pick-up tile — collect a powerup
Take the next powerup from the seeded deck (**max 3 slots**; over the cap, discard one).

### 🔱 Fork tile *(optional)* — cooperate or betray
If both players are within `forkRange` tiles, a Wizard-Island-style hidden choice appears:

| You \ Opp | Cooperate | Betray |
|---|---|---|
| **Cooperate** | Both ride a shared shortcut up (small mutual climb, no stake) | Opponent shoves you down a snake's worth + you take a tier-1 forfeit; they climb |
| **Betray** | You shove them down; you climb | Both slide a short way **and** both take a tier-1 stake |

4. **End of turn** passes on. Powerups are played on your own turn before/instead of rolling.

---

## Forfeits

Drawn in the flavour of the **Wizard Island dark-wizard deck** — edge orders, vibe control, clothing transfer, naked tasks, follow-orders — rather than generic party dares (no truth/dare/drink here). Six categories, toggled in the lobby (same selector as Split Loot). As in Wizard Island, amounts roll on **seeded dice (`d3`/`d6`)**; the board's severity tier sets which die and how long. The deck is seed-shuffled so order is identical on both clients.

| Category | Tier 1 (lower board) | Tier 2 (mid) | Tier 3 (summit) |
|---|---|---|---|
| ⚡ **Vibe** | Wear the vibe `d6×15s`, opponent controls. | `d6×30s`, opponent on the slider. | 5 minutes, opponent controls intensity. |
| 🌀 **Edge** | Edge once. | Edge `d3` times. | Edge `d6` times. |
| 👕 **Strip** | Remove one item, **or** transfer one worn item to your opponent. | Down to underwear. | Naked until your next ladder. |
| 🎛 **Control** | Opponent sets your slider level for the next snake. | Follow the opponent's orders on how to play your next turn. | Opponent controls how you play for 3 turns. |
| 🪢 **Task** | 2 minutes of naked exercise. | Put on `d3` pegs. | Hard order — stay hard 10 min; if found soft, take a tier-2 forfeit. |
| 🏳 **Surrender** | Skip your next roll. | Drop back 5 tiles **or** discard a powerup. | Lose two turns and hand a powerup to your opponent. |

Notes:
- **Dice-scaled** like Wizard Island — seeded `d3`/`d6` rolls decide counts and durations, so even a repeated card varies.
- **Deflect / Mirror** — held as powerups (below), lifted straight from the Wizard Island deck: bounce a forfeit to your opponent, or force them to repeat yours.
- **Custom lines** — the lobby can expose a textarea (Beat the Dealer pattern); prefix `[1]`/`[2]`/`[3]` to set tier. Empty falls back to the built-ins.
- **Acknowledgement** — forfeits show as a full-screen card both players confirm, so play can't skip past one.
- **No-toy play** — with Vibe disabled the game is fully playable with zero devices connected.

---

## Powerups

Dealt from a seeded deck (deterministic order, like Hi-Lo / Last Call). Up to **3 slots**, shown as tappable buttons (Wizard-Island held-spell pattern).

| Powerup | Effect |
|---|---|
| **Loaded Die** 🎲 | Choose your next roll's value (1–6) instead of rolling. |
| **Antivenom** 🧪 | Auto-negates the next snake you land on. |
| **Greased Rung** 🪤 | Opponent's next ladder is disabled (stop at the bottom). |
| **Swap** 🔄 | Swap board positions with an opponent — devastating from behind. |
| **Double Move** ⏩ | Take two rolls this turn. |
| **Hijack** 🎛 | Seize the opponent's vibe slider the next time *they* hit a snake (from Last Call); or, if that snake is a forfeit, **you** pick its category. |
| **Deflect** 🪞 | Bounce the next snake's forfeit/vibe onto your opponent (Wizard Island's Deflect). |
| **Mirror** 🪩 | Your next forfeit must also be done by your opponent (Wizard Island's Mirror). |

All plays broadcast (`SNL_POWERUP`) so both boards stay identical. (Max 3 held slots — the deck is bigger than the hand, so you choose what to keep.)

**Catch-up:** the trailing token draws from the powerup deck more often (every 2nd pick-up vs every 3rd), and the leader's snakes are already scarier via `heightFactor` — so no rubber-band teleports are needed.

---

## Winning

A lobby option, mirroring Wizard Island's win-condition selector:

- **Race** (default) — first to the final tile wins. *Final-tile rule:* **Exact** (overshoot bounces back) or **Pass** (reach-or-exceed). The loser(s) take the **finale**: a long vibe burst at the lobby `forfeitDuration` (climber on the slider) **and** a tier-3 forfeit card.
- **Endurance** — no finish line; play until a player has *taken* a configured number of forfeits/vibe seconds. Last one standing wins (borrows Wizard Island's endurance cap).

Results route to the existing `#/results` screen via `final` / `opp_final`, carrying residual vibe seconds like the other games.

---

## Three players (optional)

Supported like Hi-Lo / Dice / Mastermind. Turn order rotates **host → guest → guest2**. The seeded model is unchanged: `rollFor(seed, turnIndex)` uses a single global turn counter, so any player count derives identical rolls, and board generation is untouched. What a third player actually changes is **who feels each event**:

**🐍 Snake — you pay.**
- *Forfeit:* you do it yourself — unaffected by player count.
- *Vibe:* one of the other two drives your slider. A lobby rule (reusing Dice's "who suffers" selector) decides which: **Leader** (the player furthest up the board — pure schadenfreude, and a small reward for being ahead), **Trailing**, or **Random** (seeded, so both screens agree).

**🪜 Ladder — you punish.** The climber **picks one of the two opponents** as the target for the vibe burst or the assigned forfeit. This is the natural 3P generalisation of "punish your opponent," and it's where the social game lives — gang up on the leader, or knock back whoever's catching you. (A "leader auto-target" toggle is offered for groups who want to skip the choice.)

**⭐ Powerups.** Opponent-targeting powerups — **Swap, Hijack, Greased Rung, Deflect, Mirror** — prompt you to tap *which* opponent. Self-only powerups (Loaded Die, Antivenom, Double Move) don't.

**🔱 Fork tiles.** The cooperate/betray matrix is inherently two-handed, so a Fork resolves **pairwise** between the lander and the nearest opponent inside `forkRange`; the third player sits that one out. Recommended off in 3P (lobby toggle).

**🏆 Winning — podium.** First to the summit wins. The other two keep playing to settle the order by board position, then both take a finale **scaled by placement**: 3rd (last) takes the full tier-3 finale, 2nd takes a reduced tier-2 one — so there's still something to race for once 1st is gone. *Endurance* variant: play until two players hit the cap; the last one under it wins.

**Plumbing.** Reuses what's already there — `state.playerCount`, `guest2Name`, the lobby's third player slot, and the Dice-style "who suffers / drives the vibe" config row. The tile gets a `3P` badge; `begin` already broadcasts `playerCount` and `main.js` routes on it. All `SNL_*` relays carry a `role` (`host`/`guest`/`guest2`) and, where relevant, a `target` role so all three screens resolve identically.

---

## Single-player modes

Two solo flavours, alongside the existing 1P games (Hi-Lo, Beat the Dealer, Mastermind). The lobby gains a **Players** selector — `Versus (2–3)` / `Solo` / `Watched` — stored as `snlMode`.

### Solo — "Climb Alone" (1 player, random vibe)

One token, one goal: reach the summit. **The board is the opponent**, so with no one to punish, tile meanings flip:

- 🐍 **Snake** — you slide and take the stake. With no partner on the slider, the **vibe is generated**: a *random intensity* (seeded), tier-scaled in duration, with optional **ambient buzzes between rolls** so the tease stays unpredictable. Forfeit snakes draw the same deck — you do them yourself.
- 🪜 **Ladder** — relief. You climb, the vibe **eases or cuts out**, and you bank a small **Mercy** (spend to auto-skip one snake — a free Antivenom).
- ⭐ / 🎴 tiles as normal; Antivenom and Loaded Die shine when you're surviving rather than attacking.
- **Escalation:** `heightFactor` turns the top of the board into a gauntlet of stronger random bursts — it's a tease/endurance climb, not a race.
- **Win / lose:** summit = you endured and win. Optional **Endurance/tap-out** toggle adds a "give in" button that ends the run; the goal becomes summiting *without* tapping. Push-your-luck still applies.
- Reuses the hub's **auto-ramp vibe** (Dice's auto option) and the single-client `#/hilo1p` solo pattern — no opponent messages at all.

### Watched — "One climbs, one controls" (1 player + 1 controller)

Two people connected, but **only the climber has a token**. The second player is the **Controller** — a watcher/dom who never rolls.

- **Climber's screen:** the normal board and turn loop.
- **Controller's screen:** a live mirror of the climber's board, a big **intensity slider**, and **forfeit controls** — no dice.
- 🐍 **Snake** — the Controller takes the wheel: drives the slider for the scaled duration and/or **picks the forfeit** the climber must do (the board *suggests* a tier; the Controller may go harder or softer).
- 🪜 **Ladder** — a reprieve: the climber earns relief and the Controller is prompted to **ease off** (slider soft-capped for the climb duration) or grant a reward — a deliberate push/pull.
- The Controller also has an **always-on ambient slider** to tease between events — the whole climb is their toy.
- **Win:** climber reaching the summit = climber endures and wins. The **Endurance** variant flips it competitive — the Controller's goal is to make the climber tap out before the top.
- Plumbing: a 2-connection session like Versus, but the guest is flagged **`controller`**, not a player. Reuses `SNL_VIBE_CTRL` (Controller → climber) plus a new `SNL_FORFEIT_ASSIGN`; the board only advances on the climber's rolls, and the Controller's view is read-only for movement.

### Lobby & routing for solo modes

- **Players** row → `snlMode` ∈ `versus | solo | watched` (with `playerCount`). Solo and Watched hide opponent-only options (Fork tiles, the 3P "who suffers" row). Solo adds **Ambient vibe** on/off and the **Tap-out/Endurance** toggle; Watched adds **Controller ambient** on/off.
- Mark `snakes` **solo-capable** so Solo starts with just the host (like `beatdealer`/`hilo`); **Watched** needs host + guest (1 climber + 1 controller); **Versus** needs ≥2.
- One `renderSnakes(root)` branches on `snlMode` and `state.role` to pick the climber vs Controller view; the board/logic module (`snakesGame.js`) is shared across all modes.

---

## Haptics

Reuses `client/src/haptics.js` exactly as the other games do — no new haptics code. Snake vibe → opponent (or auto) drives `setIntensity()` live, `pulse()` on the bite; ladder vibe → you drive the opponent's slider; win/lose → `winPattern()` / `losePattern()`. When the stake is a forfeit (not vibe), no toy is needed at all.

---

## Lobby configuration

A new game tile under **Strategy** (dice-driven but decision-rich, like Wizard Island) plus a `#snl-config` block:

| Option | Values | State field |
|---|---|---|
| Players | **Versus (2–3)** / Solo / Watched | `snlMode` |
| Board size | Short 60 / **Standard 100** / Long 150 | `snlBoardSize` |
| Density | Tame / **Even** / Brutal | `snlDensity` |
| Stake mix | Vibe only / Forfeits only / **Mixed** | `snlStakeMix` |
| Vibe scaling | **Full** / Half (seconds-per-tile, like Last Call) | `snlVibeScale` |
| Win condition | **Race** / Endurance | `snlWinCondition` |
| Final-tile rule | **Exact** / Pass (Race only) | `snlFinalRule` |
| Push-your-luck | **On** / Off | `snlPushLuck` |
| Powerups | **On** / Off | `snlPowerups` |
| Fork tiles | On / **Off** | `snlCoopBetray` |
| Forfeit categories | toggle the 6: vibe / edge / strip / control / task / surrender | `snlForfeitCards` |
| Custom forfeits | optional textarea (Beat the Dealer pattern) | `snlForfeitLines` |
| Finale vibe | shared `forfeitDuration` row | `forfeitDuration` |
| Ambient vibe | On / Off (Solo & Watched only) | `snlAmbient` |
| Tap-out / Endurance | On / Off (Solo & Watched) | `snlTapOut` |

3-player adds the Dice "who suffers" row (`lowest` / `all_but_winner`) for shared targeting. Solo / Watched hide the Fork and 3P rows.

---

## Implementation map

Pattern is identical to the existing games — **no new server state**, only relays.

**New files**
- `client/src/game/snakesGame.js` — `generateBoard(seed, opts)` (places ladders/snakes/tiles, validated), `rollFor(seed, turnIndex)` (deterministic die), `buildForfeitDeck(seed, categories, customLines)`, powerup deck builder, tier/seconds helpers. All via `makeRng`/`rngInt`/`rngPick` from `seededRng.js`.
- `client/src/screens/snakes.js` — `renderSnakes(root)`: board render, turn loop, roll handshake, push-your-luck, powerup hand, intensity slider, forfeit/fork modals, haptics wiring, cleanup on `hashchange`.

**Edits to existing files**
- `client/src/shared/messages.js` — add `SNL_ROLL_READY`, `SNL_ROLL_GO`, `SNL_MOVE_DONE`, `SNL_POWERUP`, `SNL_FORFEIT_DRAW`, `SNL_FORFEIT_ACK`, `SNL_OPP_FORFEIT_ACK`, `SNL_FORFEIT_ASSIGN` (Watched), `SNL_COOP_CHOICE`, `SNL_COOP_REVEAL`, `SNL_VIBE_CTRL`, `SNL_VIBE_STOP`.
- `client/src/state.js` — add the `snl*` fields above — incl. `snlMode`, `snlAmbient`, `snlTapOut` — (and reset them).
- `client/src/main.js` — import `renderSnakes`; add `#/snakes` route; read `snl*` from the `begin` event; `else if (gt === 'snakes') navigate('#/snakes')` (the single screen branches on `snlMode`/`role`; no separate `#/snakes1p` route needed).
- `client/src/screens/lobby.js` — game tile + `#snl-config` block (incl. the **Players** selector) + selected-vars + `paintOptions` wiring + `sendConfig`/`START` payload. Add `snakes` to the **solo-capable** list so **Solo** starts host-only; **Watched** needs host+guest; **Versus** needs ≥2. Add the `3P` badge to the tile.
- `server/index.js` — add the `snl*` fields to the `begin` broadcast (~line 232) and `case` relays for each `SNL_*` type (validate/clamp like the `wi_*`/`dice_*` handlers — clamp slider 0–1, compute `SNL_ROLL_GO` turn index server-side so a client can't pick its roll, draw forfeits server-side and broadcast the chosen index so both clients show the same card).

---

## Why it's good

- **Familiar shell, real decisions.** Everyone knows the board, but Loaded Die, Swap, Hijack, push-your-luck and the climber's punish-choice turn a luck game into a bluff-and-resource game.
- **Vibe *and* forfeits.** Two stake types on one tiered escalation curve means it plays great with toys, with forfeits only (no devices needed), or both — and the back half of the board is always the spicy half because stakes scale with height.
- **Pure reuse.** Seeded sync, forfeit deck + tiers, intensity slider, hijack, cooperate/betray, results flow, haptics — all lifted from existing games. The only genuinely new code is board generation and the turn UI.
</content>
