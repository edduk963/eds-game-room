import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import { makeRng } from '../game/seededRng.js';
import * as haptics from '../haptics.js';

const COLORS = ['red', 'yellow', 'green', 'blue'];
const COLOR_HEX = { red: '#c62828', yellow: '#f9a825', green: '#2e7d32', blue: '#1565c0', wild: '#111' };
const VALID_PACKS = ['plus10', 'edge', 'skipall', 'swaphands', 'doubledown', 'ctrl2'];

function buildDeck(specialPacks = []) {
  const deck = [];
  for (const color of COLORS) {
    deck.push({ color, type: '0' });
    for (let n = 1; n <= 9; n++) {
      deck.push({ color, type: String(n) });
      deck.push({ color, type: String(n) });
    }
    for (const t of ['skip', 'reverse', 'draw2']) {
      deck.push({ color, type: t });
      deck.push({ color, type: t });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ color: 'wild', type: 'wild' });
    deck.push({ color: 'wild', type: 'wild4' });
  }
  // Special card packs
  if (specialPacks.includes('plus10')) {
    deck.push({ color: 'wild', type: 'plus10' });
    deck.push({ color: 'wild', type: 'plus10' });
  }
  if (specialPacks.includes('edge')) {
    for (const c of COLORS) {
      deck.push({ color: c, type: 'edge' });
      deck.push({ color: c, type: 'edge' });
    }
  }
  if (specialPacks.includes('skipall')) {
    deck.push({ color: 'wild', type: 'skipall' });
    deck.push({ color: 'wild', type: 'skipall' });
  }
  if (specialPacks.includes('swaphands')) {
    deck.push({ color: 'wild', type: 'swaphands' });
    deck.push({ color: 'wild', type: 'swaphands' });
  }
  if (specialPacks.includes('doubledown')) {
    deck.push({ color: 'wild', type: 'doubledown' });
    deck.push({ color: 'wild', type: 'doubledown' });
  }
  if (specialPacks.includes('ctrl2')) {
    deck.push({ color: 'wild', type: 'ctrl2' });
    deck.push({ color: 'wild', type: 'ctrl2' });
  }
  return deck;
}

function shuffleDeck(deck, rng) {
  const d = deck.map((c, i) => ({ ...c, id: i }));
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function cardScore(card) {
  if (card.color === 'wild') return 50;
  if (['skip', 'reverse', 'draw2', 'edge'].includes(card.type)) return 20;
  return parseInt(card.type, 10);
}

function canPlay(card, discardTop, currentColor, pendingDraw) {
  // Wild-color cards are always playable
  if (card.color === 'wild') return true;
  // Edge stacks on any pending draw
  if (card.type === 'edge' && pendingDraw > 0) return true;
  // During a draw stack, restrict to matching draw type (edge handled above)
  if (pendingDraw > 0) {
    if (discardTop.type === 'draw2') return card.type === 'draw2';
    if (discardTop.type === 'wild4') return card.type === 'wild4';
    if (discardTop.type === 'plus10') return false; // only wilds (handled above)
    if (discardTop.type === 'edge') return card.type === 'draw2' || card.type === 'edge';
    return false;
  }
  if (card.color === currentColor) return true;
  if (card.type === discardTop.type) return true;
  return false;
}

function cardLabel(card) {
  if (card.type === 'wild') return '★';
  if (card.type === 'wild4') return '+4';
  if (card.type === 'skip') return '⊘';
  if (card.type === 'reverse') return '↺';
  if (card.type === 'draw2') return '+2';
  if (card.type === 'plus10') return '+10';
  if (card.type === 'edge') return '+1E';
  if (card.type === 'skipall') return '⊘all';
  if (card.type === 'swaphands') return '⇄';
  if (card.type === 'doubledown') return '×2';
  if (card.type === 'ctrl2') return '2mCtrl';
  return card.type;
}

function cardImgSrc(card) {
  if (card.type === 'wild') return '/cards/wild.png';
  if (card.type === 'wild4') return '/cards/wild4.png';
  if (card.type === 'plus10') return '/cards/plus10.svg';
  if (card.type === 'skipall') return '/cards/skipall.svg';
  if (card.type === 'swaphands') return '/cards/swaphands.svg';
  if (card.type === 'doubledown') return '/cards/doubledown.svg';
  if (card.type === 'edge') return `/cards/${card.color}_edge.svg`;
  if (card.type === 'ctrl2') return '/cards/ctrl2.svg';
  if (card.color === 'red' && card.type === '0') return '/cards/red_0.svg';
  if (card.color === 'yellow' && card.type === '0') return '/cards/yellow_0.svg';
  if (card.color === 'yellow' && card.type === '1') return '/cards/yellow_1.svg';
  return `/cards/${card.color}_${card.type}.png`;
}

function handCardHtml(card, playable) {
  const src = cardImgSrc(card);
  return `<img src="${src}" class="uno-hand-card${playable ? ' uno-playable' : ''}" data-id="${card.id}" draggable="false" alt="${card.color} ${card.type}">`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function renderUno(root) {
  const totalRounds = state.gameRounds || 3;
  const specialPacks = Array.isArray(state.unoSpecialPacks) ? state.unoSpecialPacks : [];
  const playerCount = state.playerCount || 2;
  const playerRoles = playerCount >= 3
    ? ['host', 'guest', 'guest2']
    : ['host', 'guest'];
  const myRole = state.role;
  const names = {
    host: esc(state.hostName || 'Host'),
    guest: esc(state.guestName || 'Guest'),
    guest2: esc(state.guest2Name || 'Guest 2'),
  };
  const oppRoles = playerRoles.filter(r => r !== myRole);

  let roundNum = 0;
  const scores = { host: 0, guest: 0, guest2: 0 };
  let gs = null;
  let vibeCtrlEndAt = 0;
  // render() fully replaces root.innerHTML on every action, so the disconnect banner is
  // rebuilt from this Set inside the template each time rather than mutated out-of-band.
  const departedRoles = new Set();

  // ── Socket handlers ────────────────────────────────────────────────────────

  const onUnoPlay = (ev) => {
    if (!gs || gs.roundOver) return;
    const { cardId, chosenColor, from, swapTarget } = ev.detail;
    if (!from || !playerRoles.includes(from)) return;
    if (gs.currentPlayer !== from) return;
    const card = gs.hands[from]?.find(c => c.id === cardId);
    if (!card) return;

    gs.hands[from] = gs.hands[from].filter(c => c.id !== card.id);
    gs.discardTop = card;
    gs.currentColor = chosenColor || card.color;

    applyCardEffect(card, from, swapTarget);
    if (card.type === 'draw2' || card.type === 'plus10') haptics.pulse(0.55, 280);
    else if (card.type === 'wild4') haptics.pulse(0.75, 400);

    if (gs.hands[from].length === 0) { endRound(from); return; }
    gs.unoCatchable[from] = gs.hands[from].length === 1;
    advanceTurn(card);
    render();
  };

  const onUnoDraw = (ev) => {
    if (!gs || gs.roundOver) return;
    const { count, from } = ev.detail;
    if (!from || !playerRoles.includes(from)) return;
    for (let i = 0; i < count; i++) {
      if (gs.drawIndex < gs.deck.length) gs.hands[from].push(gs.deck[gs.drawIndex++]);
    }
    gs.pendingDraw = 0;
    gs.unoCatchable[from] = false;
    advanceTurnNormal();
    render();
  };

  const onUnoCallUno = (ev) => {
    if (!gs) return;
    const { from } = ev.detail;
    if (from && playerRoles.includes(from)) {
      gs.unoCatchable[from] = false;
      gs.unoStatus[from] = true;
    }
    render();
  };

  const onUnoChallenge = (ev) => {
    if (!gs) return;
    const { target } = ev.detail;
    if (!target || !playerRoles.includes(target)) return;
    if (!gs.unoCatchable[target]) return;
    gs.unoCatchable[target] = false;
    gs.unoStatus[target] = false;
    for (let i = 0; i < 2; i++) {
      if (gs.drawIndex < gs.deck.length) gs.hands[target].push(gs.deck[gs.drawIndex++]);
    }
    if (target === myRole) haptics.pulse(0.65, 4000);
    render();
  };

  const onUnoVibeCtrl = (ev) => {
    const { intensity, from } = ev.detail;
    if (from === myRole || !intensity) return;
    haptics.pulse(intensity, 220);
  };

  // Non-destructive: a brief network drop can reconnect within a few seconds, so don't
  // tear down the round — just warn and offer a way out, clearing it if they come back.
  const onPeerLeft = (ev) => {
    const r = ev.detail?.role;
    if (r && playerRoles.includes(r)) departedRoles.add(r);
    if (gs) render();
  };
  const onPeerReconnected = (ev) => {
    const r = ev.detail?.role;
    if (r) departedRoles.delete(r);
    if (gs) render();
  };

  socket.addEventListener(MSG.UNO_PLAY, onUnoPlay);
  socket.addEventListener(MSG.UNO_DRAW, onUnoDraw);
  socket.addEventListener(MSG.UNO_CALL_UNO, onUnoCallUno);
  socket.addEventListener(MSG.UNO_CHALLENGE, onUnoChallenge);
  socket.addEventListener(MSG.UNO_VIBE_CTRL, onUnoVibeCtrl);
  socket.addEventListener(MSG.PEER_LEFT, onPeerLeft);
  socket.addEventListener(MSG.PEER_RECONNECTED, onPeerReconnected);

  window.addEventListener('hashchange', () => {
    socket.removeEventListener(MSG.UNO_PLAY, onUnoPlay);
    socket.removeEventListener(MSG.UNO_DRAW, onUnoDraw);
    socket.removeEventListener(MSG.UNO_CALL_UNO, onUnoCallUno);
    socket.removeEventListener(MSG.UNO_CHALLENGE, onUnoChallenge);
    socket.removeEventListener(MSG.UNO_VIBE_CTRL, onUnoVibeCtrl);
    socket.removeEventListener(MSG.PEER_LEFT, onPeerLeft);
    socket.removeEventListener(MSG.PEER_RECONNECTED, onPeerReconnected);
    vibeCtrlEndAt = 0;
    socket.send({ type: MSG.UNO_VIBE_CTRL, intensity: 0, from: myRole });
    document.getElementById('uno-vibe-ctrl-panel')?.remove();
  }, { once: true });

  // ── Vibe control overlay ───────────────────────────────────────────────────

  function fmtCountdown(ms) {
    const rem = Math.max(0, ms);
    const m = Math.floor(rem / 60000);
    const s = Math.floor((rem % 60000) / 1000);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function openVibePanel() {
    if (document.getElementById('uno-vibe-ctrl-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'uno-vibe-ctrl-panel';
    panel.className = 'uno-vibe-ctrl-panel';
    panel.innerHTML = `
      <div class="uno-vibe-ctrl-title">⚡ Vibe Control</div>
      <input type="range" min="0" max="100" value="0" class="uno-vibe-ctrl-slider" id="vibe-ctrl-range">
      <div class="uno-vibe-ctrl-timer" id="vibe-ctrl-timer">${fmtCountdown(vibeCtrlEndAt - Date.now())}</div>
      <button class="ghost" id="vibe-ctrl-stop" style="width:100%;margin-top:6px;font-size:12px">Stop</button>
    `;
    document.body.appendChild(panel);

    let lastSend = 0;
    const slider = panel.querySelector('#vibe-ctrl-range');
    slider.addEventListener('input', () => {
      const now = Date.now();
      if (now - lastSend > 150) {
        lastSend = now;
        socket.send({ type: MSG.UNO_VIBE_CTRL, intensity: parseInt(slider.value, 10) / 100, from: myRole });
      }
    });

    panel.querySelector('#vibe-ctrl-stop').addEventListener('click', () => {
      vibeCtrlEndAt = 0;
      socket.send({ type: MSG.UNO_VIBE_CTRL, intensity: 0, from: myRole });
      panel.remove();
      render();
    });

    const tick = () => {
      const panelEl = document.getElementById('uno-vibe-ctrl-panel');
      if (!panelEl) return;
      const rem = vibeCtrlEndAt - Date.now();
      const timerEl = panelEl.querySelector('#vibe-ctrl-timer');
      if (timerEl) timerEl.textContent = fmtCountdown(rem);
      const btnEl = document.getElementById('btn-vibe-ctrl-open');
      if (btnEl) btnEl.textContent = `⚡ ${fmtCountdown(rem)}`;
      if (rem <= 0) {
        vibeCtrlEndAt = 0;
        socket.send({ type: MSG.UNO_VIBE_CTRL, intensity: 0, from: myRole });
        panelEl.remove();
        render();
      } else {
        setTimeout(tick, 500);
      }
    };
    setTimeout(tick, 500);
  }

  function showVibeControl(durationMs) {
    if (vibeCtrlEndAt > Date.now()) {
      vibeCtrlEndAt += durationMs;
    } else {
      vibeCtrlEndAt = Date.now() + durationMs;
    }
    openVibePanel();
    render();
  }

  function tickVibeBtn() {
    const btn = document.getElementById('btn-vibe-ctrl-open');
    if (!btn) return;
    const rem = vibeCtrlEndAt - Date.now();
    if (rem <= 0) { render(); return; }
    btn.textContent = `⚡ ${fmtCountdown(rem)}`;
    setTimeout(tickVibeBtn, 500);
  }

  // ── Card effect helper ─────────────────────────────────────────────────────

  function applyCardEffect(card, fromRole, swapTarget) {
    if (card.type === 'draw2') gs.pendingDraw += 2;
    else if (card.type === 'wild4') gs.pendingDraw += 4;
    else if (card.type === 'plus10') gs.pendingDraw += 10;
    else if (card.type === 'edge') gs.pendingDraw += 1;
    else if (card.type === 'doubledown') gs.pendingDraw = gs.pendingDraw > 0 ? gs.pendingDraw * 2 : 2;
    else gs.pendingDraw = 0;
    // Server clamps the broadcast UNO_DRAW count to 16 (server/index.js), so stacking
    // past that would let the drawer's own client pull more cards than everyone else's
    // clients see it draw, permanently desyncing hand sizes. Clamp here to match.
    if (gs.pendingDraw > 16) gs.pendingDraw = 16;

    if (card.type === 'swaphands' && swapTarget && playerRoles.includes(swapTarget)) {
      const tmp = gs.hands[fromRole];
      gs.hands[fromRole] = gs.hands[swapTarget];
      gs.hands[swapTarget] = tmp;
    }
  }

  // ── Turn helpers ───────────────────────────────────────────────────────────

  function advanceTurn(card) {
    const n = playerRoles.length;
    const ci = playerRoles.indexOf(gs.currentPlayer);
    if (n === 2 && (card.type === 'skip' || card.type === 'reverse')) return;
    if (card.type === 'skipall') return;
    if (card.type === 'reverse') gs.direction *= -1;
    if (card.type === 'skip' && n > 2) {
      gs.currentPlayer = playerRoles[((ci + gs.direction * 2) % n + n) % n];
    } else {
      gs.currentPlayer = playerRoles[((ci + gs.direction) % n + n) % n];
    }
  }

  function advanceTurnNormal() {
    const n = playerRoles.length;
    const ci = playerRoles.indexOf(gs.currentPlayer);
    gs.currentPlayer = playerRoles[((ci + gs.direction) % n + n) % n];
  }

  // ── Round init ─────────────────────────────────────────────────────────────

  function initRound() {
    roundNum++;
    const rng = makeRng((state.seed + roundNum * 999983 + 7) >>> 0);
    const deck = shuffleDeck(buildDeck(specialPacks), rng);
    const starts = { host: 0, guest: 7, guest2: 14 };
    const drawStart = playerCount >= 3 ? 21 : 14;

    gs = {
      deck,
      hands: {},
      drawIndex: drawStart,
      discardTop: null,
      currentColor: null,
      currentPlayer: 'host',
      direction: 1,
      pendingDraw: 0,
      unoStatus: {},
      unoCatchable: {},
      roundOver: false,
    };

    for (const r of playerRoles) {
      gs.hands[r] = deck.slice(starts[r], starts[r] + 7);
      gs.unoStatus[r] = false;
      gs.unoCatchable[r] = false;
    }

    let di = gs.drawIndex;
    while (di < deck.length && ['wild', 'wild4', 'skip', 'reverse', 'draw2', 'plus10', 'skipall', 'swaphands', 'doubledown', 'ctrl2', 'edge'].includes(deck[di].type)) di++;
    gs.discardTop = deck[di++];
    gs.drawIndex = di;
    gs.currentColor = gs.discardTop.color;

    render();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function render() {
    const myHand = gs.hands[myRole] || [];
    const { discardTop, currentColor, currentPlayer, pendingDraw, unoCatchable, unoStatus } = gs;
    const myTurn = currentPlayer === myRole;

    const statusText = myTurn
      ? (pendingDraw > 0 ? `Draw +${pendingDraw} or stack` : 'Your turn')
      : `${names[currentPlayer]}'s turn…`;

    function oppZoneHtml(role) {
      const hand = gs.hands[role] || [];
      const count = hand.length;
      const isActive = currentPlayer === role;
      const catchable = unoCatchable[role] && !unoStatus[role];
      const miniCount = Math.min(count, 16);
      const minis = Array.from({ length: miniCount }, () =>
        `<img src="/cards/back.svg" class="uno-back-mini" draggable="false" alt="card">`
      ).join('');
      const extra = count > 16 ? `<span class="uno-opp-extra">+${count - 16}</span>` : '';
      return `
        <div class="uno-opp-zone${isActive ? ' uno-active-player' : ''}">
          <div class="uno-opp-label">${names[role]} (${count}${isActive ? ' — turn' : ''})</div>
          <div class="uno-opp-cards-row">${minis}${extra}</div>
          ${catchable ? `<button class="uno-catch-btn" data-catch="${role}">Catch UNO! 🔔</button>` : ''}
        </div>`;
    }

    const discardSrc = cardImgSrc(discardTop);
    const activeColorDot = (discardTop.color === 'wild') && currentColor !== 'wild'
      ? `<div class="uno-active-color-badge" style="background:${COLOR_HEX[currentColor]}"></div>`
      : '';

    const disconnectHtml = departedRoles.size > 0 ? `
      <div class="hilo-disconnect-row">
        <span>${[...departedRoles].map(r => names[r]).join(', ')} disconnected.</span>
        <button id="uno-return-lobby-btn" class="ghost">Return to Lobby</button>
      </div>` : '';

    root.innerHTML = `
      <div class="uno-game">
        <div class="uno-header">
          <span class="uno-scorer">${names[myRole]} <strong>${scores[myRole]}</strong></span>
          <span class="uno-round-badge">Round ${roundNum}/${totalRounds}</span>
          ${oppRoles.map(r => `<span class="uno-scorer">${names[r]} <strong>${scores[r]}</strong></span>`).join('')}
        </div>
        ${disconnectHtml}

        <div class="uno-opp-zones${playerCount >= 3 ? ' uno-3p' : ''}">
          ${oppRoles.map(oppZoneHtml).join('')}
        </div>

        <div class="uno-center-row">
          <div class="uno-pile-wrap" id="btn-draw" title="Draw a card">
            <img src="/cards/back.svg" class="uno-pile-img" draggable="false" alt="draw pile">
            <div class="uno-pile-label">Draw${pendingDraw > 0 ? ` (+${pendingDraw})` : ''}</div>
          </div>
          <div class="uno-discard-wrap">
            <img src="${discardSrc}" class="uno-discard-img" draggable="false" alt="${discardTop.color} ${discardTop.type}">
            ${activeColorDot}
            <div class="uno-pile-label">Discard</div>
          </div>
        </div>

        <div class="uno-status${myTurn ? ' uno-my-turn' : ''}">${statusText}</div>

        <div class="uno-my-hand-wrap">
          <div class="uno-my-hand" id="my-hand">
            ${myHand.map(c => {
              const playable = myTurn && !gs.roundOver && canPlay(c, discardTop, currentColor, pendingDraw);
              return handCardHtml(c, playable);
            }).join('')}
          </div>
        </div>

        <div class="uno-actions-bar">
          ${myHand.length === 1 && !unoStatus[myRole]
            ? '<button id="btn-uno" class="uno-uno-btn">UNO!</button>'
            : ''}
          ${vibeCtrlEndAt > Date.now()
            ? `<button id="btn-vibe-ctrl-open" class="uno-vibe-open-btn">⚡ ${fmtCountdown(vibeCtrlEndAt - Date.now())}</button>`
            : ''}
        </div>
      </div>
    `;

    root.querySelector('#uno-return-lobby-btn')?.addEventListener('click', () => {
      haptics.stopAll();
      state.seed = null;
      navigate(`#/session/${state.sessionId}`);
    });
    root.querySelector('#btn-draw')?.addEventListener('click', onDraw);
    root.querySelector('#btn-uno')?.addEventListener('click', onCallUno);
    root.querySelector('#my-hand')?.addEventListener('click', e => {
      const el = e.target.closest('[data-id]');
      if (el) onCardClick(parseInt(el.dataset.id, 10));
    });
    root.querySelectorAll('[data-catch]').forEach(btn => {
      btn.addEventListener('click', () => onCatch(btn.dataset.catch));
    });
    const vibeOpenBtn = root.querySelector('#btn-vibe-ctrl-open');
    if (vibeOpenBtn) {
      vibeOpenBtn.addEventListener('click', openVibePanel);
      setTimeout(tickVibeBtn, 500);
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  function onCardClick(cardId) {
    if (gs.currentPlayer !== myRole || gs.roundOver) return;
    const card = gs.hands[myRole].find(c => c.id === cardId);
    if (!card || !canPlay(card, gs.discardTop, gs.currentColor, gs.pendingDraw)) return;
    if (card.color === 'wild') {
      if (card.type === 'swaphands' && playerRoles.length > 2) {
        showPlayerPicker(card);
      } else {
        const autoTarget = card.type === 'swaphands' ? oppRoles[0] : null;
        showColorPicker(card, autoTarget);
      }
    } else {
      playCard(card, card.color, null);
    }
  }

  function showPlayerPicker(card) {
    const overlay = document.createElement('div');
    overlay.className = 'uno-color-overlay';
    overlay.innerHTML = `
      <div class="uno-color-box">
        <div class="uno-color-title">Swap hands with:</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px">
          ${oppRoles.map(r => `
            <button class="btn" data-swap="${r}" style="padding:12px 16px">
              ${names[r]} &nbsp;·&nbsp; ${gs.hands[r].length} cards
            </button>`).join('')}
        </div>
        <button class="ghost" id="cancel-swap" style="margin-top:12px;width:100%">Cancel</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-swap]').forEach(btn => {
      btn.addEventListener('click', () => { overlay.remove(); showColorPicker(card, btn.dataset.swap); });
    });
    overlay.querySelector('#cancel-swap').addEventListener('click', () => overlay.remove());
  }

  function showColorPicker(card, swapTarget = null) {
    const overlay = document.createElement('div');
    overlay.className = 'uno-color-overlay';
    overlay.innerHTML = `
      <div class="uno-color-box">
        <div class="uno-color-title">Choose a color</div>
        <div class="uno-color-grid">
          ${COLORS.map(c => `<button class="uno-color-btn" data-color="${c}" style="background:${COLOR_HEX[c]}">${c}</button>`).join('')}
        </div>
        <button class="ghost" id="cancel-color" style="margin-top:12px;width:100%">Cancel</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-color]').forEach(btn => {
      btn.addEventListener('click', () => { overlay.remove(); playCard(card, btn.dataset.color, swapTarget); });
    });
    overlay.querySelector('#cancel-color').addEventListener('click', () => overlay.remove());
  }

  function playCard(card, chosenColor, swapTarget) {
    gs.hands[myRole] = gs.hands[myRole].filter(c => c.id !== card.id);
    gs.discardTop = card;
    gs.currentColor = chosenColor;
    gs.unoCatchable[myRole] = gs.hands[myRole].length === 1;

    applyCardEffect(card, myRole, swapTarget);

    socket.send({ type: MSG.UNO_PLAY, cardId: card.id, chosenColor, from: myRole, swapTarget: swapTarget || undefined });

    if (card.type === 'draw2') haptics.pulse(0.35, 180);
    if (card.type === 'wild4') haptics.pulse(0.5, 250);
    if (card.type === 'plus10') haptics.pulse(0.6, 300);
    if (card.type === 'ctrl2') showVibeControl(120000);

    if (gs.hands[myRole].length === 0) { endRound(myRole); return; }
    if (gs.hands[myRole].length === 1) gs.unoStatus[myRole] = false;
    advanceTurn(card);
    render();
  }

  function onDraw() {
    if (gs.currentPlayer !== myRole || gs.roundOver) return;
    const count = gs.pendingDraw > 0 ? gs.pendingDraw : 1;
    for (let i = 0; i < count; i++) {
      if (gs.drawIndex < gs.deck.length) gs.hands[myRole].push(gs.deck[gs.drawIndex++]);
    }
    gs.pendingDraw = 0;
    gs.unoStatus[myRole] = false;
    gs.unoCatchable[myRole] = false;
    haptics.pulse(0.65, count * 2000);
    socket.send({ type: MSG.UNO_DRAW, count, from: myRole });
    advanceTurnNormal();
    render();
  }

  function onCallUno() {
    gs.unoStatus[myRole] = true;
    gs.unoCatchable[myRole] = false;
    socket.send({ type: MSG.UNO_CALL_UNO, from: myRole });
    render();
  }

  function onCatch(targetRole) {
    if (!gs.unoCatchable[targetRole] || gs.roundOver) return;
    gs.unoCatchable[targetRole] = false;
    gs.unoStatus[targetRole] = false;
    for (let i = 0; i < 2; i++) {
      if (gs.drawIndex < gs.deck.length) gs.hands[targetRole].push(gs.deck[gs.drawIndex++]);
    }
    socket.send({ type: MSG.UNO_CHALLENGE, from: myRole, target: targetRole });
    render();
  }

  // ── Forfeit screen ─────────────────────────────────────────────────────────

  function showForfeitScreen() {
    // Determine game winner (highest score; host wins ties)
    const gameWinner = playerRoles.reduce((best, r) =>
      scores[r] > scores[best] ? r : best, playerRoles[0]);
    const forfeitLosers = playerRoles.filter(r => r !== gameWinner);
    const amWinner = myRole === gameWinner;

    const readySet = new Set();
    let forwardDone = false;
    let hapticInterval = null;
    let liveIntensity = 0;
    let livePattern = 'steady';

    const ctrlState = {};
    if (amWinner) {
      for (const loser of forfeitLosers) ctrlState[loser] = { intensity: 0, pattern: 'steady' };
    }

    function goToResults() {
      if (forwardDone) return;
      forwardDone = true;
      if (hapticInterval) { clearInterval(hapticInterval); hapticInterval = null; }
      navigate('#/results');
    }

    function checkAllReady() {
      if (playerRoles.every(r => readySet.has(r))) goToResults();
    }

    function runHaptic(intensity, pattern) {
      if (hapticInterval) { clearInterval(hapticInterval); hapticInterval = null; }
      if (intensity <= 0) return;
      if (pattern === 'steady') {
        hapticInterval = setInterval(() => haptics.pulse(intensity, 300), 200);
      } else if (pattern === 'pulse') {
        hapticInterval = setInterval(() => haptics.pulse(intensity, 700), 1300);
      } else if (pattern === 'wave') {
        let ph = 0;
        hapticInterval = setInterval(() => {
          haptics.pulse(Math.max(0.05, (Math.sin(ph) * 0.5 + 0.5)) * intensity, 150);
          ph += 0.28;
        }, 120);
      } else if (pattern === 'surge') {
        let step = 0;
        hapticInterval = setInterval(() => {
          haptics.pulse((step / 12) * intensity, 200);
          step = (step + 1) % 13;
        }, 150);
      }
    }

    function sendCtrl(loser) {
      const { intensity, pattern } = ctrlState[loser];
      socket.send({ type: MSG.UNO_FORFEIT_CTRL, target: loser, intensity, pattern, from: myRole });
    }

    function stopAllCtrl() {
      for (const loser of forfeitLosers) {
        socket.send({ type: MSG.UNO_FORFEIT_CTRL, target: loser, intensity: 0, pattern: 'steady', from: myRole });
      }
    }

    function handleReady() {
      if (readySet.has(myRole)) return;
      readySet.add(myRole);
      if (amWinner) stopAllCtrl();
      if (hapticInterval) { clearInterval(hapticInterval); hapticInterval = null; }
      socket.send({ type: MSG.UNO_FORFEIT_READY, from: myRole });
      checkAllReady();
      renderForfeit();
    }

    const onForfeitCtrl = (ev) => {
      const { target, intensity, pattern } = ev.detail;
      if (target !== myRole) return;
      liveIntensity = Math.max(0, Math.min(1, intensity || 0));
      livePattern = pattern || 'steady';
      runHaptic(liveIntensity, livePattern);
      const bar = document.getElementById('ff-bar');
      const pctEl = document.getElementById('ff-pct');
      const patEl = document.getElementById('ff-pat');
      if (bar) bar.style.width = `${Math.round(liveIntensity * 100)}%`;
      if (pctEl) pctEl.textContent = `${Math.round(liveIntensity * 100)}%`;
      if (patEl) patEl.textContent = livePattern.charAt(0).toUpperCase() + livePattern.slice(1);
    };

    const onForfeitReady = (ev) => {
      const { from } = ev.detail;
      if (from && playerRoles.includes(from)) readySet.add(from);
      const waitEl = document.getElementById('ff-wait');
      if (waitEl) {
        const waiting = playerRoles.filter(r => !readySet.has(r)).map(r => names[r]);
        waitEl.textContent = waiting.length ? `Waiting for: ${waiting.join(', ')}` : '';
      }
      checkAllReady();
    };

    socket.addEventListener(MSG.UNO_FORFEIT_CTRL, onForfeitCtrl);
    socket.addEventListener(MSG.UNO_FORFEIT_READY, onForfeitReady);

    window.addEventListener('hashchange', () => {
      socket.removeEventListener(MSG.UNO_FORFEIT_CTRL, onForfeitCtrl);
      socket.removeEventListener(MSG.UNO_FORFEIT_READY, onForfeitReady);
      if (hapticInterval) { clearInterval(hapticInterval); hapticInterval = null; }
    }, { once: true });

    // Auto-advance after 3 minutes
    setTimeout(() => goToResults(), 3 * 60 * 1000);

    const PATTERNS = ['steady', 'pulse', 'wave', 'surge'];
    const PAT_LABELS = { steady: 'Steady', pulse: 'Pulse', wave: 'Wave', surge: 'Surge' };
    const scoreBar = playerRoles.map(r =>
      `<span class="ff-score-chip${r === gameWinner ? ' ff-winner-chip' : ''}">${names[r]} ${scores[r]}</span>`
    ).join('');

    function renderForfeit() {
      const myReady = readySet.has(myRole);
      if (amWinner) {
        root.innerHTML = `
          <div class="ff-screen">
            <div class="ff-header">
              <div class="ff-crown">🏆</div>
              <div class="ff-title">You Win!</div>
              <div class="ff-scores">${scoreBar}</div>
            </div>
            <div class="ff-ctrl-wrap">
              ${forfeitLosers.map(loser => `
                <div class="ff-ctrl-panel" data-loser="${loser}">
                  <div class="ff-ctrl-name">${names[loser]}</div>
                  <div class="ff-ctrl-row">
                    <span class="ff-label">Intensity</span>
                    <input type="range" min="0" max="100" value="0" class="ff-slider" id="ff-slider-${loser}">
                    <span class="ff-pct-tag" id="ff-pct-tag-${loser}">0%</span>
                  </div>
                  <div class="ff-patterns" id="ff-patterns-${loser}">
                    ${PATTERNS.map(p => `
                      <button class="ff-pat-btn${p === ctrlState[loser].pattern ? ' selected' : ''}"
                        data-loser="${loser}" data-pattern="${p}">${PAT_LABELS[p]}</button>
                    `).join('')}
                  </div>
                </div>
              `).join('')}
            </div>
            <div class="ff-wait" id="ff-wait"></div>
            <button class="btn ff-ready-btn" id="ff-ready" ${myReady ? 'disabled' : ''}>
              ${myReady ? 'Waiting for others…' : 'Done →'}
            </button>
          </div>
        `;
        forfeitLosers.forEach(loser => {
          const slider = root.querySelector(`#ff-slider-${loser}`);
          const pctTag = root.querySelector(`#ff-pct-tag-${loser}`);
          if (!slider) return;
          slider.addEventListener('input', () => {
            ctrlState[loser].intensity = parseInt(slider.value, 10) / 100;
            if (pctTag) pctTag.textContent = slider.value + '%';
            sendCtrl(loser);
          });
        });
        root.querySelectorAll('.ff-pat-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const loser = btn.dataset.loser;
            const pattern = btn.dataset.pattern;
            ctrlState[loser].pattern = pattern;
            root.querySelectorAll(`#ff-patterns-${loser} .ff-pat-btn`).forEach(b =>
              b.classList.toggle('selected', b.dataset.pattern === pattern));
            sendCtrl(loser);
          });
        });
      } else {
        root.innerHTML = `
          <div class="ff-screen">
            <div class="ff-header">
              <div class="ff-crown">💀</div>
              <div class="ff-title">Forfeit Time</div>
              <div class="ff-scores">${scoreBar}</div>
            </div>
            <div class="ff-victim">
              <div class="ff-victim-label">${names[gameWinner]} has control</div>
              <div class="ff-bar-wrap">
                <div class="ff-bar" id="ff-bar" style="width:0%"></div>
              </div>
              <div class="ff-bar-row">
                <span id="ff-pct">0%</span>
                <span class="ff-pat-live" id="ff-pat">Idle</span>
              </div>
            </div>
            <div class="ff-wait" id="ff-wait"></div>
            <button class="btn ff-ready-btn" id="ff-ready" ${myReady ? 'disabled' : ''}>
              ${myReady ? 'Waiting for others…' : 'Ready →'}
            </button>
          </div>
        `;
      }
      const readyBtn = root.querySelector('#ff-ready');
      if (readyBtn && !myReady) readyBtn.addEventListener('click', handleReady);
    }

    renderForfeit();
  }

  // ── Round end ──────────────────────────────────────────────────────────────

  function endRound(winnerRole) {
    if (gs.roundOver) return;
    gs.roundOver = true;
    const losers = playerRoles.filter(r => r !== winnerRole);
    const pts = losers.reduce((t, r) =>
      t + (gs.hands[r] || []).reduce((s, c) => s + cardScore(c), 0), 0);
    scores[winnerRole] += pts;
    if (winnerRole === myRole) haptics.pulse(0.3, 120);
    else haptics.pulse(0.85, 600);

    const overlay = document.createElement('div');
    overlay.className = 'uno-round-overlay';
    const more = roundNum < totalRounds;
    const winLine = winnerRole === myRole ? '🏆 You win this round!' : `${names[winnerRole]} wins this round`;
    const scoreLines = playerRoles.map(r => `${names[r]}: ${scores[r]}`).join(' &nbsp;|&nbsp; ');
    overlay.innerHTML = `
      <div class="uno-round-result">
        <div class="uno-round-winner">${winLine}</div>
        <div class="uno-round-pts">+${pts} pts</div>
        <div class="uno-round-scores">${scoreLines}</div>
        <div class="uno-round-next">${more ? 'Next round in 3s…' : 'Game over!'}</div>
      </div>
    `;
    document.body.appendChild(overlay);
    setTimeout(() => {
      overlay.remove();
      if (more) {
        initRound();
      } else {
        state.myFinal = scores[myRole];
        state.oppFinal = oppRoles.reduce((m, r) => Math.max(m, scores[r]), 0);
        socket.send({ type: MSG.FINAL, value: scores[myRole], vibeSeconds: 0 });
        showForfeitScreen();
      }
    }, 3000);
  }

  initRound();
}
