import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';
import { makeRng, rngInt } from '../game/seededRng.js';
import {
  buildDeck, computeVibeDurationMs, buildPowerUpMap, pickStartingRole,
  buildCycleRngs, POWER_UP_LABELS, RED_SUITS,
} from '../game/hiloGame.js';

export function renderHilo(root) {
  const myRole  = state.role;
  const myName  = (myRole === 'host' ? state.hostName : state.guestName) || 'You';
  const oppName = (myRole === 'host' ? state.guestName : state.hostName) || 'Opponent';

  // ── Seeded RNG ──────────────────────────────────────────────────────────────
  const starterRng = makeRng(state.seed);

  // Both clients use same RNG to resolve mode (identical result guaranteed)
  let effectiveCycles;
  const rawMode = state.hiloMode || 'submission';
  if (rawMode === 'fixed') {
    effectiveCycles = state.hiloCycles === 0 ? rngInt(starterRng, 1, 6) : (state.hiloCycles || 1);
  } else if (rawMode === 'random') {
    effectiveCycles = starterRng() < 0.5 ? Infinity : rngInt(starterRng, 1, 6);
  } else {
    effectiveCycles = Infinity; // submission
  }

  const vibeRampStep = (state.hiloVibeRamp || 10) / 100;
  const actualDeckSize = (state.hiloDeckSize === 0)
    ? rngInt(starterRng, 1, 6)
    : (state.hiloDeckSize || 1);
  const cardCount = actualDeckSize * 52;

  // ── Game state ──────────────────────────────────────────────────────────────
  let cycleCount = 0;
  let { deckRng, puRng } = buildCycleRngs(state.seed, cycleCount);
  let deck       = buildDeck(deckRng, actualDeckSize);
  let powerUpMap = buildPowerUpMap(puRng, cardCount);

  let currentRole = pickStartingRole(starterRng);
  let cardIndex   = 0;
  let phase       = 'playing'; // 'playing' | 'roundEnd' | 'forfeit' | 'gameOver'

  const initialLives = state.hiloLives || 3;
  let hostLives  = initialLives;
  let guestLives = initialLives;
  let hostPoints = 0;
  let guestPoints = 0;

  let hostPowerUps  = []; // [{type, uid}]
  let guestPowerUps = [];

  // Per-turn effects (reset on turn switch or round end)
  let vibeIntensity    = 0;
  let vibeCountdown    = 0;   // seconds remaining, tracked on both clients for display
  let vibeCountdownTimer = null;
  let doubleTimeQueued = false;
  let allOrNothingActive = false;
  let freezeActive     = false;
  let peekVisible      = false;

  // Submission mode: play-again handshake
  let myPlayAgainAnswer  = null;
  let oppPlayAgainAnswer = null;

  // Inter-round forfeit
  let forfeitType = null; // 'edge' | 'vibe'
  let edgingRoles = [];   // subset of ['host','guest']

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const isMyTurn  = () => currentRole === myRole;
  const amVibing  = () => currentRole !== myRole && phase === 'playing';
  const getMyLives  = () => myRole === 'host' ? hostLives  : guestLives;
  const getOppLives = () => myRole === 'host' ? guestLives : hostLives;
  const getMyPts    = () => myRole === 'host' ? hostPoints  : guestPoints;
  const getOppPts   = () => myRole === 'host' ? guestPoints : hostPoints;
  const getMyPU     = () => myRole === 'host' ? hostPowerUps  : guestPowerUps;
  const getOppPU    = () => myRole === 'host' ? guestPowerUps : hostPowerUps;

  function setLives(role, val) {
    if (role === 'host') hostLives = Math.max(0, val);
    else guestLives = Math.max(0, val);
  }

  // ── HTML ────────────────────────────────────────────────────────────────────
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
            <span id="hilo-deck-count" class="hilo-deck-count">${cardCount}</span>
          </div>
          <div class="hilo-deck-label">Deck</div>
        </div>
        <div class="hilo-card-col">
          <div id="hilo-current-card" class="hilo-card-slot"></div>
          <div id="hilo-peek-slot" style="display:none;">
            <div class="hilo-peek-label">NEXT (Peek)</div>
            <div id="hilo-peek-card" class="hilo-card-slot"></div>
          </div>
        </div>
      </div>

      <div id="hilo-turn-label" class="hilo-turn-label"></div>
      <div id="hilo-feedback" class="hilo-feedback"></div>

      <div id="hilo-guess-btns" class="hilo-guess-btns" style="display:none;">
        <button id="hilo-higher" class="hilo-guess-btn hilo-higher">▲ Higher</button>
        <button id="hilo-lower"  class="hilo-guess-btn hilo-lower">▼ Lower</button>
      </div>

      <div id="hilo-spacebar-hint" class="hilo-spacebar-hint" style="display:none;">
        Press <kbd>SPACE</kbd> to stop vibe — costs 1 life
      </div>
      <div id="hilo-freeze-notice" class="hilo-freeze-notice" style="display:none;">
        ❄️ Frozen — spacebar disabled this round
      </div>
      <div id="hilo-vibe-indicator" class="hilo-vibe-indicator" style="display:none;"></div>

      <div id="hilo-powerups" class="hilo-powerups"></div>

      <div class="hilo-submit-row">
        <button class="ghost" id="hilo-submit-btn" style="font-size:13px;padding:8px 16px;">Tap Out</button>
      </div>
    </div>`;

  // ── Card renderers ──────────────────────────────────────────────────────────
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

  // ── renderState ─────────────────────────────────────────────────────────────
  function renderState() {
    if (phase !== 'playing') return;

    const sb = document.getElementById('hilo-scorebar');
    if (sb) {
      sb.innerHTML =
        `<span class="hilo-score-me">${escapeHtml(myName)} ${livesHtml(getMyLives())} <strong>${getMyPts()}pts</strong></span>` +
        `<span class="hilo-score-sep">vs</span>` +
        `<span class="hilo-score-opp"><strong>${getOppPts()}pts</strong> ${livesHtml(getOppLives())} ${escapeHtml(oppName)}</span>`;
    }

    const remaining = deck.length - cardIndex;
    const dcEl = document.getElementById('hilo-deck-count');
    if (dcEl) dcEl.textContent = remaining;

    const ccEl = document.getElementById('hilo-current-card');
    if (ccEl && cardIndex < deck.length) ccEl.innerHTML = cardHtml(deck[cardIndex]);

    const peekSlot = document.getElementById('hilo-peek-slot');
    const peekCard = document.getElementById('hilo-peek-card');
    if (peekSlot && peekCard) {
      const showPeek = peekVisible && isMyTurn() && cardIndex + 1 < deck.length;
      peekSlot.style.display = showPeek ? 'block' : 'none';
      if (showPeek) peekCard.innerHTML = cardHtml(deck[cardIndex + 1]);
    }

    const tl = document.getElementById('hilo-turn-label');
    if (tl) {
      if (isMyTurn()) {
        tl.textContent = allOrNothingActive
          ? 'Your turn ⚡ All or Nothing active!'
          : 'Your turn — Higher or Lower?';
        tl.className = 'hilo-turn-label hilo-turn-me';
      } else {
        tl.textContent = allOrNothingActive
          ? `${escapeHtml(oppName)}'s turn ⚡ All or Nothing!`
          : `${escapeHtml(oppName)}'s turn`;
        tl.className = 'hilo-turn-label hilo-turn-opp';
      }
    }

    const gbtns = document.getElementById('hilo-guess-btns');
    if (gbtns) gbtns.style.display = isMyTurn() ? 'flex' : 'none';

    const sbHint = document.getElementById('hilo-spacebar-hint');
    if (sbHint) sbHint.style.display = (amVibing() && getMyLives() > 0 && !freezeActive) ? 'block' : 'none';

    const fNotice = document.getElementById('hilo-freeze-notice');
    if (fNotice) fNotice.style.display = (amVibing() && freezeActive) ? 'block' : 'none';

    updateVibeDisplay();

    renderPowerUps();
  }

  function renderPowerUps() {
    const el = document.getElementById('hilo-powerups');
    if (!el) return;

    let html = '';
    const myPU  = getMyPU();
    const oppPU = getOppPU();

    if (myPU.length > 0) {
      html += `<div class="hilo-pu-section"><div class="hilo-pu-label">Your power-ups</div><div class="hilo-pu-btns" id="hilo-my-pu-btns">`;
      myPU.forEach((pu, idx) => {
        const ok = isPowerUpUsable(pu.type);
        html += `<button class="hilo-pu-btn${ok ? '' : ' hilo-pu-disabled'}" data-pu-idx="${idx}" data-pu-type="${pu.type}" ${ok ? '' : 'disabled'} title="${escapeHtml(puTooltip(pu.type))}">${escapeHtml(POWER_UP_LABELS[pu.type])}</button>`;
      });
      html += `</div></div>`;
    }

    if (oppPU.length > 0) {
      html += `<div class="hilo-pu-section"><div class="hilo-pu-label" style="color:var(--muted)">${escapeHtml(oppName)}: ${oppPU.map(p => escapeHtml(POWER_UP_LABELS[p.type])).join(', ')}</div></div>`;
    }

    el.innerHTML = html;

    document.getElementById('hilo-my-pu-btns')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pu-idx]');
      if (!btn || btn.disabled) return;
      usePowerUp(btn.dataset.puType, parseInt(btn.dataset.puIdx, 10));
    });
  }

  function isPowerUpUsable(type) {
    if (phase !== 'playing') return false;
    if (type === 'freeLife') return true;
    if (type === 'doubleTime') return isMyTurn() && !doubleTimeQueued;
    if (type === 'allOrNothing') return isMyTurn() && !allOrNothingActive;
    if (type === 'peek') return isMyTurn() && !peekVisible && cardIndex + 1 < deck.length;
    if (type === 'skip') return isMyTurn() && cardIndex + 1 < deck.length;
    if (type === 'freeze') return isMyTurn() && !freezeActive;
    return false;
  }

  function puTooltip(type) {
    return {
      doubleTime:   'Before your next guess — doubles vibe duration if correct',
      freeLife:     'Gain an extra life immediately',
      allOrNothing: 'If opponent presses spacebar this round, they lose ALL lives',
      peek:         'Reveal the next card — guarantees a correct guess',
      skip:         'Skip this card without penalty or mistake',
      freeze:       'Opponent cannot press spacebar for the rest of this round',
    }[type] || '';
  }

  // ── Vibe helpers ─────────────────────────────────────────────────────────────
  function addVibeForCard(cardValue, durationMult) {
    const durSecs = computeVibeDurationMs(cardValue) / 1000 * (durationMult || 1);
    vibeCountdown += durSecs;
    if (!vibeCountdownTimer) {
      vibeCountdownTimer = setInterval(() => {
        vibeCountdown = Math.max(0, vibeCountdown - 0.1);
        if (vibeCountdown <= 0) { clearInterval(vibeCountdownTimer); vibeCountdownTimer = null; }
        updateVibeDisplay();
      }, 100);
    }
    // Only the vibing player's device gets haptics
    if (currentRole !== myRole && haptics.isConnected()) {
      haptics.setForfeitIntensity(vibeIntensity);
      haptics.addForfeitSeconds(durSecs);
    }
  }

  function stopHiloVibe() {
    vibeCountdown = 0;
    if (vibeCountdownTimer) { clearInterval(vibeCountdownTimer); vibeCountdownTimer = null; }
    haptics.stopAll();
  }

  function updateVibeDisplay() {
    const viEl = document.getElementById('hilo-vibe-indicator');
    if (!viEl) return;
    if (vibeCountdown > 0 && phase === 'playing') {
      viEl.style.display = 'block';
      const secs = vibeCountdown.toFixed(1);
      const pct = Math.round(vibeIntensity * 100);
      viEl.textContent = amVibing()
        ? `Vibe ${pct}% — ${secs}s remaining`
        : `Opponent vibing ${pct}% — ${secs}s remaining`;
      viEl.style.color = vibeIntensity >= 0.8 ? 'var(--warn)' : 'var(--accent)';
    } else {
      viEl.style.display = 'none';
    }
  }

  // ── Core game logic ──────────────────────────────────────────────────────────
  function applyGuess(guess) {
    if (phase !== 'playing') return;
    if (cardIndex + 1 >= deck.length) { endRound(); return; }

    const card     = deck[cardIndex];
    const nextCard = deck[cardIndex + 1];

    const correct = guess === 'higher'
      ? nextCard.value > card.value
      : nextCard.value < card.value;

    if (correct) {
      if (currentRole === 'host') hostPoints++;
      else guestPoints++;

      vibeIntensity = Math.min(1.0, vibeIntensity + vibeRampStep);
      const mult = doubleTimeQueued ? 2 : 1;
      doubleTimeQueued = false;
      addVibeForCard(card.value, mult);

      cardIndex++;
      peekVisible = false;

      // Award power-up if this card index is a trigger position
      if (powerUpMap.has(cardIndex)) {
        const puType = powerUpMap.get(cardIndex);
        const inv = currentRole === 'host' ? hostPowerUps : guestPowerUps;
        inv.push({ type: puType, uid: Math.random() });
        showFeedback(`🎁 ${currentRole === myRole ? 'You' : escapeHtml(oppName)} got: ${POWER_UP_LABELS[puType]}!`, 'accent');
      }

      if (cardIndex >= deck.length - 1) { stopHiloVibe(); endRound(); return; }
      showFeedback('✓ Correct!', 'accent');

    } else {
      stopHiloVibe();
      vibeIntensity = 0;
      doubleTimeQueued = false;
      allOrNothingActive = false;
      freezeActive = false;
      peekVisible = false;
      cardIndex++;

      if (cardIndex >= deck.length - 1) { endRound(); return; }

      currentRole = currentRole === 'host' ? 'guest' : 'host';
      vibeIntensity = 0;
      showFeedback('✗ Wrong — turn switches', 'warn');
    }

    renderState();
  }

  function applySpacebar() {
    if (phase !== 'playing') return;
    const vibingRole = currentRole === 'host' ? 'guest' : 'host';

    if (allOrNothingActive) {
      setLives(vibingRole, 0);
      showFeedback('⚡ All or Nothing triggered — all lives lost!', 'warn');
    } else {
      setLives(vibingRole, (vibingRole === 'host' ? hostLives : guestLives) - 1);
    }

    allOrNothingActive = false;
    vibeIntensity = 0;
    stopHiloVibe();
    renderState();
  }

  function applyPowerUpUse(type, fromRole) {
    const inv = fromRole === 'host' ? hostPowerUps : guestPowerUps;
    const idx = inv.findIndex(p => p.type === type);
    if (idx === -1) return;
    inv.splice(idx, 1);

    switch (type) {
      case 'freeLife':
        setLives(fromRole, (fromRole === 'host' ? hostLives : guestLives) + 1);
        showFeedback(`${fromRole === myRole ? 'You' : escapeHtml(oppName)} gained a life!`, 'accent');
        break;
      case 'doubleTime':
        doubleTimeQueued = true;
        showFeedback('⏱ Double Time queued for next guess', 'accent');
        break;
      case 'allOrNothing':
        allOrNothingActive = true;
        showFeedback('⚡ All or Nothing activated!', 'warn');
        break;
      case 'peek':
        if (fromRole === myRole) peekVisible = true;
        break;
      case 'skip':
        cardIndex++;
        peekVisible = false;
        showFeedback('⏭ Card skipped', 'accent');
        if (cardIndex >= deck.length - 1) { endRound(); return; }
        break;
      case 'freeze':
        freezeActive = true;
        showFeedback('❄️ Freeze! Opponent cannot stop the vibe this round', 'accent');
        break;
    }

    renderState();
  }

  function endRound() {
    stopHiloVibe();
    vibeIntensity = 0;
    cycleCount++;
    phase = 'roundEnd';
    resetTurnEffects();

    if (effectiveCycles !== Infinity && cycleCount >= effectiveCycles) {
      showGameOver(null);
    } else {
      showRoundEnd();
    }
  }

  function resetTurnEffects() {
    doubleTimeQueued   = false;
    allOrNothingActive = false;
    freezeActive       = false;
    peekVisible        = false;
  }

  // ── Feedback ────────────────────────────────────────────────────────────────
  let feedbackTimer = null;
  function showFeedback(msg, style) {
    const el = document.getElementById('hilo-feedback');
    if (!el) return;
    el.textContent = msg;
    el.className = `hilo-feedback hilo-feedback-${style || 'neutral'}`;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { if (el) el.textContent = ''; }, 2500);
  }

  function hideGameplay() {
    document.getElementById('hilo-arena').style.display = 'none';
    document.getElementById('hilo-guess-btns').style.display = 'none';
    document.getElementById('hilo-spacebar-hint').style.display = 'none';
    document.getElementById('hilo-freeze-notice').style.display = 'none';
    document.getElementById('hilo-vibe-indicator').style.display = 'none';
    document.getElementById('hilo-powerups').innerHTML = '';
    document.getElementById('hilo-turn-label').textContent = '';
    document.getElementById('hilo-feedback').textContent = '';
    root.querySelector('.hilo-submit-row').style.display = 'none';
  }

  function showGameplay() {
    document.getElementById('hilo-arena').style.display = '';
    root.querySelector('.hilo-submit-row').style.display = '';
  }

  // ── Round-end overlay ────────────────────────────────────────────────────────
  function showRoundEnd() {
    hideGameplay();

    const myPts  = getMyPts();
    const oppPts = getOppPts();
    const leadText = myPts > oppPts
      ? `<span style="color:var(--accent)">You are winning!</span>`
      : myPts < oppPts
        ? `<span style="color:var(--warn)">${escapeHtml(oppName)} is winning!</span>`
        : `<span style="color:var(--muted)">Tied!</span>`;

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
            <div class="hilo-round-score-lives">${livesHtml(getMyLives())}</div>
            <div class="hilo-round-score-pts">${myPts} pts</div>
          </div>
          <div class="hilo-round-score-cell">
            <div class="hilo-round-score-name">${escapeHtml(oppName)}</div>
            <div class="hilo-round-score-lives">${livesHtml(getOppLives())}</div>
            <div class="hilo-round-score-pts">${oppPts} pts</div>
          </div>
        </div>
        <p style="text-align:center;margin:8px 0 16px;">${leadText}</p>
        <p style="text-align:center;font-size:14px;color:var(--muted);">Play another round?</p>
        <div style="display:flex;gap:12px;justify-content:center;margin-top:8px;">
          <button id="hilo-stop-btn" class="ghost">Stop</button>
          <button id="hilo-continue-btn">Continue</button>
        </div>
        <div id="hilo-pa-status" style="margin-top:12px;text-align:center;font-size:13px;color:var(--muted);min-height:18px;"></div>
      </div>`;
    root.appendChild(ov);

    document.getElementById('hilo-stop-btn').addEventListener('click', () => {
      if (myPlayAgainAnswer !== null) return;
      myPlayAgainAnswer = false;
      socket.send({ type: MSG.HILO_PLAY_AGAIN, confirm: false });
      showGameOver(null);
    });

    document.getElementById('hilo-continue-btn').addEventListener('click', () => {
      if (myPlayAgainAnswer !== null) return;
      myPlayAgainAnswer = true;
      socket.send({ type: MSG.HILO_PLAY_AGAIN, confirm: true });
      document.getElementById('hilo-continue-btn').disabled = true;
      document.getElementById('hilo-continue-btn').textContent = 'Waiting…';
      document.getElementById('hilo-pa-status').textContent = `Waiting for ${escapeHtml(oppName)}…`;
      checkBothPlayAgain();
    });
  }

  function checkBothPlayAgain() {
    if (myPlayAgainAnswer === false || oppPlayAgainAnswer === false) {
      showGameOver(null);
    } else if (myPlayAgainAnswer === true && oppPlayAgainAnswer === true) {
      startInterRoundForfeit();
    }
  }

  // ── Inter-round forfeit ──────────────────────────────────────────────────────
  function startInterRoundForfeit() {
    document.getElementById('hilo-round-end-overlay')?.remove();

    // Same seed → same forfeit type and edge assignment on both clients
    const fr = makeRng(((state.seed * 13 + cycleCount * 5) | 0) >>> 0);
    forfeitType = fr() < 0.5 ? 'edge' : 'vibe';

    if (forfeitType === 'edge') {
      if (hostLives > guestLives) edgingRoles = ['host'];
      else if (guestLives > hostLives) edgingRoles = ['guest'];
      else edgingRoles = ['host', 'guest'];
    }

    phase = 'forfeit';
    showForfeitOverlay();
  }

  function showForfeitOverlay() {
    document.getElementById('hilo-forfeit-overlay')?.remove();

    const ov = document.createElement('div');
    ov.id = 'hilo-forfeit-overlay';
    ov.className = 'hilo-overlay';

    if (forfeitType === 'edge') {
      const iAmEdging = edgingRoles.includes(myRole);
      let whoMsg;
      if (edgingRoles.length === 2) {
        whoMsg = 'Both players are edging';
      } else {
        whoMsg = edgingRoles[0] === myRole ? 'You are edging' : `${escapeHtml(oppName)} is edging`;
      }

      ov.innerHTML = `
        <div class="hilo-overlay-box">
          <p class="hilo-forfeit-flavour">For failing to make the other player submit you will suffer</p>
          <h2 style="text-align:center;margin:8px 0;">Edge Forfeit</h2>
          <p style="text-align:center;font-size:16px;margin:0 0 24px;">${whoMsg}</p>
          ${iAmEdging
            ? `<button id="hilo-forfeit-ready-btn" style="display:block;margin:0 auto;">Ready ✓</button>`
            : `<p id="hilo-forfeit-waiting" style="text-align:center;color:var(--muted);font-size:14px;">Waiting for ${escapeHtml(oppName)}…</p>`}
        </div>`;

      root.appendChild(ov);
      ov.querySelector('#hilo-forfeit-ready-btn')?.addEventListener('click', () => {
        haptics.stopAll();
        socket.send({ type: MSG.HILO_VIBE_STOP });
        startNextCycle();
      });

    } else {
      // Shared vibe forfeit
      ov.innerHTML = `
        <div class="hilo-overlay-box">
          <p class="hilo-forfeit-flavour">For failing to make the other player submit you will suffer</p>
          <h2 style="text-align:center;margin:8px 0;">Vibe Forfeit</h2>
          <p style="text-align:center;font-size:14px;color:var(--muted);margin:0 0 16px;">Both players vibe — click Ready when you want to continue</p>
          <div class="forfeit-slider-row" style="margin-bottom:16px;">
            <span>Intensity</span>
            <input type="range" id="hilo-shared-slider" min="0" max="100" value="50" style="flex:1;margin:0 12px;accent-color:var(--warn);">
            <span id="hilo-shared-pct">50%</span>
          </div>
          <button id="hilo-forfeit-ready-btn" style="display:block;margin:0 auto;">Ready ✓</button>
        </div>`;

      root.appendChild(ov);

      if (haptics.isConnected()) haptics.testVibe(0.5);

      const slider = ov.querySelector('#hilo-shared-slider');
      const pct    = ov.querySelector('#hilo-shared-pct');

      slider.addEventListener('input', () => {
        const level = slider.value / 100;
        pct.textContent = `${slider.value}%`;
        if (haptics.isConnected()) haptics.testVibe(level);
        socket.send({ type: MSG.HILO_VIBE_LEVEL, level });
      });

      ov.querySelector('#hilo-forfeit-ready-btn').addEventListener('click', () => {
        haptics.stopAll();
        socket.send({ type: MSG.HILO_VIBE_STOP });
        startNextCycle();
      });
    }
  }

  function startNextCycle() {
    stopHiloVibe();
    document.getElementById('hilo-round-end-overlay')?.remove();
    document.getElementById('hilo-forfeit-overlay')?.remove();

    const assets = buildCycleRngs(state.seed, cycleCount);
    deck       = buildDeck(assets.deckRng, actualDeckSize);
    powerUpMap = buildPowerUpMap(assets.puRng, cardCount);
    cardIndex  = 0;
    vibeIntensity = 0;
    myPlayAgainAnswer  = null;
    oppPlayAgainAnswer = null;
    forfeitType  = null;
    edgingRoles  = [];
    phase = 'playing';
    resetTurnEffects();

    showGameplay();
    renderState();
    showFeedback('New round!', 'accent');
  }

  // ── Game over ────────────────────────────────────────────────────────────────
  // cause: null (normal end / stop), 'i_submitted', 'opp_submitted'
  function showGameOver(cause) {
    if (phase === 'gameOver') return;
    stopHiloVibe();
    phase = 'gameOver';
    document.getElementById('hilo-round-end-overlay')?.remove();
    document.getElementById('hilo-forfeit-overlay')?.remove();
    hideGameplay();

    const myPts  = getMyPts();
    const oppPts = getOppPts();
    let resultHtml;
    if (cause === 'opp_submitted') {
      resultHtml = `<p style="color:var(--accent);font-size:18px;font-weight:700;">${escapeHtml(oppName)} tapped out — You Win!</p>`;
    } else if (cause === 'i_submitted') {
      resultHtml = `<p style="color:var(--warn);font-size:18px;font-weight:700;">You tapped out — ${escapeHtml(oppName)} wins!</p>`;
    } else if (myPts > oppPts) {
      resultHtml = `<p style="color:var(--accent);font-size:18px;font-weight:700;">You Win!</p>`;
    } else if (myPts < oppPts) {
      resultHtml = `<p style="color:var(--warn);font-size:18px;font-weight:700;">You Lose!</p>`;
    } else {
      resultHtml = `<p style="font-size:18px;font-weight:700;">It's a Draw!</p>`;
    }

    document.getElementById('hilo-scorebar').innerHTML = '';

    const ov = document.createElement('div');
    ov.className = 'hilo-overlay';
    ov.innerHTML = `
      <div class="hilo-overlay-box">
        <h2>Game Over</h2>
        ${resultHtml}
        <div class="hilo-round-scores" style="margin:16px 0;">
          <div class="hilo-round-score-cell">
            <div class="hilo-round-score-name">${escapeHtml(myName)}</div>
            <div class="hilo-round-score-pts" style="font-size:32px;">${myPts}</div>
            <div style="font-size:12px;color:var(--muted);">points</div>
          </div>
          <div class="hilo-round-score-cell">
            <div class="hilo-round-score-name">${escapeHtml(oppName)}</div>
            <div class="hilo-round-score-pts" style="font-size:32px;">${oppPts}</div>
            <div style="font-size:12px;color:var(--muted);">points</div>
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

  // ── My action handlers ────────────────────────────────────────────────────────
  function handleMyGuess(guess) {
    if (!isMyTurn() || phase !== 'playing') return;
    socket.send({ type: MSG.HILO_GUESS, guess });
    applyGuess(guess);
  }

  function handleMySpacebar() {
    if (!amVibing() || phase !== 'playing') return;
    if (getMyLives() <= 0) return;
    if (freezeActive) { showFeedback('❄️ Frozen — spacebar blocked!', 'warn'); return; }
    socket.send({ type: MSG.HILO_SPACEBAR });
    applySpacebar();
  }

  function usePowerUp(type, idx) {
    const inv = getMyPU();
    if (idx >= inv.length || inv[idx].type !== type) return;
    socket.send({ type: MSG.HILO_POWERUP_USE, powerUpType: type });
    applyPowerUpUse(type, myRole);
  }

  // ── Socket event handlers ─────────────────────────────────────────────────────
  const onHiloGuess      = (ev) => applyGuess(ev.detail.guess);
  const onHiloSpacebar   = () => applySpacebar();
  const onHiloPowerUpUse = (ev) => {
    const oppRole = myRole === 'host' ? 'guest' : 'host';
    applyPowerUpUse(ev.detail.powerUpType, oppRole);
  };
  const onHiloSubmit = () => showGameOver('opp_submitted');

  const onHiloPlayAgain = (ev) => {
    oppPlayAgainAnswer = ev.detail.confirm;
    const statusEl = document.getElementById('hilo-pa-status');
    if (statusEl) statusEl.textContent = ev.detail.confirm ? `${escapeHtml(oppName)} wants to continue!` : `${escapeHtml(oppName)} stopped.`;
    checkBothPlayAgain();
  };

  const onHiloVibeLevel = (ev) => {
    const slider = document.getElementById('hilo-shared-slider');
    const pct    = document.getElementById('hilo-shared-pct');
    const level  = ev.detail.level;
    if (slider) slider.value = Math.round(level * 100);
    if (pct) pct.textContent = `${Math.round(level * 100)}%`;
    if (haptics.isConnected()) haptics.testVibe(level);
  };

  const onHiloVibeStop = () => {
    if (phase !== 'forfeit') return;
    haptics.stopAll();
    startNextCycle();
  };

  const onPeerLeft = () => {
    stopHiloVibe();
    root.innerHTML = `
      <div class="card">
        <h2>Opponent left</h2>
        <div class="actions"><button onclick="location.hash='#/'">Home</button></div>
      </div>`;
  };

  socket.addEventListener(MSG.HILO_GUESS,       onHiloGuess);
  socket.addEventListener(MSG.HILO_SPACEBAR,    onHiloSpacebar);
  socket.addEventListener(MSG.HILO_POWERUP_USE, onHiloPowerUpUse);
  socket.addEventListener(MSG.HILO_SUBMIT,      onHiloSubmit);
  socket.addEventListener(MSG.HILO_PLAY_AGAIN,  onHiloPlayAgain);
  socket.addEventListener(MSG.HILO_VIBE_LEVEL,  onHiloVibeLevel);
  socket.addEventListener(MSG.HILO_VIBE_STOP,   onHiloVibeStop);
  socket.addEventListener(MSG.PEER_LEFT,        onPeerLeft);

  // ── DOM event handlers ────────────────────────────────────────────────────────
  document.getElementById('hilo-higher').addEventListener('click', () => handleMyGuess('higher'));
  document.getElementById('hilo-lower').addEventListener('click',  () => handleMyGuess('lower'));

  const onKeydown = (e) => {
    if (e.code === 'Space' && phase === 'playing') { e.preventDefault(); handleMySpacebar(); }
  };
  window.addEventListener('keydown', onKeydown);

  document.getElementById('hilo-submit-btn').addEventListener('click', () => {
    if (phase !== 'playing') return;
    socket.send({ type: MSG.HILO_SUBMIT });
    showGameOver('i_submitted');
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

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  window.addEventListener('hashchange', () => {
    stopHiloVibe();
    clearTimeout(feedbackTimer);
    window.removeEventListener('keydown', onKeydown);
    socket.removeEventListener(MSG.HILO_GUESS,       onHiloGuess);
    socket.removeEventListener(MSG.HILO_SPACEBAR,    onHiloSpacebar);
    socket.removeEventListener(MSG.HILO_POWERUP_USE, onHiloPowerUpUse);
    socket.removeEventListener(MSG.HILO_SUBMIT,      onHiloSubmit);
    socket.removeEventListener(MSG.HILO_PLAY_AGAIN,  onHiloPlayAgain);
    socket.removeEventListener(MSG.HILO_VIBE_LEVEL,  onHiloVibeLevel);
    socket.removeEventListener(MSG.HILO_VIBE_STOP,   onHiloVibeStop);
    socket.removeEventListener(MSG.PEER_LEFT,        onPeerLeft);
  }, { once: true });

  // ── Initial render ────────────────────────────────────────────────────────────
  renderState();
  showFeedback(isMyTurn() ? 'You go first!' : `${escapeHtml(oppName)} goes first`, 'accent');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
