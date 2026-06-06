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
  const myName = (state.role === 'host' ? state.hostName : state.guestName) || 'You';
  const oppName = (state.role === 'host' ? state.guestName : state.hostName) || 'Opponent';

  let myLosses = 0;
  let oppLosses = 0;
  let myRoll = null;
  let oppRoll = null;
  let forfeitDuration = 0;
  let countdownInterval = null;
  let nextReadySent = false;
  let nextReadyReceived = false;
  let edgeModeInstance = null;
  let vibeBatteryInstance = initVibeBattery(root);
  let edgePaused = false;
  let savedHaptics = null;
  let diceRoundIndex = 0;

  function forfeitSecondsForLoss(losses) {
    return 15 * Math.pow(2, losses);
  }

  root.innerHTML = `
    <div class="dice-root" id="dice-root">
      <div class="dice-header">
        <button class="ghost" id="dice-leave" style="padding:6px 14px;font-size:13px;">← Leave</button>
        <div class="dice-losses-display">
          <span id="dice-my-losses">${myName}: 0 losses</span>
          <span class="dice-losses-sep">|</span>
          <span id="dice-opp-losses">${oppName}: 0 losses</span>
        </div>
        <button id="dice-vibe-btn" class="ghost" style="font-size:13px;padding:6px 12px;">${haptics.isConnected() ? '📳' : 'Connect Vibe'}</button>
      </div>

      <div class="dice-arena">
        <div class="dice-player-col">
          <div class="dice-player-name">${escapeHtml(myName)}</div>
          <div class="dice-face" id="dice-my-face">?</div>
          <div class="dice-next-forfeit" id="dice-my-next-forfeit">Next loss: 15s</div>
        </div>
        <div class="dice-vs">vs</div>
        <div class="dice-player-col">
          <div class="dice-player-name">${escapeHtml(oppName)}</div>
          <div class="dice-face" id="dice-opp-face">?</div>
          <div class="dice-next-forfeit" id="dice-opp-next-forfeit">Next loss: 15s</div>
        </div>
      </div>

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

  const myFaceEl = root.querySelector('#dice-my-face');
  const oppFaceEl = root.querySelector('#dice-opp-face');
  const myLossesEl = root.querySelector('#dice-my-losses');
  const oppLossesEl = root.querySelector('#dice-opp-losses');
  const myNextEl = root.querySelector('#dice-my-next-forfeit');
  const oppNextEl = root.querySelector('#dice-opp-next-forfeit');
  const rollArea = root.querySelector('#dice-roll-area');
  const rollBtn = root.querySelector('#dice-roll-btn');
  const rollStatus = root.querySelector('#dice-roll-status');
  const forfeitArea = root.querySelector('#dice-forfeit-area');

  function updateLossDisplays() {
    myLossesEl.textContent = `${myName}: ${myLosses} loss${myLosses !== 1 ? 'es' : ''}`;
    oppLossesEl.textContent = `${oppName}: ${oppLosses} loss${oppLosses !== 1 ? 'es' : ''}`;
    myNextEl.textContent = `Next loss: ${forfeitSecondsForLoss(myLosses)}s`;
    oppNextEl.textContent = `Next loss: ${forfeitSecondsForLoss(oppLosses)}s`;
  }

  function resetRound() {
    myRoll = null;
    oppRoll = null;
    nextReadySent = false;
    nextReadyReceived = false;
    forfeitDuration = 0;
    myFaceEl.textContent = '?';
    myFaceEl.className = 'dice-face';
    oppFaceEl.textContent = '?';
    oppFaceEl.className = 'dice-face';
    rollBtn.disabled = false;
    rollBtn.textContent = 'Roll';
    rollStatus.textContent = '';
    rollArea.style.display = '';
    forfeitArea.style.display = 'none';
    const nextBtn = root.querySelector('#dice-next-btn');
    if (nextBtn) { nextBtn.style.display = 'none'; nextBtn.disabled = false; nextBtn.textContent = 'Next Round'; }
  }

  function revealAndResolve() {
    if (myRoll === null || oppRoll === null) return;

    myFaceEl.textContent = DICE_FACES[myRoll];
    oppFaceEl.textContent = DICE_FACES[oppRoll];

    const iLose = myRoll < oppRoll;
    const theyLose = oppRoll < myRoll;
    const tie = myRoll === oppRoll;

    if (iLose || tie) myLosses++;
    if (theyLose || tie) oppLosses++;
    updateLossDisplays();

    const myForfeitSecs = (iLose || tie) ? forfeitSecondsForLoss(myLosses - 1) : 0;
    const oppForfeitSecs = (theyLose || tie) ? forfeitSecondsForLoss(oppLosses - 1) : 0;
    forfeitDuration = Math.max(myForfeitSecs, oppForfeitSecs);

    myFaceEl.classList.toggle('dice-face-loser', iLose || tie);
    myFaceEl.classList.toggle('dice-face-winner', theyLose && !tie);
    oppFaceEl.classList.toggle('dice-face-loser', theyLose || tie);
    oppFaceEl.classList.toggle('dice-face-winner', iLose && !tie);

    rollArea.style.display = 'none';
    forfeitArea.style.display = '';

    const resultLine = root.querySelector('#dice-result-line');
    if (tie) {
      resultLine.textContent = `Tie! Both suffer ${myForfeitSecs}s.`;
    } else if (iLose) {
      resultLine.textContent = `You rolled lower — ${myForfeitSecs}s forfeit.`;
    } else {
      resultLine.textContent = `Opponent rolled lower — they suffer ${oppForfeitSecs}s.`;
    }

    if (myForfeitSecs > 0) haptics.startForfeitVibe(myForfeitSecs);

    startForfeitCountdown(Math.max(myForfeitSecs, oppForfeitSecs));
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
    checkBothNext();
  }

  function checkBothNext() {
    if (nextReadySent && nextReadyReceived) {
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
    if (myRoll !== null) return;
    const value = Math.ceil(Math.random() * 6);
    myRoll = value;
    myFaceEl.textContent = DICE_FACES[value];
    rollBtn.disabled = true;
    rollStatus.textContent = 'Waiting for opponent…';
    socket.send({ type: MSG.DICE_ROLL, value });
    if (oppRoll !== null) revealAndResolve();
  });

  // --- Next round button (delegated since it's created after initial render) ---
  forfeitArea.addEventListener('click', (e) => {
    if (!e.target.matches('#dice-next-btn')) return;
    if (nextReadySent) return;
    nextReadySent = true;
    e.target.disabled = true;
    e.target.textContent = 'Waiting for opponent…';
    socket.send({ type: MSG.DICE_NEXT });
    checkBothNext();
  });

  // --- Socket events ---
  const onOppRoll = (ev) => {
    oppRoll = ev.detail.value;
    oppFaceEl.textContent = DICE_FACES[oppRoll];
    if (myRoll !== null) revealAndResolve();
    else rollStatus.textContent = 'Opponent rolled — your turn!';
  };

  const onDiceIntensity = (ev) => {
    const level = ev.detail.level;
    haptics.setForfeitIntensity(level);
    const slider = root.querySelector('#dice-intensity-slider');
    const pct = root.querySelector('#dice-intensity-pct');
    if (slider) slider.value = Math.round(level * 100);
    if (pct) pct.textContent = `${Math.round(level * 100)}%`;
  };

  const onDiceNext = () => {
    nextReadyReceived = true;
    checkBothNext();
  };

  const onPeerLeft = () => {
    root.innerHTML = `
      <div class="card">
        <h2>Opponent left</h2>
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
        if (myRoll === null) rollBtn.disabled = false;
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
