import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';
import { getFrontier, HEX_SIZE } from '../game/conquestMap.js';
import { initVibeModeBar } from '../vibeModeBar.js';

const ROLE_COLOR = { host: '#4aaeff', guest: '#ff5a7a', guest2: '#ffd633' };

const TYPE_ICON = {
  start: '⌂', safe: '', sanctuary: '⛪', dungeonGate: '⛓',
  ironThrone: '👑', edgePost: '📍', mirror: '🪞', muster: '⚔', ridgepath: '🛤', reckoning: '💥',
};
const TYPE_LABEL = {
  start: 'Start', safe: 'Quiet ground', sanctuary: 'Sanctuary',
  dungeonGate: 'Dungeon Gate', ironThrone: 'Iron Throne',
  edgePost: 'Edge Post', mirror: 'The Mirror', muster: 'The Muster',
  ridgepath: 'Ridgepath', reckoning: 'The Reckoning',
};
// Hover text for special spaces. Deliberately has no entry for 'safe'/'start' (nothing to
// explain) and none for 'secretTrap' either — that type never reaches the client at all, it's
// redacted to 'safe' before the map is ever sent (see conquestMap.js's redactHiddenSpaces), so
// there is nothing here that could leak it even by omission.
const TYPE_DESC = {
  sanctuary: 'Grants a skip token — cancels one future forfeit.',
  dungeonGate: 'Invoke once per session to assign your opponent a 5-minute punishment forfeit.',
  ironThrone: "Invoke once per session to double your opponent's still-active Dungeon Gate punishment.",
  edgePost: 'While held, every other player must edge once before each round starts.',
  mirror: 'While held, any forfeit you owe is also owed by every other player.',
  muster: '+2 dice per round for as long as you control this space.',
  ridgepath: 'Whoever does not control this at match end owes a 10-minute edging session before the next match.',
};

const RECKONING_DEFAULT_FORFEIT = 'will have to cum, and get 3 min postcum.';

function reckoningForfeitPhrase() {
  return state.cqReckoningForfeitText ? `owe: ${state.cqReckoningForfeitText}` : RECKONING_DEFAULT_FORFEIT;
}

function descFor(type) {
  if (type === 'reckoning') return `Whoever isn't in control of this space at the end ${reckoningForfeitPhrase()}`;
  return TYPE_DESC[type];
}

export function renderConquest(root) {
  root.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#4aaeff;font-size:2rem;font-family:monospace;">Conquest…</div>`;

  const myRole = state.role;
  const playerRoles = state.cqPlayerRoles || ['host', 'guest'];
  const map = state.cqPublicMap;

  let ownership = { ...state.cqOwnership };
  let dicePool = { ...state.cqDicePool };
  let roundIndex = 0;
  let controlStreakHolder = null;
  let controlStreak = 0;
  let edgePostHolder = null;
  let mirrorHolder = null;
  let musterHolder = null;
  let secretTrapMine = null;
  let edgeOwed = false;
  let edgeAcked = false;
  let usedClaims = { dungeonGate: false, ironThrone: false };
  // Set the instant a claim message is sent, cleared once the server responds (success or
  // no-op) — prevents double-invoking while awaiting cq_claim_result, without prematurely
  // hiding the hex the way immediately setting usedClaims used to.
  let pendingClaims = { dungeonGate: false, ironThrone: false };
  let claimFailureMsg = '';
  let myAlloc = {};

  const NODE_IDS = {};
  for (const n of map.nodes) if (!(n.type in NODE_IDS)) NODE_IDS[n.type] = n.id;

  const VIEWBOX = (() => {
    const xs = map.nodes.map(n => n.x), ys = map.nodes.map(n => n.y);
    const pad = HEX_SIZE * 1.3;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    return { minX, minY, w: maxX - minX, h: maxY - minY };
  })();

  function hexPoints(cx, cy, size) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i);
      pts.push(`${(cx + size * Math.cos(angle)).toFixed(1)},${(cy + size * Math.sin(angle)).toFixed(1)}`);
    }
    return pts.join(' ');
  }

  const nameFor = (role) => (role === 'host' ? state.hostName : role === 'guest' ? state.guestName : state.guest2Name) || role;
  const colorFor = (role) => ROLE_COLOR[role] || '#888';
  const labelFor = (node) => TYPE_LABEL[node.type] || node.id;

  // Every phase includes this at the top of its template — same top-nav-bar treatment (title +
  // Leave button + the shared vibe-mode pattern control) every other game screen has.
  function headerHtml(title) {
    return `
      <div class="cq-header" style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#0d0d17;border-bottom:1px solid #22223a;width:100%;box-sizing:border-box;flex-shrink:0;">
        <button id="cq-leave" style="background:transparent;border:1px solid #333;color:#888;border-radius:6px;padding:6px 12px;font-size:0.75rem;cursor:pointer;font-family:monospace;flex-shrink:0;">← Leave</button>
        <span style="color:#4aaeff;font-size:0.85rem;letter-spacing:1px;font-weight:bold;flex:1;">${title}</span>
      </div>`;
  }

  let vibeModeBarInstance = null;
  // Every phase fully reassigns root.innerHTML, wiping any appended child — remount after each.
  function mountVibeModeBar() {
    if (vibeModeBarInstance) vibeModeBarInstance.destroy();
    const header = root.querySelector('.cq-header');
    vibeModeBarInstance = initVibeModeBar(header || root, { prepend: false });
    const leaveBtn = root.querySelector('#cq-leave');
    if (leaveBtn) leaveBtn.addEventListener('click', () => {
      haptics.stopContinuousVibe();
      haptics.stopAll();
      state.seed = null;
      navigate(`#/session/${state.sessionId}`);
    });
  }

  // Hidden dev/testing shortcut: Alt+R asks the server (privately) for the true secretTrap
  // node ids and overlays them on whichever map is currently drawn. Never shown to the opponent.
  let debugTrapNodeIds = null;
  let lastMapRenderOpts = null;
  function refreshMap() {
    const container = root.querySelector('#cq-map-area');
    if (container && lastMapRenderOpts) renderMapInto(container, lastMapRenderOpts);
  }
  function onKeyDown(ev) {
    if (!ev.altKey || (ev.key !== 'r' && ev.key !== 'R')) return;
    ev.preventDefault();
    if (debugTrapNodeIds) { debugTrapNodeIds = null; refreshMap(); return; }
    socket.send({ type: MSG.CQ_DEBUG_REVEAL_TRAPS });
  }
  window.addEventListener('keydown', onKeyDown);

  // These are reassigned to their real handler bodies further down (and, for onGo/onReveal,
  // again on every phase transition). addEventListener captures whatever function VALUE a
  // variable holds at the moment it's called — reassigning the variable later does not
  // retroactively change what's already registered. Registering a stable wrapper that looks up
  // the current value of onX at call time (instead of registering onX directly) is what makes
  // later reassignment actually take effect; without it every one of these listeners would stay
  // permanently bound to the empty no-op below and silently never fire.
  let onGo = (ev) => {};
  let onReveal = (ev) => {};
  let onClaimResult = (ev) => {};
  let onSecretStatus = (ev) => {};
  let onDebugRevealTraps = (ev) => { debugTrapNodeIds = new Set(ev.detail.nodeIds || []); refreshMap(); };
  let onMatchEnd = (ev) => {};
  let onMatchEndIntensity = (ev) => {};
  let onMatchEndReady = (ev) => {};
  // Fires when this socket reconnects mid-match into a still-live Conquest session — the
  // server resends everything needed to rebuild round state (see server/index.js's 'join'
  // handler). Deliberately lands on the Ready gate rather than reconstructing whatever
  // allocate/reveal UI was mid-flight; see onResync below.
  let onResync = (ev) => {};

  const goWrapper = (ev) => onGo(ev);
  const revealWrapper = (ev) => onReveal(ev);
  const claimResultWrapper = (ev) => onClaimResult(ev);
  const secretStatusWrapper = (ev) => onSecretStatus(ev);
  const debugRevealTrapsWrapper = (ev) => onDebugRevealTraps(ev);
  const matchEndWrapper = (ev) => onMatchEnd(ev);
  const matchEndIntensityWrapper = (ev) => onMatchEndIntensity(ev);
  const matchEndReadyWrapper = (ev) => onMatchEndReady(ev);
  const resyncWrapper = (ev) => onResync(ev);

  socket.addEventListener(MSG.CQ_GO, goWrapper);
  socket.addEventListener(MSG.CQ_REVEAL, revealWrapper);
  socket.addEventListener(MSG.CQ_CLAIM_RESULT, claimResultWrapper);
  socket.addEventListener(MSG.CQ_SECRET_STATUS, secretStatusWrapper);
  socket.addEventListener(MSG.CQ_DEBUG_REVEAL_TRAPS, debugRevealTrapsWrapper);
  socket.addEventListener(MSG.CQ_MATCH_END, matchEndWrapper);
  socket.addEventListener(MSG.CQ_MATCH_END_INTENSITY, matchEndIntensityWrapper);
  socket.addEventListener(MSG.CQ_MATCH_END_READY, matchEndReadyWrapper);
  socket.addEventListener(MSG.CQ_RESYNC, resyncWrapper);

  window.addEventListener('hashchange', () => {
    socket.removeEventListener(MSG.CQ_GO, goWrapper);
    socket.removeEventListener(MSG.CQ_REVEAL, revealWrapper);
    socket.removeEventListener(MSG.CQ_CLAIM_RESULT, claimResultWrapper);
    socket.removeEventListener(MSG.CQ_SECRET_STATUS, secretStatusWrapper);
    socket.removeEventListener(MSG.CQ_DEBUG_REVEAL_TRAPS, debugRevealTrapsWrapper);
    socket.removeEventListener(MSG.CQ_MATCH_END, matchEndWrapper);
    socket.removeEventListener(MSG.CQ_MATCH_END_INTENSITY, matchEndIntensityWrapper);
    socket.removeEventListener(MSG.CQ_MATCH_END_READY, matchEndReadyWrapper);
    socket.removeEventListener(MSG.CQ_RESYNC, resyncWrapper);
    window.removeEventListener('keydown', onKeyDown);
    if (vibeModeBarInstance) { vibeModeBarInstance.destroy(); vibeModeBarInstance = null; }
    haptics.stopContinuousVibe();
    haptics.stopAll();
  }, { once: true });

  onClaimResult = (ev) => {
    const { claim, byRole, targetRole, durationSec, newDurationSec, shielded, ok } = ev.detail;
    if (byRole === myRole && ok === false) {
      // A private no-op answer to our own claim attempt (e.g. Iron Throne with nothing fresh
      // to double) — not a broadcast, so no haptics/log entry, just un-hide the ability again.
      pendingClaims[claim] = false;
      claimFailureMsg = 'Nothing to claim yet.';
      refreshClaimUI();
      setTimeout(() => { claimFailureMsg = ''; refreshClaimUI(); }, 3000);
      return;
    }
    if (byRole === myRole) {
      pendingClaims[claim] = false;
      usedClaims[claim] = true;
      refreshClaimUI();
    }
    if (claim === 'dungeonGate' && targetRole === myRole && !shielded) {
      haptics.setWaveVibeMode(true);
      haptics.setForfeitIntensity(1.0);
      haptics.startForfeitVibe(durationSec);
    }
    if (claim === 'ironThrone' && targetRole === myRole) {
      haptics.startForfeitVibe(newDurationSec);
    }
    logEvent(shielded ? `${nameFor(targetRole)}'s skip token absorbed ${claimDescription(claim, byRole, targetRole)}` : claimDescription(claim, byRole, targetRole));
  };

  onSecretStatus = (ev) => {
    const wasMine = !!secretTrapMine;
    secretTrapMine = ev.detail.isSecretTrap ? ev.detail.nodeId : null;
    if (ev.detail.isSecretTrap) {
      haptics.startContinuousVibe(0.5);
      logEvent("You've stepped into a hidden trap — say nothing.");
    } else if (wasMine) {
      haptics.stopContinuousVibe();
      logEvent('The hidden trap released you.');
    }
    refreshSecretWarning();
  };

  onMatchEnd = (ev) => showMatchEnd(ev.detail);

  // Reconnect mid-match: overwrite whatever round state we hold locally with the server's
  // authoritative snapshot, then land on the Ready gate. This deliberately does not try to
  // resume mid-allocate or mid-reveal UI — Ready is a safe landing point the player can just
  // re-confirm from (see cq_ready's server-side handling, which tolerates being sent again
  // for a round already in flight without ever leaving a client permanently stuck).
  onResync = (ev) => {
    const d = ev.detail;
    if (d.ownership) ownership = d.ownership;
    if (d.dicePool) dicePool = d.dicePool;
    if (Number.isInteger(d.roundIndex)) roundIndex = d.roundIndex;
    controlStreakHolder = d.controlStreakHolder ?? null;
    controlStreak = d.controlStreak ?? 0;
    edgePostHolder = d.edgePostHolder ?? null;
    mirrorHolder = d.mirrorHolder ?? null;
    musterHolder = d.musterHolder ?? null;
    usedClaims = { dungeonGate: !!d.dungeonGateUsed, ironThrone: !!d.ironThroneUsed };
    pendingClaims = { dungeonGate: false, ironThrone: false };
    showReady();
  };

  // Cap raised from the original 6 now that territory-change lines (see showReveal) are pushed
  // here too, not just forfeits — a single 10-round match can otherwise blow past 6 entries
  // almost immediately.
  let eventLog = [];
  function logEvent(text) { eventLog.unshift(text); eventLog = eventLog.slice(0, 18); }
  function claimDescription(claim, byRole, targetRole) {
    const label = { dungeonGate: 'Dungeon Gate', ironThrone: 'Iron Throne' }[claim] || claim;
    return `${nameFor(byRole)} invokes ${label} against ${nameFor(targetRole)}`;
  }

  function refreshSecretWarning() {
    const el = root.querySelector('#cq-secret-warning');
    if (el) el.innerHTML = secretWarningHtml();
  }

  function secretWarningHtml() {
    return secretTrapMine
      ? `<div style="color:#f44;font-size:0.7rem;text-align:center;padding:2px 0;">⚠ You're standing on a hidden trap — say nothing.</div>`
      : '';
  }

  // Simple per-player territory count — how many hexes each player currently controls.
  function territoryCountHtml() {
    const counts = {};
    for (const role of playerRoles) counts[role] = 0;
    for (const n of map.nodes) {
      const owner = ownership[n.id];
      if (owner && counts[owner] !== undefined) counts[owner]++;
    }
    const parts = playerRoles.map(role => `<span style="color:${colorFor(role)};font-weight:bold;">${nameFor(role)}: ${counts[role]}</span>`);
    return `<div style="display:flex;justify-content:center;gap:18px;font-size:0.85rem;padding:6px 0;">${parts.join('')}</div>`;
  }

  // diceCounts: {nodeId: myCommittedCount} — shown during allocation.
  // results: {nodeId: {totals: {role: total}, winnerRole}} — shown during reveal.
  // highlightColor: cyan for attack/reinforce targets (allocate phase), gold for an unused
  // claim ability you can tap to invoke (ready phase) — same highlight mechanism, different meaning.
  function renderMapInto(container, opts = {}) {
    lastMapRenderOpts = opts;
    const { highlightIds = [], diceCounts = null, results = null, highlightColor = '#5cffd4' } = opts;
    const highlightSet = new Set(highlightIds);
    const hexRadius = HEX_SIZE - 3;

    const hexSvg = map.nodes.map(n => {
      const owner = ownership[n.id];
      const isHighlight = highlightSet.has(n.id);
      const isDebugTrap = debugTrapNodeIds && debugTrapNodeIds.has(n.id);
      let fill = '#12121e', stroke = '#2a2a4a', sw = 2;
      if (owner && owner !== 'neutral') { fill = colorFor(owner) + '4d'; stroke = colorFor(owner); sw = 3; }
      if (isHighlight) { stroke = highlightColor; sw = 3.5; }
      if (isDebugTrap) { stroke = '#ff33ff'; sw = 3.5; }

      const lines = [];
      if (n.type !== 'safe' && n.type !== 'start') {
        lines.push(`<text x="${n.x}" y="${n.y - HEX_SIZE * 0.42}" text-anchor="middle" font-size="10.5" fill="#ddd" font-weight="bold" style="pointer-events:none;">${TYPE_ICON[n.type] || ''} ${TYPE_LABEL[n.type] || ''}</text>`);
      }
      if (isDebugTrap) {
        lines.push(`<text x="${n.x}" y="${n.y - HEX_SIZE * 0.42}" text-anchor="middle" font-size="10.5" fill="#ff33ff" font-weight="bold" style="pointer-events:none;">☠ TRAP</text>`);
      }
      if (diceCounts && diceCounts[n.id]) {
        lines.push(`<text x="${n.x}" y="${n.y + 9}" text-anchor="middle" font-size="22" fill="#4aaeff" font-weight="bold" style="pointer-events:none;">${diceCounts[n.id]}</text>`);
      }
      if (results && results[n.id]) {
        const r = results[n.id];
        const roleLine = playerRoles.map(role => `${role[0].toUpperCase()}${r.totals?.[role] ?? 0}`).join(' ');
        const resultColor = r.winnerRole === 'neutral' ? '#888' : (r.winnerRole === myRole ? '#00ff88' : '#f66');
        lines.push(`<text x="${n.x}" y="${n.y + 8}" text-anchor="middle" font-size="12" fill="${resultColor}" font-weight="bold" style="pointer-events:none;">${roleLine}</text>`);
      }
      if (owner && owner !== 'neutral') {
        lines.push(`<text x="${n.x}" y="${n.y + HEX_SIZE * 0.6}" text-anchor="middle" font-size="9" fill="${colorFor(owner)}" style="pointer-events:none;">${nameFor(owner)}</text>`);
      }

      const desc = descFor(n.type);
      const tooltip = desc ? `<title>${TYPE_LABEL[n.type]} — ${desc}</title>` : '';

      return `
        <g>
          ${tooltip}
          <polygon points="${hexPoints(n.x, n.y, hexRadius)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${isDebugTrap ? 'stroke-dasharray="4,3"' : ''}
            style="${isHighlight ? 'cursor:pointer' : ''}" ${isHighlight ? `data-node="${n.id}"` : ''} />
          ${lines.join('')}
        </g>
      `;
    }).join('');

    container.innerHTML = `<svg width="100%" viewBox="${VIEWBOX.minX} ${VIEWBOX.minY} ${VIEWBOX.w} ${VIEWBOX.h}" style="max-width:640px;display:block;margin:0 auto;">${hexSvg}</svg>`;
  }

  const CLAIM_ABILITIES = [
    { key: 'dungeonGate', type: 'dungeonGate', label: 'Dungeon Gate', msgType: MSG.CQ_CLAIM_DUNGEON_GATE, needsTarget: true },
    { key: 'ironThrone', type: 'ironThrone', label: 'Iron Throne', msgType: MSG.CQ_CLAIM_IRON_THRONE, needsTarget: true },
  ];

  // Which of my controlled hexes have an unused claim ability right now — {nodeId: ability}.
  // No standing panel; these are surfaced as gold-highlighted, clickable hexes on the map itself.
  function claimableAbilities() {
    const claimable = {};
    CLAIM_ABILITIES.forEach(a => {
      const nodeId = NODE_IDS[a.type];
      if (nodeId && ownership[nodeId] === myRole && !usedClaims[a.key] && !pendingClaims[a.key]) claimable[nodeId] = a;
    });
    return claimable;
  }

  // Re-renders the claimable-hex highlighting and hint text if the ready screen's map is
  // currently mounted. Safe to call from any phase (e.g. from the cq_claim_result handler,
  // which can fire while a different screen is showing) — it's a no-op otherwise.
  function refreshClaimUI() {
    const mapArea = root.querySelector('#cq-map-area');
    const claimHint = root.querySelector('#cq-claim-hint');
    if (!mapArea || !claimHint) return;
    const claimable = claimableAbilities();
    renderMapInto(mapArea, { highlightIds: Object.keys(claimable), highlightColor: '#ffcc44' });
    claimHint.textContent = claimFailureMsg || (Object.keys(claimable).length ? 'Gold hex: an ability you control — tap to invoke it.' : '');
  }

  function invokeClaim(ability) {
    const others = playerRoles.filter(r => r !== myRole);
    claimFailureMsg = '';
    if (!ability.needsTarget) {
      pendingClaims[ability.key] = true;
      socket.send({ type: ability.msgType });
      return;
    }
    if (others.length <= 1) {
      pendingClaims[ability.key] = true;
      socket.send({ type: ability.msgType, targetRole: others[0] });
      return;
    }
    const sel = document.createElement('div');
    sel.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:monospace;z-index:20;padding:20px;box-sizing:border-box;';
    sel.innerHTML = `
      <div style="color:#4aaeff;margin-bottom:6px;">${ability.label}</div>
      <div style="color:#666;font-size:0.75rem;margin-bottom:16px;">Choose a target</div>
      <div style="display:flex;flex-direction:column;gap:8px;width:100%;max-width:260px;">
        ${others.map(r => `<button data-target="${r}" style="background:#12121e;border:1px solid #2a4a6a;border-radius:6px;padding:12px;color:#ddd;font-family:monospace;cursor:pointer;">${nameFor(r)}</button>`).join('')}
      </div>
      <button id="cq-claim-cancel" style="margin-top:14px;background:transparent;border:none;color:#555;cursor:pointer;font-family:monospace;">Cancel</button>`;
    document.body.appendChild(sel);
    sel.querySelectorAll('[data-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        pendingClaims[ability.key] = true;
        socket.send({ type: ability.msgType, targetRole: btn.dataset.target });
        sel.remove();
        refreshClaimUI();
      });
    });
    sel.querySelector('#cq-claim-cancel').addEventListener('click', () => sel.remove());
  }

  showPreview();

  // ── Preview ──

  function showPreview() {
    root.innerHTML = `
      <div style="min-height:100vh;width:100%;background:#08080f;color:#ccc;display:flex;flex-direction:column;align-items:center;font-family:monospace;">
        ${headerHtml('CONQUEST')}
        <div style="width:100%;max-width:560px;margin:0 auto;padding:24px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;">
          <div id="cq-map-area" style="width:100%;"></div>
          <div style="color:#666;font-size:0.8rem;margin-top:20px;">The realm is set. Preparing match…</div>
        </div>
      </div>`;
    mountVibeModeBar();
    renderMapInto(root.querySelector('#cq-map-area'));
    setTimeout(showReady, 2200);
  }

  // ── Ready (pre-round gate) ──

  function showReady() {
    const heldBy = edgePostHolder;
    edgeOwed = !!(heldBy && heldBy !== myRole);
    // Recompute fresh every round rather than carrying a stale `true` forward — the server
    // resets its own cqEdgeAck flag for every role at the start of each round, so a client that
    // owed-and-acked in an earlier round (or never owed one, so this defaulted true) must not
    // walk into a later round thinking it's already acked when it isn't. Left unfixed, the
    // client shows Ready as enabled while the server silently drops that round's cq_ready
    // (still lacking a real ack) — both players end up stuck on "Waiting for other players…".
    edgeAcked = !edgeOwed;

    root.innerHTML = `
      <div style="min-height:100vh;width:100%;background:#08080f;color:#ccc;display:flex;flex-direction:column;align-items:center;font-family:monospace;">
        ${headerHtml(`CONQUEST — Round ${roundIndex + 1}`)}
        <div style="width:100%;max-width:560px;margin:0 auto;padding:20px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;">
          <div id="cq-territory-strip" style="width:100%;">${territoryCountHtml()}</div>
          <div id="cq-secret-warning" style="width:100%;">${secretWarningHtml()}</div>
          <div id="cq-map-area" style="width:100%;margin:12px 0;"></div>
          <div id="cq-claim-hint" style="width:100%;text-align:center;color:#ffcc44;font-size:0.72rem;min-height:1em;"></div>
          <div id="cq-edge-banner" style="width:100%;"></div>
          <div style="width:100%;display:flex;justify-content:center;">
            <button id="cq-history-toggle" style="background:transparent;border:1px solid #333;color:#666;border-radius:6px;padding:4px 10px;font-size:0.68rem;cursor:pointer;font-family:monospace;">History ▾</button>
          </div>
          <div id="cq-history-panel" style="width:100%;display:none;flex-direction:column;gap:4px;font-size:0.75rem;background:#0d0d17;border:1px solid #22223a;border-radius:8px;padding:8px 10px;margin-top:6px;box-sizing:border-box;"></div>
          <button id="cq-ready-btn" style="margin-top:16px;background:#4aaeff;color:#000;border:none;border-radius:8px;padding:14px 32px;font-size:1rem;cursor:pointer;font-family:monospace;font-weight:bold;">READY</button>
          <div id="cq-ready-status" style="margin-top:10px;color:#444;font-size:0.75rem;"></div>
        </div>
      </div>`;
    mountVibeModeBar();

    const mapArea = root.querySelector('#cq-map-area');

    refreshClaimUI();
    mapArea.addEventListener('click', (e) => {
      const el = e.target.closest('[data-node]');
      if (!el) return;
      const claimable = claimableAbilities();
      const ability = claimable[el.dataset.node];
      if (ability) { invokeClaim(ability); refreshClaimUI(); }
    });

    // History panel: collapsed by default so it doesn't clutter the primary Ready flow — this
    // is where players spend most of their time waiting, so the round-history log (forfeits +
    // territory changes, see logEvent/showReveal) needs a place to be checked without having to
    // wait for the next reveal screen.
    const historyToggle = root.querySelector('#cq-history-toggle');
    const historyPanel = root.querySelector('#cq-history-panel');
    let historyOpen = false;
    function renderHistoryPanel() {
      historyPanel.innerHTML = '';
      if (eventLog.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'color:#444;text-align:center;';
        empty.textContent = 'No history yet.';
        historyPanel.appendChild(empty);
        return;
      }
      eventLog.forEach(text => {
        const line = document.createElement('div');
        line.style.color = '#4aaeff';
        line.textContent = text;
        historyPanel.appendChild(line);
      });
    }
    historyToggle.addEventListener('click', () => {
      historyOpen = !historyOpen;
      historyPanel.style.display = historyOpen ? 'flex' : 'none';
      historyToggle.textContent = historyOpen ? 'History ▴' : 'History ▾';
      if (historyOpen) renderHistoryPanel();
    });

    const readyBtn = root.querySelector('#cq-ready-btn');
    const banner = root.querySelector('#cq-edge-banner');

    if (edgeOwed && !edgeAcked) {
      readyBtn.disabled = true;
      readyBtn.style.opacity = '0.4';
      banner.innerHTML = `
        <div style="background:#1a0a0a;border:1px solid #4a2a2a;border-radius:8px;padding:12px;margin-bottom:8px;text-align:center;">
          <div style="color:#f88;font-size:0.85rem;margin-bottom:8px;">${nameFor(heldBy)} holds Edge Post — edge once before this round.</div>
          <button id="cq-edge-confirm" style="background:#2a1a1a;border:1px solid #6a3a3a;color:#f88;border-radius:6px;padding:8px 16px;cursor:pointer;font-family:monospace;">I edged</button>
        </div>`;
      banner.querySelector('#cq-edge-confirm').addEventListener('click', () => {
        edgeAcked = true;
        haptics.pulse(0.6, 400);
        socket.send({ type: MSG.CQ_EDGE_ACK });
        banner.innerHTML = '';
        readyBtn.disabled = false;
        readyBtn.style.opacity = '1';
      });
    }

    let confirmed = false;
    readyBtn.addEventListener('click', () => {
      if (confirmed || readyBtn.disabled) return;
      confirmed = true;
      readyBtn.textContent = 'Waiting…';
      readyBtn.disabled = true;
      readyBtn.style.opacity = '0.5';
      root.querySelector('#cq-ready-status').textContent = 'Waiting for other players…';
      socket.send({ type: MSG.CQ_READY });
    });

    onGo = (ev) => { dicePool = ev.detail.pools; showAllocate(); };
  }

  // ── Allocate ──

  function showAllocate() {
    myAlloc = {};
    const frontier = getFrontier(map, ownership, myRole);
    const owned = map.nodes.filter(n => ownership[n.id] === myRole).map(n => n.id);
    const targets = [...new Set([...frontier, ...owned])];
    const pool = dicePool[myRole] ?? 8;

    root.innerHTML = `
      <div style="min-height:100vh;width:100%;background:#08080f;color:#ccc;display:flex;flex-direction:column;align-items:center;font-family:monospace;">
        ${headerHtml(`Round ${roundIndex + 1} — allocate your dice`)}
        <div style="width:100%;max-width:560px;margin:0 auto;padding:16px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;">
          <div id="cq-territory-strip" style="width:100%;">${territoryCountHtml()}</div>
          <div id="cq-secret-warning" style="width:100%;">${secretWarningHtml()}</div>
          <div style="color:#4aaeff;font-size:1.4rem;font-weight:bold;margin:8px 0;"><span id="cq-pool-left">${pool}</span> <span style="color:#555;font-size:0.8rem;">of ${pool} dice left</span></div>
          <div id="cq-map-area" style="width:100%;margin-bottom:10px;"></div>
          <div id="cq-target-list" style="width:100%;display:flex;flex-direction:column;gap:6px;"></div>
          <button id="cq-commit-btn" style="width:100%;margin-top:14px;padding:14px;background:#4aaeff;color:#000;border:none;border-radius:8px;font-size:1rem;cursor:pointer;font-family:monospace;font-weight:bold;">COMMIT</button>
        </div>
      </div>`;
    mountVibeModeBar();

    const listEl = root.querySelector('#cq-target-list');
    const poolLeftEl = root.querySelector('#cq-pool-left');
    const commitBtn = root.querySelector('#cq-commit-btn');
    const mapArea = root.querySelector('#cq-map-area');

    function tokensPlaced() { return Object.values(myAlloc).reduce((a, b) => a + b, 0); }

    targets.forEach(nodeId => {
      const node = map.nodes.find(n => n.id === nodeId);
      const mine = owned.includes(nodeId);
      const row = document.createElement('div');
      row.dataset.node = nodeId;
      row.style.cssText = `background:#12121e;border:1px solid ${mine ? '#2a4a6a' : '#2a2a4a'};border-radius:8px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;`;
      row.innerHTML = `
        <span style="color:#ddd;font-size:0.85rem;">${TYPE_ICON[node.type] || ''} ${labelFor(node)}${mine ? ' <span style="color:#4aaeff;font-size:0.7rem;">(yours)</span>' : ''}</span>
        <span style="display:flex;align-items:center;gap:8px;">
          <button class="cq-dec" style="width:28px;height:28px;border-radius:50%;background:#1a1a2a;border:1px solid #2a2a4a;color:#888;cursor:pointer;">−</button>
          <span class="cq-count" style="color:#4aaeff;font-weight:bold;min-width:20px;text-align:center;">0</span>
          <button class="cq-inc" style="width:28px;height:28px;border-radius:50%;background:#0a1a2a;border:1px solid #2a4a6a;color:#4aaeff;cursor:pointer;">+</button>
        </span>`;
      row.querySelector('.cq-inc').addEventListener('click', () => adjust(nodeId, 1));
      row.querySelector('.cq-dec').addEventListener('click', () => adjust(nodeId, -1));
      listEl.appendChild(row);
    });

    function adjust(nodeId, delta) {
      const cur = myAlloc[nodeId] || 0;
      const next = cur + delta;
      if (next < 0 || (delta > 0 && tokensPlaced() >= pool)) return;
      myAlloc[nodeId] = next;
      listEl.querySelector(`[data-node="${nodeId}"] .cq-count`).textContent = next;
      poolLeftEl.textContent = pool - tokensPlaced();
      renderMapInto(mapArea, { highlightIds: targets, diceCounts: myAlloc });
    }

    renderMapInto(mapArea, { highlightIds: targets, diceCounts: myAlloc });
    mapArea.addEventListener('click', (e) => {
      const el = e.target.closest('[data-node]');
      if (el) adjust(el.dataset.node, 1);
    });

    let committed = false;
    commitBtn.addEventListener('click', () => {
      if (committed) return;
      committed = true;
      commitBtn.disabled = true;
      commitBtn.textContent = 'Committed — waiting…';
      commitBtn.style.background = '#1a4a2a'; commitBtn.style.color = '#00ff88';
      socket.send({ type: MSG.CQ_ALLOCATE, allocation: { ...myAlloc } });
    });

    onReveal = (ev) => showReveal(ev.detail);
  }

  // ── Reveal ──

  function showReveal(detail) {
    ownership = detail.ownership;
    dicePool = detail.dicePool;
    roundIndex = detail.roundIndex;
    controlStreakHolder = detail.controlStreakHolder;
    controlStreak = detail.controlStreak;
    edgePostHolder = detail.edgePostHolder;
    mirrorHolder = detail.mirrorHolder;
    musterHolder = detail.musterHolder;

    root.innerHTML = `
      <div style="min-height:100vh;width:100%;background:#08080f;color:#ccc;display:flex;flex-direction:column;align-items:center;font-family:monospace;">
        ${headerHtml('REVEAL')}
        <div style="width:100%;max-width:560px;margin:0 auto;padding:16px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;">
          <div id="cq-territory-strip" style="width:100%;">${territoryCountHtml()}</div>
          <div id="cq-secret-warning" style="width:100%;">${secretWarningHtml()}</div>
          <div id="cq-map-area" style="width:100%;margin:10px 0;"></div>
          <div id="cq-edge-notice" style="width:100%;"></div>
          <div id="cq-reveal-log" style="width:100%;display:flex;flex-direction:column;gap:4px;font-size:0.78rem;"></div>
          <button id="cq-continue-btn" disabled style="margin-top:16px;padding:12px 28px;background:#1a1a2a;border:1px solid #2a2a4a;color:#444;border-radius:8px;font-family:monospace;cursor:not-allowed;">Continue…</button>
        </div>
      </div>`;
    mountVibeModeBar();

    // Edge Post isn't a one-off forfeit — it's a gate that blocks Ready on the *next* round's
    // screen — so make the upcoming obligation explicit here too, not just as a surprise banner.
    const edgeNoticeEl = root.querySelector('#cq-edge-notice');
    if (edgePostHolder) {
      const owers = playerRoles.filter(r => r !== edgePostHolder && !(state.cqBotRoles || []).includes(r));
      if (owers.length) {
        edgeNoticeEl.innerHTML = `<div style="background:#1a0a0a;border:1px solid #4a2a2a;border-radius:8px;padding:8px 12px;margin-bottom:8px;text-align:center;color:#f88;font-size:0.75rem;">📍 Edge Post: ${nameFor(edgePostHolder)} holds it — ${owers.map(nameFor).join(', ')} must edge before next round.</div>`;
      }
    }

    const resultsMap = {};
    detail.contested.forEach(entry => {
      const totals = {};
      for (const role of playerRoles) totals[role] = detail.rolls?.[role]?.[entry.nodeId]?.total ?? 0;
      resultsMap[entry.nodeId] = { totals, winnerRole: entry.winnerRole };
    });
    renderMapInto(root.querySelector('#cq-map-area'), { results: resultsMap });

    // Push a persistent history line for each named hex that actually changed hands this round
    // (entry.previousOwner !== entry.winnerRole). Plain 'safe'/'start' spaces are skipped — same
    // "nothing worth calling out" treatment they already get everywhere else in this file (see
    // the icon/label skip at the top of renderMapInto) — otherwise a land-grab round could push a
    // dozen uninteresting "quiet ground" lines. Uses entry.roundIndex (the round that was just
    // resolved, pre-increment) rather than the outer `roundIndex` (already reassigned above to
    // detail.roundIndex, the *next* round's index) so the tag matches what was on screen when it happened.
    detail.contested.forEach(entry => {
      if (entry.winnerRole === entry.previousOwner) return;
      const node = map.nodes.find(n => n.id === entry.nodeId);
      if (!node || node.type === 'safe' || node.type === 'start') return;
      const label = TYPE_LABEL[node.type] || node.id;
      const tag = `R${entry.roundIndex + 1}`;
      if (entry.winnerRole === 'neutral') {
        logEvent(`${tag}: ${label} slips from ${nameFor(entry.previousOwner)} to neutral ground.`);
      } else if (!entry.previousOwner || entry.previousOwner === 'neutral') {
        logEvent(`${tag}: ${nameFor(entry.winnerRole)} claims ${label}.`);
      } else {
        logEvent(`${tag}: ${nameFor(entry.winnerRole)} takes ${label} from ${nameFor(entry.previousOwner)}.`);
      }
    });

    // Only forfeit- and territory-change events are logged here — full round-by-round dice
    // totals are already visible directly on the map (fill color + per-role dice totals on each
    // contested hex), we only add a line for hexes that changed hands. Secret Trap hits never
    // appear here as broadcast data — they arrive earlier via the private cq_secret_status
    // message (see onSecretStatus above), which already pushed its own line into eventLog for
    // whichever single player actually triggered it, so this stays public-safe by construction.
    const log = root.querySelector('#cq-reveal-log');

    if (eventLog.length === 0) {
      log.innerHTML = `<div style="color:#444;text-align:center;">Nothing notable yet.</div>`;
    } else {
      eventLog.forEach(text => {
        const line = document.createElement('div');
        line.style.color = '#4aaeff';
        line.textContent = text;
        log.appendChild(line);
      });
    }

    const btn = root.querySelector('#cq-continue-btn');
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = 'Continue';
      btn.style.cssText = 'margin-top:16px;padding:12px 28px;background:#4aaeff;border:1px solid #4aaeff;color:#000;border-radius:8px;font-family:monospace;cursor:pointer;font-weight:bold;';
    }, 1200);
    btn.addEventListener('click', () => showReady());
  }

  // ── Match end ──

  function showMatchEnd(detail) {
    const winnerRole = detail.winnerRole;
    // Two ways to end up with no single human winner: the computer took the realm (never gets
    // a "control" hand of its own), or the round cap was reached still tied (winnerRole: null,
    // no sudden death anymore — a tie just ends the match). Both read as a draw between the humans.
    const isBotWin = (state.cqBotRoles || []).includes(winnerRole);
    const isDraw = isBotWin || !winnerRole;
    const loserRoles = playerRoles.filter(r => r !== winnerRole && !(state.cqBotRoles || []).includes(r));
    const amIWinner = !isDraw && myRole === winnerRole;
    const amILoser = loserRoles.includes(myRole);

    const bannerColor = isDraw ? '#ffcc44' : amIWinner ? '#00ff88' : '#f44';
    const bannerText = isDraw ? 'DRAW' : amIWinner ? 'VICTORY' : 'DEFEAT';
    const subText = isBotWin
      ? `The computer took the realm — neither of you won.`
      : isDraw
        ? `The round cap was reached in a tie — no one controls the realm.`
        : `${nameFor(winnerRole)} controls the realm`;

    root.innerHTML = `
      <div style="min-height:100vh;width:100%;background:#08080f;color:#ccc;display:flex;flex-direction:column;align-items:center;font-family:monospace;">
        ${headerHtml('MATCH END')}
        <div style="width:100%;max-width:560px;margin:0 auto;padding:24px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;">
          <div style="color:${bannerColor};font-size:1.4rem;letter-spacing:2px;margin-bottom:8px;">${bannerText}</div>
          <div style="color:#888;font-size:0.85rem;margin-bottom:16px;">${subText}</div>
          <div id="cq-map-area" style="width:100%;margin-bottom:16px;"></div>
          <div id="cq-end-passives" style="width:100%;"></div>
          <div id="cq-vibe-control" style="width:100%;"></div>
          <button id="cq-end-btn" style="margin-top:20px;background:#1a1a2a;border:1px solid #2a2a4a;border-radius:8px;padding:12px 24px;color:#888;font-family:monospace;cursor:pointer;">Back to lobby</button>
          <div id="cq-end-status" style="margin-top:10px;color:#444;font-size:0.75rem;"></div>
        </div>
      </div>`;
    mountVibeModeBar();

    renderMapInto(root.querySelector('#cq-map-area'));

    const passivesEl = root.querySelector('#cq-end-passives');
    if (detail.ridgepath) {
      const line = document.createElement('div');
      line.style.cssText = 'color:#f88;font-size:0.8rem;text-align:center;margin-bottom:6px;';
      line.textContent = `Ridgepath held by ${nameFor(detail.ridgepath.controllerRole) ?? 'no one'} — ${detail.ridgepath.oweRoles.map(nameFor).join(', ') || 'no one'} owe a 10-minute session before the next match.`;
      passivesEl.appendChild(line);
    }
    if (detail.reckoning) {
      const line = document.createElement('div');
      line.style.cssText = 'color:#f88;font-size:0.8rem;text-align:center;';
      const owers = `${detail.reckoning.oweRoles.map(nameFor).join(', ') || 'no one'}`;
      line.textContent = `The Reckoning held by ${nameFor(detail.reckoning.controllerRole) ?? 'no one'} — ${owers} ${reckoningForfeitPhrase()}`;
      passivesEl.appendChild(line);
    }
    if (state.cqGameForfeitText) {
      const line = document.createElement('div');
      line.style.cssText = 'color:#ffcc44;font-size:0.8rem;text-align:center;margin-top:6px;';
      line.textContent = `Game forfeit: ${state.cqGameForfeitText}`;
      passivesEl.appendChild(line);
    }

    // Match-loss vibe: whoever didn't win gets vibed for the rest of this screen. In the normal
    // case the winner drives it live (intensity here, pattern via the header bar above); in a
    // draw both losers share one control since there's no human winner to hold it.
    const isController = amIWinner || (isDraw && amILoser);
    const vibeEl = root.querySelector('#cq-vibe-control');
    let level = 0.7;

    if (amILoser) {
      haptics.setWaveVibeMode(true);
      haptics.startContinuousVibe(level);
    }

    if (isController) {
      vibeEl.innerHTML = `
        <div style="background:#1a0a0a;border:1px solid #4a2a2a;border-radius:8px;padding:12px;margin-bottom:8px;">
          <div style="color:#f88;font-size:0.78rem;margin-bottom:8px;text-align:center;">
            ${isDraw ? 'Shared control — you\'re both in it together' : `You control ${loserRoles.map(nameFor).join(', ')}'s vibe`}
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="color:#666;font-size:0.7rem;">Intensity</span>
            <input id="cq-end-slider" type="range" min="0" max="100" value="70" style="flex:1;">
            <span id="cq-end-pct" style="color:#f88;font-size:0.75rem;min-width:32px;text-align:right;">70%</span>
          </div>
          <div style="color:#555;font-size:0.68rem;text-align:center;margin-top:6px;">Pattern is set from the header above</div>
        </div>`;
      vibeEl.querySelector('#cq-end-slider').addEventListener('input', (e) => {
        level = e.target.value / 100;
        vibeEl.querySelector('#cq-end-pct').textContent = `${e.target.value}%`;
        if (isDraw) haptics.startContinuousVibe(level);
        socket.send({ type: MSG.CQ_MATCH_END_INTENSITY, level });
      });
    } else if (amILoser) {
      vibeEl.innerHTML = `<div style="background:#1a0a0a;border:1px solid #4a2a2a;border-radius:8px;padding:10px;margin-bottom:8px;text-align:center;color:#f88;font-size:0.78rem;">${nameFor(winnerRole)} is in control of your vibe.</div>`;
    }

    onMatchEndIntensity = (ev) => {
      if (!amILoser) return;
      haptics.startContinuousVibe(ev.detail.level);
    };

    if (detail.ridgepath?.oweRoles?.includes(myRole)) {
      haptics.startForfeitVibe(600);
      haptics.setForfeitIntensity(0.5);
    }
    if (detail.reckoning?.oweRoles?.includes(myRole)) {
      haptics.triggerReckoning(180);
    }

    const acked = new Set();
    const checkDone = () => {
      if (!playerRoles.every(r => acked.has(r))) return;
      haptics.stopContinuousVibe();
      haptics.stopAll();
      navigate(`#/session/${state.sessionId}`);
    };

    onMatchEndReady = (ev) => { acked.add(ev.detail.role); checkDone(); };

    let confirmed = false;
    root.querySelector('#cq-end-btn').addEventListener('click', () => {
      if (confirmed) return;
      confirmed = true;
      acked.add(myRole);
      root.querySelector('#cq-end-btn').textContent = 'Waiting for others…';
      root.querySelector('#cq-end-btn').disabled = true;
      socket.send({ type: MSG.CQ_MATCH_END_READY });
      checkDone();
    });
  }
}
