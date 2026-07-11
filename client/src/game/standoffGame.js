import { makeRng, rngInt } from './seededRng.js';

export const BATTLEFIELD_POOL = [
  { id: 'vault',  name: 'The Vault',  icon: 'vault',  pts: 3, rate: 8,  special: null },
  { id: 'armory', name: 'The Armory', icon: 'armory', pts: 2, rate: 6,  special: null },
  { id: 'gate',   name: 'The Gate',   icon: 'gate',   pts: 2, rate: 6,  special: null },
  { id: 'keep',   name: 'The Keep',   icon: 'keep',   pts: 1, rate: 4,  special: null },
  { id: 'gambit', name: 'The Gambit', icon: 'gambit', pts: null, rate: 12, special: 'gambit' },
  { id: 'curse',  name: 'The Curse',  icon: 'curse',  pts: 1, rate: 10, special: 'curse' },
  { id: 'bounty', name: 'The Bounty', icon: 'bounty', pts: 2, rate: 7,  special: 'bounty' },
  { id: 'mirror', name: 'The Mirror', icon: 'mirror', pts: 2, rate: 8,  special: 'mirror' },
  { id: 'shadow', name: 'The Shadow', icon: 'shadow', pts: 2, rate: 9,  special: 'shadow' },
];

export const SPY_FIELD = { id: 'spy', name: 'The Spy', icon: 'spy', pts: 0, rate: 5, special: 'spy' };

export const POWER_POOL = [
  { id: 'surge',     name: 'Surge',     desc: '+3 tokens this round' },
  { id: 'intel',     name: 'Intel',     desc: 'See opponent token count on one field before committing' },
  { id: 'reinforce', name: 'Reinforce', desc: 'After reveal, flip one field you lost by ≤2 tokens' },
  { id: 'sabotage',  name: 'Sabotage',  desc: 'After reveal, remove 3 tokens from one field opponent won' },
  { id: 'forfeit',   name: 'Forfeit',   desc: 'Concede one field, gain +4 tokens this round' },
  { id: 'ghost',     name: 'Ghost',     desc: "Opponent's live token counter shows 0/10 all round" },
];

// Fisher-Yates shuffle (does not mutate input).
function shuffle(arr, rng) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rngInt(rng, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Draw the 5 battlefields for a match from seed. Always [SPY, ...4 from pool].
export function drawBattlefields(seed) {
  const rng = makeRng(seed ^ 0x5f3a9c1b);
  const pool = shuffle(BATTLEFIELD_POOL, rng);
  return [SPY_FIELD, ...pool.slice(0, 4)];
}

// Draw 6 face-up power cards for the draft from seed (all 6, shuffled for display order).
export function drawPowerDraft(seed) {
  const rng = makeRng(seed ^ 0xc0ffee42);
  return shuffle(POWER_POOL, rng);
}

const PLAIN_FIELD_IDS = ['vault', 'armory', 'gate', 'keep'];
const SPECIAL_FIELD_IDS = ['gambit', 'curse', 'bounty', 'mirror', 'shadow'];

// Returns the 5 rounds' battlefield sets for a match.
// 'experienced': today's behavior — one fixed draw of [SPY, 4 random fields], same all 5 rounds.
// 'beginner': progressive reveal — round 1 is the 4 plain fields (no special rules) + Spy,
// round 2 swaps in 2 special fields, round 3 swaps in the last 2 (maxing out at 4 specials),
// rounds 4-5 keep round 3's set. Fields already introduced are never removed.
export function drawBattlefieldSchedule(seed, difficulty) {
  if (difficulty !== 'beginner') {
    const fixed = drawBattlefields(seed);
    return [fixed, fixed, fixed, fixed, fixed];
  }
  const rng = makeRng(seed ^ 0x5f3a9c1b);
  const byId = id => BATTLEFIELD_POOL.find(f => f.id === id);
  const plains = shuffle(PLAIN_FIELD_IDS.map(byId), rng);
  const specials = shuffle(SPECIAL_FIELD_IDS.map(byId), rng);
  const round1 = [SPY_FIELD, ...plains];
  const round2 = [SPY_FIELD, plains[2], plains[3], specials[0], specials[1]];
  const round3 = [SPY_FIELD, specials[0], specials[1], specials[2], specials[3]];
  return [round1, round2, round3, round3, round3];
}

// Host picks slots 0, 2, 4; guest picks 1, 3, 5.
export function isMyDraftTurn(role, pickIndex) {
  return pickIndex % 2 === (role === 'host' ? 0 : 1);
}

// Base token pool with escalation and comeback rule.
export function tokenPoolSize(roundIndex, myWins, oppWins) {
  let base = 10;
  if (roundIndex === 3) base = 12;
  if (roundIndex === 4) base = 14;
  const isTrailing = myWins === 0 && oppWins === 2;
  return base + (isTrailing ? 3 : 0);
}

// Vibe seconds for one player on one field.
export function fieldVibeSeconds(outcome, tokensPlaced, rate) {
  if (outcome === 'zero_tie') return 10;
  if (outcome === 'win')  return tokensPlaced * rate * 0.3;
  if (outcome === 'lose') return tokensPlaced * rate * 1.0;
  if (outcome === 'tie')  return tokensPlaced * rate * 1.5;
  return 0;
}

// Resolve a single battlefield. Returns per-player vibe and points.
// myTokens/oppTokens are from perspective A/B passed in.
export function resolveField(field, aTokens, bTokens, roundIndex, context = {}) {
  const { bountyCarried = false, round5 = false } = context;
  const ptsMult = round5 ? 2 : 1;

  // Zero-tie
  if (aTokens === 0 && bTokens === 0) {
    return {
      winner: null,
      ptsA: 0, ptsB: 0,
      vibeA: 10, vibeB: 10,
      gambitJackpot: false,
      curseLoser: null,
      bountyDoubled: false,
      outcome: 'zero_tie',
    };
  }

  let winner = aTokens > bTokens ? 'A' : (bTokens > aTokens ? 'B' : 'tie');
  let ptsA = 0, ptsB = 0;
  let vibeA = 0, vibeB = 0;
  let gambitJackpot = false;
  let curseLoser = null;
  let bountyDoubled = false;

  if (winner === 'tie') {
    vibeA = fieldVibeSeconds('tie', aTokens, field.rate);
    vibeB = fieldVibeSeconds('tie', bTokens, field.rate);
  } else {
    const winnerTokens = winner === 'A' ? aTokens : bTokens;
    const loserTokens  = winner === 'A' ? bTokens : aTokens;

    // Gambit special rules
    if (field.special === 'gambit') {
      const jackpot = winnerTokens === 1;
      gambitJackpot = jackpot;
      const pts = (jackpot ? 4 : 1) * ptsMult;
      ptsA = winner === 'A' ? pts : 0;
      ptsB = winner === 'B' ? pts : 0;
    } else {
      const basePts = (field.pts || 0) * ptsMult;
      ptsA = winner === 'A' ? basePts : 0;
      ptsB = winner === 'B' ? basePts : 0;
    }

    // Vibe
    vibeA = fieldVibeSeconds(winner === 'A' ? 'win' : 'lose', aTokens, field.rate);
    vibeB = fieldVibeSeconds(winner === 'B' ? 'win' : 'lose', bTokens, field.rate);

    // Curse: loser gets +30s flat
    if (field.special === 'curse') {
      curseLoser = winner === 'A' ? 'B' : 'A';
      if (curseLoser === 'A') vibeA += 30;
      else vibeB += 30;
    }
  }

  // Bounty: tie → carry over
  if (field.special === 'bounty' && winner === 'tie') {
    bountyDoubled = true;
    // Vibe already applied as tie; flag carry for next round
  }

  return { winner, ptsA, ptsB, vibeA, vibeB, gambitJackpot, curseLoser, bountyDoubled, outcome: winner === 'tie' ? 'tie' : (winner ? 'decided' : 'zero_tie') };
}

// Resolve all 5 fields for a round.
// myAlloc and oppAlloc are { fieldId: tokenCount } from the calling player's perspective (A/B not relevant — fields indexed by id).
// We need the host/guest split. The caller passes allocations in A/B terms:
// aAlloc = { fieldId: count }, bAlloc = { fieldId: count }
export function resolveRound(fields, aAlloc, bAlloc, roundIndex, context = {}) {
  const { bountyCarried = false, round5 = roundIndex === 4 } = context;
  const roundContext = { ...context, round5 };

  const fieldResults = {};
  let ptsA = 0, ptsB = 0;
  let fieldsWonA = 0, fieldsWonB = 0;
  let vibeSecondsA = 0, vibeSecondsB = 0;
  let spyWonBy = null;
  let bountyCarriedToNext = false;

  for (const f of fields) {
    const aT = aAlloc[f.id] ?? 0;
    const bT = bAlloc[f.id] ?? 0;

    // Bounty auto-double on round 5 if carried
    const fieldCtx = {
      ...roundContext,
      bountyCarried: f.id === 'bounty' && bountyCarried,
    };

    const fr = resolveField(f, aT, bT, roundIndex, fieldCtx);
    fieldResults[f.id] = fr;

    ptsA += fr.ptsA;
    ptsB += fr.ptsB;
    vibeSecondsA += fr.vibeA;
    vibeSecondsB += fr.vibeB;

    if (f.special === 'bounty' && fr.bountyDoubled) {
      bountyCarriedToNext = true;
    }
    if (f.id === 'bounty' && bountyCarried && round5 && fr.winner !== null && fr.winner !== 'tie') {
      // Bounty auto-double on round 5: double vibe regardless of winner
      vibeSecondsA += fr.vibeA;
      vibeSecondsB += fr.vibeB;
    }

    if (fr.winner === 'A') { if (f.id !== 'spy') fieldsWonA++; else spyWonBy = 'A'; }
    else if (fr.winner === 'B') { if (f.id !== 'spy') fieldsWonB++; else spyWonBy = 'B'; }
  }

  // Round winner
  let roundWinner;
  if (fieldsWonA > fieldsWonB) roundWinner = 'A';
  else if (fieldsWonB > fieldsWonA) roundWinner = 'B';
  else roundWinner = 'tie';

  // Round loss vibe bonus: loser takes 20s per field deficit
  if (roundWinner === 'A') {
    vibeSecondsB += (fieldsWonA - fieldsWonB) * 20;
  } else if (roundWinner === 'B') {
    vibeSecondsA += (fieldsWonB - fieldsWonA) * 20;
  }

  return {
    fieldResults,
    fieldsWonA, fieldsWonB,
    ptsA, ptsB,
    roundWinner,
    vibeSecondsA,
    vibeSecondsB,
    spyWonBy,
    bountyCarriedToNext,
    alloc: { A: { ...aAlloc }, B: { ...bAlloc } },
  };
}

// Tiebreaker when equal fields won: compare total point value.
export function resolveRoundTie(result) {
  if (result.ptsA > result.ptsB) return 'A';
  if (result.ptsB > result.ptsA) return 'B';
  return 'draw';
}

// Apply post-reveal powers. Resolution order: Forfeit → Sabotage → Reinforce.
// myPower / oppPower: { power: 'reinforce'|'sabotage', fieldId } | null
// Perspective: myKey is 'A' or 'B'.
export function applyPostRevealPowers(result, myPower, oppPower, fields, myKey) {
  const oppKey = myKey === 'A' ? 'B' : 'A';
  // Deep clone field results
  const fr = {};
  for (const id in result.fieldResults) fr[id] = { ...result.fieldResults[id] };
  let { ptsA, ptsB, fieldsWonA, fieldsWonB, vibeSecondsA, vibeSecondsB } = result;

  // Cancel same-power same-field
  if (myPower && oppPower &&
      myPower.power === oppPower.power &&
      myPower.fieldId === oppPower.fieldId) {
    myPower = null; oppPower = null;
  }

  // Apply Sabotage first
  function applySabotage(byKey, targetFieldId) {
    const f = fields.find(f => f.id === targetFieldId);
    if (!f) return;
    const res = fr[targetFieldId];
    if (!res) return;
    const victimKey = byKey === 'A' ? 'B' : 'A';
    if (res.winner !== victimKey) return; // victim must have won this field
    const aT = result.alloc.A[targetFieldId] ?? 0;
    const bT = result.alloc.B[targetFieldId] ?? 0;
    const newA = victimKey === 'A' ? Math.max(0, aT - 3) : aT;
    const newB = victimKey === 'B' ? Math.max(0, bT - 3) : bT;
    const newRes = resolveField(f, newA, newB, result.roundIndex || 0, {});
    const oldRes = fr[targetFieldId];
    ptsA += newRes.ptsA - oldRes.ptsA;
    ptsB += newRes.ptsB - oldRes.ptsB;
    if (oldRes.winner !== newRes.winner) {
      if (oldRes.winner === 'A') fieldsWonA--; else if (oldRes.winner === 'B') fieldsWonB--;
      if (newRes.winner === 'A') fieldsWonA++; else if (newRes.winner === 'B') fieldsWonB++;
    }
    fr[targetFieldId] = newRes;
  }

  function applyReinforce(byKey, targetFieldId) {
    const f = fields.find(f => f.id === targetFieldId);
    if (!f) return;
    const res = fr[targetFieldId];
    if (!res) return;
    // Must have lost by ≤2
    const aT = result.alloc.A[targetFieldId] ?? 0;
    const bT = result.alloc.B[targetFieldId] ?? 0;
    const myT   = byKey === 'A' ? aT : bT;
    const oppT  = byKey === 'A' ? bT : aT;
    if (res.winner !== (byKey === 'A' ? 'B' : 'A')) return; // didn't lose it
    if (oppT - myT > 2) return; // lost by more than 2
    // Flip: add 2 tokens to my side
    const newMyT = myT + 2;
    const newA = byKey === 'A' ? newMyT : aT;
    const newB = byKey === 'B' ? newMyT : bT;
    const newRes = resolveField(f, newA, newB, result.roundIndex || 0, {});
    const oldRes = fr[targetFieldId];
    ptsA += newRes.ptsA - oldRes.ptsA;
    ptsB += newRes.ptsB - oldRes.ptsB;
    if (oldRes.winner !== newRes.winner) {
      if (oldRes.winner === 'A') fieldsWonA--; else if (oldRes.winner === 'B') fieldsWonB--;
      if (newRes.winner === 'A') fieldsWonA++; else if (newRes.winner === 'B') fieldsWonB++;
    }
    fr[targetFieldId] = newRes;
  }

  if (myPower?.power === 'sabotage') applySabotage(myKey, myPower.fieldId);
  if (oppPower?.power === 'sabotage') applySabotage(oppKey, oppPower.fieldId);
  if (myPower?.power === 'reinforce') applyReinforce(myKey, myPower.fieldId);
  if (oppPower?.power === 'reinforce') applyReinforce(oppKey, oppPower.fieldId);

  // Recompute round winner
  let roundWinner;
  if (fieldsWonA > fieldsWonB) roundWinner = 'A';
  else if (fieldsWonB > fieldsWonA) roundWinner = 'B';
  else roundWinner = 'tie';

  return { ...result, fieldResults: fr, ptsA, ptsB, fieldsWonA, fieldsWonB, roundWinner };
}

// Total vibe seconds for one player in a round.
export function roundVibeSeconds(result, perspective) {
  return perspective === 'A' ? result.vibeSecondsA : result.vibeSecondsB;
}

// Match-end vibe for winner and loser.
export function matchEndVibeSeconds(allRoundResults, winner) {
  let winnerSeconds = 0;
  let loserSeconds = 0;
  const loser = winner === 'A' ? 'B' : 'A';

  for (const r of allRoundResults) {
    // Winner accrues their win-tax from all fields
    winnerSeconds += roundVibeSeconds(r, winner) * 0.5; // half their accumulated during match
    // Point differential for final penalty
    const winnerPts = winner === 'A' ? r.ptsA : r.ptsB;
    const loserPts  = loser  === 'A' ? r.ptsA : r.ptsB;
    loserSeconds += Math.max(0, winnerPts - loserPts) * 15;
  }
  loserSeconds = Math.max(60, loserSeconds); // minimum 1 minute
  return { winnerSeconds: Math.round(winnerSeconds), loserSeconds: Math.round(loserSeconds) };
}

// Check if a player has won the match (best of 5 rounds, first to 3).
export function checkMatchWinner(hostWins, guestWins) {
  if (hostWins >= 3) return 'host';
  if (guestWins >= 3) return 'guest';
  return null;
}
