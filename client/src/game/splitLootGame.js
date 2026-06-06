import { makeRng, rngInt } from './seededRng.js';
import { generateGame } from './splitLootMap.js';
import { moveGuard, getEscalationRoom, spawnEscalationGuard, spawnReinforcementGuard } from './splitLootGuard.js';
import { resolveCard, assignCardTypes, resolveForfeits, CARD_POOL, CLAIM_CARDS } from './splitLootCards.js';

const WIN_THRESHOLD = { easy: 4, normal: 6, hard: 8 };
const GUARD_SPEED   = { easy: 2, normal: 1, hard: 1 }; // moves every N turns
const REMOTE_DURATION = { easy: 12, normal: 10, hard: 7 };
const SECOND_REMOTE_TURN = { easy: 3, normal: 5, hard: 7 };

export function createGameState(seed, difficulty, enabledForfeitCards, playerNames) {
  const rng = makeRng(seed);
  const mapData = generateGame(seed, difficulty, enabledForfeitCards);

  const rng2 = makeRng(seed ^ 0xdeadbeef);
  for (const room of mapData.rooms) {
    room.cards = assignAndMixCards(rng2, room, enabledForfeitCards);
  }
  for (const corridor of mapData.corridors) {
    corridor.cards = [];
  }

  return {
    seed,
    difficulty,
    enabledForfeitCards,
    playerNames,
    turn: 1,
    pendingIntents: { A: null, B: null },
    phase: 'playing',
    winThreshold: WIN_THRESHOLD[difficulty] || 6,
    rooms: mapData.rooms,
    corridors: mapData.corridors,
    players: {
      A: { position: { room: 0, x: 1, y: 1 }, loot: 0, cards: [], status: 'active', remoteUses: 0 },
      B: { position: { room: 0, x: 2, y: 1 }, loot: 0, cards: [], status: 'active', remoteUses: 0 },
    },
    effects: {
      attractPosition: null,
      blind: { A: 0, B: 0 },
      freeze: { A: 0, B: 0 },
      padImmunity: { A: 0, B: 0 },
      doubleGuardSpeed: 0,
      remoteActive: false,
      remoteController: null,
      remoteTarget: null,
      remoteTimeLeft: 0,
      pendingHaptic: null,
      pendingSpawn: null,
    },
    events: [],
    secondRemoteSpawned: false,
  };
}

function assignAndMixCards(rng, room, enabledForfeitCards) {
  return room.cards.map(pos => {
    const claimEnabled = enabledForfeitCards.length > 0;
    if (claimEnabled && rng() < 0.5) {
      const claimId = enabledForfeitCards[Math.floor(rng() * enabledForfeitCards.length)];
      return { ...pos, id: claimId, resolved: false };
    }
    const pool = CARD_POOL[room.id + 1] || CARD_POOL[1];
    return { ...pos, id: pool[Math.floor(rng() * pool.length)], resolved: false };
  });
}

function addEvent(gs, message, type = 'info') {
  gs.events.unshift({ turn: gs.turn, message, type });
  if (gs.events.length > 20) gs.events.length = 20;
}

function posMatch(a, b) {
  return a.x === b.x && a.y === b.y;
}

function checkGuardCollision(gs, playerKey) {
  const pos = gs.players[playerKey].position;
  if (pos.room === undefined || pos.room < 0 || pos.room > 2) return;
  const room = gs.rooms[pos.room];
  for (const guard of room.guards) {
    if (posMatch(guard.position, pos)) {
      gs.players[playerKey].status = 'caught';
      addEvent(gs, `${gs.playerNames[playerKey]} has been detained`, 'danger');
      return;
    }
  }
}

function checkTrap(gs, playerKey) {
  const pos = gs.players[playerKey].position;
  if (pos.room === undefined || pos.room > 2) return;
  const room = gs.rooms[pos.room];

  if (gs.effects.padImmunity[playerKey] > 0) {
    gs.effects.padImmunity[playerKey]--;
    return;
  }

  const pad = room.pads.find(p => p.x === pos.x && p.y === pos.y);
  if (!pad) return;

  gs.effects.pendingHaptic = { target: playerKey, intensity: 0.6, duration: 500 };
  room.triggeredPads = room.triggeredPads || [];
  room.triggeredPads.push({ ...pos });

  if (pad.type === 'distraction') {
    gs.effects.attractPosition = { room: pos.room, x: pos.x, y: pos.y };
    addEvent(gs, `${gs.playerNames[playerKey]} disturbed something in Room ${pos.room + 1}`, 'warning');
  } else {
    spawnReinforcementGuard(room, pos);
    addEvent(gs, `${gs.playerNames[playerKey]} disturbed something — it's getting louder`, 'danger');
  }
}

function moveAllGuards(gs, difficulty) {
  const guardSpeed = GUARD_SPEED[difficulty] || 1;
  const doubleSpeed = gs.effects.doubleGuardSpeed > 0;

  const shouldMove = doubleSpeed || (gs.turn % guardSpeed === 0);
  if (!shouldMove) return;

  for (const room of gs.rooms) {
    const attractPos = gs.effects.attractPosition && gs.effects.attractPosition.room === room.id
      ? { x: gs.effects.attractPosition.x, y: gs.effects.attractPosition.y }
      : null;

    let attractReached = false;
    for (const guard of room.guards) {
      const reached = moveGuard(guard, attractPos);
      if (reached) attractReached = true;
    }

    if (attractReached) gs.effects.attractPosition = null;

    room.guards = room.guards.filter(g => {
      if (!g.isReinforcement) return true;
      g.reinforcementTurnsLeft--;
      return g.reinforcementTurnsLeft > 0;
    });
  }
}

function checkAllGuardCollisions(gs) {
  for (const key of ['A', 'B']) {
    if (gs.players[key].status === 'active') {
      checkGuardCollision(gs, key);
    }
  }
}

function tickEffects(gs) {
  for (const key of ['A', 'B']) {
    if (gs.effects.blind[key] > 0) gs.effects.blind[key]--;
    if (gs.effects.freeze[key] > 0) gs.effects.freeze[key]--;
    if (gs.effects.padImmunity[key] > 0) gs.effects.padImmunity[key]--;
  }
  if (gs.effects.doubleGuardSpeed > 0) gs.effects.doubleGuardSpeed--;

  if (gs.effects.remoteActive) {
    gs.effects.remoteTimeLeft--;
    if (gs.effects.remoteTimeLeft <= 0) {
      gs.effects.remoteActive = false;
      gs.effects.remoteController = null;
      gs.effects.remoteTarget = null;
      gs.effects.attractPosition = null;
    }
  }
}

function spawnSecondRemote(gs, rng) {
  const secondTurn = SECOND_REMOTE_TURN[gs.difficulty] || 5;
  if (gs.secondRemoteSpawned || gs.turn !== secondTurn) return;

  const furthestRoom = Math.max(gs.players.A.position.room ?? 0, gs.players.B.position.room ?? 0);
  const roomIdx = Math.min(furthestRoom + 1, 2);
  const room = gs.rooms[roomIdx];

  const freeTiles = [];
  for (let y = 1; y < 9; y++) {
    for (let x = 1; x < 9; x++) {
      if (room.grid[y][x] === 0) {
        const occupied = room.loot.some(l => l.x === x && l.y === y)
          || room.cards.some(c => c.x === x && c.y === y)
          || room.remotes.some(r => r.x === x && r.y === y);
        if (!occupied) freeTiles.push({ x, y });
      }
    }
  }
  if (freeTiles.length) {
    const pos = freeTiles[rngInt(rng, 0, freeTiles.length - 1)];
    room.remotes.push({ ...pos });
    gs.secondRemoteSpawned = true;
    addEvent(gs, `Something was left behind in Room ${roomIdx + 1}`, 'info');
  }
}

// Main action entry point — stores intent, fires resolveRound when both players have submitted
export function submitIntent(gs, action, playerKey, rng) {
  if (gs.phase !== 'playing') return;
  if (gs.pendingIntents[playerKey] !== null) return; // already submitted this round

  gs.pendingIntents[playerKey] = action;

  // Auto-submit 'wait' for any inactive (caught/escaped) player that hasn't submitted
  for (const key of ['A', 'B']) {
    if (gs.players[key].status !== 'active' && gs.pendingIntents[key] === null) {
      gs.pendingIntents[key] = { type: 'wait', actor: key };
    }
  }

  if (gs.pendingIntents.A !== null && gs.pendingIntents.B !== null) {
    resolveRound(gs, rng);
  }
}

function resolveRound(gs, rng) {
  gs.effects.pendingHaptic = null;
  gs.effects.pendingSpawn = null;

  // Execute each player's intent
  for (const key of ['A', 'B']) {
    const intent = gs.pendingIntents[key];
    const player = gs.players[key];
    if (player.status !== 'active') continue;

    if (gs.effects.freeze[key] > 0) {
      gs.effects.freeze[key]--;
      addEvent(gs, `${gs.playerNames[key]} is frozen — turn skipped`, 'warning');
      continue;
    }

    switch (intent.type) {
      case 'move':   handleMove(gs, key, intent.dir, rng); break;
      case 'remote': handleActivateRemote(gs, key); break;
      case 'wait':
        if (player.status === 'active') addEvent(gs, `${gs.playerNames[key]} waits`, 'info');
        break;
    }
  }

  // Handle card-triggered guard spawns
  if (gs.effects.pendingSpawn) {
    const { roomIdx, near } = gs.effects.pendingSpawn;
    spawnReinforcementGuard(gs.rooms[roomIdx], near);
    gs.effects.pendingSpawn = null;
  }

  // Guards move one step
  moveAllGuards(gs, gs.difficulty);
  checkAllGuardCollisions(gs);
  tickEffects(gs);
  spawnSecondRemote(gs, rng);

  // Escalation guard spawn
  const escalationRoom = getEscalationRoom(gs.turn, gs.difficulty);
  if (escalationRoom !== null) {
    const spawned = spawnEscalationGuard(gs.rooms[escalationRoom], gs.difficulty);
    if (spawned) addEvent(gs, `Footsteps echo through Room ${escalationRoom + 1}`, 'warning');
  }

  gs.pendingIntents = { A: null, B: null };
  gs.turn++;

  const result = checkWinConditions(gs);
  if (result) { gs.phase = 'ended'; gs.outcome = result; }
}

function handleMove(gs, key, dir, rng) {
  const player = gs.players[key];
  const pos = player.position;

  const deltas = { up: [0,-1], down: [0,1], left: [-1,0], right: [1,0] };
  const [dx, dy] = deltas[dir] || [0, 0];
  const nx = pos.x + dx;
  const ny = pos.y + dy;

  if (pos.room >= 0 && pos.room <= 2) {
    const room = gs.rooms[pos.room];
    if (nx < 0 || nx > 9 || ny < 0 || ny > 9) return;
    if (room.grid[ny][nx] === 1) return;

    player.position = { room: pos.room, x: nx, y: ny };

    if (nx === room.exit.x && ny === room.exit.y) {
      if (pos.room < 2) {
        player.position = { corridor: pos.room, tileIdx: 0 };
        addEvent(gs, `${gs.playerNames[key]} slipped into the corridor`, 'info');
      } else {
        player.status = 'escaped';
        addEvent(gs, `${gs.playerNames[key]} slipped out`, 'info');
      }
      return;
    }

    checkTrap(gs, key);
    if (player.status !== 'active') return;

    const lootIdx = room.loot.findIndex(l => l.x === nx && l.y === ny);
    if (lootIdx >= 0) {
      player.loot += room.loot[lootIdx].value;
      room.loot.splice(lootIdx, 1);
      addEvent(gs, `${gs.playerNames[key]} grabbed some loot`, 'info');
    }

    const cardIdx = room.cards.findIndex(c => c.x === nx && c.y === ny && !c.resolved);
    if (cardIdx >= 0) {
      const card = room.cards[cardIdx];
      room.cards[cardIdx].resolved = true;
      const result = resolveCard(card, key, gs, rng);
      if (result.log) addEvent(gs, result.log, 'info');
    }

    const remoteIdx = room.remotes.findIndex(r => r.x === nx && r.y === ny);
    if (remoteIdx >= 0) {
      player.remoteUses = (player.remoteUses || 0) + 1;
      room.remotes.splice(remoteIdx, 1);
      addEvent(gs, `${gs.playerNames[key]} picked up a device`, 'info');
    }

    checkGuardCollision(gs, key);

  } else if (pos.corridor !== undefined) {
    handleCorridorMove(gs, key, dir, rng);
  }
}

function handleCorridorMove(gs, key, dir, rng) {
  const player = gs.players[key];
  const corridorIdx = player.position.corridor;
  const corridor = gs.corridors[corridorIdx];
  let tileIdx = player.position.tileIdx;

  if (dir === 'right' || dir === 'down') tileIdx++;
  else if (dir === 'left' || dir === 'up') tileIdx--;

  if (tileIdx < 0) {
    const room = gs.rooms[corridorIdx];
    player.position = { room: corridorIdx, x: room.exit.x, y: room.exit.y - 1 };
    return;
  }

  if (tileIdx >= corridor.tiles.length) {
    const nextRoomIdx = corridorIdx + 1;
    const nextRoom = gs.rooms[nextRoomIdx];
    player.position = { room: nextRoomIdx, x: nextRoom.entry.x, y: nextRoom.entry.y };
    addEvent(gs, `${gs.playerNames[key]} entered Room ${nextRoomIdx + 1}`, 'info');
    return;
  }

  player.position = { corridor: corridorIdx, tileIdx };

  const pad = corridor.pads.find(p => p.x === tileIdx);
  if (pad) {
    gs.effects.pendingHaptic = { target: key, intensity: 0.6, duration: 500 };
    addEvent(gs, `${gs.playerNames[key]} disturbed something in the corridor`, 'warning');
  }

  const lootIdx = corridor.loot.findIndex(l => l.x === tileIdx);
  if (lootIdx >= 0) {
    player.loot += corridor.loot[lootIdx].value;
    corridor.loot.splice(lootIdx, 1);
    addEvent(gs, `${gs.playerNames[key]} grabbed some loot`, 'info');
  }
}

function handleActivateRemote(gs, key) {
  const player = gs.players[key];
  if (!player.remoteUses || player.remoteUses <= 0) return;
  const targetKey = key === 'A' ? 'B' : 'A';

  player.remoteUses--;
  gs.effects.remoteActive = true;
  gs.effects.remoteController = key;
  gs.effects.remoteTarget = targetKey;
  gs.effects.remoteTimeLeft = REMOTE_DURATION[gs.difficulty] || 10;
  gs.effects.attractPosition = { ...gs.players[targetKey].position };

  addEvent(gs, `${gs.playerNames[key]} activated a device`, 'warning');
}

export function checkWinConditions(gs) {
  const A = gs.players.A;
  const B = gs.players.B;
  const aResolved = A.status === 'escaped' || A.status === 'caught';
  const bResolved = B.status === 'escaped' || B.status === 'caught';
  if (!aResolved || !bResolved) return null;

  const aWin = A.status === 'escaped' && A.loot >= gs.winThreshold;
  const bWin = B.status === 'escaped' && B.loot >= gs.winThreshold;

  if (aWin && bWin) return '2_winners';
  if (aWin) return 'a_wins';
  if (bWin) return 'b_wins';
  return '2_losers';
}

export { resolveForfeits };
