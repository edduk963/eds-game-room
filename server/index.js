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
  getWorld,
  applyMove,
  applyDuelPick,
  applyClaimUse,
  applySkipToken,
  resetGame,
} from './world.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

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

// ── World Map (Conquest) routes ───────────────────────────────────────────────
app.get('/world', (_req, res) => {
  try { res.json(getWorld()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/world/move', (req, res) => {
  const { playerKey, spaceId } = req.body || {};
  if (!['p1','p2'].includes(playerKey) || typeof spaceId !== 'string') {
    return res.status(400).json({ error: 'bad_request' });
  }
  const result = applyMove(playerKey, spaceId);
  result.error ? res.status(400).json(result) : res.json(result);
});

app.post('/world/duel', (req, res) => {
  const { playerKey, pick } = req.body || {};
  if (!['p1','p2'].includes(playerKey) || !Number.isInteger(pick) || pick < 1 || pick > 5) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const result = applyDuelPick(playerKey, pick);
  result.error ? res.status(400).json(result) : res.json(result);
});

app.post('/world/claim', (req, res) => {
  const { playerKey, spaceId } = req.body || {};
  if (!['p1','p2'].includes(playerKey) || typeof spaceId !== 'string') {
    return res.status(400).json({ error: 'bad_request' });
  }
  const result = applyClaimUse(playerKey, spaceId);
  result.error ? res.status(400).json(result) : res.json(result);
});

app.post('/world/skip', (req, res) => {
  const { playerKey, targetDesc } = req.body || {};
  if (!['p1','p2'].includes(playerKey) || typeof targetDesc !== 'string') {
    return res.status(400).json({ error: 'bad_request' });
  }
  const result = applySkipToken(playerKey, targetDesc.slice(0, 200));
  result.error ? res.status(400).json(result) : res.json(result);
});

app.post('/world/reset', (_req, res) => {
  try { res.json(resetGame()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// ── End World Map routes ──────────────────────────────────────────────────────

const distDir = path.join(__dirname, '..', 'dist');
app.use(express.static(distDir));
app.get(/^\/(?!session|ws).*/, (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) res.status(404).end();
  });
});

const VALID_SPELL_IDS = new Set(['gust','bolt','mirror','confiscate','mend','rust','veil','fog','smite','recall','leap','shield','doubleedge','summon','ironskin','curse','drain','hex','blink','overload']);

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

      if (s.host.socket === ws) {
        role = 'host';
      } else if (s.guest?.socket === ws) {
        role = 'guest';
      } else if (s.guest2?.socket === ws) {
        role = 'guest2';
      } else if (!s.host.socket) {
        role = 'host';
        attachSocket(s.id, 'host', ws, name);
      } else if (!s.guest) {
        role = 'guest';
        attachSocket(s.id, 'guest', ws, name);
      } else if (!s.guest2) {
        role = 'guest2';
        attachSocket(s.id, 'guest2', ws, name);
      } else {
        ws.send(JSON.stringify({ type: 'error', code: 'session_full' }));
        ws.close();
        return;
      }
      ws.send(JSON.stringify({ type: 'joined', role, sessionId: s.id }));
      if (s._reconnectTimers?.[role]) {
        clearTimeout(s._reconnectTimers[role]);
        delete s._reconnectTimers[role];
        broadcast(s, { type: 'peer_reconnected', role }, ws);
      }
      broadcast(s, lobbySnapshot(s));
      return;
    }

    const s = sessionId ? getSession(sessionId) : null;
    if (!s) return;

    const SOLO_CAPABLE = ['beatdealer', 'hilo', 'mastermind', 'lastcall'];
    if (msg.type === 'start' && role === 'host' && (s.guest || SOLO_CAPABLE.includes(msg.gameType))) {
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
      s.soHostCommit = null; s.soGuestCommit = null;
      s.soAutoCommitTimer = null; s.soPowerTimer = null;
      s.soPowerPlays = {}; s.soChickenStop = null; s.soChickenTimer = null;
      s.soPrevAlloc = null; s.soSpyWinner = null;
      s.soGhostActive = { host: false, guest: false };
      s.soMirrorThrottle = 0; s.soTokenCounts = { host: 0, guest: 0 };
      s.soRoundStartAt = Date.now(); s.soDraftPicks = [];
      s.soHostReady = false; s.soGuestReady = false;
      const validGameTypes = ['galactic', 'mastermind', 'endurance', 'tugofwar', 'dice', 'hilo', 'splitloot', 'wizardisland', 'beatdealer', 'standoff', 'lastcall', 'battleships', 'uno'];
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
      const playerCount = !s.guest ? 1 : s.guest2 ? 3 : 2;
      const validStlDifficulties = ['easy', 'normal', 'hard'];
      const stlDifficulty = validStlDifficulties.includes(msg.stlDifficulty) ? msg.stlDifficulty : 'normal';
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
      const VALID_UNO_PACKS = ['plus10', 'edge', 'skipall', 'swaphands', 'doubledown', 'ctrl2'];
      const unoSpecialPacks = Array.isArray(msg.unoSpecialPacks) ? msg.unoSpecialPacks.filter(p => VALID_UNO_PACKS.includes(p)) : [];
      s.edgeMode = edgeMode;
      const guest2Name = s.guest2?.name ?? null;
      broadcast(s, { type: 'begin', seed: s.seed, startAt: null, gameType, rounds, mode, forfeitDuration, edgeMode, edgeLives, hiloMode, hiloCycles, hiloDeckSize, hiloVibeRamp, hiloLives, hiloVibeTarget, playerCount, guest2Name, stlDifficulty, stlForfeitCards, btdForfeits, btdMode, btdGameMode, wiWinCondition, wiSpellLimit, diceVibeRule, lcTimer, lcMinutes, lcDeckSize, lcReward, bsGridSize, bsVibeMultiplier, unoSpecialPacks });
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
      const validGameTypes = ['galactic', 'mastermind', 'endurance', 'tugofwar', 'dice', 'hilo', 'splitloot', 'wizardisland', 'beatdealer', 'standoff', 'lastcall', 'battleships', 'uno'];
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
        unoSpecialPacks: Array.isArray(msg.unoSpecialPacks) ? msg.unoSpecialPacks.filter(p => ['plus10','edge','skipall','swaphands','doubledown','ctrl2'].includes(p)) : [],
        unoRounds: Number.isInteger(msg.unoRounds) && msg.unoRounds >= 1 && msg.unoRounds <= 10 ? msg.unoRounds : 5,
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

    if (msg.type === 'wi_spell_play' && typeof msg.spellId === 'string' && VALID_SPELL_IDS.has(msg.spellId)) {
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
      return;
    }

    if (msg.type === 'wi_spell_discard' && typeof msg.spellId === 'string' && VALID_SPELL_IDS.has(msg.spellId)) {
      broadcast(s, { type: 'wi_spell_discard', spellId: msg.spellId }, ws);
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
    if (msg.type === 'btd_play' && Number.isInteger(msg.cardIndex) && msg.cardIndex >= 0 && msg.cardIndex <= 9) {
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
      broadcast(s, payload, ws);
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

    const validPowerUpTypes = ['doubleTime', 'freeLife', 'allOrNothing', 'peek', 'skip', 'freeze', 'surge', 'chain', 'maxIntensity', 'shield', 'mirror'];
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
      if (role === 'host') s.soHostCommit = msg;
      else s.soGuestCommit = msg;
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
      const intensity = Math.max(0, Math.min(1, Number(msg.intensity) || 0));
      broadcast(s, { type: 'uno_vibe_ctrl', intensity, from }, ws);
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

    if (msg.type === 'final' && Number.isFinite(msg.value)) {
      const v = msg.value | 0;
      const vibeSeconds = Number.isFinite(msg.vibeSeconds) ? Math.max(0, msg.vibeSeconds | 0) : 0;
      if (role === 'host') s.host.finalScore = v;
      if (role === 'guest' && s.guest) s.guest.finalScore = v;
      if (role === 'guest2' && s.guest2) s.guest2.finalScore = v;
      broadcast(s, { type: 'opp_final', value: v, vibeSeconds }, ws);
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

setInterval(purgeStaleSessions, 5 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] listening on http://0.0.0.0:${PORT}`);
});
