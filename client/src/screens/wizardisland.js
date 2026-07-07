import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';
import { makeRng, rngInt } from '../game/seededRng.js';
import {
  ISLANDS, WIZARD_POS, SPELL_CARDS,
  createGameState, resolveDestinations, moveWizardAfterTurn,
  collectIslandCard, addCardToPlayer, discardFromInventory,
  startBattle, doBattleRound, reduceWizardStat, retreatFromBattle,
  drawWizardSpell, checkWinCondition, redealIslands,
  getAttack, getDefence, getMaxStamina, getArmourCount,
} from '../game/wizardIslandGame.js';

export function renderWizardIsland(root) {
  const myKey = state.role === 'host' ? 'A' : 'B';
  const oppKey = myKey === 'A' ? 'B' : 'A';

  const rng = makeRng(state.seed);
  const gs = createGameState(state.seed, rng, state.hostName, state.guestName);

  // ── Layout ───────────────────────────────────────────────────────────────
  root.innerHTML = `
    <div id="wi-root" style="position:fixed;inset:0;display:flex;flex-direction:column;background:#0a0a14;color:#e8dfc8;font-family:inherit;overflow:hidden;z-index:50;">
      <div id="wi-hud" style="display:flex;gap:6px;padding:6px 10px;background:#111;border-bottom:1px solid #2a2a3a;flex-shrink:0;align-items:stretch;flex-wrap:wrap;min-height:56px;"></div>
      <div id="wi-board-wrap" style="position:relative;flex:1;min-height:0;overflow:hidden;">
        <canvas id="wi-canvas" style="position:absolute;inset:0;display:block;"></canvas>
        <div id="wi-rules" style="position:absolute;left:6px;top:6px;width:128px;max-height:calc(100% - 12px);overflow:hidden;display:flex;flex-direction:column;gap:4px;pointer-events:none;z-index:6;"></div>
        <div id="wi-status" style="position:absolute;top:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);padding:5px 14px;border-radius:20px;font-size:13px;pointer-events:none;white-space:nowrap;max-width:90%;text-align:center;"></div>
      </div>
      <div id="wi-hand" style="flex-shrink:0;background:#0d0d18;border-top:1px solid #2a2a3a;padding:6px 8px;display:flex;gap:6px;align-items:center;overflow-x:auto;min-height:74px;"></div>
      <div id="wi-actions" style="padding:8px;display:flex;gap:6px;justify-content:center;background:#111;border-top:1px solid #2a2a3a;flex-shrink:0;flex-wrap:wrap;min-height:52px;align-items:center;"></div>
      <div id="wi-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:100;align-items:center;justify-content:center;"></div>
    </div>`;

  const canvas = root.querySelector('#wi-canvas');
  const ctx = canvas.getContext('2d');
  const overlay = root.querySelector('#wi-overlay');

  // ── Canvas / board drawing ────────────────────────────────────────────────
  const BOARD_ISLAND_POS = [
    [0.50, 0.11],  // 0 Sandy Beach   — top
    [0.78, 0.21],  // 1 Volcano Peak  — upper-right
    [0.85, 0.50],  // 2 Rocky Desert  — right
    [0.76, 0.79],  // 3 Dark Earth    — lower-right
    [0.50, 0.88],  // 4 Green Forest  — bottom
    [0.22, 0.79],  // 5 Dark Swamp    — lower-left
    [0.14, 0.50],  // 6 Flower Forest — left
    [0.22, 0.21],  // 7 Gray Peaks    — upper-left
  ];

  const ISLAND_ICONS = ['🏖', '🌋', '🏜', '🌑', '🌲', '🌿', '🌸', '⛰'];

  const CARD_TYPE_ICON  = { attack: '⚔', defence: '🛡', stamina: '❤', armour: '🧥', spell: '🔮' };
  const CARD_TYPE_COLOR = { attack: '#ff6060', defence: '#60aaff', stamina: '#ff9060', armour: '#cfcfcf', spell: '#d080ff' };
  const CARD_TYPE_BG    = { attack: '#2a0808', defence: '#081428', stamina: '#2a1408', armour: '#191919', spell: '#18082a' };
  const CARD_TYPE_BG2   = { attack: '#5e1616', defence: '#103a6e', stamina: '#5e2c16', armour: '#3c3c3c', spell: '#3a1466' };
  const CARD_TYPE_NAME  = { attack: 'ATK', defence: 'DEF', stamina: 'STA', armour: 'ARM', spell: 'SPELL' };

  function cardValueLabel(card) {
    if (card.type === 'attack' || card.type === 'defence' || card.type === 'stamina') return '+' + card.value;
    return '';
  }
  function lighten(hex, amt = 0.4) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.round(r + (255 - r) * amt);
    g = Math.round(g + (255 - g) * amt);
    b = Math.round(b + (255 - b) * amt);
    return `rgb(${r},${g},${b})`;
  }

  const boardImg = new Image();
  boardImg.src = '/wizard-island-board.jpg';
  boardImg.onload = () => drawBoard();

  // ── Token animation ──────────────────────────────────────────────────────
  // Fractional board positions for each player token (animated)
  const tok = {
    A: { fx: 0.44, fy: 0.56 },
    B: { fx: 0.56, fy: 0.56 },
  };
  let pendingDest = null;   // island/wizard I've picked but opp hasn't yet
  let animRafId = null;

  function destFrac(key, dest) {
    // Returns [fx, fy] for a player token at a given destination
    const offset = key === 'A' ? -0.035 : 0.035;
    if (dest === 'wizard' || dest === null) return [0.50 + offset, 0.565];
    const [fx, fy] = BOARD_ISLAND_POS[dest];
    return [fx + offset, fy + (key === 'A' ? -0.028 : 0.028)];
  }

  function snapTokens() {
    ['A', 'B'].forEach(k => {
      const [fx, fy] = destFrac(k, gs.players[k].island);
      tok[k].fx = fx; tok[k].fy = fy;
    });
  }

  function animateTokens(destA, destB, onDone) {
    if (animRafId) { cancelAnimationFrame(animRafId); animRafId = null; }
    const targets = { A: destFrac('A', destA), B: destFrac('B', destB) };
    const starts  = { A: [tok.A.fx, tok.A.fy], B: [tok.B.fx, tok.B.fy] };
    const t0 = performance.now();
    const dur = 650;
    function step(now) {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);  // cubic ease-out
      ['A','B'].forEach(k => {
        tok[k].fx = starts[k][0] + (targets[k][0] - starts[k][0]) * e;
        tok[k].fy = starts[k][1] + (targets[k][1] - starts[k][1]) * e;
      });
      drawBoard();
      if (p < 1) { animRafId = requestAnimationFrame(step); }
      else { animRafId = null; snapTokens(); if (onDone) onDone(); }
    }
    animRafId = requestAnimationFrame(step);
  }

  // ── roundRect helper (Safari 15 compat) ──────────────────────────────────
  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); }
    else {
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }
  }

  function drawIslandCard(cx, cy, card, islNum, locked, sz) {
    const cw = sz * 0.108, ch = sz * 0.150, cr = sz * 0.013;
    const x = cx - cw / 2, y = cy - ch / 2;

    ctx.save();
    if (locked) ctx.globalAlpha = 0.32;

    if (card) {
      const c1   = CARD_TYPE_BG[card.type]   ?? '#12121e';
      const c2   = CARD_TYPE_BG2[card.type]  ?? '#24243a';
      const bord = CARD_TYPE_COLOR[card.type] ?? '#f0c040';
      const icon = CARD_TYPE_ICON[card.type]  ?? '📦';

      // Drop shadow (grounding the card against the map)
      ctx.shadowColor = 'rgba(0,0,0,0.75)';
      ctx.shadowBlur = sz * 0.018;
      ctx.shadowOffsetY = sz * 0.005;
      rrect(x, y, cw, ch, cr);
      const grad = ctx.createLinearGradient(x, y, x, y + ch);
      grad.addColorStop(0, c2);
      grad.addColorStop(1, c1);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

      // Subtle colored accent strip across the top (card cue, no text → no overlap)
      const hh = ch * 0.10;
      ctx.save();
      rrect(x, y, cw, ch, cr);
      ctx.clip();
      ctx.fillStyle = bord;
      ctx.globalAlpha = (locked ? 0.32 : 1) * 0.22;
      ctx.fillRect(x, y, cw, hh);
      ctx.restore();

      // Central icon — large; only the card TYPE is revealed, not its detail
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `${ch * 0.42}px sans-serif`;
      ctx.fillText(icon, cx, y + ch * 0.50);

      // Type name (bottom)
      ctx.fillStyle = bord;
      ctx.font = `bold ${ch * 0.15}px sans-serif`;
      ctx.fillText(CARD_TYPE_NAME[card.type] ?? '?', cx, y + ch * 0.84);

      // Outer border (drawn last, crisp on top)
      rrect(x, y, cw, ch, cr);
      ctx.strokeStyle = bord;
      ctx.lineWidth = Math.max(1.5, sz * 0.004);
      ctx.stroke();

      // Island-number badge (top-left corner)
      const br = ch * 0.13;
      ctx.beginPath();
      ctx.arc(x + br + sz * 0.004, y + br + sz * 0.004, br, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.78)';
      ctx.fill();
      ctx.strokeStyle = bord; ctx.lineWidth = Math.max(1, sz * 0.0018); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${br * 1.15}px sans-serif`;
      ctx.fillText(islNum, x + br + sz * 0.004, y + br + sz * 0.005);
    } else {
      // Empty slot — faint card outline with number
      rrect(x, y, cw, ch, cr);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fill();
      rrect(x, y, cw, ch, cr);
      ctx.setLineDash([sz * 0.01, sz * 0.008]);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = Math.max(1, sz * 0.0022);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = `bold ${ch * 0.26}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(islNum, cx, cy);
    }
    ctx.restore();
  }

  let LW = 0, LH = 0;   // logical (CSS pixel) dimensions; canvas backing store is DPR-scaled
  function resizeCanvas() {
    const c = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    LW = w; LH = h;
    canvas.width = Math.round(LW * dpr);
    canvas.height = Math.round(LH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // draw in CSS pixels, render at device resolution
    snapTokens();
    drawBoard();
    positionRulesPanel();
  }
  // Keep the backing store matched to the real rendered box at all times
  // (prevents the square board being stretched/squished by late layout changes).
  const boardWrap = root.querySelector('#wi-board-wrap');
  const resizeObs = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(() => resizeCanvas()) : null;
  if (resizeObs) resizeObs.observe(boardWrap);

  // ── Click-to-move directly on the board ────────────────────────────────────
  function boardHitTest(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    const sz = Math.min(LW, LH);
    const [wx, wy] = boardPx(0.50, 0.50);
    if (Math.hypot(x - wx, y - wy) <= sz * 0.11) return 'wizard';   // central tower
    const cw = sz * 0.108, ch = sz * 0.150;
    for (let i = 0; i < BOARD_ISLAND_POS.length; i++) {
      const [px, py] = boardPx(BOARD_ISLAND_POS[i][0], BOARD_ISLAND_POS[i][1]);
      if (x >= px - cw / 2 && x <= px + cw / 2 && y >= py - ch / 2 && y <= py + ch / 2) return i;
    }
    return null;
  }
  function canChoose() { return gs.phase === 'choosing' && !gs.players[myKey].choiceSubmitted; }
  function onBoardClick(e) {
    if (!canChoose()) return;
    const hit = boardHitTest(e.clientX, e.clientY);
    if (hit === null) return;
    if (hit !== 'wizard' && gs.islands[hit].locked) return;
    submitChoice(hit);
  }
  function onBoardHover(e) {
    if (!canChoose()) { canvas.style.cursor = 'default'; return; }
    const hit = boardHitTest(e.clientX, e.clientY);
    const choosable = hit === 'wizard' || (hit !== null && !gs.islands[hit].locked);
    canvas.style.cursor = choosable ? 'pointer' : 'default';
  }
  canvas.addEventListener('click', onBoardClick);
  canvas.addEventListener('mousemove', onBoardHover);

  function boardPx(fx, fy) {
    const sz = Math.min(LW, LH);
    const ox = (LW - sz) / 2;
    const oy = (LH - sz) / 2;
    return [ox + fx * sz, oy + fy * sz];
  }

  function drawBoard() {
    if (!LW || !LH) return;
    const width = LW, height = LH;
    const sz = Math.min(width, height);
    const ox = (width - sz) / 2, oy = (height - sz) / 2;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#060c14';
    ctx.fillRect(0, 0, width, height);

    // Board image
    if (boardImg.complete && boardImg.naturalWidth) {
      ctx.drawImage(boardImg, ox, oy, sz, sz);
    } else {
      const bg = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, sz/2);
      bg.addColorStop(0, '#0e1a2e'); bg.addColorStop(1, '#060c14');
      ctx.fillStyle = bg; ctx.fillRect(ox, oy, sz, sz);
    }

    // Island cards
    BOARD_ISLAND_POS.forEach(([fx, fy], i) => {
      const [px, py] = boardPx(fx, fy);
      drawIslandCard(px, py, gs.islands[i].card, i + 1, gs.islands[i].locked, sz);
    });

    // Wizard tower label
    {
      const [wx, wy] = boardPx(0.50, 0.50);
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      const lw = sz * 0.09, lh = sz * 0.022;
      ctx.fillRect(wx - lw/2, wy + sz*0.05, lw, lh);
      ctx.fillStyle = '#c4a0e0';
      ctx.font = `bold ${sz * 0.016}px sans-serif`;
      ctx.fillText('💀 Wizard', wx, wy + sz * 0.061);
      ctx.restore();
    }

    // Dark wizard token on current island
    if (!gs.wizard.defeated) {
      const wizIsl = gs.wizard.island;
      if (wizIsl !== null && wizIsl >= 0) {
        const [wx, wy] = boardPx(BOARD_ISLAND_POS[wizIsl][0], BOARD_ISLAND_POS[wizIsl][1]);
        const wyy = wy - sz * 0.105;   // float above the island card
        const wr = sz * 0.038;
        ctx.save();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        // Glowing dark orb behind the skull for contrast against any island
        ctx.shadowColor = '#d000ff'; ctx.shadowBlur = sz * 0.04;
        ctx.beginPath(); ctx.arc(wx, wyy, wr, 0, Math.PI * 2);
        ctx.fillStyle = '#1a0026'; ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = sz * 0.004; ctx.strokeStyle = '#c060ff'; ctx.stroke();
        ctx.font = `${wr * 1.25}px sans-serif`;
        ctx.fillText('💀', wx, wyy + wr * 0.06);
        ctx.restore();
      }
    }

    // My pending destination ghost (semi-transparent preview)
    if (pendingDest !== null) {
      const color = myKey === 'A' ? '#4a9eff' : '#ff6b4a';
      let pfx, pfy;
      if (pendingDest === 'wizard') { pfx = myKey === 'A' ? 0.405 : 0.595; pfy = 0.565; }
      else { [pfx, pfy] = BOARD_ISLAND_POS[pendingDest]; pfx += myKey === 'A' ? -0.035 : 0.035; pfy += myKey === 'A' ? -0.028 : 0.028; }
      const [gx, gy] = boardPx(pfx, pfy);
      const tr = sz * 0.028;
      ctx.save();
      ctx.globalAlpha = 0.38;
      ctx.beginPath(); ctx.arc(gx, gy, tr, 0, Math.PI*2);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = sz * 0.003; ctx.stroke();
      ctx.restore();
    }

    // Player tokens (animated positions)
    const TOKEN_CFG = [
      { key: 'A', color: '#4a9eff' },
      { key: 'B', color: '#ff6b4a' },
    ];
    TOKEN_CFG.forEach(({ key, color }) => {
      const [px, py] = boardPx(tok[key].fx, tok[key].fy);
      const isMe = key === myKey;
      const tr = sz * (isMe ? 0.042 : 0.037);
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

      // Ground shadow so the token reads as standing on the board
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(px, py + tr * 0.9, tr * 0.85, tr * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Highlight ring for my own token
      if (isMe) {
        ctx.shadowColor = color; ctx.shadowBlur = sz * 0.03;
        ctx.beginPath(); ctx.arc(px, py, tr + sz * 0.006, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = sz * 0.005; ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Disc with radial gradient for depth
      const g = ctx.createRadialGradient(px - tr * 0.3, py - tr * 0.35, tr * 0.1, px, py, tr);
      g.addColorStop(0, lighten(color, 0.45));
      g.addColorStop(1, color);
      ctx.beginPath(); ctx.arc(px, py, tr, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = sz * 0.005; ctx.strokeStyle = '#fff'; ctx.stroke();

      // Initial
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${tr * 1.05}px sans-serif`;
      ctx.fillText(gs.players[key].name.charAt(0).toUpperCase(), px, py + tr * 0.04);
      ctx.restore();
    });
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  renderRulesPanel();

  // ── HUD ───────────────────────────────────────────────────────────────────
  function updateHud() {
    const me = gs.players[myKey];
    const opp = gs.players[oppKey];
    const w = gs.wizard;
    const hud = root.querySelector('#wi-hud');
    hud.innerHTML = `
      <div style="flex:1;min-width:120px;font-size:11px;">
        <div style="font-weight:bold;color:#4a9eff;margin-bottom:2px;">${esc(me.name)} <span style="color:#888;font-size:10px;">(you)</span></div>
        <div>⚔${getAttack(me)} 🛡${getDefence(me)} ❤${getMaxStamina(me)} 🧥${getArmourCount(me)}</div>
        <div style="color:#888;font-size:10px;">${me.inventory.length}/${me.maxInventory} items · ${me.spells.length} spells</div>
      </div>
      <div style="text-align:center;min-width:90px;font-size:10px;color:#c4a0e0;border-left:1px solid #333;border-right:1px solid #333;padding:0 8px;">
        ${w.defeated ? '<div style="color:#888;">☠ Defeated</div>' : `
          <div style="font-weight:bold;color:#c4a0e0;">💀 Dark Wizard</div>
          <div>⚔${w.attack} 🛡${w.defence} 🧥${w.armour}</div>
          <div style="color:#888;">Turn ${gs.turn}${w.armourZero ? ' · <span style="color:#ff4040;">ARMOUR BROKEN</span>' : ''}</div>
        `}
      </div>
      <div style="flex:1;min-width:120px;font-size:11px;text-align:right;">
        <div style="font-weight:bold;color:#ff6b4a;margin-bottom:2px;">${esc(opp.name)}</div>
        <div>⚔${getAttack(opp)} 🛡${getDefence(opp)} ❤${getMaxStamina(opp)} 🧥${getArmourCount(opp)}</div>
        <div style="color:#888;font-size:10px;">${opp.inventory.length}/${opp.maxInventory} items · ${opp.spells.length} spells</div>
      </div>`;
    renderHand();
  }

  // ── Active rules panel (rule-changing cards everyone can see) ───────────────
  // A spell changes the rules of the game if it takes effect "for the rest of
  // the game" (e.g. No Surrender, Endless Battle, Armour Burns, Naked Hit Edge…).
  function isRuleSpell(card) {
    return !!card && card.type === 'spell' && /rest of the game/i.test(card.description || '');
  }
  function addActiveRule(name, description, by) {
    if (!gs.activeRules) gs.activeRules = [];
    if (gs.activeRules.some(r => r.name === name)) return;
    gs.activeRules.push({ name, description, by: by || null });
    renderRulesPanel();
  }
  function positionRulesPanel() {
    const el = root.querySelector('#wi-rules');
    if (!el || !LW || !LH) return;
    const sz = Math.min(LW, LH);
    const ox = (LW - sz) / 2;
    // Tuck the panel into the letterbox just left of the board when there's room,
    // otherwise pin it to the far-left edge (overlay, click-through).
    el.style.left = Math.max(6, ox - 134) + 'px';
  }
  function renderRulesPanel() {
    const el = root.querySelector('#wi-rules');
    if (!el) return;
    const items = [
      { name: gs.modifier.name, description: gs.modifier.description, base: true },
      ...(gs.activeRules || []),
    ];
    el.innerHTML = items.map(it => `
      <div style="background:rgba(18,10,32,0.85);border:1px solid ${it.base ? '#5c3d8c' : '#9a5cd8'};border-radius:6px;padding:4px 6px;box-shadow:0 2px 8px rgba(0,0,0,0.4);">
        <div style="font-size:9px;font-weight:bold;letter-spacing:0.5px;color:${it.base ? '#c4a0e0' : '#e0b0ff'};line-height:1.15;">${it.base ? '🎲' : '📜'} ${esc(it.name)}</div>
        <div style="font-size:8px;color:#99a;line-height:1.25;margin-top:2px;">${esc(it.description)}</div>
        ${it.by ? `<div style="font-size:7px;color:#778;margin-top:1px;">— ${esc(it.by)}</div>` : ''}
      </div>`).join('');
    positionRulesPanel();
  }

  // ── Player hand (your collected cards) ─────────────────────────────────────
  const HAND_ICON  = { attack: '⚔', defence: '🛡', stamina: '❤', armour: '🧥', spell: '🔮' };
  const HAND_COLOR = { attack: '#ff6060', defence: '#60aaff', stamina: '#ff9060', armour: '#cfcfcf', spell: '#d080ff' };
  const HAND_BG    = { attack: '#2a0808', defence: '#081428', stamina: '#2a1408', armour: '#191919', spell: '#18082a' };

  function makeHandCard(card, kind) {
    const col = HAND_COLOR[card.type] ?? '#f0c040';
    const el = document.createElement('button');
    el.style.cssText = `position:relative;flex:0 0 auto;width:58px;height:60px;border-radius:7px;border:1.5px solid ${col};background:linear-gradient(160deg,${HAND_BG[card.type]} 0%,#0c0c14 100%);color:${col};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;cursor:pointer;padding:2px;`;
    const detail = kind === 'spell'
      ? (card.timing === 'held' ? 'HOLD' : 'NOW')
      : (cardValueLabel(card) || (card.type === 'armour' ? '+1' : ''));
    el.innerHTML = `
      <div style="font-size:20px;line-height:1;">${HAND_ICON[card.type] ?? '📦'}</div>
      <div style="font-size:12px;font-weight:bold;color:#fff;line-height:1;">${esc(detail)}</div>
      <div style="font-size:8px;font-weight:bold;letter-spacing:0.5px;line-height:1;">${esc((CARD_TYPE_NAME[card.type] ?? '').toUpperCase())}</div>`;
    el.title = `${card.label || card.name}${card.description ? ' — ' + card.description : ''}`;
    return el;
  }

  function renderHand() {
    const hand = root.querySelector('#wi-hand');
    if (!hand) return;
    hand.innerHTML = '';
    const me = gs.players[myKey];

    const label = document.createElement('div');
    label.style.cssText = 'flex:0 0 auto;font-size:9px;color:#667;writing-mode:vertical-rl;text-orientation:mixed;transform:rotate(180deg);letter-spacing:1px;text-transform:uppercase;padding:0 2px;';
    label.textContent = 'Hand';
    hand.appendChild(label);

    if (me.inventory.length === 0 && me.spells.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:11px;color:#556;padding:0 8px;';
      empty.textContent = 'No cards yet — land on an island to collect one.';
      hand.appendChild(empty);
      return;
    }

    me.inventory.forEach((card, i) => {
      const el = makeHandCard(card, 'inventory');
      el.addEventListener('click', () => showHeldCardDetail(card, i));
      hand.appendChild(el);
    });
    me.spells.forEach((spell, i) => {
      const el = makeHandCard(spell, 'spell');
      el.addEventListener('click', () => showSpellDetail(spell, i));
      hand.appendChild(el);
    });
  }

  function showHeldCardDetail(card, idx) {
    const box = makeBox();
    box.innerHTML = `
      <div style="font-size:24px;text-align:center;margin-bottom:4px;">${cardEmoji(card)}</div>
      <div style="font-size:15px;font-weight:bold;color:${HAND_COLOR[card.type] ?? '#c4a0e0'};text-align:center;margin-bottom:6px;">${esc(card.label || card.name)}</div>
      ${card.description ? `<div style="font-size:12px;color:#aaa;text-align:center;margin-bottom:14px;line-height:1.5;">${esc(card.description)}</div>` : '<div style="margin-bottom:14px;"></div>'}
      <div style="display:flex;gap:8px;justify-content:center;">
        <button class="ghost" id="hc-discard" style="color:#ff6b4a;border-color:#ff6b4a;">Discard</button>
        <button id="hc-close">Keep</button>
      </div>`;
    showOverlay(box);
    box.querySelector('#hc-close').addEventListener('click', closeOverlay);
    box.querySelector('#hc-discard').addEventListener('click', () => {
      const removed = discardFromInventory(gs, myKey, idx);
      closeOverlay();
      updateHud(); drawBoard();
      if (removed) setStatus(`Discarded: ${removed.label || removed.name}`);
    });
  }

  function showSpellDetail(spell, idx) {
    const box = makeBox();
    box.innerHTML = `
      <div style="font-size:14px;font-weight:bold;color:#c4a0e0;margin-bottom:6px;">🔮 ${esc(spell.name)}</div>
      <div style="font-size:12px;color:#aaa;margin-bottom:14px;line-height:1.5;">${esc(spell.description)}</div>
      <div style="display:flex;gap:8px;justify-content:center;">
        <button id="spell-play">Play now</button>
        <button class="ghost" id="spell-cancel">Keep</button>
      </div>`;
    showOverlay(box);
    box.querySelector('#spell-play').addEventListener('click', () => {
      gs.players[myKey].spells.splice(idx, 1);
      closeOverlay();
      renderHand();
      if (isRuleSpell(spell)) addActiveRule(spell.name, spell.description, gs.players[myKey].name);
      socket.send({ type: MSG.WI_SPELL_PLAY, spellName: spell.name });
      setStatus(`Played: ${spell.name} — ${spell.description}`);
    });
    box.querySelector('#spell-cancel').addEventListener('click', closeOverlay);
  }

  // ── Status / actions ──────────────────────────────────────────────────────
  function setStatus(msg) { const el = root.querySelector('#wi-status'); if (el) el.textContent = msg; }
  function setActions(html) { root.querySelector('#wi-actions').innerHTML = html; }

  // ── Overlay helpers ───────────────────────────────────────────────────────
  function makeBox(extraStyle = '') {
    const box = document.createElement('div');
    box.style.cssText = `background:#12121e;border:1px solid #3a2a5a;border-radius:14px;padding:20px;max-width:360px;width:90%;max-height:80vh;overflow-y:auto;${extraStyle}`;
    return box;
  }
  function showOverlay(el) {
    overlay.style.display = 'flex';
    overlay.innerHTML = '';
    overlay.appendChild(el);
  }
  function closeOverlay() {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
  }

  // ── Island choice UI ──────────────────────────────────────────────────────
  function proceedToChoosing() {
    gs.phase = 'choosing';
    gs.players[myKey].choiceSubmitted = false;
    updateHud();
    renderHand();
    renderRulesPanel();
    drawBoard();
    setStatus('Tap an island to move there — or the tower to attack the Wizard.');
    showChoiceUI();
  }

  function showChoiceUI() {
    setActions('');
    const me = gs.players[myKey];
    const actions = root.querySelector('#wi-actions');
    actions.style.flexWrap = 'wrap';

    const fragment = document.createDocumentFragment();

    ISLANDS.forEach((isl, i) => {
      const locked = gs.islands[i].locked;
      const hasCard = !!gs.islands[i].card;
      const btn = document.createElement('button');
      btn.style.cssText = `font-size:11px;padding:5px 8px;min-width:70px;${locked ? 'opacity:0.35;cursor:not-allowed;' : ''}${hasCard ? 'border-color:#f0c040;' : ''}`;
      btn.disabled = locked;
      btn.textContent = `${ISLAND_ICONS[i]} ${i+1}`;
      btn.title = isl.name + (hasCard ? ' (card available)' : '') + (locked ? ' (locked)' : '');
      if (!locked) btn.addEventListener('click', () => submitChoice(i));
      fragment.appendChild(btn);
    });

    const wizBtn = document.createElement('button');
    wizBtn.style.cssText = 'font-size:11px;padding:5px 10px;border-color:#8000ff;color:#c4a0e0;background:#1a0a2e;';
    wizBtn.textContent = '💀 Attack Wizard';
    wizBtn.addEventListener('click', () => submitChoice('wizard'));
    fragment.appendChild(wizBtn);

    actions.appendChild(fragment);
  }

  function submitChoice(dest) {
    gs.players[myKey].choiceSubmitted = true;
    pendingDest = dest;
    drawBoard();
    setActions(`<div style="color:#888;font-size:13px;">Waiting for ${esc(gs.players[oppKey].name)}…</div>`);
    setStatus(dest === 'wizard' ? 'You chose to attack the Dark Wizard.' : `You chose Island ${dest+1} — ${ISLANDS[dest].name}.`);
    socket.send({ type: MSG.WI_DEST_READY, dest: dest === 'wizard' ? 'wizard' : dest });
  }

  // ── Destination reveal & event processing ─────────────────────────────────
  function processEvents(events, idx, onDone) {
    if (idx >= events.length) { onDone(); return; }
    const ev = events[idx];
    const next = () => processEvents(events, idx + 1, onDone);

    if (ev.type === 'island_card') {
      const card = collectIslandCard(gs, ev.island);
      if (!card) { next(); return; }
      // Immediate rule-changing spell takes effect now — record it for both players.
      if (card.type === 'spell' && card.timing === 'immediate' && isRuleSpell(card)) {
        addActiveRule(card.name, card.description, gs.players[ev.player].name);
      }
      const result = addCardToPlayer(gs.players[ev.player], card);
      if (ev.player === myKey) {
        handleCardResult(card, result, next);
      } else {
        // Opponent picks up card — show brief notification
        setStatus(`${gs.players[oppKey].name} collects a card from Island ${ev.island+1}.`);
        updateHud();
        drawBoard();
        // For full cards: opponent also resolves on their side; we just wait for them to ack
        // For our purposes, apply the result locally then continue after short delay
        if (result.action === 'upgraded' || result.action === 'added') {
          setTimeout(next, 600);
        } else if (result.action === 'no_upgrade') {
          // Card goes to discard
          gs.discard.push(card);
          setTimeout(next, 600);
        } else if (result.action === 'full') {
          // Opponent decides: we assume they discard the new card (worst case)
          gs.discard.push(card);
          setTimeout(next, 600);
        } else {
          setTimeout(next, 400);
        }
      }
      return;
    }

    if (ev.type === 'pvp_battle') {
      setStatus('⚔ You both chose the same island — battle!');
      startBattle(gs, 'pvp', myKey, ev.island);
      updateHud(); drawBoard();
      setTimeout(() => showBattleOverlay(next), 600);
      return;
    }

    if (ev.type === 'wizard_battle') {
      const isMyBattle = ev.player === myKey;
      setStatus(isMyBattle ? '💀 You attack the Dark Wizard!' : `💀 ${gs.players[oppKey].name} attacks the Dark Wizard!`);
      startBattle(gs, 'wizard', ev.player, null);
      updateHud(); drawBoard();
      setTimeout(() => showBattleOverlay(next), 600);
      return;
    }

    if (ev.type === 'cooperate_or_betray') {
      setStatus('Both of you approach the Dark Wizard…');
      setTimeout(() => showCooperateBetrayUI(next), 600);
      return;
    }

    next();
  }

  // ── Wizard move phase (after player events) ───────────────────────────────
  function wizardMovePhase() {
    const { island, attacksPlayer } = moveWizardAfterTurn(gs, rng);
    snapTokens(); updateHud(); drawBoard();
    setStatus(`💀 The Dark Wizard moves to Island ${island+1} — ${ISLANDS[island].name}.`);

    const win = checkWinCondition(gs);
    if (win) { setTimeout(() => showEndScreen(win.winner, win.reason), 800); return; }

    if (attacksPlayer) {
      setTimeout(() => {
        const isMe = attacksPlayer === myKey;
        setStatus(isMe ? '💀 The Dark Wizard attacks you!' : `💀 The Dark Wizard attacks ${gs.players[attacksPlayer].name}!`);
        startBattle(gs, 'wizard', attacksPlayer, null);
        updateHud(); drawBoard();
        setTimeout(() => showBattleOverlay(() => {
          redealIslands(gs);
          drawBoard();
          const w2 = checkWinCondition(gs);
          if (w2) showEndScreen(w2.winner, w2.reason);
          else proceedToChoosing();
        }), 600);
      }, 1200);
    } else {
      setTimeout(() => {
        redealIslands(gs);
        drawBoard();
        proceedToChoosing();
      }, 1200);
    }
  }

  // ── Card handling overlay ─────────────────────────────────────────────────
  function handleCardResult(card, result, onDone) {
    updateHud(); drawBoard();

    if (result.action === 'spell_added') {
      if (card.timing === 'immediate') {
        showImmediateSpellOverlay(card, onDone);
      } else {
        showCardPickupOverlay(card, '🔮 Held Spell added to your hand.', onDone);
        renderHand();
      }
      return;
    }

    if (result.action === 'upgraded') {
      showCardPickupOverlay(card, `Upgraded from ${result.replaced.label}!`, onDone);
      return;
    }
    if (result.action === 'added') {
      showCardPickupOverlay(card, 'Added to inventory.', onDone);
      return;
    }
    if (result.action === 'no_upgrade') {
      // Offer swap or discard
      const box = makeBox();
      box.innerHTML = `
        <div style="font-size:13px;font-weight:bold;color:#c4a0e0;margin-bottom:8px;">${cardEmoji(card)} ${esc(card.label || card.name)}</div>
        <div style="font-size:11px;color:#aaa;margin-bottom:10px;">${esc(card.description || '')}</div>
        <div style="font-size:11px;color:#888;margin-bottom:12px;">Your current ${card.type} (${result.existing.label}) is equal or better.<br>What would you like to do?</div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          <button id="card-swap">Replace (keep new)</button>
          <button class="ghost" id="card-keep">Discard new card</button>
        </div>`;
      showOverlay(box);
      box.querySelector('#card-swap').addEventListener('click', () => {
        const existIdx = gs.players[myKey].inventory.findIndex(c => c.type === card.type);
        gs.discard.push(gs.players[myKey].inventory.splice(existIdx, 1)[0]);
        gs.players[myKey].inventory.push(card);
        closeOverlay(); updateHud(); renderHand(); onDone();
      });
      box.querySelector('#card-keep').addEventListener('click', () => {
        gs.discard.push(card);
        closeOverlay(); onDone();
      });
      return;
    }
    if (result.action === 'full') {
      // Inventory full — must discard something to make room
      const box = makeBox();
      box.innerHTML = `
        <div style="font-size:13px;font-weight:bold;color:#f0a040;margin-bottom:6px;">Inventory Full (${gs.players[myKey].maxInventory}/${gs.players[myKey].maxInventory})</div>
        <div style="font-size:12px;font-weight:bold;color:#c4a0e0;margin-bottom:4px;">${cardEmoji(card)} ${esc(card.label || card.name)}</div>
        <div style="font-size:11px;color:#aaa;margin-bottom:10px;">${esc(card.description || '')}</div>
        <div style="font-size:11px;color:#888;margin-bottom:8px;">Discard one item to make room, or skip this card:</div>
        <div id="inv-opts" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;"></div>
        <button class="ghost" id="card-skip">Skip this card</button>`;
      showOverlay(box);
      const opts = box.querySelector('#inv-opts');
      gs.players[myKey].inventory.forEach((held, i) => {
        const b = document.createElement('button');
        b.style.cssText = 'font-size:11px;text-align:left;padding:6px 10px;';
        b.textContent = `Discard: ${held.label || held.name} — ${held.description || ''}`;
        b.addEventListener('click', () => {
          discardFromInventory(gs, myKey, i);
          gs.players[myKey].inventory.push(card);
          closeOverlay(); updateHud(); renderHand(); onDone();
        });
        opts.appendChild(b);
      });
      box.querySelector('#card-skip').addEventListener('click', () => {
        gs.discard.push(card);
        closeOverlay(); onDone();
      });
      return;
    }
    onDone();
  }

  function showCardPickupOverlay(card, sub, onDone) {
    const box = makeBox();
    box.innerHTML = `
      <div style="font-size:16px;text-align:center;margin-bottom:8px;">${cardEmoji(card)}</div>
      <div style="font-size:14px;font-weight:bold;color:#c4a0e0;text-align:center;margin-bottom:6px;">${esc(card.label || card.name)}</div>
      ${card.description ? `<div style="font-size:11px;color:#aaa;text-align:center;margin-bottom:8px;">${esc(card.description)}</div>` : ''}
      <div style="font-size:11px;color:#40cc80;text-align:center;margin-bottom:14px;">${esc(sub)}</div>
      <div style="text-align:center;"><button id="card-ok">Got it</button></div>`;
    showOverlay(box);
    box.querySelector('#card-ok').addEventListener('click', () => { closeOverlay(); onDone(); });
  }

  function showImmediateSpellOverlay(card, onDone) {
    const box = makeBox();
    box.innerHTML = `
      <div style="font-size:13px;font-weight:bold;color:#c4a0e0;text-align:center;margin-bottom:4px;">⚡ Immediate Spell</div>
      <div style="font-size:14px;font-weight:bold;text-align:center;margin-bottom:8px;">${esc(card.name)}</div>
      <div style="font-size:12px;color:#aaa;text-align:center;margin-bottom:14px;line-height:1.5;">${esc(card.description)}</div>
      <div style="text-align:center;"><button id="spell-ok">Done — effect applied</button></div>`;
    showOverlay(box);
    gs.discard.push(card);
    // Haptic pulse for "Vibe Pulse" spell
    if (card.name === 'Vibe Pulse' && haptics.isConnected()) haptics.pulse(0.8, 5000);
    box.querySelector('#spell-ok').addEventListener('click', () => {
      closeOverlay(); onDone();
    });
  }

  // ── Battle overlay ────────────────────────────────────────────────────────
  let activeBattleCleanup = null;

  function showBattleOverlay(onDone) {
    if (activeBattleCleanup) activeBattleCleanup();
    const bs = gs.battleState;
    const isMyBattle = bs.type === 'pvp' || bs.playerKey === myKey;
    const me = gs.players[myKey];
    const opp = gs.players[oppKey];
    const wiz = gs.wizard;

    const box = makeBox('border-color:#8b0000;');
    box.id = 'battle-box';

    function buildBattleHTML() {
      const title = bs.type === 'pvp' ? '⚔ Battle!' : bs.playerKey === myKey ? '💀 You vs the Dark Wizard' : `💀 ${esc(gs.players[bs.playerKey].name)} vs the Dark Wizard`;
      const aStats = `⚔${getAttack(me)} 🛡${getDefence(me)} 🧥${getArmourCount(me)} ❤${bs.staminaLeft[myKey]}`;
      const bStats = bs.type === 'pvp' ? `⚔${getAttack(opp)} 🛡${getDefence(opp)} 🧥${getArmourCount(opp)} ❤${bs.staminaLeft[oppKey]}` : '';
      const wStats = `⚔${wiz.attack} 🛡${wiz.defence} 🧥${wiz.armour}`;

      return `
        <div style="font-size:15px;font-weight:bold;color:#ff4040;text-align:center;margin-bottom:10px;">${title}</div>
        ${bs.type === 'pvp' && bs.islandIdx !== null ? `<div style="font-size:11px;color:#f0c040;text-align:center;margin-bottom:6px;">🏝 Island ${bs.islandIdx+1} card at stake (first hit wins)</div>` : ''}
        ${bs.cardWinner ? `<div style="font-size:11px;color:#40cc80;text-align:center;margin-bottom:6px;">🏆 ${esc(gs.players[bs.cardWinner].name)} has the island card</div>` : ''}
        <div style="display:flex;gap:8px;margin-bottom:10px;font-size:11px;">
          <div style="flex:1;background:#0a1530;padding:6px;border-radius:6px;">
            <div style="color:#4a9eff;font-weight:bold;">${esc(me.name)}</div>
            <div>${aStats}</div>
          </div>
          ${bs.type === 'pvp' ? `
          <div style="align-self:center;font-size:18px;">⚔</div>
          <div style="flex:1;background:#300a0a;padding:6px;border-radius:6px;">
            <div style="color:#ff6b4a;font-weight:bold;">${esc(opp.name)}</div>
            <div>${bStats}</div>
          </div>` : `
          <div style="align-self:center;font-size:18px;">💀</div>
          <div style="flex:1;background:#300020;padding:6px;border-radius:6px;">
            <div style="color:#c4a0e0;font-weight:bold;">Dark Wizard</div>
            <div>${wStats}</div>
            ${wiz.armourZero ? '<div style="color:#ff4040;font-size:10px;">⚠ Armour broken — next hit kills!</div>' : ''}
          </div>`}
        </div>
        <div id="b-log" style="max-height:100px;overflow-y:auto;font-size:10px;color:#888;background:#0a0a14;border-radius:6px;padding:4px 8px;margin-bottom:10px;"></div>
        <div id="b-actions" style="text-align:center;"></div>`;
    }

    box.innerHTML = buildBattleHTML();
    showOverlay(box);

    function refreshBox() {
      box.innerHTML = buildBattleHTML();
      attachBattleActions();
      const log = box.querySelector('#b-log');
      bs.log.forEach(entry => {
        const div = document.createElement('div');
        if (entry.type === 'pvp') {
          div.textContent = `R${entry.round}: ${gs.players[entry.attacker].name} rolled ${entry.atkRoll} (atk ${entry.atkStat}) vs ${gs.players[entry.defender].name} ${entry.defRoll} (def ${entry.defStat}) → ${entry.hit ? 'HIT' : 'miss'}`;
        } else {
          div.textContent = `R${entry.round}: You ${entry.pAtkRoll}/${entry.pAtkStat}atk vs Wiz ${entry.wDefRoll}/${entry.wizDef}def → ${entry.playerHitsWiz ? 'HIT WIZARD' : 'miss'} | Wiz ${entry.wAtkRoll}/${entry.wizAtk}atk vs ${entry.pDefRoll}/${entry.pDefStat}def → ${entry.wizHitsPlayer ? 'HIT' : 'miss'}`;
        }
        log.appendChild(div);
      });
      log.scrollTop = log.scrollHeight;
    }

    function attachBattleActions() {
      const bActions = box.querySelector('#b-actions');
      if (!bActions) return;

      if (bs.ended) {
        let msg = '';
        if (bs.winner === myKey) msg = '<div style="color:#40cc80;font-size:14px;">🏆 You win this battle!</div>';
        else if (bs.winner === oppKey) msg = '<div style="color:#ff4040;font-size:14px;">💀 You lost this battle.</div>';
        else if (bs.winner === 'wizard') msg = '<div style="color:#ff4040;font-size:14px;">💀 The Dark Wizard overpowers you.</div>';
        else msg = '<div style="color:#888;font-size:13px;">Battle ended — no winner.</div>';
        bActions.innerHTML = msg;
        return;
      }

      if (bs.pendingWizardHit && bs.playerKey === myKey) {
        bActions.innerHTML = `
          <div style="font-size:12px;color:#40cc80;margin-bottom:8px;">You hit the wizard! Choose which stat to reduce:</div>
          <div style="display:flex;gap:6px;justify-content:center;">
            <button id="stat-atk">⚔ Attack (${wiz.attack})</button>
            <button id="stat-def">🛡 Defence (${wiz.defence})</button>
            <button id="stat-arm">🧥 Armour (${wiz.armour})</button>
          </div>`;
        const handle = (stat) => {
          const result = reduceWizardStat(gs, stat);
          socket.send({ type: MSG.WI_WIZARD_STAT, stat });
          updateHud();
          setStatus(`Wizard ${stat} reduced to ${result.newValue}${result.armourZero ? ' — ARMOUR BROKEN!' : ''}`);
          if (bs.ended) {
            checkAndEndBattle(onDone);
          } else {
            refreshBox();
          }
        };
        box.querySelector('#stat-atk').addEventListener('click', () => handle('attack'));
        box.querySelector('#stat-def').addEventListener('click', () => handle('defence'));
        box.querySelector('#stat-arm').addEventListener('click', () => handle('armour'));
        return;
      }

      if (!isMyBattle) {
        bActions.innerHTML = `<div style="font-size:11px;color:#888;">Waiting for ${esc(gs.players[bs.playerKey].name)}…</div>`;
        return;
      }

      if (gs._myBattleRollReady) {
        bActions.innerHTML = `<div style="font-size:11px;color:#888;">Waiting for opponent…</div>`;
        return;
      }

      // Show roll button + optional retreat (for wizard battles after first round)
      let html = `<button id="b-roll">🎲 Roll</button>`;
      if (bs.type === 'wizard' && bs.round > 0 && !bs.pendingWizardHit) {
        html += ` <button class="ghost" id="b-retreat" style="color:#f0a040;border-color:#f0a040;">↩ Retreat</button>`;
      }
      bActions.innerHTML = html;

      box.querySelector('#b-roll')?.addEventListener('click', () => {
        gs._myBattleRollReady = true;
        socket.send({ type: MSG.WI_BATTLE_ROLL_READY });
        refreshBox();
      });

      box.querySelector('#b-retreat')?.addEventListener('click', () => {
        const retreatIsland = gs.players[myKey].prevIsland ?? 0;
        gs.players[myKey].island = retreatIsland;
        retreatFromBattle(gs);
        socket.send({ type: MSG.WI_BATTLE_RETREAT, island: retreatIsland });
        checkAndEndBattle(onDone);
      });
    }

    function checkAndEndBattle(onDone) {
      gs._myBattleRollReady = false;
      closeOverlay();
      updateHud(); drawBoard();

      // Award island card to winner if pvp
      if (bs.type === 'pvp' && bs.islandIdx !== null && bs.cardWinner) {
        const card = collectIslandCard(gs, bs.islandIdx);
        if (card && bs.cardWinner === myKey) {
          const result = addCardToPlayer(gs.players[myKey], card);
          handleCardResult(card, result, () => {
            gs.battleState = null;
            gs.phase = 'resolving';
            const win = checkWinCondition(gs);
            if (win) showEndScreen(win.winner, win.reason);
            else onDone();
          });
          return;
        } else if (card && bs.cardWinner !== myKey) {
          // Opponent gets the card (applied on their side)
          gs.discard.push(card); // card leaves island; opponent has it
        }
      }

      // Draw wizard spell for those who got hit with no armour (handled via events)
      gs.battleState = null;
      gs.phase = 'resolving';
      const win = checkWinCondition(gs);
      if (win) showEndScreen(win.winner, win.reason);
      else onDone();
    }

    attachBattleActions();
    refreshBox();

    // Socket handler for battle roll go
    const onBattleRollGo = () => {
      gs._myBattleRollReady = false;
      const result = doBattleRound(gs, rng);
      if (!result) return;
      updateHud();

      // Handle wizard spells drawn this round
      result.events.forEach(ev => {
        if (ev.type === 'wizard_spell_draw') {
          const text = drawWizardSpell(gs, ev.player);
          if (ev.player === myKey) {
            pendingForfeits.push({ text, onDone: null });
          }
        }
        if (ev.type === 'wizard_killed') {
          // Kill handled in game state already
        }
      });

      if (bs.ended && !bs.pendingWizardHit) {
        refreshBox();
        // Wait briefly for player to read result, then check forfeits then end
        setTimeout(() => {
          if (pendingForfeits.length > 0) {
            drainForfeits(() => checkAndEndBattle(onDone));
          } else {
            checkAndEndBattle(onDone);
          }
        }, 1800);
      } else {
        refreshBox();
        // If wizard was just killed in battle
        if (gs.wizard.defeated && !bs.pendingWizardHit) {
          setTimeout(() => checkAndEndBattle(onDone), 1800);
        }
      }
    };

    const onBattleRollReady = () => {
      // Opponent signalled ready — for wizard battles, auto-echo if observer
      if (bs.type === 'wizard' && bs.playerKey !== myKey && !gs._myBattleRollReady) {
        gs._myBattleRollReady = true;
        socket.send({ type: MSG.WI_BATTLE_ROLL_READY });
      }
      refreshBox();
    };

    const onOppWizardStat = (ev) => {
      const { stat } = ev.detail;
      reduceWizardStat(gs, stat);
      updateHud();
      refreshBox();
    };

    const onOppRetreat = (ev) => {
      // Opponent retreated — end battle
      const { island } = ev.detail;
      if (island !== undefined) gs.players[oppKey].island = island;
      retreatFromBattle(gs);
      refreshBox();
      setTimeout(() => checkAndEndBattle(onDone), 800);
    };

    socket.addEventListener(MSG.WI_BATTLE_ROLL_GO, onBattleRollGo);
    socket.addEventListener(MSG.WI_BATTLE_ROLL_READY, onBattleRollReady);
    socket.addEventListener(MSG.WI_WIZARD_STAT, onOppWizardStat);
    socket.addEventListener(MSG.WI_OPP_RETREAT, onOppRetreat);

    activeBattleCleanup = () => {
      socket.removeEventListener(MSG.WI_BATTLE_ROLL_GO, onBattleRollGo);
      socket.removeEventListener(MSG.WI_BATTLE_ROLL_READY, onBattleRollReady);
      socket.removeEventListener(MSG.WI_WIZARD_STAT, onOppWizardStat);
      socket.removeEventListener(MSG.WI_OPP_RETREAT, onOppRetreat);
      activeBattleCleanup = null;
    };
  }

  // ── Cooperate / betray ────────────────────────────────────────────────────
  function showCooperateBetrayUI(onDone) {
    const box = makeBox();
    box.innerHTML = `
      <div style="font-size:15px;font-weight:bold;color:#c4a0e0;text-align:center;margin-bottom:8px;">⚔ Both at the Dark Wizard's Tower</div>
      <div style="font-size:11px;color:#aaa;text-align:center;margin-bottom:14px;line-height:1.5;">Choose secretly. Both choices will be revealed simultaneously.<br><br>
        <strong>Cooperate + Cooperate:</strong> Fight together — combine your attack or defence.<br>
        <strong>One Betrays:</strong> The betrayer sides with the wizard against you.<br>
        <strong>Both Betray:</strong> Fight the wizard separately, both draw a dark wizard spell.
      </div>
      <div style="display:flex;gap:10px;justify-content:center;">
        <button id="cb-coop" style="background:#0a2e14;border-color:#40cc80;color:#40cc80;">🤝 Cooperate</button>
        <button id="cb-bet" style="background:#2e0a0a;border-color:#ff4040;color:#ff4040;">🗡 Betray</button>
      </div>
      <div id="cb-wait" style="display:none;text-align:center;color:#888;font-size:12px;margin-top:12px;">Waiting for ${esc(gs.players[oppKey].name)}…</div>`;
    showOverlay(box);

    let myChoice = null;
    box.querySelector('#cb-coop').addEventListener('click', () => { submitCoopChoice('cooperate'); });
    box.querySelector('#cb-bet').addEventListener('click', () => { submitCoopChoice('betray'); });

    function submitCoopChoice(choice) {
      myChoice = choice;
      box.querySelector('#cb-coop').disabled = true;
      box.querySelector('#cb-bet').disabled = true;
      box.querySelector('#cb-wait').style.display = 'block';
      socket.send({ type: MSG.WI_COOPERATE_CHOICE, choice });
    }

    const onReveal = (ev) => {
      socket.removeEventListener(MSG.WI_COOPERATE_REVEAL, onReveal);
      const { choiceA, choiceB } = ev.detail;
      const myChoice2 = myKey === 'A' ? choiceA : choiceB;
      const oppChoice = myKey === 'A' ? choiceB : choiceA;
      closeOverlay();
      resolveCooperateBetray(myChoice2, oppChoice, onDone);
    };
    socket.addEventListener(MSG.WI_COOPERATE_REVEAL, onReveal);
  }

  function resolveCooperateBetray(myChoice, oppChoice, onDone) {
    const box = makeBox();
    const me = gs.players[myKey];
    const opp = gs.players[oppKey];

    if (myChoice === 'cooperate' && oppChoice === 'cooperate') {
      box.innerHTML = `
        <div style="font-size:14px;font-weight:bold;color:#40cc80;text-align:center;margin-bottom:8px;">🤝 Both Cooperate!</div>
        <div style="font-size:11px;color:#aaa;text-align:center;margin-bottom:12px;">Fight together — choose how to combine your strength:</div>
        <div style="display:flex;gap:8px;justify-content:center;">
          <button id="c-atk">Combine Attack (${getAttack(me)+getAttack(opp)})</button>
          <button id="c-def">Combine Defence (${getDefence(me)+getDefence(opp)})</button>
        </div>`;
      showOverlay(box);
      const fight = (combineStat) => {
        closeOverlay();
        // Apply boost temporarily then fight
        setStatus(`Cooperating! Combined ${combineStat} active for this battle.`);
        startBattle(gs, 'wizard', myKey, null);
        if (combineStat === 'attack') gs.battleState._coopAtkBoost = getAttack(opp);
        else gs.battleState._coopDefBoost = getDefence(opp);
        setTimeout(() => showBattleOverlay(onDone), 500);
      };
      box.querySelector('#c-atk').addEventListener('click', () => fight('attack'));
      box.querySelector('#c-def').addEventListener('click', () => fight('defence'));

    } else if (myChoice === 'betray' && oppChoice === 'betray') {
      box.innerHTML = `
        <div style="font-size:14px;font-weight:bold;color:#ff4040;text-align:center;margin-bottom:8px;">🗡 Both Betray!</div>
        <div style="font-size:11px;color:#aaa;text-align:center;margin-bottom:12px;">You each fight the wizard separately and both draw a dark wizard spell regardless.</div>
        <button id="bb-ok" style="display:block;margin:0 auto;">Begin your battle</button>`;
      showOverlay(box);
      box.querySelector('#bb-ok').addEventListener('click', () => {
        closeOverlay();
        // Both draw a spell immediately
        const spell = drawWizardSpell(gs, myKey);
        pendingForfeits.push({ text: spell, onDone: null });
        startBattle(gs, 'wizard', myKey, null);
        showBattleOverlay(onDone);
      });

    } else {
      // One betrays
      const betrayer = myChoice === 'betray' ? myKey : oppKey;
      const cooperator = betrayer === 'A' ? 'B' : 'A';
      box.innerHTML = `
        <div style="font-size:14px;font-weight:bold;color:#ff4040;text-align:center;margin-bottom:8px;">🗡 ${esc(gs.players[betrayer].name)} Betrays!</div>
        <div style="font-size:11px;color:#aaa;text-align:center;margin-bottom:12px;">${esc(gs.players[betrayer].name)}'s attack and defence are added to the Dark Wizard for this battle.<br>${esc(gs.players[cooperator].name)} must fight alone against a boosted wizard.</div>
        <button id="bt-ok" style="display:block;margin:0 auto;">Begin battle</button>`;
      showOverlay(box);
      box.querySelector('#bt-ok').addEventListener('click', () => {
        closeOverlay();
        const betrayerPlayer = gs.players[betrayer];
        // Temporarily boost wizard
        const origAtk = gs.wizard.attack, origDef = gs.wizard.defence;
        gs.wizard.attack += getAttack(betrayerPlayer);
        gs.wizard.defence += getDefence(betrayerPlayer);
        startBattle(gs, 'wizard', cooperator, null);
        showBattleOverlay(() => {
          // Restore wizard
          gs.wizard.attack = origAtk;
          gs.wizard.defence = origDef;
          onDone();
        });
      });
    }
  }

  // ── Forfeit queue ─────────────────────────────────────────────────────────
  const pendingForfeits = [];

  function drainForfeits(onDone) {
    if (pendingForfeits.length === 0) { onDone(); return; }
    const { text } = pendingForfeits.shift();
    showForfeitOverlay(text, () => drainForfeits(onDone));
  }

  function showForfeitOverlay(text, onDone) {
    const box = makeBox('border-color:#8b0000;');
    box.innerHTML = `
      <div style="font-size:14px;font-weight:bold;color:#ff4040;text-align:center;margin-bottom:10px;">💀 Dark Wizard Spell</div>
      <div style="font-size:13px;color:#e8dfc8;line-height:1.6;margin-bottom:16px;">${esc(text)}</div>
      <div style="text-align:center;"><button id="f-ok">I'll do it</button></div>
      <div id="f-wait" style="display:none;font-size:11px;color:#888;text-align:center;margin-top:8px;">Waiting for both to acknowledge…</div>`;
    showOverlay(box);

    let myAck = false, oppAck = false;
    function tryClose() { if (myAck && oppAck) { closeOverlay(); onDone(); } }

    box.querySelector('#f-ok').addEventListener('click', () => {
      box.querySelector('#f-ok').disabled = true;
      box.querySelector('#f-wait').style.display = 'block';
      myAck = true;
      socket.send({ type: MSG.WI_FORFEIT_ACK });
      tryClose();
    });

    const onOppAck = () => { socket.removeEventListener(MSG.WI_OPP_FORFEIT_ACK, onOppAck); oppAck = true; tryClose(); };
    socket.addEventListener(MSG.WI_OPP_FORFEIT_ACK, onOppAck);
  }

  // ── Inventory viewer ──────────────────────────────────────────────────────
  function showInventoryOverlay() {
    const me = gs.players[myKey];
    const box = makeBox();
    const rows = me.inventory.map((card, i) =>
      `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #2a2a3a;font-size:11px;">
        <div>${cardEmoji(card)} <strong>${esc(card.label || card.name)}</strong><br><span style="color:#888;">${esc(card.description || '')}</span></div>
        <button data-idx="${i}" class="discard-btn ghost" style="font-size:10px;color:#ff6b4a;border-color:#ff6b4a;padding:3px 8px;margin-left:8px;">Discard</button>
      </div>`
    ).join('');
    box.innerHTML = `
      <div style="font-size:13px;font-weight:bold;color:#c4a0e0;margin-bottom:10px;">Inventory (${me.inventory.length}/${me.maxInventory})</div>
      ${rows || '<div style="color:#555;text-align:center;">Empty</div>'}
      <div style="text-align:center;margin-top:14px;"><button class="ghost" id="inv-close">Close</button></div>`;
    showOverlay(box);
    box.querySelectorAll('.discard-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const removed = discardFromInventory(gs, myKey, idx);
        closeOverlay();
        updateHud(); drawBoard();
        if (removed) setStatus(`Discarded: ${removed.label || removed.name}`);
      });
    });
    box.querySelector('#inv-close').addEventListener('click', closeOverlay);
  }

  // ── End screen ────────────────────────────────────────────────────────────
  function showEndScreen(winnerKey, reason) {
    gs.phase = 'ended';
    setActions('');
    if (activeBattleCleanup) activeBattleCleanup();
    const iWon = winnerKey === myKey;
    const box = makeBox();
    const myForfeits = gs.players[myKey].forfeitLog;
    const oppForfeits = gs.players[oppKey].forfeitLog;
    const forfeitHTML = (forfeits, label, color) =>
      forfeits.length ? `<div style="margin-bottom:10px;"><div style="font-weight:bold;color:${color};font-size:12px;margin-bottom:4px;">${label}:</div>${forfeits.map(f => `<div style="font-size:11px;color:#e8dfc8;padding:3px 0;border-bottom:1px solid #1a1a2e;">• ${esc(f.text)}</div>`).join('')}</div>` : '';

    box.innerHTML = `
      <div style="font-size:20px;font-weight:bold;color:${iWon ? '#40cc80' : '#ff4040'};text-align:center;margin-bottom:6px;">${iWon ? '🏆 Victory!' : '💀 Defeated'}</div>
      <div style="font-size:12px;color:#888;text-align:center;margin-bottom:16px;">${esc(reason)}</div>
      ${forfeitHTML(myForfeits, 'Your forfeits', '#4a9eff')}
      ${forfeitHTML(oppForfeits, `${esc(gs.players[oppKey].name)}'s forfeits`, '#ff6b4a')}
      <div style="text-align:center;"><button id="end-lobby">Back to Lobby</button></div>`;
    showOverlay(box);
    box.querySelector('#end-lobby').addEventListener('click', () => {
      closeOverlay();
      navigate(`#/session/${state.sessionId}`);
    });
    if (haptics.isConnected()) {
      if (iWon) haptics.winPattern?.();
      else haptics.losePattern?.();
    }
  }

  // ── Socket message handlers ───────────────────────────────────────────────
  const onDestGo = (ev) => {
    const { destA, destB } = ev.detail;
    processDestGo(destA, destB);
  };

  // Note: defined earlier as inline function; expose via socket listener
  function processDestGo(destA, destB) {
    pendingDest = null;
    const myDest = myKey === 'A' ? destA : destB;
    const oppDest = myKey === 'A' ? destB : destA;
    const fmt = d => d === 'wizard' ? 'Wizard Tower' : `Island ${d+1}`;
    setStatus(`${esc(gs.players[myKey].name)} → ${fmt(myDest)} · ${esc(gs.players[oppKey].name)} → ${fmt(oppDest)}`);
    setActions('');
    // Animate both tokens moving simultaneously, then process events
    animateTokens(destA, destB, () => {
      const events = resolveDestinations(gs, destA, destB);
      updateHud(); drawBoard();
      setTimeout(() => processEvents(events, 0, () => wizardMovePhase()), 300);
    });
  }

  const onSpellPlayOpp = (ev) => {
    const { spellName } = ev.detail;
    setStatus(`${esc(gs.players[oppKey].name)} played spell: ${esc(spellName)}`);
    const spell = SPELL_CARDS.find(s => s.name === spellName);
    if (isRuleSpell(spell)) addActiveRule(spell.name, spell.description, gs.players[oppKey].name);
  };

  const onPeerLeft = () => {
    setStatus('Opponent disconnected — you win by default.');
    setActions('');
  };

  socket.addEventListener(MSG.WI_DEST_GO, onDestGo);
  socket.addEventListener(MSG.WI_SPELL_PLAY, onSpellPlayOpp);
  socket.addEventListener(MSG.PEER_LEFT, onPeerLeft);

  const cleanup = () => {
    window.removeEventListener('resize', resizeCanvas);
    if (resizeObs) resizeObs.disconnect();
    canvas.removeEventListener('click', onBoardClick);
    canvas.removeEventListener('mousemove', onBoardHover);
    socket.removeEventListener(MSG.WI_DEST_GO, onDestGo);
    socket.removeEventListener(MSG.WI_SPELL_PLAY, onSpellPlayOpp);
    socket.removeEventListener(MSG.PEER_LEFT, onPeerLeft);
    if (activeBattleCleanup) activeBattleCleanup();
    if (animRafId) { cancelAnimationFrame(animRafId); animRafId = null; }
  };
  window.addEventListener('hashchange', cleanup, { once: true });

  // ── Start: show modifier + instructions ───────────────────────────────────
  const startBox = makeBox();
  startBox.innerHTML = `
    <div style="font-size:16px;font-weight:bold;color:#c4a0e0;text-align:center;margin-bottom:10px;">⚔ Wizard Island</div>
    <div style="background:#1a0a2e;border-radius:8px;padding:10px;margin-bottom:12px;">
      <div style="font-size:12px;font-weight:bold;color:#f0c040;margin-bottom:4px;">🎲 Game Modifier: ${esc(gs.modifier.name)}</div>
      <div style="font-size:11px;color:#aaa;line-height:1.5;">${esc(gs.modifier.description)}</div>
    </div>
    <div style="font-size:11px;color:#888;line-height:1.7;margin-bottom:14px;">
      🗺 Each round, tap an island (or the buttons below) to move — or tap the tower to attack the Dark Wizard.<br>
      🃏 Island cards show only their type — you learn the exact card when you collect it (kept in your Hand).<br>
      📦 Land alone → collect the island card.<br>
      ⚔ Same island as opponent → battle (first hit wins the card).<br>
      💀 Dark Wizard: ⚔${gs.wizard.attack} 🛡${gs.wizard.defence} 🧥${gs.wizard.armour} — on hit, reduce any one stat.<br>
      🎯 Win: reduce Wizard armour to 0, then land one final hit.
    </div>
    <div style="text-align:center;"><button id="wi-start">Ready!</button></div>`;
  showOverlay(startBox);
  startBox.querySelector('#wi-start').addEventListener('click', () => {
    closeOverlay();
    proceedToChoosing();
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function cardEmoji(card) {
  return { attack: '⚔', defence: '🛡', stamina: '❤', armour: '🧥', spell: '🔮' }[card.type] || '📦';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
