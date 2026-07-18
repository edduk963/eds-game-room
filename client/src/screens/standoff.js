import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';
import { initVibeModeBar } from '../vibeModeBar.js';
import {
  drawBattlefieldSchedule, drawPowerDraft, tokenPoolSize,
  resolveRound, resolveRoundTie, applyPostRevealPowers,
  roundVibeSeconds, matchEndVibeSeconds, checkMatchWinner,
  POWER_POOL,
} from '../game/standoffGame.js';

export function renderStandoff(root) {
  root.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#4aaeff;font-size:2rem;font-family:monospace;">Standoff…</div>`;

  const myRole = state.role;
  const difficulty = state.soDifficulty === 'beginner' ? 'beginner' : 'experienced';
  const fieldSchedule = drawBattlefieldSchedule(state.seed, difficulty);
  let fields = fieldSchedule[0];

  // One random power per player, assigned from seed
  const allPowers = drawPowerDraft(state.seed);
  const myPowerCard = POWER_POOL.find(p => p.id === allPowers[myRole === 'host' ? 0 : 1].id) || allPowers[0];
  const myPowerId = myPowerCard.id;
  let myPowerUsed = false;

  let phase = 'preview';
  let roundIndex = 0;
  let myRoundWins = 0;
  let oppRoundWins = 0;
  let roundResults = [];
  let bountyCarried = false;
  let chickenTokenBonus = 0;

  let myAlloc = {};
  let oppAlloc = {};
  let intelField = null;

  // Intel result carried over to the START of the next allocation
  let pendingIntelResult = null;
  // Spy field picked for the upcoming allocation (cleared after reveal)
  let pendingSpyField = null;

  const myKey = myRole === 'host' ? 'A' : 'B';
  const oppKey = myRole === 'host' ? 'B' : 'A';

  let vibeModeBarInstance = null;
  // Every phase fully reassigns root.innerHTML, wiping any appended child — remount after each.
  function mountVibeModeBar() {
    if (vibeModeBarInstance) vibeModeBarInstance.destroy();
    vibeModeBarInstance = initVibeModeBar(root);
  }

  function onGo(ev) {}
  function onSpyReveal(ev) {}
  function onOppTokenCount(ev) {}
  function onReveal(ev) {}
  function onPowerBroadcast(ev) {}
  function onChickenIntensity(ev) {}
  function onChickenResult(ev) {}
  function onVibePattern(ev) {}

  socket.addEventListener(MSG.SO_GO, onGo);
  socket.addEventListener(MSG.SO_SPY_REVEAL, onSpyReveal);
  socket.addEventListener(MSG.SO_OPP_TOKEN_COUNT, onOppTokenCount);
  socket.addEventListener(MSG.SO_REVEAL, onReveal);
  socket.addEventListener(MSG.SO_POWER_BROADCAST, onPowerBroadcast);
  socket.addEventListener(MSG.SO_CHICKEN_INTENSITY, onChickenIntensity);
  socket.addEventListener(MSG.SO_CHICKEN_RESULT, onChickenResult);
  socket.addEventListener(MSG.SO_VIBE_PATTERN, onVibePattern);

  window.addEventListener('hashchange', () => {
    socket.removeEventListener(MSG.SO_GO, onGo);
    socket.removeEventListener(MSG.SO_SPY_REVEAL, onSpyReveal);
    socket.removeEventListener(MSG.SO_OPP_TOKEN_COUNT, onOppTokenCount);
    socket.removeEventListener(MSG.SO_REVEAL, onReveal);
    socket.removeEventListener(MSG.SO_POWER_BROADCAST, onPowerBroadcast);
    socket.removeEventListener(MSG.SO_CHICKEN_INTENSITY, onChickenIntensity);
    socket.removeEventListener(MSG.SO_CHICKEN_RESULT, onChickenResult);
    socket.removeEventListener(MSG.SO_VIBE_PATTERN, onVibePattern);
    if (vibeModeBarInstance) { vibeModeBarInstance.destroy(); vibeModeBarInstance = null; }
    haptics.stopAll();
  }, { once: true });

  showPreview();

  // ── Phase 1: Preview ──

  function showPreview() {
    phase = 'preview';
    root.innerHTML = `
      <div style="min-height:100vh;width:100%;background:#08080f;color:#ccc;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;font-family:monospace;">
        <div style="color:#4aaeff;font-size:1.4rem;margin-bottom:4px;letter-spacing:2px;">STANDOFF</div>
        <div style="color:#666;font-size:0.8rem;margin-bottom:32px;">${difficulty === 'beginner' ? 'Round 1 battlefields — more are added as the match goes on' : 'Battlefields this match'}</div>
        <div id="so-field-list" style="display:flex;flex-direction:column;gap:12px;width:100%;max-width:380px;"></div>
        <div id="so-preview-status" style="margin-top:24px;color:#444;font-size:0.75rem;">Revealing battlefields…</div>
      </div>`;
    mountVibeModeBar();

    const list = root.querySelector('#so-field-list');
    const status = root.querySelector('#so-preview-status');
    let revealed = 0;

    function revealNext() {
      if (revealed >= fields.length) { status.textContent = 'Preparing match…'; setTimeout(showBriefing, 2000); return; }
      const f = fields[revealed++];
      const card = document.createElement('div');
      card.style.cssText = `background:#12121e;border:1px solid #2a2a4a;border-radius:8px;padding:14px 16px;opacity:0;transition:opacity 0.5s;display:flex;align-items:flex-start;gap:12px;`;
      card.innerHTML = `
        <canvas width="40" height="40" style="border-radius:4px;flex-shrink:0;margin-top:2px;"></canvas>
        <div style="flex:1;"><div style="color:#ddd;font-size:0.95rem;font-weight:bold;">${f.name}</div><div style="color:#666;font-size:0.72rem;margin-top:3px;line-height:1.4;">${fieldDesc(f)}</div></div>
        <div style="flex-shrink:0;text-align:right;"><div style="color:#4aaeff;font-size:0.8rem;">${f.pts ? f.pts + 'pt' : '—'}</div><div style="color:#555;font-size:0.68rem;margin-top:2px;">${f.rate}s/t</div></div>
      `;
      list.appendChild(card);
      drawFieldIcon(card.querySelector('canvas'), f.id);
      requestAnimationFrame(() => { card.style.opacity = '1'; });
      setTimeout(revealNext, 2200);
    }
    revealNext();
  }

  // ── Phase 2: Briefing ──

  function showBriefing() {
    phase = 'briefing';
    const powerCtx = {
      surge:     { when: 'During allocation', how: 'Tap the power button to unlock +3 extra tokens for this round.' },
      intel:     { when: 'During allocation', how: 'Declare a field — at the start of the next round you\'ll see opponent\'s count there.' },
      ghost:     { when: 'During allocation', how: 'Activate once — opponent sees your total as 0 all round.' },
      forfeit:   { when: 'During allocation', how: 'Concede one field for +4 extra tokens to use elsewhere.' },
      reinforce: { when: 'Post-reveal (10s)', how: 'Pick a field you lost by ≤2 tokens — 2 tokens added to your side.' },
      sabotage:  { when: 'Post-reveal (10s)', how: 'Pick a field opponent won — remove 3 tokens from their side.' },
    };
    const ctx = powerCtx[myPowerId] || {};

    root.innerHTML = `
      <div style="min-height:100vh;width:100%;background:#08080f;color:#ccc;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;font-family:monospace;max-width:480px;margin:0 auto;">
        <div style="color:#4aaeff;font-size:1.1rem;margin-bottom:20px;letter-spacing:2px;">HOW TO PLAY</div>
        <div style="width:100%;background:#0a1a2a;border:1px solid #2a4a6a;border-radius:8px;padding:14px 16px;margin-bottom:16px;box-sizing:border-box;">
          <div style="color:#888;font-size:0.68rem;letter-spacing:1px;margin-bottom:6px;">YOUR POWER THIS MATCH</div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:1.8rem;">${powerIcon(myPowerId)}</span>
            <div>
              <div style="color:#4aaeff;font-size:0.95rem;font-weight:bold;">${myPowerCard.name}</div>
              <div style="color:#aaa;font-size:0.78rem;margin-top:2px;">${myPowerCard.desc}</div>
              <div style="color:#555;font-size:0.68rem;margin-top:4px;font-style:italic;">${ctx.when} · ${ctx.how}</div>
            </div>
          </div>
        </div>
        <div style="background:#12121e;border:1px solid #2a2a4a;border-radius:8px;padding:20px;width:100%;box-sizing:border-box;font-size:0.8rem;line-height:1.7;">
          <b style="color:#ddd;">ALLOCATE</b><br>Split your tokens across 5 battlefields in secret. Tap a card to place a token.<br><br>
          <b style="color:#ddd;">REVEAL</b><br>Both reveal simultaneously. Higher tokens wins the field. Win = small vibe. Lose = full penalty. Tie = 1.5× — worse than losing. Both 0 = 10s each.<br><br>
          <b style="color:#ddd;">ROUNDS</b><br>Most battlefields wins the round. First to 3 rounds wins the match. Round 5: all field values double. Down 0–2: +3 tokens.${difficulty === 'beginner' ? ' Battlefields start simple — new ones with special rules are introduced a couple at a time in later rounds, clearly marked NEW.' : ''}<br><br>
          <b style="color:#ddd;">TIED ROUND</b><br>Shared slider controls vibe for both. First to STOP gives opponent +3 tokens next round.
        </div>
        <button id="so-confirm" style="margin-top:20px;background:#4aaeff;color:#000;border:none;border-radius:8px;padding:14px 32px;font-size:1rem;cursor:pointer;font-family:monospace;font-weight:bold;">CONFIRM — I'M READY</button>
        <div id="so-brief-status" style="margin-top:12px;color:#444;font-size:0.75rem;">Waiting for opponent…</div>
      </div>`;
    mountVibeModeBar();

    let confirmed = false;
    root.querySelector('#so-confirm').addEventListener('click', () => {
      if (confirmed) return;
      confirmed = true;
      root.querySelector('#so-confirm').textContent = 'Confirmed ✓';
      root.querySelector('#so-confirm').style.background = '#2a6a4a';
      socket.send({ type: MSG.SO_READY });
    });
    socket.removeEventListener(MSG.SO_GO, onGo);
    onGo = () => startRound();
    socket.addEventListener(MSG.SO_GO, onGo);
  }

  // ── Round flow ──

  function startRound() {
    fields = fieldSchedule[roundIndex];
    if (roundIndex > 0) {
      const last = roundResults[roundResults.length - 1];
      if (last?.spyWonBy === myKey) { showSpyPick(); return; }
    }
    showAllocation();
  }

  function showSpyPick() {
    phase = 'spy';
    socket.send({ type: MSG.SO_SPY_WON });
    const nonSpy = fields.filter(f => f.id !== 'spy');
    root.innerHTML = `
      <div style="min-height:100vh;width:100%;background:#08080f;color:#ccc;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;font-family:monospace;">
        <div style="color:#4aaeff;margin-bottom:8px;letter-spacing:2px;">THE SPY 👁</div>
        <div style="color:#888;font-size:0.8rem;margin-bottom:24px;">Pick a field — you'll see opponent's live count there during allocation:</div>
        <div style="display:flex;flex-direction:column;gap:10px;width:100%;max-width:300px;">
          ${nonSpy.map(f => `<button data-field="${f.id}" style="background:#12121e;border:1px solid #2a2a4a;border-radius:8px;padding:14px;color:#ddd;font-family:monospace;font-size:0.9rem;cursor:pointer;text-align:left;">${f.name}</button>`).join('')}
        </div>
        <div id="so-spy-result" style="margin-top:20px;color:#555;font-size:0.85rem;min-height:24px;"></div>
      </div>`;
    mountVibeModeBar();
    root.querySelectorAll('[data-field]').forEach(btn => {
      btn.addEventListener('click', () => {
        socket.send({ type: MSG.SO_SPY_PICK, fieldId: btn.dataset.field });
        root.querySelectorAll('[data-field]').forEach(b => b.disabled = true);
        btn.style.borderColor = '#4aaeff';
        root.querySelector('#so-spy-result').textContent = 'Registered — entering allocation…';
      });
    });

    const onSpyAck = (ev) => {
      pendingSpyField = ev.detail.fieldId;
      socket.removeEventListener(MSG.SO_SPY_PICK_ACK, onSpyAck);
      setTimeout(showAllocation, 1200);
    };
    socket.addEventListener(MSG.SO_SPY_PICK_ACK, onSpyAck);
  }

  // ── Allocation ──

  function showAllocation() {
    phase = 'allocate';
    myAlloc = {};
    intelField = null;
    fields.forEach(f => { myAlloc[f.id] = 0; });

    let pool = tokenPoolSize(roundIndex, myRoundWins, oppRoundWins) + chickenTokenBonus;
    chickenTokenBonus = 0;
    let timerSeconds = 30;
    let tokenCountThrottle = 0;
    let forfeitedField = null;
    let ghostActive = false;
    let powerActivatedThisRound = false;

    function tokensPlaced() { return Object.values(myAlloc).reduce((a, b) => a + b, 0); }

    const showPower = !myPowerUsed && ['surge', 'ghost', 'forfeit', 'intel'].includes(myPowerId);

    const prevFields = roundIndex > 0 ? fieldSchedule[roundIndex - 1] : null;
    const isNewField = (f) => difficulty === 'beginner' && !!prevFields && !prevFields.some(pf => pf.id === f.id);

    const spyBanner = pendingSpyField ? (() => {
      const sf = fields.find(f => f.id === pendingSpyField);
      return `<div id="so-spy-banner" style="background:#0a1a0a;border:1px solid #2a4a2a;border-radius:8px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:1.2rem;">👁</span>
        <div style="flex:1;">
          <div style="color:#00ff88;font-size:0.78rem;font-weight:bold;">Spy active — ${sf?.name}</div>
          <div id="so-spy-live" style="color:#888;font-size:0.75rem;margin-top:2px;">Waiting for opponent to place tokens…</div>
        </div>
      </div>`;
    })() : '';

    const intelBanner = pendingIntelResult ? (() => {
      const f = fields.find(f => f.id === pendingIntelResult.fieldId);
      const res = pendingIntelResult;
      pendingIntelResult = null;
      return `<div style="background:#0a1a2a;border:1px solid #2a4a6a;border-radius:8px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:1.2rem;">🔍</span>
        <div><div style="color:#4aaeff;font-size:0.78rem;font-weight:bold;">Intel from last round</div>
        <div style="color:#aaa;font-size:0.75rem;margin-top:2px;">${f?.name} — opponent placed <b>${res.count}</b> token${res.count !== 1 ? 's' : ''} there</div></div>
      </div>`;
    })() : '';

    root.innerHTML = `
      <div id="so-alloc" style="min-height:100vh;width:100%;max-width:820px;margin:0 auto;background:#08080f;display:flex;flex-direction:column;font-family:monospace;padding:12px 14px;box-sizing:border-box;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div style="color:#4aaeff;font-size:0.85rem;">Round ${roundIndex + 1}/5</div>
          <div style="color:#888;font-size:0.8rem;">You ${myRoundWins}—${oppRoundWins} Opp</div>
          <div id="so-timer" style="color:#aaa;font-size:0.85rem;"></div>
        </div>
        ${spyBanner}${intelBanner}
        <div style="margin-bottom:14px;background:#0e0e1e;border-radius:8px;padding:10px 12px;box-sizing:border-box;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
            <span style="color:#888;font-size:0.72rem;letter-spacing:1px;">TOKEN POOL</span>
            <span style="color:#555;font-size:0.7rem;">Opp placed: <span id="so-opp-total">?</span></span>
          </div>
          <div style="background:#1a1a2a;border-radius:4px;height:8px;overflow:hidden;margin-bottom:5px;">
            <div id="so-pool-bar" style="background:#4aaeff;height:8px;width:0%;transition:width 0.15s;border-radius:4px;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;">
            <span id="so-tokens-left" style="color:#4aaeff;font-size:1rem;font-weight:bold;">${pool}</span>
            <span style="color:#444;font-size:0.7rem;">of ${pool} remaining</span>
          </div>
        </div>
        <div id="so-field-cards" style="display:grid;grid-template-columns:1fr;gap:8px;"></div>
        ${showPower ? `<div style="margin-top:10px;"><button id="so-power-btn" style="width:100%;padding:10px 14px;background:#1a1a2a;border:1px solid #2a3a4a;border-radius:8px;color:#aaa;font-family:monospace;font-size:0.82rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;"><span>${powerIcon(myPowerId)}</span><span class="pname">Use ${myPowerCard.name} — ${myPowerCard.desc}</span></button></div>` : (myPowerUsed ? `<div style="margin-top:8px;color:#333;font-size:0.72rem;text-align:center;">${powerIcon(myPowerId)} ${myPowerCard.name} already used</div>` : '')}
        <button id="so-commit-btn" disabled style="width:100%;padding:14px;background:#1a1a2a;border:1px solid #2a2a4a;border-radius:8px;color:#444;font-family:monospace;font-size:1rem;cursor:not-allowed;margin-top:10px;">Place all tokens to commit</button>
      </div>`;
    mountVibeModeBar();

    const timerEl = root.querySelector('#so-timer');
    const oppTotalEl = root.querySelector('#so-opp-total');
    const tokensLeftEl = root.querySelector('#so-tokens-left');
    const poolBar = root.querySelector('#so-pool-bar');
    const fieldCards = root.querySelector('#so-field-cards');
    const commitBtn = root.querySelector('#so-commit-btn');
    const powerBtn = root.querySelector('#so-power-btn');

    fields.forEach(f => {
      const isMirror = f.special === 'mirror';
      const isNew = isNewField(f);
      const wl = fieldWinLose(f);
      const card = document.createElement('div');
      card.dataset.fieldId = f.id;
      card.style.cssText = `background:#12121e;border:${isNew ? '2px solid #ffb84a' : '1px solid #2a2a4a'};border-radius:10px;padding:14px;cursor:pointer;transition:border-color 0.15s;user-select:none;display:flex;flex-direction:column;`;
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <canvas width="48" height="48" style="border-radius:6px;flex-shrink:0;"></canvas>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;">
              <div style="color:#ddd;font-size:1rem;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${f.name}</div>
              ${isNew ? `<span style="color:#ffb84a;font-size:0.6rem;font-weight:bold;letter-spacing:1px;background:#2a1e0a;padding:2px 6px;border-radius:4px;flex-shrink:0;">NEW</span>` : ''}
            </div>
            <div style="display:flex;gap:5px;align-items:baseline;margin-top:2px;">
              ${f.pts ? `<span style="color:#4aaeff;font-size:0.68rem;background:#0a1a2a;padding:1px 5px;border-radius:3px;">${f.pts}pt</span>` : ''}
              <span style="color:#555;font-size:0.66rem;">${f.rate}s/token</span>
            </div>
          </div>
        </div>
        <div style="font-size:0.72rem;line-height:1.5;margin-bottom:8px;">
          <div style="color:#4aeb9a;"><b>WIN:</b> ${wl.win}</div>
          <div style="color:#e07a7a;"><b>LOSE:</b> ${wl.lose}</div>
        </div>
        ${isMirror ? `<div id="so-mirror-${f.id}" style="color:#4aaeff;font-size:0.7rem;margin-bottom:6px;">Opp: ?</div>` : ''}
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;">
          <button class="so-dec" style="width:36px;height:36px;border-radius:50%;background:#1a1a2a;border:1px solid #2a2a4a;color:#888;font-size:1.3rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">−</button>
          <span class="so-count" style="color:#4aaeff;font-size:1.4rem;font-weight:bold;min-width:32px;text-align:center;cursor:pointer;">0</span>
          <button class="so-inc" style="width:36px;height:36px;border-radius:50%;background:#0a1a2a;border:1px solid #2a4a6a;color:#4aaeff;font-size:1.3rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>
        </div>
        <div class="so-dots" style="display:flex;gap:3px;flex-wrap:wrap;margin-top:8px;min-height:0;"></div>
      `;
      const cvs = card.querySelector('canvas');
      cvs.width = 48; cvs.height = 48;
      drawFieldIcon(cvs, f.id);
      card.addEventListener('click', (e) => { if (e.target.closest('.so-inc,.so-dec,.so-count')) return; adjustToken(f.id, 1); });
      card.querySelector('.so-inc').addEventListener('click', (e) => { e.stopPropagation(); adjustToken(f.id, 1); });
      card.querySelector('.so-dec').addEventListener('click', (e) => { e.stopPropagation(); adjustToken(f.id, -1); });
      card.querySelector('.so-count').addEventListener('click', (e) => { e.stopPropagation(); adjustToken(f.id, -1); });
      fieldCards.appendChild(card);
    });

    if (powerBtn) {
      powerBtn.addEventListener('click', () => {
        if (powerActivatedThisRound) return;
        if (myPowerId === 'surge') {
          powerActivatedThisRound = true; myPowerUsed = true; pool += 3;
          powerBtn.style.opacity = '0.3'; powerBtn.disabled = true; updatePoolDisplay();
        } else if (myPowerId === 'ghost') {
          powerActivatedThisRound = true; myPowerUsed = true; ghostActive = true;
          powerBtn.style.opacity = '0.3'; powerBtn.disabled = true;
          socket.send({ type: MSG.SO_TOKEN_COUNT, total: 0 });
        } else if (myPowerId === 'forfeit') {
          showFieldSelector('FORFEIT', 'Choose a field to concede — gain +4 tokens', (fid) => {
            powerActivatedThisRound = true; myPowerUsed = true;
            forfeitedField = fid; myAlloc[fid] = 0; pool += 4;
            powerBtn.style.opacity = '0.3'; powerBtn.disabled = true;
            powerBtn.querySelector('.pname').textContent = 'Forfeit → ' + fields.find(f => f.id === fid)?.name;
            updateFieldCard(fid); updateDots(fid); updatePoolDisplay();
          });
        } else if (myPowerId === 'intel') {
          showFieldSelector('INTEL', 'Choose a field — see opponent\'s count at start of next round', (fid) => {
            powerActivatedThisRound = true; myPowerUsed = true; intelField = fid;
            powerBtn.style.opacity = '0.3'; powerBtn.disabled = true;
            powerBtn.querySelector('.pname').textContent = 'Intel → ' + fields.find(f => f.id === fid)?.name;
          });
        }
      });
    }

    function updateDots(fieldId) {
      const card = fieldCards.querySelector(`[data-field-id="${fieldId}"]`);
      if (!card) return;
      const dots = card.querySelector('.so-dots');
      const count = myAlloc[fieldId] || 0;
      dots.innerHTML = '';
      for (let i = 0; i < count; i++) {
        const d = document.createElement('div');
        d.style.cssText = 'width:7px;height:7px;border-radius:50%;background:#4aaeff;opacity:0.75;';
        dots.appendChild(d);
      }
    }

    function adjustToken(fieldId, delta) {
      const cur = myAlloc[fieldId] || 0;
      const newVal = cur + delta;
      if (newVal < 0 || (delta > 0 && tokensPlaced() >= pool) || (forfeitedField === fieldId && delta > 0)) return;
      myAlloc[fieldId] = newVal;
      updateFieldCard(fieldId); updateDots(fieldId); updatePoolDisplay(); broadcastCount();
      const f = fields.find(f => f.id === fieldId);
      if (f?.special === 'mirror') socket.send({ type: MSG.SO_MIRROR_UPDATE, fieldId, count: myAlloc[fieldId] });
      socket.send({ type: MSG.SO_SPY_FIELD_UPDATE, fieldId, count: myAlloc[fieldId] });
    }

    function updateFieldCard(fieldId) {
      const card = fieldCards.querySelector(`[data-field-id="${fieldId}"]`);
      if (!card) return;
      card.querySelector('.so-count').textContent = myAlloc[fieldId];
      const forfeited = forfeitedField === fieldId;
      card.style.borderColor = forfeited ? '#553333' : (myAlloc[fieldId] > 0 ? '#2a4a6a' : '#2a2a4a');
      card.style.opacity = forfeited ? '0.45' : '1';
    }

    function updatePoolDisplay() {
      const placed = tokensPlaced(), left = pool - placed;
      tokensLeftEl.textContent = left;
      poolBar.style.width = `${(placed / pool) * 100}%`;
      const can = left === 0;
      commitBtn.disabled = !can;
      commitBtn.textContent = can ? 'COMMIT' : `Place all tokens to commit (${left} left)`;
      commitBtn.style.cssText = can
        ? 'width:100%;padding:14px;background:#4aaeff;border:1px solid #4aaeff;border-radius:8px;color:#000;font-family:monospace;font-size:1rem;cursor:pointer;margin-top:10px;'
        : 'width:100%;padding:14px;background:#1a1a2a;border:1px solid #2a2a4a;border-radius:8px;color:#444;font-family:monospace;font-size:1rem;cursor:not-allowed;margin-top:10px;';
    }

    function broadcastCount() {
      const now = Date.now();
      if (now - tokenCountThrottle < 100) return;
      tokenCountThrottle = now;
      socket.send({ type: MSG.SO_TOKEN_COUNT, total: ghostActive ? 0 : tokensPlaced() });
    }

    function showFieldSelector(title, subtitle, onSelect) {
      const sel = document.createElement('div');
      sel.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.88);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:monospace;z-index:20;padding:20px;box-sizing:border-box;`;
      sel.innerHTML = `<div style="color:#4aaeff;font-size:0.95rem;margin-bottom:6px;">${title}</div><div style="color:#666;font-size:0.75rem;margin-bottom:16px;">${subtitle}</div><div style="display:flex;flex-direction:column;gap:8px;width:100%;max-width:280px;">${fields.map(f => `<button data-fid="${f.id}" style="background:#12121e;border:1px solid #2a2a4a;border-radius:6px;padding:12px 16px;color:#ddd;font-family:monospace;font-size:0.85rem;cursor:pointer;text-align:left;display:flex;justify-content:space-between;"><span>${f.name}</span><span style="color:#555;font-size:0.72rem;">${f.pts ? f.pts + 'pt' : '—'}</span></button>`).join('')}</div><button id="sel-cancel" style="background:transparent;border:none;color:#555;font-family:monospace;font-size:0.8rem;cursor:pointer;margin-top:14px;">Cancel</button>`;
      document.body.appendChild(sel);
      sel.querySelectorAll('[data-fid]').forEach(b => b.addEventListener('click', () => { sel.remove(); onSelect(b.dataset.fid); }));
      sel.querySelector('#sel-cancel').addEventListener('click', () => sel.remove());
    }

    timerEl.textContent = timerSeconds + 's';
    const timerInterval = setInterval(() => {
      timerSeconds--;
      timerEl.textContent = timerSeconds + 's';
      if (timerSeconds <= 5) timerEl.style.color = '#f44';
      if (timerSeconds <= 0) { clearInterval(timerInterval); doCommit(); }
      if (timerSeconds <= 5) root.querySelectorAll('[id^="so-mirror-"]').forEach(el => { el.textContent = 'Opp: locked'; });
    }, 1000);

    commitBtn.addEventListener('click', () => {
      if (tokensPlaced() < pool) return;
      clearInterval(timerInterval);
      doCommit();
    });

    function doCommit() {
      commitBtn.disabled = true;
      commitBtn.textContent = 'Committed — waiting for opponent…';
      commitBtn.style.background = '#1a4a2a'; commitBtn.style.color = '#00ff88'; commitBtn.style.borderColor = '#2a6a4a';
      socket.send({ type: MSG.SO_COMMIT, fields: { ...myAlloc }, powersUsed: myPowerUsed && powerActivatedThisRound ? [myPowerId] : [], ...(intelField ? { intelField } : {}) });
    }

    socket.removeEventListener(MSG.SO_OPP_TOKEN_COUNT, onOppTokenCount);
    onOppTokenCount = (ev) => { if (oppTotalEl) oppTotalEl.textContent = ev.detail.total; };
    socket.addEventListener(MSG.SO_OPP_TOKEN_COUNT, onOppTokenCount);

    // Mirror field: show opponent's live count as they place tokens
    const mirrorFieldId = fields.find(f => f.special === 'mirror')?.id;
    const onMirrorUpdate = (ev) => {
      const el = mirrorFieldId ? root.querySelector(`#so-mirror-${mirrorFieldId}`) : null;
      if (el) el.textContent = `Opp: ${ev.detail.count}`;
    };
    socket.addEventListener(MSG.SO_MIRROR_UPDATE, onMirrorUpdate);

    // Spy: listen for live count on the watched field
    const spyLiveEl = pendingSpyField ? root.querySelector('#so-spy-live') : null;
    socket.removeEventListener(MSG.SO_SPY_REVEAL, onSpyReveal);
    if (pendingSpyField && spyLiveEl) {
      const spyFieldName = fields.find(f => f.id === pendingSpyField)?.name;
      onSpyReveal = (ev) => {
        const { count } = ev.detail;
        spyLiveEl.textContent = `${spyFieldName}: opponent has ${count} token${count !== 1 ? 's' : ''}`;
        spyLiveEl.style.color = '#00ff88';
      };
      socket.addEventListener(MSG.SO_SPY_REVEAL, onSpyReveal);
    }

    socket.removeEventListener(MSG.SO_REVEAL, onReveal);
    onReveal = (ev) => {
      clearInterval(timerInterval);
      socket.removeEventListener(MSG.SO_MIRROR_UPDATE, onMirrorUpdate);
      socket.removeEventListener(MSG.SO_SPY_REVEAL, onSpyReveal);
      pendingSpyField = null;
      showReveal(ev.detail);
    };
    socket.addEventListener(MSG.SO_REVEAL, onReveal);
  }

  // ── Reveal ──

  function showReveal(detail) {
    phase = 'reveal';
    const hostFields = detail.hostFields;
    const guestFields = detail.guestFields;
    const intelResult = detail.intelResult;

    // Store intel for the START of the next allocation (Change 3)
    if (intelResult && intelResult.forRole === myRole) pendingIntelResult = intelResult;

    const myAllocFull = myRole === 'host' ? hostFields : guestFields;
    const oppAllocFull = myRole === 'host' ? guestFields : hostFields;
    oppAlloc = oppAllocFull;

    const context = { bountyCarried, bountyDouble: false, round5: roundIndex === 4 };
    const result = resolveRound(fields, hostFields, guestFields, roundIndex, context);

    root.innerHTML = `
      <div id="so-reveal" style="min-height:100vh;width:100%;background:#08080f;display:flex;flex-direction:column;align-items:center;padding:16px;box-sizing:border-box;font-family:monospace;">
        <div style="color:#4aaeff;font-size:1rem;margin-bottom:2px;letter-spacing:2px;">REVEAL</div>
        <div style="color:#666;font-size:0.75rem;margin-bottom:16px;">Round ${roundIndex + 1}</div>
        <div id="so-reveal-cards" style="display:flex;flex-direction:column;gap:10px;width:100%;max-width:400px;"></div>
        <div id="so-reveal-summary" style="margin-top:20px;text-align:center;width:100%;max-width:400px;padding-bottom:24px;"></div>
      </div>`;
    mountVibeModeBar();

    if (!document.querySelector('#so-keyframes')) {
      const style = document.createElement('style');
      style.id = 'so-keyframes';
      style.textContent = `@keyframes soCardIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}@keyframes soFlash{from{opacity:0.8}to{opacity:0}}`;
      document.head.appendChild(style);
    }

    const revealCards = root.querySelector('#so-reveal-cards');
    const summary = root.querySelector('#so-reveal-summary');

    let cardIndex = 0;
    function flipNext() {
      if (cardIndex >= fields.length) { showRoundSummary(result, summary); return; }
      const f = fields[cardIndex++];
      const fr = result.fieldResults[f.id];
      const myT = myAllocFull[f.id] ?? 0;
      const oppT = oppAllocFull[f.id] ?? 0;
      const iWon = fr.winner === myKey;
      const tied = fr.winner === 'tie' || fr.winner === null;
      const col = tied ? '#888' : (iWon ? '#00ff88' : '#f44');
      const card = document.createElement('div');
      card.style.cssText = `background:#12121e;border:2px solid ${col};border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:10px;animation:soCardIn 0.3s ease-out;`;
      card.innerHTML = `<canvas width="36" height="36" style="border-radius:4px;flex-shrink:0;"></canvas><div style="flex:1;"><div style="color:#ddd;font-size:0.85rem;">${f.name}</div>${fr.gambitJackpot ? `<div style="color:#ffe;font-size:0.68rem;">★ Jackpot!</div>` : ''}</div><div style="display:flex;gap:12px;align-items:center;"><span style="color:#4aaeff;font-size:1.2rem;font-weight:bold;">${myT}</span><span style="color:#333;">vs</span><span style="color:#f44;font-size:1.2rem;font-weight:bold;">${oppT}</span></div><div style="color:${col};font-size:0.8rem;font-weight:bold;min-width:42px;text-align:right;">${tied ? 'TIE' : (iWon ? 'WIN' : 'LOSS')}</div>`;
      drawFieldIcon(card.querySelector('canvas'), f.id);
      revealCards.appendChild(card);
      if (fr.gambitJackpot) {
        const flash = document.createElement('div');
        flash.style.cssText = `position:fixed;inset:0;background:white;opacity:0.8;pointer-events:none;animation:soFlash 0.5s ease-out forwards;z-index:999;`;
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 500);
      }
      setTimeout(flipNext, 750);
    }
    setTimeout(flipNext, 400);
  }

  // ── Round Summary → Powers → Forfeit ──

  function showRoundSummary(result, summary) {
    const myFieldsWon = myKey === 'A' ? result.fieldsWonA : result.fieldsWonB;
    const oppFieldsWon = myKey === 'A' ? result.fieldsWonB : result.fieldsWonA;
    const rWinner = result.roundWinner;
    const rTie = resolveRoundTie(result);
    const isTrueDraw = rWinner === 'tie' && rTie === 'draw';
    const roundWinnerKey = rWinner !== 'tie' ? rWinner : rTie;
    const iWonRound = !isTrueDraw && roundWinnerKey === myKey;
    const roundColor = isTrueDraw ? '#888' : (iWonRound ? '#00ff88' : '#f44');
    const roundLabel = isTrueDraw ? 'DRAW — STANDOFF ROUND' : (iWonRound ? 'ROUND WIN ✓' : 'ROUND LOSS ✗');

    summary.innerHTML = `
      <div style="color:${roundColor};font-size:1.3rem;font-weight:bold;margin-bottom:8px;letter-spacing:1px;">${roundLabel}</div>
      <div style="color:#888;font-size:0.82rem;margin-bottom:4px;">You: ${myFieldsWon} field${myFieldsWon !== 1 ? 's' : ''} · Opp: ${oppFieldsWon} field${oppFieldsWon !== 1 ? 's' : ''}</div>
      <div id="so-summary-power-status" style="color:#555;font-size:0.72rem;margin-bottom:8px;">Resolving powers…</div>
    `;

    if (isTrueDraw) {
      summary.querySelector('#so-summary-power-status').textContent = '';
      setTimeout(showChicken, 1500);
      return;
    }

    if (iWonRound) myRoundWins++;
    else oppRoundWins++;

    const matchWinnerNow = checkMatchWinner(
      myRole === 'host' ? myRoundWins : oppRoundWins,
      myRole === 'host' ? oppRoundWins : myRoundWins
    );

    // Powers fire immediately — vibe deferred until after broadcast
    showPowerWindow(result, (modifiedResult) => {
      bountyCarried = modifiedResult.bountyCarriedToNext || false;
      roundResults.push({ ...modifiedResult, _roundIndex: roundIndex });

      const myVibe = roundVibeSeconds(modifiedResult, myKey);
      const oppVibe = roundVibeSeconds(modifiedResult, oppKey);
      const statusEl = summary.querySelector('#so-summary-power-status');
      if (statusEl) statusEl.remove();

      if (matchWinnerNow) {
        // Match over — no sync needed, just go to end screen
        showForfeitPanel(myVibe, oppVibe, iWonRound, summary, () => showMatchEnd(matchWinnerNow));
      } else {
        // Sync both players via SO_READY/SO_GO before starting next allocation.
        // This prevents the winner (shorter vibe) from entering allocation too early
        // and triggering the server's auto-commit timer before the loser arrives.
        const syncAndNextRound = () => {
          socket.send({ type: MSG.SO_READY });
          socket.removeEventListener(MSG.SO_GO, onGo);  // remove briefing-phase listener
          onGo = () => { roundIndex++; startRound(); }; // reassign module-level ref
          socket.addEventListener(MSG.SO_GO, onGo);
        };
        showForfeitPanel(myVibe, oppVibe, iWonRound, summary, syncAndNextRound);
      }
    });
  }

  // ── Post-reveal powers ──

  function showPowerWindow(pendingResult, onResolved) {
    phase = 'powers';
    const hasPostRevealPower = !myPowerUsed && ['reinforce', 'sabotage'].includes(myPowerId);

    if (!hasPostRevealPower) {
      socket.send({ type: MSG.SO_POWER_POST, power: 'pass' });
    } else {
      const overlay = document.createElement('div');
      overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.88);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:monospace;z-index:10;padding:20px;box-sizing:border-box;`;
      overlay.innerHTML = `
        <div style="color:#4aaeff;font-size:1rem;margin-bottom:6px;letter-spacing:1px;">POWER PLAY</div>
        <div style="color:#888;font-size:0.75rem;margin-bottom:16px;">Use your power or pass (10s)</div>
        <div style="background:#12121e;border:1px solid #2a2a4a;border-radius:8px;padding:16px 20px;margin-bottom:14px;max-width:300px;text-align:center;">
          <div style="font-size:1.6rem;margin-bottom:6px;">${powerIcon(myPowerId)}</div>
          <div style="color:#ddd;font-size:0.9rem;font-weight:bold;margin-bottom:4px;">${myPowerCard.name}</div>
          <div style="color:#888;font-size:0.75rem;">${myPowerCard.desc}</div>
          <button id="so-use-power" style="margin-top:12px;width:100%;padding:10px;background:#4aaeff;color:#000;border:none;border-radius:6px;font-family:monospace;font-size:0.85rem;font-weight:bold;cursor:pointer;">Use it</button>
        </div>
        <button id="so-pw-pass" style="background:#1a1a2a;border:1px solid #2a2a4a;border-radius:6px;padding:10px 20px;color:#666;font-family:monospace;cursor:pointer;">Pass</button>
        <div id="so-pw-timer" style="color:#444;font-size:0.75rem;margin-top:8px;"></div>`;
      document.body.appendChild(overlay);

      let timeLeft = 10, played = false;

      overlay.querySelector('#so-use-power').addEventListener('click', () => {
        if (played) return;
        overlay.style.display = 'none';
        const sel = document.createElement('div');
        sel.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:monospace;z-index:11;padding:20px;box-sizing:border-box;`;
        sel.innerHTML = `<div style="color:#4aaeff;margin-bottom:6px;">${myPowerCard.name} — choose target field</div><div style="color:#666;font-size:0.75rem;margin-bottom:16px;">${myPowerCard.desc}</div><div style="display:flex;flex-direction:column;gap:8px;width:100%;max-width:280px;">${fields.filter(f => f.id !== 'spy').map(f => `<button data-fid="${f.id}" style="background:#12121e;border:1px solid #2a2a4a;border-radius:6px;padding:12px 16px;color:#ddd;font-family:monospace;font-size:0.85rem;cursor:pointer;text-align:left;">${f.name}</button>`).join('')}</div><button id="pw-back" style="background:transparent;border:none;color:#555;font-family:monospace;font-size:0.8rem;cursor:pointer;margin-top:12px;">Back</button>`;
        document.body.appendChild(sel);
        sel.querySelectorAll('[data-fid]').forEach(b => b.addEventListener('click', () => {
          played = true; myPowerUsed = true;
          socket.send({ type: MSG.SO_POWER_POST, power: myPowerId, fieldId: b.dataset.fid });
          sel.remove(); overlay.remove();
        }));
        sel.querySelector('#pw-back').addEventListener('click', () => { overlay.style.display = 'flex'; sel.remove(); });
      });

      overlay.querySelector('#so-pw-pass').addEventListener('click', () => {
        if (played) return; played = true;
        socket.send({ type: MSG.SO_POWER_POST, power: 'pass' }); overlay.remove();
      });

      const t = setInterval(() => {
        timeLeft--;
        overlay.querySelector('#so-pw-timer').textContent = timeLeft + 's';
        if (timeLeft <= 0) { clearInterval(t); if (!played) { played = true; socket.send({ type: MSG.SO_POWER_POST, power: 'pass' }); overlay.remove(); } }
      }, 1000);
    }

    socket.removeEventListener(MSG.SO_POWER_BROADCAST, onPowerBroadcast);
    onPowerBroadcast = (ev) => {
      const { host, guest } = ev.detail;
      const myPlay  = myRole === 'host' ? host  : guest;
      const oppPlay = myRole === 'host' ? guest : host;
      const modifiedResult = applyPostRevealPowers(pendingResult, myPlay, oppPlay, fields, myKey);
      onResolved(modifiedResult);
    };
    socket.addEventListener(MSG.SO_POWER_BROADCAST, onPowerBroadcast);
  }

  // ── Forfeit Panel ──
  // Shows both players' timers. Intensity slider → controls OTHER player's device.
  // Winner: Continue unlocks when THEIR vibe ends → clicking grants Mercy (stops loser's vibe) + proceeds.
  // Loser:  Continue unlocks when THEIR vibe ends OR Mercy received.

  function showForfeitPanel(myVibeSeconds, oppVibeSeconds, iWonRound, container, nextFn) {
    if (myVibeSeconds > 0) {
      haptics.setWaveVibeMode(true);
      haptics.addForfeitSeconds(myVibeSeconds);
    }

    const myLabel  = iWonRound ? 'YOUR VIBE (winner)' : 'YOUR FORFEIT';
    const oppLabel = iWonRound ? 'THEIR FORFEIT' : 'THEIR VIBE (winner)';
    const myColor  = iWonRound ? '#4aaeff' : '#f44';
    const oppColor = iWonRound ? '#f44' : '#4aaeff';

    const panel = document.createElement('div');
    panel.innerHTML = `
      <div style="background:#0e0e1e;border:1px solid #2a2a3a;border-radius:8px;padding:14px;margin-top:12px;">

        <!-- My timer -->
        <div style="margin-bottom:12px;">
          <div style="color:${myColor};font-size:0.68rem;letter-spacing:1px;margin-bottom:5px;">${myLabel}</div>
          <div style="background:#1a1a2a;border-radius:3px;height:5px;overflow:hidden;margin-bottom:4px;">
            <div id="so-fp-mybar" style="background:${myColor};height:5px;width:100%;transition:width 0.2s;border-radius:3px;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;">
            <span id="so-fp-mytime" style="color:${myColor};font-size:1rem;font-weight:bold;">${myVibeSeconds > 0 ? Math.round(myVibeSeconds) + 's' : '—'}</span>
            <span id="so-fp-wave" style="color:#555;font-size:0.68rem;font-style:italic;">≈ steady</span>
          </div>
        </div>

        <!-- Opponent timer -->
        <div style="margin-bottom:14px;padding-top:10px;border-top:1px solid #1a1a2a;">
          <div style="color:${oppColor};font-size:0.68rem;letter-spacing:1px;margin-bottom:5px;">${oppLabel}</div>
          <div style="background:#1a1a2a;border-radius:3px;height:5px;overflow:hidden;margin-bottom:4px;">
            <div id="so-fp-oppbar" style="background:${oppColor};height:5px;width:100%;transition:width 0.2s;border-radius:3px;"></div>
          </div>
          <span id="so-fp-opptime" style="color:${oppColor};font-size:1rem;font-weight:bold;">${oppVibeSeconds > 0 ? Math.round(oppVibeSeconds) + 's' : '—'}</span>
        </div>

        <!-- Intensity slider (controls OTHER player) -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
          <span style="color:#555;font-size:0.68rem;flex-shrink:0;">Their intensity</span>
          <input id="so-fp-slider" type="range" min="0" max="100" value="100" style="flex:1;accent-color:${oppColor};height:5px;">
          <span id="so-fp-pct" style="color:#888;font-size:0.72rem;flex-shrink:0;min-width:30px;text-align:right;">100%</span>
        </div>

        <!-- Continue / Mercy -->
        <button id="so-fp-continue" disabled style="width:100%;padding:12px;border-radius:8px;font-family:monospace;font-size:0.9rem;background:#1a1a2a;border:1px solid #2a2a4a;color:#444;cursor:not-allowed;">
          ${myVibeSeconds > 0 ? (iWonRound ? 'Waiting for your vibe to end…' : 'Vibe running…') : 'Continue →'}
        </button>
        ${iWonRound ? `<div id="so-fp-mercy-hint" style="color:#444;font-size:0.68rem;text-align:center;margin-top:6px;">Once yours ends, you can grant Mercy to stop theirs</div>` : `<div id="so-fp-mercy-hint" style="color:#444;font-size:0.68rem;text-align:center;margin-top:6px;"></div>`}
      </div>
    `;
    container.appendChild(panel);

    const fpMyBar    = panel.querySelector('#so-fp-mybar');
    const fpMyTime   = panel.querySelector('#so-fp-mytime');
    const fpWave     = panel.querySelector('#so-fp-wave');
    const fpOppBar   = panel.querySelector('#so-fp-oppbar');
    const fpOppTime  = panel.querySelector('#so-fp-opptime');
    const fpSlider   = panel.querySelector('#so-fp-slider');
    const fpPct      = panel.querySelector('#so-fp-pct');
    const fpContinue = panel.querySelector('#so-fp-continue');
    const fpHint     = panel.querySelector('#so-fp-mercy-hint');

    let myDone = myVibeSeconds <= 0;
    let mercyGranted = false;
    let done = false;

    function finish() {
      if (done) return;
      done = true;
      socket.removeEventListener(MSG.SO_FORFEIT_INTENSITY, onForfeitIntensity);
      socket.removeEventListener(MSG.SO_MERCY, onMercy);
      haptics.stopAll();
      nextFn();
    }

    // Slider → controls OPPONENT's device
    fpSlider.addEventListener('input', () => {
      const v = fpSlider.value / 100;
      fpPct.textContent = Math.round(v * 100) + '%';
      socket.send({ type: MSG.SO_FORFEIT_INTENSITY, intensity: v });
    });

    // Receive intensity from opponent's slider → apply to my device
    const onForfeitIntensity = (ev) => {
      haptics.setForfeitIntensity(ev.detail.intensity);
    };
    socket.addEventListener(MSG.SO_FORFEIT_INTENSITY, onForfeitIntensity);

    // Mercy: winner sends → both proceed
    const onMercy = () => {
      mercyGranted = true;
      haptics.stopAll();
      if (!iWonRound) {
        fpHint.textContent = 'Mercy granted — proceeding…';
        fpHint.style.color = '#00ff88';
        setTimeout(finish, 800);
      }
    };
    socket.addEventListener(MSG.SO_MERCY, onMercy);

    const panelStart = Date.now();
    const interval = setInterval(() => {
      if (!fpMyTime.isConnected) { clearInterval(interval); return; }

      const elapsed = (Date.now() - panelStart) / 1000;
      const mySecs  = Math.max(0, myVibeSeconds  - elapsed);
      const oppSecs = Math.max(0, oppVibeSeconds - elapsed);

      fpMyTime.textContent  = myVibeSeconds  > 0 ? mySecs.toFixed(0)  + 's' : '—';
      fpOppTime.textContent = oppVibeSeconds > 0 ? oppSecs.toFixed(0) + 's' : '—';
      if (myVibeSeconds  > 0) fpMyBar.style.width  = `${(mySecs  / myVibeSeconds)  * 100}%`;
      if (oppVibeSeconds > 0) fpOppBar.style.width = `${(oppSecs / oppVibeSeconds) * 100}%`;

      fpWave.textContent = '≈ ' + haptics.getWaveState();

      // My vibe finished
      if (!myDone && mySecs <= 0) {
        myDone = true;
        fpContinue.disabled = false;
        if (iWonRound) {
          fpContinue.textContent = 'Grant Mercy →';
          fpContinue.style.cssText = `width:100%;padding:12px;border-radius:8px;font-family:monospace;font-size:0.9rem;background:#2a6a4a;border:1px solid #4a9a6a;color:#00ff88;cursor:pointer;`;
          fpHint.textContent = 'Clicking ends opponent\'s vibe and starts the next round';
          fpHint.style.color = '#555';
        } else {
          // Loser's own vibe ended naturally
          fpContinue.textContent = 'Continue →';
          fpContinue.style.cssText = `width:100%;padding:12px;border-radius:8px;font-family:monospace;font-size:0.9rem;background:#4aaeff;border:1px solid #4aaeff;color:#000;cursor:pointer;`;
        }
      }
    }, 200);

    // Winner clicking Continue = send Mercy + proceed
    // Loser clicking Continue = just proceed (their vibe ended naturally)
    fpContinue.addEventListener('click', () => {
      if (fpContinue.disabled || done) return;
      if (iWonRound && !mercyGranted) {
        socket.send({ type: MSG.SO_MERCY });
      }
      clearInterval(interval);
      finish();
    }, { once: true });

    // If winner already had 0 vibe, enable immediately
    if (myVibeSeconds <= 0) {
      fpContinue.disabled = false;
      if (iWonRound) {
        fpContinue.textContent = 'Grant Mercy →';
        fpContinue.style.cssText = `width:100%;padding:12px;border-radius:8px;font-family:monospace;font-size:0.9rem;background:#2a6a4a;border:1px solid #4a9a6a;color:#00ff88;cursor:pointer;`;
      } else {
        fpContinue.textContent = 'Continue →';
        fpContinue.style.cssText = `width:100%;padding:12px;border-radius:8px;font-family:monospace;font-size:0.9rem;background:#4aaeff;border:1px solid #4aaeff;color:#000;cursor:pointer;`;
      }
    }
  }

  // ── Chicken ──

  function showChicken() {
    phase = 'chicken';
    let intensity = 0.5;

    haptics.setWaveVibeMode(true);
    haptics.startForfeitVibe(9999);
    haptics.setForfeitIntensity(intensity);

    root.innerHTML = `
      <div style="min-height:100vh;width:100%;background:#08080f;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;font-family:monospace;">
        <div style="color:#f44;font-size:1.1rem;margin-bottom:4px;letter-spacing:2px;">ROUND TIED — STANDOFF</div>
        <div style="color:#888;font-size:0.75rem;margin-bottom:24px;">First to stop gives opponent +3 tokens next round</div>
        <div style="width:100%;max-width:340px;">
          <div style="display:flex;justify-content:space-between;color:#666;font-size:0.72rem;margin-bottom:6px;"><span>Intensity</span><span id="so-chicken-pct">${Math.round(intensity*100)}%</span></div>
          <input id="so-chicken-slider" type="range" min="0" max="100" value="${Math.round(intensity*100)}" style="width:100%;accent-color:#f44;height:8px;cursor:pointer;">
          <div style="display:flex;justify-content:space-between;color:#333;font-size:0.68rem;margin-top:4px;"><span>Low</span><span>Agony</span></div>
        </div>
        <div id="so-chicken-wave" style="margin-top:12px;color:#666;font-size:0.72rem;font-style:italic;">≈ steady</div>
        <div id="so-chicken-mover" style="margin-top:4px;color:#444;font-size:0.7rem;min-height:16px;"></div>
        <button id="so-chicken-stop" style="margin-top:32px;background:#1a0a0a;border:2px solid #f44;border-radius:8px;padding:16px 52px;color:#f44;font-family:monospace;font-size:1rem;cursor:pointer;letter-spacing:2px;">STOP</button>
        <div style="color:#444;font-size:0.7rem;margin-top:8px;">Stopping gives opponent +3 tokens</div>
      </div>`;
    mountVibeModeBar();

    const slider = root.querySelector('#so-chicken-slider');
    const pctEl = root.querySelector('#so-chicken-pct');
    const waveEl = root.querySelector('#so-chicken-wave');
    const moverEl = root.querySelector('#so-chicken-mover');
    const stopBtn = root.querySelector('#so-chicken-stop');

    const waveInterval = setInterval(() => {
      if (waveEl) waveEl.textContent = `≈ ${haptics.getWaveState()}`;
    }, 800);

    slider.addEventListener('input', () => {
      intensity = slider.value / 100;
      pctEl.textContent = Math.round(intensity * 100) + '%';
      moverEl.textContent = 'Last moved by: You';
      haptics.setForfeitIntensity(intensity);
      socket.send({ type: MSG.SO_CHICKEN_INTENSITY, intensity });
    });

    stopBtn.addEventListener('click', () => {
      clearInterval(waveInterval);
      haptics.stopAll();
      socket.send({ type: MSG.SO_CHICKEN_STOP });
      stopBtn.disabled = true; stopBtn.textContent = 'Stopping…';
    });

    socket.removeEventListener(MSG.SO_CHICKEN_INTENSITY, onChickenIntensity);
    onChickenIntensity = (ev) => {
      const { intensity: v, byRole } = ev.detail;
      if (byRole !== myRole) {
        intensity = v; slider.value = Math.round(v * 100);
        pctEl.textContent = Math.round(v * 100) + '%';
        moverEl.textContent = 'Last moved by: Opponent';
        haptics.setForfeitIntensity(v);
      }
    };
    socket.addEventListener(MSG.SO_CHICKEN_INTENSITY, onChickenIntensity);

    socket.removeEventListener(MSG.SO_CHICKEN_RESULT, onChickenResult);
    onChickenResult = (ev) => {
      clearInterval(waveInterval); haptics.stopAll();
      const { outcome, stoppedBy } = ev.detail;
      if (outcome !== 'simultaneous' && stoppedBy !== myRole) chickenTokenBonus = 3;
      roundIndex++;
      fields = fieldSchedule[roundIndex];
      setTimeout(showAllocation, 1200);
    };
    socket.addEventListener(MSG.SO_CHICKEN_RESULT, onChickenResult);
  }

  // ── Match End ──

  function showMatchEnd(matchWinner) {
    phase = 'end';
    const iWon = (matchWinner === 'host') === (myRole === 'host');
    const { winnerSeconds, loserSeconds } = matchEndVibeSeconds(roundResults, matchWinner === 'host' ? 'A' : 'B');
    const myVibeSeconds = iWon ? winnerSeconds : loserSeconds;

    root.innerHTML = `
      <div style="min-height:100vh;width:100%;background:#08080f;display:flex;flex-direction:column;align-items:center;padding:24px;box-sizing:border-box;font-family:monospace;">
        <div style="color:${iWon ? '#00ff88' : '#f44'};font-size:1.4rem;margin-bottom:4px;letter-spacing:2px;margin-top:24px;">${iWon ? 'VICTORY' : 'DEFEAT'}</div>
        <div style="color:#666;font-size:0.8rem;margin-bottom:16px;">${myRoundWins} — ${oppRoundWins}</div>
        <div style="width:100%;max-width:420px;margin-bottom:20px;">
          <div style="color:#555;font-size:0.72rem;letter-spacing:1px;margin-bottom:8px;">MATCH SUMMARY</div>
          ${roundResults.map((r) => `
            <div style="background:#12121e;border:1px solid #2a2a4a;border-radius:6px;padding:10px;margin-bottom:6px;">
              <div style="color:#555;font-size:0.68rem;margin-bottom:6px;">Round ${r._roundIndex + 1} ${r.roundWinner === myKey ? '✓ Your round' : (r.roundWinner === oppKey ? '✗ Their round' : '— Draw')}</div>
              ${fieldSchedule[r._roundIndex].map(f => {
                const myT  = myKey  === 'A' ? r.alloc?.A?.[f.id] ?? 0 : r.alloc?.B?.[f.id] ?? 0;
                const oppT = myKey  === 'A' ? r.alloc?.B?.[f.id] ?? 0 : r.alloc?.A?.[f.id] ?? 0;
                const fr = r.fieldResults?.[f.id];
                const won = fr?.winner === myKey, tied = fr?.winner === 'tie' || !fr?.winner;
                return `<div style="display:flex;justify-content:space-between;font-size:0.7rem;margin-bottom:2px;"><span style="color:#555;flex:1;">${f.name}</span><span style="color:#4aaeff;min-width:20px;text-align:right;">${myT}</span><span style="color:#333;padding:0 6px;">vs</span><span style="color:#f44;min-width:20px;">${oppT}</span><span style="color:${tied ? '#555' : (won ? '#00ff88' : '#f44')};min-width:20px;text-align:right;">${tied ? '—' : (won ? '✓' : '✗')}</span></div>`;
              }).join('')}
            </div>
          `).join('')}
        </div>
        <div id="so-end-vibe-area" style="width:100%;max-width:420px;margin-bottom:16px;"></div>
        <button id="so-back" style="margin-top:8px;background:#1a1a2a;border:1px solid #2a2a4a;border-radius:8px;padding:12px 24px;color:#888;font-family:monospace;cursor:pointer;">Back to lobby</button>
      </div>`;
    mountVibeModeBar();

    const endVibeArea = root.querySelector('#so-end-vibe-area');

    if (iWon) {
      // Winner fires own light vibe immediately
      if (myVibeSeconds > 0) {
        haptics.setWaveVibeMode(true);
        haptics.addForfeitSeconds(myVibeSeconds);
      }

      // Pattern picker for loser
      const patternDiv = document.createElement('div');
      patternDiv.innerHTML = `
        <div style="color:#ddd;font-size:0.85rem;margin-bottom:10px;">Choose opponent's forfeit pattern:</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
          <button class="so-pattern-btn" data-pattern="slow_burn" style="background:#12121e;border:1px solid #2a2a4a;border-radius:6px;padding:12px 14px;color:#888;font-family:monospace;font-size:0.75rem;cursor:pointer;text-align:center;">🕯 Slow Burn<br><span style="font-size:0.65rem;color:#555;">240s steady low</span></button>
          <button class="so-pattern-btn" data-pattern="rapid_pulse" style="background:#12121e;border:1px solid #2a2a4a;border-radius:6px;padding:12px 14px;color:#888;font-family:monospace;font-size:0.75rem;cursor:pointer;text-align:center;">⚡ Rapid Pulse<br><span style="font-size:0.65rem;color:#555;">180s intense</span></button>
          <button class="so-pattern-btn" data-pattern="escalating_waves" style="background:#12121e;border:1px solid #2a2a4a;border-radius:6px;padding:12px 14px;color:#888;font-family:monospace;font-size:0.75rem;cursor:pointer;text-align:center;">🌊 Escalating<br><span style="font-size:0.65rem;color:#555;">300s building</span></button>
        </div>
        <div id="so-pattern-status" style="color:#555;font-size:0.72rem;margin-top:8px;text-align:center;"></div>
      `;
      endVibeArea.appendChild(patternDiv);

      let patternSent = false;
      const patternTimer = setTimeout(() => {
        if (!patternSent) { patternSent = true; socket.send({ type: MSG.SO_VIBE_PATTERN, pattern: 'slow_burn' }); patternDiv.querySelector('#so-pattern-status').textContent = 'Auto-selected: Slow Burn'; }
      }, 15000);
      patternDiv.querySelectorAll('.so-pattern-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (patternSent) return;
          patternSent = true; clearTimeout(patternTimer);
          socket.send({ type: MSG.SO_VIBE_PATTERN, pattern: btn.dataset.pattern });
          patternDiv.querySelectorAll('.so-pattern-btn').forEach(b => { b.style.borderColor = '#2a2a4a'; b.style.color = '#555'; });
          btn.style.borderColor = '#4aaeff'; btn.style.color = '#4aaeff';
          patternDiv.querySelector('#so-pattern-status').textContent = 'Pattern sent.';
        });
      });
    } else {
      endVibeArea.innerHTML = `<div style="color:#888;font-size:0.82rem;text-align:center;padding:12px;">Waiting for opponent to choose your forfeit pattern…</div>`;
    }

    socket.removeEventListener(MSG.SO_VIBE_PATTERN, onVibePattern);
    onVibePattern = (ev) => {
      const { pattern } = ev.detail;
      endVibeArea.innerHTML = '';
      fireVibePattern(pattern, myVibeSeconds);
      // Show single-timer forfeit panel for loser at match end (no mercy mechanic)
      const loserPanel = document.createElement('div');
      loserPanel.style.cssText = 'background:#0e0e1e;border:1px solid #2a2a3a;border-radius:8px;padding:14px;margin-top:4px;';
      loserPanel.innerHTML = `
        <div style="color:#f44;font-size:0.68rem;letter-spacing:1px;margin-bottom:8px;">FORFEIT</div>
        <div style="background:#1a1a2a;border-radius:3px;height:5px;overflow:hidden;margin-bottom:5px;"><div id="so-end-bar" style="background:#f44;height:5px;width:100%;transition:width 0.2s;border-radius:3px;"></div></div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;">
          <span id="so-end-time" style="color:#f44;font-size:1rem;font-weight:bold;">${Math.round(myVibeSeconds)}s</span>
          <span id="so-end-wave" style="color:#555;font-size:0.68rem;font-style:italic;">≈ steady</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="color:#555;font-size:0.68rem;flex-shrink:0;">Their intensity</span>
          <input id="so-end-slider" type="range" min="0" max="100" value="100" style="flex:1;accent-color:#f44;height:5px;">
          <span id="so-end-pct" style="color:#888;font-size:0.72rem;min-width:30px;text-align:right;">100%</span>
        </div>
      `;
      endVibeArea.appendChild(loserPanel);

      const endBar  = loserPanel.querySelector('#so-end-bar');
      const endTime = loserPanel.querySelector('#so-end-time');
      const endWave = loserPanel.querySelector('#so-end-wave');
      const endSlider = loserPanel.querySelector('#so-end-slider');
      const endPct  = loserPanel.querySelector('#so-end-pct');
      const panelStart = Date.now();

      endSlider.addEventListener('input', () => {
        const v = endSlider.value / 100;
        endPct.textContent = Math.round(v * 100) + '%';
        socket.send({ type: MSG.SO_FORFEIT_INTENSITY, intensity: v });
      });

      const onFI = (ev) => { haptics.setForfeitIntensity(ev.detail.intensity); };
      socket.addEventListener(MSG.SO_FORFEIT_INTENSITY, onFI);

      const endInterval = setInterval(() => {
        if (!endTime.isConnected) { clearInterval(endInterval); socket.removeEventListener(MSG.SO_FORFEIT_INTENSITY, onFI); return; }
        const secs = Math.max(0, myVibeSeconds - (Date.now() - panelStart) / 1000);
        endTime.textContent = secs.toFixed(0) + 's';
        endBar.style.width = `${(secs / myVibeSeconds) * 100}%`;
        endWave.textContent = '≈ ' + haptics.getWaveState();
        if (secs <= 0) { clearInterval(endInterval); socket.removeEventListener(MSG.SO_FORFEIT_INTENSITY, onFI); endTime.textContent = 'Done'; }
      }, 200);
    };
    socket.addEventListener(MSG.SO_VIBE_PATTERN, onVibePattern);

    root.querySelector('#so-back').addEventListener('click', () => navigate(`#/session/${state.sessionId}`));
  }

  function fireVibePattern(pattern, durationOverride) {
    haptics.stopAll();
    if (pattern === 'slow_burn') {
      haptics.setWaveVibeMode(false);
      haptics.startForfeitVibe(durationOverride ?? 240);
      haptics.setForfeitIntensity(0.4);
    } else if (pattern === 'rapid_pulse') {
      haptics.setWaveVibeMode(true);
      haptics.startForfeitVibe(durationOverride ?? 180);
      haptics.setForfeitIntensity(0.9);
    } else if (pattern === 'escalating_waves') {
      haptics.setWaveVibeMode(true);
      haptics.startForfeitVibe(durationOverride ?? 300);
      haptics.setForfeitIntensity(0.3);
      let lvl = 0.3;
      const escalate = setInterval(() => {
        lvl = Math.min(1, lvl + 0.05);
        haptics.setForfeitIntensity(lvl);
        if (lvl >= 1) clearInterval(escalate);
      }, 10000);
    }
  }
}

// ── Helpers ──

function fieldDesc(f) {
  const descs = {
    vault: '3pts · Higher tokens wins · 8s/token penalty', armory: '2pts · Higher tokens wins · 6s/token penalty',
    gate: '2pts · Higher tokens wins · 6s/token penalty', keep: '1pt · Higher tokens wins · 4s/token penalty',
    gambit: 'Win with 1 token → 4pts jackpot · Win with 2+ → 1pt · 12s/token',
    curse: '1pt · Loser gets +30s flat on top of token penalty · 10s/token',
    bounty: '2pts · Tie: pot carries doubled to next round · 7s/token',
    mirror: '2pts · Both see each other\'s live count here · Locks 5s before timer · 8s/token',
    shadow: '2pts · Neither sees the other\'s count until reveal · 9s/token',
    spy: '0pts · Win it: peek at one opponent field before next round\'s allocation',
  };
  return descs[f.id] || '';
}

function fieldWinLose(f) {
  const wl = {
    vault:  { win: `+${f.pts}pt`, lose: `you feel ${f.rate}s per token placed` },
    armory: { win: `+${f.pts}pt`, lose: `you feel ${f.rate}s per token placed` },
    gate:   { win: `+${f.pts}pt`, lose: `you feel ${f.rate}s per token placed` },
    keep:   { win: `+${f.pts}pt`, lose: `you feel ${f.rate}s per token placed` },
    gambit: { win: `1 token → +4pt jackpot! · 2+ tokens → +1pt`, lose: `you feel ${f.rate}s per token placed` },
    curse:  { win: `+${f.pts}pt`, lose: `you feel ${f.rate}s per token, plus +30s flat` },
    bounty: { win: `+${f.pts}pt`, lose: `you feel ${f.rate}s per token · a tie carries the pot, doubled, to next round` },
    mirror: { win: `+${f.pts}pt · both sides see live counts here`, lose: `you feel ${f.rate}s per token placed` },
    shadow: { win: `+${f.pts}pt · counts stay hidden until reveal`, lose: `you feel ${f.rate}s per token placed` },
    spy:    { win: `no points, but you peek at one opponent field next round`, lose: `no penalty — 0pt field` },
  };
  return wl[f.id] || { win: '—', lose: '—' };
}

function powerIcon(id) {
  return { surge: '⚡', intel: '🔍', reinforce: '🛡', sabotage: '💣', forfeit: '🏳', ghost: '👻' }[id] || '?';
}

function drawFieldIcon(canvas, fieldId) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#4aaeff'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.fillStyle = '#4aaeff';
  ({
    vault: () => { ctx.strokeRect(6,8,w-12,h-14); ctx.beginPath(); ctx.arc(w/2,h/2,6,0,Math.PI*2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(w/2,h/2-6); ctx.lineTo(w/2,4); ctx.stroke(); },
    armory: () => { ctx.beginPath(); ctx.moveTo(w/2-10,h-6); ctx.lineTo(w/2+10,6); ctx.moveTo(w/2+10,h-6); ctx.lineTo(w/2-10,6); ctx.stroke(); },
    gate: () => { ctx.beginPath(); ctx.moveTo(6,h-6); ctx.lineTo(6,h/2); ctx.arc(w/2,h/2,w/2-6,Math.PI,0); ctx.lineTo(w-6,h-6); ctx.stroke(); },
    keep: () => { ctx.strokeRect(8,10,w-16,h-14); ctx.beginPath(); [8,16,w-16,w-8].forEach(x=>{ctx.moveTo(x,10);ctx.lineTo(x,4);}); ctx.stroke(); },
    gambit: () => { ctx.strokeRect(6,6,w-12,h-12); [[0.3,0.3],[0.7,0.3],[0.5,0.5],[0.3,0.7],[0.7,0.7]].forEach(([x,y])=>{ctx.beginPath();ctx.arc(x*w,y*h,2,0,Math.PI*2);ctx.fill();}); },
    curse: () => { ctx.beginPath(); ctx.arc(w/2,h/2-2,10,Math.PI,0); ctx.lineTo(w/2+10,h-6); ctx.lineTo(w/2-10,h-6); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.arc(w/2-4,h/2-4,2,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(w/2+4,h/2-4,2,0,Math.PI*2); ctx.fill(); },
    bounty: () => { ctx.beginPath(); ctx.arc(w/2,h/2,10,0,Math.PI*2); ctx.stroke(); const p=5,r1=7,r2=4; ctx.beginPath(); for(let i=0;i<p*2;i++){const r=i%2===0?r1:r2,a=(i*Math.PI)/p-Math.PI/2; i===0?ctx.moveTo(w/2+r*Math.cos(a),h/2+r*Math.sin(a)):ctx.lineTo(w/2+r*Math.cos(a),h/2+r*Math.sin(a));} ctx.closePath(); ctx.fill(); },
    mirror: () => { ctx.beginPath(); ctx.moveTo(8,8); ctx.lineTo(w-8,8); ctx.moveTo(w/2,8); ctx.lineTo(w/2,h-8); ctx.moveTo(8,h-8); ctx.lineTo(w-8,h-8); ctx.stroke(); },
    shadow: () => { ctx.beginPath(); ctx.arc(w/2,h/2,10,0,Math.PI*2); ctx.stroke(); ctx.beginPath(); ctx.arc(w/2,h/2,4,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.moveTo(6,6); ctx.lineTo(w-6,h-6); ctx.stroke(); },
    spy: () => { ctx.beginPath(); ctx.arc(w/2-4,h/2-4,8,0,Math.PI*2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(w/2+2,h/2+2); ctx.lineTo(w-6,h-6); ctx.stroke(); },
  }[fieldId] || (() => { ctx.strokeRect(8,8,w-16,h-16); }))();
}
