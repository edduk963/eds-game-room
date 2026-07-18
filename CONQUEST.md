# Conquest (redesign spec)

A 2–3 player territory-conquest game. Each match generates a fresh, random map; players fight over spaces using secretly-allocated dice, resolved simultaneously once per round.

> **Status:** implemented. Map generation, round resolution, and the full space pool are built in `client/src/game/conquestMap.js` + `client/src/game/conquestGame.js`, wired session-side in `server/index.js`, and playable via `client/src/screens/conquest.js`. Verified with standalone logic tests and full WebSocket integration tests (session join → begin → ready/allocate/reveal loop → claim abilities → 3-player setup → computer-player setup); not yet visually verified in a real browser. The old REST/global-singleton implementation (`server/world.js`, `server/world-config.json`) has been deleted.

**Computer player:** the lobby has a "Computer 3rd player" toggle (host-only). If no one joins as player 3, the server fills `guest2` with a bot that auto-readies every round (exempt from Edge Post's edge requirement — nothing to physically edge), allocates dice with a simple weighted-random heuristic (mostly attacks its frontier, occasionally reinforces its own ground), and has a 50% chance per round to invoke any claim ability it holds against a random human target. Forfeits assigned to the bot are inert — no one is there to feel them. The global "Forfeit vibe" and "Edge mode" lobby options are hidden for Conquest since it has its own per-space forfeit system.

**On-screen info:** every phase has a top nav bar (title, a "← Leave" button back to the session lobby, and the shared vibe-mode pattern control) — the same treatment every other game screen has. Below that, a per-player territory count (hexes controlled) sits at the top of the phase body. The reveal screen's log only lists forfeit-relevant events (skip-token shields, claim invocations) — territory outcomes are conveyed visually on the map itself (fill color + per-role dice totals on each contested hex), not repeated as text. There's no standing claim-ability panel either — a controlled, unused ability shows as a gold-highlighted, clickable hex directly on the map during the ready phase.

**Match end:** shows the winner (or, if the computer won, a draw between the two humans — the computer never holds a "control" hand). Whoever didn't win gets vibed for the rest of the screen; the winner gets a live intensity slider that drives it (pattern comes from the header bar above), while a draw gives both losing humans one shared slider instead of a single controller. Any Ridgepath/Reckoning obligations are listed as text underneath. The vibe stops the moment both players click Ready, which also returns everyone to the lobby.

---

## Map Generation

- **Layout:** a solid hexagon-shaped board made of hex tiles (flat-top, axial coordinates) — radius 2 (19 tiles), the same size regardless of player count (2, 3, or 2 humans + a computer player). A larger board for 3 players spread them too far apart for meaningful conflict, so the board stays this size deliberately. A filled hex-of-hexes region is inherently one connected graph, so no separate connectivity pass is needed.
- **Start spaces:** the generator picks 2 or 3 start tiles via farthest-point placement (each new start maximizes its minimum graph-distance to the ones already chosen), so they land spread across the board.
- **Special spaces:** a fixed number of each special space type is included per generated map, drawn from the full pool below — **not every space in the pool appears in every game.**
- **Regeneration:** a brand-new map is generated for every match. Nothing persists across matches.
- **Rendering:** each hex tile is large enough to show the special space's name, the number of dice currently placed there (during allocation) or each player's rolled total (during reveal), and is filled with the controlling player's color — left blank/neutral if uncontrolled.

---

## Round Flow

1. **Frontier check** — for each player, eligible targets are any neutral or enemy space adjacent to a space that player currently owns. There is no single moving token; your whole territory has a frontier.
2. **Secret allocation** — each player has a dice pool for the round (default **8**; +2 while holding The Muster) and spends it across:
   - **Attacking** eligible frontier spaces, and/or
   - **Reinforcing/defending** spaces they already own.
   Allocations are hidden from other players until reveal.
3. **Reveal** — once all players have committed, every allocated die is rolled and totals are summed per player, per space.
4. **Resolution** — for each contested space, whoever has the higher total wins/holds it for the coming round.
   - **Ties favor the current holder** (attacker fails to take it). For a neutral space, a tie leaves it neutral.
   - **An owned space with 0 dice committed to it defaults to 0** — any attacker with more than 0 dice on it takes the space outright; there is no free tie-protection for an unreinforced space.
5. **Passive claim effects re-evaluate** based on the new ownership map (see [Space Pool](#space-pool) for which effects are continuous vs momentary vs end-of-match).

---

## Defense

The same shared dice pool covers both attacking new spaces and reinforcing spaces you already hold — there's no separate defense resource. Owning more territory means more frontier to cover, so spreading dice too thin across many spaces leaves real gaps. There is no baseline garrison — an owned space always starts at 0 until a player actively commits dice to it that round.

---

## Space Pool

Space types fall into three activation styles: **momentary** (resolves the instant a round's combat is decided), **continuous passive** (stays in effect for as long as a player controls the space, no invoking required), and **end-of-match passive** (checked once, only when the match ends).

| Space | Category | Trigger | Effect |
|---|---|---|---|
| Start | — | — | Spawn point. No effect. 2 or 3 exist per map, depending on player count. |
| Safe | — | — | No effect. Connective tissue between meaningful spaces. |
| Trap | Momentary, **hidden** | Round-winner | Vibe forfeit (30s) for whoever wins/holds the space that round. Redacted to look like Safe ground for everyone, same as Secret Trap — nothing on the map ever names or highlights it. Unlike the original design, the forfeit is **never announced to anyone but the player it happened to** — it arrives as a private message, so an opponent has no way to learn a Trap fired at all, let alone where. *(Merged from the old separate Trap/Toll types, which were functionally identical.)* |
| Sanctuary | Momentary | Round-winner | Grants a skip token (cancels one future forfeit). |
| Dungeon Gate | Manual invoke | Once per session | Assign opponent a 5-minute punishment forfeit. |
| Iron Throne | Manual invoke | Once per session | Double one forfeit assigned to opponent. |
| Edge Post | Continuous passive | While held | Opponent must edge once before every round starts. Guaranteed on every map (see density note below). |
| The Mirror | Continuous passive | While held | Any forfeit the holder owes is duplicated onto every other player, the moment it's assigned. |
| The Muster | Continuous passive | While held | +2 dice per round for the controller. |
| Secret Trap ×2 (×3 with a 3rd participant) | Continuous passive, **hidden** | While held | Continuous 50% vibe for the holder only. Privately flagged to the holder in the UI — **never shown to any other player.** The vibe transfers the instant another player takes the space away in a later round. Visually indistinguishable from a Safe space to everyone, including the holder. Count is 2 for a 2-player match, 3 whenever there's a 3rd participant (a real 3rd player or a computer player). |
| Ridgepath | End-of-match passive | Checked once, at match end | Every player who does *not* control it owes a 10-minute edging session before the next match. |
| The Reckoning | End-of-match passive | Checked once, at match end | Whoever isn't in control of this space at the end will have to cum, and get 3 min postcum. Has its own lobby option — see below. |

**Board density:** Sanctuary is fixed at 1, Trap at 1, and Edge Post is now fixed at 1 too — guaranteed on every map, not part of the random subset. The remaining 5 named landmarks (Dungeon Gate, Iron Throne, Mirror, Muster, Ridgepath) plus The Reckoning (when its lobby option is `random`) are **not all included every match** — each generated map randomly selects 4 of them. Roughly half the board ends up plain Safe ground either way. **The Vault has been removed** from the space pool entirely (it's no longer generated, claimable, or referenced anywhere).

**The Reckoning lobby option:** a 3-way toggle — `Off` removes it from the pool entirely (never generated, this match will never end in a cum forfeit), `On` guarantees it appears every match (pulled out of the random subset, like Edge Post), `Random` (default) leaves it as one of the landmarks that may or may not be picked for the random subset each match.

**Hover:** every special space shows its full effect description on mouseover — **except** Trap and Secret Trap, both of which are indistinguishable from Safe ground even on hover, for everyone.

**Permanently removed from the old design:** Crown Spire (Royal Command), The Sanctum (Sanctum Lock), The Overlook, the old Saltmere Surge (100%-intensity-for-non-controllers idea — replaced by Secret Trap).

**Assumption carried through Ridgepath / The Reckoning / the old ambient-vibe idea:** in a 3-player match, "whoever doesn't control it" means *every* non-controlling player, not just one.

---

## Resolved Design Decisions

These were open questions; resolved to unblock implementation:

- **Dice pool size per round.** Fixed per player per round (default **8**), plus +2 while holding The Muster.
- **Win condition.** Domination: control ≥60% of claim spaces and hold that share for 3 consecutive rounds. A round cap — a lobby option, **5 or 10** (default 10) — acts as a fallback so a match always ends even if no one reaches domination: whoever controls the most claim spaces at the cap wins, or if still tied, the match ends immediately as a **draw** (no sudden death — a tie at the cap doesn't extend the match). This is what triggers the Ridgepath / The Reckoning end-of-match checks. The match-end screen already has a dedicated draw treatment (shared vibe control, both losing humans vibe together) reused from the "computer won" case, described above.
- **Duel spaces.** Folded entirely into ordinary contested space — dice combat already provides the "must be won" mechanic, so "Duel" is no longer a distinct type.
- **Trap/Toll merge.** Merged into a single **Trap** type (they were already functionally identical).
- **Baseline garrison.** None. An owned space with 0 dice committed always defaults to 0 — any attacker with more than 0 dice takes it.
- **Secret Trap abandonment.** Falls out of the no-garrison rule for free: a holder can simply stop reinforcing it, and any attacker with >0 dice takes it. No separate mechanism needed.

---

## Implementation Notes

- **New files:** `client/src/game/conquestMap.js` (procedural map generator, `getFrontier`, `redactHiddenSpaces`, `initialOwnership`, `findNodeIdByType`) and `client/src/game/conquestGame.js` (dice rolling, round resolution, passive effects, domination/round-cap checks, match-end passives).
- **Server (`server/index.js`):** authoritative for map topology, ownership, and dice pools — it generates the map once per match from the shared seed, validates every allocation (legal target + pool-size clamp), and resolves each round itself rather than trusting client-computed results (a deliberate deviation from Standoff's client-authoritative pattern). New `CQ_*` message flow lives in a dedicated `── Conquest ──` block alongside the existing per-game sections. Trap hits are delivered as a private `cq_trap_hit` message to the affected role's own socket only — never a field on the general `cq_reveal` broadcast, so an opponent has no way to learn one fired.
- **Client (`client/src/screens/conquest.js`):** phase-driven screen (preview → ready → allocate → reveal → match end) modeled on `standoff.js`'s structure, with map-driven claim-ability invocation, a private-only Secret Trap status indicator, and the shared header vibe-mode bar (`initVibeModeBar`) mounted fresh after every phase's `root.innerHTML` reassignment.
- **Haptics (`client/src/haptics.js`):** `startContinuousVibe`/`stopContinuousVibe` (indefinite background vibe, used by both Secret Trap and the match-end vibe) now also samples the shared wave/pattern driver when wave mode is on, so a selected vibe-mode pattern actually plays through it — not just flat intensity. `triggerReckoning` (the end-of-match escalate-then-cooldown effect) is unchanged. Everything else reuses existing primitives (`startForfeitVibe`, `setForfeitIntensity`, `pulse`, `setWaveVibeMode`).
- **Wired in:** both `validGameTypes` arrays, the lobby's "Strategy" category tile (with a 3P badge), Rounds (5/10), Computer 3rd player, and Reckoning (on/off/random) lobby config rows, the `#/conquest` route, and the `begin`-handler state copy in `main.js`.
- **Removed:** the old `server/world.js`, `server/world-config.json`, and their 5 REST routes — fully deleted, not just disconnected. The Vault space/ability has also been fully removed (map generator, server claim handler and state, client UI, `CQ_CLAIM_VAULT` message) — Dungeon Gate and Iron Throne remain the only manual-invoke abilities.
- **Match-end vibe control:** a new `CQ_MATCH_END_INTENSITY` message lets the winner's intensity slider drive the loser(s)' `startContinuousVibe` level live; pattern comes from the header vibe-mode bar already on screen. In a draw (the computer won), both humans share one slider and both feel it. The vibe channel stops via `stopContinuousVibe()`/`stopAll()` once both players have clicked Ready.
- **Mirror correctness:** duplicating a forfeit onto every other player only fires for a forfeit assigned in the current reveal tick (guarded by an `appliedAt` freshness check) — otherwise, since nothing clears a player's last-recorded forfeit once Vault is gone, a stale forfeit from many rounds ago would get re-mirrored onto everyone every single round for the rest of the match.
