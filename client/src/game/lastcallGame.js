import { makeRng, rngInt } from './seededRng.js';
import { buildDeck } from './hiloGame.js';

export { buildDeck };

export const SECONDS_PER_GUESS = 10;

// Power-up identifiers — must match the server whitelist.
export const LC_POWER_LABELS = {
  peek:       'Peek 👁',
  doubledown: 'Double Down ✕2',
  pattern:    'Change Pattern 〰',
  drain:      'Drain 🧲',
  leech:      'Leech 🩸',
  hijack:     'Hijack 🎚',
  tax:        'Tax 💸',
  lockbox:    'Lockbox 🔒',
  timeheist:  'Time Heist ⏱',
};

export const LC_POWER_DESC = {
  peek:       'Reveal the next card before you guess — a guaranteed +10s.',
  doubledown: 'Your current streak banks +20s per correct (instead of +10) until you miss.',
  pattern:    'Your next run pulses and waves instead of a steady buzz.',
  drain:      "Instantly rip 30s out of an opponent's bank.",
  leech:      'Your next Drain is added to your own bank instead of just deleted.',
  hijack:     "While an opponent is running the vibes, seize the slider for 10s.",
  tax:        "An opponent's next correct guesses bank only half until they miss.",
  lockbox:    'Shield: blocks the next Drain aimed at your bank.',
  timeheist:  'Cut 60 seconds off the shared game clock.',
};

// Pools — Time Heist only makes sense with a clock.
export const LC_POOL_BASE  = ['peek', 'doubledown', 'pattern', 'drain', 'leech', 'hijack', 'tax', 'lockbox'];
export const LC_POOL_TIMER = [...LC_POOL_BASE, 'timeheist'];

// A power-up that needs an opponent target to use.
export const LC_TARGETED = new Set(['drain']);

export function lcDeckRng(seed, cycle) {
  return makeRng((((seed >>> 0) * 31 + cycle * 2654435761 + 17) | 0) >>> 0);
}
export function lcPowerRng(seed, cycle) {
  return makeRng((((seed >>> 0) * 31 + cycle * 40503 + 101) | 0) >>> 0);
}

// Sprinkle power-ups into [start, start+count) of the absolute card sequence.
export function extendPowerMap(map, start, count, rng, pool) {
  let i = start + 3 + rngInt(rng, 0, 3);
  const end = start + count;
  while (i < end - 1) {
    map.set(i, pool[rngInt(rng, 0, pool.length - 1)]);
    i += 5 + rngInt(rng, 0, 3);
  }
  return map;
}

export function pickStarterIndex(rng, count) {
  return rngInt(rng, 0, count - 1);
}
