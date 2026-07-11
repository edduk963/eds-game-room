import { state } from '../state.js';
import { navigate } from '../main.js';

export function renderLanding(root) {
  root.innerHTML = `
    <div class="card">
      <h1>Ed's Game Hub</h1>
      <div id="err"></div>
      <label for="name">Your name</label>
      <input id="name" type="text" maxlength="24" placeholder="e.g. Alice" value="${escapeHtml(state.myName || '')}" />
      <div class="actions">
        <button id="join-existing" class="ghost">Have a link?</button>
        <button id="create">Create session</button>
      </div>
      <div style="margin-top:16px;text-align:center;">
        <button id="open-wheel" class="ghost" style="width:100%;font-size:14px;">🎡 Spin the Wheel</button>
      </div>
      <div style="margin-top:16px;text-align:center;font-size:11px;opacity:0.5;">v${__APP_VERSION__} (${__COMMIT_HASH__})</div>
    </div>
  `;

  const nameEl = root.querySelector('#name');
  const errEl = root.querySelector('#err');
  nameEl.focus();

  root.querySelector('#create').addEventListener('click', async () => {
    const name = nameEl.value.trim();
    if (!name) { showError(errEl, 'Please enter a name.'); return; }
    state.myName = name;
    try {
      const res = await fetch('/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('failed');
      const { sessionId } = await res.json();
      navigate(`#/session/${sessionId}`);
    } catch {
      showError(errEl, 'Could not create session. Is the server running?');
    }
  });

  root.querySelector('#open-wheel').addEventListener('click', () => navigate('#/wheel'));

  root.querySelector('#join-existing').addEventListener('click', () => {
    const code = prompt('Paste session code or full URL:');
    if (!code) return;
    const m = code.match(/([A-Z0-9]{4,})\/?\s*$/i);
    if (!m) { showError(errEl, 'That doesn’t look like a valid code.'); return; }
    const name = nameEl.value.trim();
    if (!name) { showError(errEl, 'Please enter a name first.'); return; }
    state.myName = name;
    navigate(`#/session/${m[1].toUpperCase()}`);
  });
}

function showError(el, msg) {
  el.innerHTML = `<div class="error">${escapeHtml(msg)}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
