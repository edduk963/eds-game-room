import { makeRng, rngInt, rngPick } from './seededRng.js';

// Distinct XOR sub-seed constants per independent random draw (same convention as standoffGame.js).
const SEED_STARTS = 0x2ce77aa5;
const SEED_TYPES = 0x71dfc308;

// Board is a solid hexagon-shaped region of hex tiles, sized by radius (3*R*(R+1)+1 tiles).
// Same radius for 2p and 3p — a bigger board for 3 players spread them too far apart for
// meaningful conflict, so territory stays tight regardless of player count.
export const HEX_RADIUS = { 2: 2, 3: 2 }; // 19 tiles either way
export const HEX_SIZE = 60; // center-to-vertex pixel radius of each hex tile
const HEX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

// Generic filler hazards/blessings — small fixed counts, kept sparse so the board reads mostly
// as open ground with the occasional space worth caring about. Edge Post is guaranteed here too
// (not part of the random landmark subset below) — every match always has one.
const FIXED_SPACE_COUNTS = { trap: 1, sanctuary: 1, edgePost: 1 };
// Secret Trap count scales with participant count (3p, or 2p + a computer player, both count
// as 3) — never reduced even on a small map, regardless of count.
const SECRET_TRAP_COUNT = { 2: 2, 3: 3 };

// Unique named landmarks — each map only includes a random subset of these, not all of them, so
// which claim abilities exist is itself part of a given match's variety. (Edge Post is guaranteed
// every match — see FIXED_SPACE_COUNTS — so it's not part of this random subset.)
const UNIQUE_CLAIM_TYPES = ['dungeonGate', 'ironThrone', 'mirror', 'muster', 'ridgepath', 'reckoning'];
const UNIQUE_CLAIM_SELECT_COUNT = 4;

// If a map can't fit every selected type, drop counts in this order first. secretTrap and
// edgePost are never touched (both guaranteed to appear every match).
const DROP_PRIORITY = ['reckoning', 'ridgepath', 'mirror', 'muster', 'ironThrone', 'dungeonGate', 'sanctuary', 'trap'];

// Fisher-Yates shuffle (does not mutate input) — same pattern as standoffGame.js.
function shuffle(arr, rng) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rngInt(rng, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function hexId(q, r) { return `n${q}_${r}`; }

// Flat-top hex layout, axial (q, r) coordinates, filled solid out to `radius` — this shape is
// the board's outer silhouette is itself a hexagon, and every tile within it always has all
// its in-range neighbors present, so the grid is inherently fully connected (no separate
// connectivity-guarantee pass needed, unlike a freeform scattered layout).
function generateHexTiles(radius) {
  const nodes = [];
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r++) {
      const x = Math.round(HEX_SIZE * 1.5 * q);
      const y = Math.round(HEX_SIZE * Math.sqrt(3) * (r + q / 2));
      nodes.push({ id: hexId(q, r), q, r, x, y });
    }
  }
  return nodes;
}

function buildHexAdjacency(nodes) {
  const known = new Set(nodes.map(n => n.id));
  const adj = {};
  for (const n of nodes) {
    adj[n.id] = [];
    for (const [dq, dr] of HEX_DIRS) {
      const nid = hexId(n.q + dq, n.r + dr);
      if (known.has(nid)) adj[n.id].push(nid);
    }
  }
  return adj;
}

function edgesFromAdjacency(adj) {
  const seen = new Set();
  const edges = [];
  for (const [id, neighbors] of Object.entries(adj)) {
    for (const nb of neighbors) {
      const key = id < nb ? `${id}|${nb}` : `${nb}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([id, nb]);
    }
  }
  return edges;
}

function graphDistances(startId, adj) {
  const dist = { [startId]: 0 };
  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adj[cur]) {
      if (!(next in dist)) { dist[next] = dist[cur] + 1; queue.push(next); }
    }
  }
  return dist;
}

// Farthest-point placement: spreads 2-3 start slots apart without solving true max-min optimally.
function pickStartSlots(nodes, adj, playerCount, rng) {
  const ids = nodes.map(n => n.id);
  const starts = [rngPick(rng, ids)];
  while (starts.length < playerCount) {
    const allDist = starts.map(s => graphDistances(s, adj));
    let best = null;
    for (const id of ids) {
      if (starts.includes(id)) continue;
      const minDist = Math.min(...allDist.map(d => d[id] ?? Infinity));
      if (!best || minDist > best.minDist) best = { id, minDist };
    }
    starts.push(best.id);
  }
  return starts;
}

// reckoningMode: 'random' (default) leaves Reckoning in the normal random-subset pool like every
// other landmark; 'on' guarantees it every match (pulled out of the pool, like Edge Post); 'off'
// removes it from the pool entirely so it can never be generated.
function assignSpaceTypes(nodes, startIds, playerCount, rng, reckoningMode) {
  const nonStart = shuffle(nodes.filter(n => !startIds.includes(n.id)).map(n => n.id), rng);
  const budget = nonStart.length;

  const randomPool = reckoningMode === 'random' ? UNIQUE_CLAIM_TYPES : UNIQUE_CLAIM_TYPES.filter(t => t !== 'reckoning');
  const selectedUniques = shuffle(randomPool, rng).slice(0, UNIQUE_CLAIM_SELECT_COUNT);
  const counts = { ...FIXED_SPACE_COUNTS, secretTrap: SECRET_TRAP_COUNT[playerCount] ?? SECRET_TRAP_COUNT[2] };
  for (const type of selectedUniques) counts[type] = 1;
  if (reckoningMode === 'on') counts.reckoning = 1;

  let total = Object.values(counts).reduce((a, b) => a + b, 0);
  let dropIdx = 0;
  while (total > budget && dropIdx < DROP_PRIORITY.length) {
    const type = DROP_PRIORITY[dropIdx];
    if (counts[type] > 0) { counts[type]--; total--; }
    else dropIdx++;
  }

  const types = {};
  let cursor = 0;
  for (const [type, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) types[nonStart[cursor++]] = type;
  }
  for (const id of nonStart.slice(cursor)) types[id] = 'safe';
  for (const id of startIds) types[id] = 'start';

  return types;
}

// Generate a full map (including real Secret Trap tags) from a shared match seed.
// Deterministic — the server is the only caller that should ever see the un-redacted result.
// reckoningMode: 'random' (default) | 'on' | 'off' — see assignSpaceTypes.
export function generateMap(seed, playerCount, reckoningMode = 'random') {
  const radius = HEX_RADIUS[playerCount] ?? HEX_RADIUS[2];
  const rawNodes = generateHexTiles(radius);
  const adjacency = buildHexAdjacency(rawNodes);
  const edges = edgesFromAdjacency(adjacency);

  const startsRng = makeRng(seed ^ SEED_STARTS);
  const startSlots = pickStartSlots(rawNodes, adjacency, playerCount, startsRng);

  const typesRng = makeRng(seed ^ SEED_TYPES);
  const mode = ['on', 'off', 'random'].includes(reckoningMode) ? reckoningMode : 'random';
  const typeById = assignSpaceTypes(rawNodes, startSlots, playerCount, typesRng, mode);

  const nodes = rawNodes.map(n => ({ id: n.id, x: n.x, y: n.y, type: typeById[n.id] }));
  const claimSpaceIds = nodes.filter(n => n.type !== 'start' && n.type !== 'safe').map(n => n.id);
  const secretTrapNodeIds = nodes.filter(n => n.type === 'secretTrap').map(n => n.id);

  return { nodes, edges, adjacency, startSlots, claimSpaceIds, secretTrapNodeIds };
}

// Public view broadcast to clients: both Trap and Secret Trap nodes look identical to Safe
// nodes to everyone — neither is ever labeled, iconed, or tooltipped on the map. Secret Trap
// stays hidden even from its own holder's map view (only a private status push reveals it —
// see conquestGame.js); Trap's trigger is instead announced publicly through the forfeit log
// when it fires (via the server's `trapHitRoles`/`trapShielded` fields), never as a map label.
export function redactHiddenSpaces(map) {
  const { secretTrapNodeIds, ...publicMap } = map;
  return {
    ...publicMap,
    nodes: map.nodes.map(n => (n.type === 'secretTrap' || n.type === 'trap' ? { ...n, type: 'safe' } : n)),
  };
}

// Starting ownership: each start slot belongs to the matching player role (by array order), everything else neutral.
export function initialOwnership(map, playerRoles) {
  const ownership = {};
  for (const node of map.nodes) ownership[node.id] = 'neutral';
  map.startSlots.forEach((nodeId, i) => {
    if (playerRoles[i]) ownership[nodeId] = playerRoles[i];
  });
  return ownership;
}

// First node id of a given type on the map (Vault, Muster, Ridgepath, etc. only ever appear once).
export function findNodeIdByType(map, type) {
  const node = map.nodes.find(n => n.type === type);
  return node ? node.id : null;
}

// Legal attack targets for a role this round: neutral/enemy nodes adjacent to a node they own.
// Used by both the server (authoritative validation) and the client (UI highlighting).
export function getFrontier(map, ownership, role) {
  const owned = map.nodes.filter(n => ownership[n.id] === role).map(n => n.id);
  const frontier = new Set();
  for (const id of owned) {
    for (const neighbor of map.adjacency[id] || []) {
      if (ownership[neighbor] !== role) frontier.add(neighbor);
    }
  }
  return [...frontier];
}
