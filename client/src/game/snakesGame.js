import { makeRng, rngInt, rngPick } from './seededRng.js';

export const BOARD_SIZES = { short: 60, standard: 100, long: 150 };
export const COLS = { short: 6, standard: 10, long: 10 };

export const DENSITY_PRESETS = {
  short:    { tame: { ladders:5,snakes:2,forfeits:3,pickups:3,forks:1 }, even: { ladders:4,snakes:4,forfeits:3,pickups:3,forks:1 }, brutal: { ladders:3,snakes:6,forfeits:4,pickups:2,forks:1 } },
  standard: { tame: { ladders:9,snakes:4,forfeits:5,pickups:5,forks:2 }, even: { ladders:7,snakes:7,forfeits:6,pickups:6,forks:2 }, brutal: { ladders:5,snakes:10,forfeits:7,pickups:4,forks:2 } },
  long:     { tame: { ladders:12,snakes:5,forfeits:7,pickups:7,forks:3 }, even: { ladders:10,snakes:10,forfeits:8,pickups:8,forks:3 }, brutal: { ladders:7,snakes:14,forfeits:9,pickups:6,forks:3 } },
};

export const POWERUP_IDS = ['loaded_die','antivenom','greased_rung','swap','double_move','hijack','deflect','mirror'];
// Solo / Watched climbs have exactly one token on the board — no opponent to swap with,
// hijack, deflect onto, or grease a ladder for — so only the self-only powerups are dealt.
export const SELF_ONLY_POWERUP_IDS = ['loaded_die','antivenom','double_move'];
export const POWERUP_INFO = {
  loaded_die:    { label: 'Loaded Die 🎲',  desc: 'Choose your next roll (1–6) instead of rolling.' },
  antivenom:     { label: 'Antivenom 🧪',   desc: 'Auto-negates the next snake you land on.' },
  greased_rung:  { label: 'Greased Rung 🪤',desc: "Opponent's next ladder is disabled." },
  swap:          { label: 'Swap 🔄',         desc: 'Swap board positions with an opponent.' },
  double_move:   { label: 'Double Move ⏩',  desc: 'Take two rolls this turn.' },
  hijack:        { label: 'Hijack 🎛',       desc: "Seize opponent's vibe slider next time they hit a snake." },
  deflect:       { label: 'Deflect 🪞',      desc: "Bounce the next snake's forfeit/vibe onto your opponent." },
  mirror:        { label: 'Mirror 🪩',       desc: 'Your next forfeit must also be done by your opponent.' },
};

export const FORFEITS = {
  vibe: [
    { tier:1, text: 'Wear the vibe for {d6}×15s — opponent controls the intensity.' },
    { tier:2, text: 'Wear the vibe for {d6}×30s — opponent controls the intensity.' },
    { tier:3, text: 'Five minutes on the vibe — opponent controls the intensity throughout.' },
  ],
  edge: [
    { tier:1, text: 'Edge once.' },
    { tier:2, text: 'Edge {d3} times.' },
    { tier:3, text: 'Edge {d6} times.' },
  ],
  task: [
    { tier:1, text: '2 minutes of naked exercise.' },
    { tier:2, text: 'Put on {d3} pegs.' },
    { tier:3, text: 'Hard order — stay hard for 10 min; if found soft, take a tier-2 forfeit.' },
  ],
  surrender: [
    { tier:1, text: 'Skip your next roll.' },
    { tier:2, text: 'Drop back 5 tiles, or discard a powerup.' },
    { tier:3, text: 'Lose two turns and hand a powerup to your opponent.' },
  ],
};

export function d3(rng) { return rngInt(rng, 1, 3); }
export function d6(rng) { return rngInt(rng, 1, 6); }

export function tierFor(distance, tileIndex, n) {
  return Math.max(1, Math.min(3, 1 + Math.floor((distance / n) * 3 + (tileIndex / n) * 2)));
}

export function heightFactor(tileIndex, n) {
  return 1 + tileIndex / n;
}

export function vibeSeconds(distance, tileIndex, n, scale) {
  const scaleFactor = scale === 'half' ? 0.5 : 1.0;
  return Math.max(5, Math.ceil(distance * scaleFactor * heightFactor(tileIndex, n)));
}

export function rollFor(seed, turnIndex) {
  const rng = makeRng(((seed ^ ((turnIndex * 0x9e3779b1) >>> 0)) >>> 0));
  return rngInt(rng, 1, 6);
}

export function buildPowerupDeck(seed, selfOnly) {
  const ids = selfOnly ? SELF_ONLY_POWERUP_IDS : POWERUP_IDS;
  const rng = makeRng((seed ^ 0xdeadbeef) >>> 0);
  const deck = [];
  for (let i = 0; i < 3; i++) deck.push(...ids);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rngInt(rng, 0, i);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function buildForfeitDeck(seed, categories, customLines) {
  const rng = makeRng((seed ^ 0xcafebabe) >>> 0);
  const deck = [];
  for (const line of (customLines || [])) {
    const m = line.match(/^\[([123])\]\s*(.*)/);
    if (m) deck.push({ tier: parseInt(m[1]), text: m[2].trim(), category: 'custom' });
    else if (line.trim()) deck.push({ tier: 1, text: line.trim(), category: 'custom' });
  }
  // Custom lines are mixed into the full built-in deck rather than replacing it, so a
  // host's typed-in forfeits show up alongside the standard categories instead of
  // being the only cards that ever get drawn.
  for (const cat of categories) {
    if (!FORFEITS[cat]) continue;
    for (const card of FORFEITS[cat]) {
      deck.push({ ...card, category: cat });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rngInt(rng, 0, i);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.length ? deck : [{ tier: 1, text: 'Skip your next roll.', category: 'surrender' }];
}

export function tileGridPos(tile, cols) {
  const idx = tile - 1;
  const row = Math.floor(idx / cols);
  const posInRow = idx % cols;
  const col = (row % 2 === 0) ? posInRow : (cols - 1 - posInRow);
  return { col, row };
}

export function generateBoard(seed, opts) {
  const { boardSize = 'standard', density = 'even', coopBetray = false } = opts || {};
  const n = BOARD_SIZES[boardSize] || 100;
  const cols = COLS[boardSize] || 10;
  const preset = (DENSITY_PRESETS[boardSize] || DENSITY_PRESETS.standard)[density] || DENSITY_PRESETS.standard.even;
  const rng = makeRng((seed ^ 0xb0a1d5ee) >>> 0);

  const { ladders: numLadders, snakes: numSnakes, forfeits: numForfeits, pickups: numPickups, forks: numForks } = preset;
  // Minimum tile gap enforced between snake heads / ladder bottoms so hazards read as
  // spread across the board rather than clustering in one stretch.
  const minGap = Math.max(3, Math.floor(n / 18));
  // A viper must always lurk within this many tiles of the finish — no risk-free coast home.
  const GOAL_GUARD_RANGE = 3;
  // That guaranteed final viper has to actually hurt — never just a 1-tile nip.
  const GOAL_GUARD_MIN_FALL = 18;

  for (let attempt = 0; attempt < 20; attempt++) {
    const used = new Set([1, n]);
    const entryTiles = []; // snake heads + ladder bottoms, checked for minGap spacing
    const snakes = {};
    const ladders = {};
    const forfeitTiles = new Set();
    const pickupTiles = new Set();
    const forkTiles = new Set();

    const rand = (lo, hi) => rngInt(rng, lo, hi);
    const tooClose = tile => entryTiles.some(t => Math.abs(t - tile) < minGap);
    const pick = () => {
      for (let t = 0; t < 50; t++) {
        const tile = rand(2, n - 1);
        if (!used.has(tile)) return tile;
      }
      return -1;
    };

    for (let i = 0; i < numLadders; i++) {
      let bottom = -1;
      for (let t = 0; t < 30; t++) {
        const cand = rand(2, Math.floor(n * 0.8));
        if (!used.has(cand) && !tooClose(cand)) { bottom = cand; break; }
      }
      if (bottom === -1) continue;
      const minTop = bottom + Math.floor(n * 0.05) + 1;
      const maxTop = Math.min(n - 1, bottom + Math.floor(n * 0.4));
      if (minTop > maxTop) continue;
      const top = rand(minTop, maxTop);
      if (used.has(top)) continue;
      ladders[bottom] = top;
      used.add(bottom);
      used.add(top);
      entryTiles.push(bottom);
    }

    for (let i = 0; i < numSnakes; i++) {
      let head = -1;
      for (let t = 0; t < 30; t++) {
        const cand = rand(Math.floor(n * 0.2), n - 1);
        if (!used.has(cand) && !tooClose(cand)) { head = cand; break; }
      }
      if (head === -1) continue;
      // No cap on how far a viper can drop you — the only ceiling on its size is
      // landing back on square one.
      const maxFall = head - 1;
      if (maxFall < 1) continue;
      const tail = rand(Math.max(1, head - maxFall), head - 1);
      if (tail < 1 || used.has(tail)) continue;
      snakes[head] = tail;
      used.add(head);
      entryTiles.push(head);
    }

    // Guarantee at least one viper head within GOAL_GUARD_RANGE of the finish, ignoring
    // the minGap spacing for this forced placement since the goal zone is narrow.
    if (!Object.keys(snakes).some(h => +h >= n - GOAL_GUARD_RANGE)) {
      for (let head = n - 1; head >= Math.max(2, n - GOAL_GUARD_RANGE); head--) {
        if (used.has(head)) continue;
        const minFall = Math.min(GOAL_GUARD_MIN_FALL, head - 1);
        if (minFall < 1) continue;
        let placed = false;
        for (let t = 0; t < 10; t++) {
          const tail = rand(1, head - minFall);
          if (tail < 1 || used.has(tail)) continue;
          snakes[head] = tail;
          used.add(head);
          used.add(tail);
          entryTiles.push(head);
          placed = true;
          break;
        }
        if (placed) break;
      }
    }
    if (!Object.keys(snakes).some(h => +h >= n - GOAL_GUARD_RANGE)) continue;

    for (let i = 0; i < numForfeits; i++) {
      const tile = pick();
      if (tile === -1) continue;
      forfeitTiles.add(tile);
      used.add(tile);
    }

    for (let i = 0; i < numPickups; i++) {
      const tile = pick();
      if (tile === -1) continue;
      pickupTiles.add(tile);
      used.add(tile);
    }

    if (coopBetray) {
      for (let i = 0; i < numForks; i++) {
        const tile = pick();
        if (tile === -1) continue;
        forkTiles.add(tile);
        used.add(tile);
      }
    }

    return { n, cols, snakes, ladders, forfeitTiles, pickupTiles, forkTiles };
  }

  return { n, cols, snakes: {}, ladders: {}, forfeitTiles: new Set(), pickupTiles: new Set(), forkTiles: new Set() };
}

export function resolveForfeitText(card, seed, drawIdx) {
  const rng = makeRng(((seed ^ ((drawIdx * 0x1b873593) >>> 0)) >>> 0));
  return card.text
    .replace(/\{d3\}/g, () => d3(rng))
    .replace(/\{d6\}/g, () => d6(rng));
}
