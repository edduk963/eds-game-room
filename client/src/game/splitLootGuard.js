function stepToward(from, to) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx !== 0) return { x: from.x + dx, y: from.y };
  return { x: from.x, y: from.y + dy };
}

function nearestPatrolIndex(pos, path) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = Math.abs(path[i].x - pos.x) + Math.abs(path[i].y - pos.y);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

// moveGuard returns true if attractPosition was reached (so caller can clear it)
export function moveGuard(guard, attractPosition) {
  if (guard.isReinforcement) {
    if (attractPosition) {
      guard.position = stepToward(guard.position, attractPosition);
    }
    return false;
  }

  if (attractPosition && !guard.investigating) {
    guard.position = stepToward(guard.position, attractPosition);
    if (guard.position.x === attractPosition.x && guard.position.y === attractPosition.y) {
      guard.investigating = true;
      guard.investigateTurns = 3;
      return true;
    }
    return false;
  }

  if (guard.investigating) {
    guard.investigateTurns--;
    if (guard.investigateTurns <= 0) {
      guard.investigating = false;
      guard.patrolIndex = nearestPatrolIndex(guard.position, guard.patrolPath);
    }
    return false;
  }

  // Step one tile toward the next waypoint; advance index only on arrival
  const nextIdx = (guard.patrolIndex + 1) % guard.patrolPath.length;
  const target = guard.patrolPath[nextIdx];
  guard.position = stepToward(guard.position, target);
  if (guard.position.x === target.x && guard.position.y === target.y) {
    guard.patrolIndex = nextIdx;
  }
  return false;
}

// Escalation schedule: [turn, roomIdx]
const ESCALATION = {
  easy:   [[10,0],[16,1],[20,0],[24,1],[28,2]],
  normal: [[8,0],[10,1],[14,0],[16,2],[20,1],[24,2],[28,0]],
  hard:   [[8,0],[10,0],[12,1],[14,1],[16,2],[18,2],[20,0],[24,1]],
};

const ESCALATION_INTERVAL = { easy: 8, normal: 6, hard: 4 };
const ESCALATION_ROOM_CAP = { easy: 3, normal: 4, hard: 5 };

export function getEscalationRoom(turn, difficulty) {
  const schedule = ESCALATION[difficulty] || ESCALATION.normal;
  const match = schedule.find(([t]) => t === turn);
  if (match) return match[1];

  const lastTurn = schedule[schedule.length - 1][0];
  if (turn > lastTurn) {
    const interval = ESCALATION_INTERVAL[difficulty];
    if ((turn - lastTurn) % interval === 0) {
      return (turn / interval) % 3 | 0;
    }
  }
  return null;
}

function firstEdgeTile(room) {
  for (let x = 1; x <= 8; x++) {
    if (room.grid[1][x] === 0) return { x, y: 1 };
  }
  for (let y = 2; y <= 7; y++) {
    if (room.grid[y][8] === 0) return { x: 8, y };
  }
  for (let x = 8; x >= 1; x--) {
    if (room.grid[8][x] === 0) return { x, y: 8 };
  }
  for (let y = 7; y >= 2; y--) {
    if (room.grid[y][1] === 0) return { x: 1, y };
  }
  return { x: 1, y: 1 };
}

// Patrol paths — waypoints verified as floor tiles for new room layouts.
// Room 1 walls: (2,2)(3,2)(2,3) | (6,2)(7,2)(7,3) | (4,4)(5,4)(4,5)(5,5) | (2,6)(2,7)(3,7) | (6,6)(7,6)(7,7)
// Room 2 walls: (4,1)(4,2)(2,2)(2,3)(2,4)(3,4)(4,4)(6,2)(7,2)(6,3)(1,6)(2,6)(3,6)(4,6)(4,7)(7,6)(4,7)(7,7)
// Room 3 walls: (3,1)(3,2)(5,2)(6,2)(5,3)(1,4)(2,4)(3,4)(5,3)(5,4)(7,4)(8,4) | (4,5)(7,6)(6,6)(4,6)(5,6)(6,6)(2,6)(3,6)(4,6)(6,6)(6,7)
//
// Patrol first waypoints are placed far from entry (1,1) and player B spawn (2,1)
// to avoid immediate guard/player collisions on game start.
const ROOM_PATROLS = [
  // Room 1 — two cover clusters + central chokepoint
  // Walls: corners at (2-3,2-3), (6-7,2-3), centre (4-5,4-5), (2-3,6-7), (6-7,6-7)
  [
    [{ x:6,y:8 },{ x:1,y:8 },{ x:1,y:5 },{ x:6,y:5 }],  // left sweep, far from entry
    [{ x:8,y:5 },{ x:8,y:2 },{ x:5,y:2 },{ x:5,y:8 }],  // right column
  ],
  // Room 2 — corridor maze
  // Walls: (4,1)(4,2), (2,2-4)(3,4)(4,4), (6-7,2)(6,3), (1-3,6)(4,6-7), (7,6-7)
  [
    [{ x:8,y:8 },{ x:1,y:8 },{ x:1,y:5 },{ x:8,y:5 }],  // bottom sweep
    [{ x:7,y:8 },{ x:7,y:5 },{ x:8,y:5 },{ x:8,y:8 }],  // right side loop
    [{ x:5,y:1 },{ x:8,y:1 },{ x:8,y:3 },{ x:5,y:3 }],  // top-right box
  ],
  // Room 3 — tight corridors
  // Walls: (3,1), (3-4,2)(5-6,2), (5,3), (1-3,4)(5,4)(7-8,4), (4,5), (2-4,6)(6-7,6), (2,7)(6,7)
  [
    [{ x:7,y:8 },{ x:1,y:8 },{ x:1,y:5 },{ x:3,y:5 }],  // bottom-left sweep
    [{ x:8,y:3 },{ x:8,y:8 },{ x:5,y:8 }],               // right column
    [{ x:4,y:3 },{ x:4,y:1 },{ x:8,y:1 },{ x:8,y:3 }],  // top passage
    [{ x:1,y:7 },{ x:5,y:7 },{ x:5,y:5 },{ x:1,y:5 }],  // mid-left loop
  ],
];

export function getPatrolsForRoom(roomIdx) {
  return ROOM_PATROLS[roomIdx] || ROOM_PATROLS[0];
}

export function spawnEscalationGuard(room, difficulty) {
  const cap = ESCALATION_ROOM_CAP[difficulty] || 4;
  const permanentGuards = room.guards.filter(g => !g.isReinforcement);
  if (permanentGuards.length >= cap) return null;

  const spawnPos = firstEdgeTile(room);

  const patrols = getPatrolsForRoom(room.id);
  const patrolIdx = permanentGuards.length % patrols.length;
  const patrol = patrols[patrolIdx];

  const guard = {
    id: `esc_r${room.id}_n${permanentGuards.length}`,
    position: { ...spawnPos },
    patrolPath: patrol,
    patrolIndex: 0,
    investigating: false,
    investigateTurns: 0,
    isReinforcement: false,
    reinforcementTurnsLeft: 0,
  };

  room.guards.push(guard);
  return guard;
}

export function spawnReinforcementGuard(room, targetPos) {
  const spawnPos = firstEdgeTile(room);

  const guard = {
    id: `reinf_r${room.id}_n${room.guards.length}`,
    position: { ...spawnPos },
    patrolPath: [targetPos],
    patrolIndex: 0,
    investigating: false,
    investigateTurns: 0,
    isReinforcement: true,
    reinforcementTurnsLeft: 5,
  };
  room.guards.push(guard);
  return guard;
}
