import { rngInt } from './seededRng.js';

// ── Island layout (8 islands in a circle) ─────────────────────────────────
export const ISLANDS = [
  { name: 'Sandy Beach',   pos: [0.48, 0.06] },  // 0 — top
  { name: 'Volcano Peak',  pos: [0.79, 0.20] },  // 1 — upper-right
  { name: 'Rocky Desert',  pos: [0.84, 0.52] },  // 2 — right
  { name: 'Dark Earth',    pos: [0.74, 0.82] },  // 3 — lower-right
  { name: 'Green Forest',  pos: [0.48, 0.90] },  // 4 — bottom
  { name: 'Dark Swamp',    pos: [0.18, 0.78] },  // 5 — lower-left
  { name: 'Flower Forest', pos: [0.12, 0.48] },  // 6 — left
  { name: 'Gray Peaks',    pos: [0.24, 0.16] },  // 7 — upper-left
];
export const WIZARD_POS = [0.50, 0.50];

// ── Card data (from the physical .pcio game) ───────────────────────────────

export const ATTACK_CARDS = [
  { type: 'attack', value: 3, label: '+3 Attack', description: '' },
  { type: 'attack', value: 4, label: '+4 Attack', description: '' },
  { type: 'attack', value: 5, label: '+5 Attack (Bloodlust)', description: 'Edge once to increase your attack by 1 for this battle.' },
  { type: 'attack', value: 5, label: '+5 Attack', description: 'Sacrifice Armour to double this attack for one battle.' },
  { type: 'attack', value: 5, label: '+5 Attack', description: '' },
  { type: 'attack', value: 6, label: '+6 Attack', description: '' },
  { type: 'attack', value: 8, label: '+8 Attack', description: 'Edge every time you take a hit during this battle.' },
  { type: 'attack', value: 8, label: '+8 Attack (Broken Sword)', description: 'Return this card to the deck after one battle.' },
  { type: 'attack', value: 8, label: '+8 Attack', description: 'Any hits you take during your attack = 120 seconds of vibe for you.' },
  { type: 'attack', value: 1, label: 'Rapier (+1)', description: 'Each consecutive successful hit is worth +1 extra (stacks).' },
  { type: 'attack', value: 8, label: '8 Attack', description: 'If you run out of armour you must stroke continuously until you collect new armour.' },
];

export const DEFENCE_CARDS = [
  { type: 'defence', value: 3, label: '+3 Defence', description: '' },
  { type: 'defence', value: 3, label: '+3 Defence', description: '+3 × the amount of Armour you have.' },
  { type: 'defence', value: 4, label: '+4 Defence', description: '' },
  { type: 'defence', value: 5, label: '+5 Defence', description: '' },
  { type: 'defence', value: 6, label: '+6 Defence', description: 'On a hit, make opponent spank based on the number they rolled.' },
  { type: 'defence', value: 8, label: '+8 Defence', description: 'All your armour breaks on the first hit.' },
  { type: 'defence', value: 8, label: '+8 Defence (Mirror)', description: 'Mirror: You also do any forfeit the other player must do.' },
  { type: 'defence', value: 4, label: '+4 Defence (Adaptive)', description: 'No armour: takes 2 extra inventory slots, gives +10 defence & +10 attack instead.' },
];

export const STAMINA_CARDS = [
  { type: 'stamina', value: 1, label: '+1 Stamina', description: '' },
  { type: 'stamina', value: 2, label: '+2 Stamina', description: '' },
  { type: 'stamina', value: 3, label: '+3 Stamina', description: '' },
  { type: 'stamina', value: 1, label: '+1 Stamina', description: 'Do 20 press-ups for a bonus +1 stamina.' },
  { type: 'stamina', value: 3, label: '+3 Stamina', description: 'Wear the vibe for 3 min per fight, opponent controls.', vibeDurationMs: 180000, vibeController: 'other' },
  { type: 'stamina', value: 1, label: '+1 Stamina (Testosterone)', description: 'Edge during battle to regain 1 stamina (once per battle).' },
];

export const ARMOUR_CARDS = [
  { type: 'armour', value: 1, label: 'Underwear', description: '+1 Armour' },
  { type: 'armour', value: 1, label: 'Pants', description: '+1 Armour' },
  { type: 'armour', value: 1, label: 'Shirt', description: '+1 Armour' },
  { type: 'armour', value: 1, label: 'Hat', description: '+1 Armour' },
  { type: 'armour', value: 1, label: 'Pants +3 Def', description: '+1 Armour, +3 Defence bonus.' },
  { type: 'armour', value: 0, label: 'Ghost Armour', description: 'Looks like a shirt but counts as nothing.' },
  { type: 'armour', value: 1, label: 'Thorny Armour', description: 'Attacker takes 1 damage every time you are hit.' },
  { type: 'armour', value: 1, label: 'Underwear +5 Def', description: '+1 Armour, +5 Defence bonus.' },
  { type: 'armour', value: 1, label: 'Shirt +2 Def', description: '+1 Armour, +2 Defence bonus.' },
  { type: 'armour', value: 1, label: 'Shirt +2 Def +1 Stam', description: '+1 Armour, +2 Defence bonus, +1 Stamina bonus.' },
];

export const SPELL_CARDS = [
  // Immediate spells
  { type: 'spell', timing: 'immediate', name: 'Edge Order', description: 'Immediately make the other player edge d3 times.' },
  { type: 'spell', timing: 'immediate', name: 'Exercise', description: 'Immediately make the other player complete 2 minutes of naked exercise.' },
  { type: 'spell', timing: 'immediate', name: 'Pegs', description: 'Immediately make the other player put on d3 pegs.' },
  { type: 'spell', timing: 'immediate', name: 'Expose Hand', description: 'Immediately show all your cards to the other player — they can swap any cards they wish.' },
  { type: 'spell', timing: 'immediate', name: 'Clothing Transfer', description: 'Immediately give one item of clothing you are wearing to the other player.' },
  { type: 'spell', timing: 'immediate', name: 'Vibe 5 Minutes', description: 'Make the other player wear the vibe for 5 minutes while you control.', vibeDurationMs: 300000, vibeController: 'other' },
  { type: 'spell', timing: 'immediate', name: 'Nothing', description: 'Nothing happens.' },
  { type: 'spell', timing: 'immediate', name: 'Return Cards', description: 'Immediately return 3 cards of your choice to the deck.' },
  { type: 'spell', timing: 'immediate', name: 'Card Steal', description: 'The other player randomly picks 2 of your cards to return to the deck.' },
  { type: 'spell', timing: 'immediate', name: 'Naked Edge', description: 'Any player who is naked must edge. If no one is naked, all edge once.' },
  { type: 'spell', timing: 'immediate', name: 'Island Lockout', description: 'Immediately pick one island that will be cut off for the rest of the game.' },
  { type: 'spell', timing: 'immediate', name: 'Wizard Rush', description: 'Both players immediately move to the dark wizard and battle for as long as stamina lasts.' },
  { type: 'spell', timing: 'immediate', name: 'Summon Wizard (Me)', description: 'The dark wizard is immediately drawn to your location.' },
  { type: 'spell', timing: 'immediate', name: 'Summon Wizard (Enemy)', description: 'The dark wizard is immediately drawn to the other player\'s position.' },
  { type: 'spell', timing: 'immediate', name: 'No Surrender', description: 'For the rest of the game all battles last until all stamina on both sides is gone.' },
  { type: 'spell', timing: 'immediate', name: 'Bloodlust Quest', description: 'Engage in 3 battles in the next 4 rounds or lose all your cards, activating any spells.' },
  { type: 'spell', timing: 'immediate', name: 'Vibe Edge', description: 'Vibe-edge the other player for 5 minutes. Gain 1 stamina per edge. If they orgasm you lose all your cards.', vibeDurationMs: 300000, vibeController: 'other' },
  { type: 'spell', timing: 'immediate', name: 'Endless Battle', description: 'For the rest of the game all battles last as long as there is stamina for either player.' },
  { type: 'spell', timing: 'immediate', name: 'Halving (Islands 1–4)', description: 'For 5 turns players and the dark wizard can only move to islands 1–4.' },
  { type: 'spell', timing: 'immediate', name: 'Inventory Boost', description: 'Both players gain one inventory slot.' },
  { type: 'spell', timing: 'immediate', name: 'Inventory Reduce', description: 'Both players lose one inventory slot.' },
  { type: 'spell', timing: 'immediate', name: 'Naked Hit Edge', description: 'For the rest of the game a hit against a naked player will make them edge.' },
  { type: 'spell', timing: 'immediate', name: 'Hard Order', description: 'You must remain hard for 10 minutes. If the other player finds you soft, you lose armour.' },
  { type: 'spell', timing: 'immediate', name: 'Head Vibe Permanent', description: 'For the rest of the game all vibe forfeits will be on the head.' },
  { type: 'spell', timing: 'immediate', name: 'Armour Burns', description: 'For the rest of the game lost armour will be burnt.' },
  { type: 'spell', timing: 'immediate', name: 'Wizard Power Up', description: 'Increase all the wizard\'s stats by 1.' },
  { type: 'spell', timing: 'immediate', name: 'Cooperation Spell', description: 'Both players cooperate — see Cooperation rules.' },
  { type: 'spell', timing: 'immediate', name: 'Vibe Pulse', description: 'Immediately trigger a 5-second vibe pulse on the other player\'s device.' },
  { type: 'spell', timing: 'immediate', name: 'Double Mode', description: 'Pick a new game mode. If it does not contradict the current mode, play both.' },
  // Held spells
  { type: 'spell', timing: 'held', name: 'Vibe Control', description: 'Make the other player wear the vibe for d6 × 30 seconds. If held at game end, you wear it for d6 × 5 min.' },
  { type: 'spell', timing: 'held', name: 'Follow Orders', description: 'Make the other player follow your instructions on how to play for 3 turns.' },
  { type: 'spell', timing: 'held', name: 'Major Edge', description: 'Make the other player edge d6 times.' },
  { type: 'spell', timing: 'held', name: 'Double Clothing', description: 'Pick an item of clothing — while holding this you may wear two of that item.' },
  { type: 'spell', timing: 'held', name: 'Full Battle', description: 'Until your next attack on the dark wizard, ALL your battles last until all stamina is used.' },
  { type: 'spell', timing: 'held', name: 'Preview Island', description: 'For one round you can preview a card before moving, then return it to the deck.' },
  { type: 'spell', timing: 'held', name: 'Clairvoyance', description: 'Play at any time to examine any card currently in play or in a player\'s hand.' },
  { type: 'spell', timing: 'held', name: 'Summon Wizard (Them)', description: 'At any time, draw the dark wizard to the other player\'s location.' },
  { type: 'spell', timing: 'held', name: 'Locator Spell', description: 'When played, the other player must tell you which space they are moving to for 3 rounds.' },
  { type: 'spell', timing: 'held', name: 'Halving Spell', description: 'When played, all players and the dark wizard can only go to islands 1–4 for 3 turns.' },
  { type: 'spell', timing: 'held', name: 'Collector', description: 'For 3 turns you may only collect spell cards or battle the wizard.' },
  { type: 'spell', timing: 'held', name: 'Armour Burn Held', description: 'Both players burn their armour. If held at game end, draw 1 dark wizard spell per armour item.' },
  { type: 'spell', timing: 'held', name: 'Wizard Reset', description: 'Return the dark wizard to original strength. If held at game end, draw one dark wizard spell.' },
  { type: 'spell', timing: 'held', name: 'Stat Merge', description: 'Add your stats to another player or the dark wizard for the duration of your stamina.' },
  { type: 'spell', timing: 'held', name: 'Wizard Armour Boost', description: 'Give all armour cards on the board to the dark wizard. If held at game end, draw a dark wizard spell.' },
  { type: 'spell', timing: 'held', name: 'Disarm Attack', description: 'Play against a defeated player to remove all their attack cards.' },
  { type: 'spell', timing: 'held', name: 'Disarm Defence', description: 'Play against a defeated player to remove all their defence cards.' },
  { type: 'spell', timing: 'held', name: 'Full Disarm', description: 'Play against a defeated player to remove all their attack and defence cards.' },
  { type: 'spell', timing: 'held', name: 'Strip Cards', description: 'Remove all of a defeated player\'s cards, activating any play-later spells.' },
  { type: 'spell', timing: 'held', name: 'Nothing Stings', description: 'For the rest of the game, anyone who picks up a Nothing card must edge.' },
  { type: 'spell', timing: 'held', name: 'Head Vibe', description: 'Make the other player\'s next vibe task placed on the head.' },
  { type: 'spell', timing: 'held', name: 'Premonition', description: 'See where the wizard is headed before the other player, lasts 3 turns.' },
  { type: 'spell', timing: 'held', name: 'Hard Check', description: 'The other player must remain hard for 10 minutes. If you find them soft, they lose armour.' },
  { type: 'spell', timing: 'held', name: 'Mode Change', description: 'Pick a new game mode and replace an existing one.' },
  { type: 'spell', timing: 'held', name: 'Armour Burns Held', description: 'For the rest of the game lost armour will be burnt.' },
  { type: 'spell', timing: 'held', name: 'Spell Lock', description: 'The other player can only draw spell cards for 4 turns.' },
  { type: 'spell', timing: 'held', name: 'Mirror Spell', description: 'Make the other player repeat a spell or forfeit you must do.' },
  { type: 'spell', timing: 'held', name: 'Deflect', description: 'Deflect any forfeit or spell to the other player.' },
  { type: 'spell', timing: 'held', name: 'Wizard Rage', description: 'Put the wizard into rage (+20 attack/defence/armour). Rage ends — killing the wizard — after 3 battles.' },
  { type: 'spell', timing: 'held', name: 'Delayed Punishment', description: 'The other player wears the vibe for 10 minutes at an intensity of your choice.', vibeDurationMs: 600000, vibeController: 'other' },
  { type: 'spell', timing: 'held', name: 'Double Mode Held', description: 'Pick another game mode — if it doesn\'t conflict, play both.' },
  { type: 'spell', timing: 'held', name: 'Island 6 Refuge', description: 'Move to island 6 for d6 turns. You may collect cards.' },
  { type: 'spell', timing: 'held', name: 'Wizard Summons Held', description: 'Both players move to the dark wizard and battle him for at least two fights.' },
];

export const MODIFIER_CARDS = [
  { name: 'Normal', description: 'Play until the dark wizard is defeated. The winner chooses one of his remaining spells for the other player.' },
  { name: 'Edge Game', description: 'Any orgasm not directly caused by a wizard spell will result in all players\' cards being burnt.' },
  { name: 'Cum Game', description: 'All vibe time ×3. If you make a player orgasm, the dark wizard is immediately drawn to that space.' },
  { name: 'Timed Islands', description: 'The island is sinking — every 10 turns a random island will be closed.' },
  { name: 'Cum to Victory', description: 'If you make the other player orgasm while controlling the vibe, you get +10 attack. If required to edge you choose to cum, gain 10 defence permanently.' },
  { name: 'Forfeit Limit', description: 'Play until 5 dark wizard spells have been drawn. Forfeits can be owed.' },
  { name: 'Stronger Wizard', description: 'Dark wizard starts stronger: 13 attack, 13 defence, 7 armour.' },
  { name: 'Armour Burn Mode', description: 'All armour will be burnt (removed from game) when lost.' },
  { name: 'Less Inventory', description: 'Reduce inventory card limit by 1 (max 4 cards each).' },
  { name: 'Wizard\'s Assistant', description: 'A random player takes on the role of dark wizard\'s assistant for 10 turns. Each hit loses cards; edge when no cards.' },
  { name: 'Countdown', description: 'Every 15 turns both players will move to the dark wizard.' },
  { name: 'Locked Islands', description: 'If the dark wizard lands on the same island twice, that island is locked to all players.' },
];

// Each entry is drawn as a forfeit against the player who lost the armour exchange
// (see drawWizardSpell). vibeDurationMs/vibeController tag the entries that state an
// actual timed vibe-wear session — see SPELL_CARDS above for the same convention.
export const WIZARD_SPELL_POOL = [
  { text: 'Edge once every time you lose all your armour for the rest of the game. Game continues.' },
  { text: 'Spank your balls d6 times each time you take a hit for the rest of the game. Game continues.' },
  { text: 'Edge once for each item of armour the other player currently has. They decide if game continues.' },
  { text: 'Wear the vibe for 5 minutes — other player can only make you edge. Game continues.', vibeDurationMs: 300000, vibeController: null },
  { text: 'You are denied outside games until you\'ve made d3 people cum in a game. Game over.' },
  { text: 'After the game the other player can vibe you for 30 minutes at times of their choice. Game continues.' },
  { text: 'Wear the vibe under control for 10 min. If you do NOT cum then the game continues.', vibeDurationMs: 600000, vibeController: 'other' },
  { text: 'Wear the vibe under control for 10 min. If you cum then the game continues.', vibeDurationMs: 600000, vibeController: 'other' },
  { text: 'Return to the last space you were on and wait there until you collect an armour card. Game continues.' },
  { text: 'The winner can make you edge at any time (including nights) up to 3 times. Game continues.' },
  { text: 'The other player will immediately use the vibe to make you cum and post-cum. Game over.' },
  { text: 'The other player receives an extra life/chance in the next game you play together. Game continues.' },
  { text: 'The other player can design a game for you to play immediately, including rules and forfeits. Game over.' },
  { text: 'Keep this card — if you defeat the wizard, you can assign any dark wizard forfeit to another player. Game continues.' },
  { text: 'The other player will use the vibe to make you cum. Game over. OR play on with no forfeit — if you don\'t defeat the wizard, double the forfeit.' },
  { text: 'You will go on public cam and share a link to the vibe for the audience to control until cum. Game over.' },
  { text: 'The other player can design d3 games for you to play over an agreed period. Game over.' },
  { text: 'The other player can control you to cum at any time (including nights) up to d3 times. Game continues.' },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rngInt(rng, 0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Stat getters ───────────────────────────────────────────────────────────
export function getAttack(player) {
  const c = player.inventory.find(c => c.type === 'attack');
  return c ? c.value : 1;
}
export function getDefence(player) {
  const c = player.inventory.find(c => c.type === 'defence');
  return c ? c.value : 1;
}
export function getMaxStamina(player) {
  const c = player.inventory.find(c => c.type === 'stamina');
  return c ? c.value : 1;
}
export function getArmourCount(player) {
  return player.inventory.filter(c => c.type === 'armour' && c.value > 0).length;
}

// ── Game state factory ─────────────────────────────────────────────────────
// nameC is optional — pass it (3-player sessions carry state.guest2Name) to add a
// third player (key 'C'). Omitting it reproduces the 2-player game exactly.
export function createGameState(seed, rng, nameA, nameB, nameC) {
  // Build and shuffle unified deck
  const allCards = [
    ...ATTACK_CARDS, ...DEFENCE_CARDS, ...STAMINA_CARDS,
    ...ARMOUR_CARDS, ...SPELL_CARDS,
  ].map((card, i) => ({ ...card, _id: i }));
  const deck = shuffle(allCards, rng);

  // Draw game modifier
  const modIdx = rngInt(rng, 0, MODIFIER_CARDS.length - 1);
  const modifier = MODIFIER_CARDS[modIdx];

  // Shuffle wizard spell order
  const wizardSpellOrder = shuffle(WIZARD_SPELL_POOL.map((_, i) => i), rng);

  // Wizard starts at a random island
  const wizStartIsland = rngInt(rng, 0, 7);

  let wizAtk = 8, wizDef = 8, wizArm = 5, maxInventory = 5;
  if (modifier.name === 'Stronger Wizard') { wizAtk = 13; wizDef = 13; wizArm = 7; }
  if (modifier.name === 'Less Inventory') { maxInventory = 4; }

  const gs = {
    phase: 'choosing',
    turn: 0,
    nameA, nameB, nameC: nameC ?? null,
    players: {
      A: makePlayer(nameA, maxInventory),
      B: makePlayer(nameB, maxInventory),
      ...(nameC ? { C: makePlayer(nameC, maxInventory) } : {}),
    },
    wizard: {
      island: wizStartIsland,
      attack: wizAtk, defence: wizDef, armour: wizArm,
      baseAttack: wizAtk, baseDefence: wizDef, baseArmour: wizArm,
      defeated: false, defeatedBy: null,
      armourZero: false,
    },
    islands: Array.from({ length: 8 }, () => ({ card: null, locked: false })),
    deck,
    discard: [],
    battleState: null,
    wizardSpellOrder,
    wizardSpellIdx: 0,
    modifier,
    armourBurnsMode: modifier.name === 'Armour Burn Mode',
    activeRules: [],   // rule-changing spells in effect, shown to both/all players
  };

  dealIslands(gs);
  return gs;
}

// ── Player keys present in this game (['A','B'] or ['A','B','C']) ─────────
export function playerKeys(gs) {
  return gs.players.C ? ['A', 'B', 'C'] : ['A', 'B'];
}

function makePlayer(name, maxInventory) {
  return {
    name,
    island: null,       // null = wizard tower / start; 0-7 = island index
    prevIsland: 0,      // last island visited (for retreat)
    inventory: [],      // max maxInventory (attack/defence/stamina/armour cards)
    maxInventory,
    spells: [],         // held spell cards (unlimited)
    forfeitLog: [],
    choiceSubmitted: false,
  };
}

// ── Deal cards to empty island slots ──────────────────────────────────────
export function dealIslands(gs) {
  for (let i = 0; i < 8; i++) {
    if (gs.islands[i].locked || gs.islands[i].card) continue;
    if (gs.deck.length === 0) {
      // Deterministic reshuffle: sort discards by original _id
      gs.deck = [...gs.discard].sort((a, b) => a._id - b._id);
      gs.discard = [];
    }
    if (gs.deck.length > 0) gs.islands[i].card = gs.deck.shift();
  }
}

export function checkRedeal(gs) {
  const hasCard = gs.islands.some(isl => !isl.locked && isl.card);
  if (!hasCard) { dealIslands(gs); return true; }
  return false;
}

// ── End of every round: collect leftover island cards back into the deck,
//    then deal a fresh card to each (unlocked) island.
//    Deterministic (no RNG) so both clients stay in lockstep: leftovers go to
//    the discard pile and fresh cards come off the (seed-shuffled) deck, which
//    reshuffles from the discard when it runs out.
export function redealIslands(gs) {
  for (let i = 0; i < 8; i++) {
    if (gs.islands[i].locked) continue;
    if (gs.islands[i].card) {
      gs.discard.push(gs.islands[i].card);
      gs.islands[i].card = null;
    }
  }
  dealIslands(gs);
}

// ── Round resolution: takes each player's destination choice ──────────────
// dest: 0-7 (island index) or 'wizard'. destC is only read when gs.players.C exists —
// passing it for a 2-player game is a no-op, so 2-player callers are unaffected.
export function resolveDestinations(gs, destA, destB, destC) {
  const keys = playerKeys(gs);
  const dests = { A: destA, B: destB, C: destC };

  keys.forEach(key => {
    const dest = dests[key];
    if (typeof dest === 'number') {
      gs.players[key].prevIsland = dest;
      gs.players[key].island = dest;
    } else {
      gs.players[key].island = null;
    }
    gs.players[key].choiceSubmitted = false;
  });
  gs.turn++;

  const events = [];
  const inBattle = new Set();

  // Wizard tower: 2+ players landing there together triggers cooperate/betray —
  // exactly today's 2-player rule when it's 2, majority rules when it's 3 (see
  // planTowerFight). Exactly one player alone just gets a normal solo attack.
  const atWizard = keys.filter(k => dests[k] === 'wizard');
  if (atWizard.length >= 2) {
    events.push({ type: 'cooperate_or_betray', players: atWizard });
    atWizard.forEach(k => inBattle.add(k));
  } else if (atWizard.length === 1) {
    events.push({ type: 'wizard_battle', player: atWizard[0] });
    inBattle.add(atWizard[0]);
  }

  // Islands: group everyone (not already at the wizard) by destination island.
  // 2+ sharing an island battle for the card — a free-for-all when all 3 land there,
  // otherwise identical to today's 2-player pvp rule for that pair.
  const islandGroups = {};
  keys.forEach(k => {
    if (atWizard.includes(k)) return;
    const dest = dests[k];
    if (typeof dest !== 'number') return;
    (islandGroups[dest] ??= []).push(k);
  });
  Object.entries(islandGroups).forEach(([islandIdx, group]) => {
    if (group.length >= 2) {
      events.push({ type: 'pvp_battle', island: Number(islandIdx), players: group });
      group.forEach(k => inBattle.add(k));
    }
  });

  keys.forEach(key => {
    if (inBattle.has(key)) return;
    const dest = dests[key];
    if (typeof dest !== 'number') return;
    if (gs.islands[dest]?.card) events.push({ type: 'island_card', player: key, island: dest });
  });

  gs.phase = 'resolving';
  return events;
}

// ── Tower majority rules (see WIZARD_ISLAND.md) ────────────────────────────
// choices: { [playerKey]: 'cooperate' | 'betray' } for everyone currently at the
// wizard tower (exactly the 2 or 3 keys from a 'cooperate_or_betray' event).
// Returns a plan describing how the fight(s) against the wizard proceed:
//   coop_duo / coop_group        — cooperators merge stats and fight together
//   betray_all                   — everyone fights solo, each drawing a spell first
//   one_betrays                  — (2p only) betrayer sides with the wizard vs the cooperator
//   coop_duo_plus_betrayer       — 2 cooperate (merged) vs a wizard boosted by the betrayer
//   betray_duo_plus_cooperator   — 2 betray (solo + spell each), 1 cooperates solo, unboosted
export function planTowerFight(choices) {
  const keys = Object.keys(choices);
  if (keys.length <= 2) {
    const [k1, k2] = keys;
    if (choices[k1] === 'cooperate' && choices[k2] === 'cooperate') return { type: 'coop_duo', cooperators: [k1, k2] };
    if (choices[k1] === 'betray' && choices[k2] === 'betray') return { type: 'betray_all', betrayers: [k1, k2] };
    const betrayer = choices[k1] === 'betray' ? k1 : k2;
    const cooperator = betrayer === k1 ? k2 : k1;
    return { type: 'one_betrays', betrayer, cooperator };
  }
  const cooperators = keys.filter(k => choices[k] === 'cooperate');
  const betrayers = keys.filter(k => choices[k] === 'betray');
  if (cooperators.length === 3) return { type: 'coop_group', cooperators };
  if (betrayers.length === 3) return { type: 'betray_all', betrayers };
  if (cooperators.length === 2) return { type: 'coop_duo_plus_betrayer', cooperators, betrayer: betrayers[0] };
  return { type: 'betray_duo_plus_cooperator', betrayers, cooperator: cooperators[0] };
}

// ── Wizard moves to random unlocked island after turn ─────────────────────
// attacksPlayer: first player found on the wizard's new island (kept for 2-player
// callers — identical to before). attacksPlayers: everyone found there, in case more
// than one player shares that space (only possible with a 3rd player on the board).
export function moveWizardAfterTurn(gs, rng) {
  if (gs.wizard.defeated) return { island: gs.wizard.island, attacksPlayer: null, attacksPlayers: [] };
  const available = gs.islands.map((isl, i) => isl.locked ? -1 : i).filter(i => i >= 0);
  if (!available.length) return { island: gs.wizard.island, attacksPlayer: null, attacksPlayers: [] };
  const newIsland = available[rngInt(rng, 0, available.length - 1)];
  gs.wizard.island = newIsland;
  const attacksPlayers = playerKeys(gs).filter(k => gs.players[k].island === newIsland);
  return { island: newIsland, attacksPlayer: attacksPlayers[0] ?? null, attacksPlayers };
}

// ── Collect island card ────────────────────────────────────────────────────
export function collectIslandCard(gs, islandIdx) {
  const isl = gs.islands[islandIdx];
  if (!isl?.card) return null;
  const card = isl.card;
  isl.card = null;
  return card;
}

// ── Add card to player (returns action descriptor) ─────────────────────────
// action: 'spell_added' | 'upgraded' | 'added' | 'no_upgrade' | 'full'
export function addCardToPlayer(player, card) {
  if (card.type === 'spell') {
    player.spells.push(card);
    return { action: 'spell_added' };
  }
  if (card.type !== 'armour') {
    const existIdx = player.inventory.findIndex(c => c.type === card.type);
    if (existIdx >= 0) {
      const existing = player.inventory[existIdx];
      if (card.value > existing.value) {
        player.inventory[existIdx] = card;
        return { action: 'upgraded', replaced: existing };
      }
      return { action: 'no_upgrade', existing, newCard: card };
    }
  }
  if (player.inventory.length >= player.maxInventory) return { action: 'full', newCard: card };
  player.inventory.push(card);
  return { action: 'added' };
}

export function discardFromInventory(gs, playerKey, cardIdx) {
  const player = gs.players[playerKey];
  if (cardIdx < 0 || cardIdx >= player.inventory.length) return null;
  const [removed] = player.inventory.splice(cardIdx, 1);
  if (!gs.armourBurnsMode || removed.type !== 'armour') gs.discard.push(removed);
  return removed;
}

// ── Battle: setup ──────────────────────────────────────────────────────────
// type: 'pvp' | 'wizard'
// playerKey: who fights the wizard (for solo wizard battles)
// islandIdx: island card at stake (for pvp, can be null)
// combatants: for pvp, the 2 (today's rule) or 3 (free-for-all) keys contesting the
// island. Omitting it defaults to ['A','B'] — the only case a 2-player game can hit,
// so existing 2-player pvp battles are unaffected.
export function startBattle(gs, type, playerKey, islandIdx, combatants) {
  if (type === 'pvp') {
    const keys = combatants || ['A', 'B'];

    if (keys.length >= 3) {
      // Free-for-all: turn order by Attack, tie-break Defence then Stamina (desc).
      const order = [...keys].sort((k1, k2) => {
        const p1 = gs.players[k1], p2 = gs.players[k2];
        if (getAttack(p2) !== getAttack(p1)) return getAttack(p2) - getAttack(p1);
        if (getDefence(p2) !== getDefence(p1)) return getDefence(p2) - getDefence(p1);
        return getMaxStamina(p2) - getMaxStamina(p1);
      });
      gs.battleState = {
        type, mode: 'ffa', combatants: keys, islandIdx: islandIdx ?? null,
        order, attackerKey: order[0], targetKey: null,
        round: 0, cardWinner: null, log: [],
        ended: false, winner: null, retreated: false, pendingWizardHit: false,
        staminaLeft: null,
      };
      gs.phase = 'battle';
      return;
    }

    // Exactly 2 combatants — today's duo mechanic, generalized to any pair of keys
    // (identical output to before when the pair is ['A','B']).
    const [k1, k2] = keys;
    const p1 = gs.players[k1], p2 = gs.players[k2];
    let firstAttacker;
    const a1 = getAttack(p1), a2 = getAttack(p2);
    if (a1 !== a2) firstAttacker = a1 > a2 ? k1 : k2;
    else {
      const d1 = getDefence(p1), d2 = getDefence(p2);
      if (d1 !== d2) firstAttacker = d1 > d2 ? k1 : k2;
      else firstAttacker = getMaxStamina(p1) >= getMaxStamina(p2) ? k1 : k2;
    }
    gs.battleState = {
      type, combatants: keys, islandIdx: islandIdx ?? null,
      attackerKey: firstAttacker,
      round: 0,
      cardWinner: null,
      log: [],
      ended: false, winner: null, retreated: false,
      pendingWizardHit: false,
      staminaLeft: { [k1]: getMaxStamina(p1), [k2]: getMaxStamina(p2) },
    };
    gs.phase = 'battle';
    return;
  }

  // Wizard battle: solo playerKey (works the same for A, B, or C).
  gs.battleState = {
    type, playerKey, islandIdx: islandIdx ?? null,
    attackerKey: playerKey,
    round: 0,
    cardWinner: null,
    log: [],
    ended: false, winner: null, retreated: false,
    pendingWizardHit: false,
    staminaLeft: { [playerKey]: getMaxStamina(gs.players[playerKey]) },
  };
  gs.phase = 'battle';
}

// ── Tower: merged-force wizard battle for 2 or 3 cooperators ───────────────
// Only ever used for the NEW 3-player group-cooperation cases (all-3-cooperate, or
// 2-cooperate-vs-a-boosted-wizard) — 2-player cooperate+cooperate keeps using its
// existing "combine attack OR defence, one of us fights" mechanic untouched.
export function startGroupWizardBattle(gs, groupKeys) {
  const totalStamina = groupKeys.reduce((sum, k) => sum + getMaxStamina(gs.players[k]), 0);
  gs.battleState = {
    type: 'wizard', groupKeys, playerKey: null, islandIdx: null,
    attackerKey: groupKeys[0],
    round: 0,
    cardWinner: null,
    log: [],
    ended: false, winner: null, retreated: false,
    pendingWizardHit: false,
    staminaLeft: { GROUP: totalStamina },
  };
  gs.phase = 'battle';
}

// ── Battle: one round ──────────────────────────────────────────────────────
// Consumes 6 rng values (fixed, for determinism between clients).
// Returns { logEntry, events[] }
export function doBattleRound(gs, rng) {
  const bs = gs.battleState;
  if (!bs || bs.ended) return null;

  // New 3-player paths — each is a self-contained, deterministic branch that never
  // touches gs.players.A/B directly, so the classic 2-player logic below (which always
  // assumes exactly A and B) is completely untouched by these.
  if (bs.type === 'pvp' && bs.mode === 'ffa') return doBattleRoundFFA(gs, rng);
  if (bs.type === 'wizard' && bs.groupKeys) return doBattleRoundGroup(gs, rng);
  if (bs.type === 'wizard' && bs.playerKey !== 'A' && bs.playerKey !== 'B') return doBattleRoundSolo(gs, rng, bs.playerKey);
  if (bs.type === 'pvp' && bs.combatants && !(bs.combatants.includes('A') && bs.combatants.includes('B'))) {
    return doBattleRoundDuo(gs, rng, bs.combatants);
  }

  bs.round++;
  const pA = gs.players.A, pB = gs.players.B;

  // Always consume 6 rolls regardless of battle type
  const rA_atk = rngInt(rng, 1, Math.max(1, getAttack(pA)));
  const rB_def = rngInt(rng, 1, Math.max(1, getDefence(pB)));
  const rB_atk = rngInt(rng, 1, Math.max(1, getAttack(pB)));
  const rA_def = rngInt(rng, 1, Math.max(1, getDefence(pA)));
  const rW_atk = rngInt(rng, 1, Math.max(1, gs.wizard.attack));
  const rW_def = rngInt(rng, 1, Math.max(1, gs.wizard.defence));

  const events = [];
  let logEntry = { round: bs.round };

  if (bs.type === 'pvp') {
    const atk = bs.attackerKey;
    const def = atk === 'A' ? 'B' : 'A';
    const atkRoll = atk === 'A' ? rA_atk : rB_atk;
    const defRoll = def === 'A' ? rA_def : rB_def;
    const hit = atkRoll > defRoll;

    logEntry = {
      ...logEntry, type: 'pvp', attacker: atk, defender: def,
      atkRoll, defRoll, atkStat: atk === 'A' ? getAttack(pA) : getAttack(pB),
      defStat: def === 'A' ? getDefence(pA) : getDefence(pB), hit,
    };

    if (hit) {
      if (!bs.cardWinner) bs.cardWinner = atk;
      const defPlayer = gs.players[def];
      if (getArmourCount(defPlayer) > 0) {
        const idx = defPlayer.inventory.findIndex(c => c.type === 'armour' && c.value > 0);
        const removed = defPlayer.inventory.splice(idx, 1)[0];
        if (!gs.armourBurnsMode) gs.discard.push(removed);
        events.push({ type: 'armour_lost', player: def, card: removed });
      } else {
        events.push({ type: 'wizard_spell_draw', player: def, winner: atk });
      }
    }

    bs.staminaLeft[atk] = Math.max(0, bs.staminaLeft[atk] - 1);
    bs.attackerKey = def; // swap for next round

    logEntry.staminaLeft = { ...bs.staminaLeft };
    if (bs.staminaLeft.A <= 0 && bs.staminaLeft.B <= 0) {
      bs.ended = true; bs.winner = bs.cardWinner;
    }

  } else {
    // Wizard battle
    const pk = bs.playerKey;
    const player = gs.players[pk];
    const pAtkRoll = pk === 'A' ? rA_atk : rB_atk;
    const pDefRoll = pk === 'A' ? rA_def : rB_def;
    const coopAtkBoost = bs._coopAtkBoost ?? 0;
    const coopDefBoost = bs._coopDefBoost ?? 0;
    const effectivePAtkRoll = pAtkRoll + coopAtkBoost;
    const effectivePDefRoll = pDefRoll + coopDefBoost;
    const playerHitsWiz = effectivePAtkRoll > rW_def;
    const wizHitsPlayer = rW_atk > effectivePDefRoll;

    logEntry = {
      ...logEntry, type: 'wizard', playerKey: pk,
      pAtkRoll: effectivePAtkRoll, wDefRoll: rW_def, pAtkStat: getAttack(player) + coopAtkBoost,
      wAtkRoll: rW_atk, pDefRoll: effectivePDefRoll, pDefStat: getDefence(player) + coopDefBoost,
      wizAtk: gs.wizard.attack, wizDef: gs.wizard.defence, wizArm: gs.wizard.armour,
      playerHitsWiz, wizHitsPlayer,
    };

    if (playerHitsWiz) {
      // If wizard armour already 0, this hit kills wizard
      if (gs.wizard.armour === 0) {
        killWizard(gs, pk);
        events.push({ type: 'wizard_killed', player: pk });
      } else {
        bs.pendingWizardHit = true;
        events.push({ type: 'player_hits_wizard', player: pk });
      }
    }

    if (wizHitsPlayer && !bs.ended) {
      if (getArmourCount(player) > 0) {
        const idx = player.inventory.findIndex(c => c.type === 'armour' && c.value > 0);
        const removed = player.inventory.splice(idx, 1)[0];
        if (!gs.armourBurnsMode) gs.discard.push(removed);
        events.push({ type: 'armour_lost', player: pk, card: removed });
      } else {
        events.push({ type: 'wizard_spell_draw', player: pk, winner: 'wizard' });
      }
    }

    bs.staminaLeft[pk] = Math.max(0, bs.staminaLeft[pk] - 1);
    logEntry.staminaLeft = { ...bs.staminaLeft };

    if (!bs.ended && bs.staminaLeft[pk] <= 0) {
      bs.ended = true; bs.winner = 'wizard';
    }
  }

  bs.log.push(logEntry);
  return { logEntry, events };
}

// ── 3-player battle branches ────────────────────────────────────────────────
// None of these are reachable from a 2-player game (see the guards at the top of
// doBattleRound above), so they carry no 2-player compatibility burden — each just
// needs to be internally deterministic, which a pure function of shared gs state is.

// Solo wizard battle for a player who isn't A or B (i.e. C) — same shape as the
// classic A/B solo branch above, generalized to any single key.
function doBattleRoundSolo(gs, rng, pk) {
  const bs = gs.battleState;
  bs.round++;
  const player = gs.players[pk];
  const pAtkRoll = rngInt(rng, 1, Math.max(1, getAttack(player)));
  const pDefRoll = rngInt(rng, 1, Math.max(1, getDefence(player)));
  const wAtkRoll = rngInt(rng, 1, Math.max(1, gs.wizard.attack));
  const wDefRoll = rngInt(rng, 1, Math.max(1, gs.wizard.defence));
  const coopAtkBoost = bs._coopAtkBoost ?? 0;
  const coopDefBoost = bs._coopDefBoost ?? 0;
  const effectivePAtkRoll = pAtkRoll + coopAtkBoost;
  const effectivePDefRoll = pDefRoll + coopDefBoost;
  const playerHitsWiz = effectivePAtkRoll > wDefRoll;
  const wizHitsPlayer = wAtkRoll > effectivePDefRoll;

  const logEntry = {
    round: bs.round, type: 'wizard', playerKey: pk,
    pAtkRoll: effectivePAtkRoll, wDefRoll, pAtkStat: getAttack(player) + coopAtkBoost,
    wAtkRoll, pDefRoll: effectivePDefRoll, pDefStat: getDefence(player) + coopDefBoost,
    wizAtk: gs.wizard.attack, wizDef: gs.wizard.defence, wizArm: gs.wizard.armour,
    playerHitsWiz, wizHitsPlayer,
  };
  const events = [];

  if (playerHitsWiz) {
    if (gs.wizard.armour === 0) {
      killWizard(gs, pk);
      events.push({ type: 'wizard_killed', player: pk });
    } else {
      bs.pendingWizardHit = true;
      events.push({ type: 'player_hits_wizard', player: pk });
    }
  }

  if (wizHitsPlayer && !bs.ended) {
    if (getArmourCount(player) > 0) {
      const idx = player.inventory.findIndex(c => c.type === 'armour' && c.value > 0);
      const removed = player.inventory.splice(idx, 1)[0];
      if (!gs.armourBurnsMode) gs.discard.push(removed);
      events.push({ type: 'armour_lost', player: pk, card: removed });
    } else {
      events.push({ type: 'wizard_spell_draw', player: pk, winner: 'wizard' });
    }
  }

  bs.staminaLeft[pk] = Math.max(0, bs.staminaLeft[pk] - 1);
  logEntry.staminaLeft = { ...bs.staminaLeft };
  if (!bs.ended && bs.staminaLeft[pk] <= 0) { bs.ended = true; bs.winner = 'wizard'; }

  bs.log.push(logEntry);
  return { logEntry, events };
}

// Island duel between any 2 of the 3 players (at least one of whom isn't A or B) —
// the same round-robin "both roll every round, first hit wins the card, battle runs
// until both are out of stamina" mechanic as the classic A/B duo, just generalized
// to whichever pair is actually contesting the island.
function doBattleRoundDuo(gs, rng, combatants) {
  const bs = gs.battleState;
  bs.round++;
  const [k1, k2] = combatants;
  const p1 = gs.players[k1], p2 = gs.players[k2];
  const r1_atk = rngInt(rng, 1, Math.max(1, getAttack(p1)));
  const r2_def = rngInt(rng, 1, Math.max(1, getDefence(p2)));
  const r2_atk = rngInt(rng, 1, Math.max(1, getAttack(p2)));
  const r1_def = rngInt(rng, 1, Math.max(1, getDefence(p1)));

  const atk = bs.attackerKey;
  const def = atk === k1 ? k2 : k1;
  const atkRoll = atk === k1 ? r1_atk : r2_atk;
  const defRoll = def === k1 ? r1_def : r2_def;
  const hit = atkRoll > defRoll;

  const logEntry = {
    round: bs.round, type: 'pvp', attacker: atk, defender: def,
    atkRoll, defRoll, atkStat: getAttack(gs.players[atk]), defStat: getDefence(gs.players[def]), hit,
  };
  const events = [];

  if (hit) {
    if (!bs.cardWinner) bs.cardWinner = atk;
    const defPlayer = gs.players[def];
    if (getArmourCount(defPlayer) > 0) {
      const idx = defPlayer.inventory.findIndex(c => c.type === 'armour' && c.value > 0);
      const removed = defPlayer.inventory.splice(idx, 1)[0];
      if (!gs.armourBurnsMode) gs.discard.push(removed);
      events.push({ type: 'armour_lost', player: def, card: removed });
    } else {
      events.push({ type: 'wizard_spell_draw', player: def, winner: atk });
    }
  }

  bs.staminaLeft[atk] = Math.max(0, bs.staminaLeft[atk] - 1);
  bs.attackerKey = def;
  logEntry.staminaLeft = { ...bs.staminaLeft };
  if (bs.staminaLeft[k1] <= 0 && bs.staminaLeft[k2] <= 0) {
    bs.ended = true; bs.winner = bs.cardWinner;
  }

  bs.log.push(logEntry);
  return { logEntry, events };
}

// Island free-for-all between all 3 players — turn order rotates through bs.order;
// the current attacker's chosen target (bs.targetKey, set before rolling) is attacked;
// the first landed hit wins the card outright and ends the battle immediately. A miss
// just rotates the attack to the next player in order.
function doBattleRoundFFA(gs, rng) {
  const bs = gs.battleState;
  bs.round++;
  const atk = bs.attackerKey;
  const def = bs.targetKey;
  const atkP = gs.players[atk], defP = gs.players[def];
  const atkRoll = rngInt(rng, 1, Math.max(1, getAttack(atkP)));
  const defRoll = rngInt(rng, 1, Math.max(1, getDefence(defP)));
  const hit = atkRoll > defRoll;

  const logEntry = {
    round: bs.round, type: 'pvp', attacker: atk, defender: def,
    atkRoll, defRoll, atkStat: getAttack(atkP), defStat: getDefence(defP), hit,
  };
  const events = [];

  if (hit) {
    bs.cardWinner = atk;
    bs.ended = true;
    bs.winner = atk;
    events.push({ type: 'ffa_hit', attacker: atk, defender: def });
  } else {
    const order = bs.order;
    const idx = order.indexOf(atk);
    bs.attackerKey = order[(idx + 1) % order.length];
    bs.targetKey = null;
  }

  bs.log.push(logEntry);
  return { logEntry, events };
}

// Merged-force wizard battle (2 or 3 cooperators fighting together as one). Combined
// attack/defence come from summing every cooperator's stats; the shared stamina pool
// is the sum of theirs too. A wizard hit is spread across the whole group — each
// member with armour loses a piece, each member with none draws their own spell.
function doBattleRoundGroup(gs, rng) {
  const bs = gs.battleState;
  bs.round++;
  const keys = bs.groupKeys;
  const groupAtk = keys.reduce((sum, k) => sum + getAttack(gs.players[k]), 0);
  const groupDef = keys.reduce((sum, k) => sum + getDefence(gs.players[k]), 0);
  const pAtkRoll = rngInt(rng, 1, Math.max(1, groupAtk));
  const pDefRoll = rngInt(rng, 1, Math.max(1, groupDef));
  const wAtkRoll = rngInt(rng, 1, Math.max(1, gs.wizard.attack));
  const wDefRoll = rngInt(rng, 1, Math.max(1, gs.wizard.defence));
  const playerHitsWiz = pAtkRoll > wDefRoll;
  const wizHitsPlayer = wAtkRoll > pDefRoll;

  const logEntry = {
    round: bs.round, type: 'wizard_group', groupKeys: keys,
    pAtkRoll, wDefRoll, pAtkStat: groupAtk, wAtkRoll, pDefRoll, pDefStat: groupDef,
    wizAtk: gs.wizard.attack, wizDef: gs.wizard.defence, wizArm: gs.wizard.armour,
    playerHitsWiz, wizHitsPlayer,
  };
  const events = [];

  if (playerHitsWiz) {
    if (gs.wizard.armour === 0) {
      killWizard(gs, keys.slice());
      events.push({ type: 'wizard_killed', player: keys[0], group: keys });
    } else {
      bs.pendingWizardHit = true;
      events.push({ type: 'player_hits_wizard', player: keys[0], group: keys });
    }
  }

  if (wizHitsPlayer && !bs.ended) {
    keys.forEach(k => {
      const p = gs.players[k];
      if (getArmourCount(p) > 0) {
        const idx = p.inventory.findIndex(c => c.type === 'armour' && c.value > 0);
        const removed = p.inventory.splice(idx, 1)[0];
        if (!gs.armourBurnsMode) gs.discard.push(removed);
        events.push({ type: 'armour_lost', player: k, card: removed });
      } else {
        events.push({ type: 'wizard_spell_draw', player: k, winner: 'wizard' });
      }
    });
  }

  bs.staminaLeft.GROUP = Math.max(0, bs.staminaLeft.GROUP - 1);
  logEntry.staminaLeft = { ...bs.staminaLeft };
  if (!bs.ended && bs.staminaLeft.GROUP <= 0) { bs.ended = true; bs.winner = 'wizard'; }

  bs.log.push(logEntry);
  return { logEntry, events };
}

// ── Wizard stat reduction (after player_hits_wizard event) ─────────────────
export function reduceWizardStat(gs, stat) {
  const w = gs.wizard;
  if (stat === 'armour') w.armour = Math.max(0, w.armour - 1);
  else if (stat === 'attack') w.attack = Math.max(1, w.attack - 1);
  else if (stat === 'defence') w.defence = Math.max(1, w.defence - 1);
  w.armourZero = w.armour === 0;
  if (gs.battleState) gs.battleState.pendingWizardHit = false;
  return { stat, newValue: w[stat], armourZero: w.armourZero };
}

export function killWizard(gs, playerKey) {
  gs.wizard.defeated = true;
  gs.wizard.defeatedBy = playerKey;
  if (gs.battleState) { gs.battleState.ended = true; gs.battleState.winner = playerKey; }
}

export function retreatFromBattle(gs) {
  if (!gs.battleState) return;
  gs.battleState.ended = true;
  gs.battleState.retreated = true;
  gs.battleState.winner = gs.battleState.cardWinner;
}

// ── Dark wizard spell draw ─────────────────────────────────────────────────
// Returns the full pool entry (not just its text) so callers can see vibeDurationMs /
// vibeController and automate "wear the vibe" forfeits instead of leaving them as text.
export function drawWizardSpell(gs, victimKey) {
  const idx = gs.wizardSpellOrder[gs.wizardSpellIdx % gs.wizardSpellOrder.length];
  gs.wizardSpellIdx++;
  const spell = WIZARD_SPELL_POOL[idx];
  gs.players[victimKey].forfeitLog.push({ text: spell.text, turn: gs.turn });
  return spell;
}

// ── Win condition ──────────────────────────────────────────────────────────
export function checkWinCondition(gs) {
  if (gs.wizard.defeated) return { winner: gs.wizard.defeatedBy, reason: 'The Dark Wizard is defeated!' };
  return null;
}
