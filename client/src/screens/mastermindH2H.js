import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';
import { renderEdgeGate } from '../game/mastermindEdgeGate.js';
import { initVibeBattery } from '../vibeBattery.js';
import { initVibeModeBar, TEMPO_OPTIONS } from '../vibeModeBar.js';
import { VIBE_MODES, vibeModeLabel } from '../vibeModes.js';
import { makeRng } from '../game/seededRng.js';
import {
  getBaseConfig, nextRoundConfig, generateCode, evaluateGuessPositional,
  COLORS, calcVibeEarned,
} from '../game/MastermindGame.js';

const COLOR_STYLE = {
  R: { bg: '#e84040', text: '#fff' },
  G: { bg: '#38c060', text: '#fff' },
  B: { bg: '#3878e8', text: '#fff' },
  W: { bg: '#e8e8e8', text: '#222' },
};

// Head-to-head Mastermind: both players race the SAME secret code independently and
// simultaneously (no turns, no shared board). Each has their own guess budget; both
// guess histories are fully visible live. The server is the single authority on who
// solved first (see the mm_h2h_guess/mm_h2h_result handlers in server/index.js) so both
// clients always agree on the round outcome even if solves land within milliseconds of
// each other.
export function renderMastermindH2H(root) {
  const totalRounds = state.gameRounds;
  const gameMode = state.gameMode;
  const rng = makeRng(state.seed);

  let roundIndex = 0;
  let roundConfig = getBaseConfig(gameMode);
  let code = generateCode(rng, roundConfig.slots);

  // "Continue Until Solved" (lobby option) removes the per-round guess cap entirely —
  // both players just keep guessing until they crack it, no exhaustion/both-fail.
  const guessCap = () => state.mmContinueUntilSolved ? Infinity : roundConfig.guesses;

  // Two independent lanes
  let myHistory = [];      // { guess, feedback }[]
  let oppHistory = [];     // { guess, feedback }[]
  let currentGuess = [];
  let myMaxGuesses = guessCap();
  let oppMaxGuesses = guessCap();

  let roundWinner = null;  // 'mine' | 'theirs' | null
  let roundReadySent = false;
  let oppRoundReadyReceived = false;
  let phase = 'countdown'; // countdown | playing | won | lost | both-failed | done

  // Each player keeps guessing independently until THEY personally crack it or run out
  // of guesses — the round doesn't end just because the other side already solved it.
  // resultKnown/finalWinner come from the server's mm_h2h_result (see server/index.js),
  // the single authority on who actually gets credited as the round winner.
  let myCracked = false;
  let oppCracked = false;
  let resultKnown = false;
  let finalWinner = null;   // 'mine' | 'theirs', valid once resultKnown

  let myBanked = 0;

  let forfeitInterval = null;
  let myRoundsSolved = 0;
  let oppRoundsSolved = 0;
  let gameEndReadySent = false;
  let gameEndOppReady = false;
  let vibeBatteryInstance = initVibeBattery(root);
  let vibeModeBarInstance = null;

  const myName = state.myName || 'You';
  const oppName = (state.role === 'host' ? state.guestName : state.hostName) || 'Opponent';
  const oppRole = state.role === 'host' ? 'guest' : 'host';

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
      <div style="color:var(--ink);font-size:13px;margin-bottom:6px;">Mode: <strong>${_modeName}</strong> <span style="color:var(--muted);font-weight:400;">${_modeSub}</span> — <strong>Head-to-Head</strong></div>
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
        <div id="mm-banked-header" class="mm-charges" style="display:none">🏦 0s</div>
        <button id="mm-vibe-btn" class="mm-vibe-btn ghost">${haptics.isConnected() ? '📳 Connected' : 'Connect Vibe'}</button>
      </div>
      ${modeBarHtml}
      <div id="mm-opp-progress" style="margin-bottom:12px;padding:8px 12px;background:#141d33;border:1px solid #25304d;border-radius:8px;"></div>
      <div style="margin-bottom:10px;">
        <div style="font-weight:700;margin-bottom:4px;">${escapeHtml(myName)} (you)</div>
        <div style="overflow-x:auto;">
          <div id="mm-board-mine" class="mm-board"></div>
        </div>
      </div>
      <div class="mm-input-area" id="mm-input-area">
        <div id="mm-current-row" class="mm-current-row"></div>
        <div class="mm-color-palette">
          ${COLORS.map(c => `<button class="mm-color-btn" data-color="${c}"
            style="background:${COLOR_STYLE[c].bg};color:${COLOR_STYLE[c].text}">${c}</button>`).join('')}
          <button class="mm-back-btn ghost" id="mm-back">⌫</button>
        </div>
        <button id="mm-submit" disabled>Submit Guess</button>
      </div>
      <div id="mm-play-status" class="mm-waiting-text" style="text-align:center;margin:8px 0;font-size:13px;"></div>
    </div>`;

  // Mount inside #mm-root (not root/#app, which is a flex ROW centering the card —
  // prepending there would sit the bar beside the card instead of above it).
  vibeModeBarInstance = initVibeModeBar(root.querySelector('#mm-root'));

  const countdownOverlay = root.querySelector('#mm-countdown-overlay');
  const forfeitOverlay = root.querySelector('#mm-forfeit-overlay');
  const forfeitContent = root.querySelector('#mm-forfeit-content');
  const roundLabel = root.querySelector('#mm-round-label');
  const boardMine = root.querySelector('#mm-board-mine');
  const oppProgress = root.querySelector('#mm-opp-progress');
  const currentRow = root.querySelector('#mm-current-row');
  const inputArea = root.querySelector('#mm-input-area');
  const submitBtn = root.querySelector('#mm-submit');

  // --- Render helpers ---

  function renderHeader() {
    roundLabel.textContent = `Round ${roundIndex + 1} of ${totalRounds}`;
    const bankedEl = root.querySelector('#mm-banked-header');
    if (bankedEl) {
      bankedEl.style.display = myBanked > 0 ? '' : 'none';
      bankedEl.textContent = `🏦 ${myBanked}s`;
    }
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
      currentRow.appendChild(makeSlot(currentGuess[i] || null));
    }
    const canPlay = phase === 'playing' && !myCracked && myHistory.length < myMaxGuesses;
    submitBtn.disabled = !canPlay || currentGuess.length < roundConfig.slots;
    const palette = root.querySelector('.mm-color-palette');
    if (palette) {
      palette.style.opacity = canPlay ? '1' : '0.4';
      palette.style.pointerEvents = canPlay ? '' : 'none';
    }

    const statusEl = root.querySelector('#mm-play-status');
    if (statusEl) {
      if (phase !== 'playing') statusEl.textContent = '';
      else if (myCracked) statusEl.textContent = "You cracked it! Waiting for opponent to finish…";
      else if (myHistory.length >= myMaxGuesses) statusEl.textContent = 'Out of guesses — waiting for opponent to finish…';
      else statusEl.textContent = '';
    }
  }

  function renderLane(boardEl, history, maxGuesses) {
    boardEl.innerHTML = '';
    // Unlimited (Continue Until Solved): don't pre-pad with placeholder rows — just
    // show guesses made so far, growing as you go.
    const remaining = Number.isFinite(maxGuesses) ? Math.max(0, maxGuesses - history.length) : 0;
    for (let i = 0; i < remaining; i++) {
      const row = document.createElement('div');
      row.className = 'mm-guess-row mm-empty-row';
      for (let j = 0; j < roundConfig.slots; j++) row.appendChild(makeSlot(null));
      const fb = document.createElement('div');
      fb.className = 'mm-feedback';
      row.appendChild(fb);
      boardEl.prepend(row);
    }
    for (const { guess, feedback } of history) {
      const row = document.createElement('div');
      row.className = 'mm-guess-row mm-history-row';
      for (const c of guess) row.appendChild(makeSlot(c));
      row.appendChild(makeFeedback(feedback));
      boardEl.appendChild(row);
    }
  }

  // Opponent gets a compact status widget instead of a second growing board — just
  // their guess count and how many exact placements their latest guess had (as plain
  // dots, not tied to which slots), never their actual guessed colors. Keeps the whole
  // screen usable regardless of how wide the board grows in later rounds.
  function renderOppProgress() {
    if (!oppProgress) return;
    const used = oppHistory.length;
    const latest = oppHistory[oppHistory.length - 1];

    let bodyHtml;
    if (!latest) {
      bodyHtml = `<span style="font-size:13px;color:var(--muted);">No guesses yet</span>`;
    } else {
      const placeCount = latest.feedback.filter(p => p === 'place').length;
      const dots = Array.from({ length: roundConfig.slots }, (_, i) =>
        `<span class="mm-dot ${i < placeCount ? 'mm-dot-place' : 'mm-dot-empty'}"></span>`
      ).join('');
      bodyHtml = `<div style="display:flex;gap:4px;">${dots}</div><span style="font-size:13px;color:var(--muted);">${placeCount}/${roundConfig.slots} placed</span>`;
    }

    const guessLabel = Number.isFinite(oppMaxGuesses) ? `Guess ${used} of ${oppMaxGuesses}` : `Guess ${used}`;
    oppProgress.innerHTML = `
      <div style="font-weight:700;margin-bottom:2px;">${escapeHtml(oppName)}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">${guessLabel}${oppCracked ? ' — cracked it! 🎉' : ''}</div>
      <div style="display:flex;align-items:center;gap:8px;">${bodyHtml}</div>`;
  }

  function renderBoards() {
    renderLane(boardMine, myHistory, myMaxGuesses);
    renderOppProgress();
  }

  // --- Live intensity ramp: vibe reflects the opponent's most recent guess ---
  // Only the opponent's guesses drive this — never your own. Per guess: each exact
  // placement is worth a full share (1/slots), each right-colour-wrong-spot is worth
  // half a share — e.g. 5 slots → 20% per placement, 10% per colour-only match.
  // Recalculated fresh off their latest guess each time — it can go up or down as
  // their attempts get better or worse, not a running best-ever ratchet.

  function guessScore(feedback) {
    const place = feedback.filter(p => p === 'place').length;
    const color = feedback.filter(p => p === 'color').length;
    return (place + color * 0.5) / roundConfig.slots;
  }

  function updateOppProximityVibe() {
    if (phase !== 'playing') return;
    const latest = oppHistory[oppHistory.length - 1];
    if (!latest) return;
    haptics.startContinuousVibe(guessScore(latest.feedback));
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
    // Without this, the live proximity vibe (and the edge gate's vibe) run as a flat,
    // unshaped buzz — setWaveVibeMode is otherwise only ever turned on inside the
    // forfeit-vibe flows, never during active play.
    haptics.setWaveVibeMode(true);

    phase = 'playing';
    myHistory = [];
    oppHistory = [];
    currentGuess = [];
    myMaxGuesses = guessCap();
    oppMaxGuesses = guessCap();
    roundWinner = null;
    roundReadySent = false;
    oppRoundReadyReceived = false;
    myCracked = false;
    oppCracked = false;
    resultKnown = false;
    finalWinner = null;

    forfeitOverlay.style.display = 'none';
    inputArea.style.opacity = '1';
    inputArea.style.pointerEvents = '';

    renderHeader();
    renderBoards();
    renderCurrentRow();
  }

  function addColor(c) {
    if (phase !== 'playing' || myCracked || myHistory.length >= myMaxGuesses) return;
    if (currentGuess.length >= roundConfig.slots) return;
    currentGuess.push(c);
    renderCurrentRow();
  }

  function removeColor() {
    if (phase !== 'playing' || myCracked || myHistory.length >= myMaxGuesses) return;
    if (currentGuess.length === 0) return;
    currentGuess.pop();
    renderCurrentRow();
  }

  function submitGuess() {
    if (phase !== 'playing' || myCracked || myHistory.length >= myMaxGuesses) return;
    if (currentGuess.length < roundConfig.slots) return;

    const guess = [...currentGuess];
    currentGuess = [];

    const positions = evaluateGuessPositional(code, guess);
    myHistory.push({ guess, feedback: positions });

    const solved = positions.every(p => p === 'place');
    socket.send({ type: MSG.MM_H2H_GUESS, guess, roundIndex, solved });

    if (solved) {
      myCracked = true;
      showTurnNotice("You cracked it! Waiting on opponent…");
    }

    renderBoards();
    renderCurrentRow();
    renderHeader();

    tryFinalizeRound();
  }

  // Round ends only once BOTH players are done (cracked it or exhausted their own
  // guesses) — the round doesn't end the instant one side wins, the other keeps going.
  function tryFinalizeRound() {
    if (phase !== 'playing') return;
    const myDone  = myCracked  || myHistory.length  >= myMaxGuesses;
    const oppDone = oppCracked || oppHistory.length >= oppMaxGuesses;
    if (!myDone || !oppDone) return;

    if (myCracked || oppCracked) {
      if (!resultKnown) return; // wait for the server's authoritative winner
      endRound(finalWinner);
    } else {
      endRound(null);
    }
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

  // --- Phase: round end ---

  function endRound(winner) {
    if (phase !== 'playing') return;
    roundWinner = winner;
    inputArea.style.opacity = '0.4';
    inputArea.style.pointerEvents = 'none';
    submitBtn.disabled = true;
    haptics.stopContinuousVibe();

    if (winner === 'mine') {
      phase = 'won';
      myRoundsSolved++;
    } else if (winner === 'theirs') {
      phase = 'lost';
      oppRoundsSolved++;
    } else {
      phase = 'both-failed';
    }

    // Edge mode has no real per-round choice anymore (winner always auto-banks), so
    // both sides just see one shared "Winner is..." screen instead of the separate
    // winner/loser flow below — no MM_VIBE_CHOICE round-trip needed either.
    if (winner !== null && state.edgeMode) {
      enterEdgeWinnerScreen(winner);
    } else if (winner === 'mine') {
      enterWonPhase();
    } else if (winner === 'theirs') {
      enterLostPhase();
    } else {
      enterBothFailedPhase();
    }
  }

  function enterEdgeWinnerScreen(winner) {
    const iWon = winner === 'mine';
    if (iWon) myBanked += (state.forfeitDuration || 30);
    const winnerName = iWon ? myName : oppName;

    forfeitContent.innerHTML = `
      <h2>Round ${roundIndex + 1} Over</h2>
      <div class="mm-code-reveal">
        <div class="mm-code-label">The code was:</div>
        <div class="mm-code-slots">${codeRevealHtml()}</div>
      </div>
      <div class="mm-forfeit-result ${iWon ? 'mm-solved' : 'mm-failed'}">Winner is: ${escapeHtml(winnerName)}</div>
      <div class="mm-waiting-text" style="margin:8px 0">Loser must edge.</div>
      <div id="mm-continue-slot"></div>`;

    forfeitOverlay.style.display = 'flex';
    renderEdgeGate({ containerEl: forfeitContent.querySelector('#mm-continue-slot'), amLoser: !iWon, onReady: onContinueClick });
  }

  function calcMyVibeEarned() {
    return calcVibeEarned(myRoundsSolved);
  }

  function codeRevealHtml() {
    return code.map(c =>
      `<div class="mm-slot" style="background:${COLOR_STYLE[c].bg};color:${COLOR_STYLE[c].text}">${c}</div>`
    ).join('');
  }

  // Only reached when edge mode is off — edge mode's winner screen is
  // enterEdgeWinnerScreen() instead, called directly from endRound().
  function enterWonPhase() {
    const earned = calcMyVibeEarned();
    const total = earned + myBanked;

    const winLabel = myRoundsSolved === 1
      ? 'First win — 30s'
      : `Win #${myRoundsSolved} — ${earned}s (×${Math.pow(2, myRoundsSolved - 1)} base)`;

    const isLastRound = roundIndex + 1 >= totalRounds;
    const bankOrWaive = isLastRound
      ? `<button id="mm-bank-it" class="mm-choice-bank">Waive — no forfeit this round</button>`
      : `<button id="mm-bank-it" class="mm-choice-bank">Bank it for later</button>`;

    forfeitContent.innerHTML = `
      <h2>You cracked it! 🎉</h2>
      <div class="mm-code-reveal">
        <div class="mm-code-label">The code was:</div>
        <div class="mm-code-slots">${codeRevealHtml()}</div>
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
        <div id="mm-claim-controls" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;justify-content:center;"></div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">You control ${escapeHtml(oppName)}'s vibe — pattern, tempo and strength.</div>
        <div style="display:flex;justify-content:center;margin-top:10px;">
          <button id="mm-vibe-toggle" style="min-width:100px;">Stop</button>
        </div>
      </div>` : `<div class="mm-no-vibe">${banked ? `Banked! 🏦 ${myBanked}s saved for later.` : 'No vibe this round.'}</div>`;

    forfeitContent.innerHTML = `
      <h2>Round ${roundIndex + 1} Over</h2>
      <div class="mm-code-reveal">
        <div class="mm-code-label">The code was:</div>
        <div class="mm-code-slots">${codeRevealHtml()}</div>
      </div>
      <div class="mm-forfeit-result mm-solved">✓ You cracked it!</div>
      ${vibeSection}
      <div id="mm-continue-slot"></div>`;

    if (oppVibeSeconds > 0) {
      setupForfeitVibeUI(0, oppVibeSeconds, true);
      renderVibeModeTempoControls(forfeitContent.querySelector('#mm-claim-controls'), [oppRole]);
    }

    renderEdgeGate({ containerEl: forfeitContent.querySelector('#mm-continue-slot'), amLoser: false, onReady: onContinueClick });
  }

  function enterLostPhase() {
    forfeitContent.innerHTML = `
      <h2>Round ${roundIndex + 1} Over</h2>
      <div class="mm-code-reveal">
        <div class="mm-code-label">The code was:</div>
        <div class="mm-code-slots">${codeRevealHtml()}</div>
      </div>
      <div class="mm-forfeit-result mm-failed">✗ Opponent cracked it</div>
      <div class="mm-waiting-text" style="margin:16px 0">Waiting for opponent's decision…</div>`;

    forfeitOverlay.style.display = 'flex';
    // Continue button appears when MM_VIBE_CHOICE is received (handled in onMmVibeChoice)
  }

  function enterBothFailedPhase() {
    // Edge mode replaces the flat forfeit vibe here too — no vibe, no banking touched,
    // both players simply edge before the next round.
    if (state.edgeMode) {
      forfeitContent.innerHTML = `
        <h2>Nobody cracked it!</h2>
        <div class="mm-code-reveal">
          <div class="mm-code-label">The code was:</div>
          <div class="mm-code-slots">${codeRevealHtml()}</div>
        </div>
        <div class="mm-forfeit-result mm-failed">✗ Both players fail this round.</div>
        <div id="mm-continue-slot"></div>`;

      forfeitOverlay.style.display = 'flex';
      renderEdgeGate({ containerEl: forfeitContent.querySelector('#mm-continue-slot'), amLoser: true, onReady: onContinueClick });
      return;
    }

    // Flat amount straight from the lobby's "Forfeit vibe" setting — same on both
    // screens regardless of individual banked totals (which are left untouched here).
    // One shared intensity/pattern/tempo/start-stop control: either player can adjust
    // it and it drives both devices identically for the same duration.
    const myVibe = state.forfeitDuration || 30;

    forfeitContent.innerHTML = `
      <h2>Nobody cracked it!</h2>
      <div class="mm-code-reveal">
        <div class="mm-code-label">The code was:</div>
        <div class="mm-code-slots">${codeRevealHtml()}</div>
      </div>
      <div class="mm-forfeit-result mm-failed">✗ Both players fail — ${myVibe}s each!</div>
      <div class="mm-claim-section">
        <div class="mm-claim-countdown"><span id="mm-my-vibe-ctr">${myVibe}</span><span class="mm-ctr-unit">s</span></div>
        <div class="mm-wave-pattern">Pattern: <span id="mm-wave-state">—</span></div>
        <div class="mm-vibe-bar-wrap" style="margin:8px 0"><div class="mm-vibe-bar mm-vibe-bar-self" id="mm-my-vibe-bar" style="width:100%"></div></div>
        <div class="forfeit-slider-row">
          <span>Strength</span>
          <input type="range" id="mm-intensity-slider" min="0" max="100" value="100" style="flex:1;margin:0 12px;">
          <span id="mm-intensity-pct">100%</span>
        </div>
        <div id="mm-claim-controls" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;justify-content:center;"></div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">Shared — either of you can adjust this for both.</div>
        <div style="display:flex;justify-content:center;margin-top:10px;">
          <button id="mm-vibe-toggle">Start</button>
        </div>
      </div>
      <div id="mm-continue-slot"></div>`;

    forfeitOverlay.style.display = 'flex';
    if (myVibe > 0) {
      haptics.setWaveVibeMode(true);
      setupForfeitVibeUI(myVibe, 0);
      renderVibeModeTempoControls(forfeitContent.querySelector('#mm-claim-controls'), [state.role, oppRole]);
    }
    renderEdgeGate({ containerEl: forfeitContent.querySelector('#mm-continue-slot'), amLoser: false, onReady: onContinueClick });
  }

  // Interactive pattern+tempo selects. `targets` is the list of roles a change should
  // apply to — [oppRole] when the winner is setting it for the loser (their own device
  // is untouched), or [state.role, oppRole] for the both-failed shared control (applies
  // to both devices at once, whoever moves it).
  function renderVibeModeTempoControls(containerEl, targets) {
    if (!containerEl) return;
    const initialMode  = state.vibeModes[targets[0]] || 'random';
    const initialTempo = state.vibeTempo[targets[0]] || 1;
    containerEl.innerHTML = `
      <select id="mm-claim-pattern" class="vmb-select">
        ${VIBE_MODES.map(m => `<option value="${m.id}"${initialMode === m.id ? ' selected' : ''}>${m.label}</option>`).join('')}
      </select>
      <select id="mm-claim-tempo" class="vmb-select vmb-tempo-select">
        ${TEMPO_OPTIONS.map(t => `<option value="${t}"${initialTempo === t ? ' selected' : ''}>${t}x</option>`).join('')}
      </select>`;

    containerEl.querySelector('#mm-claim-pattern').addEventListener('change', (e) => {
      const mode = e.target.value;
      targets.forEach(t => {
        state.vibeModes[t] = mode;
        if (t === state.role) haptics.setVibeMode(mode);
        socket.send({ type: MSG.VIBE_MODE_SET, target: t, mode });
      });
    });
    containerEl.querySelector('#mm-claim-tempo').addEventListener('change', (e) => {
      const tempo = Number(e.target.value);
      targets.forEach(t => {
        state.vibeTempo[t] = tempo;
        if (t === state.role) haptics.setVibeTempo(tempo);
        socket.send({ type: MSG.VIBE_TEMPO_SET, target: t, tempo });
      });
    });
  }

  // Read-only pattern+tempo readout for the loser during a winner-controlled claim —
  // reflects the winner's live choices, but isn't itself interactive. Returns a
  // teardown function; caller is responsible for wiring it into the round's cleanup.
  function renderReadOnlyVibeMode(containerEl, role) {
    if (!containerEl) return () => {};
    const refresh = () => {
      const mode = state.vibeModes[role] || 'random';
      const tempo = state.vibeTempo[role] || 1;
      containerEl.textContent = `Pattern: ${vibeModeLabel(mode)} · Tempo: ${tempo}x`;
    };
    refresh();
    window.addEventListener('vibe-modes-updated', refresh);
    return () => window.removeEventListener('vibe-modes-updated', refresh);
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
      startRound();
    }
  }

  function enterGameOverForfeit() {
    gameEndReadySent = false;
    gameEndOppReady = false;
    forfeitOverlay.style.display = 'flex';

    const iWon  = myRoundsSolved > oppRoundsSolved;
    const tied  = myRoundsSolved === oppRoundsSolved;

    if (tied) {
      forfeitContent.innerHTML = `
        <h2>Game Over!</h2>
        <div class="mm-forfeit-result">Draw — no game-over forfeit.</div>
        <button id="mm-ge-continue" class="mm-continue-btn">See Results</button>`;
      forfeitContent.querySelector('#mm-ge-continue').addEventListener('click', onGameEndContinue);
      return;
    }

    if (iWon) {
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
          <div id="mm-claim-controls" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;justify-content:center;"></div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px;">You control ${escapeHtml(oppName)}'s vibe — pattern, tempo and strength.</div>
          <div style="display:flex;justify-content:center;margin-top:10px;">
            <button id="mm-vibe-toggle">Stop</button>
          </div>
        </div>
        <button id="mm-ge-continue" class="mm-continue-btn">Continue to Results</button>`;

      forfeitContent.querySelector('#mm-ge-continue').addEventListener('click', onGameEndContinue);
      if (vibeSeconds > 0) {
        setupForfeitVibeUI(0, vibeSeconds, true);
        renderVibeModeTempoControls(forfeitContent.querySelector('#mm-claim-controls'), [oppRole]);
      }
    } else {
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
    state.forfeitAlreadyResolved = true;
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
          <div style="font-size:13px;color:var(--muted);">Intensity: <span id="mm-intensity-pct">100%</span></div>
          <div id="mm-claim-readonly" style="font-size:12px;color:var(--muted);margin-top:2px;"></div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px;">${escapeHtml(oppName)} is controlling this — you can still stop it.</div>
          <div style="display:flex;justify-content:center;margin-top:10px;">
            <button id="mm-vibe-toggle">Stop</button>
          </div>
        </div>
        <button id="mm-ge-continue" class="mm-continue-btn">Continue to Results</button>`;
      setupForfeitVibeUI(vibeSeconds, 0);
      const removeReadOnly = renderReadOnlyVibeMode(forfeitContent.querySelector('#mm-claim-readonly'), state.role);
      const prevCleanup = window._mmRoundForfeitCleanup;
      window._mmRoundForfeitCleanup = () => { if (prevCleanup) prevCleanup(); removeReadOnly(); };
    }

    forfeitContent.querySelector('#mm-ge-continue').addEventListener('click', onGameEndContinue);
  }

  function onMmGameEndReady() {
    gameEndOppReady = true;
    checkGameEndReady();
  }

  // --- Input ---

  function onKeyDown(e) {
    if (phase !== 'playing' || myCracked) return;
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

  function onMmH2hGuess(ev) {
    if (phase !== 'playing') return;
    const guess = ev.detail?.guess;
    if (!Array.isArray(guess) || guess.length !== code.length) return;

    const positions = evaluateGuessPositional(code, guess);
    oppHistory.push({ guess, feedback: positions });
    updateOppProximityVibe();

    if (positions.every(p => p === 'place')) {
      oppCracked = true;
      showTurnNotice(`${oppName} cracked it!`);
    }

    renderBoards();
    // Who actually gets credited as round winner is only final once mm_h2h_result
    // arrives (see onMmH2hResult) — the server is the single authority, so both
    // clients always agree even on a near-simultaneous double-crack.
    tryFinalizeRound();
  }

  function onMmH2hResult(ev) {
    if (phase !== 'playing') return;
    const { roundIndex: r, winnerRole } = ev.detail || {};
    if (r !== roundIndex) return;
    resultKnown = true;
    finalWinner = winnerRole === state.role ? 'mine' : 'theirs';
    tryFinalizeRound();
  }

  // Only fires when edge mode is off — under edge mode the winner never sends
  // MM_VIBE_CHOICE anymore (see enterEdgeWinnerScreen), so this never runs there.
  function onMmVibeChoice(ev) {
    const { choice, vibeSeconds } = ev.detail || {};
    const earned = calcMyVibeEarned();

    if (choice === 'use') {
      const myVibe = vibeSeconds || earned;
      haptics.setWaveVibeMode(true);
      forfeitContent.innerHTML = `
        <h2>Round ${roundIndex + 1} Over</h2>
        <div class="mm-code-reveal">
          <div class="mm-code-label">The code was:</div>
          <div class="mm-code-slots">${codeRevealHtml()}</div>
        </div>
        <div class="mm-forfeit-result mm-failed">✗ You didn't crack it</div>
        <div class="mm-claim-section">
          <div class="mm-claim-countdown"><span id="mm-my-vibe-ctr">${myVibe}</span><span class="mm-ctr-unit">s</span></div>
          <div class="mm-wave-pattern">Pattern: <span id="mm-wave-state">—</span></div>
          <div class="mm-vibe-bar-wrap" style="margin:8px 0"><div class="mm-vibe-bar mm-vibe-bar-self" id="mm-my-vibe-bar" style="width:100%"></div></div>
          <div style="font-size:13px;color:var(--muted);">Intensity: <span id="mm-intensity-pct">100%</span></div>
          <div id="mm-claim-readonly" style="font-size:12px;color:var(--muted);margin-top:2px;"></div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px;">${escapeHtml(oppName)} is controlling this — you can still stop it.</div>
          <div style="display:flex;justify-content:center;margin-top:10px;">
            <button id="mm-vibe-toggle" style="min-width:100px;">Stop</button>
          </div>
        </div>
        <div id="mm-continue-slot"></div>`;

      setupForfeitVibeUI(myVibe, 0);
      const removeReadOnly = renderReadOnlyVibeMode(forfeitContent.querySelector('#mm-claim-readonly'), state.role);
      const prevCleanup = window._mmRoundForfeitCleanup;
      window._mmRoundForfeitCleanup = () => { if (prevCleanup) prevCleanup(); removeReadOnly(); };
    } else {
      const safeMsg = choice === 'waive'
        ? 'Opponent waived the forfeit — no vibe this round.'
        : 'Opponent banked their vibe — you\'re safe this round. 😅';
      forfeitContent.innerHTML = `
        <h2>Round ${roundIndex + 1} Over</h2>
        <div class="mm-code-reveal">
          <div class="mm-code-label">The code was:</div>
          <div class="mm-code-slots">${codeRevealHtml()}</div>
        </div>
        <div class="mm-forfeit-result mm-failed">✗ You didn't crack it</div>
        <div class="mm-no-vibe">${safeMsg}</div>
        <div id="mm-continue-slot"></div>`;
    }

    renderEdgeGate({ containerEl: forfeitContent.querySelector('#mm-continue-slot'), amLoser: false, onReady: onContinueClick });
  }

  function onMmRoundReady() {
    oppRoundReadyReceived = true;
    checkBothReady();
  }

  function onPeerLeft() {
    clearInterval(forfeitInterval);
    haptics.stopContinuousVibe();
    root.innerHTML = `
      <div class="card">
        <h2>Opponent left</h2>
        <div class="actions"><button id="mm-peer-home">Home</button></div>
      </div>`;
    root.querySelector('#mm-peer-home').addEventListener('click', () => { location.hash = '#/'; });
  }

  socket.addEventListener(MSG.MM_H2H_GUESS, onMmH2hGuess);
  socket.addEventListener(MSG.MM_H2H_RESULT, onMmH2hResult);
  socket.addEventListener(MSG.MM_VIBE_CHOICE, onMmVibeChoice);
  socket.addEventListener(MSG.MM_ROUND_READY, onMmRoundReady);
  socket.addEventListener(MSG.MM_GAME_END_VIBE, onMmGameEndVibe);
  socket.addEventListener(MSG.MM_GAME_END_READY, onMmGameEndReady);
  socket.addEventListener(MSG.PEER_LEFT, onPeerLeft);

  const cleanup = () => {
    clearInterval(forfeitInterval);
    if (window._mmRoundForfeitCleanup) { window._mmRoundForfeitCleanup(); window._mmRoundForfeitCleanup = null; }
    document.removeEventListener('keydown', onKeyDown);
    socket.removeEventListener(MSG.MM_H2H_GUESS, onMmH2hGuess);
    socket.removeEventListener(MSG.MM_H2H_RESULT, onMmH2hResult);
    socket.removeEventListener(MSG.MM_VIBE_CHOICE, onMmVibeChoice);
    socket.removeEventListener(MSG.MM_ROUND_READY, onMmRoundReady);
    socket.removeEventListener(MSG.MM_GAME_END_VIBE, onMmGameEndVibe);
    socket.removeEventListener(MSG.MM_GAME_END_READY, onMmGameEndReady);
    socket.removeEventListener(MSG.PEER_LEFT, onPeerLeft);
    if (vibeBatteryInstance) { vibeBatteryInstance.destroy(); vibeBatteryInstance = null; }
    if (vibeModeBarInstance) { vibeModeBarInstance.destroy(); vibeModeBarInstance = null; }
    haptics.stopAll();
  };
  window.addEventListener('hashchange', cleanup, { once: true });

  _showH2HInstructions(state, startCountdown);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function _showH2HInstructions(state, onReady) {
  const mode = state.gameMode || 'easy';
  const rounds = state.gameRounds || 3;
  const overlay = document.createElement('div');
  overlay.className = 'instructions-overlay';
  overlay.innerHTML = `
    <div class="instructions-box">
      <h2>Mastermind — Head to Head</h2>
      <p class="instructions-meta">Mode: <strong>${mode === 'hard' ? 'Hard' : 'Easy'}</strong> &nbsp;·&nbsp; Rounds: <strong>${rounds}</strong></p>
      <div class="instructions-section">
        <div class="instructions-heading">Race the same code</div>
        <ul class="instructions-list">
          <li>Same secret code, two lanes — guess at your own pace, no turns.</li>
          <li>First to crack it wins the round.</li>
          <li>You see how many of their latest guess's colors were placed exactly right — never their actual guesses.</li>
          ${state.mmContinueUntilSolved
            ? '<li><strong>Continue Until Solved</strong> — no guess limit. Keep guessing even after they solve it, the round only ends once you\'ve also cracked it.</li>'
            : '<li>Keep guessing even after they solve it — the round only ends once you\'ve also cracked it or run out of guesses.</li>'}
          <li>Only your opponent's guesses vibrate you — yours never do. The closer they get, the more intense it gets.</li>
        </ul>
      </div>
      <div class="instructions-section">
        <div class="instructions-heading">Feedback</div>
        <ul class="instructions-list">
          <li><strong>Green dot</strong> = right color, right position.</li>
          <li><strong>Yellow dot</strong> = right color, wrong position.</li>
          ${mode === 'hard' ? '' : '<li><strong>Dashed dot</strong> = color is in the code but all copies are already matched.</li>'}
          ${mode === 'hard' ? '<li>Hard: dots unordered — no positions revealed.</li>' : '<li><strong>Dark dot</strong> = color is not in the code at all.</li>'}
        </ul>
      </div>
      <div class="instructions-section">
        <div class="instructions-heading">Vibe stakes</div>
        <ul class="instructions-list">
          ${state.edgeMode
            ? `<li>Win a round → ${state.forfeitDuration || 30}s banks automatically (see 🏦 in the header) — claimed against your opponent at game end.</li><li>Both fail to crack it → no vibe, both edge instead.</li>`
            : `<li>Win a round → earn vibe seconds against opponent.</li><li><strong>Use Now</strong> (you control their intensity, pattern and tempo) or <strong>Bank</strong> it for a bigger hit later.</li><li>Both fail to crack it → ${state.forfeitDuration || 30}s each, one shared intensity/pattern/tempo control either of you can adjust.</li>`}
        </ul>
      </div>
      ${state.edgeMode ? `
      <div class="instructions-section">
        <div class="instructions-heading">Edge Mode</div>
        <ul class="instructions-list">
          <li>Lose a round → you edge before the next one starts.</li>
          <li>Nobody cracks it → both players edge.</li>
          <li>Self-paced — continue whenever you're ready.</li>
        </ul>
      </div>` : ''}
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
