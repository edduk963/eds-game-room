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

  let selectedGame = state.devMode ? (state.devPreselect || 'splitloot') : 'galactic';
  let selectedRounds = 3;
  let selectedMode = 'easy';
  let selectedForfeit = 30;
  let selectedEdgeMode = false;
  let selectedEdgeLives = 3;
  let selectedHiloMode = 'submission';
  let selectedHiloCycles = 1;
  let selectedHiloDeckSize = 1;
  let selectedHiloVibeRamp = 10;
  let selectedHiloLives = 3;
  let selectedHiloVibeTarget = 'both';
  let selectedStlDifficulty = 'normal';
  let selectedStlForfeitCards = ['truth', 'dare', 'control', 'strip', 'drink', 'surrender'];
  let selectedWiWinCondition = 'normal';
  let selectedWiSpellLimit = 5;

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
        <div class="player ${state.guest2Name ? '' : 'empty'}" id="p-guest2">
          <div class="name">${state.guest2Name || 'player 3 (optional)…'}</div>
          <div class="role">Guest 2</div>
        </div>
      </div>
      <h2>Choose a game</h2>
      <div class="game-list" id="game-list">
        ${state.devMode ? `
        <div class="game-tile game-tile-selectable" data-game="splitloot">
          <div class="name">Split the Loot</div>
          <div class="desc">Two-player vault escape. Collect loot, dodge guards, trigger hidden traps. Escape with enough loot or face the forfeits.</div>
        </div>
        <div class="game-tile game-tile-selectable" data-game="wizardisland">
          <div class="name">Wizard Island</div>
          <div class="desc">Roll dice to explore 8 islands, collect stat cards, cast spells, and battle each other and the Dark Wizard boss.</div>
        </div>
        ` : `
        <div class="game-category-label">Vibe Games</div>
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
        <div class="game-tile game-tile-selectable" data-game="dice">
          <div class="name">Dice</div>
          <div class="desc">Roll dice each round. Loser suffers escalating forfeit vibe — starts 15s and doubles on each loss.</div>
        </div>
        <div class="game-tile game-tile-selectable" data-game="hilo">
          <div class="name">Hi-Lo</div>
          <div class="desc">Turn-based card guessing. Correct guesses vibe your opponent — intensity builds with each card, duration scales with difficulty.</div>
        </div>
        <div class="game-category-label">Other Games</div>
        <div class="game-tile game-tile-selectable" data-game="beatdealer">
          <div class="name">Beat the Dealer</div>
          <div class="desc">Play cards against the computer. Beat it to score — lose to it and face the forfeit. 10 rounds, 2 players.</div>
        </div>
        `}
      </div>
      <div id="hilo-config" style="display:none">
        <div class="mm-rounds-row">
          <span>Mode:</span>
          <div class="mm-rounds-btns" id="hilo-mode-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-hilo-mode="submission">Submission</button>
            <button class="mm-rounds-btn ghost" data-hilo-mode="fixed">Escape</button>
            <button class="mm-rounds-btn ghost" data-hilo-mode="random">Random</button>
          </div>
        </div>
        <div id="hilo-cycles-row" class="mm-rounds-row" style="margin-top:4px;display:none;">
          <span>Rounds:</span>
          <div class="mm-rounds-btns" id="hilo-cycles-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-hilo-cycles="1">1</button>
            <button class="mm-rounds-btn ghost" data-hilo-cycles="2">2</button>
            <button class="mm-rounds-btn ghost" data-hilo-cycles="3">3</button>
            <button class="mm-rounds-btn ghost" data-hilo-cycles="4">4</button>
            <button class="mm-rounds-btn ghost" data-hilo-cycles="5">5</button>
            <button class="mm-rounds-btn ghost" data-hilo-cycles="6">6</button>
            <button class="mm-rounds-btn ghost" data-hilo-cycles="0">Random</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:4px;">
          <span>Deck size:</span>
          <div class="mm-rounds-btns" id="hilo-deck-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-hilo-deck="1">1</button>
            <button class="mm-rounds-btn ghost" data-hilo-deck="2">2</button>
            <button class="mm-rounds-btn ghost" data-hilo-deck="3">3</button>
            <button class="mm-rounds-btn ghost" data-hilo-deck="4">4</button>
            <button class="mm-rounds-btn ghost" data-hilo-deck="5">5</button>
            <button class="mm-rounds-btn ghost" data-hilo-deck="6">6</button>
            <button class="mm-rounds-btn ghost" data-hilo-deck="0">Random</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:4px;">
          <span>Vibe ramp:</span>
          <div class="mm-rounds-btns" id="hilo-ramp-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-hilo-ramp="10">10%</button>
            <button class="mm-rounds-btn ghost" data-hilo-ramp="15">15%</button>
            <button class="mm-rounds-btn ghost" data-hilo-ramp="20">20%</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:4px;">
          <span>Lives:</span>
          <div class="mm-rounds-btns" id="hilo-lives-btns">
            <button class="mm-rounds-btn ghost" data-hilo-lives="1">1</button>
            <button class="mm-rounds-btn ghost" data-hilo-lives="2">2</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-hilo-lives="3">3</button>
            <button class="mm-rounds-btn ghost" data-hilo-lives="5">5</button>
            <button class="mm-rounds-btn ghost" data-hilo-lives="10">10</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:4px;">
          <span>Vibe target <span style="font-size:11px;color:var(--muted)">(3-player)</span>:</span>
          <div class="mm-rounds-btns" id="hilo-vibe-target-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-hilo-vibe-target="both">Both vibers</button>
            <button class="mm-rounds-btn ghost" data-hilo-vibe-target="highest_lives">Highest lives</button>
            <button class="mm-rounds-btn ghost" data-hilo-vibe-target="random">Random</button>
          </div>
        </div>
      </div>
      <div id="stl-config" style="display:none">
        <div class="mm-rounds-row">
          <span>Difficulty:</span>
          <div class="mm-rounds-btns" id="stl-diff-btns">
            <button class="mm-rounds-btn ghost" data-stl-diff="easy">Easy</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-stl-diff="normal">Normal</button>
            <button class="mm-rounds-btn ghost" data-stl-diff="hard">Hard</button>
          </div>
        </div>
        <div class="mm-rounds-row" style="margin-top:8px;flex-wrap:wrap;gap:6px;">
          <span style="width:100%">Forfeit cards:</span>
          <button class="mm-rounds-btn mm-rounds-selected" data-stl-card="truth">Truth</button>
          <button class="mm-rounds-btn mm-rounds-selected" data-stl-card="dare">Dare</button>
          <button class="mm-rounds-btn mm-rounds-selected" data-stl-card="drink">Drink</button>
          <button class="mm-rounds-btn mm-rounds-selected" data-stl-card="strip">Strip</button>
          <button class="mm-rounds-btn mm-rounds-selected" data-stl-card="control">Control</button>
          <button class="mm-rounds-btn mm-rounds-selected" data-stl-card="surrender">Surrender</button>
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
      <div id="wi-config" style="display:none">
        <div class="mm-rounds-row">
          <span>Win condition:</span>
          <div class="mm-rounds-btns" id="wi-win-btns">
            <button class="mm-rounds-btn mm-rounds-selected" data-wi-win="normal">Normal</button>
            <button class="mm-rounds-btn ghost" data-wi-win="endurance">Endurance</button>
            <button class="mm-rounds-btn ghost" data-wi-win="timed">Timed</button>
          </div>
        </div>
        <div id="wi-limit-row" class="mm-rounds-row" style="margin-top:4px;display:none;">
          <span>Forfeit limit:</span>
          <div class="mm-rounds-btns" id="wi-limit-btns">
            <button class="mm-rounds-btn ghost" data-wi-limit="3">3</button>
            <button class="mm-rounds-btn mm-rounds-selected" data-wi-limit="5">5</button>
            <button class="mm-rounds-btn ghost" data-wi-limit="8">8</button>
            <button class="mm-rounds-btn ghost" data-wi-limit="10">10</button>
          </div>
        </div>
      </div>
      <div id="forfeit-row" class="mm-rounds-row" style="margin-top:16px;">
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
      <div id="edge-mode-row" class="mm-rounds-row" style="margin-top:16px;">
        <span>Edge mode:</span>
        <div class="mm-rounds-btns" id="edge-btns">
          <button class="mm-rounds-btn mm-rounds-selected" data-edge="off">Off</button>
          <button class="mm-rounds-btn ghost" data-edge="on">On</button>
        </div>
      </div>
      <div id="edge-lives-row" class="mm-rounds-row" style="display:none;margin-top:8px;">
        <span>Lives (E key):</span>
        <div class="mm-rounds-btns" id="edge-lives-btns">
          <button class="mm-rounds-btn ghost" data-lives="1">1</button>
          <button class="mm-rounds-btn ghost" data-lives="2">2</button>
          <button class="mm-rounds-btn mm-rounds-selected" data-lives="3">3</button>
          <button class="mm-rounds-btn ghost" data-lives="5">5</button>
          <button class="mm-rounds-btn ghost" data-lives="10">10</button>
        </div>
      </div>
      <div class="actions">
        <button class="ghost" id="copy">Copy link</button>
        <button class="ghost" id="leave">Leave</button>
        <button id="start" disabled>Start</button>
      </div>
      <div class="vibe-row" style="margin-top:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <button id="btn-vibe-bt">Connect via Bluetooth</button>
        <button class="ghost" id="btn-vibe-intiface">Connect via Intiface</button>
        <span id="vibe-hint" style="font-size:12px;color:#888;">Bluetooth: Chrome/Edge only &nbsp;·&nbsp; Intiface: requires Intiface Central running locally</span>
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
  const hiloConfig = root.querySelector('#hilo-config');
  const stlConfig = root.querySelector('#stl-config');
  const roundsBtns = root.querySelector('#rounds-btns');
  const modeBtns = root.querySelector('#mode-btns');
  const forfeitRow = root.querySelector('#forfeit-row');
  const edgeModeRow = root.querySelector('#edge-mode-row');
  const forfeitBtns = root.querySelector('#forfeit-btns');
  const edgeBtns = root.querySelector('#edge-btns');
  const edgeLivesBtns = root.querySelector('#edge-lives-btns');
  const edgeLivesRow = root.querySelector('#edge-lives-row');
  const hiloModeBtns = root.querySelector('#hilo-mode-btns');
  const hiloCyclesBtns = root.querySelector('#hilo-cycles-btns');
  const hiloCyclesRow = root.querySelector('#hilo-cycles-row');
  const hiloDeckBtns = root.querySelector('#hilo-deck-btns');
  const hiloRampBtns = root.querySelector('#hilo-ramp-btns');
  const hiloLivesBtns = root.querySelector('#hilo-lives-btns');
  const wiConfig = root.querySelector('#wi-config');
  const wiWinBtns = root.querySelector('#wi-win-btns');
  const wiLimitRow = root.querySelector('#wi-limit-row');
  const wiLimitBtns = root.querySelector('#wi-limit-btns');

  function paintOptions() {
    root.querySelectorAll('.game-tile-selectable').forEach(t =>
      t.classList.toggle('selected', t.dataset.game === selectedGame)
    );
    mmConfig.style.display = selectedGame === 'mastermind' ? 'block' : 'none';
    hiloConfig.style.display = selectedGame === 'hilo' ? 'block' : 'none';
    stlConfig.style.display = selectedGame === 'splitloot' ? 'block' : 'none';
    wiConfig.style.display = selectedGame === 'wizardisland' ? 'block' : 'none';
    wiWinBtns.querySelectorAll('[data-wi-win]').forEach(b => {
      const sel = b.dataset.wiWin === selectedWiWinCondition;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    wiLimitRow.style.display = selectedWiWinCondition === 'endurance' ? 'flex' : 'none';
    wiLimitBtns.querySelectorAll('[data-wi-limit]').forEach(b => {
      const sel = parseInt(b.dataset.wiLimit, 10) === selectedWiSpellLimit;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    stlConfig.querySelectorAll('[data-stl-diff]').forEach(b => {
      const sel = b.dataset.stlDiff === selectedStlDifficulty;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    stlConfig.querySelectorAll('[data-stl-card]').forEach(b => {
      const sel = selectedStlForfeitCards.includes(b.dataset.stlCard);
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    hiloCyclesRow.style.display = selectedHiloMode === 'fixed' ? 'flex' : 'none';
    hiloModeBtns.querySelectorAll('[data-hilo-mode]').forEach(b => {
      const sel = b.dataset.hiloMode === selectedHiloMode;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    hiloCyclesBtns.querySelectorAll('[data-hilo-cycles]').forEach(b => {
      const sel = parseInt(b.dataset.hiloCycles, 10) === selectedHiloCycles;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    hiloDeckBtns.querySelectorAll('[data-hilo-deck]').forEach(b => {
      const sel = parseInt(b.dataset.hiloDeck, 10) === selectedHiloDeckSize;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    hiloRampBtns.querySelectorAll('[data-hilo-ramp]').forEach(b => {
      const sel = parseInt(b.dataset.hiloRamp, 10) === selectedHiloVibeRamp;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    hiloLivesBtns.querySelectorAll('[data-hilo-lives]').forEach(b => {
      const sel = parseInt(b.dataset.hiloLives, 10) === selectedHiloLives;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    root.querySelectorAll('[data-hilo-vibe-target]').forEach(b => {
      const sel = b.dataset.hiloVibeTarget === selectedHiloVibeTarget;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
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
    const isHilo = selectedGame === 'hilo';
    const isStl = selectedGame === 'splitloot';
    const isWi = selectedGame === 'wizardisland';
    const isBtd = selectedGame === 'beatdealer';
    forfeitRow.style.display   = (isHilo || isStl || isWi || isBtd) ? 'none' : '';
    edgeModeRow.style.display  = (isHilo || isStl || isWi || isBtd) ? 'none' : '';
    if (isHilo || isStl || isWi || isBtd) edgeLivesRow.style.display = 'none';
    forfeitBtns.querySelectorAll('[data-forfeit]').forEach(b => {
      const sel = parseInt(b.dataset.forfeit, 10) === selectedForfeit;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    edgeBtns.querySelectorAll('[data-edge]').forEach(b => {
      const sel = (b.dataset.edge === 'on') === selectedEdgeMode;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
    edgeLivesRow.style.display = selectedEdgeMode ? 'flex' : 'none';
    edgeLivesBtns.querySelectorAll('[data-lives]').forEach(b => {
      const sel = parseInt(b.dataset.lives, 10) === selectedEdgeLives;
      b.classList.toggle('mm-rounds-selected', sel);
      b.classList.toggle('ghost', !sel);
    });
  }

  const sendConfig = () => socket.send({
    type: MSG.LOBBY_CONFIG,
    devMode: state.devMode,
    gameType: selectedGame,
    rounds: selectedRounds,
    mode: selectedMode,
    forfeitDuration: selectedForfeit,
    edgeMode: selectedEdgeMode,
    edgeLives: selectedEdgeLives,
    hiloMode: selectedHiloMode,
    hiloCycles: selectedHiloCycles,
    hiloDeckSize: selectedHiloDeckSize,
    hiloVibeRamp: selectedHiloVibeRamp,
    hiloLives: selectedHiloLives,
    hiloVibeTarget: selectedHiloVibeTarget,
    stlDifficulty: selectedStlDifficulty,
    stlForfeitCards: selectedStlForfeitCards,
    wiWinCondition: selectedWiWinCondition,
    wiSpellLimit: selectedWiSpellLimit,
  });

  socket.connect();
  socket.send({ type: MSG.JOIN, sessionId: state.sessionId, name: state.myName });

  const onLobby = (ev) => {
    const hadGuest = !!state.guestName;
    state.hostName = ev.detail.host?.name || null;
    state.guestName = ev.detail.guest?.name || null;
    state.guest2Name = ev.detail.guest2?.name || null;
    if (state.role === 'host' && !hadGuest && state.guestName) sendConfig();
    paint();
  };
  const onJoined = (ev) => { state.role = ev.detail.role; paint(); };
  const onError = (ev) => {
    if (ev.detail.code === 'no_session') showError(errEl, 'That session no longer exists.');
    else if (ev.detail.code === 'session_full') showError(errEl, 'This session is already full.');
  };
  const onPeerLeft = (ev) => {
    const leftRole = ev.detail?.role;
    if (leftRole === 'host') state.hostName = null;
    else if (leftRole === 'guest') state.guestName = null;
    else if (leftRole === 'guest2') state.guest2Name = null;
    else {
      // fallback for older server: clear based on my role
      if (state.role === 'host') state.guestName = null;
      else state.hostName = null;
    }
    paint();
    showError(errEl, 'A player left.');
  };

  const onLobbyConfig = (ev) => {
    const modeChanged = ev.detail.devMode !== undefined && !!ev.detail.devMode !== state.devMode;
    if (ev.detail.devMode !== undefined) state.devMode = !!ev.detail.devMode;
    selectedGame      = ev.detail.gameType        || selectedGame;
    selectedRounds    = ev.detail.rounds          || selectedRounds;
    selectedMode      = ev.detail.mode            || selectedMode;
    selectedForfeit   = ev.detail.forfeitDuration || selectedForfeit;
    if (ev.detail.edgeMode !== undefined) selectedEdgeMode = !!ev.detail.edgeMode;
    if (ev.detail.edgeLives)              selectedEdgeLives = ev.detail.edgeLives;
    if (ev.detail.hiloMode)                    selectedHiloMode = ev.detail.hiloMode;
    if (ev.detail.hiloCycles !== undefined)    selectedHiloCycles = ev.detail.hiloCycles;
    if (ev.detail.hiloDeckSize !== undefined)  selectedHiloDeckSize = ev.detail.hiloDeckSize;
    if (ev.detail.hiloVibeRamp)               selectedHiloVibeRamp = ev.detail.hiloVibeRamp;
    if (ev.detail.hiloLives)                   selectedHiloLives = ev.detail.hiloLives;
    if (ev.detail.hiloVibeTarget)              selectedHiloVibeTarget = ev.detail.hiloVibeTarget;
    if (ev.detail.stlDifficulty)               selectedStlDifficulty = ev.detail.stlDifficulty;
    if (ev.detail.stlForfeitCards)             selectedStlForfeitCards = ev.detail.stlForfeitCards;
    if (ev.detail.wiWinCondition)              selectedWiWinCondition = ev.detail.wiWinCondition;
    if (ev.detail.wiSpellLimit !== undefined)  selectedWiSpellLimit = ev.detail.wiSpellLimit;
    if (modeChanged) { renderLobby(root); return; }
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

  edgeBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-edge]');
    if (!btn) return;
    selectedEdgeMode = btn.dataset.edge === 'on';
    paintOptions();
    sendConfig();
  });

  edgeLivesBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-lives]');
    if (!btn) return;
    selectedEdgeLives = parseInt(btn.dataset.lives, 10);
    paintOptions();
    sendConfig();
  });

  startBtn.addEventListener('click', () => {
    socket.send({ type: MSG.START, gameType: selectedGame, rounds: selectedRounds, mode: selectedMode, forfeitDuration: selectedForfeit, edgeMode: selectedEdgeMode, edgeLives: selectedEdgeLives, hiloMode: selectedHiloMode, hiloCycles: selectedHiloCycles, hiloDeckSize: selectedHiloDeckSize, hiloVibeRamp: selectedHiloVibeRamp, hiloLives: selectedHiloLives, hiloVibeTarget: selectedHiloVibeTarget, stlDifficulty: selectedStlDifficulty, stlForfeitCards: selectedStlForfeitCards, wiWinCondition: selectedWiWinCondition, wiSpellLimit: selectedWiSpellLimit });
  });

  wiWinBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-wi-win]');
    if (!btn) return;
    selectedWiWinCondition = btn.dataset.wiWin;
    paintOptions();
    sendConfig();
  });

  wiLimitBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-wi-limit]');
    if (!btn) return;
    selectedWiSpellLimit = parseInt(btn.dataset.wiLimit, 10);
    paintOptions();
    sendConfig();
  });

  stlConfig.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const diffBtn = e.target.closest('[data-stl-diff]');
    if (diffBtn) { selectedStlDifficulty = diffBtn.dataset.stlDiff; paintOptions(); sendConfig(); return; }
    const cardBtn = e.target.closest('[data-stl-card]');
    if (cardBtn) {
      const card = cardBtn.dataset.stlCard;
      if (selectedStlForfeitCards.includes(card)) {
        selectedStlForfeitCards = selectedStlForfeitCards.filter(c => c !== card);
      } else {
        selectedStlForfeitCards = [...selectedStlForfeitCards, card];
      }
      paintOptions();
      sendConfig();
    }
  });

  hiloModeBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-hilo-mode]');
    if (!btn) return;
    selectedHiloMode = btn.dataset.hiloMode;
    paintOptions();
    sendConfig();
  });

  hiloCyclesBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-hilo-cycles]');
    if (!btn) return;
    selectedHiloCycles = parseInt(btn.dataset.hiloCycles, 10);
    paintOptions();
    sendConfig();
  });

  hiloDeckBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-hilo-deck]');
    if (!btn) return;
    selectedHiloDeckSize = parseInt(btn.dataset.hiloDeck, 10);
    paintOptions();
    sendConfig();
  });

  hiloRampBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-hilo-ramp]');
    if (!btn) return;
    selectedHiloVibeRamp = parseInt(btn.dataset.hiloRamp, 10);
    paintOptions();
    sendConfig();
  });

  hiloLivesBtns.addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-hilo-lives]');
    if (!btn) return;
    selectedHiloLives = parseInt(btn.dataset.hiloLives, 10);
    paintOptions();
    sendConfig();
  });

  root.querySelector('#hilo-vibe-target-btns').addEventListener('click', (e) => {
    if (state.role !== 'host') return;
    const btn = e.target.closest('[data-hilo-vibe-target]');
    if (!btn) return;
    selectedHiloVibeTarget = btn.dataset.hiloVibeTarget;
    paintOptions();
    sendConfig();
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

  const vibeBtBtn = root.querySelector('#btn-vibe-bt');
  const vibeIntifaceBtn = root.querySelector('#btn-vibe-intiface');
  const vibeHint = root.querySelector('#vibe-hint');
  if (haptics.isConnected()) {
    vibeHint.textContent = '📳 Connected';
  }

  async function connectVibe(mode, btn) {
    const other = btn === vibeBtBtn ? vibeIntifaceBtn : vibeBtBtn;
    const originalLabel = btn.textContent;
    btn.textContent = 'Connecting…';
    btn.disabled = true;
    other.disabled = true;
    vibeHint.textContent = mode === 'intiface'
      ? 'Make sure Intiface Central is running on port 12345.'
      : 'Approve the Bluetooth pairing dialog in the browser.';
    try {
      const dev = await haptics.connect(mode);
      vibeHint.textContent = dev ? `📳 ${dev.name} ready` : 'No device found — try again.';
    } catch (err) {
      vibeHint.textContent = `Failed: ${err.message ?? err}`;
    }
    btn.textContent = haptics.isConnected() ? '📳 Connected — reconnect' : originalLabel;
    btn.disabled = false;
    other.disabled = false;
  }

  vibeBtBtn.addEventListener('click', () => connectVibe('bluetooth', vibeBtBtn));
  vibeIntifaceBtn.addEventListener('click', () => connectVibe('intiface', vibeIntifaceBtn));

  root.querySelector('#btn-test-vibe').addEventListener('click', () => {
    openTestVibeOverlay(state, socket, haptics);
  });

  function paint() {
    const ph = root.querySelector('#p-host');
    const pg = root.querySelector('#p-guest');
    const pg2 = root.querySelector('#p-guest2');
    if (ph) {
      ph.classList.toggle('empty', !state.hostName);
      ph.querySelector('.name').textContent = state.hostName || 'waiting…';
    }
    if (pg) {
      pg.classList.toggle('empty', !state.guestName);
      pg.querySelector('.name').textContent = state.guestName || 'waiting for player 2…';
    }
    if (pg2) {
      pg2.classList.toggle('empty', !state.guest2Name);
      pg2.querySelector('.name').textContent = state.guest2Name || 'player 3 (optional)…';
    }
    const canStart = state.role === 'host' && state.hostName && state.guestName;
    startBtn.disabled = !canStart;
    startBtn.textContent = state.role === 'host'
      ? (canStart ? 'Start' : 'Waiting for guest…')
      : 'Waiting for host…';
    paintOptions();
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
  el.innerHTML = `<div class="error">${escapeHtml(msg)}</div>`;
}

function openTestVibeOverlay(state, socket, haptics) {
  const myRole = state.role;
  const myName = state.myName || 'You';
  const is3 = !!state.guest2Name;

  const allPlayers = [
    { role: 'host',   name: state.hostName   || 'Host' },
    { role: 'guest',  name: state.guestName  || 'Guest' },
  ];
  if (is3) allPlayers.push({ role: 'guest2', name: state.guest2Name || 'Guest 2' });
  const others = allPlayers.filter(p => p.role !== myRole);

  const myPanel = `
    <div class="tv-panel">
      <div class="tv-panel-name">${escapeHtml(myName)}</div>
      <div class="tv-panel-label">Your device</div>
      <div class="tv-level" id="tv-my-level">0%</div>
      <input type="range" id="tv-my-slider" min="0" max="100" value="0" class="tv-slider tv-slider-mine">
      <div class="tv-panel-hint">${haptics.isConnected() ? '📳 Connected' : 'No device — connect first'}</div>
    </div>`;

  const otherPanels = others.map(p => `
    <div class="tv-panel">
      <div class="tv-panel-name">${escapeHtml(p.name)}</div>
      <div class="tv-panel-label">Their device</div>
      <div class="tv-level tv-level-opp" id="tv-opp-level-${p.role}">0%</div>
      <input type="range" id="tv-opp-slider-${p.role}" min="0" max="100" value="0" class="tv-slider tv-slider-opp" data-target="${p.role}">
      <div class="tv-panel-hint">Sends vibe to ${escapeHtml(p.name)}</div>
    </div>`).join('');

  const overlay = document.createElement('div');
  overlay.className = 'instructions-overlay';
  overlay.innerHTML = `
    <div class="instructions-box tv-box${is3 ? ' tv-box-3' : ''}">
      <h2>Test Vibe</h2>
      <p class="instructions-meta">Confirm all devices are working before the game starts.</p>
      <div class="tv-panels${is3 ? ' tv-panels-3' : ''}">
        ${myPanel}${otherPanels}
      </div>
      <p class="tv-hint">All players can open this screen independently.</p>
      <div class="actions" style="margin-top:16px;justify-content:center;">
        <button id="tv-close">Done</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const mySlider  = overlay.querySelector('#tv-my-slider');
  const myLevelEl = overlay.querySelector('#tv-my-level');

  mySlider.addEventListener('input', () => {
    myLevelEl.textContent = `${mySlider.value}%`;
    haptics.testVibe(mySlider.value / 100);
  });

  overlay.querySelectorAll('[data-target]').forEach(slider => {
    slider.addEventListener('input', () => {
      const target = slider.dataset.target;
      const levelEl = overlay.querySelector(`#tv-opp-level-${target}`);
      if (levelEl) levelEl.textContent = `${slider.value}%`;
      socket.send({ type: MSG.VIBE_TEST, level: slider.value / 100, target });
    });
  });

  // Another player testing my device — apply and reflect in my slider
  const onVibeTest = (ev) => {
    const level = ev.detail.level;
    haptics.testVibe(level);
    mySlider.value = Math.round(level * 100);
    myLevelEl.textContent = `${mySlider.value}%`;
  };
  socket.addEventListener(MSG.VIBE_TEST, onVibeTest);

  const close = () => {
    haptics.testVibe(0);
    others.forEach(p => socket.send({ type: MSG.VIBE_TEST, level: 0, target: p.role }));
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
