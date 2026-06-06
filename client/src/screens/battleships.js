import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';

const SHIPS = [
  { id: 'carrier',    name: 'Carrier',    size: 5 },
  { id: 'battleship', name: 'Battleship', size: 4 },
  { id: 'cruiser',    name: 'Cruiser',    size: 3 },
  { id: 'submarine',  name: 'Submarine',  size: 3 },
  { id: 'destroyer',  name: 'Destroyer',  size: 2 },
];
const COLS = 'ABCDEFGHIJ';
const G = 10;

export function renderBattleships(root) {
  const myRole = state.role;
  function nameFor(r) {
    return r === 'host' ? (state.hostName || 'Host') : (state.guestName || 'Guest');
  }
  const oppRole = myRole === 'host' ? 'guest' : 'host';

  // ── Game state ───────────────────────────────────────────────────────────
  const myGrid    = Array.from({length: G}, () => Array(G).fill(null)); // ship id or null
  const myDamage  = Array.from({length: G}, () => Array(G).fill(null)); // 'hit' | 'miss' | null
  const oppShots  = Array.from({length: G}, () => Array(G).fill(null)); // 'hit' | 'miss' | 'pending' | null
  const placed    = {};    // id → {cells:[{r,c}]}
  const shipHp    = {};    // mine: id → remaining hp
  const oppHp     = {};    // opp: id → remaining hp
  SHIPS.forEach(s => { shipHp[s.id] = s.size; oppHp[s.id] = s.size; });

  let selectedId   = null;
  let orient       = 'h';
  let previewCells = [];
  let myReadySent  = false;
  let oppReady     = false;
  let isMyTurn     = myRole === 'host';
  let gameOver     = false;
  let iWon         = false;
  let phase        = 'placement';

  // ── Root scaffold ─────────────────────────────────────────────────────────
  root.innerHTML = `
    <div class="bs-root" id="bs-root">
      <div class="bs-header">
        <button class="ghost" id="bs-leave" style="padding:6px 14px;font-size:13px;">← Leave</button>
        <div class="bs-title" id="bs-title">Battleships — Place Your Fleet</div>
        <button id="bs-vibe-btn" class="ghost" style="font-size:13px;padding:6px 12px;">${haptics.isConnected() ? '📳' : 'Connect Vibe'}</button>
      </div>
      <div id="bs-content" class="bs-content"></div>
    </div>`;

  const titleEl   = root.querySelector('#bs-title');
  const contentEl = root.querySelector('#bs-content');

  // ── Grid rendering ────────────────────────────────────────────────────────
  function buildGridHTML(mode) {
    // mode: 'place' | 'my' | 'opp'
    let h = `<div class="bs-corner"></div>`;
    for (let c = 0; c < G; c++) h += `<div class="bs-ghdr">${COLS[c]}</div>`;
    for (let r = 0; r < G; r++) {
      h += `<div class="bs-ghdr">${r + 1}</div>`;
      for (let c = 0; c < G; c++) {
        let cls = 'bs-cell';
        if (mode === 'place') {
          const sid = myGrid[r][c];
          if (sid) cls += ` bs-ship-${sid}`;
          if (previewCells.some(p => p.r === r && p.c === c)) cls += ' bs-preview';
        } else if (mode === 'my') {
          const sid = myGrid[r][c];
          const dmg = myDamage[r][c];
          if (dmg === 'hit')       cls += ' bs-hit';
          else if (dmg === 'miss') cls += ' bs-miss-splash';
          else if (sid)            cls += ` bs-ship-${sid}`;
        } else {
          const shot = oppShots[r][c];
          if (shot === 'hit')         cls += ' bs-hit';
          else if (shot === 'miss')   cls += ' bs-miss';
          else if (shot === 'pending') cls += ' bs-pending';
          else if (isMyTurn && !gameOver) cls += ' bs-target';
        }
        h += `<div class="${cls}" data-r="${r}" data-c="${c}"></div>`;
      }
    }
    return h;
  }

  // ── PLACEMENT PHASE ───────────────────────────────────────────────────────
  function renderPlacement() {
    const allPlaced = SHIPS.every(s => s.id in placed);
    contentEl.innerHTML = `
      <div class="bs-placement">
        <div class="bs-ship-list">
          <div class="bs-list-title">Your Fleet</div>
          ${SHIPS.map(s => `
            <div class="bs-ship-item${s.id in placed ? ' bs-placed' : ''}${selectedId === s.id ? ' bs-selected' : ''}" data-ship="${s.id}">
              <div class="bs-ship-preview">${Array(s.size).fill(`<div class="bs-sp-cell bs-ship-${s.id}"></div>`).join('')}</div>
              <span class="bs-ship-name">${s.name} (${s.size})</span>
            </div>`).join('')}
          <div class="bs-orient-hint" id="bs-orient-hint">
            <span class="bs-orient-key">R</span> to rotate — <span id="bs-orient-label">${orient === 'h' ? 'Horizontal →' : 'Vertical ↓'}</span>
          </div>
        </div>
        <div class="bs-grid-wrap">
          <div class="bs-grid-label">Your Grid</div>
          <div class="bs-grid-outer" id="bs-place-grid">${buildGridHTML('place')}</div>
          <button id="bs-ready-btn" ${allPlaced && !myReadySent ? '' : 'disabled'}
            style="margin-top:14px;width:100%;">
            ${myReadySent ? 'Waiting for opponent…' : 'Ready!'}
          </button>
        </div>
      </div>`;
    attachPlacementEvents();
  }

  function getPlacementCells(r, c, sid, ori) {
    const ship = SHIPS.find(s => s.id === sid);
    if (!ship) return null;
    const cells = [];
    for (let i = 0; i < ship.size; i++) {
      const nr = r + (ori === 'v' ? i : 0);
      const nc = c + (ori === 'h' ? i : 0);
      if (nr >= G || nc >= G) return null;
      cells.push({r: nr, c: nc});
    }
    return cells;
  }

  function attachPlacementEvents() {
    const gridEl   = contentEl.querySelector('#bs-place-grid');
    const shipList = contentEl.querySelector('.bs-ship-list');
    const readyBtn = contentEl.querySelector('#bs-ready-btn');

    shipList.addEventListener('click', (e) => {
      const item = e.target.closest('[data-ship]');
      if (!item || myReadySent) return;
      const id = item.dataset.ship;
      if (id in placed) {
        placed[id].cells.forEach(({r, c}) => { myGrid[r][c] = null; });
        delete placed[id];
      }
      selectedId = selectedId === id ? null : id;
      renderPlacement();
    });

    gridEl.addEventListener('mouseover', (e) => {
      const cell = e.target.closest('[data-r]');
      if (!cell || !selectedId) return;
      previewCells = getPlacementCells(+cell.dataset.r, +cell.dataset.c, selectedId, orient) || [];
      refreshPreview(gridEl);
    });
    gridEl.addEventListener('mouseleave', () => {
      previewCells = [];
      refreshPreview(gridEl);
    });

    gridEl.addEventListener('click', (e) => {
      if (myReadySent || !selectedId) return;
      const cell = e.target.closest('[data-r]');
      if (!cell) return;
      const r = +cell.dataset.r, c = +cell.dataset.c;
      const cells = getPlacementCells(r, c, selectedId, orient);
      if (!cells) return;
      // Remove existing placement of this ship
      if (placed[selectedId]) {
        placed[selectedId].cells.forEach(({r, c}) => { myGrid[r][c] = null; });
        delete placed[selectedId];
      }
      // Check overlap
      if (cells.some(({r, c}) => myGrid[r][c] !== null)) return;
      cells.forEach(({r, c}) => { myGrid[r][c] = selectedId; });
      placed[selectedId] = {cells};
      selectedId = null;
      previewCells = [];
      renderPlacement();
    });

    gridEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      toggleOrient();
    });

    if (readyBtn && !myReadySent) {
      readyBtn.addEventListener('click', () => {
        if (!SHIPS.every(s => s.id in placed)) return;
        myReadySent = true;
        socket.send({ type: MSG.BS_READY });
        readyBtn.disabled = true;
        readyBtn.textContent = 'Waiting for opponent…';
        if (oppReady) startBattle();
      });
    }
  }

  function refreshPreview(gridEl) {
    gridEl.querySelectorAll('[data-r]').forEach(el => {
      const r = +el.dataset.r, c = +el.dataset.c;
      el.classList.toggle('bs-preview', previewCells.some(p => p.r === r && p.c === c));
    });
  }

  function toggleOrient() {
    orient = orient === 'h' ? 'v' : 'h';
    const lbl = contentEl.querySelector('#bs-orient-label');
    if (lbl) lbl.textContent = orient === 'h' ? 'Horizontal →' : 'Vertical ↓';
  }

  // ── BATTLE PHASE ──────────────────────────────────────────────────────────
  function renderBattle() {
    phase = 'battle';
    titleEl.textContent = `Battleships — vs ${nameFor(oppRole)}`;
    const oppSunk = SHIPS.filter(s => oppHp[s.id] === 0).length;
    const mySunk  = SHIPS.filter(s => shipHp[s.id] === 0).length;

    contentEl.innerHTML = `
      <div class="bs-battle">
        <div class="bs-status-bar">
          <span id="bs-status">${isMyTurn ? '🎯 Your turn — pick a target' : `⏳ ${nameFor(oppRole)}'s turn…`}</span>
          <span class="bs-sink-count" id="bs-sinks">You sunk ${oppSunk}/5 · They sunk ${mySunk}/5</span>
        </div>
        <div class="bs-grids">
          <div class="bs-grid-section">
            <div class="bs-grid-label">Your Waters</div>
            <div class="bs-grid-outer" id="bs-my-grid">${buildGridHTML('my')}</div>
          </div>
          <div class="bs-grid-section">
            <div class="bs-grid-label">${nameFor(oppRole)}'s Waters</div>
            <div class="bs-grid-outer" id="bs-opp-grid">${buildGridHTML('opp')}</div>
          </div>
        </div>
      </div>`;
    attachBattleEvents();
  }

  function attachBattleEvents() {
    const oppGridEl = contentEl.querySelector('#bs-opp-grid');
    if (!oppGridEl) return;
    oppGridEl.addEventListener('click', (e) => {
      if (!isMyTurn || gameOver) return;
      const cell = e.target.closest('[data-r]');
      if (!cell) return;
      const r = +cell.dataset.r, c = +cell.dataset.c;
      if (oppShots[r][c] !== null) return;
      isMyTurn = false;
      oppShots[r][c] = 'pending';
      socket.send({ type: MSG.BS_SHOT, r, c });
      setStatus(`Fired at ${COLS[c]}${r + 1}…`);
      refreshBattleGrid('opp');
    });
  }

  function refreshBattleGrid(which) {
    const el = contentEl.querySelector(which === 'opp' ? '#bs-opp-grid' : '#bs-my-grid');
    if (!el) return;
    el.innerHTML = buildGridHTML(which);
    if (which === 'opp') attachBattleEvents();
    updateSinkCount();
  }

  function setStatus(text) {
    const el = contentEl.querySelector('#bs-status');
    if (el) el.textContent = text;
  }

  function updateSinkCount() {
    const el = contentEl.querySelector('#bs-sinks');
    if (!el) return;
    const oppSunk = SHIPS.filter(s => oppHp[s.id] === 0).length;
    const mySunk  = SHIPS.filter(s => shipHp[s.id] === 0).length;
    el.textContent = `You sunk ${oppSunk}/5 · They sunk ${mySunk}/5`;
  }

  // ── RESULT PHASE ──────────────────────────────────────────────────────────
  function renderResult() {
    phase = 'result';
    gameOver = true;
    haptics.stopAll();
    const oppName = nameFor(oppRole);

    if (iWon) {
      contentEl.innerHTML = `
        <div class="bs-result">
          <div class="bs-result-icon">🏆</div>
          <div class="bs-result-title">Victory!</div>
          <div class="bs-result-sub">You sank all of ${escHtml(oppName)}'s ships!</div>
          <div class="bs-vibe-ctrl-panel">
            <div class="bs-vibe-ctrl-title">Control ${escHtml(oppName)}'s Vibe</div>
            <div class="forfeit-slider-row" style="margin:16px 0;">
              <span>Intensity</span>
              <input type="range" id="bs-intensity" min="0" max="100" value="80" style="flex:1;margin:0 12px;">
              <span id="bs-intensity-pct">80%</span>
            </div>
            <div class="bs-pattern-row">
              <span>Pattern:</span>
              <div class="mm-rounds-btns" id="bs-pattern-btns">
                <button class="mm-rounds-btn mm-rounds-selected" data-pat="steady">Steady</button>
                <button class="mm-rounds-btn ghost" data-pat="wave">Wave</button>
                <button class="mm-rounds-btn ghost" data-pat="pulse">Pulse</button>
              </div>
            </div>
          </div>
          <button id="bs-end-btn" style="margin-top:24px;background:var(--warn);color:#fff;">End Game → Lobby</button>
        </div>`;

      let curPattern = 'steady';
      const slider  = contentEl.querySelector('#bs-intensity');
      const pctEl   = contentEl.querySelector('#bs-intensity-pct');
      const patBtns = contentEl.querySelector('#bs-pattern-btns');

      // Start the loser's vibe immediately
      socket.send({ type: MSG.BS_VIBE_CTRL, intensity: 0.8, pattern: 'steady' });

      slider.addEventListener('input', () => {
        const level = slider.value / 100;
        if (pctEl) pctEl.textContent = `${slider.value}%`;
        socket.send({ type: MSG.BS_VIBE_CTRL, intensity: level, pattern: curPattern });
      });

      patBtns.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-pat]');
        if (!btn) return;
        curPattern = btn.dataset.pat;
        patBtns.querySelectorAll('[data-pat]').forEach(b => {
          b.classList.toggle('mm-rounds-selected', b.dataset.pat === curPattern);
          b.classList.toggle('ghost', b.dataset.pat !== curPattern);
        });
        socket.send({ type: MSG.BS_VIBE_CTRL, intensity: slider.value / 100, pattern: curPattern });
      });

      contentEl.querySelector('#bs-end-btn').addEventListener('click', () => {
        socket.send({ type: MSG.BS_VIBE_CTRL, intensity: 0, pattern: 'steady' });
        socket.send({ type: MSG.BS_END });
        goLobby();
      });

    } else {
      contentEl.innerHTML = `
        <div class="bs-result bs-result-defeat">
          <div class="bs-result-icon">💔</div>
          <div class="bs-result-title">Defeated</div>
          <div class="bs-result-sub">${escHtml(nameFor(oppRole))} sank all your ships!</div>
          <div class="bs-vibe-status">
            <div class="bs-vibe-status-icon">📳</div>
            <div id="bs-vibe-label">Waiting for ${escHtml(nameFor(oppRole))} to take control…</div>
          </div>
          <div class="bs-waiting-hint">Waiting for ${escHtml(nameFor(oppRole))} to end the game…</div>
        </div>`;
    }
  }

  function goLobby() {
    haptics.stopAll();
    state.myFinal = null;
    state.oppFinal = null;
    state.seed = null;
    navigate(`#/session/${state.sessionId}`);
  }

  function startBattle() {
    renderBattle();
  }

  // ── Socket handlers ───────────────────────────────────────────────────────
  const onBsReady = () => {
    oppReady = true;
    if (myReadySent) startBattle();
  };

  const onBsShot = (ev) => {
    const { r, c } = ev.detail;
    const sid  = myGrid[r][c];
    const hit  = sid !== null;

    if (hit) {
      myDamage[r][c] = 'hit';
      shipHp[sid]--;
      const sunk    = shipHp[sid] === 0;
      const allGone = SHIPS.every(s => shipHp[s.id] === 0);

      // Stacking 15s wave vibe for each hit received
      if (haptics.getForfeitSeconds() > 0) {
        haptics.addForfeitSeconds(15);
      } else {
        haptics.startForfeitVibe(15);
        haptics.setWaveVibeMode(true);
      }

      socket.send({ type: MSG.BS_RESULT, r, c, hit: true, sunk, sunkId: sunk ? sid : null, gameOver: allGone });

      if (allGone) {
        iWon = false;
        gameOver = true;
        if (phase === 'battle') { refreshBattleGrid('my'); }
        setTimeout(() => renderResult(), 600);
        return;
      }
    } else {
      myDamage[r][c] = 'miss';
      socket.send({ type: MSG.BS_RESULT, r, c, hit: false, sunk: false, sunkId: null, gameOver: false });
    }

    if (phase === 'battle') {
      isMyTurn = true;
      refreshBattleGrid('my');
      setStatus('🎯 Your turn — pick a target');
    }
  };

  const onBsResult = (ev) => {
    const { r, c, hit, sunk, sunkId, gameOver: allGone } = ev.detail;
    oppShots[r][c] = hit ? 'hit' : 'miss';

    if (hit) {
      if (sunk && sunkId) {
        oppHp[sunkId] = 0;
        const sname = SHIPS.find(s => s.id === sunkId)?.name || sunkId;
        setStatus(`💥 Hit! You sank their ${sname}!`);
      } else {
        setStatus('💥 Hit!');
      }
    } else {
      setStatus('🌊 Miss!');
      haptics.pulse(0.3, 150);
    }

    if (allGone) {
      iWon = true;
      gameOver = true;
      if (phase === 'battle') { refreshBattleGrid('opp'); }
      setTimeout(() => renderResult(), 600);
      return;
    }

    isMyTurn = false;
    if (phase === 'battle') {
      refreshBattleGrid('opp');
      setTimeout(() => setStatus(`⏳ ${nameFor(oppRole)}'s turn…`), 1400);
    }
  };

  const onBsVibeCtrl = (ev) => {
    if (iWon) return;
    const { intensity, pattern } = ev.detail;

    if (intensity === 0) {
      haptics.stopAll();
      const lbl = contentEl.querySelector('#bs-vibe-label');
      if (lbl) lbl.textContent = 'Vibe stopped';
      return;
    }

    if (haptics.getForfeitSeconds() <= 0) {
      haptics.startForfeitVibe(600);
    }
    haptics.setForfeitIntensity(intensity);
    haptics.setWaveVibeMode(pattern === 'wave' || pattern === 'pulse');

    const lbl = contentEl.querySelector('#bs-vibe-label');
    if (lbl) lbl.textContent = `${Math.round(intensity * 100)}% intensity · ${pattern}`;
  };

  const onBsEnd = () => {
    haptics.stopAll();
    goLobby();
  };

  const onPeerLeft = () => {
    haptics.stopAll();
    root.innerHTML = `
      <div class="card">
        <h2>A player left</h2>
        <div class="actions"><button id="bs-peer-home">Home</button></div>
      </div>`;
    root.querySelector('#bs-peer-home').addEventListener('click', () => { location.hash = '#/'; });
  };

  socket.addEventListener(MSG.BS_READY,     onBsReady);
  socket.addEventListener(MSG.BS_SHOT,      onBsShot);
  socket.addEventListener(MSG.BS_RESULT,    onBsResult);
  socket.addEventListener(MSG.BS_VIBE_CTRL, onBsVibeCtrl);
  socket.addEventListener(MSG.BS_END,       onBsEnd);
  socket.addEventListener(MSG.PEER_LEFT,    onPeerLeft);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  const onKey = (e) => {
    if ((e.key === 'r' || e.key === 'R') && phase === 'placement') toggleOrient();
  };
  document.addEventListener('keydown', onKey);

  // ── Vibe button ───────────────────────────────────────────────────────────
  root.querySelector('#bs-vibe-btn').addEventListener('click', async () => {
    if (haptics.isConnected()) return;
    const btn = root.querySelector('#bs-vibe-btn');
    btn.textContent = 'Connecting…';
    btn.disabled = true;
    try {
      const dev = await haptics.connect();
      btn.textContent = dev ? `📳 ${dev.name}` : 'No device';
      btn.disabled = !!dev;
    } catch {
      btn.textContent = 'Connect Vibe';
      btn.disabled = false;
    }
  });

  root.querySelector('#bs-leave').addEventListener('click', goLobby);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  window.addEventListener('hashchange', () => {
    document.removeEventListener('keydown', onKey);
    socket.removeEventListener(MSG.BS_READY,     onBsReady);
    socket.removeEventListener(MSG.BS_SHOT,      onBsShot);
    socket.removeEventListener(MSG.BS_RESULT,    onBsResult);
    socket.removeEventListener(MSG.BS_VIBE_CTRL, onBsVibeCtrl);
    socket.removeEventListener(MSG.BS_END,       onBsEnd);
    socket.removeEventListener(MSG.PEER_LEFT,    onPeerLeft);
    haptics.stopAll();
  }, { once: true });

  // ── Start ─────────────────────────────────────────────────────────────────
  renderPlacement();
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
