import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';
import { initEdgeMode } from '../game/edgeMode.js';
import { showEdgeReadyOverlay } from '../game/edgeAssignment.js';
import { initVibeBattery } from '../vibeBattery.js';
import { makeRng } from '../game/seededRng.js';
import {
  getBaseConfig, nextRoundConfig, generateCode, evaluateGuess,
  evaluateGuessPositional, preForfeitSeconds, COLORS,
} from '../game/MastermindGame.js';

const COLOR_STYLE = {
  R: { bg: '#e84040', text: '#fff' },
  G: { bg: '#38c060', text: '#fff' },
  B: { bg: '#3878e8', text: '#fff' },
  W: { bg: '#e8e8e8', text: '#222' },
};

export function renderMastermind(root) {
  const totalRounds = state.gameRounds;
  const gameMode = state.gameMode;
  const rng = makeRng(state.seed);

  // Pre-generate forfeit seconds for all rounds (consumes first totalRounds RNG values)
  const allForfeitSeconds = preForfeitSeconds(rng, totalRounds);

  // Per-round state
  let roundIndex = 0;
  let roundConfig = getBaseConfig();
  let code = generateCode(rng, roundConfig.slots);
  let guessHistory = [];
  let currentGuess = [];
  let myRoundResult = null;
  let oppRoundResult = null;
  let roundReadySent = false;
  let oppRoundReadyReceived = false;
  let phase = 'countdown';
  let timeRemaining = 0;
  let timerInterval = null;
  let forfeitInterval = null;
  let myRoundsSolved = 0;
  let edgeModeInstance = null;
  let vibeBatteryInstance = initVibeBattery(root);
  let edgePaused = false;
  let savedHaptics = null;

  const myName = state.myName || 'You';
  const oppName = (state.role === 'host' ? state.guestName : state.hostName) || 'Opponent';

  root.innerHTML = `
    <div id="mm-root" class="mm-root">
      <div class="mm-overlay" id="mm-countdown-overlay">
        <div class="mm-countdown-num" id="mm-cnum">3</div>
      </div>
      <div class="mm-overlay" id="mm-waiting-overlay" style="display:none">
        <p class="mm-waiting-text">Waiting for opponent…</p>
      </div>
      <div class="mm-overlay mm-forfeit-overlay" id="mm-forfeit-overlay" style="display:none">
        <div id="mm-forfeit-content" class="mm-forfeit-content"></div>
      </div>
      <div style="display:flex;justify-content:flex-start;margin-bottom:8px;">
        <button class="ghost" id="back-to-lobby" style="padding:6px 14px;font-size:13px;">← Lobby</button>
      </div>
      <div class="mm-header">
        <div id="mm-round-label" class="mm-round-label">Round 1 of ${totalRounds}</div>
        <div id="mm-timer" class="mm-timer">0:30</div>
        <button id="mm-vibe-btn" class="mm-vibe-btn ghost">${haptics.isConnected() ? '📳 Connected' : 'Connect Vibe'}</button>
      </div>
      <div id="mm-penalty-display" class="mm-penalty-display"></div>
      <div id="mm-board" class="mm-board"></div>
      <div class="mm-input-area" id="mm-input-area">
        <div id="mm-current-row" class="mm-current-row"></div>
        <div class="mm-color-palette">
          ${COLORS.map(c => `<button class="mm-color-btn" data-color="${c}"
            style="background:${COLOR_STYLE[c].bg};color:${COLOR_STYLE[c].text}">${c}</button>`).join('')}
          <button class="mm-back-btn ghost" id="mm-back">⌫</button>
        </div>
        <button id="mm-submit" disabled>Submit Guess</button>
      </div>
    </div>`;

  const countdownOverlay = root.querySelector('#mm-countdown-overlay');
  const waitingOverlay = root.querySelector('#mm-waiting-overlay');
  const forfeitOverlay = root.querySelector('#mm-forfeit-overlay');
  const forfeitContent = root.querySelector('#mm-forfeit-content');
  const roundLabel = root.querySelector('#mm-round-label');
  const timerEl = root.querySelector('#mm-timer');
  const penaltyDisplay = root.querySelector('#mm-penalty-display');
  const board = root.querySelector('#mm-board');
  const currentRow = root.querySelector('#mm-current-row');
  const inputArea = root.querySelector('#mm-input-area');
  const submitBtn = root.querySelector('#mm-submit');

  // --- Render helpers ---

  function renderHeader() {
    roundLabel.textContent = `Round ${roundIndex + 1} of ${totalRounds}`;
    const mins = Math.floor(timeRemaining / 60);
    const secs = timeRemaining % 60;
    timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    timerEl.classList.toggle('mm-timer-urgent', timeRemaining <= 10 && timeRemaining > 0);
  }

  function renderPenalty() {
    const fs = allForfeitSeconds[roundIndex];
    penaltyDisplay.innerHTML =
      `<span class="mm-pen-label">Fail penalty:</span> ` +
      `<span class="mm-pen-val">${fs}s</span> ` +
      `<span class="mm-pen-note">— 2×${fs * 2}s if only you fail</span>`;
  }

  function makeSlot(color) {
    const d = document.createElement('div');
    d.className = 'mm-slot' + (color ? '' : ' mm-slot-empty');
    if (color) {
      d.style.background = COLOR_STYLE[color].bg;
      d.style.color = COLOR_STYLE[color].text;
      d.textContent = color;
    }
    return d;
  }

  function makeFeedback(positions) {
    const fb = document.createElement('div');
    fb.className = 'mm-feedback';
    const order = gameMode === 'easy'
      ? positions
      : [...positions].sort((a, b) => {
          const rank = { place: 0, color: 1, empty: 2 };
          return rank[a] - rank[b];
        });
    for (const p of order) {
      const d = document.createElement('span');
      d.className = `mm-dot mm-dot-${p}`;
      fb.appendChild(d);
    }
    return fb;
  }

  function renderCurrentRow() {
    currentRow.innerHTML = '';
    for (let i = 0; i < roundConfig.slots; i++) {
      currentRow.appendChild(makeSlot(currentGuess[i] || null));
    }
    submitBtn.disabled = currentGuess.length < roundConfig.slots;
  }

  function renderBoard() {
    board.innerHTML = '';
    const remaining = roundConfig.guesses - guessHistory.length;
    // Empty placeholder rows (future guesses) at top
    for (let i = 0; i < remaining; i++) {
      const row = document.createElement('div');
      row.className = 'mm-guess-row mm-empty-row';
      for (let j = 0; j < roundConfig.slots; j++) row.appendChild(makeSlot(null));
      const fb = document.createElement('div');
      fb.className = 'mm-feedback';
      board.prepend(row);
      row.appendChild(fb);
    }
    // History rows at bottom (oldest first)
    for (let i = 0; i < guessHistory.length; i++) {
      const { guess, feedback } = guessHistory[i];
      const row = document.createElement('div');
      row.className = 'mm-guess-row mm-history-row';
      for (const c of guess) row.appendChild(makeSlot(c));
      row.appendChild(makeFeedback(feedback));
      board.appendChild(row);
    }
  }

  // --- Phase: countdown ---

  function startCountdown() {
    phase = 'countdown';
    countdownOverlay.style.display = 'flex';
    const cnum = root.querySelector('#mm-cnum');

    const tick = () => {
      const ms = state.startAt - Date.now();
      if (ms <= 0) {
        countdownOverlay.style.display = 'none';
        startRound();
        return;
      }
      cnum.textContent = Math.ceil(ms / 1000);
    };
    tick();
    const iv = setInterval(() => {
      const ms = state.startAt - Date.now();
      if (ms <= 0) {
        clearInterval(iv);
        countdownOverlay.style.display = 'none';
        startRound();
      } else {
        cnum.textContent = Math.ceil(ms / 1000);
      }
    }, 200);
  }

  // --- Phase: playing ---

  function startRound() {
    phase = 'playing';
    guessHistory = [];
    currentGuess = [];
    myRoundResult = null;
    oppRoundResult = null;
    roundReadySent = false;
    oppRoundReadyReceived = false;
    timeRemaining = Math.ceil(roundConfig.timeMs / 1000);

    waitingOverlay.style.display = 'none';
    forfeitOverlay.style.display = 'none';
    inputArea.style.opacity = '1';
    inputArea.style.pointerEvents = '';
    submitBtn.disabled = true;
    timerEl.style.display = 'none';

    renderHeader();
    renderPenalty();
    renderBoard();
    renderCurrentRow();
  }

  function addColor(c) {
    if (phase !== 'playing') return;
    if (currentGuess.length >= roundConfig.slots) return;
    currentGuess.push(c);
    renderCurrentRow();
  }

  function removeColor() {
    if (phase !== 'playing') return;
    if (currentGuess.length === 0) return;
    currentGuess.pop();
    renderCurrentRow();
  }

  function submitGuess() {
    if (phase !== 'playing' || currentGuess.length < roundConfig.slots) return;
    const guess = [...currentGuess];
    const positions = evaluateGuessPositional(code, guess);
    guessHistory.push({ guess, feedback: positions });
    currentGuess = [];

    socket.send({ type: MSG.MM_GUESS, guess });

    renderBoard();
    renderCurrentRow();

    if (positions.every(p => p === 'place')) {
      endRound(true);
    } else if (guessHistory.length >= roundConfig.guesses) {
      endRound(false);
    }
  }

  // --- Phase: waiting / forfeit ---

  function endRound(solved) {
    if (phase !== 'playing') return;
    phase = 'waiting';
    myRoundResult = { solved };
    if (solved) myRoundsSolved++;

    if (gameMode === 'easy') haptics.testVibe(0);

    inputArea.style.opacity = '0.4';
    inputArea.style.pointerEvents = 'none';
    submitBtn.disabled = true;

    socket.send({ type: MSG.MM_ROUND_END, solved });

    if (oppRoundResult !== null) {
      enterForfeit();
    } else {
      waitingOverlay.style.display = 'flex';
    }
  }

  function enterForfeit() {
    phase = 'forfeit';
    waitingOverlay.style.display = 'none';
    forfeitOverlay.style.display = 'flex';

    const mySolved = myRoundResult.solved;
    const oppSolved = oppRoundResult.solved;
    const fs = state.forfeitDuration ?? 30;

    const myVibeSeconds  = mySolved ? 0 : fs;
    const oppVibeSeconds = oppSolved ? 0 : fs;

    const codeHtml = code.map(c =>
      `<div class="mm-slot" style="background:${COLOR_STYLE[c].bg};color:${COLOR_STYLE[c].text}">${c}</div>`
    ).join('');

    const resultLine = (name, solved) =>
      `<div class="mm-forfeit-result ${solved ? 'mm-solved' : 'mm-failed'}">
        ${solved ? '✓' : '✗'} ${escapeHtml(name)}: ${solved ? 'Cracked it!' : 'Failed'}
      </div>`;

    const vibeRows = (myVibeSeconds > 0 || oppVibeSeconds > 0) ? `
      <div class="mm-vibe-section">
        ${myVibeSeconds > 0 ? `
          <div class="mm-vibe-row">
            <div class="mm-vibe-label">${escapeHtml(myName)}: <span id="mm-my-vibe-ctr">${myVibeSeconds}</span>s</div>
            <div class="mm-vibe-bar-wrap"><div class="mm-vibe-bar" id="mm-my-vibe-bar" style="width:100%"></div></div>
          </div>` : ''}
        ${oppVibeSeconds > 0 ? `
          <div class="mm-vibe-row">
            <div class="mm-vibe-label">${escapeHtml(oppName)}: <span id="mm-opp-vibe-ctr">${oppVibeSeconds}</span>s</div>
            <div class="mm-vibe-bar-wrap"><div class="mm-vibe-bar" id="mm-opp-vibe-bar" style="width:100%"></div></div>
          </div>` : ''}
      </div>` : `<div class="mm-no-vibe">No penalty this round — both cracked it!</div>`;

    const sliderHtml = (myVibeSeconds > 0 || oppVibeSeconds > 0) ? `
      <div class="forfeit-slider-row" style="margin-top:12px;">
        <span>Intensity</span>
        <input type="range" id="mm-intensity-slider" min="0" max="100" value="100" style="flex:1;margin:0 12px;">
        <span id="mm-intensity-pct">100%</span>
      </div>
      <div style="display:flex;justify-content:center;margin-top:10px;">
        <button id="mm-vibe-toggle" style="min-width:100px;">Start</button>
      </div>` : '';

    forfeitContent.innerHTML = `
      <h2>Round ${roundIndex + 1} Over</h2>
      <div class="mm-code-reveal">
        <div class="mm-code-label">The code was:</div>
        <div class="mm-code-slots">${codeHtml}</div>
      </div>
      ${resultLine(myName, mySolved)}
      ${resultLine(oppName, oppSolved)}
      ${vibeRows}
      ${sliderHtml}
      <button id="mm-continue" class="mm-continue-btn"${roundReadySent ? ' disabled' : ''}>
        ${roundReadySent ? 'Waiting for opponent…' : 'Continue'}
      </button>`;

    forfeitContent.querySelector('#mm-continue').addEventListener('click', onContinueClick);

    if (myVibeSeconds > 0 || oppVibeSeconds > 0) {
      let vibeRunning = false;
      let myRemaining  = myVibeSeconds;
      let oppRemaining = oppVibeSeconds;
      let elapsedWhileRunning = 0;
      let runStartTime = null;

      const toggleBtn = forfeitContent.querySelector('#mm-vibe-toggle');
      const slider    = forfeitContent.querySelector('#mm-intensity-slider');
      const pctEl     = forfeitContent.querySelector('#mm-intensity-pct');

      function applyVibeToggle(nowRunning, fromRemote) {
        if (vibeRunning === nowRunning) return;
        vibeRunning = nowRunning;
        if (toggleBtn) toggleBtn.textContent = vibeRunning ? 'Stop' : 'Start';
        const now = Date.now();
        if (vibeRunning) {
          if (myVibeSeconds > 0) haptics.startForfeitVibe(myRemaining);
          runStartTime = now;
        } else {
          if (runStartTime != null) {
            elapsedWhileRunning += (now - runStartTime) / 1000;
            runStartTime = null;
          }
          if (myVibeSeconds > 0) {
            myRemaining = Math.max(0, myVibeSeconds - elapsedWhileRunning);
            haptics.pauseForfeitVibe();
          }
          if (oppVibeSeconds > 0) {
            oppRemaining = Math.max(0, oppVibeSeconds - elapsedWhileRunning);
          }
        }
        if (!fromRemote) socket.send({ type: MSG.FORFEIT_TOGGLE, running: vibeRunning });
      }

      if (toggleBtn) toggleBtn.addEventListener('click', () => applyVibeToggle(!vibeRunning, false));

      forfeitInterval = setInterval(() => {
        const now = Date.now();
        if (vibeRunning && runStartTime != null) {
          const totalElapsed = elapsedWhileRunning + (now - runStartTime) / 1000;
          if (myVibeSeconds > 0)  myRemaining  = Math.max(0, myVibeSeconds  - totalElapsed);
          if (oppVibeSeconds > 0) oppRemaining = Math.max(0, oppVibeSeconds - totalElapsed);
        }

        const myCtr  = forfeitContent.querySelector('#mm-my-vibe-ctr');
        const myBar  = forfeitContent.querySelector('#mm-my-vibe-bar');
        const oppCtr = forfeitContent.querySelector('#mm-opp-vibe-ctr');
        const oppBar = forfeitContent.querySelector('#mm-opp-vibe-bar');

        if (myCtr)  myCtr.textContent  = Math.ceil(myRemaining);
        if (myBar)  myBar.style.width  = `${(myRemaining  / myVibeSeconds)  * 100}%`;
        if (oppCtr) oppCtr.textContent = Math.ceil(oppRemaining);
        if (oppBar) oppBar.style.width = `${(oppRemaining / oppVibeSeconds) * 100}%`;
      }, 100);

      if (slider) {
        slider.addEventListener('input', () => {
          const level = slider.value / 100;
          if (pctEl) pctEl.textContent = `${slider.value}%`;
          haptics.setForfeitIntensity(level);
          socket.send({ type: MSG.FORFEIT_INTENSITY, level });
        });
      }

      const onForfeitIntensity = (ev) => {
        const level = ev.detail.level;
        if (slider) slider.value = Math.round(level * 100);
        if (pctEl)  pctEl.textContent = `${Math.round(level * 100)}%`;
        haptics.setForfeitIntensity(level);
      };

      const onForfeitToggle = (ev) => applyVibeToggle(!!ev.detail.running, true);

      socket.addEventListener(MSG.FORFEIT_INTENSITY, onForfeitIntensity);
      socket.addEventListener(MSG.FORFEIT_TOGGLE, onForfeitToggle);

      const cleanupRoundForfeit = () => {
        socket.removeEventListener(MSG.FORFEIT_INTENSITY, onForfeitIntensity);
        socket.removeEventListener(MSG.FORFEIT_TOGGLE, onForfeitToggle);
        haptics.pauseForfeitVibe();
      };
      window._mmRoundForfeitCleanup = cleanupRoundForfeit;
    }
  }

  function onContinueClick() {
    if (roundReadySent) return;
    roundReadySent = true;
    socket.send({ type: MSG.MM_ROUND_READY });
    const btn = root.querySelector('#mm-continue');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Waiting for opponent…';
    }
    checkBothReady();
  }

  function checkBothReady() {
    if (!roundReadySent || !oppRoundReadyReceived) return;
    clearInterval(forfeitInterval);
    forfeitInterval = null;
    if (window._mmRoundForfeitCleanup) { window._mmRoundForfeitCleanup(); window._mmRoundForfeitCleanup = null; }

    const bothSucceeded = myRoundResult.solved && oppRoundResult.solved;
    roundIndex++;

    if (roundIndex >= totalRounds) {
      state.myVibeResidual = 0;
      socket.send({ type: MSG.FINAL, value: myRoundsSolved, vibeSeconds: 0 });
      state.myFinal = myRoundsSolved;
      navigate('#/results');
    } else {
      roundConfig = nextRoundConfig(roundConfig, bothSucceeded);
      code = generateCode(rng, roundConfig.slots);
      if (state.edgeMode) {
        showEdgeReadyOverlay({ role: state.role, seed: state.seed, roundIndex, onReady: (assignment) => {
          if (edgeModeInstance) edgeModeInstance.setAssignment(assignment);
          startRound();
        }});
      } else {
        startRound();
      }
    }
  }

  // --- Input ---

  function onKeyDown(e) {
    if (edgePaused) return;
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      const existing = root.querySelector('#mm-debug-code');
      if (existing) { existing.remove(); return; }
      const el = document.createElement('div');
      el.id = 'mm-debug-code';
      el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#1a2342;border:1px solid #8794b8;border-radius:8px;padding:8px 16px;font-size:13px;color:#e6ecff;z-index:999;pointer-events:none';
      el.textContent = `Code: ${code.join(' ')} | Mode: ${gameMode}`;
      root.appendChild(el);
      setTimeout(() => el.remove(), 5000);
      return;
    }
    if (phase !== 'playing') return;
    const k = e.key.toUpperCase();
    if (COLORS.includes(k)) { e.preventDefault(); addColor(k); return; }
    if (e.key === 'Backspace') { removeColor(); return; }
    if (e.key === 'Enter') { submitGuess(); return; }
  }

  root.querySelector('#back-to-lobby').addEventListener('click', () => {
    state.myFinal = null;
    state.oppFinal = null;
    state.seed = null;
    state.startAt = null;
    navigate(`#/session/${state.sessionId}`);
  });

  document.addEventListener('keydown', onKeyDown);

  root.querySelector('.mm-color-palette').addEventListener('click', (e) => {
    if (e.target.id === 'mm-back') { removeColor(); return; }
    const btn = e.target.closest('[data-color]');
    if (btn) addColor(btn.dataset.color);
  });

  submitBtn.addEventListener('click', submitGuess);

  const vibeBtn = root.querySelector('#mm-vibe-btn');
  vibeBtn.addEventListener('click', async () => {
    if (haptics.isConnected()) return;
    vibeBtn.textContent = 'Connecting…';
    vibeBtn.disabled = true;
    try {
      const dev = await haptics.connect();
      vibeBtn.textContent = dev ? `📳 ${dev.name}` : 'No device found';
      vibeBtn.disabled = !!dev;
    } catch {
      vibeBtn.textContent = 'Connect Vibe';
      vibeBtn.disabled = false;
    }
  });

  // --- Socket events ---

  function onMmGuess(ev) {
    if (phase !== 'playing') return;
    const guess = ev.detail?.guess;
    if (!Array.isArray(guess)) return;
    const positions = evaluateGuessPositional(code, guess);
    const rightPlace = positions.filter(p => p === 'place').length;
    const rightColor = positions.filter(p => p === 'color').length;
    if (gameMode === 'easy') {
      const perPlace = 0.75 / roundConfig.slots;
      haptics.testVibe(Math.min(1, rightPlace * perPlace + rightColor * (perPlace / 2)));
    } else {
      const vibeSeconds = rightPlace * 2 + rightColor * 1;
      if (vibeSeconds > 0) haptics.addVibeSeconds(vibeSeconds);
    }
  }

  function onMmRoundEnd(ev) {
    oppRoundResult = { solved: !!ev.detail?.solved };
    if (phase === 'waiting') enterForfeit();
  }

  function onMmRoundReady() {
    oppRoundReadyReceived = true;
    checkBothReady();
  }

  function onPeerLeft() {
    clearInterval(timerInterval);
    clearInterval(forfeitInterval);
    root.innerHTML = `
      <div class="card">
        <h2>Opponent left</h2>
        <div class="actions"><button onclick="location.hash='#/'">Home</button></div>
      </div>`;
  }

  socket.addEventListener(MSG.MM_GUESS, onMmGuess);
  socket.addEventListener(MSG.MM_ROUND_END, onMmRoundEnd);
  socket.addEventListener(MSG.MM_ROUND_READY, onMmRoundReady);
  socket.addEventListener(MSG.PEER_LEFT, onPeerLeft);

  const cleanup = () => {
    clearInterval(timerInterval);
    clearInterval(forfeitInterval);
    if (window._mmRoundForfeitCleanup) { window._mmRoundForfeitCleanup(); window._mmRoundForfeitCleanup = null; }
    document.removeEventListener('keydown', onKeyDown);
    socket.removeEventListener(MSG.MM_GUESS, onMmGuess);
    socket.removeEventListener(MSG.MM_ROUND_END, onMmRoundEnd);
    socket.removeEventListener(MSG.MM_ROUND_READY, onMmRoundReady);
    socket.removeEventListener(MSG.PEER_LEFT, onPeerLeft);
    if (edgeModeInstance) { edgeModeInstance.destroy(); edgeModeInstance = null; }
    if (vibeBatteryInstance) { vibeBatteryInstance.destroy(); vibeBatteryInstance = null; }
    haptics.stopAll();
  };
  window.addEventListener('hashchange', cleanup, { once: true });

  function _initEdgeModeInstance(assignment) {
    edgeModeInstance = initEdgeMode({
      role: state.role,
      myLives: state.edgeLives,
      assignment,
      containerEl: root,
      onPause: () => {
        edgePaused = true;
        savedHaptics = haptics.pauseHaptics();
      },
      onResume: () => {
        edgePaused = false;
        haptics.resumeHaptics(savedHaptics);
      },
    });
  }

  if (state.edgeMode) {
    showEdgeReadyOverlay({ role: state.role, seed: state.seed, roundIndex: 0, onReady: (assignment) => {
      _initEdgeModeInstance(assignment);
      _showMastermindInstructions(state, startCountdown);
    }});
  } else {
    _showMastermindInstructions(state, startCountdown);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function _showMastermindInstructions(state, onReady) {
  const forfeitSecs = state.forfeitDuration ?? 30;
  const mode = state.gameMode || 'easy';
  const rounds = state.gameRounds || 3;
  const overlay = document.createElement('div');
  overlay.className = 'instructions-overlay';
  overlay.innerHTML = `
    <div class="instructions-box">
      <h2>Mastermind</h2>
      <p class="instructions-meta">Mode: <strong>${mode === 'hard' ? 'Hard' : 'Easy'}</strong> &nbsp;·&nbsp; Rounds: <strong>${rounds}</strong></p>
      <div class="instructions-section">
        <div class="instructions-heading">Goal</div>
        <ul class="instructions-list">
          <li>Crack the hidden color code before your opponent.</li>
          <li>Most rounds cracked wins.</li>
        </ul>
      </div>
      <div class="instructions-section">
        <div class="instructions-heading">Feedback</div>
        <ul class="instructions-list">
          <li>Pick colors, then submit your guess.</li>
          <li><strong>Green dot</strong> = right color, right position.</li>
          <li><strong>Yellow dot</strong> = right color, wrong position.</li>
          ${mode === 'hard' ? '<li>Hard mode: only a dot count shown — no positions.</li>' : ''}
        </ul>
      </div>
      <div class="instructions-section">
        <div class="instructions-heading">Vibe penalties</div>
        <ul class="instructions-list">
          <li>Each correct-position guess vibrates your opponent.</li>
          <li>Fail a round → vibe penalty. Fail while opponent cracks it → double.</li>
        </ul>
      </div>
      <p class="instructions-forfeit">Loser pays forfeit: <strong>${forfeitSecs}s</strong> vibe after the game.</p>
      <button id="inst-ready">Got it — I'm ready!</button>
      <p class="instructions-waiting" id="inst-wait" style="visibility:hidden">Waiting for opponent…</p>
    </div>
  `;
  document.body.appendChild(overlay);

  const readyBtn = overlay.querySelector('#inst-ready');
  const waitEl = overlay.querySelector('#inst-wait');
  let settled = false;

  function proceed(startAt) {
    if (settled) return;
    settled = true;
    state.startAt = startAt;
    socket.removeEventListener(MSG.INST_GO, onGo);
    overlay.remove();
    onReady();
  }

  const onGo = (ev) => proceed(ev.detail.startAt);
  socket.addEventListener(MSG.INST_GO, onGo);

  readyBtn.addEventListener('click', () => {
    readyBtn.disabled = true;
    waitEl.style.visibility = 'visible';
    socket.send({ type: MSG.INST_READY });
  });

  window.addEventListener('hashchange', () => {
    settled = true;
    socket.removeEventListener(MSG.INST_GO, onGo);
    overlay.remove();
  }, { once: true });
}
