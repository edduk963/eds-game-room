import { socket } from '../net/socket.js';
import { MSG } from '../shared/messages.js';

export function getEdgeAssignment(seed, roundIndex) {
  // Deterministic per-round hash — doesn't consume the game's RNG
  const h = (((seed >>> 0) + Math.imul(roundIndex + 1, 0x9e3779b9)) >>> 0) % 100;
  if (h < 40) return 'none';
  if (h < 70) return 'both';
  if (h < 85) return 'host';
  return 'guest';
}

export function canEdge(assignment, role) {
  return assignment === 'both' || assignment === role;
}

function _label(assignment, role) {
  switch (assignment) {
    case 'none':  return 'Nobody edges this round';
    case 'both':  return 'Both players can edge';
    case 'host':  return role === 'host' ? 'You can edge (you are host)' : 'Host can edge';
    case 'guest': return role === 'guest' ? 'You can edge (you are guest)' : 'Guest can edge';
  }
}

export function showEdgeReadyOverlay({ role, seed, roundIndex, onReady }) {
  const assignment = getEdgeAssignment(seed, roundIndex);
  const myCanEdge = canEdge(assignment, role);
  let myReady = false;
  let settled = false;

  const overlay = document.createElement('div');
  overlay.className = 'edge-ready-overlay';
  overlay.innerHTML = `
    <div class="edge-ready-box">
      <div class="edge-ready-title">Edge Mode</div>
      <div class="edge-ready-assignment ${assignment === 'none' ? 'era-none' : 'era-active'}">
        ${_label(assignment, role)}
      </div>
      <div class="edge-ready-hint ${myCanEdge ? '' : 'era-hint-off'}">
        ${myCanEdge
          ? 'Press <strong>E</strong> during play to trigger a random pause (costs a life).'
          : 'Your E key is inactive this round.'}
      </div>
      <button id="era-btn">Ready</button>
      <div class="edge-ready-waiting" id="era-wait" style="visibility:hidden">Waiting for opponent…</div>
    </div>`;
  document.body.appendChild(overlay);

  const btn = overlay.querySelector('#era-btn');
  const waitEl = overlay.querySelector('#era-wait');

  function proceed() {
    if (settled) return;
    settled = true;
    overlay.remove();
    socket.removeEventListener(MSG.EDGE_GO, onGo);
    onReady(assignment);
  }

  function onGo() {
    proceed();
  }

  socket.addEventListener(MSG.EDGE_GO, onGo);

  btn.addEventListener('click', () => {
    if (myReady) return;
    myReady = true;
    btn.disabled = true;
    waitEl.style.visibility = 'visible';
    socket.send({ type: MSG.EDGE_READY });
  });

  const onNav = () => {
    settled = true;
    overlay.remove();
    socket.removeEventListener(MSG.EDGE_GO, onGo);
  };
  window.addEventListener('hashchange', onNav, { once: true });

  return { dismiss: onNav };
}
