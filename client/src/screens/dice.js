import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';
import { initEdgeMode } from '../game/edgeMode.js';
import { showEdgeReadyOverlay } from '../game/edgeAssignment.js';
import { initVibeBattery } from '../vibeBattery.js';

const DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

export function renderDice(root) {
  const playerCount = state.playerCount === 3 ? 3 : 2;
  const roles = playerCount === 3 ? ['host', 'guest', 'guest2'] : ['host', 'guest'];
  const myRole = state.role;
  const vibeRule = state.diceVibeRule === 'all_but_winner' ? 'all_but_winner' : 'lowest';

  function nameFor(role) {
    const n = role === 'host' ? state.hostName : role === 'guest' ? state.guestName : state.guest2Name;
    return n || (role === 'host' ? 'Host' : role === 'guest' ? 'Guest' : 'Guest 2');
  }

  const losses = {};
  const rolls = {};
  roles.forEach(r => { losses[r] = 0; rolls[r] = null; });

  let forfeitDuration = 0;
  let countdownInterval = null;
  let nextReadySent = false;
  const nextReadyRoles = new Set();
  let edgeModeInstance = null;
  let vibeBatteryInstance = initVibeBattery(root);
  let edgePaused = false;
  let savedHaptics = null;
  let diceRoundIndex = 0;
  let roundResolved = false;

  function forfeitSecondsForLoss(losses) {
    return 15 * Math.pow(2, losses);
  }

  const lossesHtml = roles.map((r, i) =>
    `${i > 0 ? '<span class="dice-losses-sep">|</span>' : ''}<span id="dice-losses-${r}">${escapeHtml(nameFor(r))}: 0 losses</span>`
  ).join('');

  const arenaHtml = roles.map((r, i) => `
        ${i > 0 ? '<div class="dice-vs">vs</div>' : ''}
        <div class="dice-player-col" data-role="${r}">
          <div class="dice-player-name">${escapeHtml(nameFor(r))}${r === myRole ? ' (you)' : ''}</div>
          <div class="dice-face" id="dice-face-${r}">?</div>
          <div class="dice-next-forfeit" id="dice-next-${r}">Next loss: 15s</div>
        </div>`).join('');

  root.innerHTML = `
    <div class="dice-root" id="dice-root">
      <div class="dice-header">
        <button class="ghost" id="dice-leave" style="padding:6px 14px;font-size:13px;">← Leave</button>
        <div class="dice-losses-display">${lossesHtml}</div>
        <button id="dice-vibe-btn" class="ghost" style="font-size:13px;padding:6px 12px;">${haptics.isConnected() ? '📳' : 'Connect Vibe'}</button>
      </div>

      <div class="dice-arena${playerCount === 3 ? ' dice-arena-3' : ''}">${arenaHtml}</div>

      <div id="dice-roll-area">
        <button id="dice-roll-btn" class="dice-roll-btn">Roll</button>
        <div id="dice-roll-status" class="dice-roll-status"></div>
      </div>

      <div id="dice-forfeit-area" style="display:none" class="dice-forfeit-area">
        <div id="dice-result-line" class="dice-result-line"></div>
        <div class="dice-countdown-wrap">
          <div class="dice-countdown-label" id="dice-countdown-label">Forfeit: 0s</div>
          <div class="dice-bar-wrap"><div class="dice-bar" id="dice-bar"></div></div>
          <div id="dice-countdown-num" class="dice-countdown-num">0</div>
        </div>
        <div class="forfeit-slider-row">
          <span>Intensity</span>
          <input type="range" id="dice-intensity-slider" min="0" max="100" value="100" style="flex:1;margin:0 12px;">
          <span id="dice-intensity-pct">100%</span>
        </div>
        <button id="dice-next-btn" class="dice-next-btn" style="display:none">Next Round</button>
      </div>
    </div>`;

  const faceEls = {};
  const lossEls = {};
  const nextEls = {};
  roles.forEach(r => {
    faceEls[r] = root.querySelector(`#dice-face-${r}`);
    lossEls[r] = root.querySelector(`#dice-losses-${r}`);
    nextEls[r] = root.querySelector(`#dice-next-${r}`);
  });
  const rollArea = root.querySelector('#dice-roll-area');
  const rollBtn = root.querySelector('#dice-roll-btn');
  const rollStatus = root.querySelector('#dice-roll-status');
  const forfeitArea = root.querySelector('#dice-forfeit-area');

  function updateLossDisplays() {
    roles.forEach(r => {
      lossEls[r].textContent = `${nameFor(r)}: ${losses[r]} loss${losses[r] !== 1 ? 'es' : ''}`;
      nextEls[r].textContent = `Next loss: ${forfeitSecondsForLoss(losses[r])}s`;
    });
  }

  function allRolled() {
    return roles.every(r => rolls[r] !== null);
  }

  function resetRound() {
    roles.forEach(r => {
      rolls[r] = null;
      faceEls[r].textContent = '?';
      faceEls[r].className = 'dice-face';
    });
    nextReadySent = false;
    nextReadyRoles.clear();
    roundResolved = false;
    forfeitDuration = 0;
    rollBtn.disabled = false;
    rollBtn.textContent = 'Roll';
    rollStatus.textContent = '';
    rollArea.style.display = '';
    forfeitArea.style.display = 'none';
    const nextBtn = root.querySelector('#dice-next-btn');
    if (nextBtn) { nextBtn.style.display = 'none'; nextBtn.disabled = false; nextBtn.textContent = 'Next Round'; }
  }

  function revealAndResolve() {
    if (!allRolled() || roundResolved) return;
    roundResolved = true;

    roles.forEach(r => { faceEls[r].textContent = DICE_FACES[rolls[r]]; });

    let losers;
    if (vibeRule === 'all_but_winner') {
      // Everyone except the highest roller suffers (a full tie at the top = nobody suffers).
      const mx = Math.max(...roles.map(r => rolls[r]));
      losers = roles.filter(r => rolls[r] !== mx);
    } else {
      // Only the lowest roller suffers; ties for lowest all suffer (in 2-player, a tie = both).
      const mn = Math.min(...roles.map(r => rolls[r]));
      losers = roles.filter(r => rolls[r] === mn);
    }
    const loserSet = new Set(losers);

    const secsByRole = {};
    losers.forEach(r => { losses[r]++; secsByRole[r] = forfeitSecondsForLoss(losses[r] - 1); });
    updateLossDisplays();

    const myForfeitSecs = loserSet.has(myRole) ? secsByRole[myRole] : 0;
    const maxSecs = losers.length ? Math.max(...losers.map(r => secsByRole[r])) : 0;
    forfeitDuration = maxSecs;

    roles.forEach(r => {
      faceEls[r].classList.toggle('dice-face-loser', loserSet.has(r));
      faceEls[r].classList.toggle('dice-face-winner', !loserSet.has(r) && losers.length > 0);
    });

    rollArea.style.display = 'none';
    forfeitArea.style.display = '';

    const resultLine = root.querySelector('#dice-result-line');
    if (losers.length === 0) {
      resultLine.textContent = 'Everyone tied — no forfeit!';
    } else {
      const parts = losers.map(r => `${r === myRole ? 'You' : nameFor(r)} (${secsByRole[r]}s)`);
      resultLine.textContent = `${losers.length === 1 ? 'Loser' : 'Losers'}: ${parts.join(', ')}`;
    }

    if (myForfeitSecs > 0) haptics.startForfeitVibe(myForfeitSecs);

    startForfeitCountdown(maxSecs);
  }

  function startForfeitCountdown(totalSecs) {
    let remaining = totalSecs;
    const label = root.querySelector('#dice-countdown-label');
    const bar = root.querySelector('#dice-bar');
    const num = root.querySelector('#dice-countdown-num');
    const slider = root.querySelector('#dice-intensity-slider');
    const pct = root.querySelector('#dice-intensity-pct');

    if (label) label.textContent = `Forfeit: ${totalSecs}s`;
    if (num) num.textContent = remaining;
    if (bar) bar.style.width = '100%';

    if (slider) {
      slider.addEventListener('input', () => {
        const level = slider.value / 100;
        if (pct) pct.textContent = `${slider.value}%`;
        haptics.setForfeitIntensity(level);
        socket.send({ type: MSG.DICE_INTENSITY, level });
      });
    }

    if (totalSecs <= 0) { showNextBtn(); return; }

    countdownInterval = setInterval(() => {
      if (edgePaused) return;
      remaining--;
      if (num) num.textContent = Math.max(0, remaining);
      if (bar && totalSecs > 0) bar.style.width = `${(Math.max(0, remaining) / totalSecs) * 100}%`;
      if (remaining <= 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        showNextBtn();
      }
    }, 1000);
  }

  function showNextBtn() {
    const nextBtn = root.querySelector('#dice-next-btn');
    if (nextBtn) nextBtn.style.display = '';
    checkAllNext();
  }

  function checkAllNext() {
    if (nextReadySent && nextReadyRoles.size >= roles.length - 1) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      haptics.stopAll();
      diceRoundIndex++;
      if (state.edgeMode) {
        rollArea.style.display = 'none';
        showEdgeReadyOverlay({ role: state.role, seed: state.seed, roundIndex: diceRoundIndex, onReady: (assignment) => {
          if (edgeModeInstance) edgeModeInstance.setAssignment(assignment);
          resetRound();
        }});
      } else {
        resetRound();
      }
    }
  }

  // --- Roll button ---
  rollBtn.addEventListener('click', () => {
    if (edgePaused) return;
    if (rolls[myRole] !== null) return;
    const value = Math.ceil(Math.random() * 6);
    rolls[myRole] = value;
    faceEls[myRole].textContent = DICE_FACES[value];
    rollBtn.disabled = true;
    rollStatus.textContent = 'Waiting for other players…';
    socket.send({ type: MSG.DICE_ROLL, value });
    if (allRolled()) revealAndResolve();
  });

  // --- Next round button (delegated since it's created after initial render) ---
  forfeitArea.addEventListener('click', (e) => {
    if (!e.target.matches('#dice-next-btn')) return;
    if (nextReadySent) return;
    nextReadySent = true;
    e.target.disabled = true;
    e.target.textContent = 'Waiting for other players…';
    socket.send({ type: MSG.DICE_NEXT });
    checkAllNext();
  });

  // --- Socket events ---
  const onOppRoll = (ev) => {
    const role = ev.detail.role;
    const value = ev.detail.value;
    if (!role || !(role in rolls) || !Number.isInteger(value) || value < 1 || value > 6) return;
    rolls[role] = value;
    faceEls[role].textContent = DICE_FACES[value];
    if (allRolled()) revealAndResolve();
    else if (rolls[myRole] === null) rollStatus.textContent = `${nameFor(role)} rolled — your turn!`;
    else rollStatus.textContent = 'Waiting for other players…';
  };

  const onDiceIntensity = (ev) => {
    const level = ev.detail.level;
    haptics.setForfeitIntensity(level);
    const slider = root.querySelector('#dice-intensity-slider');
    const pct = root.querySelector('#dice-intensity-pct');
    if (slider) slider.value = Math.round(level * 100);
    if (pct) pct.textContent = `${Math.round(level * 100)}%`;
  };

  const onDiceNext = (ev) => {
    if (ev.detail?.role) nextReadyRoles.add(ev.detail.role);
    checkAllNext();
  };

  const onPeerLeft = () => {
    root.innerHTML = `
      <div class="card">
        <h2>A player left</h2>
        <div class="actions"><button id="dice-peer-home">Home</button></div>
      </div>`;
    root.querySelector('#dice-peer-home').addEventListener('click', () => { location.hash = '#/'; });
  };

  socket.addEventListener(MSG.DICE_OPP_ROLL, onOppRoll);
  socket.addEventListener(MSG.DICE_INTENSITY, onDiceIntensity);
  socket.addEventListener(MSG.DICE_NEXT, onDiceNext);
  socket.addEventListener(MSG.PEER_LEFT, onPeerLeft);

  // --- Edge mode init (called once with first assignment) ---
  function _initEdge(assignment) {
    edgeModeInstance = initEdgeMode({
      role: state.role,
      myLives: state.edgeLives,
      assignment,
      containerEl: root,
      onPause: () => {
        edgePaused = true;
        rollBtn.disabled = true;
        savedHaptics = haptics.pauseHaptics();
      },
      onResume: () => {
        edgePaused = false;
        if (rolls[myRole] === null) rollBtn.disabled = false;
        haptics.resumeHaptics(savedHaptics);
      },
    });
  }

  if (state.edgeMode) {
    rollArea.style.display = 'none';
    showEdgeReadyOverlay({ role: state.role, seed: state.seed, roundIndex: 0, onReady: (assignment) => {
      _initEdge(assignment);
      rollArea.style.display = '';
    }});
  }

  // --- Vibe connect ---
  const vibeBtn = root.querySelector('#dice-vibe-btn');
  vibeBtn.addEventListener('click', async () => {
    if (haptics.isConnected()) return;
    vibeBtn.textContent = 'Connecting…';
    vibeBtn.disabled = true;
    try {
      const dev = await haptics.connect();
      vibeBtn.textContent = dev ? `📳 ${dev.name}` : 'No device';
      vibeBtn.disabled = !!dev;
    } catch {
      vibeBtn.textContent = 'Connect Vibe';
      vibeBtn.disabled = false;
    }
  });

  root.querySelector('#dice-leave').addEventListener('click', () => {
    state.myFinal = null;
    state.oppFinal = null;
    state.seed = null;
    navigate(`#/session/${state.sessionId}`);
  });

  updateLossDisplays();

  window.addEventListener('hashchange', () => {
    clearInterval(countdownInterval);
    if (edgeModeInstance) { edgeModeInstance.destroy(); edgeModeInstance = null; }
    if (vibeBatteryInstance) { vibeBatteryInstance.destroy(); vibeBatteryInstance = null; }
    socket.removeEventListener(MSG.DICE_OPP_ROLL, onOppRoll);
    socket.removeEventListener(MSG.DICE_INTENSITY, onDiceIntensity);
    socket.removeEventListener(MSG.DICE_NEXT, onDiceNext);
    socket.removeEventListener(MSG.PEER_LEFT, onPeerLeft);
    haptics.stopAll();
  }, { once: true });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
