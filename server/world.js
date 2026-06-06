import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, 'world-config.json');
const STATE_PATH  = join(__dirname, 'world-state.json');

let _config = null;

export function loadConfig() {
  if (!_config) _config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  return _config;
}

export function loadState() {
  if (existsSync(STATE_PATH)) return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  return initState(loadConfig());
}

export function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function initState(cfg) {
  return {
    turn: 0,
    sessionNumber: 1,
    sessionTurns: 0,
    currentTurn: 'p1',
    players: {
      p1: { name: cfg.players.p1, pos: 'west_gate',  owns: [], usedClaims: [], skipTokens: 0 },
      p2: { name: cfg.players.p2, pos: 'east_gate',  owns: [], usedClaims: [], skipTokens: 0 },
    },
    pendingDuel: null,
    dominationLeader: null,
    dominationSessions: 0,
    winner: null,
    winReason: null,
    log: [],
  };
}

function addLog(state, msg) {
  const date = new Date().toISOString().slice(0, 10);
  state.log.unshift({ session: state.sessionNumber, turn: state.turn, msg, date });
  if (state.log.length > 150) state.log = state.log.slice(0, 150);
}

function advanceTurn(state, config) {
  state.currentTurn = state.currentTurn === 'p1' ? 'p2' : 'p1';
  state.turn++;
  state.sessionTurns++;
  if (state.sessionTurns >= config.turnsPerSession) endSession(state, config);
}

function endSession(state, config) {
  state.sessionNumber++;
  state.sessionTurns = 0;
  state.players.p1.usedClaims = [];
  state.players.p2.usedClaims = [];

  const claimSpaces = config.spaces.filter(s => s.type === 'claim').map(s => s.id);
  const total = claimSpaces.length;
  const threshold = Math.ceil(total * config.winConditions.domination.threshold);
  const p1count = state.players.p1.owns.filter(id => claimSpaces.includes(id)).length;
  const p2count = state.players.p2.owns.filter(id => claimSpaces.includes(id)).length;

  let leader = null;
  if (p1count >= threshold) leader = 'p1';
  else if (p2count >= threshold) leader = 'p2';

  if (leader && leader === state.dominationLeader) {
    state.dominationSessions++;
  } else {
    state.dominationLeader = leader;
    state.dominationSessions = leader ? 1 : 0;
  }

  addLog(state, `Session ${state.sessionNumber - 1} ends — ${state.players.p1.name} owns ${p1count}, ${state.players.p2.name} owns ${p2count} of ${total} claim spaces`);

  if (state.dominationSessions >= config.winConditions.domination.consecutiveSessions) {
    state.winner = state.dominationLeader;
    state.winReason = 'domination';
    addLog(state, `${state.players[state.dominationLeader].name} wins by domination!`);
  }
}

function checkRaceWin(playerKey, spaceId, state, config) {
  const target = playerKey === 'p1'
    ? config.winConditions.race.p1Target
    : config.winConditions.race.p2Target;
  if (spaceId === target && !state.winner) {
    state.winner = playerKey;
    state.winReason = 'race';
    const space = config.spaces.find(s => s.id === spaceId);
    addLog(state, `${state.players[playerKey].name} reaches ${space.name} — wins the race!`);
  }
}

export function applyMove(playerKey, spaceId) {
  const config = loadConfig();
  const state  = loadState();

  if (state.winner)                    return { error: 'game_over' };
  if (state.currentTurn !== playerKey) return { error: 'not_your_turn' };
  if (state.pendingDuel)               return { error: 'duel_pending' };

  const neighbors = config.adjacency[state.players[playerKey].pos] || [];
  if (!neighbors.includes(spaceId))    return { error: 'invalid_move' };

  const space  = config.spaces.find(s => s.id === spaceId);
  if (!space)                          return { error: 'unknown_space' };

  const oppKey = playerKey === 'p1' ? 'p2' : 'p1';
  state.players[playerKey].pos = spaceId;

  const events = [];

  if (space.type === 'trap') {
    events.push({ type: 'trap', forfeit: space.forfeit, player: playerKey });
    addLog(state, `${state.players[playerKey].name} lands on ${space.name} — suffers ${space.forfeit.label}`);
    advanceTurn(state, config);

  } else if (space.type === 'toll') {
    events.push({ type: 'toll', forfeit: space.forfeit, player: playerKey });
    addLog(state, `${state.players[playerKey].name} crosses ${space.name} — pays ${space.forfeit.label}`);
    advanceTurn(state, config);

  } else if (space.type === 'sanctuary') {
    state.players[playerKey].skipTokens++;
    events.push({ type: 'sanctuary', player: playerKey });
    addLog(state, `${state.players[playerKey].name} rests at ${space.name} — gains skip token (${state.players[playerKey].skipTokens} total)`);
    advanceTurn(state, config);

  } else if (space.type === 'safe' || space.type === 'start') {
    addLog(state, `${state.players[playerKey].name} moves to ${space.name}`);
    checkRaceWin(playerKey, spaceId, state, config);
    advanceTurn(state, config);

  } else if (space.type === 'duel') {
    // Duel spaces always require a duel (even if neutral — to claim them)
    const needToWin = space.fortified ? 2 : 1;
    state.pendingDuel = {
      spaceId, attacker: playerKey, defender: oppKey,
      attackerPick: null, defenderPick: null,
      needToWin, attackerWins: 0, defenderWins: 0,
      contestClaim: false,
    };
    events.push({ type: 'duel_start', spaceId });
    addLog(state, `${state.players[playerKey].name} challenges for ${space.name} — duel initiated (pick 1–5)`);

  } else if (space.type === 'claim') {
    if (state.players[oppKey].owns.includes(spaceId)) {
      // Contest opponent's space
      const needToWin = space.fortified ? 2 : 1;
      state.pendingDuel = {
        spaceId, attacker: playerKey, defender: oppKey,
        attackerPick: null, defenderPick: null,
        needToWin, attackerWins: 0, defenderWins: 0,
        contestClaim: true,
      };
      events.push({ type: 'duel_start', spaceId });
      addLog(state, `${state.players[playerKey].name} contests ${state.players[oppKey].name}'s ${space.name} — duel!`);

    } else if (!state.players[playerKey].owns.includes(spaceId)) {
      // Neutral — auto-claim
      state.players[playerKey].owns.push(spaceId);
      events.push({ type: 'claimed', spaceId, player: playerKey });
      addLog(state, `${state.players[playerKey].name} claims ${space.name} — ${space.ability?.label ?? ''}`);
      checkRaceWin(playerKey, spaceId, state, config);
      advanceTurn(state, config);

    } else {
      // Already own it
      addLog(state, `${state.players[playerKey].name} returns to ${space.name}`);
      advanceTurn(state, config);
    }
  }

  saveState(state);
  return { events, state };
}

export function applyDuelPick(playerKey, pick) {
  const config = loadConfig();
  const state  = loadState();

  if (!state.pendingDuel) return { error: 'no_duel' };

  const duel = state.pendingDuel;
  const isAttacker = duel.attacker === playerKey;
  const isDefender = duel.defender === playerKey;
  if (!isAttacker && !isDefender) return { error: 'not_in_duel' };
  if (isAttacker && duel.attackerPick !== null) return { error: 'already_picked' };
  if (isDefender && duel.defenderPick !== null) return { error: 'already_picked' };

  if (isAttacker) duel.attackerPick = pick;
  else duel.defenderPick = pick;

  if (duel.attackerPick !== null && duel.defenderPick !== null) {
    const space       = config.spaces.find(s => s.id === duel.spaceId);
    const atkName     = state.players[duel.attacker].name;
    const defName     = state.players[duel.defender].name;

    addLog(state, `Duel at ${space.name}: ${atkName} plays ${duel.attackerPick}, ${defName} plays ${duel.defenderPick}`);

    if (duel.attackerPick === duel.defenderPick) {
      // Tie — re-pick
      duel.attackerPick = null;
      duel.defenderPick = null;
      addLog(state, `Tie at ${space.name} — pick again`);
    } else {
      const atkWon = duel.attackerPick > duel.defenderPick;
      if (atkWon) duel.attackerWins++; else duel.defenderWins++;

      if (duel.attackerWins >= duel.needToWin || duel.defenderWins >= duel.needToWin) {
        const winner = duel.attackerWins >= duel.needToWin ? duel.attacker : duel.defender;
        const loser  = winner === duel.attacker ? duel.defender : duel.attacker;

        if (winner === duel.attacker) {
          // Attacker wins: claim the space
          state.players[duel.defender].owns = state.players[duel.defender].owns.filter(id => id !== duel.spaceId);
          if (!state.players[winner].owns.includes(duel.spaceId)) {
            state.players[winner].owns.push(duel.spaceId);
          }
          addLog(state, `${state.players[winner].name} wins the duel and claims ${space.name}!`);
          checkRaceWin(winner, duel.spaceId, state, config);
        } else {
          // Defender wins: attacker is repelled (loses ownership if they somehow held it)
          state.players[duel.attacker].owns = state.players[duel.attacker].owns.filter(id => id !== duel.spaceId);
          addLog(state, `${state.players[winner].name} holds ${space.name} — ${state.players[loser].name} repelled`);
        }

        state.pendingDuel = null;
        advanceTurn(state, config);
      } else {
        // More rounds needed
        duel.attackerPick = null;
        duel.defenderPick = null;
        addLog(state, `${atkName} ${duel.attackerWins} — ${duel.defenderWins} ${defName} — pick again`);
      }
    }
  }

  saveState(state);
  return { state };
}

export function applyClaimUse(playerKey, spaceId) {
  const config = loadConfig();
  const state  = loadState();

  const player = state.players[playerKey];
  if (!player.owns.includes(spaceId))       return { error: 'not_owned' };
  if (player.usedClaims.includes(spaceId))  return { error: 'already_used' };

  const space = config.spaces.find(s => s.id === spaceId);
  if (!space?.ability)                      return { error: 'no_ability' };

  // Sanctuary is auto-used on landing, not manually invoked
  if (space.ability.type === 'sanctuary')   return { error: 'no_ability' };

  player.usedClaims.push(spaceId);
  const oppName = state.players[playerKey === 'p1' ? 'p2' : 'p1'].name;
  addLog(state, `${player.name} invokes ${space.ability.label} from ${space.name} against ${oppName}: "${space.ability.desc}"`);

  saveState(state);
  return { state, ability: space.ability };
}

export function applySkipToken(playerKey, targetDesc) {
  const config = loadConfig();
  const state  = loadState();

  const player = state.players[playerKey];
  if (player.skipTokens <= 0) return { error: 'no_tokens' };

  player.skipTokens--;
  addLog(state, `${player.name} uses a skip token to cancel: "${targetDesc}" (${player.skipTokens} remaining)`);

  saveState(state);
  return { state };
}

export function resetGame() {
  _config = null; // force config reload in case it changed
  const config = loadConfig();
  const state  = initState(config);
  saveState(state);
  return { state };
}

export function getWorld() {
  return { config: loadConfig(), state: loadState() };
}
