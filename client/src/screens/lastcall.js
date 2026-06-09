import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';
import { makeRng } from '../game/seededRng.js';
import { RED_SUITS } from '../game/hiloGame.js';
import {
  buildDeck, LC_POWER_LABELS, LC_POWER_DESC,
  LC_POOL_BASE, LC_POOL_TIMER,
  lcDeckRng, lcPowerRng, extendPowerMap, pickStarterIndex, lcCardSeconds,
} from '../game/lastcallGame.js';

export function renderLastCall(root) {
  const myRole      = state.role;
  const playerCount = state.playerCount || 2;
  const is1P = playerCount === 1;
  const playerRoles = playerCount === 3 ? ['host', 'guest', 'guest2'] : is1P ? ['host'] : ['host', 'guest'];
  const playerNames = {
    host:   state.hostName   || 'Host',
    guest:  state.guestName  || 'Guest',
    guest2: state.guest2Name || 'Player 3',
  };

  // ── Config ───────────────────────────────────────────────────────────────────
  const seed          = state.seed;
  const deckSize      = state.lcDeckSize || 2;
  const timerMode     = !!state.lcTimer;
  const totalMs       = (state.lcMinutes || 10) * 60_000;
  const forfeitSecs   = state.forfeitDuration || 30;
  const rewardScale   = state.lcReward === 'half' ? 0.5 : 1;
  const pool          = timerMode ? LC_POOL_TIMER : LC_POOL_BASE;

  // ── Deck (deterministic, grows as it is consumed) ─────────────────────────────
  let deckCycle = 0;
  let deck      = buildDeck(lcDeckRng(seed, deckCycle), deckSize);
  const powerMap = new Map();
  extendPowerMap(powerMap, 0, deck.length, lcPowerRng(seed, deckCycle), pool);
  deckCycle++;
  let cardIndex = 0;

  function ensureDeck() {
    while (cardIndex + 1 >= deck.length) {
      const start = deck.length;
      const fresh = buildDeck(lcDeckRng(seed, deckCycle), deckSize);
      deck.push(...fresh);
      extendPowerMap(powerMap, start, fresh.length, lcPowerRng(seed, deckCycle), pool);
      deckCycle++;
    }
  }

  // ── Game state ────────────────────────────────────────────────────────────────
  let currentGuesser = playerRoles[pickStarterIndex(makeRng(seed), playerCount)];
  let phase = 'playing'; // 'playing' | 'running' | 'gameover'
  let pot = 0;
  let streak1P = 0; // consecutive correct answers without banking (1P only)

  const bank     = { host: 0, guest: 0, guest2: 0 };
  const finished = { host: false, guest: false, guest2: false };
  const powerups = { host: [], guest: [], guest2: [] };

  // Per-streak / armed flags
  const doubleActive = { host: false, guest: false, guest2: false };
  const taxed        = { host: false, guest: false, guest2: false };
  const patternArmed = { host: false, guest: false, guest2: false };
  const leechArmed   = { host: false, guest: false, guest2: false };
  const shielded     = { host: false, guest: false, guest2: false };
  let peekVisible    = false;

  // Run session
  let runRunner       = null;
  let runLevel        = 0.5;
  let lastRunLevel    = 0.5;
  let runPattern      = false;
  let runPhase        = 0;
  let runActive       = new Set();
  let runLoop         = null;
  let runTickCount    = 0;
  let hijackController = null;
  let hijackUntil     = 0;

  // Timer
  let deadline = null;
  let timerInterval = null;

  const isRunner = () => runRunner === myRole;
  const iControlSlider = () => phase === 'running' &&
    ((hijackController && hijackController === myRole) || (!hijackController && isRunner()));

  // ── HTML shell ────────────────────────────────────────────────────────────────
  root.innerHTML = `
    <div class="hilo-root" id="lc-root">
      <div class="hilo-header">
        <button class="ghost" id="lc-leave" style="padding:6px 14px;font-size:13px;">← Leave</button>
        <div class="hilo-scorebar" id="lc-scorebar"></div>
        <div id="lc-clock" style="font-variant-numeric:tabular-nums;font-weight:700;font-size:16px;min-width:60px;text-align:center;"></div>
        <button id="lc-vibe-btn" class="ghost" style="font-size:13px;padding:6px 12px;">${haptics.isConnected() ? '📳' : 'Connect Vibe'}</button>
        <button id="lc-finish-btn" style="font-size:13px;padding:6px 12px;background:var(--warn);">🏁 I'm finished</button>
      </div>

      <div class="hilo-arena" id="lc-arena">
        <div class="hilo-deck-col">
          <div class="hilo-card hilo-card-back" id="lc-deck-back"><span class="hilo-deck-count" id="lc-deck-count"></span></div>
          <div class="hilo-deck-label">Deck</div>
        </div>
        <div class="hilo-card-col">
          <div id="lc-current-card" class="hilo-card-slot"></div>
          <div id="lc-peek-slot" style="display:none;">
            <div class="hilo-peek-label">NEXT (Peek)</div>
            <div id="lc-peek-card" class="hilo-card-slot"></div>
          </div>
        </div>
      </div>

      <div id="lc-pot" class="hilo-turn-label" style="text-align:center;"></div>
      <div id="lc-turn-label" class="hilo-turn-label"></div>
      <div id="lc-feedback" class="hilo-feedback"></div>

      <div id="lc-guess-btns" class="hilo-guess-btns" style="display:none;">
        <button id="lc-higher" class="hilo-guess-btn hilo-higher">▲ Higher</button>
        <button id="lc-lower"  class="hilo-guess-btn hilo-lower">▼ Lower</button>
      </div>
      <div id="lc-bank-row" style="display:none;text-align:center;margin-top:8px;">
        <button class="ghost" id="lc-bank-btn">🏦 Bank &amp; end turn</button>
      </div>

      <div id="lc-powerups" class="hilo-powerups"></div>
      <div id="lc-status-bar" class="hilo-status-bar"></div>
    </div>`;

  const $ = (id) => document.getElementById(id);

  // ── Card rendering ────────────────────────────────────────────────────────────
  function cardHtml(card) {
    const red = RED_SUITS.has(card.suit) ? ' hilo-card-red' : '';
    return `<div class="hilo-card${red}">
        <div class="hilo-card-corner">${card.name}<br>${card.suit}</div>
        <div class="hilo-card-center">${card.suit}</div>
        <div class="hilo-card-corner hilo-card-corner-br">${card.name}<br>${card.suit}</div>
      </div>`;
  }

  const fmtSecs = (s) => `${Math.max(0, s).toFixed(1)}s`;

  // ── Render ────────────────────────────────────────────────────────────────────
  function renderState() {
    renderScorebar();
    renderStatusBar();

    if (phase === 'playing') {
      ensureDeck();
      const cc = $('lc-current-card');
      if (cc) cc.innerHTML = cardHtml(deck[cardIndex]);
      const dc = $('lc-deck-count');
      if (dc) dc.textContent = '∞';

      const peekSlot = $('lc-peek-slot');
      const peekCard = $('lc-peek-card');
      const showPeek = peekVisible && currentGuesser === myRole && phase === 'playing' && cardIndex + 1 < deck.length;
      if (peekSlot) peekSlot.style.display = showPeek ? 'block' : 'none';
      if (showPeek && peekCard) peekCard.innerHTML = cardHtml(deck[cardIndex + 1]);
    }

    const isMyTurn = currentGuesser === myRole && !finished[myRole];
    const gbtns = $('lc-guess-btns');
    if (gbtns) gbtns.style.display = (phase === 'playing' && isMyTurn) ? 'flex' : 'none';

    const bankRow = $('lc-bank-row');
    if (bankRow) bankRow.style.display = (phase === 'playing' && isMyTurn && (pot > 0 || bank[myRole] > 0)) ? 'block' : 'none';
    const bankBtn = $('lc-bank-btn');
    if (bankBtn) bankBtn.textContent = pot > 0 ? `🏦 Bank ${fmtSecs(pot)} & end turn` : '▶ Claim banked time';

    const potEl = $('lc-pot');
    if (potEl) {
      potEl.style.display = (phase === 'playing' && pot > 0) ? 'block' : 'none';
      const streakInfo = is1P && streak1P > 1
        ? ` <span style="color:var(--warn);font-size:12px;">×${Math.min(3, 1 + streak1P * 0.15).toFixed(2)} (${streak1P}-card streak)</span>`
        : '';
      potEl.innerHTML = `Pot this streak: <strong style="color:var(--accent)">${fmtSecs(pot)}</strong>${streakInfo}`;
    }

    const tl = $('lc-turn-label');
    if (tl) {
      if (phase === 'playing') {
        if (finished[myRole]) {
          tl.textContent = '🏁 You finished — watching the rest play out';
          tl.className = 'hilo-turn-label';
        } else if (isMyTurn) {
          const streakBonus = is1P && streak1P > 0 ? ` (next: ×${Math.min(3, 1 + (streak1P + 1) * 0.15).toFixed(2)})` : '';
          tl.textContent = `Your turn — Higher or Lower?${streakBonus} ${taxed[myRole] ? '(💸 taxed)' : ''}${doubleActive[myRole] ? ' (✕2)' : ''}`;
          tl.className = 'hilo-turn-label hilo-turn-me';
        } else {
          tl.textContent = `${escapeHtml(playerNames[currentGuesser])}'s turn`;
          tl.className = 'hilo-turn-label hilo-turn-opp';
        }
      } else {
        tl.textContent = '';
      }
    }

    const finishBtn = $('lc-finish-btn');
    if (finishBtn) finishBtn.style.display = (phase === 'gameover' || finished[myRole]) ? 'none' : '';

    const clock = $('lc-clock');
    if (clock) {
      if (timerMode && deadline) {
        const rem = Math.max(0, deadline - Date.now());
        const m = Math.floor(rem / 60000);
        const s = Math.floor((rem % 60000) / 1000);
        clock.textContent = `${m}:${String(s).padStart(2, '0')}`;
        clock.style.color = rem < 30000 ? 'var(--warn)' : 'var(--ink)';
      } else {
        clock.textContent = '';
      }
    }

    renderPowerUps();
  }

  function renderScorebar() {
    const sb = $('lc-scorebar');
    if (!sb) return;
    sb.innerHTML = playerRoles.map(r => {
      const cls = r === myRole ? 'hilo-score-me' : 'hilo-score-opp';
      const tag = finished[r] ? '🏁 ' : (r === currentGuesser && phase !== 'gameover' ? '🎯 ' : '');
      return `<span class="${cls}">${tag}${escapeHtml(playerNames[r])} <strong>${fmtSecs(bank[r])}</strong></span>`;
    }).join('<span class="hilo-score-sep">·</span>');
  }

  function renderStatusBar() {
    const el = $('lc-status-bar');
    if (!el) return;
    el.innerHTML = playerRoles.map(r => {
      const me = r === myRole;
      const vibing = runActive.has(r) && phase === 'running';
      let extra = '';
      if (finished[r]) extra = `<span class="hilo-sb-paused">finished 🏁</span>`;
      else if (vibing) extra = `<span class="hilo-sb-vibe">vibing · ${fmtSecs(bank[r])}</span>`;
      return `<div class="hilo-sb-cell">
          <span class="${me ? 'hilo-sb-name-me' : 'hilo-sb-name-opp'}">${escapeHtml(playerNames[r])}</span>
          <span class="hilo-sb-lives">🏦 ${fmtSecs(bank[r])}</span>
          ${extra}
        </div>`;
    }).join('');
  }

  function renderPowerUps() {
    const el = $('lc-powerups');
    if (!el) return;
    if (finished[myRole]) { el.innerHTML = ''; return; }
    const mine = powerups[myRole];
    if (mine.length === 0) { el.innerHTML = ''; return; }
    let html = `<div class="hilo-pu-section"><div class="hilo-pu-label">Your power-ups</div><div class="hilo-pu-btns" id="lc-my-pu-btns">`;
    mine.forEach((pu, idx) => {
      const ok = isPowerUpUsable(pu.type);
      html += `<button class="hilo-pu-btn${ok ? '' : ' hilo-pu-disabled'}" data-pu-idx="${idx}" data-pu-type="${pu.type}" ${ok ? '' : 'disabled'} title="${escapeHtml(LC_POWER_DESC[pu.type])}">${escapeHtml(LC_POWER_LABELS[pu.type])}</button>`;
    });
    html += `</div></div>`;
    el.innerHTML = html;
    $('lc-my-pu-btns')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pu-idx]');
      if (!btn || btn.disabled) return;
      tryUsePowerUp(btn.dataset.puType, parseInt(btn.dataset.puIdx, 10));
    });
  }

  function isPowerUpUsable(type) {
    if (finished[myRole]) return false;
    const myTurn = currentGuesser === myRole;
    switch (type) {
      case 'peek':       return phase === 'playing' && myTurn && !peekVisible && cardIndex + 1 < deck.length;
      case 'doubledown': return phase === 'playing' && myTurn && !doubleActive[myRole];
      case 'pattern':    return phase !== 'gameover' && !patternArmed[myRole];
      case 'leech':      return phase !== 'gameover' && !leechArmed[myRole];
      case 'lockbox':    return phase !== 'gameover' && !shielded[myRole];
      case 'drain':      return phase !== 'gameover' && otherTargets().length > 0;
      case 'tax':        return phase !== 'gameover' && otherTargets().length > 0;
      case 'timeheist':  return timerMode && phase !== 'gameover';
      case 'hijack':     return phase === 'running' && runRunner !== myRole && hijackController !== myRole;
      default:           return false;
    }
  }

  // Non-finished opponents (valid drain/tax targets)
  function otherTargets() {
    return playerRoles.filter(r => r !== myRole && !finished[r]);
  }

  // ── Feedback ──────────────────────────────────────────────────────────────────
  let feedbackTimer = null;
  function showFeedback(msg, style) {
    const el = $('lc-feedback');
    if (!el) return;
    el.textContent = msg;
    el.className = `hilo-feedback hilo-feedback-${style || 'neutral'}`;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { if (el) el.textContent = ''; }, 2600);
  }

  // ── Guessing ──────────────────────────────────────────────────────────────────
  function applyGuess(guess) {
    if (phase !== 'playing') return;
    ensureDeck();
    const card = deck[cardIndex];
    const next = deck[cardIndex + 1];
    const correct = guess === 'higher' ? next.value > card.value : next.value < card.value;
    const guesser = currentGuesser;
    cardIndex++;
    peekVisible = false;

    if (correct) {
      // Harder cards (middle values, ~50/50) pay more. Full = 2–10s, Half = 1–5s.
      let gain = lcCardSeconds(card.value, rewardScale);
      if (is1P) {
        streak1P++;
        const streakMult = Math.min(3, 1 + streak1P * 0.15);
        gain *= streakMult;
      }
      if (doubleActive[guesser]) gain *= 2;
      if (taxed[guesser]) gain /= 2;
      gain = Math.round(gain * 10) / 10;
      pot += gain;
      if (powerMap.has(cardIndex)) {
        const t = powerMap.get(cardIndex);
        powerups[guesser].push({ type: t, uid: `${cardIndex}` });
        const streakTag = is1P && streak1P > 1 ? ` ×${Math.min(3, 1 + streak1P * 0.15).toFixed(2)}` : '';
        showFeedback(`✓ +${gain.toFixed(1)}s${streakTag}   🎁 ${guesser === myRole ? 'You' : escapeHtml(playerNames[guesser])} got ${LC_POWER_LABELS[t]}`, 'accent');
      } else {
        const streakTag = is1P && streak1P > 1 ? ` ×${Math.min(3, 1 + streak1P * 0.15).toFixed(2)}` : '';
        showFeedback(`✓ +${gain.toFixed(1)}s${streakTag}`, 'accent');
      }
    } else {
      // Mistake — every unbanked second is dropped and the turn passes.
      const lost = pot;
      pot = 0;
      if (is1P) streak1P = 0;
      doubleActive[guesser] = false;
      taxed[guesser] = false;
      showFeedback(guesser === myRole
        ? `✗ Wrong — lost ${lost.toFixed(1)}s of unbanked time`
        : `✗ ${escapeHtml(playerNames[guesser])} missed — dropped ${lost.toFixed(1)}s`, 'warn');
      advanceTurn(guesser);
      return;
    }
    renderState();
  }

  // ── Bank → Claim now / Play on ────────────────────────────────────────────────
  // Pressing Bank stashes the unbanked pot and ends your turn. The pot is only
  // committed once you pick Claim or Play on, so both clients apply it atomically.
  function showBankOverlay() {
    if (phase !== 'playing' || currentGuesser !== myRole || finished[myRole]) return;
    $('lc-bank-overlay')?.remove();
    const projected = bank[myRole] + pot;
    const ov = document.createElement('div');
    ov.id = 'lc-bank-overlay';
    ov.className = 'hilo-overlay';
    ov.innerHTML = `
      <div class="hilo-overlay-box">
        <h2 style="text-align:center;margin:0 0 6px;">Bank ${fmtSecs(pot)}</h2>
        <p style="text-align:center;color:var(--muted);margin:0 0 16px;">${is1P ? `Your bank becomes <strong>${fmtSecs(projected)}</strong>. Claim now to run the vibe, or keep guessing?` : `Stashed safe — your bank becomes <strong>${fmtSecs(projected)}</strong>. Your turn ends. Claim now or play on?`}</p>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <button data-bank="claim" style="background:var(--warn);" ${projected > 0 ? '' : 'disabled'}>▶ Claim now — run the vibe (${fmtSecs(projected)})</button>
          <button data-bank="playon">⏭ ${is1P ? 'Keep guessing' : 'Play on (keep it banked)'}</button>
          <button class="ghost" data-bank="cancel" style="font-size:13px;">← keep guessing</button>
        </div>
        ${is1P ? '' : '<p style="text-align:center;font-size:12px;color:var(--muted);margin:14px 0 0;">Claiming drains every player\'s own bank while you control one shared intensity slider.</p>'}
      </div>`;
    root.appendChild(ov);
    ov.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-bank]');
      if (!btn) return;
      if (btn.dataset.bank === 'cancel') { ov.remove(); return; }
      handleBankDecision(btn.dataset.bank);
    });
  }

  function handleBankDecision(choice) {
    if (phase !== 'playing' || currentGuesser !== myRole) return;
    $('lc-bank-overlay')?.remove();
    if (!is1P) socket.send({ type: MSG.LC_RESOLVE, choice });
    applyResolveBank(choice, myRole);
  }

  function applyResolveBank(choice, fromRole) {
    if (phase !== 'playing' || currentGuesser !== fromRole) return;
    $('lc-bank-overlay')?.remove();
    bank[fromRole] += pot;
    pot = 0;
    if (is1P) streak1P = 0;
    if (choice === 'claim') startRun(fromRole);
    else advanceTurn(fromRole);
    renderState();
  }

  function advanceTurn(fromRole) {
    const idx = playerRoles.indexOf(fromRole);
    let next = null;
    for (let k = 1; k <= playerRoles.length; k++) {
      const r = playerRoles[(idx + k) % playerRoles.length];
      if (!finished[r]) { next = r; break; }
    }
    if (!next) { showGameOver('all_finished'); return; }
    currentGuesser = next;
    phase = 'playing';
    renderState();
  }

  // ── Run session ───────────────────────────────────────────────────────────────
  function startRun(runnerRole) {
    phase = 'running';
    runRunner = runnerRole;
    runLevel = lastRunLevel;
    runPattern = !!patternArmed[runnerRole];
    patternArmed[runnerRole] = false;
    runPhase = 0;
    runTickCount = 0;
    hijackController = null;
    hijackUntil = 0;
    runActive = new Set(playerRoles.filter(r => !finished[r] && bank[r] > 0));
    showRunOverlay();
    applyMyDevice();
    if (!runLoop) runLoop = setInterval(runStep, 100);
    renderState();
  }

  function effLevel() {
    if (!runPattern) return runLevel;
    const wave = 0.78 + 0.22 * Math.sin(runPhase * 0.18);
    return Math.max(0, Math.min(1, runLevel * wave));
  }

  function applyMyDevice() {
    if (!haptics.isConnected()) return;
    if (phase === 'running' && runActive.has(myRole) && !finished[myRole]) {
      haptics.testVibe(effLevel());
    } else {
      haptics.testVibe(0);
    }
  }

  function runStep() {
    runPhase++;
    // Hijack window expiry (deterministic via shared timestamp)
    if (hijackController && Date.now() >= hijackUntil) {
      hijackController = null;
      updateRunControls();
    }
    // Decrement every active bank locally (runner broadcasts authoritative ticks)
    for (const r of playerRoles) {
      if (!runActive.has(r)) continue;
      bank[r] = Math.max(0, bank[r] - 0.1);
      if (bank[r] <= 0) {
        runActive.delete(r);
        if (r === myRole) haptics.testVibe(0);
      }
    }
    applyMyDevice();
    renderRunOverlay();
    renderScorebar();

    if (isRunner()) {
      runTickCount++;
      if (!is1P && runTickCount % 3 === 0) {
        socket.send({ type: MSG.LC_RUN_TICK, banks: snapshotBanks() });
      }
      if (!runActive.has(runRunner) || runActive.size === 0) {
        if (!is1P) socket.send({ type: MSG.LC_RUN_STOP, banks: snapshotBanks() });
        endRun();
      }
    }
  }

  const snapshotBanks = () => ({ host: bank.host, guest: bank.guest, guest2: bank.guest2 });

  function endRun() {
    if (runLoop) { clearInterval(runLoop); runLoop = null; }
    haptics.testVibe(0);
    const finisher = runRunner;
    runActive = new Set();
    runRunner = null;
    hijackController = null;
    runPattern = false;
    $('lc-run-overlay')?.remove();
    if (phase === 'running') advanceTurn(finisher);
    else renderState();
  }

  function showRunOverlay() {
    $('lc-run-overlay')?.remove();
    const ov = document.createElement('div');
    ov.id = 'lc-run-overlay';
    ov.className = 'hilo-overlay';
    ov.innerHTML = `
      <div class="hilo-overlay-box">
        <h2 style="text-align:center;margin:0 0 4px;">Running the vibes</h2>
        <p id="lc-run-controller" style="text-align:center;color:var(--muted);margin:0 0 14px;"></p>
        <div id="lc-run-banks" style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;"></div>
        <div class="forfeit-slider-row" id="lc-run-slider-row" style="margin-bottom:16px;">
          <span>Intensity</span>
          <input type="range" id="lc-run-slider" min="0" max="100" value="${Math.round(runLevel * 100)}" style="flex:1;margin:0 12px;accent-color:var(--warn);">
          <span id="lc-run-pct">${Math.round(runLevel * 100)}%</span>
        </div>
        <div id="lc-run-powerups" class="hilo-powerups" style="margin-bottom:8px;"></div>
        <div style="display:flex;gap:12px;justify-content:center;">
          ${'<button class="ghost" id="lc-run-finish" style="background:var(--warn);">🏁 I\'m finished</button>'}
          <button id="lc-run-stop">Stop</button>
        </div>
      </div>`;
    root.appendChild(ov);

    const slider = $('lc-run-slider');
    slider.addEventListener('input', () => {
      if (!iControlSlider()) return;
      runLevel = slider.value / 100;
      lastRunLevel = runLevel;
      $('lc-run-pct').textContent = `${slider.value}%`;
      applyMyDevice();
      if (!is1P) socket.send({ type: MSG.LC_RUN_LEVEL, level: runLevel });
    });

    $('lc-run-stop').addEventListener('click', () => {
      if (!isRunner()) return;
      if (!is1P) socket.send({ type: MSG.LC_RUN_STOP, banks: snapshotBanks() });
      endRun();
    });
    $('lc-run-finish').addEventListener('click', handleFinish);

    updateRunControls();
    renderRunOverlay();
  }

  // Toggle who can drive the slider / stop, without recreating the input mid-drag.
  function updateRunControls() {
    const box = $('lc-run-overlay');
    if (!box) return;
    const ctrlEl = $('lc-run-controller');
    const sliderRow = $('lc-run-slider-row');
    const slider = $('lc-run-slider');
    const stopBtn = $('lc-run-stop');
    const controllerRole = hijackController || runRunner;
    if (ctrlEl) {
      ctrlEl.textContent = is1P
        ? 'You control the vibe'
        : controllerRole === myRole
          ? (hijackController === myRole ? 'You hijacked the controls!' : 'You control both devices')
          : `${escapeHtml(playerNames[controllerRole])} controls the intensity`;
    }
    if (slider) {
      slider.disabled = !iControlSlider();
      sliderRow.style.opacity = iControlSlider() ? '1' : '0.6';
    }
    if (stopBtn) stopBtn.style.display = isRunner() ? '' : 'none';
    renderRunPowerUps();
  }

  function renderRunPowerUps() {
    const el = $('lc-run-powerups');
    if (!el) return;
    // Only Hijack is usable mid-run; surface it here for non-runners.
    const usable = powerups[myRole]?.filter(p => p.type === 'hijack') || [];
    if (finished[myRole] || runRunner === myRole || hijackController === myRole || usable.length === 0) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `<div class="hilo-pu-btns" id="lc-run-pu-btns" style="justify-content:center;">
      <button class="hilo-pu-btn" data-pu-type="hijack" title="${escapeHtml(LC_POWER_DESC.hijack)}">${LC_POWER_LABELS.hijack}</button></div>`;
    $('lc-run-pu-btns').addEventListener('click', () => {
      const idx = powerups[myRole].findIndex(p => p.type === 'hijack');
      if (idx !== -1) tryUsePowerUp('hijack', idx);
    });
  }

  function renderRunOverlay() {
    const banksEl = $('lc-run-banks');
    if (banksEl) {
      banksEl.innerHTML = playerRoles.map(r => {
        const active = runActive.has(r);
        const colour = active ? 'var(--warn)' : 'var(--muted)';
        const label = finished[r] ? 'finished 🏁' : (active ? `vibing · ${fmtSecs(bank[r])}` : (bank[r] > 0 ? `idle · ${fmtSecs(bank[r])}` : 'empty'));
        return `<div style="display:flex;justify-content:space-between;color:${colour};">
            <span>${escapeHtml(playerNames[r])}${r === myRole ? ' (you)' : ''}</span><span>${label}</span></div>`;
      }).join('');
    }
    const slider = $('lc-run-slider');
    if (slider && !iControlSlider()) {
      slider.value = Math.round(runLevel * 100);
      const pct = $('lc-run-pct');
      if (pct) pct.textContent = `${Math.round(runLevel * 100)}%`;
    }
  }

  // ── Power-ups ─────────────────────────────────────────────────────────────────
  function tryUsePowerUp(type, idx) {
    const inv = powerups[myRole];
    if (!inv[idx] || inv[idx].type !== type) {
      const alt = inv.findIndex(p => p.type === type);
      if (alt === -1) return;
      idx = alt;
    }
    if (!isPowerUpUsable(type)) return;
    let target = null;
    if (type === 'drain' || type === 'tax') {
      const targets = otherTargets();
      if (targets.length === 0) return;
      target = targets[0]; // 2-player: the only opponent. 3-player picks the leader.
      if (targets.length > 1) target = targets.reduce((a, b) => bank[b] > bank[a] ? b : a, targets[0]);
    }
    if (!is1P) socket.send({ type: MSG.LC_POWERUP, puType: type, target });
    applyPowerUp(type, myRole, target);
  }

  function applyPowerUp(type, fromRole, target) {
    const inv = powerups[fromRole];
    const idx = inv.findIndex(p => p.type === type);
    if (idx === -1) return;
    inv.splice(idx, 1);
    const who = fromRole === myRole ? 'You' : escapeHtml(playerNames[fromRole]);

    switch (type) {
      case 'peek':
        if (fromRole === myRole) peekVisible = true;
        showFeedback(`👁 ${who} peeked`, 'accent');
        break;
      case 'doubledown':
        doubleActive[fromRole] = true;
        showFeedback(`✕2 ${who} doubled down`, 'accent');
        break;
      case 'pattern':
        patternArmed[fromRole] = true;
        showFeedback(`〰 ${who} armed a pattern for the next run`, 'accent');
        break;
      case 'leech':
        leechArmed[fromRole] = true;
        showFeedback(`🩸 ${who} armed Leech — next Drain banks to you`, 'accent');
        break;
      case 'lockbox':
        shielded[fromRole] = true;
        showFeedback(`🔒 ${who} locked their bank`, 'accent');
        break;
      case 'drain':
        if (target && !finished[target]) {
          if (shielded[target]) {
            shielded[target] = false;
            leechArmed[fromRole] = false;
            showFeedback(`🔒 ${escapeHtml(playerNames[target])}'s lockbox blocked the drain!`, 'warn');
          } else {
            const before = bank[target];
            bank[target] = Math.max(0, before - 30);
            const drained = before - bank[target];
            if (leechArmed[fromRole]) {
              leechArmed[fromRole] = false;
              bank[fromRole] += drained;
              showFeedback(`🩸 ${who} leeched ${fmtSecs(drained)} from ${escapeHtml(playerNames[target])}`, 'warn');
            } else {
              showFeedback(`🧲 ${who} drained ${fmtSecs(drained)} from ${escapeHtml(playerNames[target])}`, 'warn');
            }
          }
        }
        break;
      case 'tax':
        if (target && !finished[target]) {
          taxed[target] = true;
          showFeedback(`💸 ${who} taxed ${escapeHtml(playerNames[target])}`, 'warn');
        }
        break;
      case 'timeheist':
        if (timerMode && deadline) {
          deadline -= 60_000;
          showFeedback(`⏱ ${who} cut 60s off the clock`, 'warn');
        }
        break;
      case 'hijack':
        if (phase === 'running' && fromRole !== runRunner) {
          hijackController = fromRole;
          hijackUntil = Date.now() + 10_000;
          showFeedback(`🎚 ${who} hijacked the controls for 10s`, 'warn');
          updateRunControls();
        }
        break;
    }
    renderState();
    if (phase === 'running') updateRunControls();
  }

  // ── Finish ────────────────────────────────────────────────────────────────────
  function handleFinish() {
    if (finished[myRole] || phase === 'gameover') return;
    if (!is1P) socket.send({ type: MSG.LC_FINISH });
    applyFinish(myRole);
  }

  function applyFinish(role) {
    if (finished[role]) return;
    finished[role] = true;
    if (role === myRole) haptics.testVibe(0);

    if (phase === 'running') {
      runActive.delete(role);
      if (role === runRunner) {
        endRun(); // advances turn off the (now finished) runner
      } else {
        if (hijackController === role) { hijackController = null; updateRunControls(); }
        renderRunOverlay();
        updateRunControls();
      }
    } else if (phase === 'playing' && currentGuesser === role) {
      if (role === myRole) $('lc-bank-overlay')?.remove();
      pot = 0; // unbanked time is moot once you've finished
      advanceTurn(role);
    }

    if (playerRoles.every(r => finished[r])) { showGameOver('all_finished'); return; }
    showFeedback(`🏁 ${role === myRole ? 'You' : escapeHtml(playerNames[role])} finished`, 'accent');
    renderState();
  }

  // ── Timer ─────────────────────────────────────────────────────────────────────
  function startTimer() {
    deadline = Date.now() + totalMs;
    timerInterval = setInterval(() => {
      if (phase === 'gameover') return;
      if (Date.now() >= deadline) {
        clearInterval(timerInterval); timerInterval = null;
        onTimeUp();
      } else {
        const c = $('lc-clock');
        if (c) {
          const rem = Math.max(0, deadline - Date.now());
          const m = Math.floor(rem / 60000);
          const s = Math.floor((rem % 60000) / 1000);
          c.textContent = `${m}:${String(s).padStart(2, '0')}`;
          c.style.color = rem < 30000 ? 'var(--warn)' : 'var(--ink)';
        }
      }
    }, 250);
  }

  function onTimeUp() {
    if (phase === 'gameover') return;
    if (runLoop) { clearInterval(runLoop); runLoop = null; }
    haptics.testVibe(0);
    $('lc-run-overlay')?.remove();
    $('lc-bank-overlay')?.remove();
    runActive = new Set();
    showGameOver('time');
  }

  // ── Game over ───────────────────────────────────────────────────────────────
  function showGameOver(cause) {
    if (phase === 'gameover') return;
    phase = 'gameover';
    if (runLoop) { clearInterval(runLoop); runLoop = null; }
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    haptics.testVibe(0);
    $('lc-run-overlay')?.remove();
    $('lc-bank-overlay')?.remove();
    document.getElementById('lc-arena').style.display = 'none';
    $('lc-guess-btns').style.display = 'none';
    $('lc-bank-row').style.display = 'none';
    $('lc-powerups').innerHTML = '';
    $('lc-finish-btn').style.display = 'none';

    const losers = playerRoles.filter(r => !finished[r]);
    const iLost = losers.includes(myRole);

    let headline, body = '';
    if (cause === 'time' && iLost) {
      headline = `<p style="color:var(--warn);font-size:20px;font-weight:800;">⏱ Time! You didn't finish — forfeit</p>`;
      haptics.startForfeitVibe(forfeitSecs);
      body = `<p style="text-align:center;color:var(--muted);">Forfeit vibe: ${forfeitSecs}s</p>
        <button class="ghost" id="lc-stop-forfeit" style="display:block;margin:8px auto 0;">Stop vibe</button>`;
    } else if (cause === 'time') {
      headline = `<p style="color:var(--accent);font-size:20px;font-weight:800;">🏁 You made it!</p>`;
      if (losers.length) body = `<p style="text-align:center;color:var(--muted);">${losers.map(r => escapeHtml(playerNames[r])).join(', ')} didn't finish — forfeit.</p>`;
    } else {
      headline = `<p style="color:var(--accent);font-size:20px;font-weight:800;">🎉 Everyone finished!</p>`;
    }

    const rows = playerRoles.map(r => `
      <div class="hilo-round-score-cell">
        <div class="hilo-round-score-name">${finished[r] ? '🏁' : '✗'} ${escapeHtml(playerNames[r])}${r === myRole ? ' (you)' : ''}</div>
        <div style="font-size:13px;color:var(--muted);">${finished[r] ? 'finished' : 'forfeit'} · bank ${fmtSecs(bank[r])}</div>
      </div>`).join('');

    const ov = document.createElement('div');
    ov.className = 'hilo-overlay';
    ov.innerHTML = `
      <div class="hilo-overlay-box">
        <h2 style="text-align:center;">Game Over</h2>
        ${headline}
        <div class="hilo-round-scores" style="margin:16px 0;">${rows}</div>
        ${body}
        <div style="display:flex;justify-content:center;margin-top:12px;">
          <button id="lc-back-lobby">Back to Lobby</button>
        </div>
      </div>`;
    root.appendChild(ov);
    renderScorebar();

    $('lc-stop-forfeit')?.addEventListener('click', () => { haptics.stopAll(); });
    $('lc-back-lobby').addEventListener('click', () => {
      haptics.stopAll();
      state.seed = null;
      navigate(`#/session/${state.sessionId}`);
    });
  }

  // ── Socket handlers ───────────────────────────────────────────────────────────
  const onGuess   = (ev) => applyGuess(ev.detail.guess);
  const onResolve = (ev) => applyResolveBank(ev.detail.choice, ev.detail.role);
  const onPowerUp = (ev) => applyPowerUp(ev.detail.puType, ev.detail.role, ev.detail.target);
  const onFinish  = (ev) => applyFinish(ev.detail.role);

  const onRunLevel = (ev) => {
    runLevel = ev.detail.level;
    if (!iControlSlider()) { applyMyDevice(); renderRunOverlay(); }
  };
  const onRunTick = (ev) => {
    if (phase !== 'running') return;
    const banks = ev.detail.banks || {};
    for (const r of playerRoles) {
      if (typeof banks[r] === 'number') {
        bank[r] = banks[r];
        if (bank[r] <= 0 && runActive.has(r)) {
          runActive.delete(r);
          if (r === myRole) haptics.testVibe(0);
        }
      }
    }
    applyMyDevice();
    renderRunOverlay();
    renderScorebar();
  };
  const onRunStop = (ev) => {
    if (phase !== 'running') return;
    const banks = ev.detail.banks || {};
    for (const r of playerRoles) if (typeof banks[r] === 'number') bank[r] = banks[r];
    endRun();
  };

  const onPeerLeft = (ev) => {
    cleanup();
    haptics.stopAll();
    const leftName = ev.detail?.role ? escapeHtml(playerNames[ev.detail.role] || ev.detail.role) : 'A player';
    root.innerHTML = `
      <div class="card">
        <h2>${leftName} left</h2>
        <div class="actions"><button id="lc-peer-home">Home</button></div>
      </div>`;
    root.querySelector('#lc-peer-home').addEventListener('click', () => { location.hash = '#/'; });
  };

  if (!is1P) {
    socket.addEventListener(MSG.LC_GUESS, onGuess);
    socket.addEventListener(MSG.LC_RESOLVE, onResolve);
    socket.addEventListener(MSG.LC_POWERUP, onPowerUp);
    socket.addEventListener(MSG.LC_FINISH, onFinish);
    socket.addEventListener(MSG.LC_RUN_LEVEL, onRunLevel);
    socket.addEventListener(MSG.LC_RUN_TICK, onRunTick);
    socket.addEventListener(MSG.LC_RUN_STOP, onRunStop);
    socket.addEventListener(MSG.PEER_LEFT, onPeerLeft);
  }

  // ── DOM handlers ──────────────────────────────────────────────────────────────
  function handleMyGuess(guess) {
    if (phase !== 'playing' || currentGuesser !== myRole || finished[myRole]) return;
    if (!is1P) socket.send({ type: MSG.LC_GUESS, guess });
    applyGuess(guess);
  }
  $('lc-higher').addEventListener('click', () => handleMyGuess('higher'));
  $('lc-lower').addEventListener('click', () => handleMyGuess('lower'));
  $('lc-bank-btn').addEventListener('click', showBankOverlay);
  $('lc-finish-btn').addEventListener('click', handleFinish);

  $('lc-vibe-btn').addEventListener('click', async () => {
    const btn = $('lc-vibe-btn');
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

  $('lc-leave').addEventListener('click', () => {
    haptics.stopAll();
    state.seed = null;
    navigate(`#/session/${state.sessionId}`);
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────────
  function cleanup() {
    if (runLoop) { clearInterval(runLoop); runLoop = null; }
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    clearTimeout(feedbackTimer);
    if (!is1P) {
      socket.removeEventListener(MSG.LC_GUESS, onGuess);
      socket.removeEventListener(MSG.LC_RESOLVE, onResolve);
      socket.removeEventListener(MSG.LC_POWERUP, onPowerUp);
      socket.removeEventListener(MSG.LC_FINISH, onFinish);
      socket.removeEventListener(MSG.LC_RUN_LEVEL, onRunLevel);
      socket.removeEventListener(MSG.LC_RUN_TICK, onRunTick);
      socket.removeEventListener(MSG.LC_RUN_STOP, onRunStop);
      socket.removeEventListener(MSG.PEER_LEFT, onPeerLeft);
    }
  }
  window.addEventListener('hashchange', () => { cleanup(); haptics.stopAll(); }, { once: true });

  // ── Go ────────────────────────────────────────────────────────────────────────
  if (timerMode) startTimer();
  renderState();
  showFeedback(currentGuesser === myRole ? 'You go first!' : `${escapeHtml(playerNames[currentGuesser])} goes first`, 'accent');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
