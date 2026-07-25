import { socket } from './net/socket.js';
import { state } from './state.js';
import * as haptics from './haptics.js';
import { MSG } from './shared/messages.js';
import { VIBE_MODES } from './vibeModes.js';

const TEMPO_OPTIONS = [0.5, 1, 2, 5, 10];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function activeRoles() {
  const list = [{ role: 'host', name: state.hostName || 'Host' }];
  if (state.guestName) list.push({ role: 'guest', name: state.guestName });
  if (state.guest2Name) list.push({ role: 'guest2', name: state.guest2Name });
  return list;
}

// Renders a "Name: [mode ▾] [tempo ▾]" control per player in the session (works for
// both 2p and 3p sessions — activeRoles() includes guest2 whenever state.guest2Name is
// set). Any player can change any other player's mode/tempo — selections are synced
// over the socket, with state.vibeModes/MSG.VIBE_MODE_SET and state.vibeTempo/
// MSG.VIBE_TEMPO_SET as the shared source of truth. Both are per-role: a change only
// takes effect on the target's own device (via haptics.setVibeMode/setVibeTempo) once
// it reaches a client whose state.role matches that target.
export function initVibeModeBar(containerEl, opts = {}) {
  const { prepend = true } = opts;

  const bar = document.createElement('div');
  bar.className = 'vibe-mode-bar';

  function render() {
    bar.innerHTML = activeRoles().map(p => `
      <span class="vmb-entry">
        <span class="vmb-name">${escapeHtml(p.name)}</span>
        <select class="vmb-select" data-role="${p.role}" data-field="mode">
          ${VIBE_MODES.map(m => `<option value="${m.id}"${state.vibeModes[p.role] === m.id ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
        </select>
        <select class="vmb-select vmb-tempo-select" data-role="${p.role}" data-field="tempo">
          ${TEMPO_OPTIONS.map(t => `<option value="${t}"${state.vibeTempo[p.role] === t ? ' selected' : ''}>${t}x</option>`).join('')}
        </select>
      </span>`).join('');
  }

  function applyModeLocal(target, mode) {
    state.vibeModes[target] = mode;
    if (target === state.role) haptics.setVibeMode(mode);
  }

  function applyTempoLocal(target, tempo) {
    state.vibeTempo[target] = tempo;
    if (target === state.role) haptics.setVibeTempo(tempo);
  }

  bar.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-role]');
    if (!sel) return;
    const target = sel.dataset.role;
    if (sel.dataset.field === 'tempo') {
      const tempo = Number(sel.value);
      applyTempoLocal(target, tempo);
      socket.send({ type: MSG.VIBE_TEMPO_SET, target, tempo });
    } else {
      const mode = sel.value;
      applyModeLocal(target, mode);
      socket.send({ type: MSG.VIBE_MODE_SET, target, mode });
    }
  });

  const onRemoteUpdate = () => render();
  window.addEventListener('vibe-modes-updated', onRemoteUpdate);

  render();
  if (prepend) containerEl.prepend(bar);
  else containerEl.appendChild(bar);

  return {
    refresh: render,
    destroy() {
      window.removeEventListener('vibe-modes-updated', onRemoteUpdate);
      bar.remove();
    },
  };
}
