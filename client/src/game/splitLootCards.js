// Card pool — what the map generator can place in rooms
export const CARD_POOL = {
  1: ['shock', 'guard_whistle', 'blind', 'freeze', 'gamble', 'loot_bag'],
  2: ['shock', 'swap', 'flood', 'shortcut', 'shield', 'loot_bag'],
  3: ['shock', 'blind', 'freeze', 'swap', 'shortcut', 'shield'],
};

export const CLAIM_CARDS = {
  truth:     { id: 'truth',     name: 'Truth',     tier: 1, desc: 'Winner picks a truth. Loser must answer honestly.' },
  dare:      { id: 'dare',      name: 'Dare',      tier: 2, desc: 'Winner issues a dare. Loser must complete it.' },
  control:   { id: 'control',   name: 'Control',   tier: 3, desc: 'Winner controls loser\'s vibrator for 60 seconds.' },
  strip:     { id: 'strip',     name: 'Strip',     tier: 2, desc: 'Loser removes an item of clothing.' },
  drink:     { id: 'drink',     name: 'Drink',     tier: 1, desc: 'Loser takes a drink of winner\'s choice.' },
  surrender: { id: 'surrender', name: 'Surrender', tier: 3, desc: 'Loser does whatever winner says for 5 minutes.' },
};

// Assign random instant/double cards and inject claim cards based on enabled deck
export function assignCardTypes(rng, room, enabledForfeitCards) {
  return room.cards.map(pos => {
    const pool = CARD_POOL[room.id + 1] || CARD_POOL[1];
    const id = pool[Math.floor(rng() * pool.length)];
    return { ...pos, id, resolved: false };
  });
}

// Called when a player walks onto a card tile
// Returns { newState, logMessage, hapticEvent }
export function resolveCard(card, pickerKey, gs, rng) {
  const INSTANT = ['shock', 'guard_whistle', 'blind', 'freeze', 'swap', 'flood'];
  const DOUBLE  = ['gamble', 'loot_bag', 'shortcut', 'shield'];
  const CLAIM   = Object.keys(CLAIM_CARDS);

  if (INSTANT.includes(card.id)) {
    return resolveInstant(card, pickerKey, gs, rng);
  }
  if (DOUBLE.includes(card.id)) {
    const good = rng() >= 0.5;
    return resolveDouble(card, pickerKey, gs, good, rng);
  }
  if (CLAIM.includes(card.id)) {
    gs.players[pickerKey].cards.push({ ...CLAIM_CARDS[card.id] });
    return { log: `${playerName(pickerKey, gs)} picked up something useful` };
  }
  return { log: `${playerName(pickerKey, gs)} found a card` };
}

function playerName(key, gs) {
  return key === 'A' ? gs.playerNames.A : gs.playerNames.B;
}

function other(key) { return key === 'A' ? 'B' : 'A'; }

function resolveInstant(card, key, gs, rng) {
  const opp = key === 'A' ? 'B' : 'A';
  const name = playerName(key, gs);
  switch (card.id) {
    case 'shock':
      gs.effects.pendingHaptic = { target: key, intensity: 0.8, duration: 2000 };
      return { log: `${name} triggered something — a sharp jolt` };

    case 'guard_whistle':
      gs.effects.attractPosition = { ...gs.players[key].position };
      return { log: `${name} found something and it made a sound` };

    case 'blind':
      gs.effects.blind[opp] = 2;
      return { log: `${name} found something and used it immediately` };

    case 'freeze':
      gs.effects.freeze[opp] = 1;
      return { log: `${name} found something — ${playerName(opp, gs)} is stuck` };

    case 'swap': {
      const posA = { ...gs.players.A.position };
      const posB = { ...gs.players.B.position };
      gs.players.A.position = posB;
      gs.players.B.position = posA;
      return { log: `${name} triggered a swap — both players relocated` };
    }

    case 'flood': {
      const pos = gs.players[opp].position;
      const candidates = [];
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const nx = pos.x + dx, ny = pos.y + dy;
          if (nx >= 1 && nx <= 8 && ny >= 1 && ny <= 8) {
            const room = gs.rooms[gs.players[opp].position.room];
            if (room.grid[ny][nx] === 0) candidates.push({ x: nx, y: ny });
          }
        }
      }
      if (candidates.length) {
        const idx = Math.floor(rng() * candidates.length);
        const p = candidates[idx];
        const room = gs.rooms[gs.players[opp].position.room];
        room.pads.push({ x: p.x, y: p.y, type: 'distraction' });
      }
      return { log: `${name} planted something near their opponent` };
    }

    default:
      return { log: `${name} found a card` };
  }
}

function resolveDouble(card, key, gs, good, rng) {
  const name = playerName(key, gs);
  switch (card.id) {
    case 'gamble':
      if (good) {
        gs.players[key].remoteUses = (gs.players[key].remoteUses || 0) + 1;
        return { log: `${name} gambled — and gained a remote use` };
      } else {
        // Spawn a guard next to player — handled by game logic reading pendingSpawn
        gs.effects.pendingSpawn = { roomIdx: gs.players[key].position.room, near: gs.players[key].position };
        return { log: `${name} gambled — and lost` };
      }

    case 'loot_bag':
      if (good) {
        // Grab nearest loot in same room
        const room = gs.rooms[gs.players[key].position.room];
        const pos = gs.players[key].position;
        let nearest = null, nearestDist = Infinity;
        for (const l of room.loot) {
          const d = Math.abs(l.x - pos.x) + Math.abs(l.y - pos.y);
          if (d < nearestDist) { nearestDist = d; nearest = l; }
        }
        if (nearest) {
          gs.players[key].loot += nearest.value;
          room.loot = room.loot.filter(l => l !== nearest);
        }
        return { log: `${name} struck lucky — grabbed nearby loot` };
      } else {
        const lost = gs.players[key].loot;
        gs.players[key].loot = Math.floor(gs.players[key].loot / 2);
        return { log: `${name} fumbled — dropped half their loot` };
      }

    case 'shortcut':
      if (good) {
        // Teleport to next room entry
        const nextRoom = gs.players[key].position.room + 1;
        if (nextRoom < 3) {
          gs.players[key].position = { room: nextRoom, x: gs.rooms[nextRoom].entry.x, y: gs.rooms[nextRoom].entry.y };
        }
        return { log: `${name} found a shortcut — advanced a room` };
      } else {
        const randRoom = Math.floor(rng() * 3);
        gs.players[key].position = { room: randRoom, x: gs.rooms[randRoom].entry.x, y: gs.rooms[randRoom].entry.y };
        return { log: `${name} used a shortcut — ended up somewhere unexpected` };
      }

    case 'shield':
      if (good) {
        gs.effects.padImmunity[key] = 1;
        return { log: `${name} found a shield — next trap won't fire` };
      } else {
        gs.effects.doubleGuardSpeed = 3;
        return { log: `${name} triggered something — guards are moving faster` };
      }

    default:
      return { log: `${name} found a card` };
  }
}

export function buildClaimCardPool(rng, roomIdx, enabledForfeitCards) {
  const enabled = enabledForfeitCards.filter(id => CLAIM_CARDS[id]);
  if (!enabled.length) return null;
  const idx = Math.floor(rng() * enabled.length);
  return { ...CLAIM_CARDS[enabled[idx]] };
}

export function resolveForfeits(gs) {
  const A = gs.players.A;
  const B = gs.players.B;
  const aWin = A.status === 'escaped' && A.loot >= gs.winThreshold;
  const bWin = B.status === 'escaped' && B.loot >= gs.winThreshold;

  let outcome;
  if (aWin && bWin) outcome = '2_winners';
  else if (aWin) outcome = 'a_wins';
  else if (bWin) outcome = 'b_wins';
  else outcome = '2_losers';

  const forfeits = [];
  const opp = k => k === 'A' ? 'B' : 'A';

  if (outcome === '2_losers') {
    forfeits.push({ desc: 'Both players lose — take a forfeit drink', mandatory: true });
    const loser = A.loot <= B.loot ? 'A' : 'B';
    forfeits.push({ desc: `${gs.playerNames[loser]} had less loot — takes an extra forfeit`, mandatory: true, player: loser });
    return { outcome, forfeits };
  }

  const winner = outcome === 'a_wins' ? 'A' : (outcome === 'b_wins' ? 'B' : null);
  const loser  = winner ? opp(winner) : null;

  if (outcome === '2_winners') {
    const richer = A.loot >= B.loot ? 'A' : 'B';
    const poorer = opp(richer);
    const richCards = gs.players[richer].cards;
    const poorIds = gs.players[poorer].cards.map(c => c.id);
    for (const c of richCards) {
      if (!poorIds.includes(c.id)) {
        forfeits.push({ desc: `${gs.playerNames[richer]} redeems "${c.name}" — ${c.desc}`, card: c.id, winner: richer, loser: poorer });
      }
    }
  } else if (winner) {
    for (const c of gs.players[winner].cards) {
      forfeits.push({ desc: `${gs.playerNames[winner]} redeems "${c.name}" — ${c.desc}`, card: c.id, winner, loser });
    }
  }

  return { outcome, forfeits };
}
