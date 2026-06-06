import { makeRng, rngInt, rngPick } from './seededRng.js';
import { getPatrolsForRoom } from './splitLootGuard.js';

// Cell types
export const CELL = {
  FLOOR: 0,
  WALL: 1,
  ENTRY: 2,
  EXIT: 3,
};

// Fixed structural wall layouts per room (10x10, 1=wall)
const ROOM_WALLS = [
  // Room 1 — two cover clusters + central chokepoint
  [
    [1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,0,0,1],
    [1,0,1,1,0,0,1,1,0,1],
    [1,0,1,0,0,0,0,1,0,1],
    [1,0,0,0,1,1,0,0,0,1],
    [1,0,0,0,1,1,0,0,0,1],
    [1,0,1,0,0,0,0,1,0,1],
    [1,0,1,1,0,0,1,1,0,1],
    [1,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1],
  ],
  // Room 2 — corridor maze with dead ends
  [
    [1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,1,0,0,0,0,1],
    [1,0,1,0,1,0,1,1,0,1],
    [1,0,1,0,0,0,1,0,0,1],
    [1,0,1,1,1,0,1,0,0,1],
    [1,0,0,0,0,0,0,0,0,1],
    [1,1,1,0,1,1,0,1,0,1],
    [1,0,0,0,1,0,0,1,0,1],
    [1,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1],
  ],
  // Room 3 — tight corridors, multiple choke points
  [
    [1,1,1,1,1,1,1,1,1,1],
    [1,0,0,1,0,0,0,0,0,1],
    [1,0,0,1,0,1,1,0,0,1],
    [1,0,0,0,0,1,0,0,0,1],
    [1,1,1,0,0,1,0,1,1,1],
    [1,0,0,0,1,0,0,0,0,1],
    [1,0,1,1,1,0,1,1,0,1],
    [1,0,1,0,0,0,1,0,0,1],
    [1,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1],
  ],
];

const ROOM_ENTRY = [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }];
const ROOM_EXIT  = [{ x: 8, y: 8 }, { x: 8, y: 8 }, { x: 8, y: 8 }];

const INITIAL_GUARDS = {
  easy:   [1, 1, 1],
  normal: [1, 2, 2],
  hard:   [2, 2, 3],
};

const LOOT_TEMPLATES = [
  [{ v:1 },{ v:1 },{ v:1 },{ v:2 }],
  [{ v:1 },{ v:1 },{ v:2 },{ v:3 }],
  [{ v:2 },{ v:3 },{ v:3 }],
];

const CORRIDOR_LOOT = [{ v:1 }, { v:2 }];

function buildGrid(roomIdx) {
  return ROOM_WALLS[roomIdx].map(row => [...row]);
}

function floorTiles(grid, exclude = []) {
  const tiles = [];
  for (let y = 1; y < 9; y++) {
    for (let x = 1; x < 9; x++) {
      if (grid[y][x] === CELL.FLOOR) {
        const excl = exclude.some(e => e.x === x && e.y === y);
        if (!excl) tiles.push({ x, y });
      }
    }
  }
  return tiles;
}

function pick(rng, tiles, exclude = []) {
  const avail = tiles.filter(t => !exclude.some(e => e.x === t.x && e.y === t.y));
  if (!avail.length) return null;
  return avail[rngInt(rng, 0, avail.length - 1)];
}

function adjacent(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1;
}

function placePads(rng, grid, difficulty, reserved) {
  const count = { easy: 2, normal: 3, hard: 4 }[difficulty];
  const tiles = floorTiles(grid, reserved);
  const pads = [];
  let attempts = 0;
  while (pads.length < count && attempts < 200) {
    attempts++;
    const t = pick(rng, tiles, [...reserved, ...pads]);
    if (!t) break;
    const tooClose = pads.some(p => adjacent(p, t));
    if (!tooClose) pads.push({ ...t, type: rng() < 0.5 ? 'distraction' : 'reinforcement' });
  }
  return pads;
}

// Pick the patrol waypoint farthest from spawn tiles so guards don't start next to players
function safeStartIndex(patrol, avoidTiles, minDist = 3) {
  for (let i = 0; i < patrol.length; i++) {
    const p = patrol[i];
    if (avoidTiles.every(a => Math.abs(p.x - a.x) + Math.abs(p.y - a.y) >= minDist)) return i;
  }
  // Fallback: index with maximum total distance from all avoid tiles
  let bestIdx = 0, bestDist = 0;
  for (let i = 0; i < patrol.length; i++) {
    const d = avoidTiles.reduce((s, a) => s + Math.abs(patrol[i].x - a.x) + Math.abs(patrol[i].y - a.y), 0);
    if (d > bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx;
}

function buildRoom(rng, roomIdx, difficulty) {
  const grid = buildGrid(roomIdx);
  const entry = { ...ROOM_ENTRY[roomIdx] };
  const exit  = { ...ROOM_EXIT[roomIdx] };

  grid[entry.y][entry.x] = CELL.ENTRY;
  grid[exit.y][exit.x]   = CELL.EXIT;

  const reserved = [entry, exit];

  // Place loot
  const loot = [];
  for (const t of LOOT_TEMPLATES[roomIdx]) {
    const pos = pick(rng, floorTiles(grid, [...reserved, ...loot]));
    if (pos) { loot.push({ ...pos, value: t.v }); reserved.push(pos); }
  }

  // Place cards (2 per room)
  const cards = [];
  for (let i = 0; i < 2; i++) {
    const pos = pick(rng, floorTiles(grid, [...reserved, ...cards]));
    if (pos) { cards.push({ ...pos }); reserved.push(pos); }
  }

  // Place remote token (1 per room)
  const remotePos = pick(rng, floorTiles(grid, [...reserved]));
  const remotes = remotePos ? [{ ...remotePos }] : [];
  if (remotePos) reserved.push(remotePos);

  // Place hidden pads
  const pads = placePads(rng, grid, difficulty, reserved);

  // Player spawn tiles — guards must start away from these
  const spawnTiles = [entry, { x: 2, y: 1 }, { x: 1, y: 2 }];

  // Place guards — start each at a patrol point far from player spawns
  const guardsNeeded = INITIAL_GUARDS[difficulty][roomIdx];
  const patrols = getPatrolsForRoom(roomIdx);
  const guards = [];
  for (let i = 0; i < guardsNeeded; i++) {
    const patrol = patrols[i % patrols.length];
    const startIdx = safeStartIndex(patrol, spawnTiles);
    guards.push({
      id: `r${roomIdx}g${i}`,
      position: { ...patrol[startIdx] },
      patrolPath: patrol,
      patrolIndex: startIdx,
      investigating: false,
      investigateTurns: 0,
      isReinforcement: false,
      reinforcementTurnsLeft: 0,
    });
  }

  return { id: roomIdx, grid, entry, exit, loot, cards, remotes, pads, guards, triggeredPads: [] };
}

function buildCorridor(rng, corridorIdx) {
  const tiles = [0, 1, 2, 3, 4].map(i => ({ x: i, y: 0 }));
  const lootToken = CORRIDOR_LOOT[corridorIdx];
  const lootPos = tiles[2];
  const padPos = rng() < 0.4 ? tiles[rngInt(rng, 0, 4)] : null;
  const pads = padPos && padPos.x !== lootPos.x
    ? [{ ...padPos, type: 'distraction' }]
    : [];
  return {
    id: `c${corridorIdx}`,
    tiles,
    loot: [{ ...lootPos, value: lootToken.v }],
    pads,
    cards: [],
  };
}

export function generateGame(seed, difficulty, enabledForfeitCards) {
  const rng = makeRng(seed);

  const rooms = [0, 1, 2].map(i => buildRoom(rng, i, difficulty));
  const corridors = [0, 1].map(i => buildCorridor(rng, i));

  return { rooms, corridors };
}
