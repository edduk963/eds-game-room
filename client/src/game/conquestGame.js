import { rngInt } from './seededRng.js';
import { findNodeIdByType } from './conquestMap.js';

export const DEFAULT_BASE_DICE = 8;
export const DEFAULT_ROUND_CAP = 10;
export const DOMINATION_THRESHOLD = 0.6;
export const DOMINATION_STREAK_NEEDED = 3;

function findNodeType(map, nodeId) {
  const node = map.nodes.find(n => n.id === nodeId);
  return node ? node.type : null;
}

function nullableRole(role) {
  return role && role !== 'neutral' ? role : null;
}

// ── Server-authoritative: dice rolling & round resolution ──────────────────
// These are only ever called server-side. Clients receive and animate the result,
// they never independently recompute it (unlike Standoff's dual-client-computes-everything pattern) —
// ownership and dice-pool size are genuinely stateful here and must not desync across up to 3 clients.

// allocationsByRole: { host: {nodeId: diceCount}, guest: {...}, guest2: {...} }
// Returns: { [role]: { [nodeId]: { faces: [n,...], total } } }
export function rollAllocation(allocationsByRole, rng) {
  const rolls = {};
  for (const [role, alloc] of Object.entries(allocationsByRole)) {
    rolls[role] = {};
    for (const [nodeId, count] of Object.entries(alloc || {})) {
      if (!count) continue;
      const faces = [];
      for (let i = 0; i < count; i++) faces.push(rngInt(rng, 1, 6));
      rolls[role][nodeId] = { faces, total: faces.reduce((a, b) => a + b, 0) };
    }
  }
  return rolls;
}

// Resolves every node touched (by dice from at least one role) this round.
// Ties favor the current holder (attacker fails); neutral-space ties stay neutral;
// an owned space with 0 committed dice defaults to 0 — any attacker with >0 dice takes it outright.
export function resolveRound(map, ownership, rollsByRole, roundIndex) {
  const roles = Object.keys(rollsByRole);
  const touchedNodes = new Set();
  for (const role of roles) {
    for (const nodeId of Object.keys(rollsByRole[role] || {})) touchedNodes.add(nodeId);
  }

  const newOwnership = { ...ownership };
  const contested = [];

  for (const nodeId of touchedNodes) {
    const totals = {};
    for (const role of roles) totals[role] = rollsByRole[role]?.[nodeId]?.total ?? 0;

    const currentOwner = ownership[nodeId] ?? 'neutral';
    const maxTotal = Math.max(...Object.values(totals));
    const leaders = roles.filter(r => totals[r] === maxTotal);

    let winnerRole;
    if (leaders.length > 1) {
      // Tie for the top total: current holder keeps it if they're one of the tied leaders,
      // otherwise no single attacker won it outright — it stays/becomes neutral.
      winnerRole = leaders.includes(currentOwner) ? currentOwner : 'neutral';
    } else {
      const soleLeader = leaders[0];
      winnerRole = soleLeader === currentOwner ? currentOwner : soleLeader;
    }

    newOwnership[nodeId] = winnerRole;
    contested.push({ nodeId, totals, winnerRole, previousOwner: currentOwner, roundIndex });
  }

  return { newOwnership, contested };
}

// Momentary (Trap/Sanctuary, only for nodes actually contested this round) and continuous
// (Edge Post/Mirror/Muster/Secret Trap, evaluated off current ownership regardless of contest) effects.
export function applyPassiveEffects(map, prevOwnership, newOwnership, contested, secretTrapNodeIds) {
  const trapHits = [];
  const sanctuaryGrants = [];

  for (const entry of contested) {
    if (entry.winnerRole === 'neutral') continue;
    const type = findNodeType(map, entry.nodeId);
    if (type === 'trap') trapHits.push(entry.winnerRole);
    if (type === 'sanctuary') sanctuaryGrants.push(entry.winnerRole);
  }

  const edgePostNodeId = findNodeIdByType(map, 'edgePost');
  const mirrorNodeId = findNodeIdByType(map, 'mirror');
  const musterNodeId = findNodeIdByType(map, 'muster');

  const secretTrapTransfers = [];
  for (const nodeId of secretTrapNodeIds || []) {
    const from = prevOwnership[nodeId] ?? 'neutral';
    const to = newOwnership[nodeId] ?? 'neutral';
    if (from !== to) secretTrapTransfers.push({ nodeId, fromRole: from, toRole: to });
  }

  return {
    trapHits,
    sanctuaryGrants,
    edgePostNodeId,
    mirrorNodeId,
    musterNodeId,
    edgePostHolder: edgePostNodeId ? nullableRole(newOwnership[edgePostNodeId]) : null,
    mirrorHolder: mirrorNodeId ? nullableRole(newOwnership[mirrorNodeId]) : null,
    musterHolder: musterNodeId ? nullableRole(newOwnership[musterNodeId]) : null,
    secretTrapTransfers,
  };
}

// Base dice pool for a role this round, +2 while they hold The Muster.
export function computeDicePool(baseSize, role, ownership, musterNodeId) {
  const bonus = musterNodeId && ownership[musterNodeId] === role ? 2 : 0;
  return baseSize + bonus;
}

// Domination win-check: control >= 60% of claim spaces (every node except Start/Safe),
// sustained for 3 consecutive rounds.
export function checkDomination(ownership, claimSpaceIds, playerRoles, streakHolder, streak) {
  const total = claimSpaceIds.length;
  if (total === 0) return { streakHolder: null, streak: 0, dominationWinner: null };

  let leader = null;
  for (const role of playerRoles) {
    const count = claimSpaceIds.filter(id => ownership[id] === role).length;
    if (count / total >= DOMINATION_THRESHOLD) { leader = role; break; }
  }

  let newStreak, newHolder;
  if (leader && leader === streakHolder) { newStreak = streak + 1; newHolder = leader; }
  else if (leader) { newStreak = 1; newHolder = leader; }
  else { newStreak = 0; newHolder = null; }

  const dominationWinner = newStreak >= DOMINATION_STREAK_NEEDED ? newHolder : null;
  return { streakHolder: newHolder, streak: newStreak, dominationWinner };
}

// Fallback so a match always ends: at/after the round cap, whoever controls the most claim
// spaces wins. If still tied, `tied: true` — caller should keep playing sudden-death rounds
// with a doubled dice pool (via computeDicePool's baseSize) until it breaks.
export function checkRoundCap(roundIndex, cap, ownership, claimSpaceIds, playerRoles) {
  if (roundIndex < cap) return { reached: false, winner: null, tied: false };

  const counts = {};
  for (const role of playerRoles) counts[role] = claimSpaceIds.filter(id => ownership[id] === role).length;
  const maxCount = Math.max(...Object.values(counts));
  const leaders = playerRoles.filter(r => counts[r] === maxCount);

  if (leaders.length === 1) return { reached: true, winner: leaders[0], tied: false };
  return { reached: true, winner: null, tied: true };
}

// Ridgepath / The Reckoning: evaluated once, at match end. "Every non-controller" per the 3-player rule.
export function resolveMatchEndPassives(map, ownership, playerRoles) {
  const ridgepathNodeId = findNodeIdByType(map, 'ridgepath');
  const reckoningNodeId = findNodeIdByType(map, 'reckoning');

  function buildEntry(nodeId) {
    if (!nodeId) return null;
    const controllerRole = nullableRole(ownership[nodeId]);
    return { nodeId, controllerRole, oweRoles: playerRoles.filter(r => r !== controllerRole) };
  }

  return { ridgepath: buildEntry(ridgepathNodeId), reckoning: buildEntry(reckoningNodeId) };
}

// ── Client-only: presentation helpers, never authoritative ─────────────────

const TYPE_LABELS = {
  safe: 'a quiet space', start: 'a start space', trap: 'a Trap', sanctuary: 'a Sanctuary',
  dungeonGate: 'Dungeon Gate', ironThrone: 'Iron Throne', edgePost: 'Edge Post',
  mirror: 'The Mirror', muster: 'The Muster', secretTrap: 'a quiet space',
  ridgepath: 'Ridgepath', reckoning: 'The Reckoning',
};

export function describeSpaceOutcome(map, contestedEntry, myRole) {
  const node = map.nodes.find(n => n.id === contestedEntry.nodeId);
  const label = TYPE_LABELS[node?.type] || contestedEntry.nodeId;
  if (contestedEntry.winnerRole === 'neutral') return `${label} — contested, stays neutral`;
  if (contestedEntry.winnerRole === myRole) {
    return contestedEntry.previousOwner === myRole ? `${label} — held` : `${label} — captured!`;
  }
  return contestedEntry.previousOwner === myRole ? `${label} — lost!` : `${label} — enemy holds`;
}
