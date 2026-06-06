import rawForfeits from './beatdealerForfeits.txt?raw';
import { makeRng, rngInt } from './seededRng.js';

// Each forfeit line may carry a difficulty tier: "[1] text" .. "[3] text".
// We strip the prefix for display and keep a text → tier lookup alongside.
const PARSED_FORFEITS = rawForfeits
  .split('\n')
  .map(l => l.trim())
  .filter(l => l.length > 0 && !l.startsWith('#'))
  .map(line => {
    const m = line.match(/^\[([1-3])\]\s*(.+)$/);
    return m ? { text: m[2].trim(), tier: parseInt(m[1], 10) } : { text: line, tier: 2 };
  });

export const ORIGINAL_FORFEITS = PARSED_FORFEITS.map(p => p.text);
const FORFEIT_TIERS = new Map(PARSED_FORFEITS.map(p => [p.text, p.tier]));

// Difficulty tier (1 easy … 3 hardest) for any forfeit text, including vibe entries.
export function forfeitTier(text) {
  if (FORFEIT_TIERS.has(text)) return FORFEIT_TIERS.get(text);
  const secs = parseVibeForfeit(text);
  if (secs !== null) return secs <= 15 ? 1 : secs <= 60 ? 2 : 3;
  return 2;
}

const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
const VALUE_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function cardLabel(card) {
  return VALUE_LABELS[card.value] + SUIT_SYMBOLS[card.suit];
}

export function isRed(card) {
  return card.suit === 'H' || card.suit === 'D';
}

function buildDeck() {
  const deck = [];
  for (const suit of ['S', 'H', 'D', 'C']) {
    for (let value = 1; value <= 13; value++) {
      deck.push({ value, suit });
    }
  }
  return deck;
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rngInt(rng, 0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const HAND_SIZE = 5;

// Deal a fresh hand of HAND_SIZE cards to the dealer and each player. A new
// shuffle is produced per dealIndex, so when hands run out we re-deal
// deterministically (both clients derive the same cards from seed + dealIndex).
export function dealHands(seed, dealIndex) {
  const rng = makeRng(((seed ^ 0x5bd1e995) + dealIndex * 0x9e3779b1) >>> 0);
  const deck = shuffle(buildDeck(), rng);
  return {
    computer: deck.slice(0, HAND_SIZE),
    host:     deck.slice(HAND_SIZE, HAND_SIZE * 2),
    guest:    deck.slice(HAND_SIZE * 2, HAND_SIZE * 3),
  };
}

// Pick which of the dealer's remaining cards to play for a given forfeit tier.
// Higher tier → higher card, so harder forfeits are harder to beat.
export function pickDealerCardByTier(cards, tier) {
  if (cards.length === 0) return null;
  const sorted = [...cards].sort((a, b) => a.value - b.value || a.suit.localeCompare(b.suit));
  let idx;
  if (tier <= 1)      idx = 0;                                  // lowest
  else if (tier >= 3) idx = sorted.length - 1;                 // highest
  else                idx = Math.floor((sorted.length - 1) / 2); // middle
  return sorted[idx];
}

export function shuffleForfeits(seed) {
  const rng = makeRng((seed ^ 0xDEADBEEF) >>> 0);
  return shuffle([...ORIGINAL_FORFEITS], rng);
}

const VIBE_DURATIONS = [10, 30, 60, 90, 120];

export function buildForfeitPool(seed) {
  const rng = makeRng((seed ^ 0xDEADBEEF) >>> 0);
  const vibeEntries = VIBE_DURATIONS.map(n => `Vibe ${n}s`);
  return shuffle([...ORIGINAL_FORFEITS, ...vibeEntries], rng);
}

// Returns seconds if text matches a vibe-time forfeit ("Vibe Xs"), else null.
export function parseVibeForfeit(text) {
  const m = text.match(/^Vibe (\d+)s$/);
  return m ? parseInt(m[1], 10) : null;
}

// Strictly higher value beats the computer. Ties lose.
export function beats(playerCard, cpuCard) {
  return playerCard.value > cpuCard.value;
}
