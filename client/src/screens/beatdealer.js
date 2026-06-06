import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import {
  dealHands, buildForfeitPool, HAND_SIZE,
  cardLabel, isRed, beats, parseVibeForfeit, forfeitTier, pickDealerCardByTier,
} from '../game/beatdealerGame.js';
import { setBtdVibe } from '../haptics.js';

const SUITS = { S: '♠', H: '♥', D: '♦', C: '♣' };
const D6 = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const TOTAL_ROUNDS = 10;

export function renderBeatDealer(root) {
  const myRole = state.role;
  const myName = (myRole === 'host' ? state.hostName : state.guestName) || 'You';
  const oppName = (myRole === 'host' ? state.guestName : state.hostName) || 'Opponent';

  // Hands are dealt HAND_SIZE at a time; when they run out we re-deal a fresh
  // shuffle (dealIndex bumps). dealerHand holds the dealer's *unplayed* cards.
  let dealIndex = 0;
  let deal = dealHands(state.seed, dealIndex);
  let myHand = myRole === 'host' ? deal.host : deal.guest;
  let oppHand = myRole === 'host' ? deal.guest : deal.host;
  let dealerHand = [...deal.computer];
  let currentDealerCard = null; // the dealer's chosen card for the current round

  const forfeitQueue = buildForfeitPool(state.seed);
  let forfeitPos = 0;

  let roundIndex = 0;
  let myScore = 0;
  let oppScore = 0;

  let phase = 'playing'; // 'playing' | 'revealing' | 'revealed' | 'done'
  let myCardIdx = null;
  let oppCardIdx = null;
  let myPrior = new Set();
  let oppPrior = new Set();
  let myNextReady = false;
  let oppNextReady = false;
  let forfeitDrawn = false;
  let forfeitAssigned = false; // prevents double-addForfeit when draw click echoes back
  let drawnForfeitText = null; // set from host's BTD_DRAW_FORFEIT payload on guest side
  let revealTimer = null;

  // ── Timer state ───────────────────────────────────────────────
  let timerRunning = false;
  let timerStartAt = null; // epoch ms when timer was last started
  let timerElapsed = 0;    // ms accumulated before current start
  let timerInterval = null;

  // ── D6 state ─────────────────────────────────────────────────
  let d6Result = null;

  // ── Vibe state ────────────────────────────────────────────────
  let vibeEnabled = true; // master on/off (host-broadcast)
  let myVibeLevel = 0;    // 0.0–1.0 in 0.1 steps
  let vibeOffSeconds = 0; // countdown for win grace period
  let vibeOffInterval = null;

  // ── Forfeit mode & penalty piles ─────────────────────────────
  let forfeitMode = 'draw'; // 'draw' | 'reveal'
  let hostForfeits = [];    // { text, vibeSeconds: number|null }[]
  let guestForfeits = [];
  let hostVibeTotal = 0;    // accumulated unclaimed vibe seconds
  let guestVibeTotal = 0;
  // Per-player vibe claim state — countdown runs directly on vibeTotal so new forfeits auto-extend it
  const vibeRunning = { host: false, guest: false };
  const vibeClaimIntervals = { host: null, guest: null };
  const claimIntensity = { host: 1.0, guest: 1.0 }; // claimer's slider per target
  let myActiveClaim = false; // whether I'm currently being claimed

  // ── Helpers ───────────────────────────────────────────────────

  function applyVibe(level) {
    if (myActiveClaim) return; // claim controls my device
    if (vibeEnabled) setBtdVibe(level);
  }

  function currentForfeit() {
    return drawnForfeitText !== null ? drawnForfeitText : forfeitQueue[forfeitPos % forfeitQueue.length];
  }

  function myChosen()  { return myCardIdx !== null; }
  function oppChosen() { return oppCardIdx !== null; }

  // Small ★/★★/★★★ difficulty badge for a forfeit.
  function tierBadgeHtml(text) {
    const t = forfeitTier(text);
    return `<span class="btd-tier btd-tier-${t}" title="Difficulty ${t} of 3">${'★'.repeat(t)}</span>`;
  }

  // A player wins only by playing a card strictly higher than the dealer.
  // A sacrificed (lower-or-equal) card is a loss.
  function won(cardIdx, hand) {
    return cardIdx !== null && beats(hand[cardIdx], effectiveCpuCard());
  }

  function anyoneLost() {
    if (phase !== 'revealed' || !myChosen() || !oppChosen()) return false;
    return !won(myCardIdx, myHand) || !won(oppCardIdx, oppHand);
  }

  function effectiveCpuCard() {
    return currentDealerCard;
  }

  // Re-deal HAND_SIZE fresh cards once the dealer's hand is exhausted.
  function redealIfNeeded() {
    if (dealerHand.length > 0) return;
    dealIndex++;
    deal = dealHands(state.seed, dealIndex);
    myHand = myRole === 'host' ? deal.host : deal.guest;
    oppHand = myRole === 'host' ? deal.guest : deal.host;
    dealerHand = [...deal.computer];
    myPrior = new Set();
    oppPrior = new Set();
  }

  // Choose the dealer's card for the round: higher forfeit tier → higher card.
  function selectDealerCard() {
    redealIfNeeded();
    const tier = forfeitTier(currentForfeit());
    currentDealerCard = pickDealerCardByTier(dealerHand, tier);
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

  function addForfeit(loser, text) {
    const vibeSeconds = parseVibeForfeit(text);
    if (loser === 'host' || loser === 'both') {
      hostForfeits.push({ text, vibeSeconds });
      if (vibeSeconds) hostVibeTotal += vibeSeconds;
    }
    if (loser === 'guest' || loser === 'both') {
      guestForfeits.push({ text, vibeSeconds });
      if (vibeSeconds) guestVibeTotal += vibeSeconds;
    }
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

  // Commit one card against the revealed dealer card. Any card is legal —
  // beat the dealer to win, or sacrifice a low card to save your good ones.
  function chooseCard(idx) {
    if (phase !== 'playing' || myChosen() || myPrior.has(idx)) return;
    myCardIdx = idx;
    socket.send({ type: MSG.BTD_PLAY, cardIndex: idx });
    if (oppChosen()) tryReveal();
    else render();
  }

  function updateVibeAfterReveal() {
    const myWon = won(myCardIdx, myHand);
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
    if (!myChosen() || !oppChosen() || phase !== 'playing') return;
    phase = 'revealing';
    render();
    revealTimer = setTimeout(() => {
      revealTimer = null;
      phase = 'revealed';
      const myWon = won(myCardIdx, myHand);
      const oppWon = won(oppCardIdx, oppHand);
      if (myWon) myScore++;
      if (oppWon) oppScore++;
      updateVibeAfterReveal();

      // In reveal mode, auto-assign the pre-shown forfeit to losers
      if (forfeitMode === 'reveal' && (!myWon || !oppWon)) {
        forfeitDrawn = true;
        forfeitAssigned = true;
        const text = forfeitQueue[forfeitPos % forfeitQueue.length];
        drawnForfeitText = text;
        const myR = myRole;
        const oppR = myRole === 'host' ? 'guest' : 'host';
        if (!myWon && !oppWon) addForfeit('both', text);
        else if (!myWon) addForfeit(myR, text);
        else addForfeit(oppR, text);
      }

      render();
    }, 900);
  }

  function checkAdvance() {
    console.log('[BTD] checkAdvance', { myNextReady, oppNextReady, phase, forfeitDrawn, forfeitMode });
    if (myNextReady && oppNextReady) nextRound();
  }

  function nextRound() {
    if (myCardIdx !== null) myPrior.add(myCardIdx);
    if (oppCardIdx !== null) oppPrior.add(oppCardIdx);
    // The dealer's played card leaves its hand (triggers a re-deal once empty).
    const dIdx = dealerHand.indexOf(currentDealerCard);
    if (dIdx >= 0) dealerHand.splice(dIdx, 1);
    myCardIdx = null;
    oppCardIdx = null;
    myNextReady = false;
    oppNextReady = false;
    forfeitDrawn = false;
    forfeitAssigned = false;
    drawnForfeitText = null;

    roundIndex++;
    if (roundIndex >= TOTAL_ROUNDS) {
      phase = 'done';
      clearInterval(vibeOffInterval);
      vibeOffInterval = null;
      vibeOffSeconds = 0;
      clearInterval(vibeClaimIntervals.host);
      clearInterval(vibeClaimIntervals.guest);
      vibeClaimIntervals.host = null;
      vibeClaimIntervals.guest = null;
      vibeRunning.host = false;
      vibeRunning.guest = false;
      myActiveClaim = false;
      setBtdVibe(0);
    } else {
      forfeitPos++;
      selectDealerCard();
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

  function slotHtml(cardIdx, hand) {
    if (cardIdx === null) return emptySlot();
    // The committed card stays face-down (hidden from both) until the reveal.
    if (phase === 'playing' || phase === 'revealing') return cardBack();
    return cardFront(hand[cardIdx], beats(hand[cardIdx], effectiveCpuCard()) ? 'won' : 'lost');
  }

  // The dealer's card is face-up from the start of the round — that's the whole point.
  function cpuSlotHtml() {
    return cardFront(effectiveCpuCard(), 'neutral');
  }

  function renderHand() {
    if (phase !== 'playing') return '';
    const cpu = effectiveCpuCard();
    return myHand.map((card, i) => {
      if (myPrior.has(i) || i === myCardIdx) return '';
      const cls = isRed(card) ? 'red' : 'black';
      const lbl = cardLabel(card);
      const sym = SUITS[card.suit];
      const canPlay = !myChosen(); // any remaining card is legal
      // Hint which cards would actually beat the current dealer card.
      const winsCls = beats(card, cpu) ? ' btd-hand-wins' : '';
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
      const dealerLbl = cardLabel(effectiveCpuCard());
      if (!myChosen() && !oppChosen()) return `Dealer shows <strong>${dealerLbl}</strong> — beat it or sacrifice a card.`;
      if (myChosen() && !oppChosen()) return `Locked in. Waiting for ${esc(oppName)}…`;
      return `${esc(oppName)} has committed — beat <strong>${dealerLbl}</strong> or sacrifice a card.`;
    }
    if (phase === 'revealed') {
      const parts = [
        won(myCardIdx, myHand)
          ? `<span class="btd-won">${esc(myName)} beats the dealer! +1</span>`
          : `<span class="btd-lost">${esc(myName)} loses — take the forfeit!</span>`,
        won(oppCardIdx, oppHand)
          ? `<span class="btd-won">${esc(oppName)} beats the dealer! +1</span>`
          : `<span class="btd-lost">${esc(oppName)} loses — take the forfeit!</span>`,
      ];
      return parts.join('<br>');
    }
    return '';
  }

  function finalMessage() {
    if (myScore > oppScore) return `🎉 ${esc(myName)} wins!`;
    if (oppScore > myScore) return `🎉 ${esc(oppName)} wins!`;
    return "It's a tie!";
  }

  // ── Penalty pile HTML ─────────────────────────────────────────

  function penaltyBoxHtml(boxRole, pile, vibeTotal) {
    const name = boxRole === 'host' ? (state.hostName || 'Host') : (state.guestName || 'Guest');
    const isOpp = boxRole !== myRole;
    const running = vibeRunning[boxRole];
    const remaining = vibeTotal;

    const items = pile.map(f => {
      const isVibe = f.vibeSeconds !== null;
      return `<div class="btd-pile-item${isVibe ? ' btd-pile-vibe' : ''}">${isVibe ? '✦ ' : ''}${esc(f.text)}</div>`;
    }).join('') || `<span class="btd-pile-empty">None yet</span>`;

    let vibeSection = '';
    if (vibeTotal > 0) {
      const label = running
        ? `${formatCountdown(remaining)}`
        : `Vibe owed: ${formatCountdown(vibeTotal)}`;
      vibeSection = `<div class="btd-pile-vibe-total" data-vibe-target="${boxRole}">${label}</div>`;
    }

    let claimBtn = '';
    if (isOpp && vibeTotal > 0) {
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
      <div class="btd-penalty-header">${esc(name)}'s forfeits</div>
      <div class="btd-penalty-list">${items}</div>
      ${vibeSection}${claimBtn}
    </div>`;
  }

  // ── Main render ───────────────────────────────────────────────

  function render() {
    const isLast = roundIndex === TOTAL_ROUNDS - 1;
    const nextLabel = isLast ? 'Finish Game' : 'Next Round';
    const forfeit = currentForfeit();
    const remaining = myHand.length - myPrior.size - (myCardIdx !== null ? 1 : 0);
    const timerDisplay = formatMs(getTimerMs());
    const dealerLbl = cardLabel(effectiveCpuCard());

    // Who lost this round (for actions section) — a fold is always a loss
    let myLost = false, oppLost = false;
    if (phase === 'revealed' && myChosen() && oppChosen()) {
      myLost = !won(myCardIdx, myHand);
      oppLost = !won(oppCardIdx, oppHand);
    }

    // Forfeit loser role for Draw Forfeit button
    function loserRole() {
      if (myLost && oppLost) return 'both';
      if (myLost) return myRole;
      if (oppLost) return myRole === 'host' ? 'guest' : 'host';
      return null;
    }

    // Banner showing upcoming forfeit in reveal mode
    const revealBanner = (forfeitMode === 'reveal' && (phase === 'playing' || phase === 'revealing'))
      ? `<div class="btd-reveal-banner">This round's forfeit: ${tierBadgeHtml(forfeit)} <strong>${esc(forfeit)}</strong></div>`
      : '';

    root.innerHTML = `
      <div class="btd-root">
        <div class="btd-header">
          <button class="ghost btd-btn-leave" style="padding:6px 14px;font-size:13px;">← Leave</button>
          <span class="btd-header-title">Beat the Dealer</span>
          <span class="btd-scoreline">${esc(myName)}: <strong>${myScore}</strong> &nbsp;|&nbsp; ${esc(oppName)}: <strong>${oppScore}</strong></span>
        </div>

        ${myRole === 'host' ? `
          <div class="btd-host-controls">
            <button class="ghost btd-util-btn${forfeitMode === 'reveal' ? ' btd-mode-active' : ''}" id="btd-mode-toggle">
              Mode: ${forfeitMode === 'reveal' ? 'Reveal' : 'Draw'}
            </button>
            <button class="ghost btd-util-btn btd-vibe-toggle${vibeEnabled ? ' btd-vibe-on' : ' btd-vibe-off-btn'}" id="btd-vibe-toggle">
              Vibe: ${vibeEnabled ? 'On' : 'Off'}
            </button>
          </div>
        ` : ''}

        <div class="btd-round-label">Round ${roundIndex + 1} of ${TOTAL_ROUNDS} &nbsp;·&nbsp; Hand ${dealIndex + 1}</div>

        ${revealBanner}

        <div class="btd-main">
          <div class="btd-arena">
            <div class="btd-slot">
              <div class="btd-slot-label">${esc(myName)}</div>
              ${slotHtml(myCardIdx, myHand)}
            </div>
            <div class="btd-slot">
              <div class="btd-slot-label">Dealer 🤖</div>
              ${cpuSlotHtml()}
            </div>
            <div class="btd-slot">
              <div class="btd-slot-label">${esc(oppName)}</div>
              ${slotHtml(oppCardIdx, oppHand)}
            </div>
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
                <button class="ghost btd-util-btn" id="btd-vibe-stop-opp" title="Stop opponent's vibe">⏹ Theirs</button>
              </div>
            </div>
          </div>
        ` : ''}

        ${phase === 'revealed' ? `
          <div class="btd-actions">
            ${(myLost || oppLost) && !forfeitDrawn && forfeitMode === 'draw'
              ? myRole === 'host'
                ? `<button id="btd-draw-forfeit">🃏 Draw Forfeit</button>`
                : `<button disabled>Waiting for host to draw forfeit…</button>`
              : `<button id="btd-next" ${myNextReady ? 'disabled' : ''}>
                   ${myNextReady ? 'Waiting for opponent…' : nextLabel}
                 </button>`
            }
          </div>
        ` : ''}

        ${phase === 'done' ? `
          <div class="btd-final">
            <h2>Game Over!</h2>
            <p class="btd-final-scores">${esc(myName)}: ${myScore} pts &nbsp;|&nbsp; ${esc(oppName)}: ${oppScore} pts</p>
            <p class="btd-final-winner">${finalMessage()}</p>
            <button class="btd-btn-leave">Back to Lobby</button>
          </div>
        ` : ''}

        ${phase === 'playing' ? `
          <div class="btd-hand-section">
            <div class="btd-hand-label">
              Your hand — ${remaining} card${remaining !== 1 ? 's' : ''} ·
              ${myChosen()
                ? 'locked in'
                : `beat <strong>${dealerLbl}</strong> to win, or sacrifice a low card`}
            </div>
            <div class="btd-hand" id="btd-hand">${renderHand()}</div>
          </div>
        ` : ''}

        <div class="btd-penalty-piles">
          ${penaltyBoxHtml('host', hostForfeits, hostVibeTotal)}
          ${penaltyBoxHtml('guest', guestForfeits, guestVibeTotal)}
        </div>
      </div>
    `;

    // ── Listeners ─────────────────────────────────────────────

    root.querySelectorAll('.btd-btn-leave').forEach(btn =>
      btn.addEventListener('click', () => navigate(`#/session/${state.sessionId}`))
    );

    root.querySelector('#btd-mode-toggle')?.addEventListener('click', () => {
      const newMode = forfeitMode === 'draw' ? 'reveal' : 'draw';
      socket.send({ type: MSG.BTD_MODE, mode: newMode });
    });

    root.querySelector('#btd-draw-forfeit')?.addEventListener('click', () => {
      if (forfeitDrawn) return;
      const text = currentForfeit();
      const loser = loserRole();
      console.log('[BTD] draw forfeit clicked', { text, loser, roundIndex });
      forfeitDrawn = true;
      forfeitAssigned = true;
      drawnForfeitText = text;
      if (loser) addForfeit(loser, text);
      socket.send({ type: MSG.BTD_DRAW_FORFEIT, forfeit: text, loser });
      render();
    });

    root.querySelector('#btd-next')?.addEventListener('click', () => {
      if (myNextReady) return;
      console.log('[BTD] next clicked', { roundIndex, phase, myNextReady, oppNextReady, forfeitDrawn });
      myNextReady = true;
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
    if (!Number.isInteger(idx) || idx < 0 || idx > 9) return;
    if (oppChosen() || oppPrior.has(idx)) return;
    oppCardIdx = idx;
    if (myChosen()) tryReveal();
    else render();
  };

  const onNextReady = () => {
    console.log('[BTD] onNextReady received', { phase, myNextReady, oppNextReady });
    oppNextReady = true;
    if (phase === 'revealed') render();
    checkAdvance();
  };

  const onDrawForfeit = (ev) => {
    console.log('[BTD] onDrawForfeit received', { forfeit: ev.detail?.forfeit, loser: ev.detail?.loser, forfeitAssigned });
    const text = ev.detail?.forfeit || currentForfeit();
    drawnForfeitText = text;
    forfeitDrawn = true;
    const loser = ev.detail?.loser;
    if (loser && !forfeitAssigned) {
      forfeitAssigned = true;
      addForfeit(loser, text);
    }
    render();
  };

  const onBtdMode = (ev) => {
    forfeitMode = ev.detail.mode === 'reveal' ? 'reveal' : 'draw';
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
    if (action === 'start') {
      vibeRunning[target] = true;
      if (myRole === target) {
        myActiveClaim = true;
        if (vibeEnabled) setBtdVibe(claimIntensity[target]);
      }
      clearInterval(vibeClaimIntervals[target]);
      vibeClaimIntervals[target] = setInterval(() => {
        if (!vibeRunning[target]) return;
        if (target === 'host') {
          hostVibeTotal = Math.max(0, hostVibeTotal - 1);
          if (hostVibeTotal <= 0) {
            vibeRunning.host = false;
            clearInterval(vibeClaimIntervals.host);
            vibeClaimIntervals.host = null;
            if (myRole === 'host') { myActiveClaim = false; restoreGameVibe(); }
            render();
            return;
          }
          const el = root.querySelector('.btd-pile-vibe-total[data-vibe-target="host"]');
          if (el) el.textContent = formatCountdown(hostVibeTotal);
        } else {
          guestVibeTotal = Math.max(0, guestVibeTotal - 1);
          if (guestVibeTotal <= 0) {
            vibeRunning.guest = false;
            clearInterval(vibeClaimIntervals.guest);
            vibeClaimIntervals.guest = null;
            if (myRole === 'guest') { myActiveClaim = false; restoreGameVibe(); }
            render();
            return;
          }
          const el = root.querySelector('.btd-pile-vibe-total[data-vibe-target="guest"]');
          if (el) el.textContent = formatCountdown(guestVibeTotal);
        }
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
        <h2>Opponent left</h2>
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
  socket.addEventListener(MSG.BTD_MODE, onBtdMode);
  socket.addEventListener(MSG.BTD_VIBE_ENABLE, onVibeEnable);
  socket.addEventListener(MSG.BTD_VIBE_CLAIM, onVibeClaim);
  socket.addEventListener(MSG.BTD_CLAIM_INTENSITY, onClaimIntensity);
  socket.addEventListener(MSG.PEER_LEFT, onPeerLeft);

  window.addEventListener('hashchange', () => {
    clearTimeout(revealTimer);
    clearInterval(timerInterval);
    clearInterval(vibeOffInterval);
    clearInterval(vibeClaimIntervals.host);
    clearInterval(vibeClaimIntervals.guest);
    vibeOffInterval = null;
    vibeClaimIntervals.host = null;
    vibeClaimIntervals.guest = null;
    myActiveClaim = false;
    setBtdVibe(0);
    socket.removeEventListener(MSG.BTD_OPP_PLAY, onOppPlay);
    socket.removeEventListener(MSG.BTD_NEXT_READY, onNextReady);
    socket.removeEventListener(MSG.BTD_DRAW_FORFEIT, onDrawForfeit);
    socket.removeEventListener(MSG.BTD_TIMER_CMD, onTimerCmd);
    socket.removeEventListener(MSG.BTD_D6_ROLL, onD6Roll);
    socket.removeEventListener(MSG.BTD_VIBE_STOP, onVibeStop);
    socket.removeEventListener(MSG.BTD_MODE, onBtdMode);
    socket.removeEventListener(MSG.BTD_VIBE_ENABLE, onVibeEnable);
    socket.removeEventListener(MSG.BTD_VIBE_CLAIM, onVibeClaim);
    socket.removeEventListener(MSG.BTD_CLAIM_INTENSITY, onClaimIntensity);
    socket.removeEventListener(MSG.PEER_LEFT, onPeerLeft);
  }, { once: true });

  selectDealerCard(); // choose the dealer's card for round 1 before first paint
  render();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
