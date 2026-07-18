import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';
import { makeRng } from '../game/seededRng.js';
import { buildDeck, gridDims, pickStartingRole, nextRole, isMatch } from '../game/memoryGame.js';
import { initVibeModeBar } from '../vibeModeBar.js';

const SOLO_VIBE_INTENSITY = 0.7;
const SOLO_VIBE_PATTERN = 'steady';

export function renderMemory(root) {
  const myRole = state.role;
  const playerCount = state.playerCount || 2;
  const memMode = state.memMode || 'versus'; // 'versus' | 'solo' | 'watched'
  const noSocket = playerCount === 1; // true solo — nobody else ever connects
  const playerRoles = memMode === 'versus'
    ? (playerCount === 3 ? ['host', 'guest', 'guest2'] : ['host', 'guest'])
    : ['host']; // solo / watched: only host plays and banks — everyone else just watches
  const playerNames = {
    host:   state.hostName   || 'Host',
    guest:  state.guestName  || 'Guest',
    guest2: state.guest2Name || 'Player 3',
  };
  // Fixed left/right assignment (alternating by seat order) so each player's forfeit list lives
  // in its own scrollable side panel — the board itself never grows as lists get longer.
  const leftRoles = playerRoles.filter((_, i) => i % 2 === 0);
  const rightRoles = playerRoles.filter((_, i) => i % 2 === 1);
  const amWatcher = memMode !== 'versus' && myRole !== 'host';
  const vibeDurations = state.memVibeDurations || [];
  const showConnectBtn = vibeDurations.length > 0 && !amWatcher;
  const { cols } = gridDims(state.memGridSize || '6x6');

  const cards = buildDeck({
    forfeitLines:   state.memForfeitLines || [],
    vibeDurations,
    gridSize:       state.memGridSize || '6x6',
    seed:           state.seed,
  });

  const starterRng = makeRng(state.seed);
  let currentRole = pickStartingRole(starterRng, playerRoles);

  const banks = {};
  playerRoles.forEach(r => { banks[r] = { forfeits: [], vibe: [] }; });
  const vibingRoles = new Set();
  const departedRoles = new Set(); // roles whose socket has disconnected mid-game (versus only)

  let flippedThisTurn = [];
  let turnLocked = false;
  let resolveTimer = null;
  let gamePhase = 'playing'; // 'playing' | 'ended'
  let winnerRole = null;

  let selectedTrigger = null; // { role, idx }
  let firingTrigger = null; // { role } — set once "Fire" is pressed; driver stays live until Stop
  let firingSecondsLeft = 0; // driver-side countdown, all fired charges for the live role added together
  let firingCountdownTimer = null;
  let triggerIntensity = 0.6;
  let triggerPattern = 'steady';

  let activeVibe = null; // { secondsLeft, intensity, pattern }
  let vibeCountdownTimer = null;

  const isMyTurn = () => gamePhase === 'playing' && currentRole === myRole;

  // ── HTML ──────────────────────────────────────────────────────────────────
  root.innerHTML = `
    <div class="mem-root" id="mem-root">
      <div class="mem-header">
        <button class="ghost" id="mem-leave">← Leave</button>
        ${showConnectBtn ? `<button id="mem-vibe-btn" class="ghost">${haptics.isConnected() ? '📳' : 'Connect Vibe'}</button>` : ''}
      </div>
      <div class="mem-status" id="mem-status"></div>
      <div id="mem-skip-wrap"></div>
      <div id="mem-vibe-active-wrap"></div>
      <div id="mem-trigger-wrap"></div>
      <div class="mem-board-area" id="mem-board-area">
        <div class="mem-side mem-side-left" id="mem-side-left"></div>
        <div class="mem-grid${amWatcher ? ' mem-grid-watching' : ''}" id="mem-grid" style="--mem-cols:${cols}"></div>
        <div class="mem-side mem-side-right" id="mem-side-right"></div>
      </div>
      <div id="mem-payout-wrap"></div>
    </div>`;

  let vibeModeBarInstance = initVibeModeBar(root.querySelector('.mem-header'), { prepend: false });

  // ── Render ────────────────────────────────────────────────────────────────
  function renderStatus() {
    const el = document.getElementById('mem-status');
    if (el) {
      if (gamePhase === 'ended') {
        el.textContent = winnerRole === myRole ? 'You win! 🏆' : `${playerNames[winnerRole]} wins!`;
      } else if (amWatcher) {
        el.textContent = "Watching — trigger their vibe charges whenever you like";
      } else if (memMode === 'versus') {
        el.textContent = isMyTurn() ? 'Your turn — pick two cards' : `${playerNames[currentRole]}'s turn`;
      } else {
        el.textContent = 'Pick two cards';
      }
    }
    renderSkipTurn();
  }

  function renderSkipTurn() {
    const wrap = document.getElementById('mem-skip-wrap');
    if (!wrap) return;
    const versusStuck = memMode === 'versus' && gamePhase === 'playing' && departedRoles.has(currentRole);
    // solo/watched has no turn to skip — the host is the only player, so a host disconnect
    // just permanently pauses the board for any watchers with nothing else to trigger it.
    const soloStuck = memMode !== 'versus' && gamePhase === 'playing' && departedRoles.has('host');
    if (!versusStuck && !soloStuck) { wrap.innerHTML = ''; return; }
    const message = versusStuck
      ? `${escapeHtml(playerNames[currentRole])} disconnected mid-turn.`
      : `${escapeHtml(playerNames.host)} disconnected — game paused.`;
    wrap.innerHTML = `
      <div class="mem-skip-row">
        <span>${message}</span>
        ${versusStuck ? '<button id="mem-skip-btn" class="ghost">Skip their turn</button>' : ''}
        <button id="mem-return-lobby-btn" class="ghost">Return to Lobby</button>
      </div>`;
    if (versusStuck) document.getElementById('mem-skip-btn').addEventListener('click', skipDisconnectedTurn);
    document.getElementById('mem-return-lobby-btn').addEventListener('click', () => {
      state.seed = null;
      navigate(`#/session/${state.sessionId}`);
    });
  }

  function renderPlayerPanel(r) {
    const bank = banks[r];
    const isMe = r === myRole;
    const active = r === currentRole && gamePhase === 'playing' ? ' mem-player-active' : '';
    const forfeitList = bank.forfeits.length
      ? `<ul class="mem-player-forfeit-list">${bank.forfeits.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`
      : `<div class="mem-player-forfeit-empty">No forfeits yet</div>`;
    const chips = bank.vibe.map((charge, i) => {
      if (charge.used) return `<span class="mem-vibe-chip mem-vibe-chip-used">${charge.duration}s</span>`;
      if (isMe) return `<span class="mem-vibe-chip mem-vibe-chip-mine">${charge.duration}s</span>`;
      return `<button class="mem-vibe-chip" data-mem-trigger-role="${r}" data-mem-trigger-idx="${i}">🔥 ${charge.duration}s</button>`;
    }).join('');
    return `
      <div class="mem-player-panel${active}">
        <div class="mem-player-panel-name">${escapeHtml(playerNames[r])}${isMe ? ' (you)' : ''}${vibingRoles.has(r) ? ' 📳' : ''}</div>
        ${forfeitList}
        ${chips ? `<div class="mem-bank-vibe-chips">${chips}</div>` : ''}
      </div>`;
  }

  function renderSidePanels() {
    const leftEl = document.getElementById('mem-side-left');
    const rightEl = document.getElementById('mem-side-right');
    const boardArea = document.getElementById('mem-board-area');
    if (!leftEl || !rightEl || !boardArea) return;
    leftEl.innerHTML = leftRoles.map(renderPlayerPanel).join('');
    rightEl.innerHTML = rightRoles.map(renderPlayerPanel).join('');
    leftEl.style.display = leftRoles.length ? 'flex' : 'none';
    rightEl.style.display = rightRoles.length ? 'flex' : 'none';
    const cols3 = [];
    if (leftRoles.length) cols3.push('minmax(130px, 210px)');
    cols3.push('1fr');
    if (rightRoles.length) cols3.push('minmax(130px, 210px)');
    boardArea.style.gridTemplateColumns = cols3.join(' ');
  }

  function cardFaceHtml(card) {
    if (card.kind === 'forfeit') return `<div class="mem-card-icon">🎯</div><div class="mem-card-label">${escapeHtml(card.label)}</div>`;
    if (card.kind === 'vibe')    return `<div class="mem-card-icon">⚡</div><div class="mem-card-label">${escapeHtml(card.label)}</div>`;
    if (card.kind === 'win')     return `<div class="mem-card-icon">🏆</div><div class="mem-card-label">WIN</div>`;
    if (card.kind === 'standard') return `<div class="mem-card-icon">${escapeHtml(card.suit)}</div><div class="mem-card-label">${escapeHtml(card.label)}</div>`;
    return `<div class="mem-card-icon">🔒</div>`;
  }

  function renderGrid() {
    const grid = document.getElementById('mem-grid');
    if (!grid) return;
    grid.innerHTML = cards.map(card => {
      const flipped = flippedThisTurn.includes(card.pos) || card.matched;
      const isRed = card.kind === 'standard' && (card.suit === '♥' || card.suit === '♦');
      const winCls = card.kind === 'win' ? ' mem-card-win' : '';
      return `
        <button class="mem-card${flipped ? ' mem-card-flipped' : ''}${card.matched ? ' mem-card-matched' : ''}" data-mem-pos="${card.pos}"${card.matched ? ' disabled' : ''}>
          <div class="mem-card-inner">
            <div class="mem-card-face mem-card-back"></div>
            <div class="mem-card-face mem-card-front${isRed ? ' mem-card-red' : ''}${winCls}">${cardFaceHtml(card)}</div>
          </div>
        </button>`;
    }).join('');
  }

  function renderActiveVibe() {
    const wrap = document.getElementById('mem-vibe-active-wrap');
    if (!wrap) return;
    if (!activeVibe) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = `
      <div class="mem-vibe-active">
        <span>⚡ Vibing — ${Math.round(activeVibe.intensity * 100)}% ${activeVibe.pattern}</span>
        <span class="mem-vibe-active-timer">${activeVibe.secondsLeft.toFixed(1)}s</span>
        <button id="mem-vibe-pause" class="ghost">Pause</button>
      </div>`;
    document.getElementById('mem-vibe-pause').addEventListener('click', stopMyVibe);
  }

  function renderTriggerPanel() {
    const wrap = document.getElementById('mem-trigger-wrap');
    if (!wrap) return;
    if (!selectedTrigger) { wrap.innerHTML = ''; return; }
    const { role, idx } = selectedTrigger;
    const charge = banks[role]?.vibe?.[idx];
    const isLive = !!(firingTrigger && firingTrigger.role === role);
    if (!charge || (charge.used && !isLive)) { selectedTrigger = null; firingTrigger = null; wrap.innerHTML = ''; return; }
    wrap.innerHTML = `
      <div class="mem-trigger-panel">
        <div class="mem-trigger-row"><strong>${isLive
          ? `Driving ${escapeHtml(playerNames[role])}'s vibe`
          : `Trigger ${escapeHtml(playerNames[role])}'s ${charge.duration}s charge`}</strong>${isLive
          ? `<span class="mem-trigger-timer">${firingSecondsLeft.toFixed(1)}s</span>`
          : ''}</div>
        <div class="mem-trigger-row">
          <span>Intensity</span>
          <input type="range" id="mem-trigger-intensity" class="mem-trigger-slider" min="0" max="100" value="${Math.round(triggerIntensity * 100)}">
          <span id="mem-trigger-intensity-val">${Math.round(triggerIntensity * 100)}%</span>
        </div>
        <div class="mem-trigger-row" id="mem-trigger-pattern-btns">
          <button class="mm-rounds-btn${triggerPattern === 'steady' ? ' mm-rounds-selected' : ' ghost'}" data-mem-pattern="steady">Steady</button>
          <button class="mm-rounds-btn${triggerPattern === 'pulse'  ? ' mm-rounds-selected' : ' ghost'}" data-mem-pattern="pulse">Pulse</button>
          <button class="mm-rounds-btn${triggerPattern === 'wave'   ? ' mm-rounds-selected' : ' ghost'}" data-mem-pattern="wave">Wave</button>
        </div>
        <div class="mem-trigger-row">
          ${isLive
            ? '<button id="mem-trigger-stop" class="ghost">⏹ Stop</button>'
            : '<button id="mem-trigger-fire" class="ghost">🔥 Fire</button><button id="mem-trigger-cancel" class="ghost">Cancel</button>'}
        </div>
      </div>`;

    document.getElementById('mem-trigger-intensity').addEventListener('input', (e) => {
      triggerIntensity = parseInt(e.target.value, 10) / 100;
      document.getElementById('mem-trigger-intensity-val').textContent = `${e.target.value}%`;
      if (isLive) sendTriggerAdjust();
    });
    document.getElementById('mem-trigger-pattern-btns').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mem-pattern]');
      if (!btn) return;
      triggerPattern = btn.dataset.memPattern;
      renderTriggerPanel();
      if (isLive) sendTriggerAdjust();
    });
    if (isLive) {
      document.getElementById('mem-trigger-stop').addEventListener('click', stopTrigger);
    } else {
      document.getElementById('mem-trigger-fire').addEventListener('click', () => {
        fireTrigger(role, idx, triggerIntensity, triggerPattern);
      });
      document.getElementById('mem-trigger-cancel').addEventListener('click', () => {
        selectedTrigger = null;
        renderTriggerPanel();
      });
    }
  }

  function renderPayout() {
    const wrap = document.getElementById('mem-payout-wrap');
    if (!wrap) return;
    if (gamePhase !== 'ended') { wrap.innerHTML = ''; return; }
    const winnerName = playerNames[winnerRole];
    // In versus the winner is exempt from paying; solo/watched has only the one player, who always pays their own.
    const payingRoles = memMode === 'versus' ? playerRoles.filter(r => r !== winnerRole) : playerRoles;
    wrap.innerHTML = `
      <div class="mem-payout">
        <div class="mem-status">🏆 ${escapeHtml(winnerName)} found both win cards!</div>
        ${payingRoles.map(r => {
          const bank = banks[r];
          const items = bank.forfeits.length
            ? `<ul>${bank.forfeits.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`
            : `<div class="mem-player-forfeit-empty">No forfeits owed.</div>`;
          return `
            <div class="mem-payout-card">
              <strong>${escapeHtml(playerNames[r])} pays up:</strong>
              ${items}
            </div>`;
        }).join('')}
        <button id="mem-play-again" class="ghost">Back to Lobby</button>
      </div>`;
    document.getElementById('mem-play-again').addEventListener('click', () => navigate(`#/session/${state.sessionId}`));
  }

  // ── Turn logic ────────────────────────────────────────────────────────────
  function flipCard(pos) {
    if (!cards[pos] || cards[pos].matched || flippedThisTurn.includes(pos) || flippedThisTurn.length >= 2) return;
    flippedThisTurn.push(pos);
    renderGrid();
    if (flippedThisTurn.length === 2) {
      turnLocked = true;
      resolveTimer = setTimeout(resolveTurn, 900);
    }
  }

  function resolveTurn() {
    const [posA, posB] = flippedThisTurn;
    const cardA = cards[posA];
    const cardB = cards[posB];
    const matched = isMatch(cardA, cardB);

    if (matched) {
      cardA.matched = true;
      cardB.matched = true;
      flippedThisTurn = [];
      turnLocked = false;
      renderGrid();
      if (cardA.kind === 'win') {
        endGame(currentRole);
        return;
      }
    } else {
      for (const c of [cardA, cardB]) {
        if (c.kind === 'forfeit') banks[currentRole].forfeits.push(c.label);
        if (c.kind === 'vibe') {
          if (memMode === 'solo') {
            // No one to manually trigger it — it fires the moment you collect it, and play keeps going.
            banks[currentRole].vibe.push({ duration: c.duration, used: true });
            addMyVibeSeconds(c.duration, SOLO_VIBE_INTENSITY, SOLO_VIBE_PATTERN);
          } else {
            banks[currentRole].vibe.push({ duration: c.duration, used: false });
          }
        }
      }
      currentRole = nextRole(playerRoles, currentRole);
      flippedThisTurn = [];
      turnLocked = false;
      renderGrid();
    }
    renderSidePanels();
    renderStatus();
  }

  // Lets remaining players continue after the active player's socket disconnects mid-turn —
  // otherwise the game would wait forever for a flip that can never arrive.
  function skipDisconnectedTurn() {
    if (gamePhase !== 'playing' || !departedRoles.has(currentRole)) return;
    const skippedRole = currentRole;
    currentRole = nextRole(playerRoles, currentRole);
    flippedThisTurn = [];
    turnLocked = false;
    renderGrid();
    renderSidePanels();
    renderStatus();
    if (!noSocket) socket.send({ type: MSG.MEM_SKIP_TURN, role: skippedRole });
  }

  function endGame(winner) {
    if (gamePhase === 'ended') return;
    gamePhase = 'ended';
    winnerRole = winner;
    if (!noSocket) socket.send({ type: MSG.MEM_WIN, role: winner });
    if (winner === myRole) haptics.winPattern();
    else if (memMode === 'versus') haptics.losePattern();
    renderStatus();
    renderSidePanels();
    renderPayout();
  }

  // ── Vibe trigger / countdown ─────────────────────────────────────────────
  function applyVibeTrigger(targetRole, idx, intensity, pattern) {
    const charge = banks[targetRole]?.vibe?.[idx];
    if (!charge || charge.used) return;
    charge.used = true;
    vibingRoles.add(targetRole);
    renderSidePanels();
    if (targetRole === myRole) addMyVibeSeconds(charge.duration, intensity, pattern);
  }

  function fireTrigger(targetRole, idx, intensity, pattern) {
    const charge = banks[targetRole]?.vibe?.[idx];
    if (!charge || charge.used) return;
    const duration = charge.duration;
    applyVibeTrigger(targetRole, idx, intensity, pattern);
    if (!noSocket) socket.send({ type: MSG.MEM_VIBE_TRIGGER, targetRole, chargeIndex: idx, intensity, pattern });
    // Panel stays open in "live" mode — the driver keeps control of intensity/pattern
    // and decides when to stop, rather than firing a fixed duration and walking away.
    firingTrigger = { role: targetRole };
    selectedTrigger = { role: targetRole, idx };
    addFiringSeconds(duration);
    renderTriggerPanel();
  }

  // Driver-side countdown of total time fired so far — every charge fired while already
  // live for this role stacks onto the same running counter instead of restarting it.
  // Stops itself (and the target) automatically once it runs out, same as pressing Stop.
  function addFiringSeconds(duration) {
    firingSecondsLeft += duration;
    if (!firingCountdownTimer) {
      firingCountdownTimer = setInterval(() => {
        firingSecondsLeft = Math.max(0, firingSecondsLeft - 0.1);
        if (firingSecondsLeft <= 0) { stopTrigger(); return; }
        renderTriggerPanel();
      }, 100);
    }
  }

  function sendTriggerAdjust() {
    if (!firingTrigger) return;
    const { role } = firingTrigger;
    if (!noSocket) socket.send({ type: MSG.MEM_VIBE_ADJUST, targetRole: role, intensity: triggerIntensity, pattern: triggerPattern });
    if (role === myRole) adjustMyVibeLocal(triggerIntensity, triggerPattern);
  }

  function stopTrigger() {
    if (!firingTrigger) return;
    const { role } = firingTrigger;
    vibingRoles.delete(role);
    if (!noSocket) socket.send({ type: MSG.MEM_VIBE_STOP, targetRole: role });
    if (role === myRole) stopMyVibeLocal();
    firingTrigger = null;
    selectedTrigger = null;
    firingSecondsLeft = 0;
    if (firingCountdownTimer) { clearInterval(firingCountdownTimer); firingCountdownTimer = null; }
    renderSidePanels();
    renderTriggerPanel();
  }

  // Stacks onto any vibe already running rather than restarting it, so back-to-back
  // charges (multiple watchers, or solo auto-fire) add up instead of clobbering each other.
  function addMyVibeSeconds(duration, intensity, pattern) {
    if (!activeVibe) {
      activeVibe = { secondsLeft: 0, intensity, pattern };
      vibeCountdownTimer = setInterval(() => {
        if (!activeVibe) return;
        activeVibe.secondsLeft = Math.max(0, activeVibe.secondsLeft - 0.1);
        if (activeVibe.secondsLeft <= 0) { stopMyVibe(); return; }
        renderActiveVibe();
      }, 100);
    }
    activeVibe.secondsLeft += duration;
    activeVibe.intensity = intensity;
    activeVibe.pattern = pattern;
    if (haptics.isConnected()) {
      haptics.setForfeitIntensity(intensity);
      haptics.setWaveVibeMode(pattern === 'wave');
      haptics.addForfeitSeconds(duration);
    }
    renderActiveVibe();
  }

  function adjustMyVibeLocal(intensity, pattern) {
    if (!activeVibe) return;
    activeVibe.intensity = intensity;
    activeVibe.pattern = pattern;
    if (haptics.isConnected()) {
      haptics.setForfeitIntensity(intensity);
      haptics.setWaveVibeMode(pattern === 'wave');
    }
    renderActiveVibe();
  }

  // Stops haptics/countdown on this client only — used both when I pause my own vibe
  // and when the driver remotely stops it, without re-broadcasting a redundant message.
  function stopMyVibeLocal() {
    haptics.pauseForfeitVibe();
    activeVibe = null;
    if (vibeCountdownTimer) { clearInterval(vibeCountdownTimer); vibeCountdownTimer = null; }
    renderActiveVibe();
  }

  function stopMyVibe() {
    stopMyVibeLocal();
    vibingRoles.delete(myRole);
    if (!noSocket) socket.send({ type: MSG.MEM_VIBE_PAUSE, role: myRole });
    renderSidePanels();
  }

  // ── DOM events ────────────────────────────────────────────────────────────
  document.getElementById('mem-leave').addEventListener('click', () => navigate('#/'));

  const vibeBtn = document.getElementById('mem-vibe-btn');
  if (vibeBtn) {
    vibeBtn.addEventListener('click', async () => {
      if (haptics.isConnected()) return;
      vibeBtn.textContent = 'Connecting…';
      vibeBtn.disabled = true;
      try {
        const dev = await haptics.connect();
        vibeBtn.textContent = dev ? `📳 ${dev.name}` : 'No device';
        vibeBtn.disabled = !!dev;
      } catch {
        vibeBtn.textContent = 'Connect Vibe';
        vibeBtn.disabled = false;
      }
    });
  }

  document.getElementById('mem-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mem-pos]');
    if (!btn || turnLocked || !isMyTurn()) return;
    const pos = parseInt(btn.dataset.memPos, 10);
    flipCard(pos);
    if (!noSocket) socket.send({ type: MSG.MEM_FLIP, pos });
  });

  document.getElementById('mem-board-area').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mem-trigger-role]');
    if (!btn) return;
    const role = btn.dataset.memTriggerRole;
    const idx = parseInt(btn.dataset.memTriggerIdx, 10);
    // Already driving this role — fire this charge straight onto the running countdown
    // instead of swapping the panel to a fresh "Fire?" prompt for it.
    if (firingTrigger && firingTrigger.role === role) {
      fireTrigger(role, idx, triggerIntensity, triggerPattern);
      return;
    }
    selectedTrigger = { role, idx };
    renderTriggerPanel();
  });

  // ── Socket events ─────────────────────────────────────────────────────────
  function onMemFlip(ev) {
    const { pos, role } = ev.detail;
    if (role !== currentRole) return; // ignore out-of-turn / stale flips
    if (!Number.isInteger(pos) || pos < 0 || pos >= cards.length) return;
    flipCard(pos);
  }
  function onMemVibeTrigger(ev) {
    const { targetRole, chargeIndex, intensity, pattern } = ev.detail;
    applyVibeTrigger(targetRole, chargeIndex, intensity, pattern);
  }
  function onMemVibeAdjust(ev) {
    const { targetRole, intensity, pattern } = ev.detail;
    if (targetRole === myRole) adjustMyVibeLocal(intensity, pattern);
  }
  function onMemVibeStop(ev) {
    const { targetRole } = ev.detail;
    vibingRoles.delete(targetRole);
    if (targetRole === myRole) stopMyVibeLocal();
    // The driver already updated their own panel optimistically in stopTrigger() —
    // this only matters for a bystander client that also had this trigger selected.
    if (firingTrigger && firingTrigger.role === targetRole) {
      firingTrigger = null;
      selectedTrigger = null;
      firingSecondsLeft = 0;
      if (firingCountdownTimer) { clearInterval(firingCountdownTimer); firingCountdownTimer = null; }
      renderTriggerPanel();
    }
    renderSidePanels();
  }
  function onMemVibePause(ev) {
    vibingRoles.delete(ev.detail.role);
    // The target paused themselves mid-drive — collapse the driver's live panel too,
    // otherwise it's stuck showing "Stop" for a vibe that already ended.
    if (firingTrigger && firingTrigger.role === ev.detail.role) {
      firingTrigger = null;
      selectedTrigger = null;
      firingSecondsLeft = 0;
      if (firingCountdownTimer) { clearInterval(firingCountdownTimer); firingCountdownTimer = null; }
      renderTriggerPanel();
    }
    renderSidePanels();
  }
  function onMemWin(ev) { endGame(ev.detail.role); }
  function onMemSkipTurn(ev) {
    if (ev.detail.role !== currentRole) return; // stale — already moved on
    currentRole = nextRole(playerRoles, currentRole);
    flippedThisTurn = [];
    turnLocked = false;
    renderGrid();
    renderSidePanels();
    renderStatus();
  }
  function onPeerLeft(ev) {
    const leftRole = ev.detail?.role;
    if (leftRole && playerRoles.includes(leftRole)) departedRoles.add(leftRole);
    renderStatus();
  }
  function onPeerReconnected(ev) {
    const rejoinedRole = ev.detail?.role;
    if (rejoinedRole) departedRoles.delete(rejoinedRole);
    renderStatus();
  }

  if (!noSocket) {
    socket.addEventListener(MSG.MEM_FLIP, onMemFlip);
    socket.addEventListener(MSG.MEM_VIBE_TRIGGER, onMemVibeTrigger);
    socket.addEventListener(MSG.MEM_VIBE_ADJUST, onMemVibeAdjust);
    socket.addEventListener(MSG.MEM_VIBE_STOP, onMemVibeStop);
    socket.addEventListener(MSG.MEM_VIBE_PAUSE, onMemVibePause);
    socket.addEventListener(MSG.MEM_WIN, onMemWin);
    socket.addEventListener(MSG.MEM_SKIP_TURN, onMemSkipTurn);
    socket.addEventListener(MSG.PEER_LEFT, onPeerLeft);
    socket.addEventListener(MSG.PEER_RECONNECTED, onPeerReconnected);
  }

  window.addEventListener('hashchange', function onHashChange() {
    window.removeEventListener('hashchange', onHashChange);
    if (vibeModeBarInstance) { vibeModeBarInstance.destroy(); vibeModeBarInstance = null; }
    if (vibeCountdownTimer) clearInterval(vibeCountdownTimer);
    if (firingCountdownTimer) clearInterval(firingCountdownTimer);
    if (resolveTimer) clearTimeout(resolveTimer);
    // Don't leave the target vibrating forever just because the driver navigated away.
    if (firingTrigger && !noSocket) socket.send({ type: MSG.MEM_VIBE_STOP, targetRole: firingTrigger.role });
    if (!noSocket) {
      socket.removeEventListener(MSG.MEM_FLIP, onMemFlip);
      socket.removeEventListener(MSG.MEM_VIBE_TRIGGER, onMemVibeTrigger);
      socket.removeEventListener(MSG.MEM_VIBE_ADJUST, onMemVibeAdjust);
      socket.removeEventListener(MSG.MEM_VIBE_STOP, onMemVibeStop);
      socket.removeEventListener(MSG.MEM_VIBE_PAUSE, onMemVibePause);
      socket.removeEventListener(MSG.MEM_WIN, onMemWin);
      socket.removeEventListener(MSG.MEM_SKIP_TURN, onMemSkipTurn);
      socket.removeEventListener(MSG.PEER_LEFT, onPeerLeft);
      socket.removeEventListener(MSG.PEER_RECONNECTED, onPeerReconnected);
    }
  });

  // ── Initial paint ─────────────────────────────────────────────────────────
  renderGrid();
  renderSidePanels();
  renderStatus();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
