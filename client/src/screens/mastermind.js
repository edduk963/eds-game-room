import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';
import { initEdgeMode } from '../game/edgeMode.js';
import { showEdgeReadyOverlay } from '../game/edgeAssignment.js';
import { initVibeBattery } from '../vibeBattery.js';
import { initVibeModeBar } from '../vibeModeBar.js';
import { makeRng } from '../game/seededRng.js';
import {
  getBaseConfig, nextRoundConfig, generateCode, evaluateGuessPositional,
  COLORS, POWERUPS, chargesFromGuess, calcVibeEarned,
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

  const hostGoesFirst = state.seed % 2 === 0;
  const iAmHost = state.role === 'host';

  let roundIndex = 0;
  let roundConfig = getBaseConfig(gameMode);
  let code = generateCode(rng, roundConfig.slots);

  // Shared board state
  let guessHistory = [];   // { guess, feedback, by: 'mine'|'theirs' }[]
  let currentGuess = [];
  let roundWinner = null;  // 'mine' | 'theirs' | null
  let roundReadySent = false;
  let oppRoundReadyReceived = false;
  let phase = 'countdown'; // countdown | playing | won | lost | both-failed | done

  // Turn state
  let currentTurn = 'mine';
  let myNextTurnSkipped = false;
  let oppNextTurnSkipped = false;

  // Powerup state
  let myCharges = 0;
  let oppCharges = 0;      // mirrors the opponent's charge count, used to validate their MM_POWERUP spends
  let myBanked = 0;        // seconds banked from previous wins
  let hintedSlots = [];    // { index, color }[]

  // Vibe choice state (set after winner decides bank/use)
  let vibeChoiceMade = false;

  let forfeitInterval = null;
  let myRoundsSolved = 0;
  let oppRoundsSolved = 0;
  let gameEndReadySent = false;
  let gameEndOppReady = false;
  let edgeModeInstance = null;
  let vibeBatteryInstance = initVibeBattery(root);
  let vibeModeBarInstance = null;
  let edgePaused = false;
  let savedHaptics = null;

  const myName = state.myName || 'You';
  const oppName = (state.role === 'host' ? state.guestName : state.hostName) || 'Opponent';

  // Mode + feedback-dot legend shown at the top of the board.
  const _modeName = gameMode === 'hard' ? 'Hard' : 'Easy';
  const _modeSub = gameMode === 'hard'
    ? '— feedback dots are an unordered tally (no positions shown)'
    : '— feedback dots line up with each slot';
  const _legendItem = (cls, text) =>
    `<span style="display:inline-flex;align-items:center;gap:6px;"><span class="mm-dot ${cls}"></span>${text}</span>`;
  const _legend = gameMode === 'hard'
    ? _legendItem('mm-dot-place', '# exactly right') +
      _legendItem('mm-dot-color', '# right colour, wrong spot')
    : _legendItem('mm-dot-place', 'right colour &amp; spot') +
      _legendItem('mm-dot-color', 'right colour, wrong spot') +
      _legendItem('mm-dot-over',  'colour in code but already matched') +
      _legendItem('mm-dot-empty', 'colour not in the code at all');
  const modeBarHtml = `
    <div id="mm-mode-bar" style="margin:6px 0 10px;padding:8px 12px;background:#141d33;border:1px solid #25304d;border-radius:8px;font-size:12px;color:var(--muted);">
      <div style="color:var(--ink);font-size:13px;margin-bottom:6px;">Mode: <strong>${_modeName}</strong> <span style="color:var(--muted);font-weight:400;">${_modeSub}</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;">${_legend}</div>
    </div>`;

  root.innerHTML = `
    <div id="mm-root" class="mm-root">
      <div class="mm-overlay" id="mm-countdown-overlay">
        <div class="mm-countdown-num" id="mm-cnum">3</div>
      </div>
      <div class="mm-overlay mm-forfeit-overlay" id="mm-forfeit-overlay" style="display:none">
        <div id="mm-forfeit-content" class="mm-forfeit-content"></div>
      </div>
      <div style="display:flex;justify-content:flex-start;margin-bottom:8px;">
        <button class="ghost" id="back-to-lobby" style="padding:6px 14px;font-size:13px;">← Lobby</button>
      </div>
      <div class="mm-header">
        <div id="mm-round-label" class="mm-round-label">Round 1 of ${totalRounds}</div>
        <div id="mm-charges" class="mm-charges">⚡ 0</div>
        <button id="mm-vibe-btn" class="mm-vibe-btn ghost">${haptics.isConnected() ? '📳 Connected' : 'Connect Vibe'}</button>
      </div>
      <div id="mm-turn-indicator" class="mm-turn-indicator"></div>
      ${modeBarHtml}
      <div id="mm-vibe-gauge" class="mm-vibe-gauge" style="display:none">
        <div class="mm-gauge-row">
          <div class="mm-gauge-name" id="mm-gauge-my-name">You</div>
          <div class="mm-gauge-bar-wrap"><div class="mm-gauge-bar" id="mm-gauge-my-bar" style="width:0%"></div></div>
          <div class="mm-gauge-pct" id="mm-gauge-my-pct">0%</div>
        </div>
        <div class="mm-gauge-row">
          <div class="mm-gauge-name" id="mm-gauge-opp-name">Opp</div>
          <div class="mm-gauge-bar-wrap"><div class="mm-gauge-bar mm-gauge-bar-opp" id="mm-gauge-opp-bar" style="width:0%"></div></div>
          <div class="mm-gauge-pct" id="mm-gauge-opp-pct">0%</div>
        </div>
      </div>
      <div id="mm-hint-bar" class="mm-hint-bar" style="display:none"></div>
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
      <div id="mm-powerup-bar" class="mm-powerup-bar"></div>
    </div>`;

  vibeModeBarInstance = initVibeModeBar(root);

  const countdownOverlay = root.querySelector('#mm-countdown-overlay');
  const forfeitOverlay = root.querySelector('#mm-forfeit-overlay');
  const forfeitContent = root.querySelector('#mm-forfeit-content');
  const roundLabel = root.querySelector('#mm-round-label');
  const chargesEl = root.querySelector('#mm-charges');
  const turnIndicator = root.querySelector('#mm-turn-indicator');
  const hintBar = root.querySelector('#mm-hint-bar');
  const board = root.querySelector('#mm-board');
  const currentRow = root.querySelector('#mm-current-row');
  const inputArea = root.querySelector('#mm-input-area');
  const submitBtn = root.querySelector('#mm-submit');
  const powerupBar = root.querySelector('#mm-powerup-bar');

  // --- Render helpers ---

  function renderHeader() {
    roundLabel.textContent = `Round ${roundIndex + 1} of ${totalRounds}`;
    chargesEl.textContent = `⚡ ${myCharges}`;
  }

  function renderVibeGauge() {
    const gaugeEl = root.querySelector('#mm-vibe-gauge');
    if (!gaugeEl) return;
    const maxPositions = roundConfig.guesses * roundConfig.slots;
    const myWrong  = guessHistory.filter(g => g.by === 'mine'   && !g.feedback.every(p => p === 'place')).reduce((s, g) => s + g.feedback.filter(p => p !== 'place').length, 0);
    const oppWrong = guessHistory.filter(g => g.by === 'theirs' && !g.feedback.every(p => p === 'place')).reduce((s, g) => s + g.feedback.filter(p => p !== 'place').length, 0);
    if (myWrong === 0 && oppWrong === 0) { gaugeEl.style.display = 'none'; return; }
    gaugeEl.style.display = 'block';
    const myI  = Math.min(1, myWrong  / maxPositions);
    const oppI = Math.min(1, oppWrong / maxPositions);
    root.querySelector('#mm-gauge-my-name').textContent  = myName.slice(0, 6);
    root.querySelector('#mm-gauge-opp-name').textContent = oppName.slice(0, 6);
    root.querySelector('#mm-gauge-my-bar').style.width   = `${myI  * 100}%`;
    root.querySelector('#mm-gauge-opp-bar').style.width  = `${oppI * 100}%`;
    root.querySelector('#mm-gauge-my-pct').textContent   = `${Math.round(myI  * 100)}%`;
    root.querySelector('#mm-gauge-opp-pct').textContent  = `${Math.round(oppI * 100)}%`;
  }

  function renderTurnIndicator() {
    if (phase !== 'playing') { turnIndicator.textContent = ''; return; }
    if (currentTurn === 'mine') {
      turnIndicator.textContent = 'YOUR TURN';
      turnIndicator.className = 'mm-turn-indicator mm-turn-mine';
    } else {
      turnIndicator.textContent = `${escapeHtml(oppName)}'s turn…`;
      turnIndicator.className = 'mm-turn-indicator mm-turn-theirs';
    }
  }

  function renderHints() {
    if (hintedSlots.length === 0) { hintBar.style.display = 'none'; return; }
    hintBar.style.display = 'flex';
    hintBar.innerHTML = '<span class="mm-hint-label">Hints:</span>' +
      hintedSlots.map(h =>
        `<span class="mm-hint-chip">Slot ${h.index + 1}=<span class="mm-hint-color" style="background:${COLOR_STYLE[h.color].bg};color:${COLOR_STYLE[h.color].text};padding:0 4px;border-radius:3px;font-weight:700">${h.color}</span></span>`
      ).join('');
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
      : [...positions].sort((a, b) => ({ place: 0, color: 1, over: 2, empty: 3 }[a] - { place: 0, color: 1, over: 2, empty: 3 }[b]));
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
      const slot = makeSlot(currentGuess[i] || null);
      // Highlight hinted slots
      const hint = hintedSlots.find(h => h.index === i);
      if (hint && !currentGuess[i]) {
        slot.style.borderColor = COLOR_STYLE[hint.color].bg;
        slot.style.borderWidth = '3px';
        slot.style.borderStyle = 'dashed';
      }
      currentRow.appendChild(slot);
    }
    const isMyTurn = currentTurn === 'mine' && phase === 'playing';
    submitBtn.disabled = !isMyTurn || currentGuess.length < roundConfig.slots;
    const palette = root.querySelector('.mm-color-palette');
    if (palette) {
      palette.style.opacity = isMyTurn ? '1' : '0.4';
      palette.style.pointerEvents = isMyTurn ? '' : 'none';
    }
  }

  function renderBoard() {
    board.innerHTML = '';
    const remaining = roundConfig.guesses - guessHistory.length;
    for (let i = 0; i < remaining; i++) {
      const row = document.createElement('div');
      row.className = 'mm-guess-row mm-empty-row';
      for (let j = 0; j < roundConfig.slots; j++) row.appendChild(makeSlot(null));
      const fb = document.createElement('div');
      fb.className = 'mm-feedback';
      row.appendChild(fb);
      board.prepend(row);
    }
    for (const { guess, feedback, by } of guessHistory) {
      const row = document.createElement('div');
      row.className = `mm-guess-row mm-history-row mm-by-${by}`;
      const nameTag = document.createElement('div');
      nameTag.className = 'mm-row-name';
      nameTag.textContent = by === 'mine' ? myName : oppName;
      row.appendChild(nameTag);
      for (const c of guess) row.appendChild(makeSlot(c));
      row.appendChild(makeFeedback(feedback));
      board.appendChild(row);
    }
  }

  function renderPowerups() {
    powerupBar.innerHTML = '';
    for (const pu of POWERUPS) {
      const btn = document.createElement('button');
      const canUse = myCharges >= pu.cost && currentTurn === 'mine' && phase === 'playing';
      btn.className = 'mm-powerup-btn ghost' + (canUse ? '' : ' mm-powerup-disabled');
      btn.disabled = !canUse;
      btn.title = pu.desc;
      btn.innerHTML = `<span class="pu-label">${pu.label}</span><span class="pu-cost">⚡${pu.cost}</span>`;
      btn.addEventListener('click', () => usePowerup(pu.id));
      powerupBar.appendChild(btn);
    }
    if (myBanked > 0) {
      const bankedEl = document.createElement('div');
      bankedEl.className = 'mm-banked-display';
      bankedEl.textContent = `🏦 ${myBanked}s banked`;
      powerupBar.appendChild(bankedEl);
    }
  }

  // --- Phase: countdown ---

  function startCountdown() {
    phase = 'countdown';
    countdownOverlay.style.display = 'flex';
    const cnum = root.querySelector('#mm-cnum');
    const tick = () => {
      const ms = state.startAt - Date.now();
      if (ms <= 0) { countdownOverlay.style.display = 'none'; startRound(); return; }
      cnum.textContent = Math.ceil(ms / 1000);
    };
    tick();
    const iv = setInterval(() => {
      const ms = state.startAt - Date.now();
      if (ms <= 0) { clearInterval(iv); countdownOverlay.style.display = 'none'; startRound(); }
      else cnum.textContent = Math.ceil(ms / 1000);
    }, 200);
  }

  // --- Phase: playing ---

  function initTurnForRound() {
    // Alternate who goes first each round
    const roundHostFirst = hostGoesFirst !== (roundIndex % 2 === 1);
    currentTurn = ((roundHostFirst && iAmHost) || (!roundHostFirst && !iAmHost)) ? 'mine' : 'theirs';
  }

  function startRound() {
    phase = 'playing';
    guessHistory = [];
    currentGuess = [];
    roundWinner = null;
    roundReadySent = false;
    oppRoundReadyReceived = false;
    vibeChoiceMade = false;
    hintedSlots = [];
    myNextTurnSkipped = false;
    oppNextTurnSkipped = false;

    forfeitOverlay.style.display = 'none';
    inputArea.style.opacity = '1';
    inputArea.style.pointerEvents = '';

    initTurnForRound();
    renderHeader();
    renderBoard();
    renderVibeGauge();
    renderCurrentRow();
    renderTurnIndicator();
    renderHints();
    renderPowerups();
  }

  function addColor(c) {
    if (phase !== 'playing' || currentTurn !== 'mine') return;
    if (currentGuess.length >= roundConfig.slots) return;
    currentGuess.push(c);
    renderCurrentRow();
  }

  function removeColor() {
    if (phase !== 'playing' || currentTurn !== 'mine') return;
    if (currentGuess.length === 0) return;
    currentGuess.pop();
    renderCurrentRow();
  }

  function submitGuess() {
    if (phase !== 'playing' || currentTurn !== 'mine') return;
    if (currentGuess.length < roundConfig.slots) return;

    const guess = [...currentGuess];
    const positions = evaluateGuessPositional(code, guess);
    guessHistory.push({ guess, feedback: positions, by: 'mine' });

    const earned = chargesFromGuess(positions);
    myCharges += earned;
    currentGuess = [];

    socket.send({ type: MSG.MM_GUESS, guess });

    if (!positions.every(p => p === 'place')) {
      const myWrong = guessHistory.filter(g => g.by === 'mine' && !g.feedback.every(p => p === 'place')).reduce((s, g) => s + g.feedback.filter(p => p !== 'place').length, 0);
      haptics.testVibe(Math.min(1, myWrong / (roundConfig.guesses * roundConfig.slots)));
    }

    renderBoard();
    renderVibeGauge();
    renderCurrentRow();
    renderHeader();

    if (positions.every(p => p === 'place')) {
      endRound('mine');
    } else if (guessHistory.length >= roundConfig.guesses) {
      endRound(null);
    } else {
      advanceTurn();
    }
  }

  function advanceTurn() {
    const nextTurn = currentTurn === 'mine' ? 'theirs' : 'mine';
    if (nextTurn === 'theirs' && oppNextTurnSkipped) {
      oppNextTurnSkipped = false;
      showTurnNotice("Opponent's turn skipped!");
      // currentTurn stays 'mine'
    } else if (nextTurn === 'mine' && myNextTurnSkipped) {
      myNextTurnSkipped = false;
      showTurnNotice('Your turn was skipped!');
      currentTurn = 'theirs';
    } else {
      currentTurn = nextTurn;
    }
    renderTurnIndicator();
    renderCurrentRow();
    renderPowerups();
  }

  function showTurnNotice(msg) {
    const existing = root.querySelector('.mm-turn-notice');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = 'mm-turn-notice';
    el.textContent = msg;
    root.querySelector('#mm-root').appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  // --- Powerups ---

  function usePowerup(type) {
    const pu = POWERUPS.find(p => p.id === type);
    if (!pu || myCharges < pu.cost || currentTurn !== 'mine' || phase !== 'playing') return;

    myCharges -= pu.cost;
    renderHeader();

    if (type === 'hint') {
      const unhinted = code.map((_, i) => i).filter(i => !hintedSlots.find(h => h.index === i));
      if (unhinted.length === 0) { myCharges += pu.cost; renderHeader(); return; }
      const slotIndex = unhinted[Math.floor(Math.random() * unhinted.length)];
      const color = code[slotIndex];
      hintedSlots.push({ index: slotIndex, color });
      socket.send({ type: MSG.MM_POWERUP, powerup: 'hint', slotIndex, color });
      renderHints();
      renderCurrentRow();
      showTurnNotice(`Hint: Slot ${slotIndex + 1} = ${color}`);
    } else if (type === 'zap') {
      socket.send({ type: MSG.MM_POWERUP, powerup: 'zap' });
      showTurnNotice('Zap sent!');
    } else if (type === 'skip') {
      oppNextTurnSkipped = true;
      socket.send({ type: MSG.MM_POWERUP, powerup: 'skip' });
      showTurnNotice("Opponent's next turn will be skipped!");
    } else if (type === 'add_guess') {
      roundConfig = { ...roundConfig, guesses: roundConfig.guesses + 1 };
      socket.send({ type: MSG.MM_POWERUP, powerup: 'add_guess' });
      renderBoard();
      showTurnNotice('+1 guess added to the board!');
    } else if (type === 'remove_guess') {
      if (roundConfig.guesses - guessHistory.length <= 1) { myCharges += pu.cost; renderHeader(); return; }
      roundConfig = { ...roundConfig, guesses: roundConfig.guesses - 1 };
      socket.send({ type: MSG.MM_POWERUP, powerup: 'remove_guess' });
      renderBoard();
      showTurnNotice('−1 guess removed from the board!');
    }

    renderPowerups();
  }

  // --- Phase: round end ---

  function endRound(winner) {
    if (phase !== 'playing') return;
    roundWinner = winner;
    inputArea.style.opacity = '0.4';
    inputArea.style.pointerEvents = 'none';
    submitBtn.disabled = true;
    renderTurnIndicator();

    if (winner === 'mine') {
      phase = 'won';
      myRoundsSolved++;
      enterWonPhase();
    } else if (winner === 'theirs') {
      phase = 'lost';
      oppRoundsSolved++;
      enterLostPhase();
    } else {
      phase = 'both-failed';
      enterBothFailedPhase();
    }
  }

  function calcMyVibeEarned() {
    return calcVibeEarned(myRoundsSolved); // myRoundsSolved already incremented before this is called
  }

  function enterWonPhase() {
    const isLastRound = roundIndex + 1 >= totalRounds;
    const earned = calcMyVibeEarned();
    const total = earned + myBanked;

    const codeHtml = code.map(c =>
      `<div class="mm-slot" style="background:${COLOR_STYLE[c].bg};color:${COLOR_STYLE[c].text}">${c}</div>`
    ).join('');

    const winLabel = myRoundsSolved === 1
      ? 'First win — 30s'
      : `Win #${myRoundsSolved} — ${earned}s (×${Math.pow(2, myRoundsSolved - 1)} base)`;

    const bankOrWaive = isLastRound
      ? `<button id="mm-bank-it" class="mm-choice-bank">Waive — no forfeit this round</button>`
      : `<button id="mm-bank-it" class="mm-choice-bank">Bank it for later</button>`;

    forfeitContent.innerHTML = `
      <h2>You cracked it! 🎉</h2>
      <div class="mm-code-reveal">
        <div class="mm-code-label">The code was:</div>
        <div class="mm-code-slots">${codeHtml}</div>
      </div>
      <div class="mm-vibe-earned">
        <div>${winLabel}</div>
        ${myBanked > 0 ? `<div class="mm-banked-note">+ ${myBanked}s banked = <strong>${total}s total</strong></div>` : ''}
      </div>
      <div class="mm-vibe-choice-btns">
        <button id="mm-use-now" class="mm-choice-use">Use Now (${total}s on opponent)</button>
        ${bankOrWaive}
      </div>`;

    forfeitOverlay.style.display = 'flex';

    forfeitContent.querySelector('#mm-use-now').addEventListener('click', () => {
      myBanked = 0;
      haptics.setWaveVibeMode(true);
      socket.send({ type: MSG.MM_VIBE_CHOICE, choice: 'use', vibeSeconds: total });
      showForfeitForWinner(total, false);
    });

    forfeitContent.querySelector('#mm-bank-it').addEventListener('click', () => {
      if (isLastRound) {
        socket.send({ type: MSG.MM_VIBE_CHOICE, choice: 'waive' });
        showForfeitForWinner(0, false);
      } else {
        myBanked = total;
        socket.send({ type: MSG.MM_VIBE_CHOICE, choice: 'bank' });
        showForfeitForWinner(0, true);
      }
    });
  }

  function showForfeitForWinner(oppVibeSeconds, banked) {
    const codeHtml = code.map(c =>
      `<div class="mm-slot" style="background:${COLOR_STYLE[c].bg};color:${COLOR_STYLE[c].text}">${c}</div>`
    ).join('');

    const vibeSection = oppVibeSeconds > 0 ? `
      <div class="mm-claim-section">
        <div class="mm-claim-countdown"><span id="mm-opp-vibe-ctr">${oppVibeSeconds}</span><span class="mm-ctr-unit">s</span></div>
        <div class="mm-wave-pattern">Pattern: <span id="mm-wave-state">—</span></div>
        <div class="mm-vibe-bar-wrap" style="margin:8px 0"><div class="mm-vibe-bar" id="mm-opp-vibe-bar" style="width:100%"></div></div>
        <div class="forfeit-slider-row">
          <span>Strength</span>
          <input type="range" id="mm-intensity-slider" min="0" max="100" value="100" style="flex:1;margin:0 12px;">
          <span id="mm-intensity-pct">100%</span>
        </div>
        <div style="display:flex;justify-content:center;margin-top:10px;">
          <button id="mm-vibe-toggle" style="min-width:100px;">Stop</button>
        </div>
      </div>` : `<div class="mm-no-vibe">${banked ? `Banked! 🏦 ${myBanked}s saved for later.` : 'No vibe this round.'}</div>`;

    forfeitContent.innerHTML = `
      <h2>Round ${roundIndex + 1} Over</h2>
      <div class="mm-code-reveal">
        <div class="mm-code-label">The code was:</div>
        <div class="mm-code-slots">${codeHtml}</div>
      </div>
      <div class="mm-forfeit-result mm-solved">✓ You cracked it!</div>
      ${vibeSection}
      <button id="mm-continue" class="mm-continue-btn">Continue</button>`;

    forfeitContent.querySelector('#mm-continue').addEventListener('click', onContinueClick);

    if (oppVibeSeconds > 0) {
      setupForfeitVibeUI(0, oppVibeSeconds, true);
    }
  }

  function enterLostPhase() {
    const codeHtml = code.map(c =>
      `<div class="mm-slot" style="background:${COLOR_STYLE[c].bg};color:${COLOR_STYLE[c].text}">${c}</div>`
    ).join('');

    forfeitContent.innerHTML = `
      <h2>Round ${roundIndex + 1} Over</h2>
      <div class="mm-code-reveal">
        <div class="mm-code-label">The code was:</div>
        <div class="mm-code-slots">${codeHtml}</div>
      </div>
      <div class="mm-forfeit-result mm-failed">✗ Opponent cracked it</div>
      <div class="mm-waiting-text" style="margin:16px 0">Waiting for opponent's decision…</div>`;

    forfeitOverlay.style.display = 'flex';
    // Continue button appears when MM_VIBE_CHOICE is received (handled in onMmVibeChoice)
  }

  function enterBothFailedPhase() {
    const myVibe = 60 + myBanked;
    myBanked = 0;

    const codeHtml = code.map(c =>
      `<div class="mm-slot" style="background:${COLOR_STYLE[c].bg};color:${COLOR_STYLE[c].text}">${c}</div>`
    ).join('');

    forfeitContent.innerHTML = `
      <h2>Nobody cracked it!</h2>
      <div class="mm-code-reveal">
        <div class="mm-code-label">The code was:</div>
        <div class="mm-code-slots">${codeHtml}</div>
      </div>
      <div class="mm-forfeit-result mm-failed">✗ Both players fail — 60s + banked time!</div>
      <div class="mm-claim-section">
        <div class="mm-claim-countdown"><span id="mm-my-vibe-ctr">${myVibe}</span><span class="mm-ctr-unit">s</span></div>
        <div class="mm-wave-pattern">Pattern: <span id="mm-wave-state">—</span></div>
        <div class="mm-vibe-bar-wrap" style="margin:8px 0"><div class="mm-vibe-bar mm-vibe-bar-self" id="mm-my-vibe-bar" style="width:100%"></div></div>
        <div class="forfeit-slider-row">
          <span>Strength</span>
          <input type="range" id="mm-intensity-slider" min="0" max="100" value="100" style="flex:1;margin:0 12px;">
          <span id="mm-intensity-pct">100%</span>
        </div>
        <div style="display:flex;justify-content:center;margin-top:10px;">
          <button id="mm-vibe-toggle">Start</button>
        </div>
      </div>
      <button id="mm-continue" class="mm-continue-btn">Continue</button>`;

    forfeitOverlay.style.display = 'flex';
    forfeitContent.querySelector('#mm-continue').addEventListener('click', onContinueClick);
    if (myVibe > 0) {
      haptics.setWaveVibeMode(true);
      setupForfeitVibeUI(myVibe, 0);
    }
  }

  function setupForfeitVibeUI(myVibeSeconds, oppVibeSeconds, autoStart = false) {
    let vibeRunning = false;
    let myRemaining  = myVibeSeconds;
    let oppRemaining = oppVibeSeconds;
    let elapsedWhileRunning = 0;
    let runStartTime = null;

    const toggleBtn  = forfeitContent.querySelector('#mm-vibe-toggle');
    const slider     = forfeitContent.querySelector('#mm-intensity-slider');
    const pctEl      = forfeitContent.querySelector('#mm-intensity-pct');
    const waveStateEl = forfeitContent.querySelector('#mm-wave-state');

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
        if (oppVibeSeconds > 0) oppRemaining = Math.max(0, oppVibeSeconds - elapsedWhileRunning);
      }
      if (!fromRemote) socket.send({ type: MSG.FORFEIT_TOGGLE, running: vibeRunning });
    }

    if (toggleBtn) toggleBtn.addEventListener('click', () => applyVibeToggle(!vibeRunning, false));

    if (autoStart) applyVibeToggle(true, false);

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
      if (waveStateEl && vibeRunning) {
        waveStateEl.textContent = haptics.getWaveState();
      }
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

    window._mmRoundForfeitCleanup = () => {
      socket.removeEventListener(MSG.FORFEIT_INTENSITY, onForfeitIntensity);
      socket.removeEventListener(MSG.FORFEIT_TOGGLE, onForfeitToggle);
      haptics.pauseForfeitVibe();
    };
  }

  function onContinueClick() {
    if (roundReadySent) return;
    roundReadySent = true;
    socket.send({ type: MSG.MM_ROUND_READY });
    const btn = root.querySelector('#mm-continue');
    if (btn) { btn.disabled = true; btn.textContent = 'Waiting for opponent…'; }
    checkBothReady();
  }

  function checkBothReady() {
    if (!roundReadySent || !oppRoundReadyReceived) return;
    clearInterval(forfeitInterval);
    forfeitInterval = null;
    if (window._mmRoundForfeitCleanup) { window._mmRoundForfeitCleanup(); window._mmRoundForfeitCleanup = null; }

    roundIndex++;
    if (roundIndex >= totalRounds) {
      enterGameOverForfeit();
    } else {
      roundConfig = nextRoundConfig(roundConfig, gameMode);
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

  function enterGameOverForfeit() {
    gameEndReadySent = false;
    gameEndOppReady = false;
    forfeitOverlay.style.display = 'flex';

    const iWon  = myRoundsSolved > oppRoundsSolved;
    const tied  = myRoundsSolved === oppRoundsSolved;

    if (tied) {
      // Draw — no game-over forfeit
      forfeitContent.innerHTML = `
        <h2>Game Over!</h2>
        <div class="mm-forfeit-result">Draw — no game-over forfeit.</div>
        <button id="mm-ge-continue" class="mm-continue-btn">See Results</button>`;
      forfeitContent.querySelector('#mm-ge-continue').addEventListener('click', onGameEndContinue);
      return;
    }

    if (iWon) {
      // I won — deploy the base forfeit time (set at game setup) plus my banked time
      const baseSeconds = state.forfeitDuration || 0;
      const vibeSeconds = baseSeconds + myBanked;
      const bankedNote = myBanked > 0 ? ` (base ${baseSeconds}s + ${myBanked}s banked)` : ` (base ${baseSeconds}s)`;
      myBanked = 0;
      haptics.setWaveVibeMode(true);
      socket.send({ type: MSG.MM_GAME_END_VIBE, vibeSeconds });

      forfeitContent.innerHTML = `
        <h2>Game Over — You Win! 🏆</h2>
        <div class="mm-forfeit-result mm-solved">Deploying ${vibeSeconds}s against ${escapeHtml(oppName)}${bankedNote}</div>
        <div class="mm-claim-section">
          <div class="mm-claim-countdown"><span id="mm-opp-vibe-ctr">${vibeSeconds}</span><span class="mm-ctr-unit">s</span></div>
          <div class="mm-wave-pattern">Pattern: <span id="mm-wave-state">—</span></div>
          <div class="mm-vibe-bar-wrap" style="margin:8px 0"><div class="mm-vibe-bar" id="mm-opp-vibe-bar" style="width:100%"></div></div>
          <div class="forfeit-slider-row">
            <span>Strength</span>
            <input type="range" id="mm-intensity-slider" min="0" max="100" value="100" style="flex:1;margin:0 12px;">
            <span id="mm-intensity-pct">100%</span>
          </div>
          <div style="display:flex;justify-content:center;margin-top:10px;">
            <button id="mm-vibe-toggle">Stop</button>
          </div>
        </div>
        <button id="mm-ge-continue" class="mm-continue-btn">Continue to Results</button>`;

      forfeitContent.querySelector('#mm-ge-continue').addEventListener('click', onGameEndContinue);
      if (vibeSeconds > 0) setupForfeitVibeUI(0, vibeSeconds, true);
    } else {
      // I lost — wait for MM_GAME_END_VIBE from winner (handled in onMmGameEndVibe)
      forfeitContent.innerHTML = `
        <h2>Game Over — You Lost</h2>
        <div class="mm-waiting-text" style="margin:16px 0">Waiting for opponent's final forfeit…</div>`;
    }
  }

  function onGameEndContinue() {
    if (gameEndReadySent) return;
    gameEndReadySent = true;
    socket.send({ type: MSG.MM_GAME_END_READY });
    const btn = forfeitContent.querySelector('#mm-ge-continue');
    if (btn) { btn.disabled = true; btn.textContent = 'Waiting for opponent…'; }
    checkGameEndReady();
  }

  function checkGameEndReady() {
    if (!gameEndReadySent || !gameEndOppReady) return;
    clearInterval(forfeitInterval);
    forfeitInterval = null;
    if (window._mmRoundForfeitCleanup) { window._mmRoundForfeitCleanup(); window._mmRoundForfeitCleanup = null; }
    state.myVibeResidual = 0;
    socket.send({ type: MSG.FINAL, value: myRoundsSolved, vibeSeconds: 0 });
    state.myFinal = myRoundsSolved;
    navigate('#/results');
  }

  function onMmGameEndVibe(ev) {
    const vibeSeconds = ev.detail?.vibeSeconds | 0;
    forfeitOverlay.style.display = 'flex';

    if (vibeSeconds === 0) {
      forfeitContent.innerHTML = `
        <h2>Game Over — You Lost</h2>
        <div class="mm-no-vibe">Opponent had no banked time — you're safe!</div>
        <button id="mm-ge-continue" class="mm-continue-btn">See Results</button>`;
    } else {
      haptics.setWaveVibeMode(true);
      forfeitContent.innerHTML = `
        <h2>Game Over — You Lost</h2>
        <div class="mm-forfeit-result mm-failed">Opponent's ${vibeSeconds}s banked — your forfeit!</div>
        <div class="mm-claim-section">
          <div class="mm-claim-countdown"><span id="mm-my-vibe-ctr">${vibeSeconds}</span><span class="mm-ctr-unit">s</span></div>
          <div class="mm-wave-pattern">Pattern: <span id="mm-wave-state">—</span></div>
          <div class="mm-vibe-bar-wrap" style="margin:8px 0"><div class="mm-vibe-bar mm-vibe-bar-self" id="mm-my-vibe-bar" style="width:100%"></div></div>
          <div class="forfeit-slider-row">
            <span>Your intensity</span>
            <input type="range" id="mm-intensity-slider" min="0" max="100" value="100" style="flex:1;margin:0 12px;">
            <span id="mm-intensity-pct">100%</span>
          </div>
          <div style="display:flex;justify-content:center;margin-top:10px;">
            <button id="mm-vibe-toggle">Stop</button>
          </div>
        </div>
        <button id="mm-ge-continue" class="mm-continue-btn">Continue to Results</button>`;
      setupForfeitVibeUI(vibeSeconds, 0);
    }

    forfeitContent.querySelector('#mm-ge-continue').addEventListener('click', onGameEndContinue);
  }

  function onMmGameEndReady() {
    gameEndOppReady = true;
    checkGameEndReady();
  }

  // --- Input ---

  function onKeyDown(e) {
    if (edgePaused) return;
    if (phase !== 'playing' || currentTurn !== 'mine') return;
    const k = e.key.toUpperCase();
    if (COLORS.includes(k)) { e.preventDefault(); addColor(k); return; }
    if (e.key === 'Backspace') { removeColor(); return; }
    if (e.key === 'Enter') { submitGuess(); return; }
  }

  root.querySelector('#back-to-lobby').addEventListener('click', () => {
    state.myFinal = null; state.oppFinal = null; state.seed = null; state.startAt = null;
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
    if (!Array.isArray(guess) || guess.length !== code.length) return;

    const positions = evaluateGuessPositional(code, guess);
    guessHistory.push({ guess, feedback: positions, by: 'theirs' });
    oppCharges += chargesFromGuess(positions);

    if (!positions.every(p => p === 'place')) {
      const oppWrong = guessHistory.filter(g => g.by === 'theirs' && !g.feedback.every(p => p === 'place')).reduce((s, g) => s + g.feedback.filter(p => p !== 'place').length, 0);
      const intensity = Math.min(1, oppWrong / (roundConfig.guesses * roundConfig.slots));
      if (gameMode === 'easy') haptics.testVibe(intensity);
      else haptics.addVibeSeconds((roundIndex + 1) * 0.5);
    }

    renderBoard();
    renderVibeGauge();
    renderCurrentRow();

    if (positions.every(p => p === 'place')) {
      endRound('theirs');
    } else if (guessHistory.length >= roundConfig.guesses) {
      endRound(null);
    } else {
      advanceTurn();
    }
  }

  function onMmPowerup(ev) {
    const { powerup, slotIndex, color } = ev.detail || {};
    const pu = POWERUPS.find(p => p.id === powerup);
    if (!pu || oppCharges < pu.cost || currentTurn !== 'theirs' || phase !== 'playing') return;

    if (powerup === 'hint') {
      if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= code.length) return;
      if (hintedSlots.some(h => h.index === slotIndex)) return;
      oppCharges -= pu.cost;
      hintedSlots.push({ index: slotIndex, color });
      renderHints();
      renderCurrentRow();
      showTurnNotice(`Opponent used Hint — Slot ${slotIndex + 1} = ${color}`);
    } else if (powerup === 'zap') {
      oppCharges -= pu.cost;
      haptics.testVibe(0.9);
      showTurnNotice('⚡ Zapped by opponent!');
    } else if (powerup === 'skip') {
      oppCharges -= pu.cost;
      myNextTurnSkipped = true;
      showTurnNotice("Opponent used Skip — your next turn is skipped!");
    } else if (powerup === 'add_guess') {
      oppCharges -= pu.cost;
      roundConfig = { ...roundConfig, guesses: roundConfig.guesses + 1 };
      renderBoard();
      showTurnNotice('Opponent added a guess to the board!');
    } else if (powerup === 'remove_guess') {
      if (roundConfig.guesses - guessHistory.length <= 1) return;
      oppCharges -= pu.cost;
      roundConfig = { ...roundConfig, guesses: roundConfig.guesses - 1 };
      renderBoard();
      showTurnNotice('Opponent removed a guess from the board!');
    }
    renderHeader();
  }

  function onMmVibeChoice(ev) {
    const { choice, vibeSeconds } = ev.detail || {};
    // We're the loser — now show what opponent decided
    const earned = calcMyVibeEarned();
    const codeHtml = code.map(c =>
      `<div class="mm-slot" style="background:${COLOR_STYLE[c].bg};color:${COLOR_STYLE[c].text}">${c}</div>`
    ).join('');

    if (choice === 'use') {
      const myVibe = vibeSeconds || earned;
      haptics.setWaveVibeMode(true);
      forfeitContent.innerHTML = `
        <h2>Round ${roundIndex + 1} Over</h2>
        <div class="mm-code-reveal">
          <div class="mm-code-label">The code was:</div>
          <div class="mm-code-slots">${codeHtml}</div>
        </div>
        <div class="mm-forfeit-result mm-failed">✗ You didn't crack it</div>
        <div class="mm-claim-section">
          <div class="mm-claim-countdown"><span id="mm-my-vibe-ctr">${myVibe}</span><span class="mm-ctr-unit">s</span></div>
          <div class="mm-wave-pattern">Pattern: <span id="mm-wave-state">—</span></div>
          <div class="mm-vibe-bar-wrap" style="margin:8px 0"><div class="mm-vibe-bar mm-vibe-bar-self" id="mm-my-vibe-bar" style="width:100%"></div></div>
          <div class="forfeit-slider-row">
            <span>Your intensity</span>
            <input type="range" id="mm-intensity-slider" min="0" max="100" value="100" style="flex:1;margin:0 12px;">
            <span id="mm-intensity-pct">100%</span>
          </div>
          <div style="display:flex;justify-content:center;margin-top:10px;">
            <button id="mm-vibe-toggle" style="min-width:100px;">Stop</button>
          </div>
        </div>
        <button id="mm-continue" class="mm-continue-btn">Continue</button>`;

      setupForfeitVibeUI(myVibe, 0);
    } else {
      const safeMsg = choice === 'waive'
        ? 'Opponent waived the forfeit — no vibe this round.'
        : 'Opponent banked their vibe — you\'re safe this round. 😅';
      forfeitContent.innerHTML = `
        <h2>Round ${roundIndex + 1} Over</h2>
        <div class="mm-code-reveal">
          <div class="mm-code-label">The code was:</div>
          <div class="mm-code-slots">${codeHtml}</div>
        </div>
        <div class="mm-forfeit-result mm-failed">✗ You didn't crack it</div>
        <div class="mm-no-vibe">${safeMsg}</div>
        <button id="mm-continue" class="mm-continue-btn">Continue</button>`;
    }

    forfeitContent.querySelector('#mm-continue').addEventListener('click', onContinueClick);
  }

  function onMmRoundReady() {
    oppRoundReadyReceived = true;
    // In both-failed, we can proceed immediately when both ready
    // In won/lost, we wait for vibe choice first (handled above)
    checkBothReady();
  }

  function onPeerLeft() {
    clearInterval(forfeitInterval);
    root.innerHTML = `
      <div class="card">
        <h2>Opponent left</h2>
        <div class="actions"><button id="mm-peer-home">Home</button></div>
      </div>`;
    root.querySelector('#mm-peer-home').addEventListener('click', () => { location.hash = '#/'; });
  }

  socket.addEventListener(MSG.MM_GUESS, onMmGuess);
  socket.addEventListener(MSG.MM_POWERUP, onMmPowerup);
  socket.addEventListener(MSG.MM_VIBE_CHOICE, onMmVibeChoice);
  socket.addEventListener(MSG.MM_ROUND_READY, onMmRoundReady);
  socket.addEventListener(MSG.MM_GAME_END_VIBE, onMmGameEndVibe);
  socket.addEventListener(MSG.MM_GAME_END_READY, onMmGameEndReady);
  socket.addEventListener(MSG.PEER_LEFT, onPeerLeft);

  const cleanup = () => {
    clearInterval(forfeitInterval);
    if (window._mmRoundForfeitCleanup) { window._mmRoundForfeitCleanup(); window._mmRoundForfeitCleanup = null; }
    document.removeEventListener('keydown', onKeyDown);
    socket.removeEventListener(MSG.MM_GUESS, onMmGuess);
    socket.removeEventListener(MSG.MM_POWERUP, onMmPowerup);
    socket.removeEventListener(MSG.MM_VIBE_CHOICE, onMmVibeChoice);
    socket.removeEventListener(MSG.MM_ROUND_READY, onMmRoundReady);
    socket.removeEventListener(MSG.MM_GAME_END_VIBE, onMmGameEndVibe);
    socket.removeEventListener(MSG.MM_GAME_END_READY, onMmGameEndReady);
    socket.removeEventListener(MSG.PEER_LEFT, onPeerLeft);
    if (edgeModeInstance) { edgeModeInstance.destroy(); edgeModeInstance = null; }
    if (vibeBatteryInstance) { vibeBatteryInstance.destroy(); vibeBatteryInstance = null; }
    if (vibeModeBarInstance) { vibeModeBarInstance.destroy(); vibeModeBarInstance = null; }
    haptics.stopAll();
  };
  window.addEventListener('hashchange', cleanup, { once: true });

  function _initEdgeModeInstance(assignment) {
    edgeModeInstance = initEdgeMode({
      role: state.role,
      myLives: state.edgeLives,
      assignment,
      containerEl: root,
      onPause: () => { edgePaused = true; savedHaptics = haptics.pauseHaptics(); },
      onResume: () => { edgePaused = false; haptics.resumeHaptics(savedHaptics); },
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
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function _showMastermindInstructions(state, onReady) {
  const mode = state.gameMode || 'easy';
  const rounds = state.gameRounds || 3;
  const overlay = document.createElement('div');
  overlay.className = 'instructions-overlay';
  overlay.innerHTML = `
    <div class="instructions-box">
      <h2>Mastermind</h2>
      <p class="instructions-meta">Mode: <strong>${mode === 'hard' ? 'Hard' : 'Easy'}</strong> &nbsp;·&nbsp; Rounds: <strong>${rounds}</strong></p>
      <div class="instructions-section">
        <div class="instructions-heading">Shared board, take turns</div>
        <ul class="instructions-list">
          <li>One board — you and your opponent alternate guesses.</li>
          <li>Crack the code on your turn to win the round.</li>
          <li>Board size and guesses increase each round.</li>
        </ul>
      </div>
      <div class="instructions-section">
        <div class="instructions-heading">Feedback</div>
        <ul class="instructions-list">
          <li><strong>Green dot</strong> = right color, right position.</li>
          <li><strong>Yellow dot</strong> = right color, wrong position.</li>
          ${mode === 'hard' ? '' : '<li><strong>Dashed dot</strong> = color is in the code but all copies are already matched.</li>'}
          ${mode === 'hard' ? '<li>Hard: dots unordered — no positions revealed.</li>' : '<li><strong>Dark dot</strong> = color is not in the code at all.</li>'}
          <li>Wrong guesses vibrate you — worse in later rounds.</li>
        </ul>
      </div>
      <div class="instructions-section">
        <div class="instructions-heading">Powerups (earn ⚡ from correct positions)</div>
        <ul class="instructions-list">
          <li><strong>Hint (⚡3)</strong> — Reveal a code slot (both see it).</li>
          <li><strong>Zap (⚡2)</strong> — Buzz your opponent immediately.</li>
          <li><strong>Skip (⚡4)</strong> — Skip opponent's next turn.</li>
        </ul>
      </div>
      <div class="instructions-section">
        <div class="instructions-heading">Vibe stakes</div>
        <ul class="instructions-list">
          <li>Win a round → earn vibe seconds against opponent.</li>
          <li><strong>Use Now</strong> or <strong>Bank</strong> it for a bigger hit later.</li>
          <li>Both fail to crack it → both get a vibe penalty.</li>
        </ul>
      </div>
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
