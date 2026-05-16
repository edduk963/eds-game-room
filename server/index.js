import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  createSession,
  getSession,
  attachSocket,
  detachSocket,
  lobbySnapshot,
  broadcast,
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

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

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
      } else if (!s.host.socket) {
        role = 'host';
        attachSocket(s.id, 'host', ws, name);
      } else if (!s.guest) {
        role = 'guest';
        attachSocket(s.id, 'guest', ws, name);
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
      s.seed = (Math.random() * 0xffffffff) >>> 0;
      s.host.finalScore = null;
      if (s.guest) s.guest.finalScore = null;
      s.hostEdgeReady = false;
      s.guestEdgeReady = false;
      s.hostInstReady = false;
      s.guestInstReady = false;
      const validGameTypes = ['galactic', 'mastermind', 'endurance', 'tugofwar', 'dice', 'hilo'];
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
      broadcast(s, { type: 'begin', seed: s.seed, startAt: null, gameType, rounds, mode, forfeitDuration, edgeMode, edgeLives, hiloMode, hiloCycles, hiloDeckSize, hiloVibeRamp, hiloLives });
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
      const validGameTypes = ['galactic', 'mastermind', 'endurance', 'tugofwar', 'dice', 'hilo'];
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
      }, ws);
      return;
    }

    if (msg.type === 'edge_pause' && s.status === 'playing') {
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
      broadcast(s, { type: 'vibe_test', level }, ws);
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
      broadcast(s, { type: 'hilo_guess', guess: msg.guess }, ws);
      return;
    }

    if (msg.type === 'hilo_spacebar') {
      broadcast(s, { type: 'hilo_spacebar' }, ws);
      return;
    }

    const validPowerUpTypes = ['doubleTime', 'freeLife', 'allOrNothing', 'peek', 'skip', 'freeze'];
    if (msg.type === 'hilo_powerup_use' && validPowerUpTypes.includes(msg.powerUpType)) {
      broadcast(s, { type: 'hilo_powerup_use', powerUpType: msg.powerUpType }, ws);
      return;
    }

    if (msg.type === 'hilo_submit') {
      broadcast(s, { type: 'hilo_submit' }, ws);
      return;
    }

    if (msg.type === 'hilo_play_again') {
      broadcast(s, { type: 'hilo_play_again', confirm: !!msg.confirm }, ws);
      return;
    }

    if (msg.type === 'hilo_vibe_level' && Number.isFinite(msg.level)) {
      broadcast(s, { type: 'hilo_vibe_level', level: Math.max(0, Math.min(1, msg.level)) }, ws);
      return;
    }

    if (msg.type === 'hilo_vibe_stop') {
      broadcast(s, { type: 'hilo_vibe_stop' }, ws);
      return;
    }

    if (msg.type === 'final' && Number.isFinite(msg.value)) {
      const v = msg.value | 0;
      const vibeSeconds = Number.isFinite(msg.vibeSeconds) ? Math.max(0, msg.vibeSeconds | 0) : 0;
      if (role === 'host') s.host.finalScore = v;
      if (role === 'guest' && s.guest) s.guest.finalScore = v;
      broadcast(s, { type: 'opp_final', value: v, vibeSeconds }, ws);
      if (s.host.finalScore != null && s.guest?.finalScore != null) {
        s.status = 'finished';
      }
      return;
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    const s = sessionId ? getSession(sessionId) : null;
    if (s) broadcast(s, { type: 'peer_left' }, ws);
    if (sessionId) detachSocket(sessionId, ws);
  });
});

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
