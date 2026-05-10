import { rngInt } from './seededRng.js';

export const COLORS = ['R', 'G', 'B', 'W'];

export function getBaseConfig() {
  return { slots: 3, guesses: 5, timeMs: 30_000 };
}

export function nextRoundConfig(prev, bothSucceeded) {
  const timeFactor = bothSucceeded ? 1.1 : 1.5;
  return {
    slots: prev.slots + 1,
    guesses: prev.guesses + 1,
    timeMs: Math.round(prev.timeMs * timeFactor),
  };
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
