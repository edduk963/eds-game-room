import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';
import { makeRng } from '../game/seededRng.js';
import { createGameState, submitIntent, resolveForfeits } from '../game/splitLootGame.js';
import { CELL } from '../game/splitLootMap.js';
import { initVibeModeBar } from '../vibeModeBar.js';

const COLORS = {
  bg: '#0d0d1a',
  floor: '#141420',
  wall: '#0a0a14',
  entry: '#162016',
  exit: '#101028',
  playerA: '#4a9eff',
  playerB: '#ff4a6a',
  guard: '#ff9900',
  loot: '#c9a84c',
  card: '#9c4aff',
  remote: '#4affce',
  corridor: '#151525',
};

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function renderSplitLoot(root) {
  const myRole = state.role;
  const myKey = myRole === 'host' ? 'A' : 'B';
  const oppKey = myKey === 'A' ? 'B' : 'A';
  const myName = state.myName || myKey;
  const oppName = (myRole === 'host' ? state.guestName : state.hostName) || oppKey;

  const playerNames = { A: myRole === 'host' ? myName : oppName, B: myRole === 'host' ? oppName : myName };

  let gs = createGameState(state.seed, state.stlDifficulty, state.stlForfeitCards, playerNames);
  const rng = makeRng(state.seed ^ 0xcafe1234);

  let caughtInterval = null;
  let remoteRaf = 0;
  let pendingRemoteIntensity = 0;

  // ── DOM ─────────────────────────────────────────────────────────────
  root.innerHTML = `
    <div id="stl-wrap" style="
      display:flex;flex-direction:column;align-items:center;
      min-height:100vh;background:${COLORS.bg};color:#e0e0e0;
      padding:8px;box-sizing:border-box;font-family:monospace;
    ">
      <div id="stl-blind-overlay" style="
        display:none;position:fixed;inset:0;background:#0d0d1a;
        z-index:100;align-items:center;justify-content:center;
        font-size:24px;color:#333;letter-spacing:4px;
      ">◈ ◈ ◈ ◈ ◈ ◈ ◈ ◈ ◈ ◈</div>

      <div id="stl-hud" style="
        width:100%;max-width:520px;display:flex;gap:8px;
        align-items:center;justify-content:space-between;
        background:#111;border:1px solid #2a2a4a;border-radius:6px;
        padding:6px 10px;margin-bottom:8px;font-size:13px;
      "></div>

      <div id="stl-room-label" style="
        font-size:11px;color:#444;margin-bottom:4px;
        letter-spacing:3px;text-transform:uppercase;
      "></div>

      <div id="stl-grid-wrap" style="position:relative;">
        <canvas id="stl-canvas" width="400" height="400" style="
          border:1px solid #1e1e38;border-radius:4px;display:block;
        "></canvas>
        <div id="stl-corridor-view" style="display:none;
          width:400px;background:#151525;border:1px solid #1e1e38;border-radius:4px;
          padding:16px;box-sizing:border-box;
        "></div>
      </div>

      <div id="stl-intent-status" style="
        margin-top:6px;font-size:12px;color:#555;min-height:18px;text-align:center;
      "></div>

      <div id="stl-actions" style="
        display:flex;flex-direction:column;gap:8px;margin-top:6px;
        width:100%;max-width:400px;
      ">
        <div style="display:flex;gap:6px;justify-content:center;">
          <button class="stl-btn ghost" data-dir="up" style="width:64px;">↑</button>
        </div>
        <div style="display:flex;gap:6px;justify-content:center;">
          <button class="stl-btn ghost" data-dir="left" style="width:64px;">←</button>
          <button class="stl-btn ghost" data-dir="down" style="width:64px;">↓</button>
          <button class="stl-btn ghost" data-dir="right" style="width:64px;">→</button>
        </div>
        <div style="display:flex;gap:6px;justify-content:center;margin-top:2px;">
          <button class="stl-btn ghost" id="stl-wait-btn">Wait</button>
          <button class="stl-btn ghost" id="stl-remote-btn" style="display:none;">Use Remote</button>
        </div>
      </div>

      <div id="stl-remote-panel" style="display:none;
        width:100%;max-width:400px;margin-top:8px;
        background:#111;border:1px solid #4affce33;border-radius:6px;padding:10px;
      ">
        <div style="font-size:12px;color:#4affce;margin-bottom:6px;">REMOTE CONTROL — <span id="stl-remote-timer"></span></div>
        <input type="range" id="stl-remote-slider" min="0" max="100" value="0" style="width:100%;">
        <div style="font-size:11px;color:#555;margin-top:4px;">Drag to control opponent's device</div>
      </div>

      <div id="stl-event-log" style="
        width:100%;max-width:400px;margin-top:8px;
        background:#111;border:1px solid #1e1e38;border-radius:6px;
        padding:8px;font-size:12px;color:#666;min-height:60px;
      "></div>

      <div id="stl-caught-overlay" style="display:none;
        position:fixed;inset:0;background:#1a0000ee;
        z-index:50;flex-direction:column;align-items:center;justify-content:center;
        font-size:20px;color:#ff4a4a;gap:12px;
      ">
        <div>You've been detained.</div>
        <div style="font-size:13px;color:#cc5555;">Game continues — watch and wait.</div>
      </div>

      <div id="stl-end-screen" style="display:none;
        position:fixed;inset:0;background:#0d0d1a;overflow-y:auto;
        z-index:200;flex-direction:column;align-items:center;padding:24px;gap:16px;
      ">
      </div>
    </div>
  `;

  let vibeModeBarInstance = initVibeModeBar(root);

  const style = document.createElement('style');
  style.dataset.stl = '1';
  style.textContent = `
    .stl-btn {
      padding:10px 18px;border-radius:6px;cursor:pointer;font-size:14px;
      background:transparent;border:1px solid #333;color:#aaa;font-family:monospace;
      transition:border-color 0.1s,color 0.1s;
    }
    .stl-btn:hover:not(:disabled) { border-color:#666;color:#fff; }
    .stl-btn:disabled { opacity:0.25;cursor:default; }
    .stl-btn.submitted { border-color:#4a9eff55;color:#4a9eff88; }
  `;
  document.head.appendChild(style);

  // ── Element refs ──────────────────────────────────────────────────────
  const canvas        = root.querySelector('#stl-canvas');
  const ctx           = canvas.getContext('2d');
  const hudEl         = root.querySelector('#stl-hud');
  const roomLabel     = root.querySelector('#stl-room-label');
  const actionsEl     = root.querySelector('#stl-actions');
  const intentStatus  = root.querySelector('#stl-intent-status');
  const remotePanel   = root.querySelector('#stl-remote-panel');
  const remoteSlider  = root.querySelector('#stl-remote-slider');
  const remoteTimerEl = root.querySelector('#stl-remote-timer');
  const eventLogEl    = root.querySelector('#stl-event-log');
  const caughtOverlay = root.querySelector('#stl-caught-overlay');
  const blindOverlay  = root.querySelector('#stl-blind-overlay');
  const endScreen     = root.querySelector('#stl-end-screen');
  const corridorView  = root.querySelector('#stl-corridor-view');

  // ── Render ────────────────────────────────────────────────────────────
  const CELL_SIZE = 40;

  function drawGrid() {
    const myPos = gs.players[myKey].position;

    if (myPos.corridor !== undefined) {
      canvas.style.display = 'none';
      corridorView.style.display = 'block';
      drawCorridor(myPos.corridor, myPos.tileIdx);
      return;
    }

    canvas.style.display = 'block';
    corridorView.style.display = 'none';

    const roomIdx = myPos.room;
    const room = gs.rooms[roomIdx];

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, 400, 400);

    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const cell = room.grid[y][x];
        const px = x * CELL_SIZE;
        const py = y * CELL_SIZE;

        if (cell === CELL.WALL) {
          // Beveled wall
          ctx.fillStyle = '#0a0a14';
          ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
          ctx.fillStyle = '#18182a'; // top-left highlight
          ctx.fillRect(px, py, CELL_SIZE, 2);
          ctx.fillRect(px, py, 2, CELL_SIZE);
          ctx.fillStyle = '#050508'; // bottom-right shadow
          ctx.fillRect(px + CELL_SIZE - 2, py, 2, CELL_SIZE);
          ctx.fillRect(px, py + CELL_SIZE - 2, CELL_SIZE, 2);
        } else {
          ctx.fillStyle = cell === CELL.ENTRY ? COLORS.entry
            : cell === CELL.EXIT ? COLORS.exit
            : COLORS.floor;
          ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
          ctx.strokeStyle = '#1c1c30';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(px + 0.5, py + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
          ctx.lineWidth = 1;

          if (cell === CELL.ENTRY) drawCellLabel(px, py, 'IN', '#3a7a3a');
          if (cell === CELL.EXIT)  drawCellLabel(px, py, 'OUT', '#3a3a7a');
        }
      }
    }

    // Loot
    for (const l of room.loot) drawLoot(l.x, l.y, l.value);

    // Cards
    for (const c of room.cards) {
      if (!c.resolved) drawCardToken(c.x, c.y);
    }

    // Remotes
    for (const r of room.remotes) drawRemoteToken(r.x, r.y);

    // Guards
    for (const g of room.guards) drawGuard(g.position.x, g.position.y);

    // Opponent (if in same room)
    const oppPos = gs.players[oppKey].position;
    if (oppPos.room === roomIdx) {
      drawPlayer(oppPos.x, oppPos.y, oppKey === 'A' ? COLORS.playerA : COLORS.playerB, oppKey);
    }

    // My player (drawn on top)
    drawPlayer(myPos.x, myPos.y, myKey === 'A' ? COLORS.playerA : COLORS.playerB, myKey);
  }

  function drawCellLabel(px, py, text, color) {
    ctx.fillStyle = color;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, px + CELL_SIZE / 2, py + CELL_SIZE / 2);
    ctx.textBaseline = 'alphabetic';
  }

  function drawLoot(gx, gy, value) {
    const cx = gx * CELL_SIZE + CELL_SIZE / 2;
    const cy = gy * CELL_SIZE + CELL_SIZE / 2;
    const r = 10;
    // Hexagon coin
    ctx.fillStyle = '#8a6a20';
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
      if (i === 0) ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
      else ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COLORS.loot;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
      if (i === 0) ctx.moveTo(cx + (r - 2) * Math.cos(a), cy + (r - 2) * Math.sin(a));
      else ctx.lineTo(cx + (r - 2) * Math.cos(a), cy + (r - 2) * Math.sin(a));
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0d0d1a';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(value, cx, cy);
    ctx.textBaseline = 'alphabetic';
  }

  function drawCardToken(gx, gy) {
    const cx = gx * CELL_SIZE + CELL_SIZE / 2;
    const cy = gy * CELL_SIZE + CELL_SIZE / 2;
    const w = 14, h = 18;
    ctx.fillStyle = '#2a1a4a';
    ctx.strokeStyle = COLORS.card;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.card;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', cx, cy);
    ctx.lineWidth = 1;
    ctx.textBaseline = 'alphabetic';
  }

  function drawRemoteToken(gx, gy) {
    const cx = gx * CELL_SIZE + CELL_SIZE / 2;
    const cy = gy * CELL_SIZE + CELL_SIZE / 2;
    ctx.strokeStyle = COLORS.remote;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = COLORS.remote;
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
  }

  function drawGuard(gx, gy) {
    const cx = gx * CELL_SIZE + CELL_SIZE / 2;
    const cy = gy * CELL_SIZE + CELL_SIZE / 2;
    const t = Date.now() / 500;
    const pulse = 0.5 + 0.5 * Math.sin(t);
    const r = 12;

    ctx.shadowColor = `rgba(255,120,0,${pulse * 0.8})`;
    ctx.shadowBlur = 12;

    ctx.fillStyle = `rgba(255,${100 + Math.floor(pulse * 60)},0,${0.75 + 0.25 * pulse})`;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('G', cx, cy);
    ctx.textBaseline = 'alphabetic';
  }

  function drawPlayer(gx, gy, color, label) {
    const cx = gx * CELL_SIZE + CELL_SIZE / 2;
    const cy = gy * CELL_SIZE + CELL_SIZE / 2;

    ctx.shadowColor = color;
    ctx.shadowBlur = 10;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = color + 'aa';
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy);
    ctx.lineWidth = 1;
    ctx.textBaseline = 'alphabetic';
  }

  function drawCorridor(corridorIdx, tileIdx) {
    const corridor = gs.corridors[corridorIdx];
    const tiles = corridor.tiles;
    let html = `<div style="color:#444;font-size:11px;margin-bottom:12px;letter-spacing:2px;">CORRIDOR ${corridorIdx + 1}</div>`;
    html += `<div style="display:flex;gap:4px;align-items:center;justify-content:center;">`;
    for (let i = 0; i < tiles.length; i++) {
      const isMe = tileIdx === i;
      const oppInCorridor = gs.players[oppKey].position.corridor === corridorIdx
        && gs.players[oppKey].position.tileIdx === i;
      const hasLoot = corridor.loot.some(l => l.x === i);
      let content = '';
      if (isMe) content += `<span style="color:${myKey === 'A' ? COLORS.playerA : COLORS.playerB}">${myKey}</span>`;
      if (oppInCorridor) content += `<span style="color:${oppKey === 'A' ? COLORS.playerA : COLORS.playerB}">${oppKey}</span>`;
      if (hasLoot) content += `<span style="color:${COLORS.loot}">◆</span>`;
      const border = isMe ? `2px solid ${myKey === 'A' ? COLORS.playerA : COLORS.playerB}` : '1px solid #2a2a4a';
      html += `<div style="width:56px;height:56px;background:${COLORS.corridor};border:${border};
        border-radius:4px;display:flex;align-items:center;justify-content:center;
        font-size:14px;gap:2px;">${content || '<span style="color:#222;">·</span>'}</div>`;
    }
    html += `</div>`;
    html += `<div style="font-size:11px;color:#333;margin-top:10px;text-align:center;">← back &nbsp;&nbsp; forward →</div>`;
    corridorView.innerHTML = html;
  }

  let guardAnimFrame = null;
  function startRenderLoop() {
    function loop() {
      if (gs.phase === 'playing') {
        drawGrid();
        guardAnimFrame = requestAnimationFrame(loop);
      }
    }
    guardAnimFrame = requestAnimationFrame(loop);
  }

  function updateHud() {
    const A = gs.players.A;
    const B = gs.players.B;
    const threshold = gs.winThreshold;

    const mySubmitted  = gs.pendingIntents[myKey] !== null;
    const oppSubmitted = gs.pendingIntents[oppKey] !== null;

    const statusText = mySubmitted
      ? `Waiting for ${gs.playerNames[oppKey]}…`
      : gs.players[myKey].status !== 'active'
        ? `${gs.players[myKey].status === 'caught' ? 'Detained' : 'Escaped'} — watching`
        : 'Choose your move';

    const myPos = gs.players[myKey].position;
    const locLabel = myPos.room !== undefined
      ? `Room ${myPos.room + 1}`
      : myPos.corridor !== undefined ? `Corridor ${myPos.corridor + 1}` : '';

    roomLabel.textContent = locLabel;
    intentStatus.textContent = statusText;
    intentStatus.style.color = mySubmitted ? '#4a9eff88' : '#555';

    hudEl.innerHTML = `
      <span style="color:${COLORS.playerA}">A: ${A.loot}/${threshold}pt</span>
      <span style="color:#333;font-size:11px;">Turn ${gs.turn}</span>
      <span style="color:${COLORS.playerB}">B: ${B.loot}/${threshold}pt</span>
    `;

    // Remote button
    const remoteBtn = root.querySelector('#stl-remote-btn');
    if (remoteBtn) {
      const myPlayer = gs.players[myKey];
      remoteBtn.style.display = (myPlayer.remoteUses > 0 && !gs.effects.remoteActive) ? 'inline-block' : 'none';
      if (myPlayer.remoteUses > 0) remoteBtn.textContent = `Use Remote (${myPlayer.remoteUses})`;
    }

    // Disable buttons when submitted or not active
    const canAct = !mySubmitted && gs.players[myKey].status === 'active' && gs.phase === 'playing';
    root.querySelectorAll('.stl-btn').forEach(b => {
      b.disabled = !canAct;
    });
    if (mySubmitted) {
      root.querySelectorAll('.stl-btn').forEach(b => b.classList.add('submitted'));
    } else {
      root.querySelectorAll('.stl-btn').forEach(b => b.classList.remove('submitted'));
    }

    // Remote panel
    if (gs.effects.remoteActive && gs.effects.remoteController === myKey) {
      remotePanel.style.display = 'block';
      remoteTimerEl.textContent = `${gs.effects.remoteTimeLeft}s remaining`;
    } else {
      remotePanel.style.display = 'none';
      if (remoteSlider.value !== '0') remoteSlider.value = 0;
    }
  }

  function updateEventLog() {
    eventLogEl.innerHTML = gs.events.slice(0, 5).map(e => {
      const color = e.type === 'danger' ? '#cc4444' : e.type === 'warning' ? '#cc8833' : '#444';
      return `<div style="color:${color};padding:2px 0;border-bottom:1px solid #111;">${escHtml(e.message)}</div>`;
    }).join('');
  }

  function checkOverlays() {
    if (gs.players[myKey].status === 'caught') {
      caughtOverlay.style.display = 'flex';
      if (!caughtInterval) {
        caughtInterval = setInterval(() => {
          const intensity = 0.2 + Math.random() * 0.8;
          const duration  = 500 + Math.random() * 3000;
          haptics.pulse(intensity, duration);
        }, 1000 + Math.random() * 2000);
      }
    }

    const isBlind = gs.effects.blind[myKey] > 0;
    blindOverlay.style.display = isBlind ? 'flex' : 'none';
  }

  function handleHaptic() {
    const h = gs.effects.pendingHaptic;
    if (!h) return;
    if (h.target === myKey) haptics.pulse(h.intensity, h.duration);
    gs.effects.pendingHaptic = null;
  }

  function fullRender() {
    updateHud();
    updateEventLog();
    checkOverlays();
    handleHaptic();
    if (gs.phase === 'ended') showEndScreen();
  }

  // ── Actions ──────────────────────────────────────────────────────────
  function sendAction(action) {
    if (gs.pendingIntents[myKey] !== null) return; // already submitted this round
    if (gs.players[myKey].status !== 'active') return;
    socket.send({ type: MSG.STL_ACTION, action });
    submitIntent(gs, action, myKey, rng);
    fullRender();
  }

  // ── Remote slider ─────────────────────────────────────────────────────
  remoteSlider.addEventListener('input', () => {
    pendingRemoteIntensity = parseInt(remoteSlider.value, 10);
    if (remoteRaf) return;
    remoteRaf = requestAnimationFrame(() => {
      remoteRaf = 0;
      socket.send({ type: MSG.STL_REMOTE_INTENSITY, intensity: pendingRemoteIntensity });
    });
  });

  // ── Button listeners ──────────────────────────────────────────────────
  root.addEventListener('click', (e) => {
    const dirBtn = e.target.closest('[data-dir]');
    if (dirBtn) { sendAction({ type: 'move', dir: dirBtn.dataset.dir, actor: myKey }); return; }
    if (e.target.id === 'stl-wait-btn') { sendAction({ type: 'wait', actor: myKey }); return; }
    if (e.target.id === 'stl-remote-btn') { sendAction({ type: 'remote', actor: myKey }); return; }
  });

  function onKey(e) {
    if (gs.phase !== 'playing') return;
    const map = { ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right',
                  w:'up', s:'down', a:'left', d:'right' };
    if (map[e.key]) { e.preventDefault(); sendAction({ type: 'move', dir: map[e.key], actor: myKey }); }
    if (e.key === ' ') { e.preventDefault(); sendAction({ type: 'wait', actor: myKey }); }
    if (e.key === 'r' || e.key === 'R') { sendAction({ type: 'remote', actor: myKey }); }
  }
  window.addEventListener('keydown', onKey);

  // ── WebSocket events ──────────────────────────────────────────────────
  const onStlAction = (ev) => {
    const action = ev.detail.action;
    if (!action || action.actor === myKey) return;
    submitIntent(gs, action, action.actor, rng);
    fullRender();
  };

  const onStlRemoteIntensity = (ev) => {
    if (gs.effects.remoteActive && gs.effects.remoteTarget === myKey) {
      haptics.testVibe(ev.detail.intensity / 100);
    }
  };

  const onPeerLeft = () => {
    eventLogEl.insertAdjacentHTML(
      'afterbegin',
      '<div style="color:#ff4444;padding:2px 0;">Your opponent disconnected.</div>'
    );
  };

  socket.addEventListener(MSG.STL_ACTION, onStlAction);
  socket.addEventListener(MSG.STL_REMOTE_INTENSITY, onStlRemoteIntensity);
  socket.addEventListener(MSG.PEER_LEFT, onPeerLeft);

  // ── Cleanup ───────────────────────────────────────────────────────────
  const cleanup = () => {
    socket.removeEventListener(MSG.STL_ACTION, onStlAction);
    socket.removeEventListener(MSG.STL_REMOTE_INTENSITY, onStlRemoteIntensity);
    socket.removeEventListener(MSG.PEER_LEFT, onPeerLeft);
    window.removeEventListener('keydown', onKey);
    if (caughtInterval) { clearInterval(caughtInterval); caughtInterval = null; }
    if (guardAnimFrame) { cancelAnimationFrame(guardAnimFrame); guardAnimFrame = null; }
    haptics.testVibe(0);
    haptics.stopAll();
    const s = document.querySelector('style[data-stl]');
    if (s) s.remove();
    vibeModeBarInstance.destroy();
  };
  window.addEventListener('hashchange', cleanup, { once: true });

  // ── End screen ────────────────────────────────────────────────────────
  function showEndScreen() {
    if (caughtInterval) { clearInterval(caughtInterval); caughtInterval = null; }
    if (guardAnimFrame) { cancelAnimationFrame(guardAnimFrame); guardAnimFrame = null; }
    haptics.testVibe(0);
    haptics.stopAll();

    const { outcome, forfeits } = resolveForfeits(gs);
    const outcomeText = {
      '2_winners': 'Both players escaped with the loot.',
      'a_wins': `${gs.playerNames.A} wins — escaped with the loot.`,
      'b_wins': `${gs.playerNames.B} wins — escaped with the loot.`,
      '2_losers': 'Both players lose.',
    }[outcome] || outcome;

    const myResult = outcome === '2_winners' ? 'win'
      : outcome === 'a_wins' ? (myKey === 'A' ? 'win' : 'lose')
      : outcome === 'b_wins' ? (myKey === 'B' ? 'win' : 'lose')
      : 'lose';

    if (myResult === 'win') haptics.winPattern();
    else haptics.losePattern();

    const A = gs.players.A;
    const B = gs.players.B;

    const cardListHtml = (cards) => cards.length
      ? cards.map(c =>
          `<div style="background:#1a1a3a;border:1px solid #2a2a5a;border-radius:6px;padding:8px;font-size:12px;">
            <div style="color:${COLORS.loot};font-weight:bold;">${escHtml(c.name)}</div>
            <div style="color:#555;margin-top:3px;">${escHtml(c.desc || '')}</div>
          </div>`).join('')
      : '<div style="color:#333;font-size:12px;">No claim cards</div>';

    const forfeitsHtml = forfeits.length
      ? forfeits.map((f, i) => `
          <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;margin-bottom:6px;">
            <input type="checkbox" id="fc-${i}" style="margin-top:3px;">
            <span style="color:#bbb;font-size:13px;">${escHtml(f.desc)}</span>
          </label>`).join('')
      : '<div style="color:#444;font-size:13px;">No forfeits</div>';

    const hasControl = forfeits.some(f => f.card === 'control');
    const controlPanel = hasControl ? `
      <div style="margin-top:8px;background:#111;border:1px solid #4affce33;border-radius:6px;padding:12px;">
        <div style="color:#4affce;font-size:12px;margin-bottom:6px;">CONTROL FORFEIT — 60 seconds</div>
        <input type="range" id="stl-end-remote" min="0" max="100" value="0" style="width:100%;">
        <div id="stl-control-timer" style="font-size:11px;color:#555;margin-top:4px;">Press Start to begin</div>
        <button id="stl-control-start" style="margin-top:8px;padding:8px 16px;background:#1a3a3a;
          border:1px solid #4affce;border-radius:4px;color:#4affce;cursor:pointer;font-size:13px;">
          Start 60s Control
        </button>
      </div>` : '';

    endScreen.innerHTML = `
      <div style="max-width:480px;width:100%;display:flex;flex-direction:column;gap:14px;">
        <div style="text-align:center;font-size:18px;color:${myResult === 'win' ? COLORS.loot : '#cc4444'};
          padding:12px;border:1px solid ${myResult === 'win' ? '#c9a84c44' : '#cc444433'};border-radius:8px;">
          ${escHtml(outcomeText)}
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1;background:#111;border:1px solid #1e1e38;border-radius:6px;padding:10px;">
            <div style="color:${COLORS.playerA};font-size:12px;margin-bottom:6px;">${escHtml(gs.playerNames.A)} — ${A.loot}pt</div>
            <div style="display:flex;flex-direction:column;gap:4px;">${cardListHtml(A.cards)}</div>
          </div>
          <div style="flex:1;background:#111;border:1px solid #1e1e38;border-radius:6px;padding:10px;">
            <div style="color:${COLORS.playerB};font-size:12px;margin-bottom:6px;">${escHtml(gs.playerNames.B)} — ${B.loot}pt</div>
            <div style="display:flex;flex-direction:column;gap:4px;">${cardListHtml(B.cards)}</div>
          </div>
        </div>
        <div style="background:#111;border:1px solid #1e1e38;border-radius:6px;padding:12px;">
          <div style="font-size:12px;color:#555;margin-bottom:8px;letter-spacing:2px;">FORFEITS</div>
          ${forfeitsHtml}
        </div>
        ${controlPanel}
        <div style="display:flex;gap:8px;justify-content:center;padding-bottom:24px;">
          <button id="stl-play-again" style="padding:12px 28px;background:#1a1a3a;
            border:1px solid #3a3a6a;border-radius:6px;color:#aaf;cursor:pointer;
            font-size:15px;font-family:monospace;">Play Again</button>
          <button id="stl-leave" style="padding:12px 28px;background:transparent;
            border:1px solid #333;border-radius:6px;color:#666;cursor:pointer;
            font-size:15px;font-family:monospace;">Leave</button>
        </div>
      </div>
    `;

    endScreen.style.display = 'flex';

    if (hasControl) {
      let controlInterval = null;
      const controlSlider = endScreen.querySelector('#stl-end-remote');
      const controlTimer  = endScreen.querySelector('#stl-control-timer');
      const controlStart  = endScreen.querySelector('#stl-control-start');

      controlSlider.addEventListener('input', () => {
        socket.send({ type: MSG.STL_REMOTE_INTENSITY, intensity: parseInt(controlSlider.value, 10) });
      });

      controlStart.addEventListener('click', () => {
        let remaining = 60;
        controlStart.disabled = true;
        controlTimer.textContent = `${remaining}s remaining`;
        controlInterval = setInterval(() => {
          remaining--;
          controlTimer.textContent = `${remaining}s remaining`;
          if (remaining <= 0) {
            clearInterval(controlInterval);
            socket.send({ type: MSG.STL_REMOTE_INTENSITY, intensity: 0 });
            controlSlider.value = 0;
            controlTimer.textContent = 'Done';
          }
        }, 1000);
      });
    }

    const startNewGame = (newSeed) => {
      cleanup();
      vibeModeBarInstance = initVibeModeBar(root);
      state.seed = newSeed;
      gs = createGameState(newSeed, state.stlDifficulty, state.stlForfeitCards, playerNames);
      endScreen.style.display = 'none';
      caughtOverlay.style.display = 'none';
      startRenderLoop();
      fullRender();
      socket.addEventListener(MSG.STL_ACTION, onStlAction);
      socket.addEventListener(MSG.STL_REMOTE_INTENSITY, onStlRemoteIntensity);
      socket.addEventListener(MSG.PEER_LEFT, onPeerLeft);
      window.addEventListener('keydown', onKey);
      window.addEventListener('hashchange', cleanup, { once: true });
    };

    endScreen.querySelector('#stl-play-again').addEventListener('click', () => {
      if (state.role === 'host') {
        socket.send({ type: MSG.STL_NEW_SEED });
        // Server generates and broadcasts the seed back to both players
        const onNewSeed = (ev) => {
          socket.removeEventListener(MSG.STL_NEW_SEED, onNewSeed);
          startNewGame(ev.detail.seed);
        };
        socket.addEventListener(MSG.STL_NEW_SEED, onNewSeed);
      } else {
        const btn = endScreen.querySelector('#stl-play-again');
        btn.disabled = true;
        btn.textContent = 'Waiting for host…';
        const onNewSeed = (ev) => {
          socket.removeEventListener(MSG.STL_NEW_SEED, onNewSeed);
          startNewGame(ev.detail.seed);
        };
        socket.addEventListener(MSG.STL_NEW_SEED, onNewSeed);
      }
    });

    endScreen.querySelector('#stl-leave').addEventListener('click', () => {
      cleanup();
      navigate('#/');
    });
  }

  // ── Start ─────────────────────────────────────────────────────────────
  startRenderLoop();
  fullRender();
}
