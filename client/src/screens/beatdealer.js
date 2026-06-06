import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import {
  dealHands, buildForfeitPool,
  cardLabel, isRed, beats, parseVibeForfeit, forfeitTier, pickDealerCardByTier,
} from '../game/beatdealerGame.js';
import { setBtdVibe } from '../haptics.js';

const SUITS = { S: '♠', H: '♥', D: '♦', C: '♣' };
const D6 = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const TOTAL_ROUNDS = 10;

export function renderBeatDealer(root) {
  const myRole = state.role;
  // Game mode: 'dealer' (beat one dealer card) | 'h2h' (highest laid card is safe).
  const gameMode = state.btdGameMode === 'h2h' ? 'h2h' : 'dealer';

  // Canonical role order (fixed → deterministic scoring across clients) and the
  // display order (me first). guest2 only present in a 3-player session.
  const ROLES = state.playerCount === 3 ? ['host', 'guest', 'guest2'] : ['host', 'guest'];
  const displayRoles = [myRole, ...ROLES.filter(r => r !== myRole)];

  function nameOf(r) {
    const fallback = { host: 'Host', guest: 'Guest', guest2: 'Guest 3' }[r];
    const named = { host: state.hostName, guest: state.guestName, guest2: state.guest2Name }[r];
    const label = named || fallback;
    return r === myRole ? `${label} (you)` : label;
  }

  // ── Per-player state (keyed by role) ──────────────────────────
  let dealIndex = 0;
  let deal = null;
  let dealerHand = [];           // dealer's *unplayed* cards (dealer mode only)
  let currentDealerCard = null;  // dealer's chosen card for the current round

  const hands = {};      // role → card[]
  const chosen = {};     // role → cardIndex | null
  const prior = {};      // role → Set(playedIndices)
  const scores = {};     // role → int
  const nextReady = {};  // role → bool
  const forfeits = {};   // role → { text, vibeSeconds }[]
  const vibeTotal = {};  // role → accumulated unclaimed vibe seconds
  const vibeRunning = {};        // role → bool (claim countdown active)
  const vibeClaimIntervals = {}; // role → interval handle
  const claimIntensity = {};     // role → claimer's slider (0..1)
  ROLES.forEach(r => {
    chosen[r] = null; prior[r] = new Set(); scores[r] = 0; nextReady[r] = false;
    forfeits[r] = []; vibeTotal[r] = 0; vibeRunning[r] = false;
    vibeClaimIntervals[r] = null; claimIntensity[r] = 1.0;
  });

  function freshDeal() {
    deal = dealHands(state.seed, dealIndex);
    ROLES.forEach(r => { hands[r] = deal[r]; prior[r] = new Set(); });
    dealerHand = [...deal.computer];
  }
  freshDeal();

  const forfeitQueue = buildForfeitPool(state.seed, state.btdForfeits);
  let forfeitPos = 0;

  let roundIndex = 0;

  let phase = 'playing'; // 'playing' | 'revealing' | 'revealed' | 'done'
  let forfeitDrawn = false;
  let forfeitAssigned = false; // prevents double-addForfeit when draw click echoes back
  let drawnForfeitText = null; // set from host's BTD_DRAW_FORFEIT payload on guests
  let revealTimer = null;

  // ── Timer state ───────────────────────────────────────────────
  let timerRunning = false;
  let timerStartAt = null;
  let timerElapsed = 0;
  let timerInterval = null;

  // ── D6 state ─────────────────────────────────────────────────
  let d6Result = null;

  // ── Vibe state ────────────────────────────────────────────────
  let vibeEnabled = true; // master on/off (host-broadcast)
  let myVibeLevel = 0;    // 0.0–1.0 in 0.1 steps
  let vibeOffSeconds = 0; // countdown for win grace period
  let vibeOffInterval = null;
  let myActiveClaim = false; // whether I'm currently being claimed

  // Forfeit mode: 'reveal' shows the round's forfeit up front; 'draw' hides it.
  const forfeitMode = state.btdMode === 'reveal' ? 'reveal' : 'draw';

  // ── Helpers ───────────────────────────────────────────────────

  function applyVibe(level) {
    if (myActiveClaim) return; // claim controls my device
    if (vibeEnabled) setBtdVibe(level);
  }

  function currentForfeit() {
    return drawnForfeitText !== null ? drawnForfeitText : forfeitQueue[forfeitPos % forfeitQueue.length];
  }

  function allChosen() { return ROLES.every(r => chosen[r] !== null); }

  // Small ★/★★/★★★ difficulty badge for a forfeit.
  function tierBadgeHtml(text) {
    const t = forfeitTier(text);
    return `<span class="btd-tier btd-tier-${t}" title="Difficulty ${t} of 3">${'★'.repeat(t)}</span>`;
  }

  function cardVal(r) {
    return chosen[r] !== null ? hands[r][chosen[r]].value : -1;
  }
  function topVal() {
    return Math.max(...ROLES.map(cardVal));
  }

  // Did this player survive the round?
  //  · dealer mode: their card must strictly beat the dealer's card.
  //  · h2h mode: their card must equal the highest laid value (ties are safe).
  function didWin(r) {
    if (chosen[r] === null) return false;
    if (gameMode === 'dealer') return beats(hands[r][chosen[r]], currentDealerCard);
    return cardVal(r) === topVal();
  }

  function loserRoles() {
    return ROLES.filter(r => !didWin(r));
  }

  // Re-deal once the current hand is exhausted (everyone plays one card/round,
  // so all hands empty together). Both clients derive the same cards from seed.
  function redealIfNeeded() {
    if (prior[myRole].size < hands[myRole].length) return;
    dealIndex++;
    freshDeal();
  }

  function selectDealerCard() {
    const tier = forfeitTier(currentForfeit());
    currentDealerCard = pickDealerCardByTier(dealerHand, tier);
  }

  // Set up cards for the upcoming round.
  function prepareRound() {
    redealIfNeeded();
    if (gameMode === 'dealer') selectDealerCard();
  }

  function getTimerMs() {
    return timerRunning ? timerElapsed + (Date.now() - timerStartAt) : timerElapsed;
  }

  function formatMs(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function formatCountdown(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
  }

  function addForfeit(role, text) {
    if (!forfeits[role]) return;
    const vibeSeconds = parseVibeForfeit(text);
    forfeits[role].push({ text, vibeSeconds });
    if (vibeSeconds) vibeTotal[role] += vibeSeconds;
  }

  function ensureTimerInterval() {
    clearInterval(timerInterval);
    timerInterval = null;
    if (timerRunning) {
      timerInterval = setInterval(() => {
        const el = root.querySelector('#btd-timer-display');
        if (el) el.textContent = formatMs(getTimerMs());
      }, 250);
    }
  }

  // ── Game logic ────────────────────────────────────────────────

  // Commit one card. Any card is legal — beat the field to stay safe, or
  // sacrifice a low card to save your good ones for later rounds.
  function chooseCard(idx) {
    if (phase !== 'playing' || chosen[myRole] !== null || prior[myRole].has(idx)) return;
    chosen[myRole] = idx;
    socket.send({ type: MSG.BTD_PLAY, cardIndex: idx });
    if (allChosen()) tryReveal();
    else render();
  }

  function updateVibeAfterReveal(myWon) {
    if (myWon) {
      clearInterval(vibeOffInterval);
      vibeOffInterval = null;
      vibeOffSeconds = 20;
      applyVibe(0);
      vibeOffInterval = setInterval(() => {
        vibeOffSeconds = Math.max(0, vibeOffSeconds - 1);
        const el = root.querySelector('#btd-vibe-off-display');
        if (el) el.textContent = vibeOffSeconds > 0 ? `off ${vibeOffSeconds}s` : '';
        if (vibeOffSeconds <= 0) {
          clearInterval(vibeOffInterval);
          vibeOffInterval = null;
          if (myVibeLevel > 0) applyVibe(myVibeLevel);
        }
      }, 1000);
    } else {
      clearInterval(vibeOffInterval);
      vibeOffInterval = null;
      vibeOffSeconds = 0;
      myVibeLevel = Math.min(1.0, myVibeLevel + 0.1);
      applyVibe(myVibeLevel);
    }
  }

  function tryReveal() {
    if (!allChosen() || phase !== 'playing') return;
    phase = 'revealing';
    render();
    revealTimer = setTimeout(() => {
      revealTimer = null;
      phase = 'revealed';
      const winners = ROLES.filter(didWin);
      const losers = ROLES.filter(r => !winners.includes(r));
      winners.forEach(r => scores[r]++);
      updateVibeAfterReveal(winners.includes(myRole));

      // In reveal mode, auto-assign the pre-shown forfeit to every loser.
      if (forfeitMode === 'reveal' && losers.length) {
        forfeitDrawn = true;
        forfeitAssigned = true;
        const text = forfeitQueue[forfeitPos % forfeitQueue.length];
        drawnForfeitText = text;
        losers.forEach(r => addForfeit(r, text));
      }

      render();
    }, 900);
  }

  function checkAdvance() {
    if (ROLES.every(r => nextReady[r])) nextRound();
  }

  function nextRound() {
    ROLES.forEach(r => { if (chosen[r] !== null) prior[r].add(chosen[r]); });
    // The dealer's played card leaves its hand (triggers a re-deal once empty).
    if (gameMode === 'dealer') {
      const dIdx = dealerHand.indexOf(currentDealerCard);
      if (dIdx >= 0) dealerHand.splice(dIdx, 1);
    }
    ROLES.forEach(r => { chosen[r] = null; nextReady[r] = false; });
    forfeitDrawn = false;
    forfeitAssigned = false;
    drawnForfeitText = null;

    roundIndex++;
    if (roundIndex >= TOTAL_ROUNDS) {
      phase = 'done';
      clearInterval(vibeOffInterval);
      vibeOffInterval = null;
      vibeOffSeconds = 0;
      ROLES.forEach(r => {
        clearInterval(vibeClaimIntervals[r]);
        vibeClaimIntervals[r] = null;
        vibeRunning[r] = false;
      });
      myActiveClaim = false;
      setBtdVibe(0);
    } else {
      forfeitPos++;
      prepareRound();
      phase = 'playing';
    }
    render();
  }

  // ── Timer actions ─────────────────────────────────────────────

  function timerStart() {
    timerStartAt = Date.now();
    timerRunning = true;
    ensureTimerInterval();
    socket.send({ type: MSG.BTD_TIMER_CMD, cmd: 'start', at: timerStartAt });
    render();
  }

  function timerPause() {
    timerElapsed = getTimerMs();
    timerRunning = false;
    ensureTimerInterval();
    socket.send({ type: MSG.BTD_TIMER_CMD, cmd: 'pause', elapsed: timerElapsed });
    render();
  }

  function timerReset() {
    timerElapsed = 0;
    timerRunning = false;
    timerStartAt = null;
    ensureTimerInterval();
    socket.send({ type: MSG.BTD_TIMER_CMD, cmd: 'reset' });
    render();
  }

  // ── Card rendering ────────────────────────────────────────────

  function cardFront(card, outcome) {
    const cls = isRed(card) ? 'red' : 'black';
    const border = outcome === 'won' ? ' btd-card-won' : outcome === 'lost' ? ' btd-card-lost' : '';
    const lbl = cardLabel(card);
    const sym = SUITS[card.suit];
    return `<div class="btd-playing-card ${cls}${border}">
      <div class="btd-card-corner">${lbl}</div>
      <div class="btd-card-center">${sym}</div>
      <div class="btd-card-corner btd-card-br">${lbl}</div>
    </div>`;
  }

  function cardBack() { return `<div class="btd-card-back"></div>`; }
  function emptySlot() { return `<div class="btd-card-empty"></div>`; }

  function slotHtml(role) {
    const idx = chosen[role];
    if (idx === null) return emptySlot();
    // The committed card stays face-down until the reveal.
    if (phase === 'playing' || phase === 'revealing') return cardBack();
    return cardFront(hands[role][idx], didWin(role) ? 'won' : 'lost');
  }

  // The dealer's card is face-up from the start of the round — that's the point.
  function cpuSlotHtml() {
    return cardFront(currentDealerCard, 'neutral');
  }

  function playerSlotsHtml() {
    const slots = displayRoles.map(r => `
      <div class="btd-slot">
        <div class="btd-slot-label">${esc(nameOf(r))}</div>
        ${slotHtml(r)}
      </div>`).join('');
    if (gameMode !== 'dealer') return slots;
    return `${slots}
      <div class="btd-slot">
        <div class="btd-slot-label">Dealer 🤖</div>
        ${cpuSlotHtml()}
      </div>`;
  }

  function renderHand() {
    if (phase !== 'playing') return '';
    return hands[myRole].map((card, i) => {
      if (prior[myRole].has(i) || i === chosen[myRole]) return '';
      const cls = isRed(card) ? 'red' : 'black';
      const lbl = cardLabel(card);
      const sym = SUITS[card.suit];
      const canPlay = chosen[myRole] === null; // any remaining card is legal
      // In dealer mode, hint which cards would beat the visible dealer card.
      const winsCls = (gameMode === 'dealer' && beats(card, currentDealerCard)) ? ' btd-hand-wins' : '';
      return `<div class="btd-hand-card ${cls}${canPlay ? ' btd-playable' : ''}${winsCls}"
                   data-idx="${i}"
                   style="${canPlay ? '' : 'cursor:default;opacity:0.5'}">
        <div class="btd-card-corner">${lbl}</div>
        <div class="btd-card-center">${sym}</div>
        <div class="btd-card-corner btd-card-br">${lbl}</div>
      </div>`;
    }).join('');
  }

  function statusHtml() {
    if (phase === 'revealing') return '🃏 Revealing…';
    if (phase === 'playing') {
      const waiting = ROLES.filter(r => r !== myRole && chosen[r] === null).map(nameOf);
      if (gameMode === 'dealer') {
        const dealerLbl = cardLabel(currentDealerCard);
        if (chosen[myRole] === null) return `Dealer shows <strong>${dealerLbl}</strong> — beat it or sacrifice a card.`;
        if (waiting.length) return `Locked in. Waiting for ${esc(waiting.join(', '))}…`;
        return 'Everyone has committed — revealing…';
      }
      if (chosen[myRole] === null) return `Lay a card — highest wins, ties are safe.`;
      if (waiting.length) return `Locked in. Waiting for ${esc(waiting.join(', '))}…`;
      return 'Everyone has committed — revealing…';
    }
    if (phase === 'revealed') {
      return displayRoles.map(r =>
        didWin(r)
          ? `<span class="btd-won">${esc(nameOf(r))} is safe! +1</span>`
          : `<span class="btd-lost">${esc(nameOf(r))} loses — take the forfeit!</span>`
      ).join('<br>');
    }
    return '';
  }

  function finalMessage() {
    const best = Math.max(...ROLES.map(r => scores[r]));
    const champs = ROLES.filter(r => scores[r] === best);
    if (champs.length === 1) return `🎉 ${esc(nameOf(champs[0]))} wins!`;
    if (champs.length === ROLES.length) return "It's a tie!";
    return `🎉 Tie between ${esc(champs.map(nameOf).join(' & '))}!`;
  }

  // ── Penalty pile HTML ─────────────────────────────────────────

  function penaltyBoxHtml(boxRole) {
    const pile = forfeits[boxRole];
    const total = vibeTotal[boxRole];
    const isMe = boxRole === myRole;
    const running = vibeRunning[boxRole];

    const items = pile.map(f => {
      const isVibe = f.vibeSeconds !== null;
      return `<div class="btd-pile-item${isVibe ? ' btd-pile-vibe' : ''}">${isVibe ? '✦ ' : ''}${esc(f.text)}</div>`;
    }).join('') || `<span class="btd-pile-empty">None yet</span>`;

    let vibeSection = '';
    if (total > 0) {
      const label = running ? `${formatCountdown(total)}` : `Vibe owed: ${formatCountdown(total)}`;
      vibeSection = `<div class="btd-pile-vibe-total" data-vibe-target="${boxRole}">${label}</div>`;
    }

    let claimBtn = '';
    if (!isMe && total > 0) {
      if (!running) {
        claimBtn = `<button class="ghost btd-util-btn btd-claim-btn" data-claim-target="${boxRole}" data-claim-action="start">Claim</button>`;
      } else {
        const pct = Math.round(claimIntensity[boxRole] * 100);
        claimBtn = `<div class="btd-claim-controls">
          <div class="btd-claim-slider-row">
            <input type="range" class="btd-claim-slider" data-claim-slider="${boxRole}" min="0" max="100" value="${pct}">
            <span class="btd-claim-pct">${pct}%</span>
          </div>
          <button class="ghost btd-util-btn btd-claim-btn" data-claim-target="${boxRole}" data-claim-action="pause">⏸ Stop</button>
        </div>`;
      }
    }

    return `<div class="btd-penalty-box">
      <div class="btd-penalty-header">${esc(nameOf(boxRole))}'s forfeits</div>
      <div class="btd-penalty-list">${items}</div>
      ${vibeSection}${claimBtn}
    </div>`;
  }

  // ── Main render ───────────────────────────────────────────────

  function render() {
    const isLast = roundIndex === TOTAL_ROUNDS - 1;
    const nextLabel = isLast ? 'Finish Game' : 'Next Round';
    const forfeit = currentForfeit();
    const remaining = hands[myRole].length - prior[myRole].size - (chosen[myRole] !== null ? 1 : 0);
    const timerDisplay = formatMs(getTimerMs());

    // Are there any losers this round (drives the Draw Forfeit action)?
    const anyLost = phase === 'revealed' && allChosen() && loserRoles().length > 0;

    const scoreLine = displayRoles
      .map(r => `${esc(nameOf(r))}: <strong>${scores[r]}</strong>`)
      .join(' &nbsp;|&nbsp; ');

    const modeLabel = gameMode === 'dealer' ? 'Vs Dealer' : 'Head to Head';

    // Banner showing the upcoming forfeit in reveal mode.
    const revealBanner = (forfeitMode === 'reveal' && (phase === 'playing' || phase === 'revealing'))
      ? `<div class="btd-reveal-banner">This round's forfeit: ${tierBadgeHtml(forfeit)} <strong>${esc(forfeit)}</strong></div>`
      : '';

    const handHint = gameMode === 'dealer'
      ? `beat <strong>${cardLabel(currentDealerCard)}</strong> to win, or sacrifice a low card`
      : `play your highest to stay safe, or bluff a low card`;

    root.innerHTML = `
      <div class="btd-root">
        <div class="btd-header">
          <button class="ghost btd-btn-leave" style="padding:6px 14px;font-size:13px;">← Leave</button>
          <span class="btd-header-title">Beat the Dealer</span>
          <span class="btd-scoreline">${scoreLine}</span>
        </div>

        ${myRole === 'host' ? `
          <div class="btd-host-controls">
            <button class="ghost btd-util-btn btd-vibe-toggle${vibeEnabled ? ' btd-vibe-on' : ' btd-vibe-off-btn'}" id="btd-vibe-toggle">
              Vibe: ${vibeEnabled ? 'On' : 'Off'}
            </button>
          </div>
        ` : ''}

        <div class="btd-round-label">${modeLabel} &nbsp;·&nbsp; Round ${roundIndex + 1} of ${TOTAL_ROUNDS} &nbsp;·&nbsp; Hand ${dealIndex + 1}</div>

        ${revealBanner}

        <div class="btd-main">
          <div class="btd-arena">
            ${playerSlotsHtml()}
          </div>

          ${forfeitMode === 'draw' ? `
            <div class="btd-forfeit-pile">
              <div class="btd-forfeit-label">Forfeit</div>
              ${forfeitDrawn
                ? `<div class="btd-forfeit-card">${tierBadgeHtml(forfeit)} ${esc(forfeit)}</div>`
                : `<div class="btd-forfeit-back">?</div>`
              }
            </div>
          ` : ''}
        </div>

        <div class="btd-status">${statusHtml()}</div>

        ${phase !== 'done' ? `
          <div class="btd-utils">
            <div class="btd-utils-timer">
              <span class="btd-utils-label">Timer</span>
              <span id="btd-timer-display" class="btd-timer-display">${timerDisplay}</span>
              <div class="btd-utils-btns">
                ${timerRunning
                  ? `<button class="ghost btd-util-btn" id="btd-timer-pause">⏸</button>`
                  : `<button class="ghost btd-util-btn" id="btd-timer-start">▶</button>`
                }
                <button class="ghost btd-util-btn" id="btd-timer-reset">↺</button>
              </div>
            </div>
            <div class="btd-utils-d6">
              <span class="btd-utils-label">D6</span>
              <span class="btd-d6-face">${d6Result !== null ? D6[d6Result] : '—'}</span>
              <button class="ghost btd-util-btn" id="btd-d6-roll">Roll</button>
            </div>
            <div class="btd-utils-vibe">
              <span class="btd-utils-label">Vibe</span>
              <span class="btd-vibe-level">${Math.round(myVibeLevel * 100)}%</span>
              <span id="btd-vibe-off-display" class="btd-vibe-off">${vibeOffSeconds > 0 ? `off ${vibeOffSeconds}s` : ''}</span>
              <div class="btd-utils-btns">
                <button class="ghost btd-util-btn" id="btd-vibe-stop-me" title="Stop your vibe">⏹ Mine</button>
                <button class="ghost btd-util-btn" id="btd-vibe-stop-opp" title="Stop others' vibe">⏹ Theirs</button>
              </div>
            </div>
          </div>
        ` : ''}

        ${phase === 'revealed' ? `
          <div class="btd-actions">
            ${anyLost && !forfeitDrawn && forfeitMode === 'draw'
              ? myRole === 'host'
                ? `<button id="btd-draw-forfeit">🃏 Draw Forfeit</button>`
                : `<button disabled>Waiting for host to draw forfeit…</button>`
              : `<button id="btd-next" ${nextReady[myRole] ? 'disabled' : ''}>
                   ${nextReady[myRole] ? 'Waiting for others…' : nextLabel}
                 </button>`
            }
          </div>
        ` : ''}

        ${phase === 'done' ? `
          <div class="btd-final">
            <h2>Game Over!</h2>
            <p class="btd-final-scores">${displayRoles.map(r => `${esc(nameOf(r))}: ${scores[r]} pts`).join(' &nbsp;|&nbsp; ')}</p>
            <p class="btd-final-winner">${finalMessage()}</p>
            <button class="btd-btn-leave">Back to Lobby</button>
          </div>
        ` : ''}

        ${phase === 'playing' ? `
          <div class="btd-hand-section">
            <div class="btd-hand-label">
              Your hand — ${remaining} card${remaining !== 1 ? 's' : ''} ·
              ${chosen[myRole] !== null ? 'locked in' : handHint}
            </div>
            <div class="btd-hand" id="btd-hand">${renderHand()}</div>
          </div>
        ` : ''}

        <div class="btd-penalty-piles">
          ${displayRoles.map(penaltyBoxHtml).join('')}
        </div>
      </div>
    `;

    // ── Listeners ─────────────────────────────────────────────

    root.querySelectorAll('.btd-btn-leave').forEach(btn =>
      btn.addEventListener('click', () => navigate(`#/session/${state.sessionId}`))
    );

    root.querySelector('#btd-draw-forfeit')?.addEventListener('click', () => {
      if (forfeitDrawn) return;
      const text = currentForfeit();
      const losers = loserRoles();
      forfeitDrawn = true;
      forfeitAssigned = true;
      drawnForfeitText = text;
      losers.forEach(r => addForfeit(r, text));
      socket.send({ type: MSG.BTD_DRAW_FORFEIT, forfeit: text, losers });
      render();
    });

    root.querySelector('#btd-next')?.addEventListener('click', () => {
      if (nextReady[myRole]) return;
      nextReady[myRole] = true;
      socket.send({ type: MSG.BTD_NEXT_READY });
      render();
      checkAdvance();
    });

    root.querySelector('#btd-hand')?.addEventListener('click', (e) => {
      const card = e.target.closest('[data-idx]');
      if (!card) return;
      chooseCard(parseInt(card.dataset.idx, 10));
    });

    root.querySelector('#btd-timer-start')?.addEventListener('click', timerStart);
    root.querySelector('#btd-timer-pause')?.addEventListener('click', timerPause);
    root.querySelector('#btd-timer-reset')?.addEventListener('click', timerReset);

    root.querySelector('#btd-d6-roll')?.addEventListener('click', () => {
      d6Result = Math.ceil(Math.random() * 6);
      socket.send({ type: MSG.BTD_D6_ROLL, value: d6Result });
      render();
    });

    root.querySelector('#btd-vibe-toggle')?.addEventListener('click', () => {
      socket.send({ type: MSG.BTD_VIBE_ENABLE, enabled: !vibeEnabled });
    });

    root.querySelector('#btd-vibe-stop-me')?.addEventListener('click', () => {
      clearInterval(vibeOffInterval);
      vibeOffInterval = null;
      vibeOffSeconds = 0;
      applyVibe(0);
      render();
    });

    root.querySelector('#btd-vibe-stop-opp')?.addEventListener('click', () => {
      socket.send({ type: MSG.BTD_VIBE_STOP });
    });

    root.querySelectorAll('[data-claim-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        socket.send({ type: MSG.BTD_VIBE_CLAIM, target: btn.dataset.claimTarget, action: btn.dataset.claimAction });
      });
    });

    root.querySelectorAll('[data-claim-slider]').forEach(slider => {
      slider.addEventListener('input', () => {
        const target = slider.dataset.claimSlider;
        const intensity = parseInt(slider.value, 10) / 100;
        claimIntensity[target] = intensity;
        const pctEl = slider.closest('.btd-claim-controls')?.querySelector('.btd-claim-pct');
        if (pctEl) pctEl.textContent = `${slider.value}%`;
        socket.send({ type: MSG.BTD_CLAIM_INTENSITY, target, intensity });
      });
    });

    ensureTimerInterval();
  }

  // ── Socket listeners ──────────────────────────────────────────

  const onOppPlay = (ev) => {
    const idx = ev.detail.cardIndex;
    const role = ev.detail.role;
    if (!ROLES.includes(role) || role === myRole) return;
    if (!Number.isInteger(idx) || idx < 0 || idx >= hands[role].length) return;
    if (chosen[role] !== null || prior[role].has(idx)) return;
    chosen[role] = idx;
    if (allChosen()) tryReveal();
    else render();
  };

  const onNextReady = (ev) => {
    const role = ev.detail?.role;
    if (ROLES.includes(role)) nextReady[role] = true;
    if (phase === 'revealed') render();
    checkAdvance();
  };

  const onDrawForfeit = (ev) => {
    const text = ev.detail?.forfeit || currentForfeit();
    drawnForfeitText = text;
    forfeitDrawn = true;
    const losers = Array.isArray(ev.detail?.losers) ? ev.detail.losers : [];
    if (losers.length && !forfeitAssigned) {
      forfeitAssigned = true;
      losers.filter(r => ROLES.includes(r)).forEach(r => addForfeit(r, text));
    }
    render();
  };

  const onVibeEnable = (ev) => {
    vibeEnabled = !!ev.detail.enabled;
    if (!vibeEnabled) {
      setBtdVibe(0);
    } else if (myVibeLevel > 0 && vibeOffSeconds <= 0) {
      setBtdVibe(myVibeLevel);
    }
    render();
  };

  function restoreGameVibe() {
    if (vibeEnabled && vibeOffSeconds <= 0 && myVibeLevel > 0) setBtdVibe(myVibeLevel);
    else setBtdVibe(0);
  }

  const onVibeClaim = (ev) => {
    const { target, action } = ev.detail;
    if (!ROLES.includes(target)) return;
    if (action === 'start') {
      vibeRunning[target] = true;
      if (myRole === target) {
        myActiveClaim = true;
        if (vibeEnabled) setBtdVibe(claimIntensity[target]);
      }
      clearInterval(vibeClaimIntervals[target]);
      vibeClaimIntervals[target] = setInterval(() => {
        if (!vibeRunning[target]) return;
        vibeTotal[target] = Math.max(0, vibeTotal[target] - 1);
        if (vibeTotal[target] <= 0) {
          vibeRunning[target] = false;
          clearInterval(vibeClaimIntervals[target]);
          vibeClaimIntervals[target] = null;
          if (myRole === target) { myActiveClaim = false; restoreGameVibe(); }
          render();
          return;
        }
        const el = root.querySelector(`.btd-pile-vibe-total[data-vibe-target="${target}"]`);
        if (el) el.textContent = formatCountdown(vibeTotal[target]);
      }, 1000);
    } else if (action === 'pause') {
      vibeRunning[target] = false;
      clearInterval(vibeClaimIntervals[target]);
      vibeClaimIntervals[target] = null;
      if (myRole === target) {
        myActiveClaim = false;
        restoreGameVibe();
      }
    }
    render();
  };

  const onClaimIntensity = (ev) => {
    const { target, intensity } = ev.detail;
    if (!ROLES.includes(target)) return;
    claimIntensity[target] = intensity;
    if (vibeRunning[target] && myRole === target && vibeEnabled) setBtdVibe(intensity);
    const slider = root.querySelector(`.btd-claim-slider[data-claim-slider="${target}"]`);
    if (slider) {
      slider.value = Math.round(intensity * 100);
      const pctEl = slider.closest('.btd-claim-controls')?.querySelector('.btd-claim-pct');
      if (pctEl) pctEl.textContent = `${Math.round(intensity * 100)}%`;
    }
  };

  const onTimerCmd = (ev) => {
    const { cmd, at, elapsed } = ev.detail;
    if (cmd === 'start') {
      timerStartAt = at;
      timerRunning = true;
    } else if (cmd === 'pause') {
      timerElapsed = elapsed;
      timerRunning = false;
    } else if (cmd === 'reset') {
      timerElapsed = 0;
      timerRunning = false;
      timerStartAt = null;
    }
    ensureTimerInterval();
    render();
  };

  const onD6Roll = (ev) => {
    d6Result = ev.detail.value;
    render();
  };

  const onVibeStop = () => {
    clearInterval(vibeOffInterval);
    vibeOffInterval = null;
    vibeOffSeconds = 0;
    applyVibe(0);
    render();
  };

  const onPeerLeft = () => {
    clearTimeout(revealTimer);
    clearInterval(timerInterval);
    root.innerHTML = `
      <div class="card" style="text-align:center">
        <h2>A player left</h2>
        <div class="actions" style="justify-content:center;margin-top:16px;">
          <button id="btd-peer-home">Home</button>
        </div>
      </div>`;
    root.querySelector('#btd-peer-home').addEventListener('click', () => { location.hash = '#/'; });
  };

  socket.addEventListener(MSG.BTD_OPP_PLAY, onOppPlay);
  socket.addEventListener(MSG.BTD_NEXT_READY, onNextReady);
  socket.addEventListener(MSG.BTD_DRAW_FORFEIT, onDrawForfeit);
  socket.addEventListener(MSG.BTD_TIMER_CMD, onTimerCmd);
  socket.addEventListener(MSG.BTD_D6_ROLL, onD6Roll);
  socket.addEventListener(MSG.BTD_VIBE_STOP, onVibeStop);
  socket.addEventListener(MSG.BTD_VIBE_ENABLE, onVibeEnable);
  socket.addEventListener(MSG.BTD_VIBE_CLAIM, onVibeClaim);
  socket.addEventListener(MSG.BTD_CLAIM_INTENSITY, onClaimIntensity);
  socket.addEventListener(MSG.PEER_LEFT, onPeerLeft);

  window.addEventListener('hashchange', () => {
    clearTimeout(revealTimer);
    clearInterval(timerInterval);
    clearInterval(vibeOffInterval);
    ROLES.forEach(r => clearInterval(vibeClaimIntervals[r]));
    vibeOffInterval = null;
    ROLES.forEach(r => { vibeClaimIntervals[r] = null; });
    myActiveClaim = false;
    setBtdVibe(0);
    socket.removeEventListener(MSG.BTD_OPP_PLAY, onOppPlay);
    socket.removeEventListener(MSG.BTD_NEXT_READY, onNextReady);
    socket.removeEventListener(MSG.BTD_DRAW_FORFEIT, onDrawForfeit);
    socket.removeEventListener(MSG.BTD_TIMER_CMD, onTimerCmd);
    socket.removeEventListener(MSG.BTD_D6_ROLL, onD6Roll);
    socket.removeEventListener(MSG.BTD_VIBE_STOP, onVibeStop);
    socket.removeEventListener(MSG.BTD_VIBE_ENABLE, onVibeEnable);
    socket.removeEventListener(MSG.BTD_VIBE_CLAIM, onVibeClaim);
    socket.removeEventListener(MSG.BTD_CLAIM_INTENSITY, onClaimIntensity);
    socket.removeEventListener(MSG.PEER_LEFT, onPeerLeft);
  }, { once: true });

  prepareRound(); // choose the dealer's card / cards for round 1 before first paint
  render();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
