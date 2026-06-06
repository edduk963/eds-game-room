import { navigate } from '../main.js';

// ── API helpers ───────────────────────────────────────────────────────────────
async function api(path, body) {
  const opts = body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method: 'GET' };
  const r = await fetch(path, opts);
  return r.json();
}

// ── Map rendering ─────────────────────────────────────────────────────────────
const CW = 80, CH = 75, R = 22, PAD = 44;
const COLS = 11, ROWS = 5;
const SVG_W = COLS * CW + PAD * 2 - CW;
const SVG_H = ROWS * CH + PAD * 2 - CH;

function cx(space) { return space.col * CW + PAD; }
function cy(space) { return space.row * CH + PAD; }

const TYPE_ICON = { trap: '☠', toll: '⛔', sanctuary: '⛪', duel: '⚔', claim: '★', start: '⌂', safe: '' };

function drawMap(config, state, playerKey, validMoves) {
  const spaceMap = Object.fromEntries(config.spaces.map(s => [s.id, s]));
  const p1 = state.players.p1;
  const p2 = state.players.p2;

  // Edges
  const drawn = new Set();
  const edges = [];
  for (const [fromId, toIds] of Object.entries(config.adjacency)) {
    const from = spaceMap[fromId];
    if (!from) continue;
    for (const toId of toIds) {
      const key = [fromId, toId].sort().join('|');
      if (drawn.has(key)) continue;
      drawn.add(key);
      const to = spaceMap[toId];
      if (!to) continue;
      edges.push(`<line x1="${cx(from)}" y1="${cy(from)}" x2="${cx(to)}" y2="${cy(to)}" stroke="#1e2d4a" stroke-width="2"/>`);
    }
  }

  // Nodes
  const nodes = config.spaces.map(space => {
    const x = cx(space), y = cy(space);
    const isP1Here  = p1.pos === space.id;
    const isP2Here  = p2.pos === space.id;
    const p1Owns    = p1.owns.includes(space.id);
    const p2Owns    = p2.owns.includes(space.id);
    const isValid   = validMoves.includes(space.id);
    const isDuel    = state.pendingDuel?.spaceId === space.id;
    const p1Used    = p1.usedClaims.includes(space.id);
    const p2Used    = p2.usedClaims.includes(space.id);

    let fill   = '#131a2c';
    let stroke = '#2a3556';
    let sw     = 1.5;

    if (p1Owns) { fill = '#0e2244'; stroke = '#3a7bd5'; sw = 2; }
    if (p2Owns) { fill = '#2a0e22'; stroke = '#d53a7b'; sw = 2; }
    if (isValid) { stroke = '#5cffd4'; sw = 2.5; }
    if (isDuel)  { stroke = '#ffcc44'; sw = 3; }

    const glow = (isP1Here || isP2Here)
      ? `<circle cx="${x}" cy="${y}" r="${R + 8}" fill="none" stroke="${isP1Here && isP2Here ? '#ffcc44' : isP1Here ? '#3a7bd5' : '#d53a7b'}" stroke-width="1.5" opacity="0.5" />`
      : '';

    const icon = TYPE_ICON[space.type] ?? '';
    let label = '';
    if (isP1Here && isP2Here) label = `<text x="${x - 6}" y="${y + 4}" text-anchor="middle" font-size="10" fill="#3a7bd5" font-weight="bold">P1</text><text x="${x + 6}" y="${y + 4}" text-anchor="middle" font-size="10" fill="#d53a7b" font-weight="bold">P2</text>`;
    else if (isP1Here)        label = `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="12" fill="#fff" font-weight="bold">P1</text>`;
    else if (isP2Here)        label = `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="12" fill="#fff" font-weight="bold">P2</text>`;
    else if (icon)            label = `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="14" fill="#8794b8">${icon}</text>`;

    // Claim-used dot
    const usedDot = (p1Used || p2Used)
      ? `<circle cx="${x + R - 4}" cy="${y - R + 4}" r="4" fill="${p1Used && p2Used ? '#aaa' : p1Used ? '#3a7bd5' : '#d53a7b'}" />`
      : '';

    const fortBorder = space.fortified
      ? `<circle cx="${x}" cy="${y}" r="${R + 4}" fill="none" stroke="#ffcc44" stroke-width="1" stroke-dasharray="3,3"/>`
      : '';

    const cursor  = isValid ? 'cursor:pointer' : '';
    const dataAttr = isValid ? `data-move="${space.id}"` : '';

    const nameY = y + R + 13;
    const nameColor = p1Owns ? '#5a9bf5' : p2Owns ? '#f55a9b' : '#6a7a9a';

    return `
      ${fortBorder}
      ${glow}
      <circle cx="${x}" cy="${y}" r="${R}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" style="${cursor}" ${dataAttr}/>
      ${label}
      ${usedDot}
      <text x="${x}" y="${nameY}" text-anchor="middle" font-size="9" fill="${nameColor}" style="${cursor}" ${dataAttr}>${esc(space.name)}</text>
    `;
  });

  return `<svg width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg" id="conquest-svg" style="display:block">
    ${edges.join('')}
    ${nodes.join('')}
  </svg>`;
}

// ── Main render ───────────────────────────────────────────────────────────────
export async function renderConquest(root) {
  root.innerHTML = `<div style="color:var(--muted);padding:40px;text-align:center">Loading the realm…</div>`;

  let data;
  try { data = await api('/world'); }
  catch { root.innerHTML = `<div style="padding:40px;color:var(--warn)">Could not reach server.</div>`; return; }

  // Identify player
  const playerKey = await identifyPlayer(root, data.config);
  if (!playerKey) return;

  let pollTimer = null;
  let currentData = data;

  async function refresh() {
    try {
      currentData = await api('/world');
      render(currentData);
    } catch {}
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(refresh, 4000);
  }
  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  window.addEventListener('hashchange', stopPoll, { once: true });

  function render(d) {
    const { config, state } = d;
    const myPlayer  = state.players[playerKey];
    const oppKey    = playerKey === 'p1' ? 'p2' : 'p1';
    const oppPlayer = state.players[oppKey];
    const isMyTurn  = state.currentTurn === playerKey && !state.winner;
    const hasDuel   = !!state.pendingDuel;
    const myDuel    = hasDuel && (state.pendingDuel.attacker === playerKey || state.pendingDuel.defender === playerKey);
    const myPicked  = myDuel && (playerKey === state.pendingDuel.attacker ? state.pendingDuel.attackerPick !== null : state.pendingDuel.defenderPick !== null);

    const validMoves = (isMyTurn && !hasDuel)
      ? (config.adjacency[myPlayer.pos] || [])
      : [];

    const statusText = state.winner
      ? `${state.players[state.winner].name} wins by ${state.winReason}!`
      : hasDuel
        ? `Duel at ${config.spaces.find(s => s.id === state.pendingDuel.spaceId)?.name}`
        : isMyTurn ? 'Your turn' : `${oppPlayer.name}'s turn`;

    const statusColor = state.winner ? 'var(--gold)' : isMyTurn ? 'var(--accent)' : 'var(--muted)';

    // Owned claimable spaces with abilities
    const myClaimSpaces = config.spaces.filter(s =>
      s.type === 'claim' && s.ability && myPlayer.owns.includes(s.id) && s.ability.type !== 'sanctuary'
    );
    const oppClaimSpaces = config.spaces.filter(s =>
      s.type === 'claim' && s.ability && oppPlayer.owns.includes(s.id) && s.ability.type !== 'sanctuary'
    );

    const claimsHtml = myClaimSpaces.length ? myClaimSpaces.map(space => {
      const used = myPlayer.usedClaims.includes(space.id);
      return `<div style="margin:4px 0;padding:8px 10px;background:#0d1326;border-radius:8px;border:1px solid ${used ? '#2a3556' : '#3a4a6a'}">
        <div style="font-size:12px;font-weight:600;color:${used ? 'var(--muted)' : 'var(--ink)'}">★ ${esc(space.name)}</div>
        <div style="font-size:11px;color:var(--muted);margin:2px 0 6px">${esc(space.ability.label)}: ${esc(space.ability.desc)}</div>
        ${used
          ? `<span style="font-size:11px;color:var(--muted)">Used this session</span>`
          : `<button class="use-claim" data-space="${space.id}" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer">Invoke</button>`
        }
      </div>`;
    }).join('') : `<div style="font-size:12px;color:var(--muted)">No claim spaces owned.</div>`;

    const oppClaimsHtml = oppClaimSpaces.length ? oppClaimSpaces.map(space => {
      const used = oppPlayer.usedClaims.includes(space.id);
      return `<div style="margin:3px 0;padding:6px 8px;background:#0d1326;border-radius:6px;border:1px solid #2a1a2a;font-size:11px;color:var(--muted)">
        <span style="color:${used ? '#5a3a5a' : '#d53a7b'}">★ ${esc(space.name)}</span>
        — ${esc(space.ability.label)}${used ? ' <em>(used)</em>' : ''}
      </div>`;
    }).join('') : '';

    const recentLog = state.log.slice(0, 12).map(e =>
      `<div style="padding:4px 0;border-bottom:1px solid #1a2236;font-size:11px;color:var(--muted)">
        <span style="color:#3a4a6a;margin-right:6px">S${e.session} T${e.turn}</span>${esc(e.msg)}
      </div>`
    ).join('');

    const skipHtml = myPlayer.skipTokens > 0
      ? `<div style="margin-top:8px;padding:8px 10px;background:#0d1326;border-radius:8px;border:1px solid #2a3a2a">
          <div style="font-size:12px;color:var(--ink)">⛪ Skip Tokens: <strong>${myPlayer.skipTokens}</strong></div>
          <div style="font-size:11px;color:var(--muted);margin:3px 0 6px">Use to cancel a forfeit imposed on you.</div>
          <input id="skip-target" placeholder="Describe the forfeit to cancel…" style="width:100%;padding:5px 8px;background:#1a2236;border:1px solid #2a3556;border-radius:5px;color:var(--ink);font-size:11px;margin-bottom:5px">
          <button id="use-skip" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid #5cffd4;background:transparent;color:#5cffd4;cursor:pointer">Use Skip Token</button>
        </div>`
      : '';

    const duelHtml = myDuel
      ? myPicked
        ? `<div style="margin-top:8px;padding:10px;background:#1a1500;border:1px solid var(--gold);border-radius:8px;font-size:13px;color:var(--gold)">
            Duel in progress — waiting for ${oppPlayer.name} to pick…
            <div style="font-size:11px;color:var(--muted);margin-top:4px">Score: Attacker ${state.pendingDuel.attackerWins} — Defender ${state.pendingDuel.defenderWins} (need ${state.pendingDuel.needToWin})</div>
          </div>`
        : `<div style="margin-top:8px;padding:10px;background:#1a1500;border:1px solid var(--gold);border-radius:8px">
            <div style="font-size:13px;color:var(--gold);margin-bottom:8px">⚔ Duel at ${esc(config.spaces.find(s => s.id === state.pendingDuel.spaceId)?.name ?? '')} — pick 1–5</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${[1,2,3,4,5].map(n => `<button class="duel-pick" data-pick="${n}" style="flex:1;min-width:36px;padding:8px;border-radius:6px;border:1px solid var(--gold);background:transparent;color:var(--gold);font-size:16px;font-weight:bold;cursor:pointer">${n}</button>`).join('')}
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:6px">Higher number wins. Tie = repick. Fortified spaces need 2 wins.</div>
          </div>`
      : hasDuel && !myDuel
        ? `<div style="margin-top:8px;padding:10px;background:#1a1500;border:1px solid #6a4400;border-radius:8px;font-size:13px;color:#997744">Duel in progress between players…</div>`
        : '';

    root.innerHTML = `
      <div style="width:100%;max-width:1100px;padding:16px">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px;flex-wrap:wrap">
          <button id="back-btn" style="padding:6px 14px;border-radius:6px;border:1px solid #2a3556;background:transparent;color:var(--muted);cursor:pointer;font-size:13px">← Back</button>
          <h2 style="margin:0;font-size:20px;letter-spacing:1px">⚔ The Realm</h2>
          <span style="color:${statusColor};font-size:13px;font-weight:600">${statusText}</span>
          <span style="margin-left:auto;font-size:12px;color:var(--muted)">Session ${state.sessionNumber} · Turn ${state.turn} · ${myPlayer.name} (${playerKey === 'p1' ? '🔵' : '🔴'})</span>
        </div>

        <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">

          <!-- Map -->
          <div style="overflow-x:auto;flex:1;min-width:280px;background:var(--panel);border:1px solid #1e2a3a;border-radius:12px;padding:12px">
            <div style="font-size:11px;color:var(--muted);margin-bottom:8px">
              🔵 ${esc(state.players.p1.name)} (${state.players.p1.owns.length} spaces)
              &nbsp;·&nbsp;
              🔴 ${esc(state.players.p2.name)} (${state.players.p2.owns.length} spaces)
              &nbsp;·&nbsp;
              <span style="color:#5cffd4">★ = claim &nbsp; ⚔ = duel &nbsp; ☠ = trap &nbsp; ⛔ = toll &nbsp; ⛪ = rest</span>
            </div>
            ${drawMap(config, state, playerKey, validMoves)}
            ${isMyTurn && !hasDuel ? `<div style="font-size:11px;color:var(--accent);margin-top:6px">Click a highlighted space to move.</div>` : ''}
          </div>

          <!-- Sidebar -->
          <div style="width:260px;min-width:220px;display:flex;flex-direction:column;gap:10px">

            <!-- Turn / duel -->
            <div style="background:var(--panel);border:1px solid #1e2a3a;border-radius:10px;padding:12px">
              <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:6px">Status</div>
              <div style="font-size:12px;color:var(--muted)">
                Turn: <strong style="color:${isMyTurn ? 'var(--accent)' : 'var(--muted)'}">${isMyTurn ? 'Yours' : oppPlayer.name + "'s"}</strong><br>
                Session turns: ${state.sessionTurns} / ${config.turnsPerSession}<br>
                Your position: <strong>${esc(config.spaces.find(s => s.id === myPlayer.pos)?.name ?? myPlayer.pos)}</strong>
              </div>
              ${duelHtml}
              ${skipHtml}
            </div>

            <!-- My claims -->
            <div style="background:var(--panel);border:1px solid #1e2a3a;border-radius:10px;padding:12px">
              <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:6px">Your Claims</div>
              ${claimsHtml}
            </div>

            <!-- Opponent claims -->
            ${oppClaimSpaces.length ? `
            <div style="background:var(--panel);border:1px solid #2a1a2a;border-radius:10px;padding:12px">
              <div style="font-size:12px;font-weight:600;color:#d53a7b;margin-bottom:6px">${esc(oppPlayer.name)}'s Claims</div>
              ${oppClaimsHtml}
            </div>` : ''}

            <!-- Log -->
            <div style="background:var(--panel);border:1px solid #1e2a3a;border-radius:10px;padding:12px;max-height:260px;overflow-y:auto">
              <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:6px">Log</div>
              ${recentLog || '<div style="font-size:12px;color:var(--muted)">No events yet.</div>'}
            </div>

            <!-- Admin -->
            <div style="text-align:center">
              <button id="reset-btn" style="font-size:11px;padding:5px 12px;border-radius:6px;border:1px solid #2a3556;background:transparent;color:#3a4a6a;cursor:pointer">Reset Game</button>
            </div>

          </div>
        </div>
      </div>
    `;

    // ── Event listeners ─────────────────────────────────────────────────────
    root.querySelector('#back-btn').addEventListener('click', () => navigate('#/'));

    root.querySelector('#reset-btn').addEventListener('click', async () => {
      if (!confirm('Reset the entire game? All progress will be lost.')) return;
      stopPoll();
      const res = await api('/world/reset');
      if (res.state) { currentData = res; render(currentData); startPoll(); }
    });

    // Map clicks (move)
    root.querySelector('#conquest-svg')?.addEventListener('click', async (e) => {
      const move = e.target.closest('[data-move]')?.dataset?.move;
      if (!move) return;
      stopPoll();
      const res = await api('/world/move', { playerKey, spaceId: move });
      if (res.error) { alert(res.error); startPoll(); return; }
      currentData = res;
      render(currentData);
      startPoll();
    });

    // Duel picks
    root.querySelectorAll('.duel-pick').forEach(btn => {
      btn.addEventListener('click', async () => {
        stopPoll();
        const pick = parseInt(btn.dataset.pick, 10);
        const res = await api('/world/duel', { playerKey, pick });
        if (res.error) { alert(res.error); startPoll(); return; }
        currentData = res;
        render(currentData);
        startPoll();
      });
    });

    // Claim invocations
    root.querySelectorAll('.use-claim').forEach(btn => {
      btn.addEventListener('click', async () => {
        stopPoll();
        const res = await api('/world/claim', { playerKey, spaceId: btn.dataset.space });
        if (res.error) { alert(res.error); startPoll(); return; }
        currentData = res;
        render(currentData);
        startPoll();
      });
    });

    // Skip token
    root.querySelector('#use-skip')?.addEventListener('click', async () => {
      const targetDesc = root.querySelector('#skip-target')?.value?.trim();
      if (!targetDesc) { alert('Describe what forfeit you are cancelling.'); return; }
      stopPoll();
      const res = await api('/world/skip', { playerKey, targetDesc });
      if (res.error) { alert(res.error); startPoll(); return; }
      currentData = res;
      render(currentData);
      startPoll();
    });
  }

  render(currentData);
  startPoll();
}

// ── Player identity ───────────────────────────────────────────────────────────
async function identifyPlayer(root, config) {
  const stored = localStorage.getItem('conquestPlayer');
  if (stored === 'p1' || stored === 'p2') return stored;

  return new Promise(resolve => {
    root.innerHTML = `
      <div class="card" style="max-width:380px">
        <h2>Enter the Realm</h2>
        <p style="color:var(--muted);font-size:14px">Who are you?</p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px">
          <button id="pick-p1" style="padding:14px;border-radius:8px;border:1px solid #3a7bd5;background:#0e2244;color:#5a9bf5;font-size:15px;cursor:pointer">
            🔵 ${esc(config.players.p1)}
          </button>
          <button id="pick-p2" style="padding:14px;border-radius:8px;border:1px solid #d53a7b;background:#2a0e22;color:#f55a9b;font-size:15px;cursor:pointer">
            🔴 ${esc(config.players.p2)}
          </button>
          <button id="cancel-id" style="margin-top:4px;padding:8px;border-radius:6px;border:1px solid #2a3556;background:transparent;color:var(--muted);font-size:13px;cursor:pointer">← Back</button>
        </div>
        <p style="font-size:11px;color:var(--muted);margin-top:12px">Your choice is saved in this browser.</p>
      </div>
    `;
    root.querySelector('#pick-p1').addEventListener('click', () => { localStorage.setItem('conquestPlayer','p1'); resolve('p1'); });
    root.querySelector('#pick-p2').addEventListener('click', () => { localStorage.setItem('conquestPlayer','p2'); resolve('p2'); });
    root.querySelector('#cancel-id').addEventListener('click', () => { navigate('#/'); resolve(null); });
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
