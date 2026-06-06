import { state } from '../state.js';
import { navigate } from '../main.js';

const DEV_GAMES = [
  {
    id: 'splitloot',
    name: 'Split the Loot',
    desc: 'Two-player vault escape. Collect loot, dodge guards, trigger hidden traps. Escape with enough loot or face the forfeits.',
  },
  {
    id: 'wizardisland',
    name: 'Wizard Island',
    desc: 'Roll dice to explore 8 islands, collect stat cards, cast spells, and battle each other and the Dark Wizard boss.',
  },
];

export function renderDevGames(root) {
  let selectedGame = state.devPreselect || 'splitloot';

  root.innerHTML = `
    <div class="card">
      <h1>Dev Games</h1>
      <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">Work-in-progress games. May be rough around the edges.</p>
      <div id="err"></div>
      <div class="game-list" id="dev-game-list">
        ${DEV_GAMES.map(g => `
          <div class="game-tile game-tile-selectable${g.id === selectedGame ? ' selected' : ''}" data-game="${g.id}">
            <div>
              <div class="name">${g.name}</div>
              <div class="desc">${g.desc}</div>
            </div>
          </div>
        `).join('')}
      </div>
      <label for="name" style="margin-top:16px;display:block;">Your name</label>
      <input id="name" type="text" maxlength="24" placeholder="e.g. Alice" value="${escapeHtml(state.myName || '')}" />
      <div class="actions" style="margin-top:12px;">
        <button class="ghost" id="back">Back</button>
        <button class="ghost" id="join-existing">Have a link?</button>
        <button id="create">Create session</button>
      </div>
    </div>
  `;

  const nameEl = root.querySelector('#name');
  const errEl = root.querySelector('#err');
  const gameList = root.querySelector('#dev-game-list');
  nameEl.focus();

  gameList.addEventListener('click', (e) => {
    const tile = e.target.closest('[data-game]');
    if (!tile) return;
    selectedGame = tile.dataset.game;
    state.devPreselect = selectedGame;
    gameList.querySelectorAll('.game-tile-selectable').forEach(t =>
      t.classList.toggle('selected', t.dataset.game === selectedGame)
    );
  });

  root.querySelector('#back').addEventListener('click', () => navigate('#/'));

  root.querySelector('#create').addEventListener('click', async () => {
    const name = nameEl.value.trim();
    if (!name) { showError(errEl, 'Please enter a name.'); return; }
    state.myName = name;
    state.devMode = true;
    state.devPreselect = selectedGame;
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

  root.querySelector('#join-existing').addEventListener('click', () => {
    const code = prompt('Paste session code or full URL:');
    if (!code) return;
    const m = code.match(/([A-Z0-9]{4,})\/?\s*$/i);
    if (!m) { showError(errEl, 'That doesn’t look like a valid code.'); return; }
    const name = nameEl.value.trim();
    if (!name) { showError(errEl, 'Please enter a name first.'); return; }
    state.myName = name;
    state.devMode = true;
    state.devPreselect = selectedGame;
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
