const STORAGE_KEY = 'vibeMode';

export const VIBE_MODES = [
  { id: 'random', label: 'Random' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'ultra', label: 'Ultra' },
  { id: 'wave', label: 'Wave' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'tease', label: 'Tease' },
  { id: 'ramp', label: 'Ramp' },
  { id: 'tempo', label: 'Tempo' },
];

const VIBE_MODE_IDS = new Set(VIBE_MODES.map(m => m.id));

export function getVibeMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && VIBE_MODE_IDS.has(saved)) return saved;
  } catch {}
  return 'random';
}

export function setVibeMode(id) {
  if (!VIBE_MODE_IDS.has(id)) return;
  try { localStorage.setItem(STORAGE_KEY, id); } catch {}
}

export function vibeModeLabel(id) {
  return VIBE_MODES.find(m => m.id === id)?.label ?? id;
}

// Each mode is a shape over time producing a fraction of `base` (the game's own
// contextual intensity, 0..1) so patterns still respect e.g. "close to losing" ramps.
// Percentages below are literal fractions of `base` — at base=1.0 they reach their
// full spec'd peak (e.g. Ultra hits 100%, Wave peaks at 80%).
export function createVibeModeDriver(mode) {
  let t = 0;
  let randomTarget = 0.5;
  let randomHoldMs = 500;

  function pickRandom() {
    randomTarget = 0.30 + Math.random() * 0.70; // 30%–100%
    randomHoldMs = 200 + Math.random() * 1300;   // 0.2s–1.5s
    t = 0;
  }
  if (mode === 'random') pickRandom();

  return {
    sample(dtMs, base) {
      t += dtMs;
      switch (mode) {
        case 'low':    return 0.30 * base;
        case 'medium': return 0.55 * base;
        case 'high':   return 0.80 * base;
        case 'ultra':  return 1.00 * base;
        case 'wave': {
          // 4s loop: 2s ramp 20%→80%, 2s ramp back down
          const frac = 0.5 - 0.3 * Math.cos((2 * Math.PI * t) / 4000);
          return frac * base;
        }
        case 'pulse':
          // 1s loop: 0.5s on @80%, 0.5s off
          return (t % 1000 < 500 ? 0.80 : 0) * base;
        case 'tease': {
          // 2.5s loop: 3x(0.15s on@75% / 0.15s off), 0.4s on@85%, 1.2s off
          const phase = t % 2500;
          if (phase < 900) return (phase % 300 < 150 ? 0.75 : 0) * base;
          if (phase < 1300) return 0.85 * base;
          return 0;
        }
        case 'ramp': {
          // 3.1s loop: linear climb 25%→95% over 3s, instant drop
          const phase = t % 3100;
          return (phase < 3000 ? 0.25 + 0.70 * (phase / 3000) : 0.25) * base;
        }
        case 'tempo': {
          // 0.9s loop: 0.2s on@70%, 0.1s off, 0.2s on@85%, 0.4s off
          const phase = t % 900;
          if (phase < 200) return 0.70 * base;
          if (phase < 300) return 0;
          if (phase < 500) return 0.85 * base;
          return 0;
        }
        case 'random':
        default:
          if (t >= randomHoldMs) pickRandom();
          return randomTarget * base;
      }
    },
  };
}
