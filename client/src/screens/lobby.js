import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';

export function renderLobby(root) {
  if (!state.myName) {
    _renderNameEntry(root);
    return;
  }

  let selectedGame = 'galactic';
  let selectedRounds = 3;
  let selectedMode = 'easy';
  let selectedForfeit = 30;

  root.innerHTML = `
    <div class="card">
      <h2>Session ${state.sessionId}</h2>
      <p class="subtitle">Share this link with a friend so they can join.</p>
      <div class="share" id="share">${location.origin}/#/session/${state.sessionId}</div>
      <div class="players">
        <div class="player ${state.hostName ? '' : 'empty'}" id="p-host">
          <div class="name">${state.hostName || 'waiting…'}</div>
          <div class="role">Host</div>
        </div>
        <div class="player ${state.guestName ? '' : 'empty'}" id="p-guest">
          <div class="name">${state.guestName || 'waiting for player 2…'}</div>
          <div class="role">Guest</div>
        </div>
      </div>
      <h2>Choose a game</h2>
      <div class="game-list" id="game-list">
        <div class="game-tile game-tile-selectable selected" data-game="galactic">
          <div class="name">Galactic Salvage</div>
          <div class="desc">90 seconds. Shoot invaders, dodge debris, ignore civilians and decoys.</div>
        </div>
        <div class="game-tile game-tile-selectable" data-game="mastermind">
          <div class="name">Mastermind</div>
          <div class="desc">Crack the colour code before your opponent. Each close guess vibrates them.</div>
        </div>
        <div class="game-tile game-tile-selectable" data-game="endurance">
          <div class="name">Galactic Salvage Endurance</div>
          <div class="desc">Space invaders. Rapid fire stacks vibe recoil on you. Aliens reaching your line vibe at full intensity.</div>
        </div>
        <div class="game-tile game-tile-selectable" data-game="tugofwar">
          <div class="name">Tug of War</div>
          <div class="desc">Both devices vibe continuously. The losing player feels it more. Pool grows every 10s to 100%.</div>
        </div>
      </div>
      <div id="mm-config" style="display:none">
        <div class="mm-rounds-row">
          <span>Rounds:</span>
          <div class="mm-rounds-btns" id="rounds-btns">
            <button class="mm-rounds-btn ghost" data-rounds="2">2</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-rounds="3">3</button>
            <button class="mm-rounds-btn ghost" data-rounds="4">4</button>
            <button class="mm-rounds-btn ghost" data-rounds="5">5</button>
          </div>
        </div>
        <div class="mm-rounds-row">
          <span>Mode:</span>
          <div class="mm-rounds-btns" id="mode-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-mode="easy" title="Dots appear in slot order — you can see exactly which positions are correct">Easy</button>
            <button class="mm-rounds-btn ghost" data-mode="hard" title="Dots are only a count — no timer">Hard</button>
          </div>
        </div>
      </div>
      <div class="mm-rounds-row" style="margin-top:16px;">
        <span>Forfeit vibe:</span>
        <div class="mm-rounds-btns" id="forfeit-btns">
          <button class="mm-rounds-btn ghost" data-forfeit="15">15s</button>
          <button class="mm-rounds-btn mm-rounds-selected" data-forfeit="30">30s</button>
          <button class="mm-rounds-btn ghost" data-forfeit="60">60s</button>
          <button class="mm-rounds-btn ghost" data-forfeit="120">2min</button>
          <button class="mm-rounds-btn ghost" data-forfeit="300">5min</button>
          <button class="mm-rounds-btn ghost" data-forfeit="600">10min</button>
        </div>
      </div>
      <div class="actions">
        <button class="ghost" id="copy">Copy link</button>
        <button class="ghost" id="leave">Leave</button>
        <button id="start" disabled>Start</button>
      </div>
      <div class="vibe-row" style="margin-top:16px;display:flex;align-items:center;gap:12px;">
        <button id="btn-vibe">Connect Vibe</button>
        <span id="vibe-hint" style="font-size:12px;color:#888;">Connects via browser Bluetooth — Chrome/Edge only</span>
      </div>
      <div style="margin-top:8px;">
        <button class="ghost" id="btn-test-vibe" style="font-size:13px;padding:8px 14px;">Test Vibe</button>
      </div>
      <div id="err" style="margin-top:8px;"></div>
    </div>
  `;

  const startBtn = root.querySelector('#start');
  const errEl = root.querySelector('#err');
  const gameList = root.querySelector('#game-list');
  const mmConfig = root.querySelector('#mm-config');
  const roundsBtns = root.querySelector('#rounds-btns');
  const modeBtns = root.querySelector('#mode-btns');
  const forfeitBtns = root.querySelector('#forfeit-btns');

  function paintOptions() {
    root.querySelectorAll('.game-tile-selectable').forEach(t =>
      t.classList.toggle('selected', t.dataset.game === selectedGame)
    );
    mmConfig.style.display = selectedGame === 'mastermind' ? 'block' : 'none';
    roundsBtns.querySelectorAll('[data-rounds]').forEach(b => {
      const sel = parseInt(b.dataset.rounds, 10) === selectedRounds;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    modeBtns.querySelectorAll('[data-mode]').forEach(b => {
      const sel = b.dataset.mode === selectedMode;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    forfeitBtns.querySelectorAll('[data-forfeit]').forEach(b => {
      const sel = parseInt(b.dataset.forfeit, 10) === selectedForfeit;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
  }

  const sendConfig = () => socket.send({
    type: MSG.LOBBY_CONFIG,
    gameType: selectedGame,
    rounds: selectedRounds,
    mode: selectedMode,
    forfeitDuration: selectedForfeit,
  });

  socket.connect();
  socket.send({ type: MSG.JOIN, sessionId: state.sessionId, name: state.myName });

  const onLobby = (ev) => {
    const hadGuest = !!state.guestName;
    state.hostName = ev.detail.host?.name || null;
    state.guestName = ev.detail.guest?.name || null;
    // When a guest first joins, push current config so their UI is in sync
    if (state.role === 'host' && !hadGuest && state.guestName) sendConfig();
    paint();
  };
  const onJoined = (ev) => { state.role = ev.detail.role; paint(); };
  const onError = (ev) => {
    if (ev.detail.code === 'no_session') showError(errEl, 'That session no longer exists.');
    else if (ev.detail.code === 'session_full') showError(errEl, 'This session is already full.');
  };
  const onPeerLeft = () => {
    state.guestName = state.role === 'host' ? null : state.guestName;
    state.hostName = state.role === 'guest' ? null : state.hostName;
    paint();
    showError(errEl, 'Your opponent left.');
  };

  const onLobbyConfig = (ev) => {
    selectedGame    = ev.detail.gameType      || selectedGame;
    selectedRounds  = ev.detail.rounds        || selectedRounds;
    selectedMode    = ev.detail.mode          || selectedMode;
    selectedForfeit = ev.detail.forfeitDuration || selectedForfeit;
    paintOptions();
  };

  socket.addEventListener(MSG.LOBBY, onLobby);
  socket.addEventListener(MSG.JOINED, onJoined);
  socket.addEventListener(MSG.ERROR, onError);
  socket.addEventListener(MSG.PEER_LEFT, onPeerLeft);
  socket.addEventListener(MSG.LOBBY_CONFIG, onLobbyConfig);

  const cleanup = () => {
    socket.removeEventListener(MSG.LOBBY, onLobby);
    socket.removeEventListener(MSG.JOINED, onJoined);
    socket.removeEventListener(MSG.ERROR, onError);
    socket.removeEventListener(MSG.PEER_LEFT, onPeerLeft);
    socket.removeEventListener(MSG.LOBBY_CONFIG, onLobbyConfig);
  };
  window.addEventListener('hashchange', cleanup, { once: true });

  gameList.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const tile = e.target.closest('[data-game]');
    if (!tile) return;
    selectedGame = tile.dataset.game;
    paintOptions();
    sendConfig();
  });

  roundsBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-rounds]');
    if (!btn) return;
    selectedRounds = parseInt(btn.dataset.rounds, 10);
    paintOptions();
    sendConfig();
  });

  modeBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-mode]');
    if (!btn) return;
    selectedMode = btn.dataset.mode;
    paintOptions();
    sendConfig();
  });

  forfeitBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-forfeit]');
    if (!btn) return;
    selectedForfeit = parseInt(btn.dataset.forfeit, 10);
    paintOptions();
    sendConfig();
  });

  startBtn.addEventListener('click', () => {
    socket.send({ type: MSG.START, gameType: selectedGame, rounds: selectedRounds, mode: selectedMode, forfeitDuration: selectedForfeit });
  });

  root.querySelector('#copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/#/session/${state.sessionId}`);
      root.querySelector('#copy').textContent = 'Copied!';
      setTimeout(() => { const b = root.querySelector('#copy'); if (b) b.textContent = 'Copy link'; }, 1500);
    } catch {}
  });

  root.querySelector('#leave').addEventListener('click', () => {
    socket.close();
    navigate('#/');
  });

  const vibeBtn = root.querySelector('#btn-vibe');
  const vibeHint = root.querySelector('#vibe-hint');
  if (haptics.isConnected()) {
    vibeBtn.textContent = '📳 Connected — click to reconnect';
    vibeHint.textContent = '';
  }
  vibeBtn.addEventListener('click', async () => {
    vibeBtn.textContent = 'Connecting…';
    vibeBtn.disabled = true;
    vibeHint.textContent = 'Make sure Intiface Central is open and scanning.';
    try {
      const dev = await haptics.connect();
      if (dev) {
        vibeBtn.textContent = '📳 Connected — click to reconnect';
        vibeBtn.disabled = false;
        vibeHint.textContent = `Device ready: ${dev.name}`;
      } else {
        vibeBtn.textContent = haptics.isConnected() ? '📳 Connected — click to reconnect' : 'Connect Vibe';
        vibeBtn.disabled = false;
        vibeHint.textContent = 'No device found — try again.';
      }
    } catch (err) {
      vibeBtn.textContent = 'Connect Vibe';
      vibeBtn.disabled = false;
      vibeHint.textContent = `Failed: ${err.message ?? err}`;
    }
  });

  root.querySelector('#btn-test-vibe').addEventListener('click', () => {
    openTestVibeOverlay(state, socket, haptics);
  });

  function paint() {
    const ph = root.querySelector('#p-host');
    const pg = root.querySelector('#p-guest');
    if (ph) {
      ph.classList.toggle('empty', !state.hostName);
      ph.querySelector('.name').textContent = state.hostName || 'waiting…';
    }
    if (pg) {
      pg.classList.toggle('empty', !state.guestName);
      pg.querySelector('.name').textContent = state.guestName || 'waiting for player 2…';
    }
    const canStart = state.role === 'host' && state.hostName && state.guestName;
    startBtn.disabled = !canStart;
    startBtn.textContent = state.role === 'host'
      ? (canStart ? 'Start' : 'Waiting for guest…')
      : 'Waiting for host…';
  }
  paint();
}

function _renderNameEntry(root) {
  root.innerHTML = `
    <div class="card">
      <h1>Ed's Game Hub</h1>
      <label for="join-name">Your name</label>
      <input id="join-name" type="text" maxlength="24" placeholder="e.g. Alice" />
      <div id="join-err"></div>
      <div class="actions">
        <button class="ghost" id="join-cancel">Cancel</button>
        <button id="join-submit">Join game</button>
      </div>
    </div>
  `;

  const nameEl = root.querySelector('#join-name');
  const errEl  = root.querySelector('#join-err');
  nameEl.focus();

  const submit = () => {
    const name = nameEl.value.trim();
    if (!name) { errEl.innerHTML = '<div class="error">Please enter a name.</div>'; return; }
    state.myName = name.slice(0, 24);
    renderLobby(root);
  };

  root.querySelector('#join-submit').addEventListener('click', submit);
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  root.querySelector('#join-cancel').addEventListener('click', () => navigate('#/'));
}

function showError(el, msg) {
  el.innerHTML = `<div class="error">${msg.replace(/[<>&]/g, '')}</div>`;
}

function openTestVibeOverlay(state, socket, haptics) {
  const myName  = state.myName || 'You';
  const oppName = (state.role === 'host' ? state.guestName : state.hostName) || 'Opponent';

  const overlay = document.createElement('div');
  overlay.className = 'instructions-overlay';
  overlay.innerHTML = `
    <div class="instructions-box tv-box">
      <h2>Test Vibe</h2>
      <p class="instructions-meta">Confirm both devices are working before the game starts.</p>
      <div class="tv-panels">
        <div class="tv-panel">
          <div class="tv-panel-name">${escapeHtml(myName)}</div>
          <div class="tv-panel-label">Your device</div>
          <div class="tv-level" id="tv-my-level">0%</div>
          <input type="range" id="tv-my-slider" min="0" max="100" value="0" class="tv-slider tv-slider-mine">
          <div class="tv-panel-hint">${haptics.isConnected() ? '📳 Connected' : 'No device — connect first'}</div>
        </div>
        <div class="tv-panel">
          <div class="tv-panel-name">${escapeHtml(oppName)}</div>
          <div class="tv-panel-label">Their device</div>
          <div class="tv-level tv-level-opp" id="tv-opp-level">0%</div>
          <input type="range" id="tv-opp-slider" min="0" max="100" value="0" class="tv-slider tv-slider-opp">
          <div class="tv-panel-hint">Sends vibe to opponent</div>
        </div>
      </div>
      <p class="tv-hint">Both players can open this screen independently.</p>
      <div class="actions" style="margin-top:16px;justify-content:center;">
        <button id="tv-close">Done</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const mySlider  = overlay.querySelector('#tv-my-slider');
  const oppSlider = overlay.querySelector('#tv-opp-slider');
  const myLevelEl = overlay.querySelector('#tv-my-level');
  const oppLevelEl = overlay.querySelector('#tv-opp-level');

  mySlider.addEventListener('input', () => {
    myLevelEl.textContent = `${mySlider.value}%`;
    haptics.testVibe(mySlider.value / 100);
  });

  oppSlider.addEventListener('input', () => {
    oppLevelEl.textContent = `${oppSlider.value}%`;
    socket.send({ type: MSG.VIBE_TEST, level: oppSlider.value / 100 });
  });

  // Opponent controlling my device — apply and reflect in my slider
  const onVibeTest = (ev) => {
    const level = ev.detail.level;
    haptics.testVibe(level);
    mySlider.value = Math.round(level * 100);
    myLevelEl.textContent = `${mySlider.value}%`;
  };
  socket.addEventListener(MSG.VIBE_TEST, onVibeTest);

  const close = () => {
    haptics.testVibe(0);
    socket.send({ type: MSG.VIBE_TEST, level: 0 });
    socket.removeEventListener(MSG.VIBE_TEST, onVibeTest);
    overlay.remove();
  };

  overlay.querySelector('#tv-close').addEventListener('click', close);
  window.addEventListener('hashchange', close, { once: true });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
