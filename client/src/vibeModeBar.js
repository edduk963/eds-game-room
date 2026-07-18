import { socket } from './net/socket.js';
import { state } from './state.js';
import * as haptics from './haptics.js';
import { MSG } from './shared/messages.js';
import { VIBE_MODES } from './vibeModes.js';

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

// Renders a "Name: [mode ▾]" control per player in the session. Any player can
// change any other player's mode — selections are synced over the socket and
// state.vibeModes/MSG.VIBE_MODE_SET is the shared source of truth.
export function initVibeModeBar(containerEl, opts = {}) {
  const { prepend = true } = opts;

  const bar = document.createElement('div');
  bar.className = 'vibe-mode-bar';

  function render() {
    bar.innerHTML = activeRoles().map(p => `
      <span class="vmb-entry">
        <span class="vmb-name">${escapeHtml(p.name)}</span>
        <select class="vmb-select" data-role="${p.role}">
          ${VIBE_MODES.map(m => `<option value="${m.id}"${state.vibeModes[p.role] === m.id ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
        </select>
      </span>`).join('');
  }

  function applyLocal(target, mode) {
    state.vibeModes[target] = mode;
    if (target === state.role) haptics.setVibeMode(mode);
  }

  bar.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-role]');
    if (!sel) return;
    const target = sel.dataset.role;
    const mode = sel.value;
    applyLocal(target, mode);
    socket.send({ type: MSG.VIBE_MODE_SET, target, mode });
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
