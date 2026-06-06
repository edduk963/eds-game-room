import { rngInt } from './seededRng.js';

export const COLORS = ['R', 'G', 'B', 'W'];

export const POWERUPS = [
  { id: 'hint',         label: 'Hint',     cost: 3, desc: 'Reveal a code slot (both see it)' },
  { id: 'zap',          label: 'Zap',      cost: 2, desc: 'Buzz your opponent right now' },
  { id: 'skip',         label: 'Skip',     cost: 4, desc: "Skip opponent's next turn" },
  { id: 'add_guess',    label: '+1 Guess', cost: 2, desc: 'Add an extra guess row to the board' },
  { id: 'remove_guess', label: '−1 Guess', cost: 3, desc: 'Remove an empty guess from the board' },
];

export function chargesFromGuess(positions) {
  return positions.filter(p => p === 'place').length;
}

// First win = 30s, doubles with each win (30, 60, 120, 240…)
export function calcVibeEarned(winCount) {
  return 30 * Math.pow(2, winCount - 1);
}

function guessesForSlots(slots, mode) {
  // Guesses scale proportionally with the clue length (slots).
  // easy: slots  (positional feedback is strong, so fewer attempts)
  // hard: slots*2 (count-only feedback, so twice the attempts to stay fair)
  return mode === 'easy' ? slots : slots * 2;
}

export function getBaseConfig(mode = 'easy') {
  const slots = 3;
  return { slots, guesses: guessesForSlots(slots, mode) };
}

export function nextRoundConfig(prev, mode = 'easy') {
  const slots = prev.slots + 1;
  return { slots, guesses: guessesForSlots(slots, mode) };
}

export function generateCode(rng, slots) {
  return Array.from({ length: slots }, () => COLORS[rngInt(rng, 0, COLORS.length - 1)]);
}

export function preForfeitSeconds(rng, totalRounds) {
  return Array.from({ length: totalRounds }, (_, i) => {
    const max = 30 * (2 ** i);
    return rngInt(rng, 10, max);
  });
}

export function evaluateGuessPositional(code, guess) {
  const result = new Array(guess.length).fill('empty');
  const codeUsed = new Array(code.length).fill(false);
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === code[i]) { result[i] = 'place'; codeUsed[i] = true; }
  }
  for (let i = 0; i < guess.length; i++) {
    if (result[i] === 'place') continue;
    for (let j = 0; j < code.length; j++) {
      if (!codeUsed[j] && guess[i] === code[j]) { result[i] = 'color'; codeUsed[j] = true; break; }
    }
  }
  return result;
}

export function evaluateGuess(code, guess) {
  let rightPlace = 0;
  const codePool = [];
  const guessPool = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === guess[i]) {
      rightPlace++;
    } else {
      codePool.push(code[i]);
      guessPool.push(guess[i]);
    }
  }
  let rightColor = 0;
  for (const g of guessPool) {
    const idx = codePool.indexOf(g);
    if (idx !== -1) {
      rightColor++;
      codePool.splice(idx, 1);
    }
  }
  return { rightPlace, rightColor };
}
