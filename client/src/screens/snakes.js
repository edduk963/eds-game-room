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
          <button id="snl-ctrl-skip" class="snl-vibe-skip-btn" title="Testing only — cuts the vibe short">Skip (test)</button>
        </div>
        <div id="snl-ctrl-forfeit"></div>
        <div class="snl-status" id="snl-status">Watching the climb…</div>
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
    const text = resolveForfeitText(card, state.seed, cardIndex);
    logForfeit('host', card.tier, card.category, text);
    statusEl.textContent = 'Snake forfeit!';
    let acked = false;
    ctrlForfeit.innerHTML = `<div class="snl-forfeit-card">
      <div class="snl-forfeit-tier">Tier ${card.tier} — ${card.category}</div>
      <div class="snl-forfeit-text">${text}</div>
      <button id="snl-ctrl-ack" class="snl-btn-secondary">Acknowledged ✓</button>
    </div>`;
    ctrlForfeit.querySelector('#snl-ctrl-ack').addEventListener('click', () => {
      ctrlForfeit.innerHTML = '';
      if (!acked) { acked = true; socket.send({ type: MSG.SNL_FORFEIT_ACK }); }
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

  root.querySelector('#snl-ctrl-skip')?.addEventListener('click', () => {
    clearTimeout(ctrlSkipTimeout);
    clearInterval(timerInt);
    vibeSec.style.display = 'none';
    socket.send({ type: MSG.SNL_VIBE_STOP });
  });

  const onVibeStop = () => { clearInterval(timerInt); vibeSec.style.display = 'none'; };

  socket.addEventListener(MSG.SNL_MOVE_DONE,    onMoveDone);
  socket.addEventListener(MSG.SNL_FORFEIT_DRAW, onForfeitDraw);
  socket.addEventListener(MSG.SNL_VIBE_START,   onVibeStart);
  socket.addEventListener(MSG.SNL_VIBE_STOP,    onVibeStop);

  root.querySelector('#snl-leave').addEventListener('click', () => navigate('#/'));
  window.addEventListener('hashchange', () => {
    clearInterval(timerInt);
    clearTimeout(ctrlSkipTimeout);
    socket.removeEventListener(MSG.SNL_MOVE_DONE,    onMoveDone);
    socket.removeEventListener(MSG.SNL_FORFEIT_DRAW, onForfeitDraw);
    socket.removeEventListener(MSG.SNL_VIBE_START,   onVibeStart);
    socket.removeEventListener(MSG.SNL_VIBE_STOP,    onVibeStop);
  }, { once: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIMBER (all other roles / modes)
// ─────────────────────────────────────────────────────────────────────────────
function renderClimber(root) {
  const { seed, snlMode, snlBoardSize, snlDensity, snlStakeMix, snlVibeScale,
          snlFinalRule, snlPushLuck, snlPowerups, snlCoopBetray,
          snlForfeitCards, snlForfeitLines, snlAmbient, snlTapOut,
          playerCount, role, forfeitDuration } = state;

  const board = generateBoard(seed, { boardSize: snlBoardSize, density: snlDensity, coopBetray: snlCoopBetray });
  const { n, snakes, ladders, forfeitTiles, pickupTiles, forkTiles } = board;

  const forfeitDeck = buildForfeitDeck(seed, snlForfeitCards, snlForfeitLines);
  const powerupDeck = buildPowerupDeck(seed);

  const isSolo    = snlMode === 'solo';
  const isWatched = snlMode === 'watched';

  const roles = isSolo ? ['host']
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
  let loadedDie    = null;
  let extraRoll    = false;  // double move
  let pushLuck     = false;
  let skipNext     = false;
  let dropPending  = false;
  let gameOver     = false;
  let mercyTokens  = 0;

  function activeRole()   { return roles[activeIdx % roles.length]; }
  function isMyTurn()     { return activeRole() === role; }
  function oppOf(r)       { return roles.find(rr => rr !== r) || 'guest'; }
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
      <button id="snl-vibe-skip" class="snl-vibe-skip-btn" title="Testing only — cuts the vibe short">Skip (test)</button>
    </div>
    <div class="snl-body">
      <div id="snl-board-wrap"></div>
      <div class="snl-sidebar">
        <div id="snl-hand" class="snl-hand-wrap"></div>
        <div class="snl-roll-area">
          <div id="snl-die" class="snl-die">🎲</div>
          <button id="snl-roll-btn" class="snl-btn-primary" disabled>Roll</button>
          ${snlPushLuck ? '<button id="snl-push-btn" class="snl-btn-secondary" style="display:none">Push Luck ↑</button>' : ''}
          <div id="snl-push-lbl" class="snl-push-lbl" style="display:none">⚠️ Next snake +1 tier</div>
        </div>
        <div id="snl-status" class="snl-status">—</div>
        <div id="snl-vibe-row" class="snl-vibe-row" style="display:none">
          <label>Intensity <span id="snl-vibe-pct">50%</span></label>
          <input type="range" id="snl-vibe-slider" min="0" max="100" value="50" class="snl-slider">
          <div id="snl-vibe-timer" class="snl-vibe-timer">—</div>
        </div>
        ${isSolo && snlTapOut ? '<button id="snl-tapout" class="snl-btn-danger" style="margin-top:8px">Tap Out</button>' : ''}
        ${isSolo && snlAmbient ? '<div class="snl-amb-row"><label>Ambient <span id="snl-amb-pct">0%</span></label><input type="range" id="snl-amb-slider" min="0" max="100" value="0" class="snl-slider"></div>' : ''}
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
  const pushBtn     = root.querySelector('#snl-push-btn');
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
  const logListEl   = root.querySelector('#snl-forfeit-log-list');

  let vibeInt = null;
  let bannerInt = null;
  let vibeOnExpire = null;   // set by startSliderCountdown; skip fast-forwards to this
  let vibeSkipHandler = null; // set by waits that don't go through the slider countdown

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

  // ── testing aid: skip whatever vibe wait is currently blocking play ──
  function skipVibe() {
    if (vibeOnExpire) {
      const cb = vibeOnExpire; vibeOnExpire = null;
      clearInterval(vibeInt);
      vibeRow.style.display = 'none';
      cb();
    }
    if (vibeSkipHandler) {
      const h = vibeSkipHandler; vibeSkipHandler = null;
      h();
    }
    stopVibeBanner();
    haptics.stopAll();
  }
  root.querySelector('#snl-vibe-skip')?.addEventListener('click', skipVibe);

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
    if (pushBtn) pushBtn.style.display = (isMyTurn() && snlPushLuck && !pushLuck) ? 'inline-block' : 'none';
  }

  // ── I-drive-opponent slider (for snake victim, I drive; for ladder, I drive) ──
  vibeSlider.addEventListener('input', () => {
    vibePctEl.textContent = `${vibeSlider.value}%`;
    socket.send({ type: MSG.SNL_VIBE_CTRL, intensity: vibeSlider.value / 100, target: oppOf(role) });
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

  // ── forfeit both-ack modal ──
  function showForfeitModal(card, cardIdx, roleLabel, onDone) {
    const text = resolveForfeitText(card, seed, cardIdx);
    logForfeit(roleLabel, card.tier, card.category, text);
    let myAck = false, oppAck = false;
    const tryDone = () => { if (myAck && oppAck) { hideModal(); onDone(); } };
    const isRecipient = roleLabel === role;
    showModal(`<div class="snl-forfeit-card">
      <div class="snl-forfeit-cat">${card.category}</div>
      <div class="snl-forfeit-tier">Tier ${card.tier}</div>
      <div class="snl-forfeit-text">${text}</div>
      ${!isRecipient ? `<div style="font-size:.78em;color:#6b7280">${name(roleLabel)} takes this.</div>` : ''}
      <button id="snl-fack" class="snl-btn-${isRecipient ? 'primary' : 'secondary'}">${isRecipient ? "I'll do it ✓" : 'Acknowledged ✓'}</button>
      <div id="snl-fwait" style="display:none;font-size:.78em;color:#6b7280">Waiting for other player…</div>
    </div>`);
    modalEl.querySelector('#snl-fack').addEventListener('click', () => {
      modalEl.querySelector('#snl-fack').disabled = true;
      modalEl.querySelector('#snl-fwait').style.display = 'block';
      myAck = true;
      socket.send({ type: MSG.SNL_FORFEIT_ACK });
      if (isSolo) { oppAck = true; }
      tryDone();
    });
    if (!isSolo) {
      const onOpp = () => { socket.removeEventListener(MSG.SNL_OPP_FORFEIT_ACK, onOpp); oppAck = true; tryDone(); };
      socket.addEventListener(MSG.SNL_OPP_FORFEIT_ACK, onOpp);
    }
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
    if (pickCount[r] % threshold !== 0 || powerupIdx >= powerupDeck.length) return null;
    return powerupDeck[powerupIdx++];
  }

  // ── powerup ──
  function playPowerup(idx) {
    const id = hands[role][idx];
    if (!id) return;
    hands[role].splice(idx, 1);
    socket.send({ type: MSG.SNL_POWERUP, puId: id });
    applyPowerup(id, role, null);
    paintHand();
  }

  function applyPowerup(id, byRole, targetRole) {
    const t = targetRole || roles.find(rr => rr !== byRole) || byRole;
    switch (id) {
      case 'loaded_die':
        if (byRole === role) showDiePicker(v => { loadedDie = v; setStatus(`Loaded Die: will roll ${v}.`); });
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
        if (byRole === role) { hijackFor[t] = byRole; setStatus(`Hijacked ${name(t)}'s next snake!`); }
        break;
      case 'deflect':
        if (byRole === role) { deflect = true; setStatus('Deflect armed — bounces your next snake.'); }
        break;
      case 'mirror':
        if (byRole === role) { mirrorNext = true; setStatus('Mirror active — your next forfeit hits both.'); }
        break;
    }
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
    pushLuck = false;
    paintTurnInd();
    if (pushBtn) pushBtn.style.display = 'none';
    const pl = root.querySelector('#snl-push-lbl');
    if (pl) pl.style.display = 'none';
    setStatus(isMyTurn() ? 'Your turn — roll!' : `${name(activeRole())}'s turn.`);
  }

  // ── after resolution ── only called on ACTIVE PLAYER's client ──
  function afterResolution() {
    if (gameOver) return;
    const r = role;

    // Surrender "drop 5" pending
    if (dropPending) { dropPending = false; pos[r] = Math.max(1, pos[r] - 5); repaintBoard(); setStatus('Dropped back 5 tiles.'); }

    // Check win
    if (pos[r] >= n) { triggerWin(); return; }

    // Broadcast final position
    socket.send({ type: MSG.SNL_MOVE_DONE, tile: pos[r], final: true });

    // Extra roll (double move)?
    if (extraRoll) { extraRoll = false; rollBtn.disabled = false; setStatus('Double Move — roll again!'); return; }

    advanceTurn();
  }

  function triggerWin() {
    gameOver = true;
    rollBtn.disabled = true;
    haptics.winPattern();
    socket.send({ type: 'final', value: pos[role], vibeSeconds: 0 });
    showModal(`<div class="snl-forfeit-card">
      <div class="snl-forfeit-tier">🏆 Summit reached!</div>
      <div class="snl-forfeit-text">You win!</div>
      <button id="snl-results" class="snl-btn-primary">Results →</button>
    </div>`);
    modalEl.querySelector('#snl-results')?.addEventListener('click', () => { haptics.stopAll(); navigate('#/results'); });
  }

  function triggerFinale() {
    // called on opponents when they receive final from winner
    gameOver = true;
    rollBtn.disabled = true;
    haptics.losePattern();
    const { card, idx } = drawForfeit();
    const secs = forfeitDuration || 30;
    haptics.startForfeitVibe(secs);
    const text = card ? resolveForfeitText(card, seed, idx) : 'Finale forfeit!';
    socket.send({ type: 'final', value: pos[role], vibeSeconds: secs });
    showModal(`<div class="snl-forfeit-card">
      <div class="snl-forfeit-tier">🏆 Winner reached the summit — Finale!</div>
      <div class="snl-forfeit-text">${text}</div>
      <div style="color:#f59e0b;margin-top:6px">Vibe for ${secs}s…</div>
      <button id="snl-results" class="snl-btn-primary" style="margin-top:14px">Results →</button>
    </div>`);
    modalEl.querySelector('#snl-results')?.addEventListener('click', () => { haptics.stopAll(); navigate('#/results'); });
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

    // Fork
    if (forkTiles.has(tile) && snlCoopBetray) {
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
      const extraTier = pushLuck ? 1 : 0;
      pushLuck = false;
      const tier = Math.min(3, tierFor(tile - tail, tile, n) + extraTier);

      if (deflect) {
        deflect = false;
        const opp = oppOf(role);
        pos[opp] = Math.max(1, pos[opp] - (tile - tail));
        repaintBoard();
        socket.send({ type: MSG.SNL_MOVE_DONE, tile: pos[opp], final: false, targetRole: opp });
        setStatus(`Deflect! ${name(opp)} takes the snake instead.`);
        afterResolution();
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

  // ── snake resolution ──
  function doSnake(head, tail, tier) {
    setStatus(`Snake! Fell from ${head} to ${tail}. Tier ${tier}.`);
    const hijacker = hijackFor[role];
    if (hijacker) hijackFor[role] = null;

    const useVibe = snlStakeMix === 'vibe' || (snlStakeMix === 'mixed' && head % 2 === 0);
    const useForfeit = snlStakeMix === 'forfeits' || (snlStakeMix === 'mixed' && head % 2 !== 0);
    const secs = calcVibeSeconds(head - tail, head, n, snlVibeScale);

    if (useVibe) {
      if (isSolo) {
        haptics.startForfeitVibe(secs);
        startVibeBanner(secs, '🐍 Snake vibe!');
        setStatus(`Snake vibe — ${secs}s!`);
        if (!useForfeit) {
          const finish = () => { vibeSkipHandler = null; stopVibeBanner(); haptics.stopAll(); afterResolution(); };
          const t = setTimeout(finish, secs * 1000);
          vibeSkipHandler = () => { clearTimeout(t); finish(); };
          return;
        }
      } else {
        haptics.startForfeitVibe(secs);
        startVibeBanner(secs, `🐍 ${name(hijacker || oppOf(role))} is driving your vibe`);
        setStatus(`Snake vibe — ${secs}s. ${name(hijacker || oppOf(role))} drives.`);
        // Tell opponent to show their driver-slider via SNL_VIBE_START
        socket.send({ type: MSG.SNL_VIBE_START, secs });
        // Send immediate position update so opponent board reflects snake fall
        socket.send({ type: MSG.SNL_MOVE_DONE, tile: pos[role], final: false });
        // Advance turn when we receive SNL_VIBE_STOP
        if (!useForfeit) {
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
          return;
        }
      }
    }

    if (useForfeit) {
      const { card, idx } = drawForfeit();
      if (!card) { afterResolution(); return; }
      const vibeForForfeit = useVibe ? secs : 0;
      socket.send({ type: MSG.SNL_FORFEIT_DRAW, cardIndex: idx, secs: vibeForForfeit });
      if (mirrorNext) {
        mirrorNext = false;
        socket.send({ type: MSG.SNL_FORFEIT_ASSIGN, cardIndex: idx, target: oppOf(role) });
      }
      showForfeitModal(card, idx, role, afterResolution);
    }
  }

  // ── forfeit tile resolution (🎴 — always a card, never vibe) ──
  function doForfeitTile() {
    setStatus('Forfeit tile!');
    const { card, idx } = drawForfeit();
    if (!card) { afterResolution(); return; }
    socket.send({ type: MSG.SNL_FORFEIT_DRAW, cardIndex: idx, secs: 0 });
    if (mirrorNext) {
      mirrorNext = false;
      socket.send({ type: MSG.SNL_FORFEIT_ASSIGN, cardIndex: idx, target: oppOf(role) });
    }
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
      <div class="snl-forfeit-text">Punish ${name(target)}:</div>
      <div style="display:flex;gap:12px;justify-content:center;margin:14px 0">
        <button id="snl-lv" class="snl-btn-primary">Vibe ${secs}s</button>
        <button id="snl-lf" class="snl-btn-secondary">Assign Forfeit</button>
      </div></div>`);

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
    modalEl.querySelector('#snl-lf').addEventListener('click', () => {
      hideModal();
      const { card, idx } = drawForfeit();
      if (!card) { afterResolution(); return; }
      socket.send({ type: MSG.SNL_FORFEIT_ASSIGN, cardIndex: idx, target });
      const text = resolveForfeitText(card, seed, idx);
      logForfeit(target, card.tier, card.category, text);
      showModal(`<div class="snl-forfeit-card">
        <div class="snl-forfeit-tier">Assigned to ${name(target)}</div>
        <div class="snl-forfeit-text">${text}</div>
        <button id="snl-lf-ok" class="snl-btn-primary">Continue →</button>
      </div>`);
      modalEl.querySelector('#snl-lf-ok').addEventListener('click', () => { hideModal(); afterResolution(); });
    });
  }

  // ── fork tile ──
  let _forkDone = null;
  function doFork(tile) {
    const near = roles.find(rr => rr !== role && Math.abs(pos[role] - pos[rr]) <= 10);
    if (!near) { afterResolution(); return; }
    showModal(`<div class="snl-forfeit-card">
      <div class="snl-forfeit-tier">Fork 🔱</div>
      <div class="snl-forfeit-text">Cooperate or Betray ${name(near)}?</div>
      <div style="display:flex;gap:12px;justify-content:center;margin:14px 0">
        <button id="snl-fcoop" class="snl-btn-primary">Cooperate</button>
        <button id="snl-fbetr" class="snl-btn-secondary">Betray</button>
      </div></div>`);
    _forkDone = afterResolution;
    const go = c => { hideModal(); socket.send({ type: MSG.SNL_COOP_CHOICE, choice: c }); setStatus('Waiting for response…'); };
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
    const pl = root.querySelector('#snl-push-lbl');
    if (pl) pl.style.display = 'none';
    if (pushBtn) pushBtn.style.display = 'none';
    socket.send({ type: MSG.SNL_ROLL_READY });
  });

  if (pushBtn && snlPushLuck) {
    pushBtn.addEventListener('click', () => {
      if (!isMyTurn() || gameOver) return;
      pushLuck = true;
      pushBtn.style.display = 'none';
      const pl = root.querySelector('#snl-push-lbl');
      if (pl) pl.style.display = 'block';
      setStatus('Push luck active — next snake is +1 tier!');
    });
  }

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
    const { role: r, tile, final: isFinal } = ev.detail;
    if (!r || !tile) return;
    pos[r] = tile;
    repaintBoard();
    if (isFinal && r === activeRole() && r !== role) {
      advanceTurn();
    }
  };

  const onPowerup = ev => {
    const { role: r, puId, draw, target } = ev.detail;
    if (!puId) return;
    if (draw) { if (r !== role && hands[r]) hands[r].push(puId); return; }
    applyPowerup(puId, r, target);
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
    const text = resolveForfeitText(card, seed, cardIndex);
    logForfeit(target, card.tier, card.category, text);
    if (target !== role) return;
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
    const secs = ev.detail.secs || 10;
    vibeSlider.value = 50; vibePctEl.textContent = '50%';
    startVibeBanner(secs, `🐍 ${name(activeRole())} hit a snake — you're driving!`);
    startSliderCountdown(secs, () => {
      socket.send({ type: MSG.SNL_VIBE_STOP });
      stopVibeBanner();
    });
    setStatus(`${name(activeRole())} hit a snake — drive the vibe!`);
  };

  // Driver is controlling my vibe intensity (I'm the victim being vibed)
  const onVibeCtrl = ev => {
    if (!haptics.isForfeitActive()) haptics.addForfeitSeconds(300); // start if not running
    haptics.setForfeitIntensity(ev.detail.intensity || 0);
  };

  // Vibe ended — stop haptics (I'm victim) and hide slider (I'm driver)
  const onVibeStop = ev => {
    haptics.stopAll();
    clearInterval(vibeInt);
    vibeRow.style.display = 'none';
    stopVibeBanner();
  };

  // Fork — active player chose; I respond
  const onCoopChoice = ev => {
    const { role: sr, choice: sc } = ev.detail;
    showModal(`<div class="snl-forfeit-card">
      <div class="snl-forfeit-tier">Fork 🔱 — Respond!</div>
      <div class="snl-forfeit-text">${name(sr)} chose. Your pick:</div>
      <div style="display:flex;gap:12px;justify-content:center;margin:14px 0">
        <button id="snl-rcoop" class="snl-btn-primary">Cooperate</button>
        <button id="snl-rbetr" class="snl-btn-secondary">Betray</button>
      </div></div>`);
    const respond = mine => {
      hideModal();
      const hc = role === 'host' ? mine : sc;
      const gc = role === 'guest' ? mine : sc;
      socket.send({ type: MSG.SNL_COOP_REVEAL, hostChoice: hc, guestChoice: gc });
    };
    modalEl.querySelector('#snl-rcoop').addEventListener('click', () => respond('cooperate'));
    modalEl.querySelector('#snl-rbetr').addEventListener('click', () => respond('betray'));
  };

  // Fork resolved — both know both choices
  const onCoopReveal = ev => {
    const { hostChoice, guestChoice } = ev.detail;
    const my = role === 'host' ? hostChoice : guestChoice;
    const op = role === 'host' ? guestChoice : hostChoice;
    hideModal();
    if (my === 'cooperate' && op === 'cooperate') {
      pos[role] = Math.min(n - 1, pos[role] + 5);
      setStatus('Both cooperated — small mutual climb!');
    } else if (my === 'betray' && op === 'cooperate') {
      const opp = oppOf(role);
      pos[opp] = Math.max(1, pos[opp] - 8);
      pos[role] = Math.min(n - 1, pos[role] + 5);
      setStatus('You betrayed! You climb, they slide.');
    } else if (my === 'cooperate' && op === 'betray') {
      pos[role] = Math.max(1, pos[role] - 8);
      setStatus('You were betrayed — you slide!');
    } else {
      pos[role] = Math.max(1, pos[role] - 4);
      setStatus('Both betrayed — both slide!');
    }
    repaintBoard();
    if (_forkDone) { const fn = _forkDone; _forkDone = null; fn(); }
  };

  const onOppFinal = () => { if (!gameOver) triggerFinale(); };
  const onPeerLeft = () => { if (!gameOver) setStatus('Opponent disconnected.'); };

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
  socket.addEventListener('opp_final',             onOppFinal);
  socket.addEventListener('peer_left',             onPeerLeft);

  root.querySelector('#snl-leave').addEventListener('click', () => { haptics.stopAll(); navigate('#/'); });
  window.addEventListener('hashchange', () => {
    clearInterval(vibeInt);
    clearInterval(bannerInt);
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
    socket.removeEventListener('opp_final',           onOppFinal);
    socket.removeEventListener('peer_left',           onPeerLeft);
  }, { once: true });

  // ── initial paint ──
  repaintBoard(); paintHand(); paintTurnInd();
  if (isSolo) setStatus('Solo climb — roll!');
  else setStatus(isMyTurn() ? 'Your turn — roll!' : `Waiting for ${name(activeRole())}…`);
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
    if (snakes[tile] !== undefined)        { icon = '🐍'; cls += ' snl-snake'; dest = `↓${snakes[tile]}`; title = `Viper: ${tile} → ${snakes[tile]}`; style = `border-color:${color[tile]}`; }
    else if (tailOfHead[tile] !== undefined) { icon = '🐍'; cls += ' snl-snake-tail'; dest = `·${tailOfHead[tile]}`; title = `Viper tail — no effect landing here (head is at ${tailOfHead[tile]})`; style = `border-color:${color[tile]}`; }
    else if (ladders[tile] !== undefined)  { icon = '🪜'; cls += ' snl-ladder'; dest = `↑${ladders[tile]}`; title = `Vine: ${tile} → ${ladders[tile]}`; style = `border-color:${color[tile]}`; }
    else if (topOfBottom[tile] !== undefined) { icon = '🪜'; cls += ' snl-ladder-top'; dest = `·${topOfBottom[tile]}`; title = `Vine top — no effect landing here (bottom is at ${topOfBottom[tile]})`; style = `border-color:${color[tile]}`; }
    else if (forfeitTiles.has(tile))  { icon = '🎴'; cls += ' snl-forfeit-tile'; }
    else if (pickupTiles.has(tile))   { icon = '⭐'; cls += ' snl-pickup'; }
    else if (forkTiles.has(tile))     { icon = '🔱'; cls += ' snl-fork'; }
    if (tile === n) cls += ' snl-finish';
    const tokens = Object.entries(positions)
      .filter(([, p]) => p === tile)
      .map(([r]) => `<span class="snl-token snl-token-${r}"></span>`)
      .join('');
    const destLabel = dest ? `<span class="snl-tile-dest">${dest}</span>` : '';
    const titleAttr = title ? ` title="${title}"` : '';
    cells.push(`<div class="${cls}" style="grid-column:${col+1};grid-row:${dr+1};${style}"${titleAttr}><span class="snl-tile-num">${tile}</span><span class="snl-tile-icon">${icon}</span>${destLabel}${tokens}</div>`);
  }
  wrap.innerHTML = `<div class="snl-board" style="--snl-cols:${cols};--snl-rows:${rows}">${cells.join('')}</div>`;
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
.snl-root{display:flex;flex-direction:column;height:100vh;background:var(--bg,#1a1a2e);color:#e0e0e0}
.snl-header{display:flex;align-items:center;gap:12px;padding:8px 16px;background:#13131f;border-bottom:1px solid #2a2a4a;flex-shrink:0}
.snl-title{font-weight:700;font-size:1.1em;color:#c084fc}
.snl-turn-ind{font-size:.85em;color:#9ca3af}
.snl-turn-ind.snl-my-turn{color:#86efac;font-weight:600}
.snl-leave{margin-left:auto}
.snl-body{display:flex;gap:10px;flex:1;min-height:0;padding:10px;overflow:hidden}
#snl-board-wrap{flex:1;min-width:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
.snl-board{display:grid;grid-template-columns:repeat(var(--snl-cols),1fr);grid-template-rows:repeat(var(--snl-rows),1fr);gap:2px;height:min(calc(100vh - 60px),calc(100vw - 205px));width:auto;aspect-ratio:var(--snl-cols)/var(--snl-rows)}
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
.snl-token{width:clamp(10px,2.2vh,20px);height:clamp(10px,2.2vh,20px);border-radius:50%;display:inline-block;position:absolute;bottom:2px;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.8),0 1px 3px rgba(0,0,0,.9);z-index:5}
.snl-token-host{background:#ef4444;right:1px}
.snl-token-guest{background:#60a5fa;right:16px}
.snl-token-guest2{background:#a3e635;right:31px}
.snl-sidebar{width:168px;flex-shrink:0;display:flex;flex-direction:column;gap:8px;overflow-y:auto}
.snl-hand-wrap{display:flex;flex-direction:column;gap:3px;min-height:22px}
.snl-hand-empty{color:#4b5563;font-size:.76em}
.snl-powerup-btn{background:#1e1e35;border:1px solid #3a3a5a;color:#c084fc;border-radius:6px;padding:4px 6px;cursor:pointer;font-size:.7em;text-align:left;line-height:1.3}
.snl-powerup-btn:hover{background:#2a2a4a}
.snl-roll-area{display:flex;flex-direction:column;align-items:center;gap:6px}
.snl-die{font-size:2.2em;text-align:center}
.snl-btn-primary{background:#7c3aed;border:none;color:#fff;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:.88em;width:100%}
.snl-btn-primary:disabled{opacity:.4;cursor:default}
.snl-btn-secondary{background:#374151;border:none;color:#e0e0e0;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:.84em;width:100%}
.snl-btn-danger{background:#991b1b;border:none;color:#fff;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:.84em;width:100%}
.snl-push-lbl{font-size:.72em;color:#f59e0b;text-align:center}
.snl-status{font-size:.8em;color:#9ca3af;min-height:2.4em;line-height:1.35}
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
.snl-vibe-skip-btn{margin-top:2px;background:transparent;border:1px solid #4b5563;color:#9ca3af;padding:2px 8px;border-radius:6px;cursor:pointer;font-size:.68em}
.snl-vibe-skip-btn:hover{color:#e0e0e0;border-color:#9ca3af}
.snl-forfeit-log{background:#13131f;border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px;min-height:0;flex:1;overflow:hidden}
.snl-forfeit-log-title{font-size:.76em;font-weight:700;color:#a78bfa;text-transform:uppercase;letter-spacing:.05em;flex-shrink:0}
.snl-forfeit-log-list{display:flex;flex-direction:column;gap:5px;overflow-y:auto;min-height:0}
.snl-log-empty{color:#4b5563;font-size:.72em}
.snl-log-entry{background:#1e1e35;border-left:3px solid #7c3aed;border-radius:4px;padding:4px 6px}
.snl-log-head{display:flex;justify-content:space-between;align-items:center;font-size:.72em}
.snl-log-name{color:#e0e0e0;font-weight:600}
.snl-log-tier{color:#a78bfa;font-weight:700}
.snl-log-text{font-size:.68em;color:#9ca3af;line-height:1.3;margin-top:2px}
`;
  document.head.appendChild(s);
}
