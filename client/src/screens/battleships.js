import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';

const SHIPS_STANDARD = [
  { id: 'carrier',     name: 'Carrier',       size: 5 },
  { id: 'battleship',  name: 'Battleship',    size: 4 },
  { id: 'cruiser',     name: 'Cruiser',       size: 3 },
  { id: 'submarine',   name: 'Submarine',     size: 3 },
  { id: 'destroyer',   name: 'Destroyer',     size: 2 },
];
const SHIPS_LARGE = [
  { id: 'dreadnought', name: 'Dreadnought',   size: 6 },
  { id: 'carrier',     name: 'Carrier',       size: 5 },
  { id: 'battleship',  name: 'Battleship',    size: 4 },
  { id: 'battleship2', name: 'Battleship II', size: 4 },
  { id: 'cruiser',     name: 'Cruiser',       size: 3 },
  { id: 'cruiser2',    name: 'Cruiser II',    size: 3 },
  { id: 'submarine',   name: 'Submarine',     size: 3 },
  { id: 'destroyer',   name: 'Destroyer',     size: 2 },
  { id: 'patrol',      name: 'Patrol Boat',   size: 2 },
];
const COLS_ALL = 'ABCDEFGHIJKLMN';
const POWERUPS_DEF = [
  { id: 'torpedo', name: 'Torpedo',      icon: '🚀', desc: '3-in-a-line shot' },
  { id: 'depth',   name: 'Depth Charge', icon: '💣', desc: '+ cross pattern'  },
  { id: 'sonar',   name: 'Sonar',        icon: '📡', desc: '3×3 scan (free)'  },
];

export function renderBattleships(root) {
  const myRole   = state.role;
  const oppRole  = myRole === 'host' ? 'guest' : 'host';
  const G        = state.bsGridSize === 'large' ? 14 : 10;
  const COLS     = COLS_ALL.slice(0, G);
  const SHIPS    = state.bsGridSize === 'large' ? SHIPS_LARGE : SHIPS_STANDARD;
  const MULT     = state.bsVibeMultiplier ?? 1.5;
  const isLarge  = G === 14;

  function nameFor(r) {
    return r === 'host' ? (state.hostName || 'Host') : (state.guestName || 'Guest');
  }

  // ── State ─────────────────────────────────────────────────────────────────
  const myGrid   = Array.from({length: G}, () => Array(G).fill(null));
  const myDamage = Array.from({length: G}, () => Array(G).fill(null)); // 'hit'|'miss'|null
  const oppShots = Array.from({length: G}, () => Array(G).fill(null)); // 'hit'|'miss'|'pending'|null
  const sonarMap = Array.from({length: G}, () => Array(G).fill(null)); // 'ship'|'clear'|null (sonar reveals)
  const placed   = {};
  const shipHp   = {};  // mine
  const oppHp    = {};  // opp
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

  // Power-up state
  const myPu     = { torpedo: 1, depth: 1, sonar: 1 };
  let activePu   = null;  // 'torpedo'|'depth'|'sonar'|null
  let puOrient   = 'h';

  // Miss streak — resets on hit, increments on miss
  let myMissStreak = 0;

  // Opponent vibe tracking (locally approximated — +15s per hit we land)
  let oppVibeSeconds = 0;
  let vibeInterval   = null;

  // ── Root scaffold ──────────────────────────────────────────────────────────
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

  // ── Grid HTML ─────────────────────────────────────────────────────────────
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
          if (dmg === 'hit')        cls += ' bs-hit';
          else if (dmg === 'miss')  cls += ' bs-miss-splash';
          else if (sid)             cls += ` bs-ship-${sid}`;
        } else { // opp
          const shot   = oppShots[r][c];
          const sonar  = sonarMap[r][c];
          if (shot === 'hit')           cls += ' bs-hit';
          else if (shot === 'miss')     cls += ' bs-miss';
          else if (shot === 'pending')  cls += ' bs-pending';
          else if (sonar === 'ship')    cls += ' bs-sonar-ship';
          else if (sonar === 'clear')   cls += ' bs-sonar-clear';
          else if (isMyTurn && !gameOver && activePu !== 'sonar') {
            const puCells = activePu ? getPuCells(activePu, r, c, puOrient) : null;
            if (puCells) cls += ' bs-pu-preview';
            else cls += ' bs-target';
          } else if (isMyTurn && !gameOver && activePu === 'sonar') {
            cls += ' bs-target';
          }
        }
        h += `<div class="${cls}" data-r="${r}" data-c="${c}"></div>`;
      }
    }
    return h;
  }

  function getPuCells(puType, centerR, centerC, ori) {
    const cells = [];
    if (puType === 'torpedo') {
      for (let i = 0; i < 3; i++) {
        const nr = centerR + (ori === 'v' ? i : 0);
        const nc = centerC + (ori === 'h' ? i : 0);
        if (nr >= 0 && nr < G && nc >= 0 && nc < G) cells.push({r: nr, c: nc});
      }
    } else if (puType === 'depth') {
      const cands = [{r:centerR,c:centerC},{r:centerR-1,c:centerC},{r:centerR+1,c:centerC},{r:centerR,c:centerC-1},{r:centerR,c:centerC+1}];
      cands.forEach(p => { if (p.r >= 0 && p.r < G && p.c >= 0 && p.c < G) cells.push(p); });
    } else if (puType === 'sonar') {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const nr = centerR+dr, nc = centerC+dc;
        if (nr >= 0 && nr < G && nc >= 0 && nc < G) cells.push({r: nr, c: nc});
      }
    }
    return cells;
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
          <div class="bs-orient-hint">
            <span class="bs-orient-key">R</span> / right-click to rotate
            — <span id="bs-orient-label">${orient === 'h' ? '→ Horizontal' : '↓ Vertical'}</span>
          </div>
        </div>
        <div class="bs-grid-wrap">
          <div class="bs-grid-label">Your Grid</div>
          <div class="bs-grid-outer${isLarge ? ' bs-large' : ''}" id="bs-place-grid">${buildGridHTML('place')}</div>
          <div class="bs-place-actions">
            <button id="bs-random-btn" class="ghost" ${myReadySent ? 'disabled' : ''}>🎲 Random</button>
            <button id="bs-clear-btn" class="ghost" ${!Object.keys(placed).length || myReadySent ? 'disabled' : ''}>✕ Clear</button>
            <button id="bs-ready-btn" ${allPlaced && !myReadySent ? '' : 'disabled'} style="flex:1;">
              ${myReadySent ? 'Waiting for opponent…' : 'Ready!'}
            </button>
          </div>
        </div>
      </div>`;
    attachPlacementEvents();
  }

  function randomPlacement() {
    SHIPS.forEach(s => {
      if (placed[s.id]) {
        placed[s.id].cells.forEach(({r, c}) => { myGrid[r][c] = null; });
        delete placed[s.id];
      }
    });
    for (const ship of SHIPS) {
      let attempts = 0;
      while (attempts < 200) {
        attempts++;
        const ori = Math.random() < 0.5 ? 'h' : 'v';
        const maxR = ori === 'v' ? G - ship.size : G - 1;
        const maxC = ori === 'h' ? G - ship.size : G - 1;
        const r = Math.floor(Math.random() * (maxR + 1));
        const c = Math.floor(Math.random() * (maxC + 1));
        const cells = getPlacementCells(r, c, ship.id, ori);
        if (!cells) continue;
        if (cells.some(({r, c}) => myGrid[r][c] !== null)) continue;
        cells.forEach(({r, c}) => { myGrid[r][c] = ship.id; });
        placed[ship.id] = {cells};
        break;
      }
    }
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
    const randomBtn = contentEl.querySelector('#bs-random-btn');
    const clearBtn  = contentEl.querySelector('#bs-clear-btn');

    randomBtn?.addEventListener('click', () => {
      if (myReadySent) return;
      selectedId = null;
      previewCells = [];
      randomPlacement();
      renderPlacement();
    });

    clearBtn?.addEventListener('click', () => {
      if (myReadySent) return;
      SHIPS.forEach(s => {
        if (placed[s.id]) {
          placed[s.id].cells.forEach(({r, c}) => { myGrid[r][c] = null; });
          delete placed[s.id];
        }
      });
      selectedId = null;
      previewCells = [];
      renderPlacement();
    });

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
      if (placed[selectedId]) {
        placed[selectedId].cells.forEach(({r, c}) => { myGrid[r][c] = null; });
        delete placed[selectedId];
      }
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
    if (lbl) lbl.textContent = orient === 'h' ? '→ Horizontal' : '↓ Vertical';
  }

  // ── BATTLE PHASE ──────────────────────────────────────────────────────────
  function renderBattle() {
    phase = 'battle';
    titleEl.textContent = `Battleships — vs ${nameFor(oppRole)}`;

    contentEl.innerHTML = `
      <div class="bs-battle">
        <div class="bs-status-bar">
          <span id="bs-status">${isMyTurn ? '🎯 Your turn' : `⏳ ${nameFor(oppRole)}'s turn…`}</span>
          <span class="bs-sink-count" id="bs-sinks">${sinkText()}</span>
        </div>
        <div class="bs-grids">
          <div class="bs-grid-section">
            <div class="bs-grid-meta">
              <span class="bs-grid-label">Your Waters</span>
              <span class="bs-vibe-badge" id="bs-my-vibe" style="display:none">📳 <span id="bs-my-vibe-sec">0</span>s</span>
            </div>
            <div class="bs-grid-outer${isLarge ? ' bs-large' : ''}" id="bs-my-grid">${buildGridHTML('my')}</div>
          </div>
          <div class="bs-grid-section">
            <div class="bs-grid-meta">
              <span class="bs-grid-label">${nameFor(oppRole)}'s Waters</span>
              <span class="bs-vibe-badge bs-vibe-badge-opp" id="bs-opp-vibe" style="display:none">📳 <span id="bs-opp-vibe-sec">0</span>s</span>
            </div>
            <div class="bs-grid-outer${isLarge ? ' bs-large' : ''}" id="bs-opp-grid">${buildGridHTML('opp')}</div>
            <div class="bs-pu-bar" id="bs-pu-bar"></div>
          </div>
        </div>
        <div class="bs-streak" id="bs-streak" style="display:none"></div>
      </div>`;

    renderPuBar();
    attachBattleEvents();
    startVibeInterval();
  }

  function startVibeInterval() {
    if (vibeInterval) clearInterval(vibeInterval);
    vibeInterval = setInterval(() => {
      if (oppVibeSeconds > 0) oppVibeSeconds = Math.max(0, oppVibeSeconds - 1);
      updateVibeBadges();
    }, 1000);
  }

  function updateVibeBadges() {
    const myVibeSec = Math.ceil(haptics.getForfeitSeconds());
    const myBadge   = contentEl.querySelector('#bs-my-vibe');
    const mySecEl   = contentEl.querySelector('#bs-my-vibe-sec');
    if (myBadge) {
      myBadge.style.display = myVibeSec > 0 ? '' : 'none';
      if (mySecEl) mySecEl.textContent = myVibeSec;
    }
    const oppBadge  = contentEl.querySelector('#bs-opp-vibe');
    const oppSecEl  = contentEl.querySelector('#bs-opp-vibe-sec');
    if (oppBadge) {
      oppBadge.style.display = oppVibeSeconds > 0 ? '' : 'none';
      if (oppSecEl) oppSecEl.textContent = oppVibeSeconds;
    }
  }

  function sinkText() {
    return `You sunk ${SHIPS.filter(s => oppHp[s.id] === 0).length}/${SHIPS.length} · They sunk ${SHIPS.filter(s => shipHp[s.id] === 0).length}/${SHIPS.length}`;
  }

  function renderPuBar() {
    const bar = contentEl.querySelector('#bs-pu-bar');
    if (!bar) return;
    bar.innerHTML = POWERUPS_DEF.map(p => `
      <button class="bs-pu-btn${activePu === p.id ? ' bs-pu-active' : ''}" data-pu="${p.id}"
        ${myPu[p.id] === 0 ? 'disabled' : ''} title="${p.desc}">
        ${p.icon} ${p.name} <span class="bs-pu-count">${myPu[p.id]}</span>
        ${p.id === 'torpedo' ? `<span class="bs-pu-orient" id="bs-pu-orient">[${puOrient === 'h' ? '→' : '↓'}]</span>` : ''}
      </button>`).join('');

    bar.querySelectorAll('[data-pu]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.pu;
        if (myPu[id] === 0) return;
        activePu = activePu === id ? null : id;
        renderPuBar();
        refreshBattleGrid('opp');
        if (activePu) {
          setStatus(activePu === 'sonar'
            ? '📡 Sonar: click target area (free action)'
            : activePu === 'torpedo'
              ? `🚀 Torpedo [${puOrient === 'h' ? '→' : '↓'}]: click target (R to rotate)`
              : '💣 Depth Charge: click center target');
        } else {
          setStatus(isMyTurn ? '🎯 Your turn — click to fire' : `⏳ ${nameFor(oppRole)}'s turn…`);
        }
      });
    });
  }

  function attachBattleEvents() {
    const oppGridEl = contentEl.querySelector('#bs-opp-grid');
    if (!oppGridEl) return;

    oppGridEl.addEventListener('click', (e) => {
      if (!isMyTurn || gameOver) return;
      const cell = e.target.closest('[data-r]');
      if (!cell) return;
      const r = +cell.dataset.r, c = +cell.dataset.c;

      if (activePu) {
        handlePowerupFire(r, c);
      } else {
        if (oppShots[r][c] !== null) return;
        isMyTurn = false;
        oppShots[r][c] = 'pending';
        socket.send({ type: MSG.BS_SHOT, r, c });
        setStatus(`Fired at ${COLS[c]}${r + 1}…`);
        refreshBattleGrid('opp');
      }
    });

    oppGridEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (activePu === 'torpedo') {
        puOrient = puOrient === 'h' ? 'v' : 'h';
        renderPuBar();
        setStatus(`🚀 Torpedo [${puOrient === 'h' ? '→' : '↓'}]: click target`);
      }
    });
  }

  function handlePowerupFire(r, c) {
    const pu = activePu;
    if (pu === 'sonar') {
      myPu.sonar = 0;
      activePu = null;
      socket.send({ type: MSG.BS_POWERUP_USE, puType: 'sonar', r, c, orient: 'h' });
      setStatus('📡 Sonar ping sent…');
      renderPuBar();
      // Turn does NOT end for sonar
      return;
    }

    const cells = getPuCells(pu, r, c, puOrient);
    if (!cells.length) return;
    // Mark all cells pending
    let anyNew = false;
    cells.forEach(p => { if (oppShots[p.r][p.c] === null) { oppShots[p.r][p.c] = 'pending'; anyNew = true; } });
    if (!anyNew) return;

    myPu[pu] = 0;
    activePu = null;
    isMyTurn = false;
    socket.send({ type: MSG.BS_POWERUP_USE, puType: pu, r, c, orient: puOrient });
    setStatus(pu === 'torpedo' ? '🚀 Torpedoes away…' : '💣 Depth charge dropped…');
    renderPuBar();
    refreshBattleGrid('opp');
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
    if (el) el.textContent = sinkText();
  }

  function updateStreakDisplay() {
    const el = contentEl.querySelector('#bs-streak');
    if (!el) return;
    if (myMissStreak >= 1) {
      el.style.display = '';
      el.textContent = `🎯 ${myMissStreak} miss streak${myMissStreak >= 3 ? ' — they can really feel it!' : myMissStreak >= 2 ? ' — escalating…' : ''}`;
    } else {
      el.style.display = 'none';
    }
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
            <div class="forfeit-slider-row" style="margin:14px 0 8px;">
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
          <button id="bs-end-btn" style="margin-top:20px;background:var(--warn);color:#fff;">End Game → Lobby</button>
        </div>`;

      let curPattern = 'steady';
      const slider   = contentEl.querySelector('#bs-intensity');
      const pctEl    = contentEl.querySelector('#bs-intensity-pct');
      const patBtns  = contentEl.querySelector('#bs-pattern-btns');

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
    if (vibeInterval) { clearInterval(vibeInterval); vibeInterval = null; }
    haptics.stopAll();
    state.myFinal = null;
    state.oppFinal = null;
    state.seed = null;
    navigate(`#/session/${state.sessionId}`);
  }

  function startBattle() { renderBattle(); }

  // ── Socket handlers ───────────────────────────────────────────────────────
  const onBsReady = () => {
    oppReady = true;
    if (myReadySent) startBattle();
  };

  const onBsShot = (ev) => {
    const { r, c } = ev.detail;
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= G || c < 0 || c >= G) return;
    if (myDamage[r][c]) return; // already resolved — ignore a replayed/duplicate shot
    const sid = myGrid[r][c];
    const hit = sid !== null;

    if (hit) {
      myDamage[r][c] = 'hit';
      shipHp[sid]--;
      const sunk    = shipHp[sid] === 0;
      const allGone = SHIPS.every(s => shipHp[s.id] === 0);

      if (haptics.getForfeitSeconds() > 0) haptics.addForfeitSeconds(15);
      else { haptics.startForfeitVibe(15); haptics.setWaveVibeMode(true); }

      socket.send({ type: MSG.BS_RESULT, r, c, hit: true, sunk, sunkId: sunk ? sid : null, gameOver: allGone });

      if (allGone) {
        iWon = false; gameOver = true;
        if (phase === 'battle') refreshBattleGrid('my');
        setTimeout(() => renderResult(), 600);
        return;
      }
      // Hit but game not over — opponent keeps their turn
      if (phase === 'battle') {
        refreshBattleGrid('my');
        const shipName = SHIPS.find(s => s.id === sid)?.name || sid;
        setStatus(sunk
          ? `💥 Your ${shipName} was sunk! ${nameFor(oppRole)} fires again…`
          : `💥 Hit on your ${shipName}! ${nameFor(oppRole)} fires again…`);
      }
      return;
    } else {
      myDamage[r][c] = 'miss';
      socket.send({ type: MSG.BS_RESULT, r, c, hit: false, sunk: false, sunkId: null, gameOver: false });
    }

    // Miss — my turn
    if (phase === 'battle') {
      isMyTurn = true;
      refreshBattleGrid('my');
      setStatus('🎯 Your turn — click to fire');
    }
  };

  const onBsResult = (ev) => {
    const { r, c, hit, sunk, sunkId, gameOver: allGone } = ev.detail;
    oppShots[r][c] = hit ? 'hit' : 'miss';

    if (hit) {
      myMissStreak = 0;
      if (sunk && sunkId) oppHp[sunkId] = 0;
      oppVibeSeconds += 15;
      updateVibeBadges();
    } else {
      myMissStreak++;
      setStatus('🌊 Miss!');
      applyMissVibe();
    }
    updateStreakDisplay();

    if (allGone) {
      iWon = true; gameOver = true;
      if (phase === 'battle') refreshBattleGrid('opp');
      setTimeout(() => renderResult(), 600);
      return;
    }

    if (hit) {
      // Hit — I keep my turn
      isMyTurn = true;
      if (phase === 'battle') {
        refreshBattleGrid('opp');
        setStatus(sunk && sunkId
          ? `💥 Sank their ${SHIPS.find(s => s.id === sunkId)?.name || sunkId}! Fire again!`
          : '💥 Hit! Fire again!');
      }
    } else {
      // Miss — turn passes
      isMyTurn = false;
      if (phase === 'battle') {
        refreshBattleGrid('opp');
        setTimeout(() => setStatus(`⏳ ${nameFor(oppRole)}'s turn…`), 1200);
      }
    }
  };

  function applyMissVibe() {
    if (MULT <= 0) return;
    const streak = Math.min(myMissStreak, 5);
    const intensity = Math.min(0.25 * MULT * streak, 1.0);
    const durationMs = 120 * streak;
    haptics.pulse(intensity, durationMs);
  }

  // Power-up received: opponent fired a power-up at me
  const onBsPowerupUse = (ev) => {
    const { puType, r, c, orient: ori } = ev.detail;
    const cells = getPuCells(puType, r, c, ori);

    if (puType === 'sonar') {
      // Sonar: reply with ship/clear data, no damage
      const resultCells = cells.map(p => ({
        r: p.r, c: p.c,
        hasShip: myGrid[p.r][p.c] !== null,
      }));
      socket.send({ type: MSG.BS_POWERUP_RESULT, puType: 'sonar', cells: resultCells, gameOver: false });
      return;
    }

    // Attack power-ups: check damage
    let allGone = false;
    const resultCells = [];
    cells.forEach(p => {
      const sid = myGrid[p.r][p.c];
      const hit = sid !== null && myDamage[p.r][p.c] !== 'hit';
      if (hit) {
        myDamage[p.r][p.c] = 'hit';
        shipHp[sid]--;
        const sunk = shipHp[sid] === 0;
        if (sunk && !allGone) allGone = SHIPS.every(s => shipHp[s.id] === 0);
        resultCells.push({ r: p.r, c: p.c, hit: true, sunk, sunkId: sunk ? sid : null });
        if (haptics.getForfeitSeconds() > 0) haptics.addForfeitSeconds(15);
        else { haptics.startForfeitVibe(15); haptics.setWaveVibeMode(true); }
      } else {
        if (!hit) myDamage[p.r][p.c] = myDamage[p.r][p.c] || 'miss';
        resultCells.push({ r: p.r, c: p.c, hit: false, sunk: false, sunkId: null });
      }
    });

    socket.send({ type: MSG.BS_POWERUP_RESULT, puType, cells: resultCells, gameOver: allGone });

    if (allGone) {
      iWon = false; gameOver = true;
      if (phase === 'battle') refreshBattleGrid('my');
      setTimeout(() => renderResult(), 600);
      return;
    }

    const anyHit = resultCells.some(p => p.hit);
    if (phase === 'battle') {
      refreshBattleGrid('my');
      if (!anyHit) {
        // All missed — my turn
        isMyTurn = true;
        setStatus('🎯 Your turn — click to fire');
      }
      // Any hit — opponent keeps their turn, no status change needed
    }
  };

  // Power-up result returned: result of my power-up firing
  const onBsPowerupResult = (ev) => {
    const { puType, cells, gameOver: allGone } = ev.detail;

    if (puType === 'sonar') {
      cells.forEach(p => { sonarMap[p.r][p.c] = p.hasShip ? 'ship' : 'clear'; });
      refreshBattleGrid('opp');
      setStatus('📡 Sonar results shown — your turn continues');
      // Sonar is a free action: turn stays with me
      isMyTurn = true;
      refreshBattleGrid('opp');
      return;
    }

    // Attack result
    let hitCount = 0;
    let missCount = 0;
    cells.forEach(p => {
      oppShots[p.r][p.c] = p.hit ? 'hit' : 'miss';
      if (p.hit) { hitCount++; if (p.sunk && p.sunkId) oppHp[p.sunkId] = 0; }
      else missCount++;
    });

    if (hitCount > 0) {
      myMissStreak = 0;
      oppVibeSeconds += hitCount * 15;
      updateVibeBadges();
    } else {
      myMissStreak += missCount;
      setStatus(`🌊 All ${missCount} missed!`);
      applyMissVibe();
    }
    updateStreakDisplay();

    if (allGone) {
      iWon = true; gameOver = true;
      if (phase === 'battle') refreshBattleGrid('opp');
      setTimeout(() => renderResult(), 600);
      return;
    }

    if (hitCount > 0) {
      // Hit — I keep my turn
      isMyTurn = true;
      if (phase === 'battle') {
        refreshBattleGrid('opp');
        const sunkNames = cells.filter(p => p.sunk && p.sunkId).map(p => SHIPS.find(s => s.id === p.sunkId)?.name).filter(Boolean);
        setStatus(sunkNames.length
          ? `💥 ${hitCount} hit${hitCount>1?'s':''}! Sank: ${sunkNames.join(', ')}! Fire again!`
          : `💥 ${hitCount} hit${hitCount>1?'s':''}! Fire again!`);
      }
    } else {
      // All missed — turn passes
      isMyTurn = false;
      if (phase === 'battle') {
        refreshBattleGrid('opp');
        setTimeout(() => setStatus(`⏳ ${nameFor(oppRole)}'s turn…`), 1200);
      }
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
    if (haptics.getForfeitSeconds() <= 0) haptics.startForfeitVibe(600);
    haptics.setForfeitIntensity(intensity);
    haptics.setWaveVibeMode(pattern === 'wave' || pattern === 'pulse');
    const lbl = contentEl.querySelector('#bs-vibe-label');
    if (lbl) lbl.textContent = `${Math.round(intensity * 100)}% intensity · ${pattern}`;
  };

  const onBsEnd = () => { haptics.stopAll(); goLobby(); };

  const onDisconnect = () => {
    if (document.getElementById('bs-reconn-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'bs-reconn-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:999;';
    overlay.innerHTML = '<div style="color:#fff;font-size:18px;text-align:center;line-height:1.6">⚡ Connection lost<br><span style="font-size:14px;opacity:0.65">Reconnecting…</span></div>';
    document.body.appendChild(overlay);
  };

  const onRejoined = () => {
    document.getElementById('bs-reconn-overlay')?.remove();
  };

  const onPeerReconnected = () => {
    document.getElementById('bs-reconn-overlay')?.remove();
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#2a7a4f;color:#fff;padding:8px 20px;border-radius:8px;z-index:999;font-size:14px;';
    toast.textContent = `${nameFor(oppRole)} reconnected`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
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

  socket.addEventListener('disconnect',           onDisconnect);
  socket.addEventListener(MSG.JOINED,            onRejoined);
  socket.addEventListener(MSG.PEER_RECONNECTED,  onPeerReconnected);
  socket.addEventListener(MSG.BS_READY,          onBsReady);
  socket.addEventListener(MSG.BS_SHOT,           onBsShot);
  socket.addEventListener(MSG.BS_RESULT,         onBsResult);
  socket.addEventListener(MSG.BS_POWERUP_USE,    onBsPowerupUse);
  socket.addEventListener(MSG.BS_POWERUP_RESULT, onBsPowerupResult);
  socket.addEventListener(MSG.BS_VIBE_CTRL,      onBsVibeCtrl);
  socket.addEventListener(MSG.BS_END,            onBsEnd);
  socket.addEventListener(MSG.PEER_LEFT,         onPeerLeft);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  const onKey = (e) => {
    if (e.key !== 'r' && e.key !== 'R') return;
    if (phase === 'placement') { toggleOrient(); return; }
    if (phase === 'battle' && activePu === 'torpedo') {
      puOrient = puOrient === 'h' ? 'v' : 'h';
      renderPuBar();
      setStatus(`🚀 Torpedo [${puOrient === 'h' ? '→' : '↓'}]: click target`);
    }
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
    if (vibeInterval) { clearInterval(vibeInterval); vibeInterval = null; }
    document.removeEventListener('keydown', onKey);
    socket.removeEventListener('disconnect',           onDisconnect);
    socket.removeEventListener(MSG.JOINED,            onRejoined);
    socket.removeEventListener(MSG.PEER_RECONNECTED,  onPeerReconnected);
    socket.removeEventListener(MSG.BS_READY,          onBsReady);
    socket.removeEventListener(MSG.BS_SHOT,           onBsShot);
    socket.removeEventListener(MSG.BS_RESULT,         onBsResult);
    socket.removeEventListener(MSG.BS_POWERUP_USE,    onBsPowerupUse);
    socket.removeEventListener(MSG.BS_POWERUP_RESULT, onBsPowerupResult);
    socket.removeEventListener(MSG.BS_VIBE_CTRL,      onBsVibeCtrl);
    socket.removeEventListener(MSG.BS_END,            onBsEnd);
    socket.removeEventListener(MSG.PEER_LEFT,         onPeerLeft);
    document.getElementById('bs-reconn-overlay')?.remove();
    haptics.stopAll();
  }, { once: true });

  renderPlacement();
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
