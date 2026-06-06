import { makeRng, rngInt } from './seededRng.js';

// ── Island definitions ─────────────────────────────────────────────────────
export const ISLANDS = [
  { name: 'Sandy Beach',    type: 'attack',   pos: [0.50, 0.12] },
  { name: 'Volcano',        type: 'defence',  pos: [0.78, 0.20] },
  { name: 'Rocky Desert',   type: 'stamina',  pos: [0.88, 0.50] },
  { name: 'Dark Earth',     type: 'armour',   pos: [0.78, 0.80] },
  { name: 'Green Forest',   type: 'spell',    pos: [0.50, 0.88] },
  { name: 'Dark Swamp',     type: 'attack',   pos: [0.22, 0.80] },
  { name: 'Flower Forest',  type: 'defence',  pos: [0.12, 0.50] },
  { name: 'Gray Peaks',     type: 'stamina',  pos: [0.22, 0.20] },
];
export const WIZARD_POS = [0.50, 0.50];

// Card pool per type — {value, label, description, special}
const ATTACK_CARDS = [
  { value: 3, label: '+3', description: '' },
  { value: 4, label: '+4', description: '' },
  { value: 5, label: '+5', description: 'Bloodlust: Edge once to raise attack +1 for this battle.' },
  { value: 5, label: '+5', description: '' },
  { value: 6, label: '+6', description: '' },
  { value: 8, label: '+8', description: 'Edge every time you take a hit during this battle.' },
  { value: 8, label: '+8', description: 'Broken Sword: return to deck after one battle.' },
  { value: 1, label: '+1', description: 'Rapier: each sequential successful hit is worth +1 extra (stacks).' },
  { value: 2, label: '+2', description: '' },
  { value: 8, label: '8',  description: 'If you run out of armour you must stroke continuously until you collect new armour.' },
];

const DEFENCE_CARDS = [
  { value: 3, label: '+3', description: '' },
  { value: 3, label: '+3', description: '+3 × your armour count.' },
  { value: 4, label: '+4', description: '' },
  { value: 5, label: '+5', description: '' },
  { value: 6, label: '+6', description: 'On a hit, make opponent roll and spank that many times.' },
  { value: 8, label: '+8', description: 'All armour breaks on your first hit.' },
  { value: 8, label: '+8', description: 'Mirror: you also do any forfeit the other player must do.' },
  { value: 4, label: '+4', description: 'No armour: takes two slots, +10 defence and +10 attack instead.' },
];

const STAMINA_CARDS = [
  { value: 1, label: '+1', description: '' },
  { value: 2, label: '+2', description: '' },
  { value: 3, label: '+3', description: '' },
  { value: 1, label: '+1', description: 'Do 20 press-ups for a bonus +1.' },
  { value: 3, label: '+3', description: 'Wear vibe for 3 min per fight, opponent controls.' },
  { value: 1, label: '+1', description: 'Testosterone: edge in battle to regain 1 stamina (once per battle).' },
];

const ARMOUR_CARDS = [
  { value: 1, label: '+1', description: 'Underwear' },
  { value: 1, label: '+1', description: 'Pants' },
  { value: 1, label: '+1', description: 'Shirt' },
  { value: 1, label: '+1', description: 'Hat' },
  { value: 1, label: '+1', description: 'Pants — +3 Defence' },
  { value: 1, label: '+1', description: 'Ghost Armour (counts as nothing)' },
  { value: 1, label: '+1', description: 'Thorny Armour: attacker takes 1 damage each time you are hit.' },
  { value: 1, label: '+1', description: 'Underwear — +5 Defence' },
  { value: 1, label: '+1', description: 'Shirt — +2 Defence' },
  { value: 1, label: '+1', description: 'Shirt — +2 Defence, +1 Stamina' },
];

// ── Spell pool ─────────────────────────────────────────────────────────────
export const SPELL_POOL = [
  // immediate spells
  { id: 'gust',       name: 'Gust',        timing: 'immediate', description: 'Push opponent back 1 island.' },
  { id: 'bolt',       name: 'Bolt',        timing: 'immediate', description: 'Deal 2 stamina damage to opponent (bypasses armour).' },
  { id: 'mirror',     name: 'Mirror',      timing: 'immediate', description: 'Swap island positions with opponent.' },
  { id: 'confiscate', name: 'Confiscate',  timing: 'immediate', description: 'Steal 1 armour piece from opponent.' },
  { id: 'mend',       name: 'Mend',        timing: 'immediate', description: 'Restore 2 stamina (max 10).' },
  { id: 'rust',       name: 'Rust',        timing: 'immediate', description: "Reduce opponent's next battle attack by 2." },
  { id: 'veil',       name: 'Veil',        timing: 'immediate', description: "Skip opponent's next island card effect." },
  { id: 'fog',        name: 'Fog',         timing: 'immediate', description: 'Dice rolls are hidden from opponent for 1 turn.' },
  { id: 'smite',      name: 'Smite',       timing: 'immediate', description: 'Opponent feels a 3-second haptic pulse.' },
  { id: 'recall',     name: 'Recall',      timing: 'immediate', description: 'Wizard teleports back to his tower.' },
  // held spells
  { id: 'leap',       name: 'Leap',        timing: 'held', description: 'Teleport yourself to any island.' },
  { id: 'shield',     name: 'Shield Ward', timing: 'held', description: 'Cancel the next battle you would enter.' },
  { id: 'doubleedge', name: 'Double Edge', timing: 'held', description: 'Your next attack roll counts twice.' },
  { id: 'summon',     name: 'Summon',      timing: 'held', description: "Move the wizard to opponent's island." },
  { id: 'ironskin',   name: 'Iron Skin',   timing: 'held', description: 'Gain 2 temporary armour for your next battle.' },
  { id: 'curse',      name: 'Curse',       timing: 'held', description: 'Opponent draws a Dark Wizard Spell next turn.' },
  { id: 'drain',      name: 'Drain',       timing: 'held', description: 'Life-steal in your next battle: each point of stamina they lose, you gain.' },
  { id: 'hex',        name: 'Hex',         timing: 'held', description: "Set opponent's defence to 1 for their next battle." },
  { id: 'blink',      name: 'Blink',       timing: 'held', description: 'After rolling, move an additional 1–4 islands.' },
  { id: 'overload',   name: 'Overload',    timing: 'held', description: 'Full-intensity haptic for 5s, then +3 attack in your next battle.' },
];

// ── Dark Wizard Spell (forfeit) pool ───────────────────────────────────────
export const WIZARD_SPELL_POOL = [
  'The wizard commands: do whatever [winner] says for 3 minutes.',
  'Remove one item of clothing now.',
  'Wear the vibe under [winner]\'s control for 60 seconds.',
  'Answer one question [winner] asks fully and truthfully.',
  'Stay kneeling until [winner] releases you (max 5 minutes).',
  'You may not speak for 10 minutes — communicate only by writing.',
  'Complete the dare [winner] invents within 2 minutes.',
  'Take a drink of [winner]\'s choosing.',
  '[Winner] assigns you one task to complete before the night ends.',
  'Complete two other forfeits from this list instead of one.',
  'Edge once every time you lose all armour for the rest of the game.',
  'After the game the other player can vibe you for 30 minutes at times of their choice.',
  'Wear the vibe under control for 10 min — if you do NOT cum, game continues.',
  '[Winner] can make you edge at any time (including nights) up to 3 times. Game continues.',
  'The other player can design a game for you to play immediately. Game over.',
  'Both players move to the dark wizard and battle him for at least two more fights.',
  'You will edge once for each item of armour the other player currently has.',
  'The other player vibe-edges you for 5 minutes (position of their choice).',
];

// ── Initial game state factory ─────────────────────────────────────────────
export function createGameState(seed, winCondition, spellLimit, nameA, nameB) {
  const rng = makeRng(seed ^ 0xf17a8d);
  // Pre-shuffle the spell pool indices for deterministic draws
  const spellIndices = Array.from({ length: SPELL_POOL.length }, (_, i) => i);
  shuffleArray(spellIndices, rng);

  const wfIndices = Array.from({ length: WIZARD_SPELL_POOL.length }, (_, i) => i);
  shuffleArray(wfIndices, rng);

  return {
    phase: 'pregame',
    subPhase: null,
    turn: 0,
    winCondition,
    spellLimit,
    totalForfeits: 0,
    fogTurns: 0,
    players: {
      A: makePlayer(nameA),
      B: makePlayer(nameB),
    },
    wizard: {
      island: 6, // starts at Flower Forest (index 6, roughly W)
      attack: 8,
      defence: 7,
      stamina: 7,
      armour: 3,
      maxStamina: 7,
      maxArmour: 3,
      defeated: false,
      summonPending: false,
    },
    islands: ISLANDS.map((_, i) => ({ card: null, sunk: false })),
    battleState: null,
    pendingEvents: [],
    spellDeck: spellIndices,
    spellDeckIdx: 0,
    wizardSpellDeck: wfIndices,
    wizardSpellDeckIdx: 0,
  };
}

function makePlayer(name) {
  return {
    name,
    island: 0,
    attack: { value: 2, label: '+2', description: '' },
    defence: { value: 1, label: '+1', description: '' },
    stamina: 5,
    maxStamina: 10,
    armour: 0,
    spells: [],
    // transient battle modifiers (reset each battle)
    attackDebuff: 0,
    defenceOverride: null,
    tempArmour: 0,
    doubleNextAttack: false,
    lifeSteal: false,
    cancelNextBattle: false,
    skipNextIsland: false,
    cursed: false,
    attackBonus: 0,
    // logs
    forfeitLog: [],
  };
}

function shuffleArray(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rngInt(rng, 0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ── Deal islands ───────────────────────────────────────────────────────────
// Assigns one face-down card to each island using shared RNG.
// Card type mirrors the island's natural type, but the specific card index is random.
export function dealIslands(gs, rng) {
  const pools = {
    attack:  ATTACK_CARDS,
    defence: DEFENCE_CARDS,
    stamina: STAMINA_CARDS,
    armour:  ARMOUR_CARDS,
    spell:   SPELL_POOL,
  };
  gs.islands.forEach((island, i) => {
    if (island.sunk) { island.card = null; return; }
    const type = ISLANDS[i].type;
    const pool = pools[type];
    const idx = rngInt(rng, 0, pool.length - 1);
    island.card = { type, idx, revealed: false };
  });
}

// ── Roll resolution ────────────────────────────────────────────────────────
// Always consumes RNG in fixed order. Returns array of event objects.
export function resolveRolls(gs, rng) {
  // Pre-consume all RNG calls regardless of branching
  const rollA = rngInt(rng, 1, 4);
  const rollB = rngInt(rng, 1, 4);
  const wizMove = rngInt(rng, 1, 2);
  // 8 island card deal calls (consumed even if not all needed)
  dealIslands(gs, rng);

  if (gs.fogTurns > 0) gs.fogTurns--;

  // Move players
  const prevA = gs.players.A.island;
  const prevB = gs.players.B.island;

  let newA = (prevA + rollA) % 8;
  let newB = (prevB + rollB) % 8;

  // Blink spell: consume extra rng for blink if active
  const blinkExtraA = rngInt(rng, 1, 4);
  const blinkExtraB = rngInt(rng, 1, 4);
  if (gs.players.A._blink) { newA = (newA + blinkExtraA) % 8; gs.players.A._blink = false; }
  if (gs.players.B._blink) { newB = (newB + blinkExtraB) % 8; gs.players.B._blink = false; }

  // Advance past sunk islands
  while (gs.islands[newA].sunk) newA = (newA + 1) % 8;
  while (gs.islands[newB].sunk) newB = (newB + 1) % 8;

  gs.players.A.island = newA;
  gs.players.B.island = newB;

  // Move wizard
  let newWiz = (gs.wizard.island + wizMove) % 8;
  while (gs.islands[newWiz].sunk) newWiz = (newWiz + 1) % 8;
  gs.wizard.island = newWiz;

  gs.turn++;

  const events = [];
  events.push({ type: 'moved', rollA, rollB, wizMove, fogTurns: gs.fogTurns });

  // Wizard-on-player collision (priority)
  if (!gs.wizard.defeated) {
    if (gs.wizard.island === newA) {
      events.push({ type: 'wizard_battle', player: 'A' });
    } else if (gs.wizard.island === newB) {
      events.push({ type: 'wizard_battle', player: 'B' });
    }
  }

  // Summon pending
  if (gs.wizard.summonPending) {
    gs.wizard.summonPending = false;
    if (gs.wizard.island === gs.players.B.island) events.push({ type: 'wizard_battle', player: 'B' });
    else if (gs.wizard.island === gs.players.A.island) events.push({ type: 'wizard_battle', player: 'A' });
  }

  // Player collision on same island (only if no wizard battle already queued there)
  const wizBattleIslands = events.filter(e => e.type === 'wizard_battle').map(e =>
    gs.players[e.player].island
  );
  if (newA === newB && !wizBattleIslands.includes(newA)) {
    events.push({ type: 'pvp_battle' });
  }

  // Cursed player draws forfeit instead of island card
  ['A', 'B'].forEach(key => {
    const p = gs.players[key];
    if (p.cursed) {
      p.cursed = false;
      events.push({ type: 'cursed_forfeit', player: key });
    }
  });

  // Island events for players NOT in a battle on that island
  const inBattle = new Set();
  events.forEach(e => {
    if (e.type === 'wizard_battle') inBattle.add(e.player);
    if (e.type === 'pvp_battle') { inBattle.add('A'); inBattle.add('B'); }
    if (e.type === 'cursed_forfeit') inBattle.add(e.player);
  });

  ['A', 'B'].forEach(key => {
    if (inBattle.has(key)) return;
    const p = gs.players[key];
    if (p.skipNextIsland) { p.skipNextIsland = false; return; }
    const islandCard = gs.islands[p.island].card;
    if (islandCard) events.push({ type: 'island_card', player: key });
  });

  // Timed mode: check sinking
  if (gs.winCondition === 'timed' && gs.turn % 10 === 0) {
    events.push({ type: 'island_sinks' });
  }

  gs.pendingEvents = events;
  gs.phase = 'resolving';
  return events;
}

// ── Reveal island card for a player ───────────────────────────────────────
export function revealIslandCard(gs, playerKey) {
  const p = gs.players[playerKey];
  const islandData = gs.islands[p.island];
  if (!islandData || !islandData.card) return null;

  islandData.card.revealed = true;
  const { type, idx } = islandData.card;
  islandData.card = null; // collected

  if (type === 'attack') {
    const card = ATTACK_CARDS[idx];
    const upgraded = card.value > p.attack.value;
    if (upgraded) p.attack = { ...card };
    return { type, card, upgraded };
  }
  if (type === 'defence') {
    const card = DEFENCE_CARDS[idx];
    const upgraded = card.value > p.defence.value;
    if (upgraded) p.defence = { ...card };
    return { type, card, upgraded };
  }
  if (type === 'stamina') {
    const card = STAMINA_CARDS[idx];
    p.stamina = Math.min(p.maxStamina, p.stamina + card.value);
    return { type, card, upgraded: true };
  }
  if (type === 'armour') {
    const card = ARMOUR_CARDS[idx];
    p.armour += 1;
    return { type, card, upgraded: true };
  }
  if (type === 'spell') {
    const spell = SPELL_POOL[idx % SPELL_POOL.length];
    return { type, card: spell, upgraded: false, isSpell: true };
  }
  return null;
}

// ── Battle: start ──────────────────────────────────────────────────────────
export function startBattle(gs, type, playerKey) {
  gs.phase = 'battle';
  gs.battleState = {
    type,
    playerKey,
    round: 0,
    myRollReady: false,
    oppRollReady: false,
    log: [],
    ended: false,
    winner: null,
  };
  // Reset transient modifiers for the incoming battle
  if (type === 'pvp') {
    ['A', 'B'].forEach(k => resetBattleMods(gs.players[k]));
  } else {
    resetBattleMods(gs.players[playerKey]);
  }
}

function resetBattleMods(p) {
  p.attackDebuff = 0;
  p.defenceOverride = null;
  p.tempArmour = 0;
  p.doubleNextAttack = false;
  p.lifeSteal = false;
  p.attackBonus = 0;
}

// ── Battle: resolve one round ──────────────────────────────────────────────
export function resolveBattleRound(gs, rng) {
  const bs = gs.battleState;
  const rollA = rngInt(rng, 1, 4);
  const rollB = rngInt(rng, 1, 4);
  bs.round++;
  bs.myRollReady = false;
  bs.oppRollReady = false;

  let atkA, atkB, defA, defB;

  if (bs.type === 'pvp') {
    const pA = gs.players.A;
    const pB = gs.players.B;
    atkA = pA.attack.value + rollA - pA.attackDebuff + pA.attackBonus;
    atkB = pB.attack.value + rollB - pB.attackDebuff + pB.attackBonus;
    if (pA.doubleNextAttack) { atkA *= 2; pA.doubleNextAttack = false; }
    if (pB.doubleNextAttack) { atkB *= 2; pB.doubleNextAttack = false; }
    defA = pA.defenceOverride !== null ? pA.defenceOverride : pA.defence.value;
    defB = pB.defenceOverride !== null ? pB.defenceOverride : pB.defence.value;
    pA.defenceOverride = null;
    pB.defenceOverride = null;

    const dmgToB = Math.max(0, atkA - defB);
    const dmgToA = Math.max(0, atkB - defA);

    applyDamage(gs, 'B', dmgToB, pA.lifeSteal ? 'A' : null);
    applyDamage(gs, 'A', dmgToA, pB.lifeSteal ? 'B' : null);

    pA.lifeSteal = false;
    pB.lifeSteal = false;
    pA.attackDebuff = 0;
    pB.attackDebuff = 0;
    pA.attackBonus = 0;
    pB.attackBonus = 0;

    bs.log.push({
      round: bs.round,
      rollA, rollB, atkA, atkB, defA, defB, dmgToA, dmgToB,
      staminaA: gs.players.A.stamina, armourA: gs.players.A.armour,
      staminaB: gs.players.B.stamina, armourB: gs.players.B.armour,
    });

    if (gs.players.A.stamina <= 0 || gs.players.B.stamina <= 0) {
      bs.ended = true;
      bs.winner = gs.players.A.stamina <= 0 ? 'B' : 'A';
    }
  } else {
    // Boss battle
    const p = gs.players[bs.playerKey];
    const w = gs.wizard;
    const pAtk = p.attack.value + rollA - p.attackDebuff + p.attackBonus;
    const wAtk = w.attack + rollB;
    const pDef = p.defenceOverride !== null ? p.defenceOverride : p.defence.value;
    const wDef = w.defence;

    const dmgToWiz = Math.max(0, pAtk - wDef);
    const dmgToP = Math.max(0, wAtk - pDef);

    if (p.doubleNextAttack) { p.doubleNextAttack = false; }

    const tempArm = p.tempArmour;
    const absorbedByTemp = Math.min(dmgToP, tempArm);
    p.tempArmour = Math.max(0, tempArm - dmgToP);
    const effectiveDmgToP = dmgToP - absorbedByTemp;

    applyDamage(gs, bs.playerKey, effectiveDmgToP, p.lifeSteal ? bs.playerKey : null);

    // Apply damage to wizard: armour absorbs first, then stamina
    const throughWizArmour = Math.max(0, dmgToWiz - w.armour);
    w.armour = Math.max(0, w.armour - dmgToWiz);
    w.stamina = Math.max(0, w.stamina - throughWizArmour);

    p.lifeSteal = false;
    p.attackDebuff = 0;
    p.attackBonus = 0;
    p.defenceOverride = null;

    bs.log.push({
      round: bs.round,
      rollA, rollB,
      pAtk, wAtk, pDef, wDef,
      dmgToP: effectiveDmgToP, dmgToWiz,
      staminaP: p.stamina, armourP: p.armour,
      staminaW: w.stamina, armourW: w.armour,
    });

    if (p.stamina <= 0 || w.stamina <= 0) {
      bs.ended = true;
      bs.winner = w.stamina <= 0 ? bs.playerKey : 'wizard';
    }
  }

  return bs;
}

function applyDamage(gs, playerKey, damage, lifeStealTarget) {
  const p = gs.players[playerKey];
  if (damage <= 0) return;
  const armourAbsorb = Math.min(damage, p.armour + p.tempArmour);
  let rem = damage - armourAbsorb;
  // deduct real armour first, then temp
  const realArm = Math.min(damage, p.armour);
  p.armour = Math.max(0, p.armour - realArm);
  rem = damage - realArm;
  p.stamina = Math.max(0, p.stamina - rem);
  if (lifeStealTarget && rem > 0) {
    gs.players[lifeStealTarget].stamina = Math.min(
      gs.players[lifeStealTarget].maxStamina,
      gs.players[lifeStealTarget].stamina + rem
    );
  }
}

// ── Apply a spell ──────────────────────────────────────────────────────────
export function applySpell(gs, spellId, casterKey, targetIsland, rng) {
  const caster = gs.players[casterKey];
  const oppKey = casterKey === 'A' ? 'B' : 'A';
  const opp = gs.players[oppKey];

  switch (spellId) {
    case 'gust':
      opp.island = (opp.island + 7) % 8;
      while (gs.islands[opp.island].sunk) opp.island = (opp.island + 7) % 8;
      return { message: `${opp.name} pushed back 1 island.` };

    case 'bolt':
      opp.stamina = Math.max(0, opp.stamina - 2);
      return { message: `${opp.name} takes 2 direct stamina damage!` };

    case 'mirror': {
      const tmp = caster.island;
      caster.island = opp.island;
      opp.island = tmp;
      return { message: 'Island positions swapped!' };
    }

    case 'confiscate':
      if (opp.armour > 0) {
        opp.armour--;
        caster.armour++;
        return { message: `Stole 1 armour from ${opp.name}.` };
      }
      return { message: `${opp.name} has no armour to steal.` };

    case 'mend':
      caster.stamina = Math.min(caster.maxStamina, caster.stamina + 2);
      return { message: '+2 stamina restored.' };

    case 'rust':
      opp.attackDebuff = (opp.attackDebuff || 0) + 2;
      return { message: `${opp.name}'s next attack −2.` };

    case 'veil':
      opp.skipNextIsland = true;
      return { message: `${opp.name}'s next island effect skipped.` };

    case 'fog':
      gs.fogTurns = 1;
      return { message: 'Fog spell cast — rolls hidden this turn.' };

    case 'smite':
      return { message: 'Smite! Opponent feels the pulse.', haptic: { intensity: 0.7, duration: 3000 } };

    case 'recall':
      gs.wizard.island = 6;
      gs.wizard.summonPending = false;
      return { message: 'The Dark Wizard is recalled to his tower.' };

    case 'leap':
      if (Number.isInteger(targetIsland) && targetIsland >= 0 && targetIsland <= 7) {
        caster.island = targetIsland;
        return { message: `${caster.name} leaps to ${ISLANDS[targetIsland].name}.` };
      }
      return null;

    case 'shield':
      caster.cancelNextBattle = true;
      return { message: 'Shield Ward active — next battle cancelled.' };

    case 'doubleedge':
      caster.doubleNextAttack = true;
      return { message: 'Double Edge — next attack roll counts twice.' };

    case 'summon':
      gs.wizard.island = opp.island;
      gs.wizard.summonPending = true;
      return { message: `The wizard summoned to ${opp.name}'s island!` };

    case 'ironskin':
      caster.tempArmour = (caster.tempArmour || 0) + 2;
      return { message: '+2 temporary armour for next battle.' };

    case 'curse':
      opp.cursed = true;
      return { message: `${opp.name} is cursed — draws a forfeit next turn!` };

    case 'drain':
      caster.lifeSteal = true;
      return { message: 'Drain active — life-steal in next battle.' };

    case 'hex':
      opp.defenceOverride = 1;
      return { message: `${opp.name}'s defence set to 1 for next battle.` };

    case 'blink':
      caster._blink = true;
      return { message: 'Blink spell held — will trigger extra movement this turn.' };

    case 'overload':
      caster.attackBonus = (caster.attackBonus || 0) + 3;
      return { message: '+3 attack next battle. Haptic burst incoming.', haptic: { intensity: 1.0, duration: 5000, target: casterKey } };

    default:
      return null;
  }
}

// ── Draw Dark Wizard Spell (forfeit) ───────────────────────────────────────
export function drawWizardSpell(gs, victimKey, winnerName) {
  const idx = gs.wizardSpellDeck[gs.wizardSpellDeckIdx % gs.wizardSpellDeck.length];
  gs.wizardSpellDeckIdx++;
  gs.totalForfeits++;
  const raw = WIZARD_SPELL_POOL[idx];
  const text = raw.replace(/\[winner\]/gi, winnerName);
  gs.players[victimKey].forfeitLog.push({ text, turn: gs.turn });
  return { text, idx };
}

// ── Win condition check ────────────────────────────────────────────────────
export function checkWinCondition(gs) {
  if (gs.winCondition === 'normal') {
    if (gs.wizard.defeated) {
      const winner = gs.wizard._defeatedBy;
      return { winner, reason: 'Dark Wizard defeated!' };
    }
  }
  if (gs.winCondition === 'endurance') {
    if (gs.totalForfeits >= gs.spellLimit) {
      // Player with fewer forfeits wins
      const aCount = gs.players.A.forfeitLog.length;
      const bCount = gs.players.B.forfeitLog.length;
      const winner = aCount <= bCount ? 'A' : 'B';
      return { winner, reason: `${gs.spellLimit} forfeits reached — fewest forfeits wins!` };
    }
  }
  if (gs.winCondition === 'timed') {
    const activIslands = gs.islands.filter(i => !i.sunk).length;
    if (activIslands <= 1) {
      // Last player on a valid island wins; fallback: fewer forfeits
      const aCount = gs.players.A.forfeitLog.length;
      const bCount = gs.players.B.forfeitLog.length;
      const winner = aCount <= bCount ? 'A' : 'B';
      return { winner, reason: 'The island has sunk!' };
    }
  }
  // Player stamina depleted entirely — opponent wins
  if (gs.players.A.stamina <= 0 && gs.players.B.stamina > 0) return { winner: 'B', reason: `${gs.players.A.name} has fallen.` };
  if (gs.players.B.stamina <= 0 && gs.players.A.stamina > 0) return { winner: 'A', reason: `${gs.players.B.name} has fallen.` };
  return null;
}

// ── Sink a random island (timed mode) ─────────────────────────────────────
export function sinkRandomIsland(gs, rng) {
  const valid = gs.islands.map((is, i) => is.sunk ? -1 : i).filter(i => i >= 0);
  if (valid.length === 0) return -1;
  const pick = valid[rngInt(rng, 0, valid.length - 1)];
  gs.islands[pick].sunk = true;
  // Move stranded players
  ['A', 'B'].forEach(key => {
    if (gs.players[key].island === pick) {
      let next = (pick + 1) % 8;
      while (gs.islands[next].sunk && next !== pick) next = (next + 1) % 8;
      gs.players[key].island = next;
    }
  });
  return pick;
}

// ── Respawn wizard after defeat (endurance/timed) ─────────────────────────
export function respawnWizard(gs) {
  gs.wizard.stamina = gs.wizard.maxStamina;
  gs.wizard.armour = gs.wizard.maxArmour;
  gs.wizard.island = 6;
  gs.wizard.defeated = false;
  gs.wizard._defeatedBy = null;
}
