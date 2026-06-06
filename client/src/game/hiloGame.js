import { makeRng, rngInt } from './seededRng.js';

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RED_SUITS = new Set(['♥', '♦']);
export const VALUE_NAMES = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const POWER_UP_TYPES = ['doubleTime', 'freeLife', 'allOrNothing', 'peek', 'skip', 'freeze', 'surge', 'chain', 'maxIntensity', 'shield', 'mirror'];
export const POWER_UP_LABELS = {
  doubleTime:    'Double Time',
  freeLife:      'Free Life',
  allOrNothing:  'All or Nothing',
  peek:          'Peek',
  skip:          'Skip',
  freeze:        'Freeze',
  surge:         'Surge',
  chain:         'Chain',
  maxIntensity:  'Max Intensity',
  shield:        'Shield',
  mirror:        'Mirror',
};

export function buildDeck(rng, numDecks = 1) {
  const deck = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of SUITS) {
      for (let v = 1; v <= 13; v++) {
        deck.push({ value: v, suit, name: VALUE_NAMES[v] });
      }
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rngInt(rng, 0, i);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function computeVibeDurationMs(cardValue) {
  const difficulty = 1 - Math.abs(cardValue - 7) / 6;
  return Math.round((1 + difficulty * 29) * 1000);
}

export function buildPowerUpMap(rng, deckSize) {
  const map = new Map();
  let i = 5 + rngInt(rng, 0, 4);
  while (i < deckSize - 1) {
    const type = POWER_UP_TYPES[rngInt(rng, 0, POWER_UP_TYPES.length - 1)];
    map.set(i, type);
    i += 5 + rngInt(rng, 0, 4);
  }
  return map;
}

export function pickStartingRole(rng) {
  return rng() < 0.5 ? 'host' : 'guest';
}

export function buildCycleRngs(baseSeed, cycleIndex) {
  const deckRng = makeRng(((baseSeed * 31 + cycleIndex * 7 + 1) | 0) >>> 0);
  const puRng   = makeRng(((baseSeed * 31 + cycleIndex * 7 + 3) | 0) >>> 0);
  return { deckRng, puRng };
}
