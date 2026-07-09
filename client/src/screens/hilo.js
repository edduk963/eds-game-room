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
  const myRole      = state.role;
  const playerCount = state.playerCount || 2;
  const playerRoles = playerCount === 3 ? ['host', 'guest', 'guest2'] : ['host', 'guest'];
  const playerNames = {
    host:   state.hostName   || 'Host',
    guest:  state.guestName  || 'Guest',
    guest2: state.guest2Name || 'Player 3',
  };
  const myName  = playerNames[myRole];
  const oppName = playerCount === 2
    ? (myRole === 'host' ? playerNames.guest : playerNames.host)
    : null;

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

  const initialLives    = state.hiloLives || 3;
  const vibeTargetMode  = state.hiloVibeTarget || 'both';

  const lives    = { host: initialLives, guest: initialLives, guest2: initialLives };
  const points   = { host: 0, guest: 0, guest2: 0 };
  const powerUps = { host: [], guest: [], guest2: [] };

  // Per-turn effects (reset on turn switch or round end)
  let vibeIntensity    = 0;
  let vibeCountdown    = 0;
  let vibeCountdownTimer = null;
  let vibeTargets      = []; // roles currently being vibed
  const spacePauseUntil = { host: 0, guest: 0, guest2: 0 }; // wall-clock timestamp when each player's spacebar pause expires
  let doubleTimeQueued = false;
  let allOrNothingActive = false;
  let freezeActive     = false;
  let peekVisible      = false;
  let chainActive      = false;
  let mirrorActive     = false;
  const shielded       = { host: false, guest: false, guest2: false };

  // Play-again handshake (all players)
  const playAgainAnswers = {};

  // Wave mode (host-controlled, affects all players)
  let waveModeEnabled = false;

  // Inter-round forfeit
  let forfeitType = null; // 'edge' | 'vibe'
  let edgingRoles = [];
  const vibeStopAcks = new Set();

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const getLives    = (role) => lives[role] ?? 0;
  const setLives    = (role, val) => { lives[role] = Math.max(0, val); };
  const getMyLives  = () => getLives(myRole);
  const getMyPts    = () => points[myRole];
  const getMyPU     = () => powerUps[myRole];
  const isMyTurn    = () => currentRole === myRole;
  const amVibing    = () => vibeTargets.includes(myRole) && phase === 'playing' && vibeCountdown > 0;

  function computeVibeTargets() {
    const now = Date.now();
    // Non-guessers who are not currently in a spacebar pause window
    const eligible = playerRoles.filter(r => r !== currentRole && now >= spacePauseUntil[r]);
    if (eligible.length === 0) return [];
    if (playerCount === 2 || vibeTargetMode === 'both') return eligible;
    if (vibeTargetMode === 'highest_lives') {
      const maxLives = Math.max(...eligible.map(r => getLives(r)));
      return eligible.filter(r => getLives(r) === maxLives);
    }
    if (vibeTargetMode === 'random') {
      const h = ((state.seed ^ (cycleCount * 0x9e3779b9 | 0)) ^ (cardIndex * 0x517cc1b7 | 0)) >>> 0;
      if (eligible.length === 1) return eligible;
      const pick = h % 3;
      if (pick === 0) return [eligible[0]];
      if (pick === 1) return [eligible[1]];
      return eligible;
    }
    return eligible;
  }

  // ── HTML ────────────────────────────────────────────────────────────────────
  root.innerHTML = `
    <div class="hilo-root" id="hilo-root">
      <div class="hilo-header">
        <button class="ghost" id="hilo-leave" style="padding:6px 14px;font-size:13px;">← Leave</button>
        <div class="hilo-scorebar" id="hilo-scorebar"></div>
        <button id="hilo-vibe-btn" class="ghost" style="font-size:13px;padding:6px 12px;">${haptics.isConnected() ? '📳' : 'Connect Vibe'}</button>
        ${myRole === 'host' ? `<button id="hilo-wave-btn" class="ghost" style="font-size:13px;padding:6px 12px;" title="Toggle vibe variation for all players">〰 Variation: Off</button>` : ''}
      </div>
      <div id="hilo-disconnect-wrap"></div>

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
        Press <kbd>SPACE</kbd> to pause your vibe for 30s — costs 1 life
      </div>
      <div id="hilo-freeze-notice" class="hilo-freeze-notice" style="display:none;">
        ❄️ Frozen — spacebar disabled this round
      </div>
      <div id="hilo-vibe-indicator" class="hilo-vibe-indicator" style="display:none;"></div>
      <div id="hilo-vibe-targets" class="hilo-vibe-indicator" style="display:none;font-size:12px;color:var(--muted);margin-top:2px;"></div>

      <div id="hilo-powerups" class="hilo-powerups"></div>

      <div class="hilo-submit-row">
        <button class="ghost" id="hilo-submit-btn" style="font-size:13px;padding:8px 16px;">Tap Out</button>
      </div>

      <div id="hilo-status-bar" class="hilo-status-bar"></div>
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
    renderStatusBar();
    if (phase !== 'playing') return;

    const sb = document.getElementById('hilo-scorebar');
    if (sb) {
      if (playerCount === 2) {
        const oppRole2 = myRole === 'host' ? 'guest' : 'host';
        sb.innerHTML =
          `<span class="hilo-score-me">${escapeHtml(myName)} ${livesHtml(getMyLives())} <strong>${getMyPts()}pts</strong></span>` +
          `<span class="hilo-score-sep">vs</span>` +
          `<span class="hilo-score-opp"><strong>${points[oppRole2]}pts</strong> ${livesHtml(getLives(oppRole2))} ${escapeHtml(playerNames[oppRole2])}</span>`;
      } else {
        sb.innerHTML = playerRoles.map(r => {
          const isGuesser = r === currentRole;
          const cls = r === myRole ? 'hilo-score-me' : 'hilo-score-opp';
          return `<span class="${cls}">${isGuesser ? '🎯 ' : ''}${escapeHtml(playerNames[r])} ${livesHtml(getLives(r))} <strong>${points[r]}pts</strong></span>`;
        }).join('<span class="hilo-score-sep">·</span>');
      }
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
        const guesserName = escapeHtml(playerNames[currentRole]);
        tl.textContent = allOrNothingActive
          ? `${guesserName}'s turn ⚡ All or Nothing!`
          : `${guesserName}'s turn`;
        tl.className = 'hilo-turn-label hilo-turn-opp';
      }
    }

    const gbtns = document.getElementById('hilo-guess-btns');
    if (gbtns) gbtns.style.display = (isMyTurn() && !mirrorActive) ? 'flex' : 'none';

    const sbHint = document.getElementById('hilo-spacebar-hint');
    if (sbHint) {
      if (mirrorActive && vibeTargets.includes(myRole)) {
        sbHint.style.display = 'block';
        sbHint.innerHTML = 'Press <kbd>SPACE</kbd> to break the mirror for everyone — costs 1 life';
      } else if (amVibing() && getMyLives() > 0 && !freezeActive) {
        sbHint.style.display = 'block';
        sbHint.innerHTML = 'Press <kbd>SPACE</kbd> to pause your vibe for 30s — costs 1 life';
      } else {
        sbHint.style.display = 'none';
      }
    }

    const fNotice = document.getElementById('hilo-freeze-notice');
    if (fNotice) fNotice.style.display = (amVibing() && freezeActive && !mirrorActive) ? 'block' : 'none';

    // 3-player: show who's currently being vibed (non-me targets)
    const vibeRoleInfo = document.getElementById('hilo-vibe-targets');
    if (vibeRoleInfo && playerCount === 3 && vibeTargets.length > 0 && phase === 'playing') {
      const names = vibeTargets.map(r => escapeHtml(playerNames[r])).join(' & ');
      vibeRoleInfo.textContent = `Vibing: ${names}`;
      vibeRoleInfo.style.display = 'block';
    } else if (vibeRoleInfo) {
      vibeRoleInfo.style.display = 'none';
    }

    updateVibeDisplay();

    renderPowerUps();
  }

  function renderPowerUps() {
    const el = document.getElementById('hilo-powerups');
    if (!el) return;

    let html = '';
    const myPU = getMyPU();

    if (myPU.length > 0) {
      html += `<div class="hilo-pu-section"><div class="hilo-pu-label">Your power-ups</div><div class="hilo-pu-btns" id="hilo-my-pu-btns">`;
      myPU.forEach((pu, idx) => {
        const ok = isPowerUpUsable(pu.type);
        html += `<button class="hilo-pu-btn${ok ? '' : ' hilo-pu-disabled'}" data-pu-idx="${idx}" data-pu-type="${pu.type}" ${ok ? '' : 'disabled'} title="${escapeHtml(puTooltip(pu.type))}">${escapeHtml(POWER_UP_LABELS[pu.type])}</button>`;
      });
      html += `</div></div>`;
    }

    for (const r of playerRoles.filter(r => r !== myRole)) {
      const oppPU = powerUps[r];
      if (oppPU.length > 0) {
        html += `<div class="hilo-pu-section"><div class="hilo-pu-label" style="color:var(--muted)">${escapeHtml(playerNames[r])}: ${oppPU.map(p => escapeHtml(POWER_UP_LABELS[p.type])).join(', ')}</div></div>`;
      }
    }

    el.innerHTML = html;

    document.getElementById('hilo-my-pu-btns')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pu-idx]');
      if (!btn || btn.disabled) return;
      usePowerUp(btn.dataset.puType, parseInt(btn.dataset.puIdx, 10));
    });
  }

  // Parameterized so the same turn/phase rules can validate a *remote* powerup
  // use (applyPowerUpUse) as well as gating the local player's own buttons.
  function isPowerUpUsableBy(type, r) {
    if (phase !== 'playing') return false;
    const myTurn = r === currentRole;
    if (type === 'freeLife')      return true;
    if (type === 'doubleTime')    return myTurn && !doubleTimeQueued;
    if (type === 'allOrNothing')  return myTurn && !allOrNothingActive;
    if (type === 'peek')          return myTurn && !peekVisible && cardIndex + 1 < deck.length;
    if (type === 'skip')          return myTurn && cardIndex + 1 < deck.length;
    if (type === 'freeze')        return myTurn && !freezeActive && vibeTargets.length > 0;
    if (type === 'surge')         return myTurn;
    if (type === 'chain')         return myTurn && playerCount === 3 && !chainActive;
    if (type === 'maxIntensity')  return myTurn && vibeCountdown > 0 && vibeTargets.length > 0;
    if (type === 'shield')        return !shielded[r];
    if (type === 'mirror')        return !myTurn && vibeCountdown > 0 && !mirrorActive;
    if (type === 'deflect')       return !myTurn && vibeCountdown > 0 && vibeTargets.includes(r);
    return false;
  }
  function isPowerUpUsable(type) { return isPowerUpUsableBy(type, myRole); }

  function puTooltip(type) {
    return {
      doubleTime:   'Before your next guess — doubles vibe duration if correct',
      freeLife:     'Gain an extra life immediately',
      allOrNothing: 'If a viber presses spacebar, they lose ALL lives (stays active until wrong guess)',
      peek:         'Reveal the next card — guarantees a correct guess',
      skip:         'Skip this card without penalty or mistake',
      freeze:       'Vibers cannot press spacebar for the rest of this round',
      surge:        'Instantly add 10× the current card\'s value in seconds to the vibe',
      chain:        '3P: when one viber presses spacebar, the others each lose a life too (whole round)',
      maxIntensity: 'Instantly set vibe intensity to 100% for all vibers',
      shield:       'Your next spacebar press costs 0 lives — absorbs any penalty including All or Nothing',
      mirror:       'Sync all vibers to the same countdown, guessing pauses — anyone pressing spacebar stops the vibe for everyone (costs 1 life)',
      deflect:      'Transfer your remaining vibe time to the guesser and take control — you become the guesser',
    }[type] || '';
  }

  function renderStatusBar() {
    const el = document.getElementById('hilo-status-bar');
    if (!el) return;
    const now = Date.now();
    const cells = playerRoles.map(r => {
      const isGuesser = r === currentRole && phase === 'playing';
      const isVibeTarget = vibeTargets.includes(r) && vibeCountdown > 0 && phase === 'playing';
      const pauseRemaining = Math.max(0, (spacePauseUntil[r] - now) / 1000);
      const isPaused = pauseRemaining > 0 && phase === 'playing';
      const isMe = r === myRole;
      let vibeInfo = '';
      if (isPaused) {
        vibeInfo = `<span class="hilo-sb-paused">Paused ${pauseRemaining.toFixed(0)}s</span>`;
      } else if (isVibeTarget) {
        const pct = Math.round(vibeIntensity * 100);
        const secs = vibeCountdown.toFixed(1);
        vibeInfo = `<span class="hilo-sb-vibe">${pct}% · ${secs}s</span>`;
      }
      const nameCls = isMe ? 'hilo-sb-name-me' : 'hilo-sb-name-opp';
      return `
        <div class="hilo-sb-cell${isGuesser ? ' hilo-sb-guesser' : ''}">
          <span class="${nameCls}">${isGuesser ? '🎯 ' : ''}${escapeHtml(playerNames[r])}</span>
          <span class="hilo-sb-lives">${livesHtml(getLives(r))}</span>
          ${vibeInfo}
        </div>`;
    }).join('');
    el.innerHTML = cells;
  }

  // ── Vibe helpers ─────────────────────────────────────────────────────────────
  function addVibeSeconds(secs) {
    vibeCountdown += secs;
    if (!vibeCountdownTimer) {
      vibeCountdownTimer = setInterval(() => {
        vibeCountdown = Math.max(0, vibeCountdown - 0.1);
        if (vibeCountdown <= 0) {
          vibeTargets  = [];
          mirrorActive = false;
          clearInterval(vibeCountdownTimer);
          vibeCountdownTimer = null;
          renderState();
        }
        updateVibeDisplay();
      }, 100);
    }
    if (vibeTargets.includes(myRole) && haptics.isConnected()) {
      haptics.setWaveVibeMode(waveModeEnabled);
      haptics.setForfeitIntensity(vibeIntensity);
      haptics.addForfeitSeconds(secs);
    }
  }

  function addVibeForCard(cardValue, durationMult) {
    addVibeSeconds(computeVibeDurationMs(cardValue) / 1000 * (durationMult || 1));
  }

  function stopHiloVibe() {
    vibeCountdown = 0;
    vibeTargets   = [];
    mirrorActive  = false;
    for (const r of playerRoles) spacePauseUntil[r] = 0;
    if (vibeCountdownTimer) { clearInterval(vibeCountdownTimer); vibeCountdownTimer = null; }
    haptics.stopAll();
  }

  let pauseDisplayInterval = null;

  function updateVibeDisplay() {
    renderStatusBar();
    const viEl = document.getElementById('hilo-vibe-indicator');
    if (!viEl) return;
    const now = Date.now();
    const pauseRemaining = Math.max(0, (spacePauseUntil[myRole] - now) / 1000);
    const isPaused = pauseRemaining > 0;

    if (isPaused && phase === 'playing') {
      viEl.style.display = 'block';
      viEl.textContent = `Vibe paused — ${pauseRemaining.toFixed(0)}s left`;
      viEl.style.color = 'var(--muted)';
      // Keep display updating while paused even if vibeCountdown is 0
      if (!pauseDisplayInterval) {
        pauseDisplayInterval = setInterval(() => {
          const rem = Math.max(0, (spacePauseUntil[myRole] - Date.now()) / 1000);
          if (rem <= 0) { clearInterval(pauseDisplayInterval); pauseDisplayInterval = null; }
          updateVibeDisplay();
        }, 500);
      }
    } else {
      if (pauseDisplayInterval) { clearInterval(pauseDisplayInterval); pauseDisplayInterval = null; }
      if (vibeCountdown > 0 && phase === 'playing') {
        viEl.style.display = 'block';
        const secs = vibeCountdown.toFixed(1);
        const pct = Math.round(vibeIntensity * 100);
        if (amVibing()) {
          viEl.textContent = `Vibe ${pct}% — ${secs}s remaining`;
          viEl.style.color = vibeIntensity >= 0.8 ? 'var(--warn)' : 'var(--accent)';
        } else if (vibeTargets.length > 0) {
          const names = vibeTargets.map(r => escapeHtml(playerNames[r])).join(' & ');
          viEl.textContent = `${names} vibing ${pct}% — ${secs}s remaining`;
          viEl.style.color = 'var(--muted)';
        } else {
          viEl.style.display = 'none';
        }
      } else {
        viEl.style.display = 'none';
      }
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
      points[currentRole]++;

      vibeIntensity = Math.min(1.0, vibeIntensity + vibeRampStep);
      const mult = doubleTimeQueued ? 2 : 1;
      doubleTimeQueued = false;
      vibeTargets = computeVibeTargets();
      addVibeForCard(card.value, mult);

      cardIndex++;
      peekVisible = false;

      // Award power-up if this card index is a trigger position
      if (powerUpMap.has(cardIndex)) {
        const puType = powerUpMap.get(cardIndex);
        powerUps[currentRole].push({ type: puType, uid: Math.random() });
        const actorLabel = currentRole === myRole ? 'You' : escapeHtml(playerNames[currentRole]);
        showFeedback(`🎁 ${actorLabel} got: ${POWER_UP_LABELS[puType]}!`, 'accent');
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

      // Rotate to next guesser
      const currIdx = playerRoles.indexOf(currentRole);
      currentRole = playerRoles[(currIdx + 1) % playerCount];
      showFeedback('✗ Wrong — turn switches', 'warn');
    }

    renderState();
  }

  function applySpacebar(presserRole) {
    if (phase !== 'playing') return;
    if (!vibeTargets.includes(presserRole)) return;

    const absorbed = shielded[presserRole];
    if (absorbed) shielded[presserRole] = false;

    const label = presserRole === myRole ? 'you' : escapeHtml(playerNames[presserRole]);

    if (mirrorActive) {
      if (!absorbed) setLives(presserRole, allOrNothingActive ? 0 : getLives(presserRole) - 1);
      showFeedback(absorbed ? `🛡 Shield absorbed the mirror escape!` : `🪞 Mirror broken by ${label}!`, absorbed ? 'accent' : 'warn');
      stopHiloVibe();
      renderState();
      return;
    }

    if (allOrNothingActive) {
      if (!absorbed) setLives(presserRole, 0);
      showFeedback(absorbed ? `🛡 Shield saved ${label} from All or Nothing!` : `⚡ All or Nothing — ${label} lost all lives!`, absorbed ? 'accent' : 'warn');
    } else {
      if (!absorbed) setLives(presserRole, getLives(presserRole) - 1);
      if (absorbed) showFeedback(`🛡 Shield absorbed the hit!`, 'accent');
    }

    if (chainActive) {
      const others = playerRoles.filter(r => r !== currentRole && r !== presserRole && vibeTargets.includes(r));
      for (const r of others) setLives(r, getLives(r) - 1);
      if (others.length > 0) {
        showFeedback(`🔗 Chain! ${others.map(r => escapeHtml(playerNames[r])).join(' & ')} also lost a life`, 'warn');
      }
    }

    // 30-second wall-clock pause for just this player — others keep vibing
    spacePauseUntil[presserRole] = Date.now() + 30_000;
    vibeTargets = vibeTargets.filter(r => r !== presserRole);

    if (presserRole === myRole) haptics.stopAll();

    if (vibeTargets.length === 0) {
      vibeIntensity = 0;
      vibeCountdown = 0;
      if (vibeCountdownTimer) { clearInterval(vibeCountdownTimer); vibeCountdownTimer = null; }
    }

    renderState();
  }

  function applyPowerUpUse(type, fromRole) {
    const inv = powerUps[fromRole];
    if (!inv) return;
    const idx = inv.findIndex(p => p.type === type);
    if (idx === -1) return;
    if (!isPowerUpUsableBy(type, fromRole)) return;
    inv.splice(idx, 1);

    const actorLabel = fromRole === myRole ? 'You' : escapeHtml(playerNames[fromRole]);

    switch (type) {
      case 'freeLife':
        setLives(fromRole, getLives(fromRole) + 1);
        showFeedback(`${actorLabel} gained a life!`, 'accent');
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
        showFeedback('❄️ Freeze! Vibers cannot stop the vibe this round', 'accent');
        break;
      case 'surge': {
        const secs = 10 * deck[cardIndex].value;
        if (vibeTargets.length === 0) {
          vibeTargets = computeVibeTargets();
          if (vibeTargets.length === 0) vibeTargets = playerRoles.filter(r => r !== currentRole);
        }
        addVibeSeconds(secs);
        showFeedback(`⚡ Surge! +${secs}s of vibe`, 'warn');
        break;
      }
      case 'chain':
        chainActive = true;
        showFeedback('🔗 Chain — vibers are linked this round!', 'warn');
        break;
      case 'maxIntensity':
        vibeIntensity = 1.0;
        if (vibeTargets.includes(myRole) && haptics.isConnected()) haptics.setForfeitIntensity(1.0);
        showFeedback('🔥 Max Intensity!', 'warn');
        break;
      case 'shield':
        shielded[fromRole] = true;
        showFeedback(`🛡 ${actorLabel} activated a shield!`, 'accent');
        break;
      case 'mirror': {
        mirrorActive = true;
        for (const r of playerRoles) spacePauseUntil[r] = 0;
        vibeTargets = playerRoles.filter(r => r !== currentRole);
        if (vibeTargets.includes(myRole) && haptics.isConnected()) {
          haptics.setForfeitIntensity(vibeIntensity || 0.5);
          haptics.addForfeitSeconds(vibeCountdown);
        }
        showFeedback('🪞 Mirror! All vibers locked in — press space to escape', 'warn');
        break;
      }
      case 'deflect': {
        const formerGuesser = currentRole;
        currentRole = fromRole;
        vibeTargets = vibeTargets.filter(r => r !== fromRole);
        if (!vibeTargets.includes(formerGuesser)) vibeTargets.push(formerGuesser);
        spacePauseUntil[formerGuesser] = 0;
        if (myRole === fromRole && haptics.isConnected()) haptics.stopAll();
        if (myRole === formerGuesser && haptics.isConnected()) {
          haptics.setForfeitIntensity(vibeIntensity || 0.5);
          haptics.addForfeitSeconds(vibeCountdown);
        }
        showFeedback(`↩ Deflect! ${actorLabel} passed the vibe back!`, 'warn');
        break;
      }
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

    const myPts = getMyPts();
    const sorted = [...playerRoles].sort((a, b) => points[b] - points[a]);
    const isLeading = sorted[0] === myRole;
    const isTied = sorted.every(r => points[r] === myPts);
    let leadText;
    if (isTied) {
      leadText = `<span style="color:var(--muted)">Tied!</span>`;
    } else if (isLeading) {
      leadText = `<span style="color:var(--accent)">You are leading!</span>`;
    } else {
      leadText = `<span style="color:var(--warn)">${escapeHtml(playerNames[sorted[0]])} is leading!</span>`;
    }

    document.getElementById('hilo-round-end-overlay')?.remove();

    const scoreCells = playerRoles.map(r => `
      <div class="hilo-round-score-cell">
        <div class="hilo-round-score-name">${escapeHtml(playerNames[r])}${r === myRole ? ' (you)' : ''}</div>
        <div class="hilo-round-score-lives">${livesHtml(getLives(r))}</div>
        <div class="hilo-round-score-pts">${points[r]} pts</div>
      </div>`).join('');

    const ov = document.createElement('div');
    ov.id = 'hilo-round-end-overlay';
    ov.className = 'hilo-overlay';
    ov.innerHTML = `
      <div class="hilo-overlay-box">
        <h2>Round ${cycleCount} Complete</h2>
        <div class="hilo-round-scores">${scoreCells}</div>
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
      if (playAgainAnswers[myRole] !== undefined) return;
      playAgainAnswers[myRole] = false;
      if (playerCount > 1) socket.send({ type: MSG.HILO_PLAY_AGAIN, confirm: false });
      showGameOver(null);
    });

    document.getElementById('hilo-continue-btn').addEventListener('click', () => {
      if (playAgainAnswers[myRole] !== undefined) return;
      playAgainAnswers[myRole] = true;
      if (playerCount > 1) socket.send({ type: MSG.HILO_PLAY_AGAIN, confirm: true });
      document.getElementById('hilo-continue-btn').disabled = true;
      document.getElementById('hilo-continue-btn').textContent = playerCount > 1 ? 'Waiting…' : 'Starting…';
      updatePlayAgainStatus();
      checkAllPlayAgain();
    });
  }

  function updatePlayAgainStatus() {
    const statusEl = document.getElementById('hilo-pa-status');
    if (!statusEl) return;
    const waiting = playerRoles.filter(r => playAgainAnswers[r] === undefined).map(r => escapeHtml(playerNames[r]));
    statusEl.textContent = waiting.length ? `Waiting for: ${waiting.join(', ')}` : '';
  }

  function checkAllPlayAgain() {
    if (playerRoles.some(r => playAgainAnswers[r] === false)) {
      showGameOver(null);
    } else if (playerRoles.every(r => playAgainAnswers[r] === true)) {
      startInterRoundForfeit();
    }
  }

  // ── Inter-round forfeit ──────────────────────────────────────────────────────
  function startInterRoundForfeit() {
    document.getElementById('hilo-round-end-overlay')?.remove();
    phase = 'forfeit';

    // Player(s) with most lives suffer — deterministic coin flip picks type
    const maxLives = Math.max(...playerRoles.map(r => getLives(r)));
    edgingRoles = playerRoles.filter(r => getLives(r) === maxLives);
    forfeitType = (((state.seed ^ (cycleCount * 1664525)) >>> 0) % 2 === 0) ? 'vibe' : 'edge';

    showForfeitOverlay();
  }

  function showForfeitOverlay() {
    document.getElementById('hilo-forfeit-overlay')?.remove();
    vibeStopAcks.clear();

    const ov = document.createElement('div');
    ov.id = 'hilo-forfeit-overlay';
    ov.className = 'hilo-overlay';
    const iAmSuffering = edgingRoles.includes(myRole);

    let whoMsg;
    if (edgingRoles.length >= 2) {
      whoMsg = edgingRoles.map(r => escapeHtml(playerNames[r])).join(' & ');
    } else {
      whoMsg = edgingRoles[0] === myRole ? 'You' : escapeHtml(playerNames[edgingRoles[0]]);
    }
    const waitingNames = edgingRoles.map(r => escapeHtml(playerNames[r])).join(', ');

    const statusRow = `<div id="hilo-forfeit-ack-status" style="margin-top:12px;text-align:center;font-size:13px;color:var(--muted);min-height:18px;"></div>`;

    if (forfeitType === 'edge') {
      const verb = edgingRoles.length >= 2 ? 'are edging' : (edgingRoles[0] === myRole ? 'are edging' : 'is edging');
      ov.innerHTML = `
        <div class="hilo-overlay-box">
          <p class="hilo-forfeit-flavour">For having the most lives you will suffer</p>
          <h2 style="text-align:center;margin:8px 0;">Edge Forfeit</h2>
          <p style="text-align:center;font-size:16px;margin:0 0 24px;">${whoMsg} ${verb}</p>
          ${iAmSuffering
            ? `<button id="hilo-forfeit-ready-btn" style="display:block;margin:0 auto;">Ready ✓</button>`
            : `<p style="text-align:center;color:var(--muted);font-size:14px;">Waiting for ${waitingNames}…</p>`}
          ${statusRow}
        </div>`;

      root.appendChild(ov);
      ov.querySelector('#hilo-forfeit-ready-btn')?.addEventListener('click', () => {
        haptics.stopAll();
        if (playerCount > 1) socket.send({ type: MSG.HILO_VIBE_STOP });
        vibeStopAcks.add(myRole);
        const btn = document.getElementById('hilo-forfeit-ready-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Ready ✓'; }
        updateForfeitReadyStatus();
        checkVibeStopReady();
      });

    } else {
      const verb = edgingRoles.length >= 2 ? 'suffer' : (edgingRoles[0] === myRole ? 'suffer' : 'suffers');
      ov.innerHTML = `
        <div class="hilo-overlay-box">
          <p class="hilo-forfeit-flavour">For having the most lives you will suffer</p>
          <h2 style="text-align:center;margin:8px 0;">Vibe Forfeit</h2>
          <p style="text-align:center;font-size:14px;color:var(--muted);margin:0 0 16px;">${whoMsg} ${verb} — everyone vibes until they're done</p>
          <div class="forfeit-slider-row" style="margin-bottom:16px;">
            <span>Intensity</span>
            <input type="range" id="hilo-shared-slider" min="0" max="100" value="50" style="flex:1;margin:0 12px;accent-color:var(--warn);">
            <span id="hilo-shared-pct">50%</span>
          </div>
          ${iAmSuffering
            ? `<button id="hilo-forfeit-ready-btn" style="display:block;margin:0 auto;">Ready ✓</button>`
            : `<p style="text-align:center;font-size:13px;color:var(--muted);">Waiting for ${waitingNames}…</p>`}
          ${statusRow}
        </div>`;

      root.appendChild(ov);

      if (haptics.isConnected()) haptics.testVibe(0.5);

      const slider = ov.querySelector('#hilo-shared-slider');
      const pct    = ov.querySelector('#hilo-shared-pct');

      slider.addEventListener('input', () => {
        const level = slider.value / 100;
        pct.textContent = `${slider.value}%`;
        if (haptics.isConnected()) haptics.testVibe(level);
        if (playerCount > 1) socket.send({ type: MSG.HILO_VIBE_LEVEL, level });
      });

      ov.querySelector('#hilo-forfeit-ready-btn')?.addEventListener('click', () => {
        haptics.stopAll();
        if (playerCount > 1) socket.send({ type: MSG.HILO_VIBE_STOP });
        vibeStopAcks.add(myRole);
        const btn = document.getElementById('hilo-forfeit-ready-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Ready ✓'; }
        updateForfeitReadyStatus();
        checkVibeStopReady();
      });
    }
  }

  function updateForfeitReadyStatus() {
    const statusEl = document.getElementById('hilo-forfeit-ack-status');
    if (!statusEl) return;
    const waiting = edgingRoles.filter(r => !vibeStopAcks.has(r)).map(r => escapeHtml(playerNames[r]));
    statusEl.textContent = waiting.length ? `Waiting for: ${waiting.join(', ')}` : '';
  }

  function checkVibeStopReady() {
    if (edgingRoles.every(r => vibeStopAcks.has(r))) {
      startNextCycle();
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
    chainActive   = false;
    mirrorActive  = false;
    for (const r of playerRoles) { shielded[r] = false; delete playAgainAnswers[r]; }
    vibeStopAcks.clear();
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

    const myPts = getMyPts();
    const sorted = [...playerRoles].sort((a, b) => points[b] - points[a]);
    const myRank = sorted.indexOf(myRole);

    let resultHtml;
    if (cause === 'opp_submitted') {
      resultHtml = `<p style="color:var(--warn);font-size:18px;font-weight:700;">A player tapped out</p>`;
    } else if (cause === 'i_submitted') {
      resultHtml = `<p style="color:var(--warn);font-size:18px;font-weight:700;">You tapped out</p>`;
    } else if (playerCount === 2) {
      const oppRole2 = myRole === 'host' ? 'guest' : 'host';
      const oppPts = points[oppRole2];
      if (myPts > oppPts) resultHtml = `<p style="color:var(--accent);font-size:18px;font-weight:700;">You Win!</p>`;
      else if (myPts < oppPts) resultHtml = `<p style="color:var(--warn);font-size:18px;font-weight:700;">You Lose!</p>`;
      else resultHtml = `<p style="font-size:18px;font-weight:700;">It's a Draw!</p>`;
    } else {
      const places = ['🥇 1st', '🥈 2nd', '🥉 3rd'];
      resultHtml = `<p style="font-size:18px;font-weight:700;">${places[myRank] || `${myRank + 1}th`} place!</p>`;
    }

    document.getElementById('hilo-scorebar').innerHTML = '';

    const scoreRows = sorted.map((r, i) => {
      const placeIcon = ['🥇', '🥈', '🥉'][i] || '';
      return `
        <div class="hilo-round-score-cell">
          <div class="hilo-round-score-name">${placeIcon} ${escapeHtml(playerNames[r])}${r === myRole ? ' (you)' : ''}</div>
          <div class="hilo-round-score-pts" style="font-size:32px;">${points[r]}</div>
          <div style="font-size:12px;color:var(--muted);">points</div>
        </div>`;
    }).join('');

    const ov = document.createElement('div');
    ov.className = 'hilo-overlay';
    ov.innerHTML = `
      <div class="hilo-overlay-box">
        <h2>Game Over</h2>
        ${resultHtml}
        <div class="hilo-round-scores" style="margin:16px 0;">${scoreRows}</div>
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
    if (playerCount > 1) socket.send({ type: MSG.HILO_GUESS, guess });
    applyGuess(guess);
  }

  function handleMySpacebar() {
    if (!amVibing() || phase !== 'playing') return;
    if (getMyLives() <= 0) return;
    if (freezeActive && !mirrorActive) { showFeedback('❄️ Frozen — spacebar blocked!', 'warn'); return; }
    if (playerCount > 1) socket.send({ type: MSG.HILO_SPACEBAR });
    applySpacebar(myRole);
  }

  function usePowerUp(type, idx) {
    const inv = getMyPU();
    if (idx >= inv.length || inv[idx].type !== type) return;
    if (playerCount > 1) socket.send({ type: MSG.HILO_POWERUP_USE, powerUpType: type });
    applyPowerUpUse(type, myRole);
  }

  // ── Socket event handlers ─────────────────────────────────────────────────────
  const onHiloGuess      = (ev) => { if (ev.detail.role === currentRole) applyGuess(ev.detail.guess); };
  const onHiloSpacebar   = (ev) => applySpacebar(ev.detail.role);
  const onHiloPowerUpUse = (ev) => applyPowerUpUse(ev.detail.powerUpType, ev.detail.role);
  const onHiloSubmit     = () => showGameOver('opp_submitted');

  const onHiloPlayAgain = (ev) => {
    playAgainAnswers[ev.detail.role] = ev.detail.confirm;
    const statusEl = document.getElementById('hilo-pa-status');
    if (statusEl) {
      const senderName = escapeHtml(playerNames[ev.detail.role] || ev.detail.role);
      if (statusEl) updatePlayAgainStatus();
      if (!ev.detail.confirm && statusEl) statusEl.textContent = `${senderName} wants to stop.`;
    }
    checkAllPlayAgain();
  };

  const onHiloVibeLevel = (ev) => {
    const slider = document.getElementById('hilo-shared-slider');
    const pct    = document.getElementById('hilo-shared-pct');
    const level  = ev.detail.level;
    if (slider) slider.value = Math.round(level * 100);
    if (pct) pct.textContent = `${Math.round(level * 100)}%`;
    if (haptics.isConnected()) haptics.testVibe(level);
  };

  function applyWaveMode(enabled) {
    waveModeEnabled = enabled;
    haptics.setWaveVibeMode(enabled);
    const btn = document.getElementById('hilo-wave-btn');
    if (btn) btn.textContent = `〰 Variation: ${enabled ? 'On' : 'Off'}`;
  }

  const onHiloWaveMode = (ev) => applyWaveMode(ev.detail.enabled);

  const onHiloVibeStop = (ev) => {
    if (phase !== 'forfeit') return;
    haptics.stopAll();
    vibeStopAcks.add(ev.detail.role);
    updateForfeitReadyStatus();
    checkVibeStopReady();
  };

  // Non-destructive: a brief network drop can reconnect within a few seconds (the socket
  // auto-reconnects and the server re-announces the role), so don't tear down the whole
  // game screen — just warn and offer a way out, and clear it again if they come back.
  const onPeerLeft = (ev) => {
    stopHiloVibe();
    const leftRole = ev.detail?.role;
    const leftName = leftRole ? escapeHtml(playerNames[leftRole] || leftRole) : 'A player';
    const wrap = document.getElementById('hilo-disconnect-wrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div class="hilo-disconnect-row">
        <span>${leftName} disconnected.</span>
        <button id="hilo-peer-lobby" class="ghost">Return to Lobby</button>
      </div>`;
    wrap.querySelector('#hilo-peer-lobby').addEventListener('click', () => {
      state.seed = null;
      navigate(`#/session/${state.sessionId}`);
    });
  };
  const onPeerReconnected = () => {
    const wrap = document.getElementById('hilo-disconnect-wrap');
    if (wrap) wrap.innerHTML = '';
  };

  socket.addEventListener(MSG.HILO_GUESS,          onHiloGuess);
  socket.addEventListener(MSG.HILO_SPACEBAR,       onHiloSpacebar);
  socket.addEventListener(MSG.HILO_POWERUP_USE,    onHiloPowerUpUse);
  socket.addEventListener(MSG.HILO_SUBMIT,         onHiloSubmit);
  socket.addEventListener(MSG.HILO_PLAY_AGAIN,     onHiloPlayAgain);
  socket.addEventListener(MSG.HILO_VIBE_LEVEL,     onHiloVibeLevel);
  socket.addEventListener(MSG.HILO_VIBE_STOP,      onHiloVibeStop);
  socket.addEventListener(MSG.HILO_WAVE_MODE,      onHiloWaveMode);
  socket.addEventListener(MSG.PEER_LEFT,           onPeerLeft);
  socket.addEventListener(MSG.PEER_RECONNECTED,    onPeerReconnected);

  // ── DOM event handlers ────────────────────────────────────────────────────────
  document.getElementById('hilo-higher').addEventListener('click', () => handleMyGuess('higher'));
  document.getElementById('hilo-lower').addEventListener('click',  () => handleMyGuess('lower'));

  const onKeydown = (e) => {
    if (e.code === 'Space' && phase === 'playing') { e.preventDefault(); handleMySpacebar(); }
  };
  window.addEventListener('keydown', onKeydown);

  document.getElementById('hilo-submit-btn').addEventListener('click', () => {
    if (phase !== 'playing') return;
    if (playerCount > 1) socket.send({ type: MSG.HILO_SUBMIT });
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

  document.getElementById('hilo-wave-btn')?.addEventListener('click', () => {
    const enabled = !waveModeEnabled;
    applyWaveMode(enabled);
    if (playerCount > 1) socket.send({ type: MSG.HILO_WAVE_MODE, enabled });
  });

  document.getElementById('hilo-leave').addEventListener('click', () => {
    state.seed = null;
    navigate(`#/session/${state.sessionId}`);
  });

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  window.addEventListener('hashchange', () => {
    stopHiloVibe();
    if (pauseDisplayInterval) { clearInterval(pauseDisplayInterval); pauseDisplayInterval = null; }
    clearTimeout(feedbackTimer);
    window.removeEventListener('keydown', onKeydown);
    socket.removeEventListener(MSG.HILO_GUESS,          onHiloGuess);
    socket.removeEventListener(MSG.HILO_SPACEBAR,       onHiloSpacebar);
    socket.removeEventListener(MSG.HILO_POWERUP_USE,    onHiloPowerUpUse);
    socket.removeEventListener(MSG.HILO_SUBMIT,         onHiloSubmit);
    socket.removeEventListener(MSG.HILO_PLAY_AGAIN,     onHiloPlayAgain);
    socket.removeEventListener(MSG.HILO_VIBE_LEVEL,     onHiloVibeLevel);
    socket.removeEventListener(MSG.HILO_VIBE_STOP,      onHiloVibeStop);
    socket.removeEventListener(MSG.HILO_WAVE_MODE,      onHiloWaveMode);
    socket.removeEventListener(MSG.PEER_LEFT,           onPeerLeft);
    socket.removeEventListener(MSG.PEER_RECONNECTED,    onPeerReconnected);
  }, { once: true });

  // ── Initial render ────────────────────────────────────────────────────────────
  renderState();
  showFeedback(isMyTurn() ? 'You go first!' : `${escapeHtml(playerNames[currentRole])} goes first`, 'accent');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
