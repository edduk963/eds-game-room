import { state } from '../state.js';
import { navigate } from '../main.js';
import * as haptics from '../haptics.js';
import { initVibeBattery } from '../vibeBattery.js';
import { initVibeModeBar } from '../vibeModeBar.js';
import { makeRng } from '../game/seededRng.js';
import {
  getBaseConfig, nextRoundConfig, generateCode, evaluateGuessPositional,
  COLORS, chargesFromGuess,
} from '../game/MastermindGame.js';

const COLOR_STYLE = {
  R: { bg: '#e84040', text: '#fff' },
  G: { bg: '#38c060', text: '#fff' },
  B: { bg: '#3878e8', text: '#fff' },
  W: { bg: '#e8e8e8', text: '#222' },
};

// More guesses used → more vibe. Fail entirely → worst outcome (1.5× max).
function calcRoundVibe(guessesUsed, maxGuesses, solved, roundIndex) {
  const baseMax = 30 * (roundIndex + 1); // 30 / 60 / 90 / …
  if (!solved) return Math.round(baseMax * 1.5);
  return Math.round(baseMax * (guessesUsed / maxGuesses));
}

const SOLO_POWERUPS = [
  { id: 'hint',      label: 'Hint',     cost: 3, desc: 'Reveal a random code slot' },
  { id: 'add_guess', label: '+1 Guess', cost: 2, desc: 'Add an extra guess row' },
];

export function renderMastermind1P(root) {
  const totalRounds = state.gameRounds || 3;
  const gameMode = state.gameMode || 'easy';
  const rng = makeRng(state.seed);

  let roundIndex = 0;
  let roundConfig = getBaseConfig(gameMode);
  let code = generateCode(rng, roundConfig.slots);

  let guessHistory = [];
  let currentGuess = [];
  let phase = 'playing'; // 'playing' | 'round-end' | 'done'
  let myCharges = 0;
  let hintedSlots = [];
  let forfeitInterval = null;
  let roundsSolved = 0;
  let roundsFailed = 0;
  let totalVibeEarned = 0;

  let vibeBatteryInstance = initVibeBattery(root);
  let vibeModeBarInstance = null;

  const _modeName = gameMode === 'hard' ? 'Hard' : 'Easy';
  const _modeSub = gameMode === 'hard'
    ? '— feedback dots are an unordered tally (no positions shown)'
    : '— feedback dots line up with each slot';
  const _legendItem = (cls, text) =>
    `<span style="display:inline-flex;align-items:center;gap:6px;"><span class="mm-dot ${cls}"></span>${text}</span>`;
  const _legend = gameMode === 'hard'
    ? _legendItem('mm-dot-place', '# exactly right') + _legendItem('mm-dot-color', '# right colour, wrong spot')
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
      <div id="mm-turn-indicator" class="mm-turn-indicator mm-turn-mine">YOUR TURN</div>
      <div id="mm-vibe-preview" style="margin:6px 0 8px;padding:8px 12px;background:#1a0a0a;border:1px solid #3d1515;border-radius:8px;font-size:13px;display:none;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="color:var(--muted);">Vibe if you stop here</span>
          <span id="mm-vp-label" style="font-weight:700;color:var(--warn);"></span>
        </div>
        <div style="background:#2a1010;border-radius:4px;height:8px;overflow:hidden;">
          <div id="mm-vp-bar" style="height:100%;background:var(--warn);transition:width 0.2s;width:0%;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:5px;font-size:11px;color:var(--muted);">
          <span>Guess intensity: <strong id="mm-vp-intensity" style="color:var(--warn);">0%</strong></span>
          <span>Fail penalty: <strong id="mm-vp-fail" style="color:#c04040;"></strong></span>
        </div>
      </div>
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

  vibeModeBarInstance = initVibeModeBar(root);

  const forfeitOverlay  = root.querySelector('#mm-forfeit-overlay');
  const forfeitContent  = root.querySelector('#mm-forfeit-content');
  const roundLabel      = root.querySelector('#mm-round-label');
  const chargesEl       = root.querySelector('#mm-charges');
  const turnIndicator   = root.querySelector('#mm-turn-indicator');
  const hintBar         = root.querySelector('#mm-hint-bar');
  const board           = root.querySelector('#mm-board');
  const currentRow      = root.querySelector('#mm-current-row');
  const inputArea       = root.querySelector('#mm-input-area');
  const submitBtn       = root.querySelector('#mm-submit');
  const powerupBar      = root.querySelector('#mm-powerup-bar');

  // ── Render helpers ──────────────────────────────────────────────────────────

  function renderHeader() {
    roundLabel.textContent = `Round ${roundIndex + 1} of ${totalRounds}`;
    chargesEl.textContent = `⚡ ${myCharges}`;
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
      const hint = hintedSlots.find(h => h.index === i);
      if (hint && !currentGuess[i]) {
        slot.style.borderColor = COLOR_STYLE[hint.color].bg;
        slot.style.borderWidth = '3px';
        slot.style.borderStyle = 'dashed';
      }
      currentRow.appendChild(slot);
    }
    submitBtn.disabled = phase !== 'playing' || currentGuess.length < roundConfig.slots;
    const palette = root.querySelector('.mm-color-palette');
    if (palette) {
      palette.style.opacity = phase === 'playing' ? '1' : '0.4';
      palette.style.pointerEvents = phase === 'playing' ? '' : 'none';
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
    for (const { guess, feedback } of guessHistory) {
      const row = document.createElement('div');
      row.className = 'mm-guess-row mm-history-row mm-by-mine';
      for (const c of guess) row.appendChild(makeSlot(c));
      row.appendChild(makeFeedback(feedback));
      board.appendChild(row);
    }
  }

  function renderVibePreview() {
    const preview = root.querySelector('#mm-vibe-preview');
    if (!preview) return;
    if (guessHistory.length === 0) { preview.style.display = 'none'; return; }
    preview.style.display = 'block';

    const guessesUsed = guessHistory.length;
    const projectedVibe = calcRoundVibe(guessesUsed, roundConfig.guesses, true, roundIndex);
    const failVibe = calcRoundVibe(roundConfig.guesses, roundConfig.guesses, false, roundIndex);
    const maxVibe = failVibe;
    const barPct = Math.round((projectedVibe / maxVibe) * 100);

    const wrongSoFar = guessHistory
      .filter(g => !g.feedback.every(p => p === 'place'))
      .reduce((s, g) => s + g.feedback.filter(p => p !== 'place').length, 0);
    const intensityPct = Math.round(Math.min(1, wrongSoFar / (roundConfig.guesses * roundConfig.slots)) * 100);

    root.querySelector('#mm-vp-label').textContent = `${projectedVibe}s`;
    root.querySelector('#mm-vp-bar').style.width = `${barPct}%`;
    root.querySelector('#mm-vp-intensity').textContent = `${intensityPct}%`;
    root.querySelector('#mm-vp-fail').textContent = `${failVibe}s`;
  }

  function renderPowerups() {
    powerupBar.innerHTML = '';
    for (const pu of SOLO_POWERUPS) {
      const btn = document.createElement('button');
      const canUse = myCharges >= pu.cost && phase === 'playing';
      btn.className = 'mm-powerup-btn ghost' + (canUse ? '' : ' mm-powerup-disabled');
      btn.disabled = !canUse;
      btn.title = pu.desc;
      btn.innerHTML = `<span class="pu-label">${pu.label}</span><span class="pu-cost">⚡${pu.cost}</span>`;
      btn.addEventListener('click', () => usePowerup(pu.id));
      powerupBar.appendChild(btn);
    }
  }

  // ── Game flow ───────────────────────────────────────────────────────────────

  function startRound() {
    phase = 'playing';
    guessHistory = [];
    currentGuess = [];
    hintedSlots = [];
    myCharges = 0;
    forfeitOverlay.style.display = 'none';
    inputArea.style.opacity = '1';
    inputArea.style.pointerEvents = '';
    turnIndicator.textContent = 'YOUR TURN';
    turnIndicator.className = 'mm-turn-indicator mm-turn-mine';
    renderHeader();
    renderBoard();
    renderCurrentRow();
    renderHints();
    renderPowerups();
    renderVibePreview();
  }

  function addColor(c) {
    if (phase !== 'playing') return;
    if (currentGuess.length >= roundConfig.slots) return;
    currentGuess.push(c);
    renderCurrentRow();
  }

  function removeColor() {
    if (phase !== 'playing') return;
    currentGuess.pop();
    renderCurrentRow();
  }

  function submitGuess() {
    if (phase !== 'playing') return;
    if (currentGuess.length < roundConfig.slots) return;

    const guess = [...currentGuess];
    const positions = evaluateGuessPositional(code, guess);
    guessHistory.push({ guess, feedback: positions });
    myCharges += chargesFromGuess(positions);
    currentGuess = [];

    if (!positions.every(p => p === 'place')) {
      const wrongSoFar = guessHistory
        .filter(g => !g.feedback.every(p => p === 'place'))
        .reduce((s, g) => s + g.feedback.filter(p => p !== 'place').length, 0);
      haptics.testVibe(Math.min(1, wrongSoFar / (roundConfig.guesses * roundConfig.slots)));
    }

    renderBoard();
    renderCurrentRow();
    renderHeader();
    renderPowerups();
    renderVibePreview();

    if (positions.every(p => p === 'place')) {
      endRound(true);
    } else if (guessHistory.length >= roundConfig.guesses) {
      endRound(false);
    }
  }

  function endRound(solved) {
    phase = 'round-end';
    inputArea.style.opacity = '0.4';
    inputArea.style.pointerEvents = 'none';
    submitBtn.disabled = true;
    turnIndicator.textContent = '';

    const guessesUsed = guessHistory.length;
    const vibeSeconds = calcRoundVibe(guessesUsed, roundConfig.guesses, solved, roundIndex);
    totalVibeEarned += vibeSeconds;

    if (solved) roundsSolved++; else roundsFailed++;

    showRoundEndOverlay(solved, guessesUsed, vibeSeconds);
  }

  function showRoundEndOverlay(solved, guessesUsed, vibeSeconds) {
    const codeHtml = code.map(c =>
      `<div class="mm-slot" style="background:${COLOR_STYLE[c].bg};color:${COLOR_STYLE[c].text}">${c}</div>`
    ).join('');

    const resultText = solved
      ? `✓ Cracked in ${guessesUsed} / ${roundConfig.guesses} guess${guessesUsed !== 1 ? 'es' : ''}`
      : `✗ Not cracked — all ${roundConfig.guesses} guesses used`;
    const resultClass = solved ? 'mm-solved' : 'mm-failed';

    const vibeLabel = solved
      ? `${guessesUsed}/${roundConfig.guesses} guesses → ${vibeSeconds}s`
      : `Failed → ${vibeSeconds}s (max penalty)`;

    const isLast = roundIndex + 1 >= totalRounds;

    forfeitContent.innerHTML = `
      <h2>Round ${roundIndex + 1} Over</h2>
      <div class="mm-code-reveal">
        <div class="mm-code-label">The code was:</div>
        <div class="mm-code-slots">${codeHtml}</div>
      </div>
      <div class="mm-forfeit-result ${resultClass}">${resultText}</div>
      <div class="mm-vibe-earned" style="margin:10px 0 4px;">${vibeLabel}</div>
      ${vibeSeconds > 0 ? `
      <div class="mm-claim-section">
        <div class="mm-claim-countdown"><span id="mm-my-vibe-ctr">${vibeSeconds}</span><span class="mm-ctr-unit">s</span></div>
        <div class="mm-wave-pattern">Pattern: <span id="mm-wave-state">—</span></div>
        <div class="mm-vibe-bar-wrap" style="margin:8px 0"><div class="mm-vibe-bar mm-vibe-bar-self" id="mm-my-vibe-bar" style="width:100%"></div></div>
        <div class="forfeit-slider-row">
          <span>Strength</span>
          <input type="range" id="mm-intensity-slider" min="0" max="100" value="100" style="flex:1;margin:0 12px;">
          <span id="mm-intensity-pct">100%</span>
        </div>
        <div style="display:flex;justify-content:center;margin-top:10px;">
          <button id="mm-vibe-toggle">Stop</button>
        </div>
      </div>` : '<div class="mm-no-vibe">Perfect — no vibe this round!</div>'}
      <button id="mm-continue" class="mm-continue-btn">${isLast ? 'See Results' : 'Continue'}</button>`;

    forfeitOverlay.style.display = 'flex';

    if (vibeSeconds > 0) {
      haptics.setWaveVibeMode(true);
      setupVibeUI(vibeSeconds);
    }

    forfeitContent.querySelector('#mm-continue').addEventListener('click', onContinue);
  }

  function setupVibeUI(vibeSeconds) {
    let vibeRunning = false;
    let remaining = vibeSeconds;
    let elapsedWhileRunning = 0;
    let runStartTime = null;

    const toggleBtn  = forfeitContent.querySelector('#mm-vibe-toggle');
    const slider     = forfeitContent.querySelector('#mm-intensity-slider');
    const pctEl      = forfeitContent.querySelector('#mm-intensity-pct');
    const waveStateEl = forfeitContent.querySelector('#mm-wave-state');

    function applyToggle(nowRunning) {
      if (vibeRunning === nowRunning) return;
      vibeRunning = nowRunning;
      if (toggleBtn) toggleBtn.textContent = vibeRunning ? 'Stop' : 'Start';
      const now = Date.now();
      if (vibeRunning) {
        haptics.startForfeitVibe(remaining);
        runStartTime = now;
      } else {
        if (runStartTime != null) {
          elapsedWhileRunning += (now - runStartTime) / 1000;
          runStartTime = null;
        }
        remaining = Math.max(0, vibeSeconds - elapsedWhileRunning);
        haptics.pauseForfeitVibe();
      }
    }

    if (toggleBtn) toggleBtn.addEventListener('click', () => applyToggle(!vibeRunning));
    applyToggle(true);

    forfeitInterval = setInterval(() => {
      const now = Date.now();
      if (vibeRunning && runStartTime != null) {
        const totalElapsed = elapsedWhileRunning + (now - runStartTime) / 1000;
        remaining = Math.max(0, vibeSeconds - totalElapsed);
      }
      const ctr = forfeitContent.querySelector('#mm-my-vibe-ctr');
      const bar = forfeitContent.querySelector('#mm-my-vibe-bar');
      if (ctr) ctr.textContent = Math.ceil(remaining);
      if (bar) bar.style.width = `${(remaining / vibeSeconds) * 100}%`;
      if (waveStateEl && vibeRunning) {
        waveStateEl.textContent = haptics.getWaveState();
      }
    }, 100);

    if (slider) {
      slider.addEventListener('input', () => {
        const level = slider.value / 100;
        if (pctEl) pctEl.textContent = `${slider.value}%`;
        haptics.setForfeitIntensity(level);
      });
    }
  }

  function onContinue() {
    clearInterval(forfeitInterval);
    forfeitInterval = null;
    haptics.pauseForfeitVibe();

    roundIndex++;
    if (roundIndex >= totalRounds) {
      showGameOver();
    } else {
      roundConfig = nextRoundConfig(roundConfig, gameMode);
      code = generateCode(rng, roundConfig.slots);
      startRound();
    }
  }

  function showGameOver() {
    phase = 'done';
    forfeitContent.innerHTML = `
      <h2>Game Over!</h2>
      <div style="text-align:center;margin:16px 0;">
        <div style="font-size:28px;font-weight:700;color:var(--accent);">${roundsSolved} / ${totalRounds}</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:14px;">rounds cracked</div>
        <div style="font-size:20px;font-weight:700;color:var(--warn);">${totalVibeEarned}s</div>
        <div style="font-size:13px;color:var(--muted);">total vibe served</div>
      </div>
      <div style="display:flex;justify-content:center;margin-top:16px;">
        <button id="mm-back-lobby">Back to Lobby</button>
      </div>`;
    forfeitOverlay.style.display = 'flex';
    forfeitContent.querySelector('#mm-back-lobby').addEventListener('click', () => {
      state.seed = null;
      navigate(`#/session/${state.sessionId}`);
    });
  }

  // ── Powerups ────────────────────────────────────────────────────────────────

  function usePowerup(type) {
    const pu = SOLO_POWERUPS.find(p => p.id === type);
    if (!pu || myCharges < pu.cost || phase !== 'playing') return;
    myCharges -= pu.cost;
    renderHeader();

    if (type === 'hint') {
      const unhinted = code.map((_, i) => i).filter(i => !hintedSlots.find(h => h.index === i));
      if (unhinted.length === 0) { myCharges += pu.cost; renderHeader(); return; }
      const slotIndex = unhinted[Math.floor(Math.random() * unhinted.length)];
      const color = code[slotIndex];
      hintedSlots.push({ index: slotIndex, color });
      renderHints();
      renderCurrentRow();
      showTurnNotice(`Hint: Slot ${slotIndex + 1} = ${color}`);
    } else if (type === 'add_guess') {
      roundConfig = { ...roundConfig, guesses: roundConfig.guesses + 1 };
      renderBoard();
      showTurnNotice('+1 guess added!');
    }

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

  // ── Input ───────────────────────────────────────────────────────────────────

  function onKeyDown(e) {
    if (phase !== 'playing') return;
    const k = e.key.toUpperCase();
    if (COLORS.includes(k)) { e.preventDefault(); addColor(k); return; }
    if (e.key === 'Backspace') { removeColor(); return; }
    if (e.key === 'Enter') { submitGuess(); return; }
  }

  root.querySelector('#back-to-lobby').addEventListener('click', () => {
    state.seed = null;
    navigate(`#/session/${state.sessionId}`);
  });

  document.addEventListener('keydown', onKeyDown);

  root.querySelector('.mm-color-palette').addEventListener('click', (e) => {
    if (e.target.id === 'mm-back') { removeColor(); return; }
    const btn = e.target.closest('[data-color]');
    if (btn) addColor(btn.dataset.color);
  });

  submitBtn.addEventListener('click', submitGuess);

  root.querySelector('#mm-vibe-btn').addEventListener('click', async () => {
    const btn = root.querySelector('#mm-vibe-btn');
    if (haptics.isConnected()) return;
    btn.textContent = 'Connecting…';
    btn.disabled = true;
    try {
      const dev = await haptics.connect();
      btn.textContent = dev ? `📳 ${dev.name}` : 'No device found';
      btn.disabled = !!dev;
    } catch {
      btn.textContent = 'Connect Vibe';
      btn.disabled = false;
    }
  });

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  window.addEventListener('hashchange', () => {
    clearInterval(forfeitInterval);
    document.removeEventListener('keydown', onKeyDown);
    if (vibeBatteryInstance) { vibeBatteryInstance.destroy(); vibeBatteryInstance = null; }
    if (vibeModeBarInstance) { vibeModeBarInstance.destroy(); vibeModeBarInstance = null; }
    haptics.stopAll();
  }, { once: true });

  // ── Start ────────────────────────────────────────────────────────────────────

  startRound();
}
