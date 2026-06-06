import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';
import { initVibeBattery } from '../vibeBattery.js';
import { makeRng } from '../game/seededRng.js';
import {
  getBaseConfig, nextRoundConfig, generateCode, evaluateGuessPositional,
  COLORS, POWERUPS, chargesFromGuess,
} from '../game/MastermindGame.js';

const COLOR_STYLE = {
  R: { bg: '#e84040', text: '#fff' },
  G: { bg: '#38c060', text: '#fff' },
  B: { bg: '#3878e8', text: '#fff' },
  W: { bg: '#e8e8e8', text: '#222' },
};

// 3-player Mastermind: shared board, players take turns in a fixed rotation
// (host → guest → guest2). First to crack the code wins the round and is safe;
// the other two each suffer a local forfeit vibe. Most round wins takes the game.
export function renderMastermind3(root) {
  const totalRounds = state.gameRounds;
  const gameMode = state.gameMode;
  const rng = makeRng(state.seed);

  const ROLES = ['host', 'guest', 'guest2'];
  const myRole = state.role;
  const roundForfeitSeconds = state.forfeitDuration || 30;

  function nameForRole(r) {
    const n = r === 'host' ? state.hostName : r === 'guest' ? state.guestName : state.guest2Name;
    return n || (r === 'host' ? 'Host' : r === 'guest' ? 'Guest' : 'Guest 2');
  }
  function nextRoleAfter(r) {
    return ROLES[(ROLES.indexOf(r) + 1) % ROLES.length];
  }

  let roundIndex = 0;
  let roundConfig = getBaseConfig(gameMode);
  let code = generateCode(rng, roundConfig.slots);

  // Shared board state
  let guessHistory = [];   // { guess, feedback, role }[]
  let currentGuess = [];
  let currentRole = 'host';
  let phase = 'countdown'; // countdown | playing | roundend | gameover

  // Per-player tallies
  const roundWins = { host: 0, guest: 0, guest2: 0 };

  // Powerup / turn state
  let myCharges = 0;
  let hintedSlots = [];        // { index, color }[] (shared)
  const skipNext = new Set();  // roles whose next turn is skipped

  // Round / game-end readiness (sets of roles that pressed Continue)
  const roundReadyRoles = new Set();
  const gameEndReadyRoles = new Set();
  let roundReadySent = false;
  let gameEndReadySent = false;

  let forfeitInterval = null;
  let vibeBatteryInstance = initVibeBattery(root);

  // Mode + feedback-dot legend.
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
      _legendItem('mm-dot-empty', 'not in the code');
  const modeBarHtml = `
    <div id="mm-mode-bar" style="margin:6px 0 10px;padding:8px 12px;background:#141d33;border:1px solid #25304d;border-radius:8px;font-size:12px;color:var(--muted);">
      <div style="color:var(--ink);font-size:13px;margin-bottom:6px;">Mode: <strong>${_modeName}</strong> <span style="color:var(--muted);font-weight:400;">${_modeSub}</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;">${_legend}</div>
    </div>`;

  const scoreboardHtml = ROLES.map(r =>
    `<span class="mm3-score" id="mm3-score-${r}">${escapeHtml(nameForRole(r))}: 0</span>`
  ).join('<span class="dice-losses-sep">|</span>');

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
      <div class="mm3-scoreboard" id="mm3-scoreboard">${scoreboardHtml}</div>
      <div id="mm-turn-indicator" class="mm-turn-indicator"></div>
      ${modeBarHtml}
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

  const isMyTurn = () => currentRole === myRole && phase === 'playing';

  // --- Render helpers ---

  function renderHeader() {
    roundLabel.textContent = `Round ${roundIndex + 1} of ${totalRounds}`;
    chargesEl.textContent = `⚡ ${myCharges}`;
    ROLES.forEach(r => {
      const el = root.querySelector(`#mm3-score-${r}`);
      if (el) el.textContent = `${nameForRole(r)}: ${roundWins[r]}`;
    });
  }

  function renderTurnIndicator() {
    if (phase !== 'playing') { turnIndicator.textContent = ''; return; }
    if (currentRole === myRole) {
      turnIndicator.textContent = 'YOUR TURN';
      turnIndicator.className = 'mm-turn-indicator mm-turn-mine';
    } else {
      turnIndicator.textContent = `${escapeHtml(nameForRole(currentRole))}'s turn…`;
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
      : [...positions].sort((a, b) => ({ place: 0, color: 1, empty: 2 }[a] - { place: 0, color: 1, empty: 2 }[b]));
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
      const hint = hintedSlots.find(h => h.index === i);
      if (hint && !currentGuess[i]) {
        slot.style.borderColor = COLOR_STYLE[hint.color].bg;
        slot.style.borderWidth = '3px';
        slot.style.borderStyle = 'dashed';
      }
      currentRow.appendChild(slot);
    }
    submitBtn.disabled = !isMyTurn() || currentGuess.length < roundConfig.slots;
    const palette = root.querySelector('.mm-color-palette');
    if (palette) {
      palette.style.opacity = isMyTurn() ? '1' : '0.4';
      palette.style.pointerEvents = isMyTurn() ? '' : 'none';
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
    for (const { guess, feedback, role } of guessHistory) {
      const by = role === myRole ? 'mine' : 'theirs';
      const row = document.createElement('div');
      row.className = `mm-guess-row mm-history-row mm-by-${by}`;
      const nameTag = document.createElement('div');
      nameTag.className = 'mm-row-name';
      nameTag.textContent = role === myRole ? (state.myName || 'You') : nameForRole(role);
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
      const canUse = myCharges >= pu.cost && isMyTurn();
      btn.className = 'mm-powerup-btn ghost' + (canUse ? '' : ' mm-powerup-disabled');
      btn.disabled = !canUse;
      btn.title = pu.id === 'skip' ? "Skip the next player's turn" : pu.desc;
      btn.innerHTML = `<span class="pu-label">${pu.label}</span><span class="pu-cost">⚡${pu.cost}</span>`;
      btn.addEventListener('click', () => usePowerup(pu.id));
      powerupBar.appendChild(btn);
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

  function startRound() {
    phase = 'playing';
    guessHistory = [];
    currentGuess = [];
    hintedSlots = [];
    skipNext.clear();
    roundReadyRoles.clear();
    roundReadySent = false;

    // Rotate the starting player each round, seeded so all clients agree.
    currentRole = ROLES[((state.seed % ROLES.length) + roundIndex) % ROLES.length];

    forfeitOverlay.style.display = 'none';
    inputArea.style.opacity = '1';
    inputArea.style.pointerEvents = '';

    renderHeader();
    renderBoard();
    renderCurrentRow();
    renderTurnIndicator();
    renderHints();
    renderPowerups();
  }

  function addColor(c) {
    if (!isMyTurn()) return;
    if (currentGuess.length >= roundConfig.slots) return;
    currentGuess.push(c);
    renderCurrentRow();
  }

  function removeColor() {
    if (!isMyTurn()) return;
    if (currentGuess.length === 0) return;
    currentGuess.pop();
    renderCurrentRow();
  }

  function applyGuess(role, guess) {
    const positions = evaluateGuessPositional(code, guess);
    guessHistory.push({ guess, feedback: positions, role });

    if (role === myRole) {
      myCharges += chargesFromGuess(positions);
      if (!positions.every(p => p === 'place')) {
        const myWrong = guessHistory
          .filter(g => g.role === myRole && !g.feedback.every(p => p === 'place'))
          .reduce((s, g) => s + g.feedback.filter(p => p !== 'place').length, 0);
        haptics.testVibe(Math.min(1, myWrong / (roundConfig.guesses * roundConfig.slots)));
      }
    }

    renderBoard();
    renderCurrentRow();
    renderHeader();

    const cracked = positions.every(p => p === 'place');
    if (cracked) {
      endRound(role);
    } else if (guessHistory.length >= roundConfig.guesses) {
      endRound(null);
    } else {
      advanceTurn();
    }
  }

  function submitGuess() {
    if (!isMyTurn() || currentGuess.length < roundConfig.slots) return;
    const guess = [...currentGuess];
    currentGuess = [];
    socket.send({ type: MSG.MM_GUESS, guess });
    applyGuess(myRole, guess);
  }

  function advanceTurn() {
    let next = nextRoleAfter(currentRole);
    let guard = 0;
    while (skipNext.has(next) && guard < ROLES.length) {
      skipNext.delete(next);
      showTurnNotice(`${nameForRole(next)}'s turn was skipped!`);
      next = nextRoleAfter(next);
      guard++;
    }
    currentRole = next;
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
    if (!pu || myCharges < pu.cost || !isMyTurn()) return;

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
      showTurnNotice('Zap sent to the other players!');
    } else if (type === 'skip') {
      const target = nextRoleAfter(myRole);
      skipNext.add(target);
      socket.send({ type: MSG.MM_POWERUP, powerup: 'skip' });
      showTurnNotice(`${nameForRole(target)}'s next turn will be skipped!`);
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

  // --- Phase: round end (winner safe, losers suffer) ---

  function endRound(winnerRole) {
    if (phase !== 'playing') return;
    phase = 'roundend';
    inputArea.style.opacity = '0.4';
    inputArea.style.pointerEvents = 'none';
    submitBtn.disabled = true;
    turnIndicator.textContent = '';

    if (winnerRole) roundWins[winnerRole]++;
    renderHeader();

    const iWon = winnerRole === myRole;
    const iSuffer = !iWon; // winner is safe; everyone else (incl. all-fail) suffers
    const secs = iSuffer ? roundForfeitSeconds : 0;

    showForfeitOverlay({
      heading: winnerRole
        ? (iWon ? 'You cracked it! 🎉' : `${nameForRole(winnerRole)} cracked it`)
        : 'Nobody cracked it!',
      resultText: winnerRole
        ? (iWon ? '✓ You win the round — safe!' : `✗ ${nameForRole(winnerRole)} won the round`)
        : '✗ Everyone fails this round',
      resultClass: iWon ? 'mm-solved' : 'mm-failed',
      mySeconds: secs,
      onReady: onRoundContinue,
    });
  }

  function onRoundContinue() {
    if (roundReadySent) return;
    roundReadySent = true;
    roundReadyRoles.add(myRole);
    socket.send({ type: MSG.MM_ROUND_READY });
    const btn = forfeitContent.querySelector('#mm-continue');
    if (btn) { btn.disabled = true; btn.textContent = 'Waiting for other players…'; }
    checkRoundReady();
  }

  function checkRoundReady() {
    if (roundReadyRoles.size < ROLES.length) return;
    clearInterval(forfeitInterval);
    forfeitInterval = null;
    haptics.stopAll();

    roundIndex++;
    if (roundIndex >= totalRounds) {
      enterGameOver();
    } else {
      roundConfig = nextRoundConfig(roundConfig, gameMode);
      code = generateCode(rng, roundConfig.slots);
      startRound();
    }
  }

  // --- Phase: game over ---

  function enterGameOver() {
    phase = 'gameover';
    gameEndReadySent = false;
    gameEndReadyRoles.clear();

    const maxWins = Math.max(...ROLES.map(r => roundWins[r]));
    const winners = ROLES.filter(r => roundWins[r] === maxWins);
    const isDraw = winners.length === ROLES.length; // everyone tied
    const iAmWinner = winners.includes(myRole);
    const iSuffer = !isDraw && !iAmWinner;
    const secs = iSuffer ? roundForfeitSeconds : 0;

    const standings = ROLES
      .map(r => ({ r, w: roundWins[r] }))
      .sort((a, b) => b.w - a.w)
      .map((e, i) => `<div class="mm3-standing">${['🥇', '🥈', '🥉'][i] || ''} ${escapeHtml(nameForRole(e.r))} — ${e.w} win${e.w === 1 ? '' : 's'}</div>`)
      .join('');

    let heading, resultText, resultClass;
    if (isDraw) {
      heading = 'Game Over — Draw!';
      resultText = 'Everyone tied — no final forfeit.';
      resultClass = '';
    } else if (iAmWinner) {
      heading = 'Game Over — You Win! 🏆';
      resultText = '✓ Most rounds won — safe!';
      resultClass = 'mm-solved';
    } else {
      heading = 'Game Over';
      resultText = `✗ ${winners.map(nameForRole).join(' & ')} won the game`;
      resultClass = 'mm-failed';
    }

    showForfeitOverlay({
      heading,
      resultText,
      resultClass,
      extraHtml: `<div class="mm3-standings">${standings}</div>`,
      mySeconds: secs,
      continueLabel: 'Back to Lobby',
      onReady: onGameEndContinue,
    });
  }

  function onGameEndContinue() {
    if (gameEndReadySent) return;
    gameEndReadySent = true;
    gameEndReadyRoles.add(myRole);
    socket.send({ type: MSG.MM_GAME_END_READY });
    const btn = forfeitContent.querySelector('#mm-continue');
    if (btn) { btn.disabled = true; btn.textContent = 'Waiting for other players…'; }
    checkGameEndReady();
  }

  function checkGameEndReady() {
    if (gameEndReadyRoles.size < ROLES.length) return;
    clearInterval(forfeitInterval);
    forfeitInterval = null;
    haptics.stopAll();
    // The winner-safe / losers-suffer forfeit already ran in-game (above), so we
    // return straight to the session lobby — same as 3-player Hi-Lo — rather than
    // the 2-player results screen (which would compute a spurious second forfeit).
    state.myFinal = null;
    state.oppFinal = null;
    state.seed = null;
    state.startAt = null;
    navigate(`#/session/${state.sessionId}`);
  }

  // --- Shared forfeit overlay (loser runs a local forfeit vibe + countdown) ---

  function showForfeitOverlay({ heading, resultText, resultClass, extraHtml = '', mySeconds, continueLabel = 'Continue', onReady }) {
    const codeHtml = code.map(c =>
      `<div class="mm-slot" style="background:${COLOR_STYLE[c].bg};color:${COLOR_STYLE[c].text}">${c}</div>`
    ).join('');

    const vibeSection = mySeconds > 0 ? `
      <div class="mm-claim-section">
        <div class="mm-claim-countdown"><span id="mm-my-vibe-ctr">${mySeconds}</span><span class="mm-ctr-unit">s</span></div>
        <div class="mm-vibe-bar-wrap" style="margin:8px 0"><div class="mm-vibe-bar mm-vibe-bar-self" id="mm-my-vibe-bar" style="width:100%"></div></div>
        <div class="forfeit-slider-row">
          <span>Your intensity</span>
          <input type="range" id="mm-intensity-slider" min="0" max="100" value="100" style="flex:1;margin:0 12px;">
          <span id="mm-intensity-pct">100%</span>
        </div>
      </div>` : `<div class="mm-no-vibe">No forfeit for you this round. 😎</div>`;

    forfeitContent.innerHTML = `
      <h2>${heading}</h2>
      <div class="mm-code-reveal">
        <div class="mm-code-label">The code was:</div>
        <div class="mm-code-slots">${codeHtml}</div>
      </div>
      <div class="mm-forfeit-result ${resultClass}">${resultText}</div>
      ${extraHtml}
      ${vibeSection}
      <button id="mm-continue" class="mm-continue-btn" ${mySeconds > 0 ? 'disabled' : ''}>${mySeconds > 0 ? `Forfeit running… ${mySeconds}s` : continueLabel}</button>`;

    forfeitOverlay.style.display = 'flex';

    const continueBtn = forfeitContent.querySelector('#mm-continue');
    continueBtn.addEventListener('click', () => { if (!continueBtn.disabled) onReady(); });

    if (mySeconds > 0) {
      haptics.startForfeitVibe(mySeconds);
      let remaining = mySeconds;
      const ctr = forfeitContent.querySelector('#mm-my-vibe-ctr');
      const bar = forfeitContent.querySelector('#mm-my-vibe-bar');
      forfeitInterval = setInterval(() => {
        remaining--;
        if (ctr) ctr.textContent = Math.max(0, remaining);
        if (bar) bar.style.width = `${(Math.max(0, remaining) / mySeconds) * 100}%`;
        if (remaining <= 0) {
          clearInterval(forfeitInterval);
          forfeitInterval = null;
          haptics.stopAll();
          continueBtn.disabled = false;
          continueBtn.textContent = continueLabel;
        } else {
          continueBtn.textContent = `Forfeit running… ${remaining}s`;
        }
      }, 1000);

      const slider = forfeitContent.querySelector('#mm-intensity-slider');
      const pctEl = forfeitContent.querySelector('#mm-intensity-pct');
      if (slider) {
        slider.addEventListener('input', () => {
          if (pctEl) pctEl.textContent = `${slider.value}%`;
          haptics.setForfeitIntensity(slider.value / 100);
        });
      }
    }
  }

  // --- Input ---

  function onKeyDown(e) {
    if (!isMyTurn()) return;
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
    const role = ev.detail?.role;
    if (!Array.isArray(guess) || !role || role === myRole) return;
    applyGuess(role, guess);
  }

  function onMmPowerup(ev) {
    const { powerup, slotIndex, color, role } = ev.detail || {};
    if (!role || role === myRole) return;
    if (powerup === 'hint') {
      hintedSlots.push({ index: slotIndex, color });
      renderHints();
      renderCurrentRow();
      showTurnNotice(`${nameForRole(role)} used Hint — Slot ${slotIndex + 1} = ${color}`);
    } else if (powerup === 'zap') {
      haptics.testVibe(0.9);
      showTurnNotice(`⚡ Zapped by ${nameForRole(role)}!`);
    } else if (powerup === 'skip') {
      const target = nextRoleAfter(role);
      skipNext.add(target);
      showTurnNotice(`${nameForRole(role)} used Skip on ${target === myRole ? 'you' : nameForRole(target)}!`);
    } else if (powerup === 'add_guess') {
      roundConfig = { ...roundConfig, guesses: roundConfig.guesses + 1 };
      renderBoard();
      showTurnNotice(`${nameForRole(role)} added a guess to the board!`);
    } else if (powerup === 'remove_guess') {
      roundConfig = { ...roundConfig, guesses: roundConfig.guesses - 1 };
      renderBoard();
      showTurnNotice(`${nameForRole(role)} removed a guess from the board!`);
    }
  }

  function onMmRoundReady(ev) {
    if (ev.detail?.role) roundReadyRoles.add(ev.detail.role);
    checkRoundReady();
  }

  function onMmGameEndReady(ev) {
    if (ev.detail?.role) gameEndReadyRoles.add(ev.detail.role);
    checkGameEndReady();
  }

  function onPeerLeft() {
    clearInterval(forfeitInterval);
    haptics.stopAll();
    root.innerHTML = `
      <div class="card">
        <h2>A player left</h2>
        <div class="actions"><button id="mm-peer-home">Home</button></div>
      </div>`;
    root.querySelector('#mm-peer-home').addEventListener('click', () => { location.hash = '#/'; });
  }

  socket.addEventListener(MSG.MM_GUESS, onMmGuess);
  socket.addEventListener(MSG.MM_POWERUP, onMmPowerup);
  socket.addEventListener(MSG.MM_ROUND_READY, onMmRoundReady);
  socket.addEventListener(MSG.MM_GAME_END_READY, onMmGameEndReady);
  socket.addEventListener(MSG.PEER_LEFT, onPeerLeft);

  const cleanup = () => {
    clearInterval(forfeitInterval);
    document.removeEventListener('keydown', onKeyDown);
    socket.removeEventListener(MSG.MM_GUESS, onMmGuess);
    socket.removeEventListener(MSG.MM_POWERUP, onMmPowerup);
    socket.removeEventListener(MSG.MM_ROUND_READY, onMmRoundReady);
    socket.removeEventListener(MSG.MM_GAME_END_READY, onMmGameEndReady);
    socket.removeEventListener(MSG.PEER_LEFT, onPeerLeft);
    if (vibeBatteryInstance) { vibeBatteryInstance.destroy(); vibeBatteryInstance = null; }
    haptics.stopAll();
  };
  window.addEventListener('hashchange', cleanup, { once: true });

  _showInstructions(startCountdown);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function _showInstructions(onReady) {
  const mode = state.gameMode || 'easy';
  const rounds = state.gameRounds || 3;
  const overlay = document.createElement('div');
  overlay.className = 'instructions-overlay';
  overlay.innerHTML = `
    <div class="instructions-box">
      <h2>Mastermind — 3 Players</h2>
      <p class="instructions-meta">Mode: <strong>${mode === 'hard' ? 'Hard' : 'Easy'}</strong> &nbsp;·&nbsp; Rounds: <strong>${rounds}</strong></p>
      <div class="instructions-section">
        <div class="instructions-heading">Shared board, take turns</div>
        <ul class="instructions-list">
          <li>One board — all three players guess in rotation.</li>
          <li>Crack the code on your turn to <strong>win the round and stay safe</strong>.</li>
          <li>The other two players each take a forfeit vibe.</li>
          <li>If nobody cracks it, everyone suffers.</li>
        </ul>
      </div>
      <div class="instructions-section">
        <div class="instructions-heading">Feedback</div>
        <ul class="instructions-list">
          <li><strong>Green dot</strong> = right colour, right position.</li>
          <li><strong>Yellow dot</strong> = right colour, wrong position.</li>
          ${mode === 'hard' ? '<li>Hard: dots unordered — no positions revealed.</li>' : ''}
        </ul>
      </div>
      <div class="instructions-section">
        <div class="instructions-heading">Powerups (earn ⚡ from correct positions)</div>
        <ul class="instructions-list">
          <li><strong>Hint (⚡3)</strong> — Reveal a code slot (everyone sees it).</li>
          <li><strong>Zap (⚡2)</strong> — Buzz the other two players.</li>
          <li><strong>Skip (⚡4)</strong> — Skip the next player's turn.</li>
        </ul>
      </div>
      <div class="instructions-section">
        <div class="instructions-heading">Winning</div>
        <ul class="instructions-list">
          <li>Most rounds won takes the game — and stays safe.</li>
          <li>The other two share the final forfeit.</li>
        </ul>
      </div>
      <button id="inst-ready">Got it — I'm ready!</button>
      <p class="instructions-waiting" id="inst-wait" style="visibility:hidden">Waiting for other players…</p>
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
