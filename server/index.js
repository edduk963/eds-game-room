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
      broadcast(s, lobbySnapshot(s));
      return;
    }

    const s = sessionId ? getSession(sessionId) : null;
    if (!s) return;

    if (msg.type === 'start' && role === 'host' && s.guest) {
      s.status = 'playing';
      s.seed = randomBytes(4).readUInt32BE(0);
      s.host.finalScore = null;
      if (s.guest) s.guest.finalScore = null;
      if (s.guest2) s.guest2.finalScore = null;
      s.hostEdgeReady = false;
      s.guestEdgeReady = false;
      s.hostInstReady = false;
      s.guestInstReady = false;
      s.hostWiRollReady = false;
      s.guestWiRollReady = false;
      s.hostWiBattleReady = false;
      s.guestWiBattleReady = false;
      s.hostWiForfeitAck = false;
      s.guestWiForfeitAck = false;
      const validGameTypes = ['galactic', 'mastermind', 'endurance', 'tugofwar', 'dice', 'hilo', 'splitloot', 'wizardisland', 'beatdealer'];
      const gameType = validGameTypes.includes(msg.gameType) ? msg.gameType : 'galactic';
      const rounds = Number.isInteger(msg.rounds) && msg.rounds >= 2 && msg.rounds <= 5 ? msg.rounds : 3;
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
      const playerCount = s.guest2 ? 3 : 2;
      const validStlDifficulties = ['easy', 'normal', 'hard'];
      const stlDifficulty = validStlDifficulties.includes(msg.stlDifficulty) ? msg.stlDifficulty : 'normal';
      const stlForfeitCards = Array.isArray(msg.stlForfeitCards) ? msg.stlForfeitCards.filter(c => typeof c === 'string').map(c => c.slice(0, 32)).slice(0, 10) : [];
      const validWiWin = ['normal', 'endurance', 'timed'];
      const wiWinCondition = validWiWin.includes(msg.wiWinCondition) ? msg.wiWinCondition : 'normal';
      const wiSpellLimit = Number.isInteger(msg.wiSpellLimit) && msg.wiSpellLimit >= 1 && msg.wiSpellLimit <= 20 ? msg.wiSpellLimit : 5;
      s.edgeMode = edgeMode;
      const guest2Name = s.guest2?.name ?? null;
      broadcast(s, { type: 'begin', seed: s.seed, startAt: null, gameType, rounds, mode, forfeitDuration, edgeMode, edgeLives, hiloMode, hiloCycles, hiloDeckSize, hiloVibeRamp, hiloLives, hiloVibeTarget, playerCount, guest2Name, stlDifficulty, stlForfeitCards, wiWinCondition, wiSpellLimit });
      return;
    }

    if (msg.type === 'mm_guess' && Array.isArray(msg.guess)) {
      broadcast(s, { type: 'mm_guess', guess: msg.guess.map(c => String(c)).slice(0, 7) }, ws);
      return;
    }

    if (msg.type === 'mm_round_end') {
      broadcast(s, { type: 'mm_round_end', solved: !!msg.solved }, ws);
      return;
    }

    if (msg.type === 'mm_round_ready') {
      broadcast(s, { type: 'mm_round_ready' }, ws);
      return;
    }

    if (msg.type === 'lobby_config' && role === 'host') {
      const validGameTypes = ['galactic', 'mastermind', 'endurance', 'tugofwar', 'dice', 'hilo', 'splitloot', 'wizardisland', 'beatdealer'];
      const validDurations = [15, 30, 60, 120, 300, 600];
      const validHiloModes = ['submission', 'fixed', 'random'];
      broadcast(s, {
        type: 'lobby_config',
        gameType: validGameTypes.includes(msg.gameType) ? msg.gameType : 'galactic',
        rounds: Number.isInteger(msg.rounds) && msg.rounds >= 2 && msg.rounds <= 5 ? msg.rounds : 3,
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
        wiWinCondition: ['normal', 'endurance', 'timed'].includes(msg.wiWinCondition) ? msg.wiWinCondition : 'normal',
        wiSpellLimit: Number.isInteger(msg.wiSpellLimit) && msg.wiSpellLimit >= 1 && msg.wiSpellLimit <= 20 ? msg.wiSpellLimit : 5,
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
      if (s.hostInstReady && s.guestInstReady) {
        s.hostInstReady = false;
        s.guestInstReady = false;
        broadcast(s, { type: 'inst_go', startAt: Date.now() + 3000 });
      }
      return;
    }

    // ── Beat the Dealer messages ───────────────────────────────────────────────
    if (msg.type === 'btd_play' && Number.isInteger(msg.cardIndex) && msg.cardIndex >= 0 && msg.cardIndex <= 9) {
      broadcast(s, { type: 'btd_opp_play', cardIndex: msg.cardIndex }, ws);
      return;
    }

    if (msg.type === 'btd_next_ready') {
      broadcast(s, { type: 'btd_next_ready' }, ws);
      return;
    }

    if (msg.type === 'btd_forfeit_override' && role === 'host' && Number.isInteger(msg.position) && msg.position >= 1 && msg.position <= 99) {
      broadcast(s, { type: 'btd_forfeit_override', position: msg.position });
      return;
    }

    if (msg.type === 'btd_draw_forfeit' && role === 'host') {
      const forfeit = typeof msg.forfeit === 'string' ? msg.forfeit.slice(0, 200) : '';
      broadcast(s, { type: 'btd_draw_forfeit', forfeit });
      return;
    }

    if (msg.type === 'btd_cpu_override' && role === 'host' &&
        msg.card && Number.isInteger(msg.card.value) && msg.card.value >= 1 && msg.card.value <= 13 &&
        typeof msg.card.suit === 'string' && ['S','H','D','C'].includes(msg.card.suit)) {
      broadcast(s, { type: 'btd_cpu_override', card: { value: msg.card.value, suit: msg.card.suit } });
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
      broadcast(s, { type: 'dice_opp_roll', value: msg.value }, ws);
      return;
    }

    if (msg.type === 'dice_intensity' && Number.isFinite(msg.level)) {
      broadcast(s, { type: 'dice_intensity', level: Math.max(0, Math.min(1, msg.level)) }, ws);
      return;
    }

    if (msg.type === 'dice_next') {
      broadcast(s, { type: 'dice_next' }, ws);
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
    if (s) broadcast(s, { type: 'peer_left', role }, ws);
    if (sessionId) detachSocket(sessionId, ws);
  });
});

setInterval(purgeStaleSessions, 5 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
