import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import {
  createSession,
  getSession,
  attachSocket,
  detachSocket,
  lobbySnapshot,
  broadcast,
  purgeStaleSessions,
} from './sessions.js';
import {
  generateMap as cqGenerateMap,
  redactHiddenSpaces as cqRedactHiddenSpaces,
  initialOwnership as cqInitialOwnership,
  getFrontier as cqGetFrontier,
  findNodeIdByType as cqFindNodeIdByType,
} from '../client/src/game/conquestMap.js';
import {
  rollAllocation as cqRollAllocation,
  resolveRound as cqResolveRound,
  applyPassiveEffects as cqApplyPassiveEffects,
  computeDicePool as cqComputeDicePool,
  checkDomination as cqCheckDomination,
  checkRoundCap as cqCheckRoundCap,
  resolveMatchEndPassives as cqResolveMatchEndPassives,
  DEFAULT_BASE_DICE as CQ_DEFAULT_BASE_DICE,
  DEFAULT_ROUND_CAP as CQ_DEFAULT_ROUND_CAP,
} from '../client/src/game/conquestGame.js';
import { makeRng as cqMakeRng } from '../client/src/game/seededRng.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const CQ_SEED_ROLL = 0x0d5f88c9;

const app = express();
app.use(express.json());

app.post('/session', (req, res) => {
  const name = (req.body?.name || '').toString().trim().slice(0, 24) || 'Player 1';
  const id = createSession(name);
  res.json({ sessionId: id });
});

app.get('/session/:id', (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });
  res.json({
    id: s.id,
    host: s.host ? { name: s.host.name } : null,
    guest: s.guest ? { name: s.guest.name } : null,
    guest2: s.guest2 ? { name: s.guest2.name } : null,
    status: s.status,
  });
});

const distDir = path.join(__dirname, '..', 'dist');
app.use(express.static(distDir));
app.get(/^\/(?!session|ws).*/, (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) res.status(404).end();
  });
});

const VALID_SPELL_IDS = new Set(['gust','bolt','mirror','confiscate','mend','rust','veil','fog','smite','recall','leap','shield','doubleedge','summon','ironskin','curse','drain','hex','blink','overload']);
const VALID_VIBE_MODES = new Set(['random','low','medium','high','ultra','wave','pulse','tease','ramp','tempo']);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  let sessionId = null;
  let role = null;

  const pingInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
  }, 10_000);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'join') {
      const s = getSession(msg.sessionId);
      if (!s) {
        ws.send(JSON.stringify({ type: 'error', code: 'no_session' }));
        ws.close();
        return;
      }
      sessionId = s.id;
      const name = (msg.name || '').toString().trim().slice(0, 24) || 'Player';

      let filledVacantSlot = false;
      if (s.host.socket === ws) {
        role = 'host';
      } else if (s.guest?.socket === ws) {
        role = 'guest';
      } else if (s.guest2?.socket === ws) {
        role = 'guest2';
      } else if (!s.host.socket) {
        role = 'host';
        attachSocket(s.id, 'host', ws, name);
        filledVacantSlot = true;
      } else if (!s.guest) {
        role = 'guest';
        attachSocket(s.id, 'guest', ws, name);
        filledVacantSlot = true;
      } else if (!s.guest2) {
        role = 'guest2';
        attachSocket(s.id, 'guest2', ws, name);
        filledVacantSlot = true;
      } else {
        ws.send(JSON.stringify({ type: 'error', code: 'session_full' }));
        ws.close();
        return;
      }
      ws.send(JSON.stringify({ type: 'joined', role, sessionId: s.id }));
      if (s._reconnectTimers?.[role]) {
        clearTimeout(s._reconnectTimers[role]);
        delete s._reconnectTimers[role];
      }
      // Announce the reconnect even if the 5s grace window (and thus peer_left) already
      // passed — otherwise a late rejoin leaves the other players' "disconnected" banner
      // stuck forever even though messages from this role work again immediately.
      if (filledVacantSlot && s.status === 'playing') {
        broadcast(s, { type: 'peer_reconnected', role }, ws);
      }
      broadcast(s, lobbySnapshot(s));
      return;
    }

    const s = sessionId ? getSession(sessionId) : null;
    if (!s) return;

    const SOLO_CAPABLE = ['beatdealer', 'hilo', 'mastermind', 'lastcall'];
    const snlSolo = msg.gameType === 'snakes' && msg.snlMode === 'solo';
    const memSolo = msg.gameType === 'memory' && msg.memMode === 'solo';
    if (msg.type === 'start' && role === 'host' && (s.guest || SOLO_CAPABLE.includes(msg.gameType) || snlSolo || memSolo)) {
      s.status = 'playing';
      s.seed = randomBytes(4).readUInt32BE(0);
      s.host.finalScore = null;
      if (s.guest) s.guest.finalScore = null;
      if (s.guest2) s.guest2.finalScore = null;
      s.hostEdgeReady = false;
      s.guestEdgeReady = false;
      s.hostInstReady = false;
      s.guestInstReady = false;
      s.guest2InstReady = false;
      s.hostWiRollReady = false;
      s.guestWiRollReady = false;
      s.hostWiBattleReady = false;
      s.guestWiBattleReady = false;
      s.hostWiForfeitAck = false;
      s.guestWiForfeitAck = false;
      s.hostWiDestReady = false; s.guestWiDestReady = false;
      s.hostWiDest = null; s.guestWiDest = null;
      s.hostWiCoopChoice = null; s.guestWiCoopChoice = null;
      s.soHostCommit = null; s.soGuestCommit = null;
      s.soAutoCommitTimer = null; s.soPowerTimer = null;
      s.soPowerPlays = {}; s.soChickenStop = null; s.soChickenTimer = null;
      s.soPrevAlloc = null; s.soSpyWinner = null;
      s.soGhostActive = { host: false, guest: false };
      s.soMirrorThrottle = 0; s.soTokenCounts = { host: 0, guest: 0 };
      s.soRoundStartAt = Date.now(); s.soDraftPicks = [];
      s.soHostReady = false; s.soGuestReady = false;
      s.snlHostRollReady = false; s.snlGuestRollReady = false; s.snlTurnIndex = 0;
      const validGameTypes = ['galactic', 'mastermind', 'endurance', 'tugofwar', 'dice', 'hilo', 'splitloot', 'wizardisland', 'beatdealer', 'standoff', 'lastcall', 'battleships', 'uno', 'snakes', 'memory', 'conquest'];
      const gameType = validGameTypes.includes(msg.gameType) ? msg.gameType : 'galactic';
      const rounds = Number.isInteger(msg.rounds) && msg.rounds >= 1 && msg.rounds <= 5 ? msg.rounds : 3;
      const mode = msg.mode === 'hard' ? 'hard' : 'easy';
      const validDurations = [15, 30, 60, 120, 300, 600];
      const forfeitDuration = validDurations.includes(msg.forfeitDuration) ? msg.forfeitDuration : 30;
      const edgeMode = !!msg.edgeMode;
      const edgeLives = Number.isInteger(msg.edgeLives) && msg.edgeLives >= 1 && msg.edgeLives <= 10 ? msg.edgeLives : 3;
      const validHiloModes = ['submission', 'fixed', 'random'];
      const hiloMode = validHiloModes.includes(msg.hiloMode) ? msg.hiloMode : 'submission';
      const hiloCycles = Number.isInteger(msg.hiloCycles) && msg.hiloCycles >= 0 && msg.hiloCycles <= 6 ? msg.hiloCycles : 1;
      const hiloDeckSize = Number.isInteger(msg.hiloDeckSize) && msg.hiloDeckSize >= 0 && msg.hiloDeckSize <= 6 ? msg.hiloDeckSize : 1;
      const validHiloRamps = [10, 15, 20];
      const hiloVibeRamp = validHiloRamps.includes(msg.hiloVibeRamp) ? msg.hiloVibeRamp : 10;
      const hiloLives = Number.isInteger(msg.hiloLives) && msg.hiloLives >= 1 && msg.hiloLives <= 10 ? msg.hiloLives : 3;
      const validHiloVibeTargets = ['both', 'highest_lives', 'random'];
      const hiloVibeTarget = validHiloVibeTargets.includes(msg.hiloVibeTarget) ? msg.hiloVibeTarget : 'both';
      const cqBotEnabled = gameType === 'conquest' && !!msg.cqBotEnabled && !s.guest2;
      const cqRounds = [5, 10].includes(msg.cqRounds) ? msg.cqRounds : 10;
      const cqReckoning = ['on', 'off', 'random'].includes(msg.cqReckoning) ? msg.cqReckoning : 'random';
      const playerCount = !s.guest ? 1 : (s.guest2 || cqBotEnabled) ? 3 : 2;
      if (gameType === 'conquest') {
        const cqPlayerRoles = playerCount === 3 ? ['host', 'guest', 'guest2'] : ['host', 'guest'];
        s.cqPlayerRoles = cqPlayerRoles;
        s.cqBotRoles = cqBotEnabled ? ['guest2'] : [];
        s.cqMap = cqGenerateMap(s.seed, cqPlayerRoles.length, cqReckoning);
        s.cqPublicMap = cqRedactHiddenSpaces(s.cqMap);
        s.cqOwnership = cqInitialOwnership(s.cqMap, cqPlayerRoles);
        s.cqNodeIds = {
          dungeonGate: cqFindNodeIdByType(s.cqMap, 'dungeonGate'),
          ironThrone: cqFindNodeIdByType(s.cqMap, 'ironThrone'),
          edgePost: cqFindNodeIdByType(s.cqMap, 'edgePost'),
          mirror: cqFindNodeIdByType(s.cqMap, 'mirror'),
          muster: cqFindNodeIdByType(s.cqMap, 'muster'),
          ridgepath: cqFindNodeIdByType(s.cqMap, 'ridgepath'),
          reckoning: cqFindNodeIdByType(s.cqMap, 'reckoning'),
        };
        s.cqRoundIndex = 0;
        s.cqRoundCap = cqRounds;
        s.cqBaseDice = CQ_DEFAULT_BASE_DICE;
        s.cqDicePool = {};
        s.cqCommits = {};
        s.cqReady = {};
        s.cqEdgeAck = {};
        s.cqSkipTokens = {};
        s.cqDungeonGateUsed = {};
        s.cqIronThroneUsed = {};
        s.cqLastForfeit = {};
        for (const r of cqPlayerRoles) {
          s.cqDicePool[r] = cqComputeDicePool(s.cqBaseDice, r, s.cqOwnership, s.cqNodeIds.muster);
          s.cqReady[r] = false;
          s.cqEdgeAck[r] = false;
          s.cqSkipTokens[r] = 0;
          s.cqDungeonGateUsed[r] = false;
          s.cqIronThroneUsed[r] = false;
          s.cqLastForfeit[r] = null;
        }
        s.cqAutoCommitTimer = null;
        s.cqRoundStartAt = Date.now();
        s.cqControlStreakHolder = null;
        s.cqControlStreak = 0;
        s.cqSecretTrapNodeIds = s.cqMap.secretTrapNodeIds;
        s.cqMatchEnded = false;
      }
      const validStlDifficulties = ['easy', 'normal', 'hard'];
      const stlDifficulty = validStlDifficulties.includes(msg.stlDifficulty) ? msg.stlDifficulty : 'normal';
      const soDifficulty = ['beginner', 'experienced'].includes(msg.soDifficulty) ? msg.soDifficulty : 'beginner';
      const stlForfeitCards = Array.isArray(msg.stlForfeitCards) ? msg.stlForfeitCards.filter(c => typeof c === 'string').map(c => c.slice(0, 32)).slice(0, 10) : [];
      const btdForfeits = Array.isArray(msg.btdForfeits) ? msg.btdForfeits.filter(c => typeof c === 'string').map(c => c.slice(0, 200)).slice(0, 100) : [];
      const btdMode = msg.btdMode === 'reveal' ? 'reveal' : 'draw';
      const btdGameMode = msg.btdGameMode === 'h2h' ? 'h2h' : 'dealer';
      const validWiWin = ['normal', 'endurance', 'timed'];
      const wiWinCondition = validWiWin.includes(msg.wiWinCondition) ? msg.wiWinCondition : 'normal';
      const wiSpellLimit = Number.isInteger(msg.wiSpellLimit) && msg.wiSpellLimit >= 1 && msg.wiSpellLimit <= 20 ? msg.wiSpellLimit : 5;
      const diceVibeRule = ['lowest', 'all_but_winner'].includes(msg.diceVibeRule) ? msg.diceVibeRule : 'lowest';
      const lcTimer = !!msg.lcTimer;
      const lcMinutes = [5, 10, 15, 20, 30].includes(msg.lcMinutes) ? msg.lcMinutes : 10;
      const lcDeckSize = Number.isInteger(msg.lcDeckSize) && msg.lcDeckSize >= 1 && msg.lcDeckSize <= 6 ? msg.lcDeckSize : 2;
      const lcReward = msg.lcReward === 'half' ? 'half' : 'full';
      const bsGridSize = ['standard', 'large'].includes(msg.bsGridSize) ? msg.bsGridSize : 'standard';
      const bsVibeMultiplier = [1, 1.5, 2, 3].includes(Number(msg.bsVibeMultiplier)) ? Number(msg.bsVibeMultiplier) : 1.5;
      const VALID_UNO_PACKS = ['plus10', 'edge', 'skipall', 'swaphands', 'doubledown', 'ctrl2', 'mirror', 'deflect'];
      const unoSpecialPacks = Array.isArray(msg.unoSpecialPacks) ? msg.unoSpecialPacks.filter(p => VALID_UNO_PACKS.includes(p)) : [];
      const snlMode = ['versus', 'solo', 'watched'].includes(msg.snlMode) ? msg.snlMode : 'versus';
      const snlBoardSize = ['short', 'standard', 'long'].includes(msg.snlBoardSize) ? msg.snlBoardSize : 'standard';
      const snlDensity = ['tame', 'even', 'brutal'].includes(msg.snlDensity) ? msg.snlDensity : 'even';
      const snlStakeMix = ['vibe', 'forfeits', 'mixed'].includes(msg.snlStakeMix) ? msg.snlStakeMix : 'mixed';
      const snlVibeScale = ['full', 'half'].includes(msg.snlVibeScale) ? msg.snlVibeScale : 'full';
      const snlWinCondition = ['race', 'endurance'].includes(msg.snlWinCondition) ? msg.snlWinCondition : 'race';
      const snlFinalRule = ['exact', 'pass'].includes(msg.snlFinalRule) ? msg.snlFinalRule : 'exact';
      const snlPowerups = msg.snlPowerups !== false;
      const snlCoopBetray = !!msg.snlCoopBetray;
      const VALID_SNL_FORFEITS = ['vibe', 'edge', 'task', 'surrender'];
      const snlForfeitCards = Array.isArray(msg.snlForfeitCards) ? msg.snlForfeitCards.filter(c => VALID_SNL_FORFEITS.includes(c)) : VALID_SNL_FORFEITS;
      const snlForfeitLines = Array.isArray(msg.snlForfeitLines) ? msg.snlForfeitLines.filter(c => typeof c === 'string').map(c => c.slice(0, 200)).slice(0, 100) : [];
      const snlAmbient = !!msg.snlAmbient;
      const snlTapOut = !!msg.snlTapOut;
      const validMemModes = ['versus', 'solo', 'watched'];
      const memMode = validMemModes.includes(msg.memMode) ? msg.memMode : 'versus';
      const memForfeitLines = Array.isArray(msg.memForfeitLines) ? msg.memForfeitLines.filter(c => typeof c === 'string').map(c => c.slice(0, 200)).slice(0, 60) : [];
      const memVibeDurations = Array.isArray(msg.memVibeDurations) ? msg.memVibeDurations.filter(n => Number.isFinite(n)).map(n => Math.max(1, Math.min(600, Math.round(n)))).slice(0, 30) : [];
      const validMemGridSizes = ['4x4', '5x5', '6x6', '8x8'];
      const memGridSize = validMemGridSizes.includes(msg.memGridSize) ? msg.memGridSize : '6x6';
      s.edgeMode = edgeMode;
      const guest2Name = s.guest2?.name ?? (cqBotEnabled ? 'Computer' : null);
      broadcast(s, { type: 'begin', seed: s.seed, startAt: null, gameType, rounds, mode, forfeitDuration, edgeMode, edgeLives, hiloMode, hiloCycles, hiloDeckSize, hiloVibeRamp, hiloLives, hiloVibeTarget, playerCount, guest2Name, stlDifficulty, stlForfeitCards, soDifficulty, btdForfeits, btdMode, btdGameMode, wiWinCondition, wiSpellLimit, diceVibeRule, lcTimer, lcMinutes, lcDeckSize, lcReward, bsGridSize, bsVibeMultiplier, unoSpecialPacks, snlMode, snlBoardSize, snlDensity, snlStakeMix, snlVibeScale, snlWinCondition, snlFinalRule, snlPowerups, snlCoopBetray, snlForfeitCards, snlForfeitLines, snlAmbient, snlTapOut, memMode, memForfeitLines, memVibeDurations, memGridSize, cqPublicMap: s.cqPublicMap ?? null, cqOwnership: s.cqOwnership ?? null, cqDicePool: s.cqDicePool ?? null, cqRoundCap: s.cqRoundCap ?? CQ_DEFAULT_ROUND_CAP, cqBaseDice: s.cqBaseDice ?? CQ_DEFAULT_BASE_DICE, cqPlayerRoles: s.cqPlayerRoles ?? null, cqBotRoles: s.cqBotRoles ?? [] });
      return;
    }

    if (msg.type === 'mm_guess' && Array.isArray(msg.guess)) {
      broadcast(s, { type: 'mm_guess', guess: msg.guess.map(c => String(c)).slice(0, 7), role }, ws);
      return;
    }

    if (msg.type === 'mm_round_ready') {
      broadcast(s, { type: 'mm_round_ready', role }, ws);
      return;
    }

    if (msg.type === 'mm_powerup') {
      broadcast(s, { type: 'mm_powerup', powerup: String(msg.powerup), slotIndex: msg.slotIndex | 0, color: String(msg.color || ''), role }, ws);
      return;
    }

    if (msg.type === 'mm_vibe_choice') {
      broadcast(s, { type: 'mm_vibe_choice', choice: String(msg.choice), vibeSeconds: msg.vibeSeconds | 0 }, ws);
      return;
    }

    if (msg.type === 'mm_game_end_vibe') {
      broadcast(s, { type: 'mm_game_end_vibe', vibeSeconds: msg.vibeSeconds | 0 }, ws);
      return;
    }

    if (msg.type === 'mm_game_end_ready') {
      broadcast(s, { type: 'mm_game_end_ready', role }, ws);
      return;
    }

    if (msg.type === 'lobby_config' && role === 'host') {
      const validGameTypes = ['galactic', 'mastermind', 'endurance', 'tugofwar', 'dice', 'hilo', 'splitloot', 'wizardisland', 'beatdealer', 'standoff', 'lastcall', 'battleships', 'uno', 'snakes', 'memory', 'conquest'];
      const validDurations = [15, 30, 60, 120, 300, 600];
      const validHiloModes = ['submission', 'fixed', 'random'];
      broadcast(s, {
        type: 'lobby_config',
        gameType: validGameTypes.includes(msg.gameType) ? msg.gameType : 'galactic',
        rounds: Number.isInteger(msg.rounds) && msg.rounds >= 1 && msg.rounds <= 5 ? msg.rounds : 3,
        mode: msg.mode === 'hard' ? 'hard' : 'easy',
        forfeitDuration: validDurations.includes(msg.forfeitDuration) ? msg.forfeitDuration : 30,
        edgeMode: !!msg.edgeMode,
        edgeLives: Number.isInteger(msg.edgeLives) && msg.edgeLives >= 1 && msg.edgeLives <= 10 ? msg.edgeLives : 3,
        hiloMode: validHiloModes.includes(msg.hiloMode) ? msg.hiloMode : 'submission',
        hiloCycles: Number.isInteger(msg.hiloCycles) && msg.hiloCycles >= 0 && msg.hiloCycles <= 6 ? msg.hiloCycles : 1,
        hiloDeckSize: Number.isInteger(msg.hiloDeckSize) && msg.hiloDeckSize >= 0 && msg.hiloDeckSize <= 6 ? msg.hiloDeckSize : 1,
        hiloVibeRamp: [10, 15, 20].includes(msg.hiloVibeRamp) ? msg.hiloVibeRamp : 10,
        hiloLives: Number.isInteger(msg.hiloLives) && msg.hiloLives >= 1 && msg.hiloLives <= 10 ? msg.hiloLives : 3,
        hiloVibeTarget: ['both', 'highest_lives', 'random'].includes(msg.hiloVibeTarget) ? msg.hiloVibeTarget : 'both',
        stlDifficulty: ['easy', 'normal', 'hard'].includes(msg.stlDifficulty) ? msg.stlDifficulty : 'normal',
        stlForfeitCards: Array.isArray(msg.stlForfeitCards) ? msg.stlForfeitCards.filter(c => typeof c === 'string').map(c => c.slice(0, 32)).slice(0, 10) : [],
        soDifficulty: ['beginner', 'experienced'].includes(msg.soDifficulty) ? msg.soDifficulty : 'beginner',
        cqRounds: [5, 10].includes(msg.cqRounds) ? msg.cqRounds : 10,
        cqReckoning: ['on', 'off', 'random'].includes(msg.cqReckoning) ? msg.cqReckoning : 'random',
        btdForfeits: Array.isArray(msg.btdForfeits) ? msg.btdForfeits.filter(c => typeof c === 'string').map(c => c.slice(0, 200)).slice(0, 100) : [],
        btdMode: msg.btdMode === 'reveal' ? 'reveal' : 'draw',
        btdGameMode: msg.btdGameMode === 'h2h' ? 'h2h' : 'dealer',
        wiWinCondition: ['normal', 'endurance', 'timed'].includes(msg.wiWinCondition) ? msg.wiWinCondition : 'normal',
        wiSpellLimit: Number.isInteger(msg.wiSpellLimit) && msg.wiSpellLimit >= 1 && msg.wiSpellLimit <= 20 ? msg.wiSpellLimit : 5,
        diceVibeRule: ['lowest', 'all_but_winner'].includes(msg.diceVibeRule) ? msg.diceVibeRule : 'lowest',
        lcTimer: !!msg.lcTimer,
        lcMinutes: [5, 10, 15, 20, 30].includes(msg.lcMinutes) ? msg.lcMinutes : 10,
        lcDeckSize: Number.isInteger(msg.lcDeckSize) && msg.lcDeckSize >= 1 && msg.lcDeckSize <= 6 ? msg.lcDeckSize : 2,
        lcReward: msg.lcReward === 'half' ? 'half' : 'full',
        bsGridSize: ['standard', 'large'].includes(msg.bsGridSize) ? msg.bsGridSize : 'standard',
        bsVibeMultiplier: [1, 1.5, 2, 3].includes(Number(msg.bsVibeMultiplier)) ? Number(msg.bsVibeMultiplier) : 1.5,
        unoSpecialPacks: Array.isArray(msg.unoSpecialPacks) ? msg.unoSpecialPacks.filter(p => ['plus10','edge','skipall','swaphands','doubledown','ctrl2','mirror','deflect'].includes(p)) : [],
        unoRounds: Number.isInteger(msg.unoRounds) && msg.unoRounds >= 1 && msg.unoRounds <= 10 ? msg.unoRounds : 5,
        snlMode: ['versus', 'solo', 'watched'].includes(msg.snlMode) ? msg.snlMode : 'versus',
        snlBoardSize: ['short', 'standard', 'long'].includes(msg.snlBoardSize) ? msg.snlBoardSize : 'standard',
        snlDensity: ['tame', 'even', 'brutal'].includes(msg.snlDensity) ? msg.snlDensity : 'even',
        snlStakeMix: ['vibe', 'forfeits', 'mixed'].includes(msg.snlStakeMix) ? msg.snlStakeMix : 'mixed',
        snlVibeScale: ['full', 'half'].includes(msg.snlVibeScale) ? msg.snlVibeScale : 'full',
        snlWinCondition: ['race', 'endurance'].includes(msg.snlWinCondition) ? msg.snlWinCondition : 'race',
        snlFinalRule: ['exact', 'pass'].includes(msg.snlFinalRule) ? msg.snlFinalRule : 'exact',
        snlPowerups: msg.snlPowerups !== false,
        snlCoopBetray: !!msg.snlCoopBetray,
        snlForfeitCards: Array.isArray(msg.snlForfeitCards) ? msg.snlForfeitCards.filter(c => ['vibe','edge','task','surrender'].includes(c)) : ['vibe','edge','task','surrender'],
        snlForfeitLines: Array.isArray(msg.snlForfeitLines) ? msg.snlForfeitLines.filter(c => typeof c === 'string').map(c => c.slice(0, 200)).slice(0, 100) : [],
        snlAmbient: !!msg.snlAmbient,
        snlTapOut: !!msg.snlTapOut,
        memMode: ['versus', 'solo', 'watched'].includes(msg.memMode) ? msg.memMode : 'versus',
        memForfeitLines: Array.isArray(msg.memForfeitLines) ? msg.memForfeitLines.filter(c => typeof c === 'string').map(c => c.slice(0, 200)).slice(0, 60) : [],
        memVibeDurations: Array.isArray(msg.memVibeDurations) ? msg.memVibeDurations.filter(n => Number.isFinite(n)).map(n => Math.max(1, Math.min(600, Math.round(n)))).slice(0, 30) : [],
        memGridSize: ['4x4', '5x5', '6x6', '8x8'].includes(msg.memGridSize) ? msg.memGridSize : '6x6',
      }, ws);
      return;
    }

    // ── Wizard Island messages ─────────────────────────────────────────────
    if (msg.type === 'wi_roll_ready') {
      if (role === 'host') s.hostWiRollReady = true;
      else s.guestWiRollReady = true;
      if (s.hostWiRollReady && s.guestWiRollReady) {
        s.hostWiRollReady = false;
        s.guestWiRollReady = false;
        broadcast(s, { type: 'wi_roll_go' });
      }
      return;
    }

    if (msg.type === 'wi_battle_roll_ready') {
      if (role === 'host') s.hostWiBattleReady = true;
      else s.guestWiBattleReady = true;
      broadcast(s, { type: 'wi_battle_roll_ready' }, ws);
      if (s.hostWiBattleReady && s.guestWiBattleReady) {
        s.hostWiBattleReady = false;
        s.guestWiBattleReady = false;
        broadcast(s, { type: 'wi_battle_roll_go' });
      }
      return;
    }

    if (msg.type === 'wi_forfeit_ack') {
      if (role === 'host') s.hostWiForfeitAck = true;
      else s.guestWiForfeitAck = true;
      broadcast(s, { type: 'wi_opp_forfeit_ack' }, ws);
      if (s.hostWiForfeitAck && s.guestWiForfeitAck) {
        s.hostWiForfeitAck = false;
        s.guestWiForfeitAck = false;
      }
      return;
    }

    if (msg.type === 'wi_card_ack') {
      broadcast(s, { type: 'wi_opp_card_ack' }, ws);
      return;
    }

    if (msg.type === 'wi_wild_choice' && ['attack', 'defence', 'stamina', 'armour'].includes(msg.cardType)) {
      broadcast(s, { type: 'wi_wild_choice', cardType: msg.cardType }, ws);
      return;
    }

    if (msg.type === 'wi_rest_choice' && ['stamina', 'armour'].includes(msg.choice)) {
      broadcast(s, { type: 'wi_rest_choice', choice: msg.choice }, ws);
      return;
    }

    if (msg.type === 'wi_spell_play') {
      if (typeof msg.spellName === 'string') {
        // New-format spell play (spell name from card data)
        broadcast(s, { type: 'wi_spell_play', spellName: msg.spellName.slice(0, 64) }, ws);
      } else if (typeof msg.spellId === 'string' && VALID_SPELL_IDS.has(msg.spellId)) {
        // Legacy spell play
        const targetIsland = Number.isInteger(msg.targetIsland) && msg.targetIsland >= 0 && msg.targetIsland <= 7 ? msg.targetIsland : -1;
        if (msg.spellId === 'smite') {
          broadcast(s, { type: 'wi_haptic', intensity: 0.7, duration: 3000 });
        } else if (msg.spellId === 'overload') {
          const now = Date.now();
          if (!s._lastOverload || now - s._lastOverload > 6000) {
            s._lastOverload = now;
            broadcast(s, { type: 'wi_haptic', intensity: 1.0, duration: 5000, target: role === 'host' ? 'A' : 'B' });
          }
        }
        broadcast(s, { type: 'wi_spell_play', spellId: msg.spellId, targetIsland }, ws);
      }
      return;
    }

    if (msg.type === 'wi_spell_discard' && typeof msg.spellId === 'string' && VALID_SPELL_IDS.has(msg.spellId)) {
      broadcast(s, { type: 'wi_spell_discard', spellId: msg.spellId }, ws);
      return;
    }

    if (msg.type === 'wi_dest_ready') {
      const dest = msg.dest === 'wizard' ? 'wizard' : (Number.isInteger(msg.dest) && msg.dest >= 0 && msg.dest <= 7 ? msg.dest : null);
      if (dest === null) return;
      if (role === 'host') { s.hostWiDestReady = true; s.hostWiDest = dest; }
      else { s.guestWiDestReady = true; s.guestWiDest = dest; }
      if (s.hostWiDestReady && s.guestWiDestReady) {
        const destA = s.hostWiDest;
        const destB = s.guestWiDest;
        s.hostWiDestReady = false; s.guestWiDestReady = false;
        s.hostWiDest = null; s.guestWiDest = null;
        broadcast(s, { type: 'wi_dest_go', destA, destB });
      }
      return;
    }

    if (msg.type === 'wi_wizard_stat' && ['attack', 'defence', 'armour'].includes(msg.stat)) {
      broadcast(s, { type: 'wi_wizard_stat', stat: msg.stat }, ws);
      return;
    }

    if (msg.type === 'wi_battle_retreat') {
      const island = Number.isInteger(msg.island) && msg.island >= 0 && msg.island <= 7 ? msg.island : 0;
      broadcast(s, { type: 'wi_opp_retreat', island }, ws);
      return;
    }

    if (msg.type === 'wi_cooperate_choice' && ['cooperate', 'betray'].includes(msg.choice)) {
      if (role === 'host') s.hostWiCoopChoice = msg.choice;
      else s.guestWiCoopChoice = msg.choice;
      if (s.hostWiCoopChoice && s.guestWiCoopChoice) {
        const choiceA = s.hostWiCoopChoice;
        const choiceB = s.guestWiCoopChoice;
        s.hostWiCoopChoice = null; s.guestWiCoopChoice = null;
        broadcast(s, { type: 'wi_cooperate_reveal', choiceA, choiceB });
      }
      return;
    }

    if (msg.type === 'stl_action' && msg.action && typeof msg.action === 'object') {
      const validActionTypes = ['move', 'wait', 'remote'];
      const validDirs = ['up', 'down', 'left', 'right'];
      const validActors = ['A', 'B'];
      const atype = String(msg.action.type || '');
      if (!validActionTypes.includes(atype)) return;
      const safeAction = { type: atype };
      if (atype === 'move') {
        const dir = String(msg.action.dir || '');
        if (!validDirs.includes(dir)) return;
        safeAction.dir = dir;
      }
      const actor = String(msg.action.actor || '');
      if (validActors.includes(actor)) safeAction.actor = actor;
      broadcast(s, { type: 'stl_action', action: safeAction }, ws);
      return;
    }

    if (msg.type === 'stl_new_seed' && role === 'host') {
      const newSeed = randomBytes(4).readUInt32BE(0);
      broadcast(s, { type: 'stl_new_seed', seed: newSeed });
      return;
    }

    if (msg.type === 'stl_remote_intensity' && Number.isFinite(msg.intensity)) {
      broadcast(s, { type: 'stl_remote_intensity', intensity: Math.max(0, Math.min(100, msg.intensity | 0)) }, ws);
      return;
    }

    if (msg.type === 'edge_pause' && s.status === 'playing' && s.edgeMode) {
      const duration = Math.floor(Math.random() * 30) + 1;
      broadcast(s, { type: 'edge_pause', duration, byRole: role });
      return;
    }

    if (msg.type === 'edge_ready') {
      if (role === 'host') s.hostEdgeReady = true;
      else s.guestEdgeReady = true;
      if (s.hostEdgeReady && s.guestEdgeReady) {
        s.hostEdgeReady = false;
        s.guestEdgeReady = false;
        broadcast(s, { type: 'edge_go' });
      }
      return;
    }

    if (msg.type === 'inst_ready') {
      if (role === 'host') s.hostInstReady = true;
      else if (role === 'guest') s.guestInstReady = true;
      else if (role === 'guest2') s.guest2InstReady = true;
      const allInstReady = s.hostInstReady && s.guestInstReady && (s.guest2 == null || s.guest2InstReady);
      if (allInstReady) {
        s.hostInstReady = false;
        s.guestInstReady = false;
        s.guest2InstReady = false;
        broadcast(s, { type: 'inst_go', startAt: Date.now() + 3000 });
      }
      return;
    }

    // ── Beat the Dealer messages ───────────────────────────────────────────────
    // 0..4 matches beatdealerGame.js's HAND_SIZE (5 cards per hand).
    if (msg.type === 'btd_play' && Number.isInteger(msg.cardIndex) && msg.cardIndex >= 0 && msg.cardIndex <= 4) {
      broadcast(s, { type: 'btd_opp_play', cardIndex: msg.cardIndex, role }, ws);
      return;
    }

    if (msg.type === 'btd_next_ready') {
      broadcast(s, { type: 'btd_next_ready', role }, ws);
      return;
    }

    if (msg.type === 'btd_draw_forfeit' && role === 'host') {
      const forfeit = typeof msg.forfeit === 'string' ? msg.forfeit.slice(0, 200) : '';
      const validRoles = ['host', 'guest', 'guest2'];
      const losers = Array.isArray(msg.losers)
        ? [...new Set(msg.losers.filter(r => validRoles.includes(r)))]
        : [];
      broadcast(s, { type: 'btd_draw_forfeit', forfeit, losers });
      return;
    }

    if (msg.type === 'btd_vibe_stop') {
      broadcast(s, { type: 'btd_vibe_stop' }, ws);
      return;
    }

    if (msg.type === 'btd_vibe_claim' && ['start', 'pause'].includes(msg.action) && ['host', 'guest', 'guest2'].includes(msg.target)) {
      const payload = { type: 'btd_vibe_claim', target: msg.target, action: msg.action };
      if (msg.action === 'start' && Number.isFinite(msg.remaining)) payload.remaining = Math.max(0, msg.remaining | 0);
      broadcast(s, payload);
      return;
    }

    if (msg.type === 'btd_vibe_enable' && role === 'host') {
      broadcast(s, { type: 'btd_vibe_enable', enabled: !!msg.enabled });
      return;
    }

    if (msg.type === 'btd_claim_intensity' && ['host', 'guest', 'guest2'].includes(msg.target) && Number.isFinite(msg.intensity)) {
      broadcast(s, { type: 'btd_claim_intensity', target: msg.target, intensity: Math.max(0, Math.min(1, msg.intensity)) });
      return;
    }


    if (msg.type === 'btd_timer_cmd' && ['start','pause','reset'].includes(msg.cmd)) {
      const payload = { type: 'btd_timer_cmd', cmd: msg.cmd };
      if (msg.cmd === 'start') payload.at = Date.now();
      if (msg.cmd === 'pause' && Number.isFinite(msg.elapsed)) payload.elapsed = Math.max(0, msg.elapsed);
      // Broadcast to everyone, including the sender: 'start' carries the server's own
      // clock (not the sender's), so the sender must also apply it or its stopwatch
      // drifts from everyone else's by however much its clock differs from the server's.
      broadcast(s, payload);
      return;
    }

    if (msg.type === 'btd_d6_roll' && Number.isInteger(msg.value) && msg.value >= 1 && msg.value <= 6) {
      broadcast(s, { type: 'btd_d6_roll', value: msg.value }, ws);
      return;
    }

    if (msg.type === 'dice_roll' && Number.isInteger(msg.value) && msg.value >= 1 && msg.value <= 6) {
      broadcast(s, { type: 'dice_opp_roll', value: msg.value, role }, ws);
      return;
    }

    if (msg.type === 'dice_intensity' && Number.isFinite(msg.level)) {
      broadcast(s, { type: 'dice_intensity', level: Math.max(0, Math.min(1, msg.level)) }, ws);
      return;
    }

    if (msg.type === 'dice_next') {
      broadcast(s, { type: 'dice_next', role }, ws);
      return;
    }

    if (msg.type === 'score' && Number.isFinite(msg.value)) {
      broadcast(s, { type: 'opp_score', value: msg.value | 0 }, ws);
      return;
    }

    if (msg.type === 'vibe_add' && Number.isFinite(msg.seconds)) {
      broadcast(s, { type: 'vibe_add', seconds: msg.seconds | 0 }, ws);
      return;
    }

    if (msg.type === 'clock_extend' && Number.isFinite(msg.seconds)) {
      broadcast(s, { type: 'clock_extend', seconds: msg.seconds | 0 }, ws);
      return;
    }

    if (msg.type === 'vibe_test' && Number.isFinite(msg.level)) {
      const level = Math.max(0, Math.min(1, msg.level));
      const validRoles = ['host', 'guest', 'guest2'];
      if (validRoles.includes(msg.target)) {
        const slot = s[msg.target];
        if (slot?.socket?.readyState === 1) {
          slot.socket.send(JSON.stringify({ type: 'vibe_test', level }));
        }
      } else {
        broadcast(s, { type: 'vibe_test', level }, ws);
      }
      return;
    }

    if (msg.type === 'forfeit_intensity' && Number.isFinite(msg.level)) {
      const level = Math.max(0, Math.min(1, msg.level));
      broadcast(s, { type: 'forfeit_intensity', level });
      return;
    }

    if (msg.type === 'vibe_battery' && Number.isFinite(msg.level)) {
      broadcast(s, { type: 'opp_vibe_battery', level: Math.max(0, Math.min(100, msg.level | 0)) }, ws);
      return;
    }

    if (msg.type === 'vibe_mode_set') {
      const target = ['host', 'guest', 'guest2'].includes(msg.target) ? msg.target : null;
      const mode = VALID_VIBE_MODES.has(msg.mode) ? msg.mode : null;
      if (!target || !mode) return;
      if (!s.vibeModes) s.vibeModes = { host: 'random', guest: 'random', guest2: 'random' };
      s.vibeModes[target] = mode;
      broadcast(s, { type: 'vibe_mode_set', target, mode });
      return;
    }

    if (msg.type === 'forfeit_toggle') {
      broadcast(s, { type: 'forfeit_toggle', running: !!msg.running });
      return;
    }

    if (msg.type === 'hilo_guess' && (msg.guess === 'higher' || msg.guess === 'lower')) {
      broadcast(s, { type: 'hilo_guess', guess: msg.guess, role }, ws);
      return;
    }

    if (msg.type === 'hilo_spacebar') {
      broadcast(s, { type: 'hilo_spacebar', role }, ws);
      return;
    }

    const validPowerUpTypes = ['doubleTime', 'freeLife', 'allOrNothing', 'peek', 'skip', 'freeze', 'surge', 'chain', 'maxIntensity', 'shield', 'mirror', 'deflect'];
    if (msg.type === 'hilo_powerup_use' && validPowerUpTypes.includes(msg.powerUpType)) {
      broadcast(s, { type: 'hilo_powerup_use', powerUpType: msg.powerUpType, role }, ws);
      return;
    }

    if (msg.type === 'hilo_submit') {
      broadcast(s, { type: 'hilo_submit', role }, ws);
      return;
    }

    if (msg.type === 'hilo_play_again') {
      broadcast(s, { type: 'hilo_play_again', confirm: !!msg.confirm, role }, ws);
      return;
    }

    if (msg.type === 'hilo_vibe_level' && Number.isFinite(msg.level)) {
      broadcast(s, { type: 'hilo_vibe_level', level: Math.max(0, Math.min(1, msg.level)) }, ws);
      return;
    }

    if (msg.type === 'hilo_vibe_stop') {
      broadcast(s, { type: 'hilo_vibe_stop', role }, ws);
      return;
    }

    if (msg.type === 'hilo_wave_mode' && role === 'host') {
      broadcast(s, { type: 'hilo_wave_mode', enabled: !!msg.enabled }, ws);
      return;
    }

    // ── Last Call ─────────────────────────────────────────────────────────────
    if (msg.type === 'lc_guess' && (msg.guess === 'higher' || msg.guess === 'lower')) {
      broadcast(s, { type: 'lc_guess', guess: msg.guess, role }, ws);
      return;
    }

    if (msg.type === 'lc_resolve' && ['claim', 'playon'].includes(msg.choice)) {
      broadcast(s, { type: 'lc_resolve', choice: msg.choice, role }, ws);
      return;
    }

    if (msg.type === 'lc_run_level' && Number.isFinite(msg.level)) {
      broadcast(s, { type: 'lc_run_level', level: Math.max(0, Math.min(1, msg.level)), role }, ws);
      return;
    }

    if (msg.type === 'lc_run_tick' && msg.banks && typeof msg.banks === 'object') {
      const banks = {};
      for (const r of ['host', 'guest', 'guest2']) {
        if (Number.isFinite(msg.banks[r])) banks[r] = Math.max(0, msg.banks[r]);
      }
      broadcast(s, { type: 'lc_run_tick', banks, role }, ws);
      return;
    }

    if (msg.type === 'lc_run_stop' && msg.banks && typeof msg.banks === 'object') {
      const banks = {};
      for (const r of ['host', 'guest', 'guest2']) {
        if (Number.isFinite(msg.banks[r])) banks[r] = Math.max(0, msg.banks[r]);
      }
      broadcast(s, { type: 'lc_run_stop', banks, role }, ws);
      return;
    }

    if (msg.type === 'lc_finish') {
      broadcast(s, { type: 'lc_finish', role }, ws);
      return;
    }

    if (msg.type === 'lc_powerup' && ['peek', 'doubledown', 'pattern', 'drain', 'leech', 'hijack', 'tax', 'lockbox', 'timeheist'].includes(msg.puType)) {
      const target = ['host', 'guest', 'guest2'].includes(msg.target) ? msg.target : null;
      broadcast(s, { type: 'lc_powerup', puType: msg.puType, target, role }, ws);
      return;
    }

    // ── Standoff ──────────────────────────────────────────────────────────────
    if (msg.type === 'so_draft_pick' && typeof msg.cardId === 'string') {
      const VALID_POWER_IDS = new Set(['surge','intel','reinforce','sabotage','forfeit','ghost']);
      if (!VALID_POWER_IDS.has(msg.cardId)) return;
      if (s.soDraftPicks.some(p => p.cardId === msg.cardId)) return;
      const expectedRole = s.soDraftPicks.length % 2 === 0 ? 'host' : 'guest';
      if (role !== expectedRole) return;
      s.soDraftPicks.push({ cardId: msg.cardId, byRole: role });
      broadcast(s, { type: 'so_draft_broadcast', pickIndex: s.soDraftPicks.length - 1, cardId: msg.cardId, byRole: role });
      return;
    }

    if (msg.type === 'so_ready') {
      if (role === 'host') s.soHostReady = true;
      else s.soGuestReady = true;
      if (s.soHostReady && s.soGuestReady) {
        s.soHostReady = false; s.soGuestReady = false;
        s.soRoundStartAt = Date.now();
        broadcast(s, { type: 'so_go' });
      }
      return;
    }

    if (msg.type === 'so_spy_won') {
      s.soSpyWinner = role;
      return;
    }

    if (msg.type === 'so_spy_pick' && typeof msg.fieldId === 'string') {
      if (s.soSpyWinner !== role) return;
      s.soSpyWinner = null;
      s.soSpyPickPending = { winnerRole: role, fieldId: msg.fieldId };
      // Ack so client can transition to allocation
      const targetSocket = s[role]?.socket;
      if (targetSocket?.readyState === 1) {
        targetSocket.send(JSON.stringify({ type: 'so_spy_pick_ack', fieldId: msg.fieldId }));
      }
      return;
    }

    if (msg.type === 'so_spy_field_update' && typeof msg.fieldId === 'string' && Number.isInteger(msg.count)) {
      const spy = s.soSpyPickPending;
      if (!spy || role === spy.winnerRole || msg.fieldId !== spy.fieldId) return;
      const count = Math.max(0, Math.min(14, msg.count));
      const winnerSocket = s[spy.winnerRole]?.socket;
      if (winnerSocket?.readyState === 1) {
        winnerSocket.send(JSON.stringify({ type: 'so_spy_reveal', fieldId: msg.fieldId, count }));
      }
      return;
    }

    if (msg.type === 'so_mirror_update' && Number.isInteger(msg.count) && msg.count >= 0 && msg.count <= 14) {
      const now = Date.now();
      if (now - (s.soMirrorThrottle || 0) < 200) return;
      s.soMirrorThrottle = now;
      if (now - s.soRoundStartAt > 25000) return;
      const oppRole = role === 'host' ? 'guest' : 'host';
      const oppSocket = s[oppRole]?.socket;
      if (oppSocket?.readyState === 1) {
        oppSocket.send(JSON.stringify({ type: 'so_mirror_update', count: msg.count }));
      }
      return;
    }

    if (msg.type === 'so_token_count' && Number.isInteger(msg.total) && msg.total >= 0 && msg.total <= 14) {
      s.soTokenCounts = s.soTokenCounts || { host: 0, guest: 0 };
      s.soTokenCounts[role] = msg.total;
      const oppRole = role === 'host' ? 'guest' : 'host';
      const oppSocket = s[oppRole]?.socket;
      if (oppSocket?.readyState === 1) {
        const outTotal = (s.soGhostActive?.[role]) ? 0 : msg.total;
        oppSocket.send(JSON.stringify({ type: 'so_opp_token_count', total: outTotal }));
      }
      return;
    }

    if (msg.type === 'so_commit' && msg.fields && typeof msg.fields === 'object') {
      // The server doesn't track Standoff's round/pool state, so it can't verify the
      // committed total matches the allowed token pool — but it can at least reject
      // absurd per-field values so a modified client can't auto-win every field.
      const VALID_SO_POWER_IDS = ['surge', 'intel', 'reinforce', 'sabotage', 'forfeit', 'ghost'];
      const safeFields = {};
      for (const [fieldId, count] of Object.entries(msg.fields).slice(0, 8)) {
        if (typeof fieldId === 'string' && fieldId.length <= 32 && Number.isInteger(count)) {
          safeFields[fieldId] = Math.max(0, Math.min(14, count));
        }
      }
      const safeCommit = {
        fields: safeFields,
        powersUsed: Array.isArray(msg.powersUsed) ? msg.powersUsed.filter(p => VALID_SO_POWER_IDS.includes(p)) : [],
        intelField: typeof msg.intelField === 'string' ? msg.intelField.slice(0, 32) : null,
      };
      if (role === 'host') s.soHostCommit = safeCommit;
      else s.soGuestCommit = safeCommit;
      if (!s.soAutoCommitTimer) {
        s.soAutoCommitTimer = setTimeout(() => {
          if (!s.soHostCommit) s.soHostCommit = { fields: {}, powersUsed: [] };
          if (!s.soGuestCommit) s.soGuestCommit = { fields: {}, powersUsed: [] };
          soTryReveal(s);
        }, 35000);
      }
      soTryReveal(s);
      return;
    }

    if (msg.type === 'so_power_post') {
      const validPowers = new Set(['reinforce', 'sabotage', 'pass']);
      if (!validPowers.has(msg.power)) return;
      s.soPowerPlays = s.soPowerPlays || {};
      s.soPowerPlays[role] = msg.power === 'pass' ? null : { power: msg.power, fieldId: msg.fieldId };
      const bothResponded = 'host' in s.soPowerPlays && 'guest' in s.soPowerPlays;
      if (bothResponded) {
        clearTimeout(s.soPowerTimer);
        soBroadcastPowers(s);
      }
      return;
    }

    if (msg.type === 'so_chicken_intensity' && Number.isFinite(msg.intensity)) {
      const clamped = Math.max(0, Math.min(1, msg.intensity));
      broadcast(s, { type: 'so_chicken_intensity', intensity: clamped, byRole: role });
      return;
    }

    if (msg.type === 'so_forfeit_intensity' && Number.isFinite(msg.intensity)) {
      const clamped = Math.max(0, Math.min(1, msg.intensity));
      const oppWs = role === 'host' ? s.guestWs : s.hostWs;
      if (oppWs) oppWs.send(JSON.stringify({ type: 'so_forfeit_intensity', intensity: clamped }));
      return;
    }

    if (msg.type === 'so_mercy') {
      broadcast(s, { type: 'so_mercy', byRole: role });
      return;
    }

    if (msg.type === 'so_chicken_stop') {
      const now = Date.now();
      if (!s.soChickenStop) {
        s.soChickenStop = { role, time: now };
        s.soChickenTimer = setTimeout(() => {
          broadcast(s, { type: 'so_chicken_result', outcome: 'stopped', stoppedBy: s.soChickenStop?.role });
          s.soChickenStop = null; s.soChickenTimer = null;
        }, 60);
      } else {
        clearTimeout(s.soChickenTimer);
        const diff = Math.abs(now - s.soChickenStop.time);
        const outcome = diff <= 50 ? 'simultaneous' : 'stopped';
        const stoppedBy = diff <= 50 ? null : s.soChickenStop.role;
        broadcast(s, { type: 'so_chicken_result', outcome, stoppedBy });
        s.soChickenStop = null; s.soChickenTimer = null;
      }
      return;
    }

    if (msg.type === 'so_vibe_pattern' && ['slow_burn','rapid_pulse','escalating_waves'].includes(msg.pattern)) {
      const loserRole = role === 'host' ? 'guest' : 'host';
      const loserSocket = s[loserRole]?.socket;
      if (loserSocket?.readyState === 1) {
        loserSocket.send(JSON.stringify({ type: 'so_vibe_pattern', pattern: msg.pattern }));
      }
      return;
    }
    // ── End Standoff ──────────────────────────────────────────────────────────

    // ── Conquest ─────────────────────────────────────────────────────────────
    if (msg.type === 'cq_ready') {
      if (!s.cqPlayerRoles?.includes(role)) return;
      const edgePostNodeId = s.cqNodeIds?.edgePost;
      const edgePostHolder = edgePostNodeId ? s.cqOwnership[edgePostNodeId] : null;
      const oweEdge = edgePostHolder && edgePostHolder !== 'neutral' && edgePostHolder !== role;
      if (oweEdge && !s.cqEdgeAck[role]) return; // must confirm the edge before readying up
      s.cqReady[role] = true;
      // Bot roles have no socket to send cq_ready themselves — they're trivially ready always,
      // and exempt from the edge-post gate (nothing to physically edge).
      const allReady = s.cqPlayerRoles.every(r => s.cqBotRoles?.includes(r) || s.cqReady[r]);
      if (allReady) {
        for (const r of s.cqPlayerRoles) {
          s.cqReady[r] = false;
          s.cqEdgeAck[r] = false;
          s.cqDicePool[r] = cqComputeDicePool(s.cqBaseDice, r, s.cqOwnership, s.cqNodeIds.muster);
        }
        s.cqRoundStartAt = Date.now();
        broadcast(s, { type: 'cq_go', pools: s.cqDicePool, roundIndex: s.cqRoundIndex });
        for (const botRole of s.cqBotRoles || []) cqBotAllocate(s, botRole);
        cqTryReveal(s);
      }
      return;
    }

    if (msg.type === 'cq_edge_ack') {
      if (!s.cqPlayerRoles?.includes(role)) return;
      s.cqEdgeAck[role] = true;
      return;
    }

    if (msg.type === 'cq_allocate' && msg.allocation && typeof msg.allocation === 'object') {
      if (!s.cqPlayerRoles?.includes(role)) return;
      const frontier = new Set(cqGetFrontier(s.cqMap, s.cqOwnership, role));
      const owned = new Set(s.cqMap.nodes.filter(n => s.cqOwnership[n.id] === role).map(n => n.id));
      const safeAlloc = {};
      for (const [nodeId, count] of Object.entries(msg.allocation).slice(0, 64)) {
        if (typeof nodeId !== 'string' || nodeId.length > 32 || !Number.isInteger(count) || count <= 0) continue;
        if (!owned.has(nodeId) && !frontier.has(nodeId)) continue; // illegal target, drop it
        safeAlloc[nodeId] = count;
      }
      // Server does not trust the client's total — clamp down to the round's actual pool,
      // unlike Standoff's commit handler, since ownership/pool desync here is not acceptable.
      const pool = s.cqDicePool[role] ?? s.cqBaseDice;
      let remaining = pool;
      for (const nodeId of Object.keys(safeAlloc)) {
        const clamped = Math.min(safeAlloc[nodeId], remaining);
        safeAlloc[nodeId] = clamped;
        remaining -= clamped;
      }
      s.cqCommits[role] = safeAlloc;
      if (!s.cqAutoCommitTimer) {
        s.cqAutoCommitTimer = setTimeout(() => {
          for (const r of s.cqPlayerRoles) if (!s.cqCommits[r]) s.cqCommits[r] = {};
          cqTryReveal(s);
        }, 45000);
      }
      cqTryReveal(s);
      return;
    }

    if (msg.type === 'cq_claim_dungeon_gate') {
      const targetRole = s.cqPlayerRoles?.includes(msg.targetRole) && msg.targetRole !== role ? msg.targetRole : null;
      if (!targetRole) return;
      cqHandleClaim(s, role, 'dungeonGate', () => cqDungeonGateEffect(s, targetRole));
      return;
    }

    if (msg.type === 'cq_claim_iron_throne') {
      const targetRole = s.cqPlayerRoles?.includes(msg.targetRole) && msg.targetRole !== role ? msg.targetRole : null;
      if (!targetRole) return;
      cqHandleClaim(s, role, 'ironThrone', () => cqIronThroneEffect(s, targetRole));
      return;
    }

    if (msg.type === 'cq_debug_reveal_traps') {
      // Hidden dev/testing shortcut (Alt+R) — answered directly to the requesting socket only,
      // never broadcast, so it can't leak trap locations to the other player.
      if (!s.cqPlayerRoles?.includes(role) || !s.cqMap) return;
      const nodeIds = s.cqMap.nodes.filter(n => n.type === 'trap' || n.type === 'secretTrap').map(n => n.id);
      ws.send(JSON.stringify({ type: 'cq_debug_reveal_traps', nodeIds }));
      return;
    }

    if (msg.type === 'cq_match_end_ready') {
      broadcast(s, { type: 'cq_match_end_ready', role }, ws);
      return;
    }

    if (msg.type === 'cq_match_end_intensity') {
      const level = Number.isFinite(msg.level) ? Math.max(0, Math.min(1, msg.level)) : 1;
      broadcast(s, { type: 'cq_match_end_intensity', byRole: role, level }, ws);
      return;
    }
    // ── End Conquest ─────────────────────────────────────────────────────────

    // ── Battleships messages ──────────────────────────────────────────────────
    if (msg.type === 'bs_powerup_use') {
      const puType = ['torpedo', 'depth', 'sonar'].includes(msg.puType) ? msg.puType : null;
      if (!puType) return;
      const r = msg.r | 0, c = msg.c | 0;
      if (r < 0 || r > 13 || c < 0 || c > 13) return;
      broadcast(s, { type: 'bs_powerup_use', puType, r, c, orient: msg.orient === 'v' ? 'v' : 'h' }, ws);
      return;
    }

    if (msg.type === 'bs_powerup_result') {
      const cells = Array.isArray(msg.cells) ? msg.cells.slice(0, 12).map(c => ({
        r: c.r | 0, c: c.c | 0,
        hit: !!c.hit, sunk: !!c.sunk,
        sunkId: c.sunkId ? String(c.sunkId) : null,
        hasShip: !!c.hasShip,
      })) : [];
      broadcast(s, { type: 'bs_powerup_result', puType: String(msg.puType || ''), cells, gameOver: !!msg.gameOver }, ws);
      return;
    }

    if (msg.type === 'bs_ready') {
      broadcast(s, { type: 'bs_ready', role }, ws);
      return;
    }

    if (msg.type === 'bs_shot') {
      const r = msg.r | 0, c = msg.c | 0;
      if (r < 0 || r > 13 || c < 0 || c > 13) return;
      broadcast(s, { type: 'bs_shot', r, c, role }, ws);
      return;
    }

    if (msg.type === 'bs_result') {
      broadcast(s, { type: 'bs_result', r: msg.r | 0, c: msg.c | 0, hit: !!msg.hit, sunk: !!msg.sunk, sunkId: msg.sunkId ? String(msg.sunkId) : null, gameOver: !!msg.gameOver }, ws);
      return;
    }

    if (msg.type === 'bs_vibe_ctrl') {
      const intensity = Math.max(0, Math.min(1, Number(msg.intensity) || 0));
      const pattern = ['steady', 'wave', 'pulse'].includes(msg.pattern) ? msg.pattern : 'steady';
      broadcast(s, { type: 'bs_vibe_ctrl', intensity, pattern }, ws);
      return;
    }

    if (msg.type === 'bs_end') {
      broadcast(s, { type: 'bs_end' }, ws);
      return;
    }
    // ── End Battleships ───────────────────────────────────────────────────────

    // ── UNO messages ─────────────────────────────────────────────────────────
    if (msg.type === 'uno_play') {
      const cardId = msg.cardId | 0;
      const chosenColor = ['red', 'yellow', 'green', 'blue', 'wild'].includes(msg.chosenColor) ? msg.chosenColor : null;
      const from = ['host', 'guest', 'guest2'].includes(msg.from) ? msg.from : null;
      const swapTarget = ['host', 'guest', 'guest2'].includes(msg.swapTarget) ? msg.swapTarget : null;
      broadcast(s, { type: 'uno_play', cardId, chosenColor, from, swapTarget }, ws);
      return;
    }

    if (msg.type === 'uno_draw') {
      const count = Math.max(1, Math.min(16, msg.count | 0));
      const from = ['host', 'guest', 'guest2'].includes(msg.from) ? msg.from : null;
      broadcast(s, { type: 'uno_draw', count, from }, ws);
      return;
    }

    if (msg.type === 'uno_take_ctrl') {
      const from = ['host', 'guest', 'guest2'].includes(msg.from) ? msg.from : null;
      broadcast(s, { type: 'uno_take_ctrl', from }, ws);
      return;
    }

    if (msg.type === 'uno_call_uno') {
      const from = ['host', 'guest', 'guest2'].includes(msg.from) ? msg.from : null;
      broadcast(s, { type: 'uno_call_uno', from }, ws);
      return;
    }

    if (msg.type === 'uno_challenge') {
      const from = ['host', 'guest', 'guest2'].includes(msg.from) ? msg.from : null;
      const target = ['host', 'guest', 'guest2'].includes(msg.target) ? msg.target : null;
      broadcast(s, { type: 'uno_challenge', from, target }, ws);
      return;
    }

    if (msg.type === 'uno_vibe_ctrl') {
      const from = ['host', 'guest', 'guest2'].includes(msg.from) ? msg.from : null;
      const target = ['host', 'guest', 'guest2'].includes(msg.target) ? msg.target : null;
      const intensity = Math.max(0, Math.min(1, Number(msg.intensity) || 0));
      broadcast(s, { type: 'uno_vibe_ctrl', intensity, from, target }, ws);
      return;
    }

    if (msg.type === 'uno_forfeit_ctrl') {
      const from = ['host', 'guest', 'guest2'].includes(msg.from) ? msg.from : null;
      const target = ['host', 'guest', 'guest2'].includes(msg.target) ? msg.target : null;
      const intensity = Math.max(0, Math.min(1, Number(msg.intensity) || 0));
      const VALID_PATTERNS = ['steady', 'pulse', 'wave', 'surge'];
      const pattern = VALID_PATTERNS.includes(msg.pattern) ? msg.pattern : 'steady';
      const targetWs = target ? s[target]?.socket : null;
      if (targetWs?.readyState === 1) {
        targetWs.send(JSON.stringify({ type: 'uno_forfeit_ctrl', target, intensity, pattern, from }));
      }
      return;
    }

    if (msg.type === 'uno_forfeit_ready') {
      const from = ['host', 'guest', 'guest2'].includes(msg.from) ? msg.from : null;
      broadcast(s, { type: 'uno_forfeit_ready', from }, ws);
      return;
    }
    // ── End UNO ───────────────────────────────────────────────────────────────

    // ── Snakes & Ladders ──────────────────────────────────────────────────────
    if (msg.type === 'snl_roll_ready') {
      if (role === 'host') s.snlHostRollReady = true;
      else s.snlGuestRollReady = true;
      if (s.snlHostRollReady || s.snlGuestRollReady) {
        s.snlHostRollReady = false;
        s.snlGuestRollReady = false;
        s.snlTurnIndex = (s.snlTurnIndex | 0) + 1;
        broadcast(s, { type: 'snl_roll_go', turnIndex: s.snlTurnIndex });
      }
      return;
    }

    if (msg.type === 'snl_move_done') {
      const tile = Number.isInteger(msg.tile) && msg.tile >= 1 ? msg.tile : 1;
      const final = !!msg.final;
      // targetRole lets sender move a different player's token (e.g. Deflect powerup)
      const targetRole = ['host', 'guest', 'guest2'].includes(msg.targetRole) ? msg.targetRole : role;
      // extra: true means a Double Move is pending, so recipients shouldn't advance the turn yet
      const extra = !!msg.extra;
      broadcast(s, { type: 'snl_move_done', role: targetRole, tile, final, extra }, ws);
      return;
    }

    if (msg.type === 'snl_powerup') {
      const puId = typeof msg.puId === 'string' ? msg.puId.slice(0, 32) : '';
      const target = ['host', 'guest', 'guest2'].includes(msg.target) ? msg.target : null;
      const draw = !!msg.draw;
      broadcast(s, { type: 'snl_powerup', role, puId, target, draw }, ws);
      return;
    }

    if (msg.type === 'snl_forfeit_draw') {
      const cardIndex = Number.isInteger(msg.cardIndex) ? Math.max(0, msg.cardIndex) : 0;
      const secs = Number.isFinite(msg.secs) ? Math.max(0, msg.secs) : 0;
      broadcast(s, { type: 'snl_forfeit_draw', role, cardIndex, secs }, ws);
      return;
    }

    if (msg.type === 'snl_forfeit_ack') {
      broadcast(s, { type: 'snl_opp_forfeit_ack', role }, ws);
      return;
    }

    if (msg.type === 'snl_forfeit_assign') {
      const cardIndex = Number.isInteger(msg.cardIndex) ? Math.max(0, msg.cardIndex) : 0;
      const target = ['host', 'guest', 'guest2'].includes(msg.target) ? msg.target : null;
      broadcast(s, { type: 'snl_forfeit_assign', role, cardIndex, target }, ws);
      return;
    }

    if (msg.type === 'snl_coop_choice') {
      const choice = msg.choice === 'cooperate' ? 'cooperate' : 'betray';
      const target = ['host', 'guest', 'guest2'].includes(msg.target) ? msg.target : null;
      broadcast(s, { type: 'snl_coop_choice', role, choice, target }, ws);
      return;
    }

    if (msg.type === 'snl_coop_reveal') {
      const validRoles = ['host', 'guest', 'guest2'];
      const landerRole = validRoles.includes(msg.landerRole) ? msg.landerRole : null;
      const partnerRole = validRoles.includes(msg.partnerRole) ? msg.partnerRole : null;
      const landerChoice = ['cooperate', 'betray'].includes(msg.landerChoice) ? msg.landerChoice : 'cooperate';
      const partnerChoice = ['cooperate', 'betray'].includes(msg.partnerChoice) ? msg.partnerChoice : 'cooperate';
      if (!landerRole || !partnerRole) return;
      broadcast(s, { type: 'snl_coop_reveal', landerRole, landerChoice, partnerRole, partnerChoice });
      return;
    }

    if (msg.type === 'snl_vibe_ctrl' && Number.isFinite(msg.intensity)) {
      const target = ['host', 'guest', 'guest2'].includes(msg.target) ? msg.target : null;
      const intensity = Math.max(0, Math.min(1, msg.intensity));
      const pattern = ['steady', 'pulse', 'wave'].includes(msg.pattern) ? msg.pattern : undefined;
      const payload = { type: 'snl_vibe_ctrl', intensity, from: role, pattern };
      const targetWs = target ? s[target]?.socket : null;
      if (targetWs?.readyState === 1) {
        targetWs.send(JSON.stringify(payload));
      } else {
        broadcast(s, payload, ws);
      }
      return;
    }

    if (msg.type === 'snl_vibe_stop') {
      const target = ['host', 'guest', 'guest2'].includes(msg.target) ? msg.target : null;
      broadcast(s, { type: 'snl_vibe_stop', role, target }, ws);
      return;
    }

    if (msg.type === 'snl_vibe_start') {
      const secs = Number.isFinite(msg.secs) ? Math.max(1, msg.secs) : 10;
      const target = ['host', 'guest', 'guest2'].includes(msg.target) ? msg.target : null;
      // victim:true flips this from "you drive" to "you're being vibed" (ladder/deflect);
      // bottom/top/driver just annotate the victim's banner.
      const driver = ['host', 'guest', 'guest2'].includes(msg.driver) ? msg.driver : null;
      const bottom = Number.isInteger(msg.bottom) ? msg.bottom : null;
      const top = Number.isInteger(msg.top) ? msg.top : null;
      broadcast(s, { type: 'snl_vibe_start', role, secs, target, mirror: !!msg.mirror, victim: !!msg.victim, bottom, top, driver }, ws);
      return;
    }

    if (msg.type === 'snl_finale_done') {
      broadcast(s, { type: 'snl_finale_done', role }, ws);
      return;
    }

    if (msg.type === 'snl_endurance_out') {
      broadcast(s, { type: 'snl_endurance_out', role }, ws);
      return;
    }
    // ── End Snakes & Ladders ──────────────────────────────────────────────────

    // ── Memory Match ───────────────────────────────────────────────────────────
    if (msg.type === 'mem_flip' && Number.isInteger(msg.pos) && msg.pos >= 0 && msg.pos <= 63) {
      broadcast(s, { type: 'mem_flip', pos: msg.pos, role }, ws);
      return;
    }

    if (msg.type === 'mem_vibe_trigger') {
      const targetRole = ['host', 'guest', 'guest2'].includes(msg.targetRole) ? msg.targetRole : null;
      if (!targetRole || !Number.isInteger(msg.chargeIndex)) return;
      const intensity = Number.isFinite(msg.intensity) ? Math.max(0, Math.min(1, msg.intensity)) : 0.5;
      const pattern = typeof msg.pattern === 'string' ? msg.pattern.slice(0, 32) : 'steady';
      broadcast(s, { type: 'mem_vibe_trigger', targetRole, chargeIndex: msg.chargeIndex, intensity, pattern, from: role }, ws);
      return;
    }

    if (msg.type === 'mem_vibe_adjust') {
      const targetRole = ['host', 'guest', 'guest2'].includes(msg.targetRole) ? msg.targetRole : null;
      if (!targetRole) return;
      const intensity = Number.isFinite(msg.intensity) ? Math.max(0, Math.min(1, msg.intensity)) : 0.5;
      const pattern = typeof msg.pattern === 'string' ? msg.pattern.slice(0, 32) : 'steady';
      broadcast(s, { type: 'mem_vibe_adjust', targetRole, intensity, pattern, from: role }, ws);
      return;
    }

    if (msg.type === 'mem_vibe_stop') {
      const targetRole = ['host', 'guest', 'guest2'].includes(msg.targetRole) ? msg.targetRole : null;
      if (!targetRole) return;
      broadcast(s, { type: 'mem_vibe_stop', targetRole, from: role }, ws);
      return;
    }

    if (msg.type === 'mem_vibe_pause') {
      broadcast(s, { type: 'mem_vibe_pause', role }, ws);
      return;
    }

    if (msg.type === 'mem_win') {
      broadcast(s, { type: 'mem_win', role }, ws);
      return;
    }

    if (msg.type === 'mem_skip_turn') {
      const skippedRole = ['host', 'guest', 'guest2'].includes(msg.role) ? msg.role : null;
      if (!skippedRole) return;
      // This is meant to skip a *disconnected* player's turn — verify the target's
      // socket is actually absent so a connected player's turn can't be force-skipped.
      const isDisconnected = skippedRole === 'host' ? !s.host?.socket : !s[skippedRole];
      if (!isDisconnected) return;
      broadcast(s, { type: 'mem_skip_turn', role: skippedRole }, ws);
      return;
    }
    // ── End Memory Match ───────────────────────────────────────────────────────

    if (msg.type === 'final' && Number.isFinite(msg.value)) {
      const v = msg.value | 0;
      const vibeSeconds = Number.isFinite(msg.vibeSeconds) ? Math.max(0, msg.vibeSeconds | 0) : 0;
      if (role === 'host') s.host.finalScore = v;
      if (role === 'guest' && s.guest) s.guest.finalScore = v;
      if (role === 'guest2' && s.guest2) s.guest2.finalScore = v;
      broadcast(s, { type: 'opp_final', value: v, vibeSeconds, role }, ws);
      const allDone = s.host.finalScore != null && s.guest?.finalScore != null && (s.guest2 == null || s.guest2.finalScore != null);
      if (allDone) s.status = 'finished';
      return;
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    const s = sessionId ? getSession(sessionId) : null;
    if (s && role) {
      s._reconnectTimers = s._reconnectTimers || {};
      s._reconnectTimers[role] = setTimeout(() => {
        const s2 = sessionId ? getSession(sessionId) : null;
        if (s2) broadcast(s2, { type: 'peer_left', role });
        if (s._reconnectTimers) delete s._reconnectTimers[role];
      }, 5000);
    }
    if (sessionId) detachSocket(sessionId, ws);
  });
});

function soTryReveal(s) {
  if (!s.soHostCommit || !s.soGuestCommit) return;
  clearTimeout(s.soAutoCommitTimer);
  s.soAutoCommitTimer = null;
  s.soGhostActive = {
    host: s.soHostCommit.powersUsed?.includes('ghost') ?? false,
    guest: s.soGuestCommit.powersUsed?.includes('ghost') ?? false,
  };
  let intelResult = null;
  if (s.soHostCommit.powersUsed?.includes('intel') && s.soHostCommit.intelField) {
    const count = s.soGuestCommit.fields[s.soHostCommit.intelField] ?? 0;
    intelResult = { fieldId: s.soHostCommit.intelField, count, forRole: 'host' };
  } else if (s.soGuestCommit.powersUsed?.includes('intel') && s.soGuestCommit.intelField) {
    const count = s.soHostCommit.fields[s.soGuestCommit.intelField] ?? 0;
    intelResult = { fieldId: s.soGuestCommit.intelField, count, forRole: 'guest' };
  }
  s.soPrevAlloc = {
    host: { ...s.soHostCommit.fields },
    guest: { ...s.soGuestCommit.fields },
  };
  s.soSpyPickPending = null;
  broadcast(s, {
    type: 'so_reveal',
    hostFields: s.soHostCommit.fields,
    guestFields: s.soGuestCommit.fields,
    hostPowersUsed: s.soHostCommit.powersUsed ?? [],
    guestPowersUsed: s.soGuestCommit.powersUsed ?? [],
    intelResult,
  });
  s.soHostCommit = null; s.soGuestCommit = null;
  s.soPowerPlays = {};
  s.soPowerTimer = setTimeout(() => soBroadcastPowers(s), 10000);
}

function soBroadcastPowers(s) {
  broadcast(s, {
    type: 'so_power_broadcast',
    host: s.soPowerPlays?.host ?? null,
    guest: s.soPowerPlays?.guest ?? null,
  });
  s.soPowerPlays = {};
}

function cqUsedMapFor(s, claimKey) {
  if (claimKey === 'dungeonGate') return s.cqDungeonGateUsed;
  if (claimKey === 'ironThrone') return s.cqIronThroneUsed;
  return null;
}

// Shared validation for the two manual-invoke claim abilities: must currently hold the
// node and not have used it yet this session. `applyFn` performs the ability's effect and
// returns the extra fields for `cq_claim_result`, or null if there's nothing to apply
// (e.g. Iron Throne with no pending forfeit to double) — in which case nothing is marked used.
function cqHandleClaim(s, role, claimKey, applyFn) {
  if (!s.cqPlayerRoles?.includes(role)) return;
  const nodeId = s.cqNodeIds?.[claimKey];
  if (!nodeId || s.cqOwnership[nodeId] !== role) return;
  const used = cqUsedMapFor(s, claimKey);
  if (!used || used[role]) return;
  const result = applyFn();
  if (!result) return;
  used[role] = true;
  broadcast(s, { type: 'cq_claim_result', claim: claimKey, byRole: role, ...result });
}

function cqTryReveal(s) {
  if (!s.cqPlayerRoles.every(r => s.cqCommits[r])) return;
  clearTimeout(s.cqAutoCommitTimer);
  s.cqAutoCommitTimer = null;

  const rng = cqMakeRng((s.seed ^ CQ_SEED_ROLL ^ s.cqRoundIndex) >>> 0);
  const rolls = cqRollAllocation(s.cqCommits, rng);
  const prevOwnership = { ...s.cqOwnership };
  const { newOwnership, contested } = cqResolveRound(s.cqMap, s.cqOwnership, rolls, s.cqRoundIndex);
  const effects = cqApplyPassiveEffects(s.cqMap, prevOwnership, newOwnership, contested, s.cqSecretTrapNodeIds);
  s.cqOwnership = newOwnership;

  // Sanctuary skip tokens shield a Trap hit before it's assigned (existing tokens only —
  // a token granted by this same round's Sanctuary win doesn't retroactively self-shield).
  const trapShielded = [];
  for (const r of effects.trapHits) {
    if ((s.cqSkipTokens[r] || 0) > 0) {
      s.cqSkipTokens[r]--;
      trapShielded.push(r);
    } else {
      s.cqLastForfeit[r] = { kind: 'trap', durationSec: 30, appliedAt: Date.now() };
    }
  }
  // Trap's node type is redacted from the public map, so clients can't identify a hit by
  // looking up a node's type themselves. Per design, opponents are never told a Trap fired at
  // all (same secrecy bar as Secret Trap) — so this goes out as a private message to the
  // affected role's own socket only, never as a field on the general cq_reveal broadcast.
  for (const r of effects.trapHits) {
    const sock = s[r]?.socket;
    if (sock?.readyState === 1) {
      sock.send(JSON.stringify({ type: 'cq_trap_hit', shielded: trapShielded.includes(r) }));
    }
  }
  for (const r of effects.sanctuaryGrants) {
    s.cqSkipTokens[r] = (s.cqSkipTokens[r] || 0) + 1;
  }
  // The Mirror: any forfeit just assigned to its holder this reveal is duplicated onto every
  // other player. Guarded by `appliedAt` freshness — without it, a Mirror holder's forfeit from
  // several rounds ago (nothing clears cqLastForfeit once Vault is removed) would get re-mirrored
  // onto everyone else every single round for the rest of the match.
  if (effects.mirrorHolder) {
    const holderForfeit = s.cqLastForfeit[effects.mirrorHolder];
    if (holderForfeit && Date.now() - holderForfeit.appliedAt < 5000) {
      for (const r of s.cqPlayerRoles) {
        if (r !== effects.mirrorHolder) s.cqLastForfeit[r] = { ...holderForfeit, mirrored: true };
      }
    }
  }

  // Secret Trap: private-only notifications, never broadcast to the other player(s).
  for (const transfer of effects.secretTrapTransfers) {
    if (transfer.toRole !== 'neutral') {
      const toSocket = s[transfer.toRole]?.socket;
      if (toSocket?.readyState === 1) {
        toSocket.send(JSON.stringify({ type: 'cq_secret_status', nodeId: transfer.nodeId, isSecretTrap: true }));
      }
    }
    if (transfer.fromRole !== 'neutral') {
      const fromSocket = s[transfer.fromRole]?.socket;
      if (fromSocket?.readyState === 1) {
        fromSocket.send(JSON.stringify({ type: 'cq_secret_status', nodeId: transfer.nodeId, isSecretTrap: false }));
      }
    }
  }

  const domination = cqCheckDomination(s.cqOwnership, s.cqMap.claimSpaceIds, s.cqPlayerRoles, s.cqControlStreakHolder, s.cqControlStreak);
  s.cqControlStreakHolder = domination.streakHolder;
  s.cqControlStreak = domination.streak;

  s.cqRoundIndex++;
  s.cqCommits = {};

  let matchWinner = domination.dominationWinner;
  let matchOver = !!matchWinner;
  if (!matchWinner) {
    const capResult = cqCheckRoundCap(s.cqRoundIndex, s.cqRoundCap, s.cqOwnership, s.cqMap.claimSpaceIds, s.cqPlayerRoles);
    if (capResult.reached) {
      matchOver = true;
      // A tie at the cap ends the match as a genuine draw (winnerRole: null) rather than
      // extending into sudden death — the draw-handling match-end screen already covers this.
      matchWinner = capResult.tied ? null : capResult.winner;
    }
  }

  broadcast(s, {
    type: 'cq_reveal',
    rolls,
    contested,
    ownership: s.cqOwnership,
    dicePool: s.cqDicePool,
    roundIndex: s.cqRoundIndex,
    controlStreakHolder: s.cqControlStreakHolder,
    controlStreak: s.cqControlStreak,
    skipTokens: s.cqSkipTokens,
    edgePostHolder: effects.edgePostHolder,
    mirrorHolder: effects.mirrorHolder,
    musterHolder: effects.musterHolder,
  });

  for (const botRole of s.cqBotRoles || []) cqBotMaybeClaim(s, botRole);

  if (matchOver) {
    s.cqMatchEnded = true;
    const passives = cqResolveMatchEndPassives(s.cqMap, s.cqOwnership, s.cqPlayerRoles);
    broadcast(s, { type: 'cq_match_end', winnerRole: matchWinner, ridgepath: passives.ridgepath, reckoning: passives.reckoning });
    // No socket exists for a bot role, so it can never send its own cq_match_end_ready —
    // broadcast one on its behalf immediately so human clients aren't left waiting forever.
    for (const botRole of s.cqBotRoles || []) {
      broadcast(s, { type: 'cq_match_end_ready', role: botRole });
    }
  }
}

// ── Computer-player (bot) logic ─────────────────────────────────────────────
// A bot has no socket at all — s[role] stays null throughout. It's exempt from anything
// requiring a physical response (edge-post gating, forfeits) since there's no one to feel it.

function cqDungeonGateEffect(s, targetRole) {
  if ((s.cqSkipTokens[targetRole] || 0) > 0) {
    s.cqSkipTokens[targetRole]--;
    return { targetRole, shielded: true };
  }
  s.cqLastForfeit[targetRole] = { kind: 'punishment', durationSec: 300, appliedAt: Date.now() };
  return { targetRole, durationSec: 300 };
}

function cqIronThroneEffect(s, targetRole) {
  const forfeit = s.cqLastForfeit[targetRole];
  if (!forfeit) return null;
  forfeit.durationSec *= 2;
  return { targetRole, newDurationSec: forfeit.durationSec };
}

// Simple heuristic with randomness: attack/reinforce a handful of legal targets (mostly
// frontier, occasionally reinforcing its own ground), unevenly splitting its dice pool.
function cqBotAllocate(s, role) {
  const frontier = cqGetFrontier(s.cqMap, s.cqOwnership, role);
  const owned = s.cqMap.nodes.filter(n => s.cqOwnership[n.id] === role).map(n => n.id);
  const reinforceSample = owned.filter(() => Math.random() < 0.3);
  const candidates = [...new Set([...frontier, ...reinforceSample])];
  const pool = s.cqDicePool[role] ?? s.cqBaseDice;

  if (candidates.length === 0 || pool <= 0) { s.cqCommits[role] = {}; return; }

  const chosen = [...candidates].sort(() => Math.random() - 0.5).slice(0, Math.min(4, candidates.length));
  const alloc = {};
  let remaining = pool;
  chosen.forEach((nodeId, i) => {
    const isLast = i === chosen.length - 1;
    const share = isLast ? remaining : Math.max(1, Math.round((remaining / (chosen.length - i)) * (0.6 + Math.random() * 0.8)));
    const amount = Math.min(share, remaining);
    if (amount > 0) alloc[nodeId] = (alloc[nodeId] || 0) + amount;
    remaining -= amount;
  });
  s.cqCommits[role] = alloc;
}

// After each reveal, a bot that now controls an unused claim ability invokes it about
// half the time, targeting a random human opponent (never another bot).
function cqBotMaybeClaim(s, botRole) {
  const abilities = [
    ['dungeonGate', (targetRole) => cqDungeonGateEffect(s, targetRole)],
    ['ironThrone', (targetRole) => cqIronThroneEffect(s, targetRole)],
  ];
  const humanTargets = s.cqPlayerRoles.filter(r => r !== botRole && !s.cqBotRoles.includes(r));

  for (const [claimKey, effectFn] of abilities) {
    const nodeId = s.cqNodeIds?.[claimKey];
    if (!nodeId || s.cqOwnership[nodeId] !== botRole) continue;
    const used = cqUsedMapFor(s, claimKey);
    if (!used || used[botRole]) continue;
    if (Math.random() >= 0.5) continue;
    const targetRole = humanTargets[Math.floor(Math.random() * humanTargets.length)];
    if (!targetRole) continue;
    cqHandleClaim(s, botRole, claimKey, () => effectFn(targetRole));
  }
}

setInterval(purgeStaleSessions, 5 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] listening on http://0.0.0.0:${PORT}`);
});
