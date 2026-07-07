import { makeRng } from './seededRng.js';

export const GRID_SIZES = {
  '4x4': { cols: 4, rows: 4 },
  '5x5': { cols: 5, rows: 5 },
  '6x6': { cols: 6, rows: 6 },
  '8x8': { cols: 8, rows: 8 },
};

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

export function gridDims(gridSize) {
  return GRID_SIZES[gridSize] || GRID_SIZES['6x6'];
}

export function gridCellCount(gridSize) {
  const { cols, rows } = gridDims(gridSize);
  return cols * rows;
}

export function pairBudget(gridSize) {
  return Math.floor(gridCellCount(gridSize) / 2);
}

// forfeit pairs + vibe pairs + the 1 win pair must fit inside the grid's pair budget
export function fitsGrid({ forfeitLines = [], vibeDurations = [], gridSize }) {
  const needed = forfeitLines.length + vibeDurations.length + 1;
  return needed <= pairBudget(gridSize);
}

export function pickStartingRole(rng, playerRoles) {
  return playerRoles[Math.floor(rng() * playerRoles.length)];
}

export function nextRole(playerRoles, currentRole) {
  const idx = playerRoles.indexOf(currentRole);
  return playerRoles[(idx + 1) % playerRoles.length];
}

// Deterministic shuffled deck — every client derives the identical board from the shared seed.
export function buildDeck({ forfeitLines = [], vibeDurations = [], gridSize = '6x6', seed }) {
  const total = gridCellCount(gridSize);
  const pairsNeeded = Math.floor(total / 2);
  const pairs = [];

  // The win pair always gets a slot; forfeit/vibe lists are clamped to whatever's left so a
  // too-big config (normally blocked by the lobby's own budget check) can never overflow the
  // grid instead of silently trusting the caller.
  const extrasBudget = Math.max(0, pairsNeeded - 1);
  const clampedForfeits = forfeitLines.slice(0, extrasBudget);
  const clampedVibes = vibeDurations.slice(0, Math.max(0, extrasBudget - clampedForfeits.length));

  clampedForfeits.forEach((label, i) => {
    pairs.push({ kind: 'forfeit', pairId: `forfeit-${i}`, label });
  });
  clampedVibes.forEach((seconds, i) => {
    pairs.push({ kind: 'vibe', pairId: `vibe-${i}`, label: `${seconds}s`, duration: seconds });
  });
  pairs.push({ kind: 'win', pairId: 'win', label: 'WIN' });

  const fillerNeeded = Math.max(0, pairsNeeded - pairs.length);
  for (let i = 0; i < fillerNeeded; i++) {
    const rank = RANKS[i % RANKS.length];
    const cycle = Math.floor(i / RANKS.length);
    const suitA = SUITS[(cycle * 2) % SUITS.length];
    const suitB = SUITS[(cycle * 2 + 1) % SUITS.length];
    pairs.push({ kind: 'standard', pairId: `std-${i}`, label: rank, suitA, suitB });
  }

  const cards = [];
  for (const pair of pairs) {
    if (pair.kind === 'standard') {
      cards.push({ kind: pair.kind, pairId: pair.pairId, label: pair.label, suit: pair.suitA });
      cards.push({ kind: pair.kind, pairId: pair.pairId, label: pair.label, suit: pair.suitB });
    } else {
      cards.push({ kind: pair.kind, pairId: pair.pairId, label: pair.label, duration: pair.duration });
      cards.push({ kind: pair.kind, pairId: pair.pairId, label: pair.label, duration: pair.duration });
    }
  }

  // Odd grid cell counts (e.g. 5x5) get one inert filler card with a unique pairId — it can
  // never match, so it just sits on the board doing nothing.
  while (cards.length < total) {
    cards.push({ kind: 'blank', pairId: `blank-${cards.length}`, label: '' });
  }

  const rng = makeRng(seed >>> 0);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  return cards.map((c, pos) => ({ ...c, pos, matched: false }));
}

export function isMatch(cardA, cardB) {
  return !!cardA && !!cardB && cardA.pairId === cardB.pairId;
}
