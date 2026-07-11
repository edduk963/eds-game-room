import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';
import {
  generateBoard, rollFor, buildForfeitDeck, buildPowerupDeck,
  tierFor, vibeSeconds as calcVibeSeconds, resolveForfeitText, tileGridPos,
  POWERUP_INFO,
} from '../game/snakesGame.js';

// ─────────────────────────────────────────────────────────────────────────────
// entry
// ─────────────────────────────────────────────────────────────────────────────
export function renderSnakes(root) {
  if (state.snlMode === 'watched' && state.role === 'guest') {
    renderController(root);
  } else {
    renderClimber(root);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER (Watched mode – guest)
// ─────────────────────────────────────────────────────────────────────────────
function renderController(root) {
  const board = generateBoard(state.seed, {
    boardSize: state.snlBoardSize, density: state.snlDensity, coopBetray: false,
  });
  const forfeitDeck = buildForfeitDeck(state.seed, state.snlForfeitCards, state.snlForfeitLines);
  let forfeitIdx = 0;
  const positions = { host: 1 };

  root.innerHTML = `<div class="snl-root">
    <div class="snl-header">
      <span class="snl-title">🐍 Vipers &amp; Vines — Controller</span>
      <button class="ghost snl-leave" id="snl-leave">Leave</button>
    </div>
    <div class="snl-ctrl-body">
      <div id="snl-board-wrap"></div>
      <div class="snl-ctrl-panel">
        <div class="snl-ctrl-section">
          <div class="snl-ctrl-label">Ambient intensity</div>
          <input type="range" id="snl-amb" min="0" max="100" value="0" class="snl-slider">
          <span id="snl-amb-pct">0%</span>
        </div>
        <div class="snl-ctrl-section" id="snl-vibe-sec" style="display:none">
          <div class="snl-ctrl-label">Snake vibe — drive it!</div>
          <input type="range" id="snl-vibe-slider" min="0" max="100" value="50" class="snl-slider">
          <span id="snl-vibe-pct">50%</span>
          <div class="snl-ctrl-timer" id="snl-ctrl-timer">—</div>
          <div class="snl-ctrl-timer-bar"><div class="snl-ctrl-timer-fill" id="snl-ctrl-timer-fill"></div></div>
        </div>
        <div id="snl-ctrl-forfeit"></div>
        <div class="snl-status" id="snl-status">Watching the climb…</div>
        <div id="snl-ctrl-disconnect"></div>
        <div class="snl-forfeit-log" id="snl-forfeit-log">
          <div class="snl-forfeit-log-title">Forfeit Log</div>
          <div class="snl-forfeit-log-list" id="snl-forfeit-log-list"></div>
        </div>
      </div>
    </div>
  </div>`;

  injectStyles();
  const bw = root.querySelector('#snl-board-wrap');
  renderBoard(bw, board, positions);

  const ambSlider   = root.querySelector('#snl-amb');
  const ambPct      = root.querySelector('#snl-amb-pct');
  const vibeSec     = root.querySelector('#snl-vibe-sec');
  const vibeSlider  = root.querySelector('#snl-vibe-slider');
  const vibePct     = root.querySelector('#snl-vibe-pct');
  const vibeTimer   = root.querySelector('#snl-ctrl-timer');
  const vibeFill    = root.querySelector('#snl-ctrl-timer-fill');
  const ctrlForfeit = root.querySelector('#snl-ctrl-forfeit');
  const statusEl    = root.querySelector('#snl-status');
  const logListEl   = root.querySelector('#snl-forfeit-log-list');

  ambSlider.addEventListener('input', () => {
    ambPct.textContent = `${ambSlider.value}%`;
    socket.send({ type: MSG.SNL_VIBE_CTRL, intensity: ambSlider.value / 100, target: 'host' });
  });
  vibeSlider.addEventListener('input', () => {
    vibePct.textContent = `${vibeSlider.value}%`;
    socket.send({ type: MSG.SNL_VIBE_CTRL, intensity: vibeSlider.value / 100, target: 'host' });
  });

  let timerInt = null;
  function startCtrlTimer(secs) {
    vibeSec.style.display = 'block';
    let rem = secs;
    const total = secs;
    vibeTimer.textContent = `${rem}s`;
    vibeFill.style.width = '100%';
    clearInterval(timerInt);
    timerInt = setInterval(() => {
      rem = Math.max(0, rem - 1);
      vibeTimer.textContent = rem > 0 ? `${rem}s` : '—';
      vibeFill.style.width = `${(rem / total) * 100}%`;
      if (rem <= 0) { clearInterval(timerInt); vibeSec.style.display = 'none'; }
    }, 1000);
  }

  const forfeitLog = [];
  function logForfeit(r, tier, category, text) {
    forfeitLog.unshift({ r, tier, category, text });
    paintForfeitLog();
  }
  function paintForfeitLog() {
    if (!logListEl) return;
    logListEl.innerHTML = forfeitLog.length
      ? forfeitLog.map(f => `<div class="snl-log-entry">
          <div class="snl-log-head"><span class="snl-log-name">${name(f.r)}</span><span class="snl-log-tier">T${f.tier}</span></div>
          <div class="snl-log-text">${f.text}</div>
        </div>`).join('')
      : '<div class="snl-log-empty">No forfeits yet</div>';
  }
  function name(r) { return r === 'host' ? state.hostName : r === 'guest' ? state.guestName : (state.guest2Name || 'P3'); }
  paintForfeitLog();

  const onMoveDone = ev => {
    const { tile } = ev.detail;
    if (tile) { positions.host = tile; renderBoard(bw, board, positions); }
  };

  const onForfeitDraw = ev => {
    const { cardIndex, secs } = ev.detail;
    if (typeof cardIndex !== 'number') return;
    forfeitIdx = Math.max(forfeitIdx, cardIndex + 1);
    const card = forfeitDeck[cardIndex];
    if (!card) return;
    if (secs > 0) startCtrlTimer(secs);
    const text = escapeHtml(resolveForfeitText(card, state.seed, cardIndex));
    logForfeit('host', card.tier, card.category, text);
    statusEl.textContent = 'Snake forfeit!';
    // The climber takes the forfeit themselves and acknowledges on their own screen —
    // this is just a read-only mirror for the Controller, so dismissing it is purely local.
    ctrlForfeit.innerHTML = `<div class="snl-forfeit-card">
      <div class="snl-forfeit-tier">Tier ${card.tier} — ${card.category}</div>
      <div class="snl-forfeit-text">${text}</div>
      <button id="snl-ctrl-ack" class="snl-btn-secondary">Got it</button>
    </div>`;
    ctrlForfeit.querySelector('#snl-ctrl-ack').addEventListener('click', () => {
      ctrlForfeit.innerHTML = '';
    });
  };

  let ctrlSkipTimeout = null;
  const onVibeStart = ev => {
    const secs = ev.detail.secs || 10;
    startCtrlTimer(secs);
    vibeSlider.value = 50; vibePct.textContent = '50%';
    socket.send({ type: MSG.SNL_VIBE_CTRL, intensity: 0.5, target: 'host' });
    statusEl.textContent = 'Snake vibe — you\'re driving!';
    // send stop after secs
    clearTimeout(ctrlSkipTimeout);
    ctrlSkipTimeout = setTimeout(() => {
      clearInterval(timerInt);
      vibeSec.style.display = 'none';
      socket.send({ type: MSG.SNL_VIBE_STOP });
    }, (secs + 1) * 1000);
  };

  const onVibeStop = () => { clearInterval(timerInt); vibeSec.style.display = 'none'; };

  // The climber and controller are the only two connections in Watched mode — either one
  // leaving means the session can't continue, so offer a way back to the lobby to restart
  // instead of leaving the controller staring at a board that will never move again.
  const onPeerLeft = () => {
    statusEl.textContent = 'The climber disconnected.';
    const wrap = root.querySelector('#snl-ctrl-disconnect');
    if (!wrap) return;
    wrap.innerHTML = `
      <div class="snl-disconnect-row">
        <span>Climber disconnected.</span>
        <button id="snl-ctrl-return-lobby" class="ghost">Return to Lobby</button>
      </div>`;
    wrap.querySelector('#snl-ctrl-return-lobby').addEventListener('click', () => {
      state.seed = null;
      navigate(`#/session/${state.sessionId}`);
    });
  };

  socket.addEventListener(MSG.SNL_MOVE_DONE,    onMoveDone);
  socket.addEventListener(MSG.SNL_FORFEIT_DRAW, onForfeitDraw);
  socket.addEventListener(MSG.SNL_VIBE_START,   onVibeStart);
  socket.addEventListener(MSG.SNL_VIBE_STOP,    onVibeStop);
  socket.addEventListener('peer_left',          onPeerLeft);

  root.querySelector('#snl-leave').addEventListener('click', () => navigate('#/'));
  window.addEventListener('hashchange', () => {
    clearInterval(timerInt);
    clearTimeout(ctrlSkipTimeout);
    bw.__snlResizeObs?.disconnect();
    socket.removeEventListener(MSG.SNL_MOVE_DONE,    onMoveDone);
    socket.removeEventListener(MSG.SNL_FORFEIT_DRAW, onForfeitDraw);
    socket.removeEventListener(MSG.SNL_VIBE_START,   onVibeStart);
    socket.removeEventListener(MSG.SNL_VIBE_STOP,    onVibeStop);
    socket.removeEventListener('peer_left',          onPeerLeft);
  }, { once: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIMBER (all other roles / modes)
// ─────────────────────────────────────────────────────────────────────────────
function renderClimber(root) {
  const { seed, snlMode, snlBoardSize, snlDensity, snlVibeScale,
          snlFinalRule, snlWinCondition, snlPowerups, snlCoopBetray,
          snlForfeitCards, snlForfeitLines, snlAmbient, snlTapOut,
          playerCount, role, forfeitDuration } = state;

  const board = generateBoard(seed, { boardSize: snlBoardSize, density: snlDensity, coopBetray: snlCoopBetray });
  const { n, snakes, ladders, forfeitTiles, pickupTiles, forkTiles } = board;

  const isSolo    = snlMode === 'solo';
  const isWatched = snlMode === 'watched';

  const forfeitDeck = buildForfeitDeck(seed, snlForfeitCards, snlForfeitLines);
  const powerupDeck = buildPowerupDeck(seed, isSolo || isWatched);

  // In Watched mode only the host (climber) ever runs this view — the guest is a
  // controller, not a co-player, so they must never enter turn rotation or get a token.
  // Treating them as a second role here previously stalled the climber every other turn
  // waiting for a "guest" roll that would never come.
  const roles = (isSolo || isWatched) ? ['host']
    : playerCount === 3 ? ['host', 'guest', 'guest2']
    : ['host', 'guest'];

  const pos       = {};  // positions by role
  const hands     = {};  // powerup hands by role
  const pickCount = {};  // pickup counter per role
  const greased   = {};  // greased rung flag
  const hijackFor = {};  // who hijacked whom
  roles.forEach(r => { pos[r] = 1; hands[r] = []; pickCount[r] = 0; greased[r] = false; hijackFor[r] = null; });

  let turnIndex    = 0;      // server's turnIndex (for rollFor)
  let activeIdx    = 0;      // index into `roles`
  let forfeitIdx   = 0;
  let powerupIdx   = 0;
  let deflect      = false;
  let mirrorNext   = false;
  let mirrorVibeActive = false; // driver-side: true while I'm also feeling the vibe I'm driving
  let loadedDie    = null;
  let extraRoll    = false;  // double move
  let skipNext     = false;
  let dropPending  = false;
  let gameOver     = false;
  let mercyTokens  = 0;
  const FORK_MUTUAL_BETRAY_VIBE_SECS = 180;

  // ── Endurance win condition ── no finish line: play until a player has taken a fixed
  // number of forfeits, then whoever's left under the cap wins. Each client only ever
  // counts its OWN forfeits and broadcasts once it crosses the cap, so this never depends
  // on inferring other players' state from network events.
  const ENDURANCE_FORFEIT_CAP = 5;
  // The Finale vibe (loser gets buzzed when the winner reaches the summit) has no
  // displayed countdown — players stop it themselves. This is just a runaway guard.
  const FINALE_VIBE_SAFETY_CAP_SECS = 3600;
  const isEndurance = snlWinCondition === 'endurance' && !isSolo && !isWatched;
  let myForfeitsTaken = 0;
  const outRoles = new Set();

  function activeRole()   { return roles[activeIdx % roles.length]; }
  function isMyTurn()     { return activeRole() === role; }
  function oppOf(r)       { return roles.find(rr => rr !== r) || 'guest'; }
  // 2P-only mechanics (Deflect, Mirror-assign, snake-vibe driver) need exactly one "other"
  // player automatically — oppOf can't do that with two candidates in a 3P game, so pick
  // whichever other player is currently trailing. Deterministic and identical on every
  // client since it only reads already-synced positions.
  function autoTarget(r) {
    if (roles.length <= 2) return oppOf(r);
    const others = roles.filter(rr => rr !== r);
    return others.reduce((a, b) => (pos[a] <= pos[b] ? a : b));
  }
  function name(r)        { return r === 'host' ? state.hostName : r === 'guest' ? state.guestName : (state.guest2Name || 'P3'); }

  root.innerHTML = `<div class="snl-root">
    <div class="snl-header">
      <span class="snl-title">🐍 Vipers &amp; Vines</span>
      <span class="snl-turn-ind" id="snl-turn-ind"></span>
      <button class="ghost snl-leave" id="snl-leave">Leave</button>
    </div>
    <div id="snl-vibe-banner" class="snl-vibe-banner" style="display:none">
      <div class="snl-vibe-banner-label" id="snl-vibe-banner-label"></div>
      <div class="snl-vibe-banner-time" id="snl-vibe-banner-time">0s</div>
      <div class="snl-vibe-banner-bar"><div class="snl-vibe-banner-fill" id="snl-vibe-banner-fill"></div></div>
      <button id="snl-vibe-skip" class="snl-vibe-skip-btn">Skip ⏭</button>
    </div>
    <div class="snl-body">
      <div id="snl-board-wrap"></div>
      <div class="snl-sidebar">
        <div id="snl-hand" class="snl-hand-wrap"></div>
        ${snlPowerups ? '<div id="snl-active-pu" class="snl-active-pu" style="display:none"></div>' : ''}
        <div class="snl-roll-area">
          <div id="snl-die" class="snl-die">🎲</div>
          <button id="snl-roll-btn" class="snl-btn-primary" disabled>Roll</button>
        </div>
        <div id="snl-status" class="snl-status">—</div>
        <div id="snl-disconnect-wrap"></div>
        <div id="snl-vibe-row" class="snl-vibe-row" style="display:none">
          <label>Intensity <span id="snl-vibe-pct">50%</span></label>
          <input type="range" id="snl-vibe-slider" min="0" max="100" value="50" class="snl-slider">
          <div id="snl-vibe-timer" class="snl-vibe-timer">—</div>
        </div>
        ${isSolo && snlTapOut ? '<button id="snl-tapout" class="snl-btn-danger" style="margin-top:8px">Tap Out</button>' : ''}
        ${isSolo && snlAmbient ? '<div class="snl-amb-row"><label>Ambient <span id="snl-amb-pct">0%</span></label><input type="range" id="snl-amb-slider" min="0" max="100" value="0" class="snl-slider"></div>' : ''}
        ${snlPowerups ? `<div class="snl-forfeit-log" id="snl-powerup-log">
          <div class="snl-forfeit-log-title">Powerup Log</div>
          <div class="snl-forfeit-log-list" id="snl-powerup-log-list"></div>
        </div>` : ''}
        <div class="snl-forfeit-log" id="snl-forfeit-log">
          <div class="snl-forfeit-log-title">Forfeit Log</div>
          <div class="snl-forfeit-log-list" id="snl-forfeit-log-list"></div>
        </div>
      </div>
    </div>
    <div id="snl-modal" class="snl-modal" style="display:none"></div>
  </div>`;

  injectStyles();
  const bw          = root.querySelector('#snl-board-wrap');
  const rollBtn     = root.querySelector('#snl-roll-btn');
  const dieEl       = root.querySelector('#snl-die');
  const statusEl    = root.querySelector('#snl-status');
  const vibeRow     = root.querySelector('#snl-vibe-row');
  const vibeSlider  = root.querySelector('#snl-vibe-slider');
  const vibePctEl   = root.querySelector('#snl-vibe-pct');
  const vibeTimerEl = root.querySelector('#snl-vibe-timer');
  const turnIndEl   = root.querySelector('#snl-turn-ind');
  const modalEl     = root.querySelector('#snl-modal');
  const handEl      = root.querySelector('#snl-hand');
  const bannerEl    = root.querySelector('#snl-vibe-banner');
  const bannerLbl   = root.querySelector('#snl-vibe-banner-label');
  const bannerTime  = root.querySelector('#snl-vibe-banner-time');
  const bannerFill  = root.querySelector('#snl-vibe-banner-fill');
  const bannerSkip  = root.querySelector('#snl-vibe-skip');
  const logListEl   = root.querySelector('#snl-forfeit-log-list');
  const activePuEl  = root.querySelector('#snl-active-pu');
  const puLogListEl = root.querySelector('#snl-powerup-log-list');

  let vibeInt = null;
  let bannerInt = null;
  let vibeOnExpire = null;   // set by startSliderCountdown; skip fast-forwards to this
  let vibeSkipHandler = null; // set by waits that don't go through the slider countdown
  let forkFallbackTimer = null; // auto-resolves a fork-reveal wait if the partner vanishes
  const departedRoles = new Set(); // roles whose socket has disconnected mid-game

  // ── prominent vibe countdown, shown to whoever is being vibed or is driving ──
  function startVibeBanner(secs, label) {
    bannerLbl.textContent = label;
    bannerEl.style.display = 'flex';
    let rem = secs;
    const total = secs;
    bannerTime.textContent = `${rem}s`;
    bannerFill.style.width = '100%';
    clearInterval(bannerInt);
    bannerInt = setInterval(() => {
      rem = Math.max(0, rem - 1);
      bannerTime.textContent = rem > 0 ? `${rem}s` : '0s';
      bannerFill.style.width = `${(rem / total) * 100}%`;
      if (rem <= 0) { clearInterval(bannerInt); bannerEl.style.display = 'none'; }
    }, 1000);
  }
  function stopVibeBanner() {
    clearInterval(bannerInt);
    bannerEl.style.display = 'none';
  }

  // ── skip button on the vibe banner — fast-forwards whichever wait is currently
  // active, covering both the recipient's wait (vibeSkipHandler) and the driver's
  // slider countdown (vibeOnExpire), so testing doesn't require riding out real timers.
  function skipCurrentVibe() {
    if (vibeSkipHandler) { const fn = vibeSkipHandler; vibeSkipHandler = null; fn(); return; }
    if (vibeOnExpire) {
      clearInterval(vibeInt);
      vibeRow.style.display = 'none';
      const fn = vibeOnExpire; vibeOnExpire = null;
      fn();
    }
  }
  bannerSkip.addEventListener('click', skipCurrentVibe);

  // ── persistent forfeit log, visible to every player at the table ──
  const forfeitLog = [];
  function logForfeit(r, tier, category, text) {
    forfeitLog.unshift({ r, tier, category, text });
    paintForfeitLog();
  }
  function paintForfeitLog() {
    if (!logListEl) return;
    logListEl.innerHTML = forfeitLog.length
      ? forfeitLog.map(f => `<div class="snl-log-entry">
          <div class="snl-log-head"><span class="snl-log-name">${name(f.r)}</span><span class="snl-log-tier">T${f.tier}</span></div>
          <div class="snl-log-text">${f.text}</div>
        </div>`).join('')
      : '<div class="snl-log-empty">No forfeits yet</div>';
  }

  // ── win-screen recap of what everyone ELSE had to take during the match ──
  function buildForfeitRecap() {
    const others = forfeitLog.filter(f => f.r !== role);
    if (!others.length) return '';
    return `<div class="snl-finale-recap">
      <div class="snl-finale-recap-title">Forfeits they racked up (${others.length})</div>
      <div class="snl-finale-recap-list">${others.map(f => `<div class="snl-log-entry">
        <div class="snl-log-head"><span class="snl-log-name">${name(f.r)}</span><span class="snl-log-tier">T${f.tier}</span></div>
        <div class="snl-log-text">${f.text}</div>
      </div>`).join('')}</div>
    </div>`;
  }

  // ── powerup log ── every play (self or opponent's) lands here for everyone, so
  // nobody has to wonder what just got played against/around them.
  const powerupLog = [];
  function logPowerupPlay(byRole, id, targetRole) {
    if (!puLogListEl) return;
    const label = POWERUP_INFO[id]?.label || id;
    const targetsOther = ['greased_rung', 'swap', 'hijack'].includes(id);
    const t = targetsOther ? (targetRole || roles.find(rr => rr !== byRole) || byRole) : null;
    powerupLog.unshift({ r: byRole, text: t ? `${label} → ${name(t)}` : label });
    paintPowerupLog();
  }
  function paintPowerupLog() {
    if (!puLogListEl) return;
    puLogListEl.innerHTML = powerupLog.length
      ? powerupLog.map(p => `<div class="snl-log-entry">
          <div class="snl-log-head"><span class="snl-log-name">${name(p.r)}</span></div>
          <div class="snl-log-text">${p.text}</div>
        </div>`).join('')
      : '<div class="snl-log-empty">No powerups played yet</div>';
  }

  // ── active powerup effects ── shows what's currently armed for ME: lingering
  // powerups (deflect/mirror/loaded die/double move) are only ever tracked on the
  // arming player's own client, and greased/hijack are tracked on every client for
  // whoever they target — either way this always reflects MY OWN current state.
  function paintActivePowerups() {
    if (!activePuEl) return;
    const badges = [];
    if (deflect) badges.push('🪞 Deflect armed');
    if (mirrorNext) badges.push('🪩 Mirror armed');
    if (loadedDie !== null) badges.push(`🎲 Loaded Die: ${loadedDie}`);
    if (extraRoll) badges.push('⏩ Double Move pending');
    if (greased[role]) badges.push('🪤 Your next ladder is greased');
    if (hijackFor[role]) badges.push(`🎛 ${name(hijackFor[role])} drives your next vibe`);
    activePuEl.style.display = badges.length ? 'flex' : 'none';
    activePuEl.innerHTML = badges.map(b => `<span class="snl-pu-badge">${b}</span>`).join('');
  }

  // ── solo ambient ──
  if (isSolo && snlAmbient) {
    const sl = root.querySelector('#snl-amb-slider');
    const pc = root.querySelector('#snl-amb-pct');
    sl?.addEventListener('input', () => { pc.textContent = `${sl.value}%`; haptics.pulse(sl.value / 100, 500); });
  }
  if (isSolo && snlTapOut) {
    root.querySelector('#snl-tapout')?.addEventListener('click', () => {
      haptics.stopAll();
      showModal(`<div class="snl-forfeit-card"><div class="snl-forfeit-tier">Tapped Out</div><div class="snl-forfeit-text">You gave in.</div><button id="snl-back" class="snl-btn-primary">Back to Lobby</button></div>`);
      modalEl.querySelector('#snl-back')?.addEventListener('click', () => navigate('#/'));
    });
  }

  function setStatus(m) { statusEl.textContent = m; }
  function showModal(h)  { modalEl.innerHTML = h; modalEl.style.display = 'flex'; }
  // Lets the remaining player(s) restart instead of being stuck forever once someone leaves —
  // the session/socket stay alive, so returning to the lobby lets the host start a fresh game.
  function renderDisconnectBanner() {
    const wrap = root.querySelector('#snl-disconnect-wrap');
    if (!wrap) return;
    if (departedRoles.size === 0 || gameOver) { wrap.innerHTML = ''; return; }
    const names = [...departedRoles].map(r => name(r)).join(', ');
    wrap.innerHTML = `
      <div class="snl-disconnect-row">
        <span>${escapeHtml(names)} disconnected.</span>
        <button id="snl-return-lobby-btn" class="ghost">Return to Lobby</button>
      </div>`;
    wrap.querySelector('#snl-return-lobby-btn').addEventListener('click', () => {
      haptics.stopAll();
      state.seed = null;
      navigate(`#/session/${state.sessionId}`);
    });
  }
  function hideModal()   { modalEl.innerHTML = ''; modalEl.style.display = 'none'; }
  function repaintBoard(){ renderBoard(bw, board, pos); }

  function paintHand() {
    const h = hands[role] || [];
    handEl.innerHTML = h.length
      ? h.map((id, i) => `<button class="snl-powerup-btn" data-i="${i}" title="${POWERUP_INFO[id]?.desc||''}">${POWERUP_INFO[id]?.label||id}</button>`).join('')
      : '<div class="snl-hand-empty">No powerups</div>';
    handEl.querySelectorAll('.snl-powerup-btn').forEach(b => {
      b.addEventListener('click', () => { if (isMyTurn()) playPowerup(+b.dataset.i); });
    });
  }

  function paintTurnInd() {
    const ar = activeRole();
    turnIndEl.textContent = ar === role ? 'Your turn' : `${name(ar)}'s turn`;
    turnIndEl.className = 'snl-turn-ind' + (ar === role ? ' snl-my-turn' : '');
    rollBtn.disabled = !(isMyTurn() || extraRoll) || gameOver;
    paintActivePowerups();
  }

  // ── I-drive-opponent slider (for snake victim, I drive; for ladder, I drive) ──
  // The victim is always the active player whose turn triggered this vibe — using
  // activeRole() (rather than oppOf) keeps this correct in 3-player games too.
  vibeSlider.addEventListener('input', () => {
    vibePctEl.textContent = `${vibeSlider.value}%`;
    const intensity = vibeSlider.value / 100;
    socket.send({ type: MSG.SNL_VIBE_CTRL, intensity, target: activeRole() });
    if (mirrorVibeActive) haptics.setForfeitIntensity(intensity);
  });

  function startSliderCountdown(secs, onExpire) {
    clearInterval(vibeInt);
    let rem = secs;
    vibeRow.style.display = 'block';
    vibeTimerEl.textContent = `${rem}s`;
    vibeOnExpire = onExpire;
    vibeInt = setInterval(() => {
      rem = Math.max(0, rem - 1);
      vibeTimerEl.textContent = rem > 0 ? `${rem}s` : '—';
      if (rem <= 0) {
        clearInterval(vibeInt);
        vibeRow.style.display = 'none';
        const cb = vibeOnExpire; vibeOnExpire = null;
        if (cb) cb();
      }
    }, 1000);
  }

  // ── forfeit modal ── shown on every client, but only the player actually taking the
  // forfeit needs to acknowledge; everyone else is just watching and can dismiss freely.
  // (Previously required BOTH players to click before play could continue — if the
  // witness never clicked, the recipient's turn stalled forever.)
  function showForfeitModal(card, cardIdx, roleLabel, onDone) {
    const text = escapeHtml(resolveForfeitText(card, seed, cardIdx));
    logForfeit(roleLabel, card.tier, card.category, text);
    const isRecipient = roleLabel === role;
    showModal(`<div class="snl-forfeit-card">
      <div class="snl-forfeit-cat">${card.category}</div>
      <div class="snl-forfeit-tier">Tier ${card.tier}</div>
      <div class="snl-forfeit-text">${text}</div>
      ${!isRecipient ? `<div style="font-size:.78em;color:#6b7280">${name(roleLabel)} takes this.</div>` : ''}
      <button id="snl-fack" class="snl-btn-${isRecipient ? 'primary' : 'secondary'}">${isRecipient ? "I'll do it ✓" : 'Got it'}</button>
    </div>`);
    modalEl.querySelector('#snl-fack').addEventListener('click', () => {
      hideModal();
      if (isRecipient) onDone();
    });
  }

  // ── draw forfeit ──
  function drawForfeit() {
    const idx = forfeitIdx++;
    return { card: forfeitDeck[idx % forfeitDeck.length] || forfeitDeck[0], idx };
  }

  // ── pickup ──
  function tryPickup(r) {
    pickCount[r]++;
    const myP = pos[r], maxP = Math.max(...roles.map(rr => pos[rr]));
    const threshold = (myP >= maxP) ? 3 : 2;
    // Rewards the 1st landing, then every `threshold` landings after that — pickCount
    // starting the modulo at 1 meant the very first star ever collected always yielded
    // nothing, and with only a handful of pickup tiles on the board that often meant none.
    if ((pickCount[r] - 1) % threshold !== 0 || powerupIdx >= powerupDeck.length) return null;
    return powerupDeck[powerupIdx++];
  }

  // ── powerup ──
  function playPowerup(idx) {
    const id = hands[role][idx];
    if (!id) return;
    hands[role].splice(idx, 1);
    socket.send({ type: MSG.SNL_POWERUP, puId: id });
    applyPowerup(id, role, null);
    logPowerupPlay(role, id, null);
    paintHand();
  }

  function applyPowerup(id, byRole, targetRole) {
    const t = targetRole || roles.find(rr => rr !== byRole) || byRole;
    switch (id) {
      case 'loaded_die':
        if (byRole === role) showDiePicker(v => { loadedDie = v; setStatus(`Loaded Die: will roll ${v}.`); paintActivePowerups(); });
        break;
      case 'greased_rung':
        greased[t] = true;
        if (byRole === role) setStatus(`Greased rung on ${name(t)}!`);
        break;
      case 'swap':
        [pos[byRole], pos[t]] = [pos[t], pos[byRole]];
        repaintBoard();
        if (byRole === role) setStatus(`Swapped with ${name(t)}!`);
        break;
      case 'double_move':
        if (byRole === role) { extraRoll = true; setStatus('Double Move — take another roll!'); paintTurnInd(); }
        break;
      case 'hijack':
        hijackFor[t] = byRole;
        if (byRole === role) setStatus(`Hijacked ${name(t)}'s next snake!`);
        break;
      case 'deflect':
        if (byRole === role) { deflect = true; setStatus('Deflect armed — bounces your next snake.'); }
        break;
      case 'mirror':
        if (byRole === role) { mirrorNext = true; setStatus('Mirror active — your next forfeit hits both.'); }
        break;
    }
    paintActivePowerups();
  }

  function showDiePicker(cb) {
    showModal(`<div class="snl-forfeit-card"><div class="snl-forfeit-tier">Loaded Die 🎲</div>
      <div class="snl-forfeit-text">Choose your roll:</div>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:10px">
        ${[1,2,3,4,5,6].map(v => `<button class="snl-btn-primary snl-die-pick" data-v="${v}" style="width:36px;padding:5px">${v}</button>`).join('')}
      </div></div>`);
    modalEl.querySelectorAll('.snl-die-pick').forEach(b => b.addEventListener('click', () => { hideModal(); cb(+b.dataset.v); }));
  }

  // ── turn advance ──
  function advanceTurn() {
    if (skipNext && roles[(activeIdx + 1) % roles.length] === role) {
      skipNext = false;
      activeIdx++;
      setStatus('You skip this turn (Surrender).');
      advanceTurn();
      return;
    }
    activeIdx++;
    extraRoll = false;
    paintTurnInd();
    setStatus(isMyTurn() ? 'Your turn — roll!' : `${name(activeRole())}'s turn.`);
  }

  // ── after resolution ── only called on ACTIVE PLAYER's client ──
  function afterResolution() {
    if (gameOver) return;
    const r = role;
    paintActivePowerups();

    // Surrender "drop 5" pending
    if (dropPending) { dropPending = false; pos[r] = Math.max(1, pos[r] - 5); repaintBoard(); setStatus('Dropped back 5 tiles.'); }

    // Check win
    if (pos[r] >= n) { triggerWin(); return; }

    // Broadcast final position — tag whether a Double Move is still pending so other
    // clients don't advance the turn pointer while the mover keeps rolling.
    socket.send({ type: MSG.SNL_MOVE_DONE, tile: pos[r], final: true, extra: extraRoll });

    // Extra roll (double move)?
    if (extraRoll) { extraRoll = false; rollBtn.disabled = false; setStatus('Double Move — roll again!'); return; }

    advanceTurn();
  }

  function triggerWin() {
    gameOver = true;
    rollBtn.disabled = true;
    haptics.winPattern();
    socket.send({ type: 'final', value: pos[role], vibeSeconds: 0 });
    showFinaleDriver();
  }

  // ── winner's Finale driver ── shows what the loser(s) racked up, then hands the
  // winner manual, timer-free control of their vibe (intensity + pattern, start/stop)
  // until the winner decides to end it for everyone via Finish.
  function showFinaleDriver() {
    let finIntensity = 0.5;
    let finPattern = 'steady';
    let finActive = false;
    const targets = roles.filter(r => r !== role);
    const sendCtrl = () => targets.forEach(t => socket.send({ type: MSG.SNL_VIBE_CTRL, intensity: finIntensity, pattern: finPattern, target: t }));
    const sendStop = () => targets.forEach(t => socket.send({ type: MSG.SNL_VIBE_STOP, target: t }));

    showModal(`<div class="snl-forfeit-card">
      <div class="snl-forfeit-tier">🏆 Summit reached — you win!</div>
      ${buildForfeitRecap()}
      <div class="snl-finale-driver">
        <label>Intensity <span id="snl-fin-pct">50%</span></label>
        <input type="range" id="snl-fin-slider" min="0" max="100" value="50" class="snl-slider">
        <div class="snl-finale-pattern-row">
          <button type="button" class="snl-fin-pattern selected" data-p="steady">Steady</button>
          <button type="button" class="snl-fin-pattern" data-p="pulse">Pulse</button>
          <button type="button" class="snl-fin-pattern" data-p="wave">Wave</button>
        </div>
        <div class="snl-finale-driver-btns">
          <button id="snl-fin-start" class="snl-btn-primary">Start</button>
          <button id="snl-fin-stop" class="snl-btn-secondary">Stop</button>
        </div>
      </div>
      <button id="snl-fin-finish" class="snl-btn-primary" style="margin-top:14px">Finish → Results</button>
    </div>`);

    const slider = modalEl.querySelector('#snl-fin-slider');
    const pctEl  = modalEl.querySelector('#snl-fin-pct');
    slider.addEventListener('input', () => {
      finIntensity = slider.value / 100;
      pctEl.textContent = `${slider.value}%`;
      if (finActive) sendCtrl();
    });
    modalEl.querySelectorAll('.snl-fin-pattern').forEach(btn => {
      btn.addEventListener('click', () => {
        finPattern = btn.dataset.p;
        modalEl.querySelectorAll('.snl-fin-pattern').forEach(b => b.classList.toggle('selected', b === btn));
        if (finActive) sendCtrl();
      });
    });
    modalEl.querySelector('#snl-fin-start').addEventListener('click', () => { finActive = true; sendCtrl(); });
    modalEl.querySelector('#snl-fin-stop').addEventListener('click', () => { finActive = false; sendStop(); });
    modalEl.querySelector('#snl-fin-finish').addEventListener('click', () => {
      finActive = false;
      sendStop();
      haptics.stopAll();
      socket.send({ type: MSG.SNL_FINALE_DONE });
      navigate('#/results');
    });
  }

  // Call whenever I personally take a forfeit card; no-op unless Endurance mode is active.
  function noteMyForfeitTaken() {
    if (!isEndurance || gameOver || outRoles.has(role)) return;
    myForfeitsTaken++;
    if (myForfeitsTaken >= ENDURANCE_FORFEIT_CAP) {
      outRoles.add(role);
      socket.send({ type: MSG.SNL_ENDURANCE_OUT, role });
      checkEnduranceEnd();
    }
  }

  function checkEnduranceEnd() {
    if (gameOver || outRoles.size < roles.length - 1) return;
    const survivor = roles.find(r => !outRoles.has(r));
    if (survivor === role) triggerEnduranceWin();
    else triggerEnduranceLoss();
  }

  function triggerEnduranceWin() {
    gameOver = true;
    rollBtn.disabled = true;
    haptics.winPattern();
    socket.send({ type: 'final', value: pos[role], vibeSeconds: 0 });
    showModal(`<div class="snl-forfeit-card">
      <div class="snl-forfeit-tier">🏆 Last one standing!</div>
      <div class="snl-forfeit-text">Everyone else tapped out — you win!</div>
      ${buildForfeitRecap()}
      <button id="snl-results" class="snl-btn-primary">Results →</button>
    </div>`);
    modalEl.querySelector('#snl-results')?.addEventListener('click', () => { haptics.stopAll(); navigate('#/results'); });
  }

  function triggerEnduranceLoss() {
    if (gameOver) return;
    gameOver = true;
    rollBtn.disabled = true;
    haptics.losePattern();
    const secs = forfeitDuration || 30;
    haptics.startForfeitVibe(secs);
    socket.send({ type: 'final', value: pos[role], vibeSeconds: secs });
    showModal(`<div class="snl-forfeit-card">
      <div class="snl-forfeit-tier">You tapped out.</div>
      <div class="snl-forfeit-text">${ENDURANCE_FORFEIT_CAP} forfeits was your limit — vibe for ${secs}s…</div>
      <button id="snl-results" class="snl-btn-primary" style="margin-top:14px">Results →</button>
    </div>`);
    modalEl.querySelector('#snl-results')?.addEventListener('click', () => { haptics.stopAll(); navigate('#/results'); });
  }

  function triggerFinale(winnerRole) {
    // called on opponents when they receive final from winner — the winner now drives
    // this vibe directly (intensity/pattern/start/stop, no fixed duration) via their
    // own Finale panel; this side just receives it and can only kill it locally as a
    // safety fallback. Navigation to results is triggered by the winner's Finish action.
    gameOver = true;
    rollBtn.disabled = true;
    haptics.losePattern();
    socket.send({ type: 'final', value: pos[role], vibeSeconds: 0 });
    // oppOf(role) is only a fallback for a stale peer that hasn't sent its role yet —
    // with 2 non-winners in a 3P game it can name the wrong one, so prefer the real
    // sender role the server now attaches to opp_final.
    const winnerName = name(winnerRole || oppOf(role));
    showModal(`<div class="snl-forfeit-card">
      <div class="snl-forfeit-tier">🏆 ${winnerName} reached the summit!</div>
      <div class="snl-forfeit-text">They're driving your vibe now — no timer, they'll end it when you're both done.</div>
      <button id="snl-finale-selfstop" class="snl-btn-secondary" style="margin-top:10px">Stop My Vibe</button>
    </div>`);
    modalEl.querySelector('#snl-finale-selfstop')?.addEventListener('click', ev => {
      haptics.stopAll();
      ev.currentTarget.disabled = true;
      ev.currentTarget.textContent = 'Stopped ✓';
    });
  }

  // ── resolve landing ── only active player calls this ──
  function resolveLanding(tile) {
    pos[role] = tile;
    repaintBoard();

    // Pickup
    if (pickupTiles.has(tile) && snlPowerups) {
      const puId = tryPickup(role);
      if (puId) {
        socket.send({ type: MSG.SNL_POWERUP, puId, draw: true });
        if (hands[role].length >= 3) {
          showModal(`<div class="snl-forfeit-card"><div class="snl-forfeit-tier">Powerup!</div>
            <div class="snl-forfeit-text"><b>${POWERUP_INFO[puId]?.label||puId}</b> drawn but hand full. Discard:</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:8px">
              ${hands[role].map((id, i) => `<button class="snl-btn-secondary snl-disc" data-i="${i}">${POWERUP_INFO[id]?.label||id}</button>`).join('')}
              <button class="snl-btn-secondary" id="snl-disc-new">Discard new</button>
            </div></div>`);
          modalEl.querySelectorAll('.snl-disc').forEach(b => b.addEventListener('click', () => { hands[role].splice(+b.dataset.i, 1, puId); paintHand(); hideModal(); }));
          modalEl.querySelector('#snl-disc-new')?.addEventListener('click', hideModal);
        } else {
          hands[role].push(puId); paintHand();
          setStatus(`Picked up: ${POWERUP_INFO[puId]?.label||puId}`);
        }
      }
    }

    // Fork — needs a real partner, so it's 2P/3P only. autoTarget() falls back to a
    // literal 'guest' role when roles has no other entry (solo's roles is just
    // ['host']), which used to be masked by the old proximity check finding nobody —
    // without this guard Fork would fire in solo against a partner that doesn't exist.
    if (forkTiles.has(tile) && snlCoopBetray && !isSolo && !isWatched) {
      doFork(tile);
      return;
    }

    // Forfeit tile — always draws a card, no vibe
    if (forfeitTiles.has(tile)) {
      doForfeitTile();
      return;
    }

    // Snake
    if (snakes[tile] !== undefined) {
      const tail = snakes[tile];
      const tier = Math.min(3, tierFor(tile - tail, tile, n));

      if (deflect) {
        deflect = false;
        const opp = autoTarget(role);
        pos[opp] = Math.max(1, pos[opp] - (tile - tail));
        repaintBoard();
        socket.send({ type: MSG.SNL_MOVE_DONE, tile: pos[opp], final: false, targetRole: opp });
        setStatus(`Deflect! ${name(opp)} takes the snake instead.`);
        doDeflectedSnake(opp, tile, tail);
        return;
      }
      if (hands[role].includes('antivenom')) {
        hands[role].splice(hands[role].indexOf('antivenom'), 1);
        paintHand();
        socket.send({ type: MSG.SNL_POWERUP, puId: 'antivenom' });
        setStatus('Antivenom blocked the snake!');
        afterResolution();
        return;
      }
      pos[role] = tail;
      repaintBoard();
      doSnake(tile, tail, tier);
      return;
    }

    // Ladder
    if (ladders[tile] !== undefined) {
      const top = ladders[tile];
      if (greased[role]) {
        greased[role] = false;
        setStatus('Greased Rung! Ladder disabled.');
        afterResolution();
        return;
      }
      pos[role] = top;
      repaintBoard();
      doLadder(tile, top, top - tile);
      return;
    }

    // Normal tile
    afterResolution();
  }

  // ── snake resolution ── vipers are always a vibe now; forfeit cards only come
  // from Forfeit tiles (🎴) — see doForfeitTile.
  function doSnake(head, tail, tier) {
    setStatus(`Snake! Fell from ${head} to ${tail}. Tier ${tier}.`);
    const hijacker = hijackFor[role];
    if (hijacker) hijackFor[role] = null;

    const secs = calcVibeSeconds(head - tail, head, n, snlVibeScale);

    if (isSolo) {
      haptics.startForfeitVibe(secs);
      startVibeBanner(secs, '🐍 Snake vibe!');
      setStatus(`Snake vibe — ${secs}s!`);
      const finish = () => { vibeSkipHandler = null; stopVibeBanner(); haptics.stopAll(); afterResolution(); };
      const t = setTimeout(finish, secs * 1000);
      vibeSkipHandler = () => { clearTimeout(t); finish(); };
      return;
    }

    const driver = hijacker || autoTarget(role);
    const mirrored = mirrorNext;
    if (mirrored) mirrorNext = false;
    haptics.startForfeitVibe(secs);
    startVibeBanner(secs, mirrored
      ? `🐍 ${name(driver)} is driving your vibe — Mirror! They'll feel it too`
      : `🐍 ${name(driver)} is driving your vibe`);
    setStatus(`Snake vibe — ${secs}s. ${name(driver)} drives.${mirrored ? ' (Mirrored)' : ''}`);
    // Tell the driver to show their slider via SNL_VIBE_START — targeted so that in a
    // 3-player game only the intended driver reacts, not every other player. `mirror`
    // tells the driver's client to also run its own local vibe at whatever intensity
    // it's dishing out, instead of just controlling mine.
    socket.send({ type: MSG.SNL_VIBE_START, secs, target: driver, mirror: mirrored });
    // Send immediate position update so opponent board reflects snake fall
    socket.send({ type: MSG.SNL_MOVE_DONE, tile: pos[role], final: false });
    // Advance turn when we receive SNL_VIBE_STOP
    const onStop = () => {
      vibeSkipHandler = null;
      haptics.stopAll();
      stopVibeBanner();
      afterResolution();
    };
    const onRemoteStop = () => { clearTimeout(fallback); onStop(); };
    // fallback timeout in case the stop message is lost
    const fallback = setTimeout(() => {
      socket.removeEventListener(MSG.SNL_VIBE_STOP, onRemoteStop);
      onStop();
    }, (secs + 6) * 1000);
    socket.addEventListener(MSG.SNL_VIBE_STOP, onRemoteStop, { once: true });
    vibeSkipHandler = () => {
      clearTimeout(fallback);
      socket.removeEventListener(MSG.SNL_VIBE_STOP, onRemoteStop);
      socket.send({ type: MSG.SNL_VIBE_STOP });
      onStop();
    };
  }

  // ── deflected snake ── Deflect bounces the fall (and its vibe) onto `target`; the
  // deflecting player stays safe and drives the punishment instead of receiving it.
  function doDeflectedSnake(target, head, tail) {
    const secs = calcVibeSeconds(head - tail, head, n, snlVibeScale);
    vibeSlider.value = 50; vibePctEl.textContent = '50%';
    socket.send({ type: MSG.SNL_VIBE_CTRL, intensity: 0.5, target });
    startVibeBanner(secs, `🐍 Deflected! You're driving ${name(target)}'s vibe`);
    startSliderCountdown(secs, () => {
      socket.send({ type: MSG.SNL_VIBE_STOP, target });
      stopVibeBanner();
      afterResolution();
    });
  }

  // ── forfeit tile resolution (🎴 — always a card, never vibe) ──
  function doForfeitTile() {
    setStatus('Forfeit tile!');
    const { card, idx } = drawForfeit();
    if (!card) { afterResolution(); return; }
    socket.send({ type: MSG.SNL_FORFEIT_DRAW, cardIndex: idx, secs: 0 });
    if (mirrorNext) {
      mirrorNext = false;
      socket.send({ type: MSG.SNL_FORFEIT_ASSIGN, cardIndex: idx, target: autoTarget(role) });
    }
    noteMyForfeitTaken();
    if (gameOver) return;
    showForfeitModal(card, idx, role, afterResolution);
  }

  // ── ladder resolution ──
  function doLadder(bottom, top, dist) {
    if (isSolo) {
      haptics.stopAll(); mercyTokens++;
      setStatus(`Vine! ${bottom} → ${top}. Relief. Mercy tokens: ${mercyTokens}.`);
      afterResolution();
      return;
    }
    if (isWatched) {
      socket.send({ type: MSG.SNL_VIBE_CTRL, intensity: 0.1, target: 'guest' });
      setStatus(`Vine! ${bottom} → ${top}. Controller eases off…`);
      setTimeout(afterResolution, 1500);
      return;
    }
    const secs = calcVibeSeconds(dist, top, n, snlVibeScale);
    const target = playerCount === 3 ? null : oppOf(role);
    if (target === null) {
      pickTarget(t => showLadderChoice(t, secs, dist, bottom));
    } else {
      showLadderChoice(target, secs, dist, bottom);
    }
  }

  function pickTarget(cb) {
    const opts = roles.filter(rr => rr !== role)
      .map(rr => `<button class="snl-btn-secondary snl-target" data-r="${rr}">${name(rr)}</button>`).join('');
    showModal(`<div class="snl-forfeit-card"><div class="snl-forfeit-tier">Ladder — punish who?</div>
      <div style="display:flex;gap:10px;justify-content:center;margin:12px 0">${opts}</div></div>`);
    modalEl.querySelectorAll('.snl-target').forEach(b => b.addEventListener('click', () => { hideModal(); cb(b.dataset.r); }));
  }

  function showLadderChoice(target, secs, dist, bottom) {
    showModal(`<div class="snl-forfeit-card">
      <div class="snl-forfeit-tier">Vine! ${bottom} → ${bottom + dist} 🪜</div>
      <div class="snl-forfeit-text">Drive ${name(target)}'s vibe for ${secs}s:</div>
      <button id="snl-lv" class="snl-btn-primary" style="margin-top:10px">Start Vibe ▶</button>
    </div>`);

    modalEl.querySelector('#snl-lv').addEventListener('click', () => {
      hideModal();
      vibeSlider.value = 50; vibePctEl.textContent = '50%';
      socket.send({ type: MSG.SNL_VIBE_CTRL, intensity: 0.5, target });
      startVibeBanner(secs, `🪜 You're driving ${name(target)}'s vibe`);
      startSliderCountdown(secs, () => {
        socket.send({ type: MSG.SNL_VIBE_STOP, target });
        stopVibeBanner();
        afterResolution();
      });
    });
  }

  // ── fork tile ──
  let _forkDone = null;
  function doFork(tile) {
    // No proximity requirement — the fork partner is whoever autoTarget picks
    // (the other player in 2P, or the trailing player in 3P), wherever they are.
    const near = autoTarget(role);
    if (!near) { afterResolution(); return; }
    // The partner's client otherwise never learns the lander landed on the fork tile
    // (resolveLanding only updates local state) — without this, the coop-reveal math
    // below runs from a stale base position on the partner's screen and the two
    // clients end up disagreeing about where the lander actually is.
    socket.send({ type: MSG.SNL_MOVE_DONE, tile: pos[role], final: false });
    showModal(`<div class="snl-forfeit-card">
      <div class="snl-forfeit-tier">Fork 🔱</div>
      <div class="snl-forfeit-text">Cooperate or Betray ${name(near)}?</div>
      <div style="display:flex;gap:12px;justify-content:center;margin:14px 0">
        <button id="snl-fcoop" class="snl-btn-primary">Cooperate</button>
        <button id="snl-fbetr" class="snl-btn-secondary">Betray</button>
      </div></div>`);
    _forkDone = afterResolution;
    const go = c => {
      hideModal();
      socket.send({ type: MSG.SNL_COOP_CHOICE, choice: c, target: near });
      setStatus('Waiting for response…');
      // If the fork partner vanishes their reveal can never arrive — fall back to a
      // neutral "cooperate" outcome after a generous wait so the turn doesn't hang forever.
      clearTimeout(forkFallbackTimer);
      forkFallbackTimer = setTimeout(() => {
        if (!_forkDone) return; // already resolved by a real reveal
        const fn = _forkDone; _forkDone = null;
        setStatus(`${name(near)} didn't respond — treating it as cooperate.`);
        pos[role] = Math.min(n - 1, pos[role] + 5);
        repaintBoard();
        fn();
      }, 30_000);
    };
    modalEl.querySelector('#snl-fcoop').addEventListener('click', () => go('cooperate'));
    modalEl.querySelector('#snl-fbetr').addEventListener('click', () => go('betray'));
  }

  // ── roll ──
  function doRoll(ti) {
    const die = (loadedDie !== null) ? loadedDie : rollFor(seed, ti);
    loadedDie = null;
    dieEl.textContent = ['', '⚀','⚁','⚂','⚃','⚄','⚅'][die] || String(die);
    setStatus(`Rolled ${die}`);
    const rawPos = pos[role] + die;
    let newPos;
    if (snlFinalRule === 'exact' && rawPos > n) {
      newPos = Math.max(1, n - (rawPos - n)); // bounce back from finish
    } else {
      newPos = Math.min(n, rawPos);
    }
    resolveLanding(newPos);
  }

  rollBtn.addEventListener('click', () => {
    if ((!isMyTurn() && !extraRoll) || gameOver) return;
    rollBtn.disabled = true;
    socket.send({ type: MSG.SNL_ROLL_READY });
  });

  // ─── socket listeners ──────────────────────────────────────────────────────

  const onRollGo = ev => {
    const ti = ev.detail.turnIndex;
    turnIndex = ti;
    if (isMyTurn() || isSolo) {
      doRoll(ti);
    }
  };

  // Position sync from active player's afterResolution
  const onMoveDone = ev => {
    const { role: r, tile, final: isFinal, extra } = ev.detail;
    if (!r || !tile) return;
    pos[r] = tile;
    repaintBoard();
    if (isFinal && !extra && r === activeRole() && r !== role) {
      advanceTurn();
    }
  };

  const onPowerup = ev => {
    const { role: r, puId, draw, target } = ev.detail;
    if (!puId) return;
    if (draw) { if (r !== role && hands[r]) hands[r].push(puId); return; }
    applyPowerup(puId, r, target);
    logPowerupPlay(r, puId, target);
    if (r === role) paintHand();
  };

  // Opponent draws a forfeit — witness modal
  const onForfeitDraw = ev => {
    const { cardIndex, secs } = ev.detail;
    if (typeof cardIndex !== 'number') return;
    forfeitIdx = Math.max(forfeitIdx, cardIndex + 1);
    const card = forfeitDeck[cardIndex];
    if (!card) return;
    if (secs > 0 && !isSolo) {
      // I might be the driver (opponent vibing)
    }
    showForfeitModal(card, cardIndex, activeRole(), () => {});
  };

  // Ladder-assigned forfeit — logged for everyone, but only the target confirms it
  const onForfeitAssign = ev => {
    const { cardIndex, target } = ev.detail;
    if (!target || typeof cardIndex !== 'number') return;
    forfeitIdx = Math.max(forfeitIdx, cardIndex + 1);
    const card = forfeitDeck[cardIndex];
    if (!card) return;
    const text = escapeHtml(resolveForfeitText(card, seed, cardIndex));
    logForfeit(target, card.tier, card.category, text);
    if (target !== role) return;
    noteMyForfeitTaken();
    if (gameOver) return;
    showModal(`<div class="snl-forfeit-card">
      <div class="snl-forfeit-cat">${card.category}</div>
      <div class="snl-forfeit-tier">Tier ${card.tier} — Ladder punishment!</div>
      <div class="snl-forfeit-text">${text}</div>
      <button id="snl-fass-ok" class="snl-btn-primary">Accept ✓</button>
    </div>`);
    modalEl.querySelector('#snl-fass-ok').addEventListener('click', () => hideModal());
  };

  // Active player's snake started — I'm the driver, show the slider
  const onVibeStart = ev => {
    if (ev.detail.target && ev.detail.target !== role) return; // someone else drives this one
    const secs = ev.detail.secs || 10;
    mirrorVibeActive = !!ev.detail.mirror;
    vibeSlider.value = 50; vibePctEl.textContent = '50%';
    if (mirrorVibeActive) haptics.startForfeitVibe(secs); // Mirror: I feel what I dish out
    startVibeBanner(secs, mirrorVibeActive
      ? `🐍 ${name(activeRole())} hit a snake — Mirror! You're driving AND feeling it`
      : `🐍 ${name(activeRole())} hit a snake — you're driving!`);
    startSliderCountdown(secs, () => {
      socket.send({ type: MSG.SNL_VIBE_STOP });
      if (mirrorVibeActive) { haptics.stopAll(); mirrorVibeActive = false; }
      stopVibeBanner();
    });
    setStatus(`${name(activeRole())} hit a snake — drive the vibe!${mirrorVibeActive ? ' (Mirrored — you feel it too)' : ''}`);
  };

  // Driver is controlling my vibe intensity (I'm the victim being vibed). The generous
  // safety-cap start (rather than a short default) is what lets the Finale driver run
  // open-ended — every other flow here always sends its own SNL_VIBE_STOP well before
  // that cap would matter, so this only changes behavior for the untimed Finale case.
  const onVibeCtrl = ev => {
    if (!haptics.isForfeitActive()) haptics.addForfeitSeconds(FINALE_VIBE_SAFETY_CAP_SECS);
    haptics.setForfeitIntensity(ev.detail.intensity || 0);
    if (ev.detail.pattern) haptics.setWaveVibeMode(ev.detail.pattern === 'wave');
  };

  // Vibe ended — stop haptics (I'm victim) and hide slider (I'm driver)
  const onVibeStop = ev => {
    haptics.stopAll();
    mirrorVibeActive = false;
    clearInterval(vibeInt);
    vibeRow.style.display = 'none';
    stopVibeBanner();
  };

  // Fork — active player chose; I respond (only if I'm the actual fork partner — in a
  // 3-player game the third, uninvolved player must never see or answer this).
  const onCoopChoice = ev => {
    const { role: sr, choice: sc, target } = ev.detail;
    if (target !== role) return;
    showModal(`<div class="snl-forfeit-card">
      <div class="snl-forfeit-tier">Fork 🔱 — Respond!</div>
      <div class="snl-forfeit-text">${name(sr)} chose. Your pick:</div>
      <div style="display:flex;gap:12px;justify-content:center;margin:14px 0">
        <button id="snl-rcoop" class="snl-btn-primary">Cooperate</button>
        <button id="snl-rbetr" class="snl-btn-secondary">Betray</button>
      </div></div>`);
    const respond = mine => {
      hideModal();
      socket.send({ type: MSG.SNL_COOP_REVEAL, landerRole: sr, landerChoice: sc, partnerRole: role, partnerChoice: mine });
    };
    modalEl.querySelector('#snl-rcoop').addEventListener('click', () => respond('cooperate'));
    modalEl.querySelector('#snl-rbetr').addEventListener('click', () => respond('betray'));
  };

  // Fork resolved — both participants know both choices. Named by role (lander/partner)
  // rather than host/guest so this works for any pairing in a 3-player game, and a
  // bystander who isn't part of this fork ignores the reveal entirely.
  const onCoopReveal = ev => {
    const { landerRole, landerChoice, partnerRole, partnerChoice } = ev.detail;
    if (role !== landerRole && role !== partnerRole) return;
    clearTimeout(forkFallbackTimer);
    const my = role === landerRole ? landerChoice : partnerChoice;
    const op = role === landerRole ? partnerChoice : landerChoice;
    const oppRole = role === landerRole ? partnerRole : landerRole;
    hideModal();
    // Both participants' clients run this from the same synced choice pair, so each
    // must apply BOTH players' position changes locally — leaving the opponent's side
    // unset here is what let the two screens drift out of sync after a reveal.
    if (my === 'cooperate' && op === 'cooperate') {
      pos[role] = Math.min(n - 1, pos[role] + 5);
      pos[oppRole] = Math.min(n - 1, pos[oppRole] + 5);
      setStatus('Both cooperated — small mutual climb!');
    } else if (my === 'betray' && op === 'cooperate') {
      pos[oppRole] = Math.max(1, pos[oppRole] - 8);
      pos[role] = Math.min(n - 1, pos[role] + 5);
      setStatus('You betrayed! You climb, they slide.');
    } else if (my === 'cooperate' && op === 'betray') {
      pos[role] = Math.max(1, pos[role] - 8);
      pos[oppRole] = Math.min(n - 1, pos[oppRole] + 5);
      const secs = calcVibeSeconds(8, pos[role], n, snlVibeScale);
      setStatus(`You were betrayed — you slide and vibe for ${secs}s!`);
      haptics.startForfeitVibe(secs);
      startVibeBanner(secs, '🔱 Betrayed!');
    } else {
      // Mutual betrayal is the worst outcome — a bigger slide AND a much longer vibe
      // than being the lone betrayed party, so blind mutual distrust never pays off.
      pos[role] = Math.max(1, pos[role] - 10);
      pos[oppRole] = Math.max(1, pos[oppRole] - 10);
      setStatus(`Both betrayed — worst outcome! Vibe for ${FORK_MUTUAL_BETRAY_VIBE_SECS}s.`);
      haptics.startForfeitVibe(FORK_MUTUAL_BETRAY_VIBE_SECS);
      startVibeBanner(FORK_MUTUAL_BETRAY_VIBE_SECS, '🔱 Mutual betrayal!');
    }
    repaintBoard();
    if (_forkDone) { const fn = _forkDone; _forkDone = null; fn(); }
  };

  const onOppFinal = ev => { if (!gameOver) triggerFinale(ev.detail?.role); };
  // Winner clicked Finish on their Finale panel — everyone else stops vibing and
  // follows them to results, rather than leaving when they individually feel like it.
  const onFinaleDone = () => { haptics.stopAll(); hideModal(); navigate('#/results'); };
  const onEnduranceOut = ev => {
    const r = ev.detail?.role;
    if (r && roles.includes(r) && !outRoles.has(r)) { outRoles.add(r); checkEnduranceEnd(); }
  };
  // Watched mode's controller ('guest') isn't in `roles` (they never take a turn), but the
  // climber still needs to know if their controller vanishes.
  const disconnectableRoles = isWatched ? [...roles, 'guest'] : roles;
  const onPeerLeft = ev => {
    const r = ev.detail?.role;
    if (r && disconnectableRoles.includes(r)) departedRoles.add(r);
    if (!gameOver) setStatus(r ? `${name(r)} disconnected.` : 'A player disconnected.');
    renderDisconnectBanner();
  };
  const onPeerReconnected = ev => {
    const r = ev.detail?.role;
    if (r) departedRoles.delete(r);
    renderDisconnectBanner();
  };

  socket.addEventListener(MSG.SNL_ROLL_GO,        onRollGo);
  socket.addEventListener(MSG.SNL_MOVE_DONE,       onMoveDone);
  socket.addEventListener(MSG.SNL_POWERUP,         onPowerup);
  socket.addEventListener(MSG.SNL_FORFEIT_DRAW,    onForfeitDraw);
  socket.addEventListener(MSG.SNL_FORFEIT_ASSIGN,  onForfeitAssign);
  socket.addEventListener(MSG.SNL_VIBE_START,      onVibeStart);
  socket.addEventListener(MSG.SNL_VIBE_CTRL,       onVibeCtrl);
  socket.addEventListener(MSG.SNL_VIBE_STOP,       onVibeStop);
  socket.addEventListener(MSG.SNL_COOP_CHOICE,     onCoopChoice);
  socket.addEventListener(MSG.SNL_COOP_REVEAL,     onCoopReveal);
  socket.addEventListener(MSG.SNL_ENDURANCE_OUT,   onEnduranceOut);
  socket.addEventListener('opp_final',             onOppFinal);
  socket.addEventListener(MSG.SNL_FINALE_DONE,     onFinaleDone);
  socket.addEventListener('peer_left',             onPeerLeft);
  socket.addEventListener('peer_reconnected',      onPeerReconnected);

  root.querySelector('#snl-leave').addEventListener('click', () => { haptics.stopAll(); navigate('#/'); });
  window.addEventListener('hashchange', () => {
    clearInterval(vibeInt);
    clearInterval(bannerInt);
    clearTimeout(forkFallbackTimer);
    bw.__snlResizeObs?.disconnect();
    haptics.stopAll();
    socket.removeEventListener(MSG.SNL_ROLL_GO,       onRollGo);
    socket.removeEventListener(MSG.SNL_MOVE_DONE,     onMoveDone);
    socket.removeEventListener(MSG.SNL_POWERUP,       onPowerup);
    socket.removeEventListener(MSG.SNL_FORFEIT_DRAW,  onForfeitDraw);
    socket.removeEventListener(MSG.SNL_FORFEIT_ASSIGN,onForfeitAssign);
    socket.removeEventListener(MSG.SNL_VIBE_START,    onVibeStart);
    socket.removeEventListener(MSG.SNL_VIBE_CTRL,     onVibeCtrl);
    socket.removeEventListener(MSG.SNL_VIBE_STOP,     onVibeStop);
    socket.removeEventListener(MSG.SNL_COOP_CHOICE,   onCoopChoice);
    socket.removeEventListener(MSG.SNL_COOP_REVEAL,   onCoopReveal);
    socket.removeEventListener(MSG.SNL_ENDURANCE_OUT, onEnduranceOut);
    socket.removeEventListener('opp_final',           onOppFinal);
    socket.removeEventListener(MSG.SNL_FINALE_DONE,   onFinaleDone);
    socket.removeEventListener('peer_left',           onPeerLeft);
    socket.removeEventListener('peer_reconnected',    onPeerReconnected);
  }, { once: true });

  // ── initial paint ──
  repaintBoard(); paintHand(); paintTurnInd();
  if (isSolo) setStatus('Solo climb — roll!');
  else setStatus(isMyTurn() ? 'Your turn — roll!' : `Waiting for ${name(activeRole())}…`);
}

// Forfeit text can come from a host's free-typed custom forfeit lines and is broadcast to
// every other player, so it must be escaped before landing in innerHTML anywhere.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ─────────────────────────────────────────────────────────────────────────────
// BOARD RENDERER
// ─────────────────────────────────────────────────────────────────────────────
// Assigns each snake/ladder pair a stable colour so a tile's start and end are
// visually linked (border colour) as well as labelled with the destination tile number.
function pairMeta(board) {
  if (board.__snlPairMeta) return board.__snlPairMeta;
  const pairColors = count => Array.from({ length: count },
    (_, i) => `hsl(${Math.round((i * 360) / Math.max(count, 1))},75%,58%)`);

  const snakeEntries = Object.entries(board.snakes).map(([h, t]) => [+h, +t]).sort((a, b) => a[0] - b[0]);
  const ladderEntries = Object.entries(board.ladders).map(([b, t]) => [+b, +t]).sort((a, b) => a[0] - b[0]);
  const snakeColors = pairColors(snakeEntries.length);
  const ladderColors = pairColors(ladderEntries.length);

  const color = {}, tailOfHead = {}, topOfBottom = {};
  snakeEntries.forEach(([head, tail], i) => { color[head] = color[tail] = snakeColors[i]; tailOfHead[tail] = head; });
  ladderEntries.forEach(([bottom, top], i) => { color[bottom] = color[top] = ladderColors[i]; topOfBottom[top] = bottom; });

  board.__snlPairMeta = { color, tailOfHead, topOfBottom };
  return board.__snlPairMeta;
}

function renderBoard(wrap, board, positions) {
  const { n, cols, snakes, ladders, forfeitTiles, pickupTiles, forkTiles } = board;
  const { color, tailOfHead, topOfBottom } = pairMeta(board);
  const rows = Math.ceil(n / cols);
  const cells = [];
  for (let tile = 1; tile <= n; tile++) {
    const { col, row } = tileGridPos(tile, cols);
    const dr = rows - 1 - row;
    let icon = '', cls = 'snl-cell', dest = '', title = '', style = '';
    if (snakes[tile] !== undefined)        { icon = '🐍'; cls += ' snl-snake'; dest = `-${tile - snakes[tile]}`; title = `Viper: ${tile} → ${snakes[tile]} (drop ${tile - snakes[tile]})`; style = `border-color:${color[tile]}`; }
    else if (tailOfHead[tile] !== undefined) { icon = '🐍'; cls += ' snl-snake-tail'; title = `Viper tail — no effect landing here (head is at ${tailOfHead[tile]})`; style = `border-color:${color[tile]}`; }
    else if (ladders[tile] !== undefined)  { icon = '🪜'; cls += ' snl-ladder'; dest = `+${ladders[tile] - tile}`; title = `Vine: ${tile} → ${ladders[tile]} (climb ${ladders[tile] - tile})`; style = `border-color:${color[tile]}`; }
    else if (topOfBottom[tile] !== undefined) { icon = '🪜'; cls += ' snl-ladder-top'; title = `Vine top — no effect landing here (bottom is at ${topOfBottom[tile]})`; style = `border-color:${color[tile]}`; }
    else if (forfeitTiles.has(tile))  { icon = '🎴'; cls += ' snl-forfeit-tile'; }
    else if (pickupTiles.has(tile))   { icon = '⭐'; cls += ' snl-pickup'; }
    else if (forkTiles.has(tile))     { icon = '🔱'; cls += ' snl-fork'; }
    if (tile === n) cls += ' snl-finish';
    const tokens = Object.entries(positions)
      .filter(([, p]) => p === tile)
      .map(([r]) => `<span class="snl-token snl-token-${r}"></span>`)
      .join('');
    const tokenWrap = tokens ? `<span class="snl-tokens">${tokens}</span>` : '';
    const destLabel = dest ? `<span class="snl-tile-dest">${dest}</span>` : '';
    const titleAttr = title ? ` title="${title}"` : '';
    cells.push(`<div class="${cls}" style="grid-column:${col+1};grid-row:${dr+1};${style}"${titleAttr}><span class="snl-tile-num">${tile}</span><span class="snl-tile-icon">${icon}</span>${destLabel}${tokenWrap}</div>`);
  }
  wrap.innerHTML = `<div class="snl-board" style="--snl-cols:${cols};--snl-rows:${rows}">${cells.join('')}</div>`;
  fitBoard(wrap);
  // Attach once per wrap element: keeps the board's pixel size correct across window
  // resizes without depending on CSS container-query support, which some browsers/
  // profiles render inconsistently (seen as a board that collapses to its intrinsic
  // min-content size instead of filling the panel).
  if (!wrap.__snlResizeObs) {
    wrap.__snlResizeObs = new ResizeObserver(() => fitBoard(wrap));
    wrap.__snlResizeObs.observe(wrap);
  }
}

// Sizes the board in px to the largest rectangle that (a) preserves the cols/rows
// aspect ratio and (b) fits fully inside its wrapper — computed from measured pixel
// dimensions rather than CSS aspect-ratio/container-query tricks for reliability.
function fitBoard(wrap) {
  const boardEl = wrap.querySelector('.snl-board');
  if (!boardEl) return;
  const cols = parseFloat(boardEl.style.getPropertyValue('--snl-cols')) || 1;
  const rows = parseFloat(boardEl.style.getPropertyValue('--snl-rows')) || 1;
  const availW = wrap.clientWidth;
  const availH = wrap.clientHeight;
  if (!availW || !availH) return;
  let w = availW, h = (w * rows) / cols;
  if (h > availH) { h = availH; w = (h * cols) / rows; }
  boardEl.style.width = `${Math.floor(w)}px`;
  boardEl.style.height = `${Math.floor(h)}px`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────────────────────
let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
.snl-root{position:fixed;inset:0;display:flex;flex-direction:column;overflow:hidden;background:var(--bg,#1a1a2e);color:#e0e0e0}
.snl-header{display:flex;align-items:center;gap:12px;padding:8px 16px;background:#13131f;border-bottom:1px solid #2a2a4a;flex-shrink:0}
.snl-title{font-weight:700;font-size:1.1em;color:#c084fc}
.snl-turn-ind{font-size:.85em;color:#9ca3af}
.snl-turn-ind.snl-my-turn{color:#86efac;font-weight:600}
.snl-leave{margin-left:auto}
.snl-body{display:flex;gap:10px;flex:1;min-height:0;padding:10px;overflow:hidden}
#snl-board-wrap{flex:1;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
.snl-board{display:grid;grid-template-columns:repeat(var(--snl-cols),1fr);grid-template-rows:repeat(var(--snl-rows),1fr);gap:2px;flex-shrink:0}
.snl-cell{position:relative;border:1px solid #2a2a4a;border-radius:3px;background:#1e1e35;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:clamp(8px,1.6vh,16px);min-width:0;overflow:hidden}
.snl-tile-num{font-size:.55em;color:#4b5563;line-height:1;position:absolute;top:1px;left:2px}
.snl-tile-icon{font-size:1em;line-height:1}
.snl-tile-dest{font-size:clamp(9px,1.5vh,13px);font-weight:800;color:#fff;line-height:1;position:absolute;top:1px;right:2px;background:rgba(0,0,0,.6);border-radius:3px;padding:1px 3px;text-shadow:0 0 2px #000;pointer-events:none}
.snl-cell.snl-snake .snl-tile-dest{color:#fca5a5}
.snl-cell.snl-ladder .snl-tile-dest{color:#86efac}
.snl-cell.snl-snake-tail .snl-tile-dest,.snl-cell.snl-ladder-top .snl-tile-dest{color:#9ca3af;font-weight:600}
.snl-cell.snl-snake-tail .snl-tile-icon,.snl-cell.snl-ladder-top .snl-tile-icon{opacity:.45}
.snl-cell.snl-snake{background:#2d1515}
.snl-cell.snl-snake-tail{background:#241010}
.snl-cell.snl-ladder{background:#152d1a}
.snl-cell.snl-ladder-top{background:#0f2413}
.snl-cell.snl-snake,.snl-cell.snl-snake-tail,.snl-cell.snl-ladder,.snl-cell.snl-ladder-top{border-width:2px;cursor:help}
.snl-cell.snl-forfeit-tile{background:#1e1535}
.snl-cell.snl-pickup{background:#191e35}
.snl-cell.snl-fork{background:#25201a}
.snl-cell.snl-finish{background:#2d2515;border:2px solid #fbbf24}
.snl-tokens{--tok:clamp(13px,3.4vh,30px);position:absolute;bottom:1px;left:1px;right:1px;display:flex;justify-content:center;align-items:flex-end;z-index:5}
.snl-token{width:var(--tok);height:var(--tok);border-radius:50%;flex-shrink:0;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.8),0 1px 3px rgba(0,0,0,.9)}
.snl-token+.snl-token{margin-left:calc(var(--tok) * -0.45)}
.snl-token-host{background:#ef4444}
.snl-token-guest{background:#60a5fa}
.snl-token-guest2{background:#a3e635}
.snl-sidebar{width:168px;flex-shrink:0;display:flex;flex-direction:column;gap:8px;overflow-y:auto}
.snl-hand-wrap{display:flex;flex-direction:column;gap:3px;min-height:22px}
.snl-hand-empty{color:#4b5563;font-size:.76em}
.snl-powerup-btn{background:#1e1e35;border:1px solid #3a3a5a;color:#c084fc;border-radius:6px;padding:4px 6px;cursor:pointer;font-size:.7em;text-align:left;line-height:1.3}
.snl-powerup-btn:hover{background:#2a2a4a}
.snl-active-pu{display:flex;flex-direction:column;gap:3px}
.snl-pu-badge{background:#2a1a3a;border:1px solid #7c3aed;color:#c084fc;border-radius:6px;padding:3px 6px;font-size:.68em;line-height:1.3}
.snl-roll-area{display:flex;flex-direction:column;align-items:center;gap:6px}
.snl-die{font-size:2.2em;text-align:center}
.snl-btn-primary{background:#7c3aed;border:none;color:#fff;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:.88em;width:100%}
.snl-btn-primary:disabled{opacity:.4;cursor:default}
.snl-btn-secondary{background:#374151;border:none;color:#e0e0e0;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:.84em;width:100%}
.snl-btn-danger{background:#991b1b;border:none;color:#fff;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:.84em;width:100%}
.snl-status{font-size:.8em;color:#9ca3af;min-height:2.4em;line-height:1.35}
.snl-disconnect-row{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#1f1320;border:1px solid #4c1d24;border-radius:8px;padding:8px 10px;font-size:.78em;color:#f59e0b;margin-top:4px}
.snl-disconnect-row button{flex-shrink:0}
.snl-vibe-row{background:#13131f;border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:4px}
.snl-slider{width:100%;accent-color:#7c3aed}
.snl-vibe-timer{font-size:.8em;color:#f59e0b;text-align:center}
.snl-amb-row{background:#13131f;border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:4px;font-size:.8em}
.snl-modal{position:fixed;inset:0;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}
.snl-forfeit-card{background:#1e1e35;border:2px solid #7c3aed;border-radius:12px;padding:22px 24px;max-width:340px;width:100%;display:flex;flex-direction:column;gap:10px;align-items:center;text-align:center}
.snl-forfeit-tier{font-size:.78em;font-weight:700;color:#a78bfa;text-transform:uppercase;letter-spacing:.06em}
.snl-forfeit-cat{font-size:.72em;color:#6b7280;text-transform:uppercase}
.snl-forfeit-text{font-size:.95em;color:#e0e0e0;line-height:1.45}
.snl-ctrl-body{display:flex;gap:12px;flex:1;padding:12px;overflow:hidden}
.snl-ctrl-panel{width:200px;flex-shrink:0;display:flex;flex-direction:column;gap:10px;overflow-y:auto}
.snl-ctrl-section{display:flex;flex-direction:column;gap:5px;background:#13131f;border-radius:8px;padding:10px}
.snl-ctrl-label{font-size:.8em;color:#a78bfa;font-weight:600}
.snl-ctrl-timer{font-size:1.1em;color:#f59e0b;text-align:center;font-weight:700}
.snl-ctrl-timer-bar{height:6px;border-radius:3px;background:#2a2a4a;overflow:hidden}
.snl-ctrl-timer-fill{height:100%;background:#f59e0b;width:100%;transition:width 1s linear}
.snl-vibe-banner{position:fixed;top:56px;left:50%;transform:translateX(-50%);z-index:900;background:#1e1e35;border:2px solid #f59e0b;border-radius:12px;padding:10px 22px;min-width:220px;display:flex;flex-direction:column;align-items:center;gap:4px;box-shadow:0 4px 18px rgba(0,0,0,.5)}
.snl-vibe-banner-label{font-size:.82em;font-weight:600;color:#fbbf24;text-align:center}
.snl-vibe-banner-time{font-size:2em;font-weight:800;color:#fff;line-height:1;font-variant-numeric:tabular-nums}
.snl-vibe-banner-bar{width:100%;height:6px;border-radius:3px;background:#2a2a4a;overflow:hidden}
.snl-vibe-banner-fill{height:100%;background:#f59e0b;width:100%;transition:width 1s linear}
.snl-vibe-skip-btn{margin-top:4px;padding:3px 12px;font-size:.75em;font-weight:600;color:#9ca3af;background:transparent;border:1px solid #3a3a5a;border-radius:6px;cursor:pointer}
.snl-vibe-skip-btn:hover{color:#e0e0e0;border-color:#f59e0b}
.snl-forfeit-log{background:#13131f;border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px;min-height:0;flex:1;overflow:hidden}
.snl-forfeit-log-title{font-size:.76em;font-weight:700;color:#a78bfa;text-transform:uppercase;letter-spacing:.05em;flex-shrink:0}
.snl-forfeit-log-list{display:flex;flex-direction:column;gap:5px;overflow-y:auto;min-height:0}
.snl-log-empty{color:#4b5563;font-size:.72em}
.snl-log-entry{background:#1e1e35;border-left:3px solid #7c3aed;border-radius:4px;padding:4px 6px}
.snl-log-head{display:flex;justify-content:space-between;align-items:center;font-size:.72em}
.snl-log-name{color:#e0e0e0;font-weight:600}
.snl-log-tier{color:#a78bfa;font-weight:700}
.snl-log-text{font-size:.68em;color:#9ca3af;line-height:1.3;margin-top:2px}
.snl-finale-recap{width:100%;text-align:left;margin-top:2px}
.snl-finale-recap-title{font-size:.76em;font-weight:700;color:#a78bfa;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.snl-finale-recap-list{display:flex;flex-direction:column;gap:5px;max-height:220px;overflow-y:auto}
.snl-finale-driver{width:100%;background:#13131f;border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:8px;margin-top:4px}
.snl-finale-driver label{font-size:.78em;color:#9ca3af;display:flex;justify-content:space-between}
.snl-finale-pattern-row{display:flex;gap:6px}
.snl-fin-pattern{flex:1;padding:6px 4px;font-size:.76em;font-weight:600;color:#9ca3af;background:#1e1e35;border:1px solid #3a3a5a;border-radius:6px;cursor:pointer}
.snl-fin-pattern.selected{color:#fff;background:#7c3aed;border-color:#7c3aed}
.snl-finale-driver-btns{display:flex;gap:10px;margin-top:2px}
.snl-finale-driver-btns button{flex:1}
`;
  document.head.appendChild(s);
}
