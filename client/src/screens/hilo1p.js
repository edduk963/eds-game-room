import { state } from '../state.js';
import { navigate } from '../main.js';
import * as haptics from '../haptics.js';
import { makeRng, rngInt } from '../game/seededRng.js';
import { buildDeck, computeVibeDurationMs, buildCycleRngs, RED_SUITS } from '../game/hiloGame.js';

export function renderHilo1P(root) {
  const myName = state.hostName || state.myName || 'Player';

  // ── Seeded RNG (mirrors hilo.js so seed-derived values stay compatible) ──────
  const starterRng = makeRng(state.seed);

  let effectiveCycles;
  const rawMode = state.hiloMode || 'submission';
  if (rawMode === 'fixed') {
    effectiveCycles = state.hiloCycles === 0 ? rngInt(starterRng, 1, 6) : (state.hiloCycles || 1);
  } else if (rawMode === 'random') {
    effectiveCycles = starterRng() < 0.5 ? Infinity : rngInt(starterRng, 1, 6);
  } else {
    effectiveCycles = Infinity;
  }

  const vibeRampStep = (state.hiloVibeRamp || 10) / 100;
  const actualDeckSize = state.hiloDeckSize === 0
    ? rngInt(starterRng, 1, 6)
    : (state.hiloDeckSize || 1);

  // ── Game state ────────────────────────────────────────────────────────────────
  let cycleCount = 0;
  let { deckRng } = buildCycleRngs(state.seed, cycleCount);
  let deck       = buildDeck(deckRng, actualDeckSize);
  let cardIndex  = 0;
  let phase      = 'playing'; // 'playing' | 'roundEnd' | 'gameOver'

  let lives        = state.hiloLives || 3;
  let points       = 0;
  let mistakeCount = 0;
  let vibeIntensity = 0;   // 0–1, increases each wrong answer
  let peakIntensity = 0;  // highest vibeIntensity reached this session
  let vibeCountdown = 0;   // seconds of vibe remaining

  let vibeTimer    = null; // setInterval ticking vibeCountdown
  let pauseUntil   = 0;   // wall-clock ms when spacebar pause ends
  let pauseInterval = null;

  // ── Vibe helpers ──────────────────────────────────────────────────────────────
  function addVibeSeconds(secs) {
    vibeCountdown += secs;
    if (haptics.isConnected()) {
      haptics.setForfeitIntensity(vibeIntensity);
      haptics.addForfeitSeconds(secs);
    }
    if (!vibeTimer) {
      vibeTimer = setInterval(() => {
        vibeCountdown = Math.max(0, vibeCountdown - 0.1);
        if (vibeCountdown <= 0) {
          clearInterval(vibeTimer);
          vibeTimer = null;
        }
        updateVibeDisplay();
      }, 100);
    }
  }

  function stopVibe() {
    vibeCountdown = 0;
    pauseUntil = 0;
    if (vibeTimer) { clearInterval(vibeTimer); vibeTimer = null; }
    if (pauseInterval) { clearInterval(pauseInterval); pauseInterval = null; }
    haptics.stopAll();
  }

  function amVibing() {
    return vibeCountdown > 0 && phase === 'playing';
  }

  // ── Core game logic ───────────────────────────────────────────────────────────
  function applyGuess(guess) {
    if (phase !== 'playing') return;
    if (cardIndex + 1 >= deck.length) { endRound(); return; }

    const card     = deck[cardIndex];
    const nextCard = deck[cardIndex + 1];
    const correct  = guess === 'higher'
      ? nextCard.value > card.value
      : nextCard.value < card.value;

    cardIndex++;

    if (correct) {
      points++;
      showFeedback('✓ Correct!', 'accent');
    } else {
      mistakeCount++;
      // Intensity ramps up with each mistake, vibe fires immediately
      vibeIntensity = Math.min(1.0, vibeIntensity + vibeRampStep);
      if (vibeIntensity > peakIntensity) peakIntensity = vibeIntensity;
      const secs = computeVibeDurationMs(card.value) / 1000;
      addVibeSeconds(secs);
      showFeedback(`✗ Wrong! Vibe ${Math.round(vibeIntensity * 100)}%`, 'warn');
    }

    if (cardIndex >= deck.length - 1) { endRound(); return; }
    renderState();
  }

  function applySpacebar() {
    if (!amVibing() || phase !== 'playing') return;
    if (lives <= 0) return;
    if (Date.now() < pauseUntil) return; // already paused

    lives = Math.max(0, lives - 1);
    pauseUntil = Date.now() + 30_000;
    haptics.stopAll();
    showFeedback('Vibe paused — 30s', 'accent');
    renderState();

    if (pauseInterval) { clearInterval(pauseInterval); pauseInterval = null; }
    pauseInterval = setInterval(() => {
      const rem = Math.max(0, (pauseUntil - Date.now()) / 1000);
      if (rem <= 0) {
        clearInterval(pauseInterval);
        pauseInterval = null;
        // Resume haptics if vibe is still running
        if (vibeCountdown > 0 && haptics.isConnected()) {
          haptics.setForfeitIntensity(vibeIntensity);
          haptics.addForfeitSeconds(vibeCountdown);
        }
      }
      updateVibeDisplay();
    }, 500);
  }

  function endRound() {
    stopVibe();
    cycleCount++;
    phase = 'roundEnd';

    if (effectiveCycles !== Infinity && cycleCount >= effectiveCycles) {
      showGameOver();
    } else {
      showRoundEnd();
    }
  }

  // ── Overlays ──────────────────────────────────────────────────────────────────
  function hideGameplay() {
    document.getElementById('hilo-arena').style.display = 'none';
    document.getElementById('hilo-guess-btns').style.display = 'none';
    document.getElementById('hilo-spacebar-hint').style.display = 'none';
    document.getElementById('hilo-vibe-indicator').style.display = 'none';
    document.getElementById('hilo-turn-label').textContent = '';
    document.getElementById('hilo-feedback').textContent = '';
    root.querySelector('.hilo-submit-row').style.display = 'none';
  }

  function showRoundEnd() {
    hideGameplay();
    document.getElementById('hilo-round-end-overlay')?.remove();

    const ov = document.createElement('div');
    ov.id = 'hilo-round-end-overlay';
    ov.className = 'hilo-overlay';
    ov.innerHTML = `
      <div class="hilo-overlay-box">
        <h2>Round ${cycleCount} Complete</h2>
        <div class="hilo-round-scores">
          <div class="hilo-round-score-cell">
            <div class="hilo-round-score-name">${escapeHtml(myName)}</div>
            <div class="hilo-round-score-lives">${livesHtml(lives)}</div>
            <div class="hilo-round-score-pts">${points} pts · ${mistakeCount} mistake${mistakeCount !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <p style="text-align:center;font-size:14px;color:var(--muted);margin:16px 0 8px;">Play another round?</p>
        <div style="display:flex;gap:12px;justify-content:center;">
          <button id="hilo-stop-btn" class="ghost">Stop</button>
          <button id="hilo-continue-btn">Continue</button>
        </div>
      </div>`;
    root.appendChild(ov);

    document.getElementById('hilo-stop-btn').addEventListener('click', showGameOver);
    document.getElementById('hilo-continue-btn').addEventListener('click', startNextCycle);
  }

  function startNextCycle() {
    document.getElementById('hilo-round-end-overlay')?.remove();
    const assets = buildCycleRngs(state.seed, cycleCount);
    deck      = buildDeck(assets.deckRng, actualDeckSize);
    cardIndex = 0;
    phase     = 'playing';
    document.getElementById('hilo-arena').style.display = '';
    root.querySelector('.hilo-submit-row').style.display = '';
    renderState();
    showFeedback('New round!', 'accent');
  }

  function showGameOver() {
    if (phase === 'gameOver') return;
    stopVibe();
    phase = 'gameOver';
    document.getElementById('hilo-round-end-overlay')?.remove();
    hideGameplay();
    document.getElementById('hilo-scorebar').innerHTML = '';

    const ov = document.createElement('div');
    ov.className = 'hilo-overlay';
    ov.innerHTML = `
      <div class="hilo-overlay-box">
        <h2>Game Over</h2>
        <p style="text-align:center;font-size:18px;font-weight:700;color:var(--accent);">Solo run complete!</p>
        <div class="hilo-round-scores" style="margin:16px 0;">
          <div class="hilo-round-score-cell">
            <div class="hilo-round-score-name">${escapeHtml(myName)}</div>
            <div class="hilo-round-score-pts" style="font-size:32px;">${points}</div>
            <div style="font-size:12px;color:var(--muted);">pts · ${mistakeCount} mistake${mistakeCount !== 1 ? 's' : ''} · peak ${Math.round(peakIntensity * 100)}% vibe</div>
          </div>
        </div>
        <div style="display:flex;justify-content:center;">
          <button id="hilo-back-lobby">Back to Lobby</button>
        </div>
      </div>`;
    root.appendChild(ov);

    document.getElementById('hilo-back-lobby').addEventListener('click', () => {
      state.seed = null;
      navigate(`#/session/${state.sessionId}`);
    });
  }

  // ── UI ────────────────────────────────────────────────────────────────────────
  root.innerHTML = `
    <div class="hilo-root" id="hilo-root">
      <div class="hilo-header">
        <button class="ghost" id="hilo-leave" style="padding:6px 14px;font-size:13px;">← Leave</button>
        <div class="hilo-scorebar" id="hilo-scorebar"></div>
        <button id="hilo-vibe-btn" class="ghost" style="font-size:13px;padding:6px 12px;">${haptics.isConnected() ? '📳' : 'Connect Vibe'}</button>
      </div>

      <div class="hilo-arena" id="hilo-arena">
        <div class="hilo-deck-col">
          <div class="hilo-card hilo-card-back" id="hilo-deck-back">
            <span id="hilo-deck-count" class="hilo-deck-count">${deck.length}</span>
          </div>
          <div class="hilo-deck-label">Deck</div>
        </div>
        <div class="hilo-card-col">
          <div id="hilo-current-card" class="hilo-card-slot"></div>
        </div>
      </div>

      <div id="hilo-turn-label" class="hilo-turn-label hilo-turn-me">Higher or Lower?</div>
      <div id="hilo-feedback" class="hilo-feedback"></div>

      <div id="hilo-guess-btns" class="hilo-guess-btns">
        <button id="hilo-higher" class="hilo-guess-btn hilo-higher">▲ Higher</button>
        <button id="hilo-lower"  class="hilo-guess-btn hilo-lower">▼ Lower</button>
      </div>

      <div id="hilo-spacebar-hint" class="hilo-spacebar-hint" style="display:none;">
        Press <kbd>SPACE</kbd> to pause your vibe for 30s — costs 1 life
      </div>
      <div id="hilo-vibe-indicator" class="hilo-vibe-indicator" style="display:none;"></div>

      <div class="hilo-submit-row">
        <button class="ghost" id="hilo-submit-btn" style="font-size:13px;padding:8px 16px;">Tap Out</button>
      </div>

      <div id="hilo-status-bar" class="hilo-status-bar"></div>
    </div>`;

  // ── Renderers ─────────────────────────────────────────────────────────────────
  function cardHtml(card) {
    const red = RED_SUITS.has(card.suit) ? ' hilo-card-red' : '';
    return `
      <div class="hilo-card${red}">
        <div class="hilo-card-corner">${card.name}<br>${card.suit}</div>
        <div class="hilo-card-center">${card.suit}</div>
        <div class="hilo-card-corner hilo-card-corner-br">${card.name}<br>${card.suit}</div>
      </div>`;
  }

  function livesHtml(n) {
    if (n <= 0) return '<span style="color:var(--warn)">✗</span>';
    return '♥'.repeat(Math.min(n, 10));
  }

  function renderState() {
    const sb = document.getElementById('hilo-scorebar');
    if (sb) {
      const peakStr = peakIntensity > 0 ? ` · peak <strong>${Math.round(peakIntensity * 100)}%</strong>` : '';
      sb.innerHTML = `<span class="hilo-score-me">🎯 ${escapeHtml(myName)} ${livesHtml(lives)} <strong>${points}pts</strong>${peakStr}</span>`;
    }

    const dcEl = document.getElementById('hilo-deck-count');
    if (dcEl) dcEl.textContent = deck.length - cardIndex;

    const ccEl = document.getElementById('hilo-current-card');
    if (ccEl && cardIndex < deck.length) ccEl.innerHTML = cardHtml(deck[cardIndex]);

    const sbHint = document.getElementById('hilo-spacebar-hint');
    if (sbHint) sbHint.style.display = (amVibing() && lives > 0 && Date.now() >= pauseUntil) ? 'block' : 'none';

    updateVibeDisplay();
    renderStatusBar();
  }

  function renderStatusBar() {
    const el = document.getElementById('hilo-status-bar');
    if (!el) return;
    const now = Date.now();
    const pauseRem = Math.max(0, (pauseUntil - now) / 1000);
    const isPaused = pauseRem > 0;
    let vibeInfo = '';
    if (isPaused) {
      vibeInfo = `<span class="hilo-sb-paused">Paused ${pauseRem.toFixed(0)}s</span>`;
    } else if (amVibing()) {
      const pct     = Math.round(vibeIntensity * 100);
      const peakPct = Math.round(peakIntensity * 100);
      const peakTag = peakPct > pct ? ` peak ${peakPct}%` : '';
      vibeInfo = `<span class="hilo-sb-vibe">${pct}%${peakTag} · ${vibeCountdown.toFixed(1)}s</span>`;
    }
    el.innerHTML = `
      <div class="hilo-sb-cell hilo-sb-guesser">
        <span class="hilo-sb-name-me">🎯 ${escapeHtml(myName)}</span>
        <span class="hilo-sb-lives">${livesHtml(lives)}</span>
        ${vibeInfo}
      </div>`;
  }

  function updateVibeDisplay() {
    renderStatusBar();
    const viEl = document.getElementById('hilo-vibe-indicator');
    if (!viEl) return;
    const now = Date.now();
    const pauseRem = Math.max(0, (pauseUntil - now) / 1000);
    const isPaused = pauseRem > 0;

    if (isPaused && phase === 'playing') {
      viEl.style.display = 'block';
      viEl.textContent = `Vibe paused — ${pauseRem.toFixed(0)}s left`;
      viEl.style.color = 'var(--muted)';
    } else if (vibeCountdown > 0 && phase === 'playing') {
      viEl.style.display = 'block';
      const pct     = Math.round(vibeIntensity * 100);
      const peakPct = Math.round(peakIntensity * 100);
      const peakTag = peakPct > pct ? ` · peak ${peakPct}%` : '';
      viEl.textContent = `Vibe ${pct}%${peakTag} — ${vibeCountdown.toFixed(1)}s`;
      viEl.style.color = vibeIntensity >= 0.8 ? 'var(--warn)' : 'var(--accent)';
    } else {
      viEl.style.display = 'none';
    }
  }

  let feedbackTimer = null;
  function showFeedback(msg, style) {
    const el = document.getElementById('hilo-feedback');
    if (!el) return;
    el.textContent = msg;
    el.className = `hilo-feedback hilo-feedback-${style || 'neutral'}`;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { if (el) el.textContent = ''; }, 2500);
  }

  // ── DOM events ────────────────────────────────────────────────────────────────
  document.getElementById('hilo-higher').addEventListener('click', () => applyGuess('higher'));
  document.getElementById('hilo-lower').addEventListener('click',  () => applyGuess('lower'));

  const onKeydown = (e) => {
    if (e.code === 'Space' && phase === 'playing') { e.preventDefault(); applySpacebar(); }
  };
  window.addEventListener('keydown', onKeydown);

  document.getElementById('hilo-submit-btn').addEventListener('click', () => {
    if (phase !== 'playing') return;
    showGameOver();
  });

  document.getElementById('hilo-vibe-btn').addEventListener('click', async () => {
    const btn = document.getElementById('hilo-vibe-btn');
    if (haptics.isConnected()) return;
    btn.textContent = 'Connecting…';
    btn.disabled = true;
    try {
      const dev = await haptics.connect();
      btn.textContent = dev ? `📳 ${dev.name}` : 'No device';
      btn.disabled = !!dev;
    } catch {
      btn.textContent = 'Connect Vibe';
      btn.disabled = false;
    }
  });

  document.getElementById('hilo-leave').addEventListener('click', () => {
    state.seed = null;
    navigate(`#/session/${state.sessionId}`);
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────────
  window.addEventListener('hashchange', () => {
    stopVibe();
    clearTimeout(feedbackTimer);
    window.removeEventListener('keydown', onKeydown);
  }, { once: true });

  // ── Initial render ────────────────────────────────────────────────────────────
  renderState();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
