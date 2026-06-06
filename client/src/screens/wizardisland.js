import { socket } from '../net/socket.js';
import { state } from '../state.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';
import { makeRng, rngInt } from '../game/seededRng.js';
import {
  ISLANDS, WIZARD_POS, SPELL_POOL, WIZARD_SPELL_POOL,
  createGameState, dealIslands, resolveRolls, revealIslandCard,
  startBattle, resolveBattleRound, applySpell, drawWizardSpell,
  checkWinCondition, sinkRandomIsland, respawnWizard,
} from '../game/wizardIslandGame.js';

export function renderWizardIsland(root) {
  const myKey = state.role === 'host' ? 'A' : 'B';
  const oppKey = myKey === 'A' ? 'B' : 'A';
  const myName = state.myName;
  const oppName = myKey === 'A' ? state.guestName : state.hostName;

  const rng = makeRng(state.seed);
  const gs = createGameState(state.seed, state.wiWinCondition, state.wiSpellLimit, state.hostName, state.guestName);

  // Pre-deal first turn islands using a separate rng call sequence
  // Note: gs.players A = host, B = guest always
  const dealRng = makeRng(state.seed ^ 0xdea1);
  dealIslands(gs, dealRng);

  root.innerHTML = `
    <div id="wi-root" style="display:flex;flex-direction:column;height:100vh;background:#0a0a14;color:#e8dfc8;font-family:inherit;overflow:hidden;">
      <div id="wi-hud" style="display:flex;gap:8px;padding:8px;background:#111;border-bottom:1px solid #333;flex-shrink:0;align-items:center;flex-wrap:wrap;">
        <div id="wi-hud-me" class="wi-hud-player" style="flex:1;min-width:150px;"></div>
        <div id="wi-hud-wizard" style="text-align:center;min-width:100px;font-size:12px;color:#c4a0e0;"></div>
        <div id="wi-hud-opp" class="wi-hud-player" style="flex:1;min-width:150px;text-align:right;"></div>
      </div>
      <div style="position:relative;flex:1;overflow:hidden;">
        <canvas id="wi-canvas" style="display:block;width:100%;height:100%;"></canvas>
        <div id="wi-spell-hand" style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);display:flex;gap:6px;z-index:10;"></div>
        <div id="wi-status" style="position:absolute;top:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.7);padding:6px 14px;border-radius:8px;font-size:13px;color:#e8dfc8;pointer-events:none;"></div>
      </div>
      <div id="wi-actions" style="padding:10px;display:flex;gap:8px;justify-content:center;background:#111;border-top:1px solid #333;flex-shrink:0;flex-wrap:wrap;"></div>
      <div id="wi-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:100;display:flex;align-items:center;justify-content:center;"></div>
    </div>
  `;

  // ── Canvas setup ───────────────────────────────────────────────────────
  const canvas = root.querySelector('#wi-canvas');
  const ctx = canvas.getContext('2d');
  const overlay = root.querySelector('#wi-overlay');
  overlay.style.display = 'none';

  const boardImg = new Image();
  const cardBackImgs = {};
  const cardTypes = ['attack', 'defence', 'stamina', 'armour', 'spell'];
  let assetsLoaded = 0;
  const totalAssets = 1 + cardTypes.length;

  const onAssetLoad = () => {
    assetsLoaded++;
    if (assetsLoaded >= totalAssets) drawBoard();
  };

  boardImg.onload = onAssetLoad;
  boardImg.src = '/wizardisland/board.jpg';

  cardTypes.forEach(t => {
    const img = new Image();
    img.onload = onAssetLoad;
    img.src = `/wizardisland/back-${t}.jpg`;
    cardBackImgs[t] = img;
  });

  // Animation state
  let animFrame = null;
  const tokenPositions = {
    A: { x: 0, y: 0, tx: 0, ty: 0 },
    B: { x: 0, y: 0, tx: 0, ty: 0 },
    W: { x: 0, y: 0, tx: 0, ty: 0 },
  };

  function islandPixel(islandIdx) {
    const [fx, fy] = ISLANDS[islandIdx].pos;
    return [fx * canvas.width, fy * canvas.height];
  }

  function wizardPixel() {
    return [WIZARD_POS[0] * canvas.width, WIZARD_POS[1] * canvas.height];
  }

  function resizeCanvas() {
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    // Snap token positions instantly on resize
    updateTokenTargets(true);
    drawBoard();
  }

  function updateTokenTargets(snap = false) {
    const [axT, ayT] = islandPixel(gs.players.A.island);
    const [bxT, byT] = islandPixel(gs.players.B.island);
    const [wxT, wyT] = gs.wizard.island !== -1 ? islandPixel(gs.wizard.island) : wizardPixel();

    tokenPositions.A.tx = axT; tokenPositions.A.ty = ayT - 20;
    tokenPositions.B.tx = bxT; tokenPositions.B.ty = byT + 20;
    tokenPositions.W.tx = wxT; tokenPositions.W.ty = wyT;

    if (snap) {
      ['A', 'B', 'W'].forEach(k => {
        tokenPositions[k].x = tokenPositions[k].tx;
        tokenPositions[k].y = tokenPositions[k].ty;
      });
    }
  }

  function animateTokens(cb) {
    const speed = 0.12;
    let done = false;
    function step() {
      done = true;
      ['A', 'B', 'W'].forEach(k => {
        const t = tokenPositions[k];
        t.x += (t.tx - t.x) * speed;
        t.y += (t.ty - t.y) * speed;
        if (Math.abs(t.tx - t.x) > 1 || Math.abs(t.ty - t.y) > 1) done = false;
      });
      drawBoard();
      if (!done) {
        animFrame = requestAnimationFrame(step);
      } else {
        animFrame = null;
        if (cb) cb();
      }
    }
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = requestAnimationFrame(step);
  }

  function drawBoard() {
    if (!canvas.width || !canvas.height) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Board image — letterbox to square
    const sz = Math.min(canvas.width, canvas.height);
    const ox = (canvas.width - sz) / 2;
    const oy = (canvas.height - sz) / 2;
    if (boardImg.complete && boardImg.naturalWidth) {
      ctx.drawImage(boardImg, ox, oy, sz, sz);
    } else {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Adjust island/token positions to letterboxed canvas
    function islandPx(islandIdx) {
      const [fx, fy] = ISLANDS[islandIdx].pos;
      return [ox + fx * sz, oy + fy * sz];
    }

    // Island card indicators
    gs.islands.forEach((island, i) => {
      if (island.sunk) {
        const [ix, iy] = islandPx(i);
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(ix, iy, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }
      if (!island.card) return;
      const [ix, iy] = islandPx(i);
      const img = cardBackImgs[island.card.type];
      const cw = 28, ch = 38;
      if (img && img.complete && img.naturalWidth) {
        ctx.save();
        ctx.shadowColor = '#f0c040';
        ctx.shadowBlur = 6;
        ctx.drawImage(img, ix - cw / 2, iy - ch - 28, cw, ch);
        ctx.restore();
      } else {
        ctx.fillStyle = '#555';
        ctx.fillRect(ix - 14, iy - ch - 28, cw, ch);
      }
    });

    // Token draw helper
    function drawToken(x, y, label, color, isMe) {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = isMe ? 12 : 6;
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y);
      ctx.restore();
    }

    // Wizard token
    const wIslandPx = gs.wizard.island >= 0 ? islandPx(gs.wizard.island) : [ox + WIZARD_POS[0] * sz, oy + WIZARD_POS[1] * sz];
    ctx.save();
    ctx.shadowColor = '#8000ff';
    ctx.shadowBlur = 16;
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💀', wIslandPx[0], wIslandPx[1] - 8);
    ctx.restore();

    // Player tokens (use animated positions)
    const aColor = '#4a9eff';
    const bColor = '#ff6b4a';
    drawToken(tokenPositions.A.x, tokenPositions.A.y,
      gs.players.A.name.charAt(0).toUpperCase(), aColor, myKey === 'A');
    drawToken(tokenPositions.B.x, tokenPositions.B.y,
      gs.players.B.name.charAt(0).toUpperCase(), bColor, myKey === 'B');
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  updateTokenTargets(true);

  // ── HUD rendering ──────────────────────────────────────────────────────
  function updateHud() {
    const me = gs.players[myKey];
    const opp = gs.players[oppKey];
    const wiz = gs.wizard;

    const hudMe = root.querySelector('#wi-hud-me');
    const hudOpp = root.querySelector('#wi-hud-opp');
    const hudWiz = root.querySelector('#wi-hud-wizard');

    hudMe.innerHTML = `
      <div style="font-size:12px;font-weight:bold;color:#4a9eff;">${esc(me.name)} <span style="color:#888">(you)</span></div>
      <div style="font-size:11px;">⚔ ${me.attack.value} &nbsp;🛡 ${me.defence.value} &nbsp;❤ ${me.stamina}/${me.maxStamina} &nbsp;🧥 ${me.armour}</div>
      <div style="font-size:11px;color:#c4a0e0;">🔮 ${me.spells.length}/3 spells</div>
    `;
    hudOpp.innerHTML = `
      <div style="font-size:12px;font-weight:bold;color:#ff6b4a;">${esc(opp.name)}</div>
      <div style="font-size:11px;">⚔ ? &nbsp;🛡 ? &nbsp;❤ ${opp.stamina}/${opp.maxStamina} &nbsp;🧥 ${opp.armour}</div>
      <div style="font-size:11px;color:#c4a0e0;">🔮 ${opp.spells.length}/3 spells</div>
    `;
    hudWiz.innerHTML = wiz.defeated ? '<div style="color:#888">☠ Defeated</div>' : `
      <div>💀 Dark Wizard</div>
      <div style="font-size:11px;">❤ ${wiz.stamina}/${wiz.maxStamina} &nbsp;🧥 ${wiz.armour}</div>
      <div style="font-size:11px;">Turn ${gs.turn}</div>
    `;
  }

  // ── Spell hand rendering ───────────────────────────────────────────────
  function renderSpellHand() {
    const hand = root.querySelector('#wi-spell-hand');
    const me = gs.players[myKey];
    hand.innerHTML = '';
    me.spells.forEach((spell, i) => {
      const btn = document.createElement('button');
      btn.className = 'mm-rounds-btn ghost';
      btn.style.cssText = 'font-size:11px;padding:4px 8px;background:#1a1a2e;border:1px solid #5c3d8c;color:#c4a0e0;cursor:pointer;border-radius:6px;max-width:90px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      btn.textContent = spell.name;
      btn.title = spell.description;
      btn.addEventListener('click', () => handleSpellTap(i));
      hand.appendChild(btn);
    });
  }

  function handleSpellTap(spellIdx) {
    const spell = gs.players[myKey].spells[spellIdx];
    if (!spell) return;
    if (spell.id === 'leap' || spell.id === 'summon') {
      showIslandPicker(spell, spellIdx);
      return;
    }
    playSpell(spell, spellIdx, null);
  }

  function showIslandPicker(spell, spellIdx) {
    const box = document.createElement('div');
    box.style.cssText = 'background:#1a1a2e;border:1px solid #5c3d8c;border-radius:12px;padding:16px;text-align:center;max-width:300px;';
    box.innerHTML = `<div style="font-size:14px;color:#c4a0e0;margin-bottom:8px;">${esc(spell.name)} — choose island</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;" id="island-btns"></div>
      <button class="ghost" id="cancel-pick" style="margin-top:10px;">Cancel</button>`;
    showOverlay(box);
    const btnArea = box.querySelector('#island-btns');
    ISLANDS.forEach((isl, i) => {
      if (gs.islands[i].sunk) return;
      const b = document.createElement('button');
      b.className = 'mm-rounds-btn ghost';
      b.style.fontSize = '12px';
      b.textContent = `${i + 1}: ${isl.name}`;
      b.addEventListener('click', () => { closeOverlay(); playSpell(spell, spellIdx, i); });
      btnArea.appendChild(b);
    });
    box.querySelector('#cancel-pick').addEventListener('click', closeOverlay);
  }

  function playSpell(spell, spellIdx, targetIsland) {
    const result = applySpell(gs, spell.id, myKey, targetIsland, rng);
    if (!result) return;
    gs.players[myKey].spells.splice(spellIdx, 1);
    socket.send({ type: MSG.WI_SPELL_PLAY, spellId: spell.id, targetIsland: targetIsland ?? -1 });
    if (result.haptic && haptics.isConnected()) {
      haptics.pulse(result.haptic.intensity, result.haptic.duration);
    }
    setStatus(result.message);
    updateHud();
    renderSpellHand();
    drawBoard();
  }

  // ── Status bar ─────────────────────────────────────────────────────────
  function setStatus(msg) {
    const el = root.querySelector('#wi-status');
    if (el) el.textContent = msg;
  }

  // ── Actions bar ────────────────────────────────────────────────────────
  function setActions(html) {
    root.querySelector('#wi-actions').innerHTML = html;
  }

  function showRollButton() {
    const myReady = gs._myRollReady || false;
    setActions(myReady
      ? `<button disabled style="opacity:0.5">Waiting for opponent…</button>`
      : `<button id="wi-btn-roll">🎲 Roll</button>`
    );
    root.querySelector('#wi-btn-roll')?.addEventListener('click', () => {
      gs._myRollReady = true;
      socket.send({ type: MSG.WI_ROLL_READY });
      showRollButton();
      setStatus('Waiting for opponent to roll…');
    });
  }

  // ── Overlay helpers ────────────────────────────────────────────────────
  function showOverlay(contentEl) {
    overlay.style.display = 'flex';
    overlay.innerHTML = '';
    overlay.appendChild(contentEl);
  }

  function closeOverlay() {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
  }

  // ── Card collection overlay ────────────────────────────────────────────
  function showCardOverlay(result, playerKey, cb) {
    const isMe = playerKey === myKey;
    if (!isMe) { cb(); return; } // opponent's card reveal is silent for us

    const box = document.createElement('div');
    box.style.cssText = 'background:#1a1a2e;border:1px solid #5c3d8c;border-radius:12px;padding:20px;text-align:center;max-width:280px;';

    let title, sub;
    if (result.isSpell) {
      title = `🔮 ${result.card.name}`;
      sub = result.card.description;
    } else {
      title = `${typeEmoji(result.type)} ${result.card.label} ${capitalize(result.type)}`;
      sub = result.card.description || (result.upgraded ? 'Equipped!' : 'Already have better — kept your card.');
    }

    box.innerHTML = `
      <div style="font-size:15px;font-weight:bold;color:#c4a0e0;margin-bottom:6px;">${esc(title)}</div>
      ${sub ? `<div style="font-size:12px;color:#aaa;margin-bottom:12px;">${esc(sub)}</div>` : ''}
      <button id="card-ok">Got it</button>
    `;
    showOverlay(box);
    box.querySelector('#card-ok').addEventListener('click', () => {
      closeOverlay();
      socket.send({ type: MSG.WI_CARD_ACK });
      cb();
    });

    // If it's a spell, offer to add to hand or play immediately
    if (result.isSpell) {
      const spell = result.card;
      if (spell.timing === 'immediate') {
        box.querySelector('#card-ok').textContent = 'Play it!';
        box.querySelector('#card-ok').addEventListener('click', () => {
          // Already handled above
        }, { once: false });
        // Replace button logic: just apply and continue
        box.querySelector('#card-ok').onclick = () => {
          const res = applySpell(gs, spell.id, myKey, null, rng);
          if (res?.haptic && haptics.isConnected()) haptics.pulse(res.haptic.intensity, res.haptic.duration);
          closeOverlay();
          socket.send({ type: MSG.WI_CARD_ACK });
          if (res?.message) setStatus(res.message);
          cb();
        };
      } else {
        // Held spell — add to hand if room, else show discard UI
        const me = gs.players[myKey];
        if (me.spells.length < 3) {
          me.spells.push(spell);
          renderSpellHand();
        } else {
          // Replace the Got it button with discard UI
          box.querySelector('#card-ok').remove();
          const discardHtml = `<div style="font-size:12px;color:#f0a040;margin-bottom:8px;">Hand full — discard one:</div>
            <div id="discard-opts" style="display:flex;flex-direction:column;gap:4px;"></div>`;
          box.insertAdjacentHTML('beforeend', discardHtml);
          const opts = box.querySelector('#discard-opts');
          [...me.spells, spell].forEach((s, i) => {
            const b = document.createElement('button');
            b.className = 'mm-rounds-btn ghost';
            b.style.fontSize = '12px';
            b.textContent = `Discard: ${s.name}`;
            b.addEventListener('click', () => {
              if (i < me.spells.length) {
                socket.send({ type: MSG.WI_SPELL_DISCARD, spellId: me.spells[i].id });
                me.spells.splice(i, 1);
                me.spells.push(spell);
              }
              // If discarding the new spell — just don't add it
              renderSpellHand();
              closeOverlay();
              socket.send({ type: MSG.WI_CARD_ACK });
              cb();
            });
            opts.appendChild(b);
          });
        }
        return;
      }
    }
  }

  // ── Battle overlay ─────────────────────────────────────────────────────
  function showBattleOverlay(type, playerKey) {
    startBattle(gs, type, playerKey);
    const bs = gs.battleState;
    const me = gs.players[myKey];
    const opp = gs.players[oppKey];
    const wizStats = gs.wizard;

    const isPlayerBattle = type === 'pvp' || playerKey === myKey;

    const box = document.createElement('div');
    box.style.cssText = 'background:#1a1a2e;border:2px solid #8b0000;border-radius:12px;padding:16px;text-align:center;max-width:360px;width:90%;';
    box.id = 'battle-box';

    const titleText = type === 'pvp' ? '⚔ Battle!' : '💀 Boss Battle!';

    box.innerHTML = `
      <div style="font-size:16px;font-weight:bold;color:#ff4040;margin-bottom:10px;">${titleText}</div>
      <div id="battle-combatants" style="display:flex;gap:12px;justify-content:center;margin-bottom:10px;font-size:12px;"></div>
      <div id="battle-log" style="max-height:120px;overflow-y:auto;font-size:11px;color:#aaa;margin-bottom:10px;text-align:left;padding:4px 8px;background:#111;border-radius:6px;"></div>
      <div id="battle-actions"></div>
    `;
    showOverlay(box);
    updateBattleUI();

    function updateBattleUI() {
      const combatants = box.querySelector('#battle-combatants');
      const battleLog = box.querySelector('#battle-log');
      const battleActions = box.querySelector('#battle-actions');

      if (type === 'pvp') {
        combatants.innerHTML = `
          <div style="flex:1;background:#0a1530;padding:6px;border-radius:6px;">
            <div style="color:#4a9eff;font-weight:bold;">${esc(me.name)}</div>
            <div>⚔ ${me.attack.value} &nbsp; 🛡 ${me.defence.value}</div>
            <div>❤ ${me.stamina} &nbsp; 🧥 ${me.armour}</div>
          </div>
          <div style="font-size:18px;align-self:center;">⚔</div>
          <div style="flex:1;background:#300a0a;padding:6px;border-radius:6px;">
            <div style="color:#ff6b4a;font-weight:bold;">${esc(opp.name)}</div>
            <div>⚔ ? &nbsp; 🛡 ?</div>
            <div>❤ ${opp.stamina} &nbsp; 🧥 ${opp.armour}</div>
          </div>
        `;
      } else {
        const p = gs.players[playerKey];
        combatants.innerHTML = `
          <div style="flex:1;background:#0a1530;padding:6px;border-radius:6px;">
            <div style="color:#4a9eff;font-weight:bold;">${esc(p.name)}</div>
            <div>⚔ ${p.attack.value} &nbsp; 🛡 ${p.defence.value}</div>
            <div>❤ ${p.stamina} &nbsp; 🧥 ${p.armour}</div>
          </div>
          <div style="font-size:18px;align-self:center;">💀</div>
          <div style="flex:1;background:#300020;padding:6px;border-radius:6px;">
            <div style="color:#c4a0e0;font-weight:bold;">Dark Wizard</div>
            <div>⚔ ${wizStats.attack} &nbsp; 🛡 ${wizStats.defence}</div>
            <div>❤ ${wizStats.stamina} &nbsp; 🧥 ${wizStats.armour}</div>
          </div>
        `;
      }

      const myReady = bs.myRollReady;
      const oppReady = bs.oppRollReady;

      if (bs.ended) {
        const won = bs.winner === myKey || (type === 'boss' && bs.winner === playerKey && playerKey === myKey);
        battleActions.innerHTML = `<div style="font-size:14px;color:${bs.winner === 'wizard' ? '#ff4040' : '#40ff80'};">${bs.winner === 'wizard' ? '💀 The Dark Wizard wins.' : `🏆 ${esc(gs.players[bs.winner]?.name ?? 'The Hero')} wins!`}</div>`;
      } else if (!isPlayerBattle) {
        battleActions.innerHTML = `<div style="font-size:12px;color:#888;">Watching ${esc(gs.players[playerKey]?.name ?? '')}'s battle…</div>`;
      } else {
        battleActions.innerHTML = myReady
          ? `<div style="font-size:12px;color:#888;">Waiting for opponent…</div>`
          : `<button id="battle-roll-btn">🎲 Roll d4</button>`;
        box.querySelector('#battle-roll-btn')?.addEventListener('click', () => {
          bs.myRollReady = true;
          socket.send({ type: MSG.WI_BATTLE_ROLL_READY });
          updateBattleUI();
        });
      }

      battleLog.innerHTML = bs.log.map(entry => {
        if (type === 'pvp') {
          return `<div>R${entry.round}: ${esc(gs.players.A.name)} rolled ${entry.rollA}(${entry.atkA}atk) vs ${esc(gs.players.B.name)} ${entry.rollB}(${entry.atkB}atk) → dmg A:${entry.dmgToA} B:${entry.dmgToB}</div>`;
        } else {
          return `<div>R${entry.round}: Hero ${entry.rollA}(${entry.pAtk}atk) vs Wizard ${entry.rollB}(${entry.wAtk}atk) → hero dmg:${entry.dmgToP} wiz dmg:${entry.dmgToWiz}</div>`;
        }
      }).join('');
      battleLog.scrollTop = battleLog.scrollHeight;
    }

    // Return update function so socket handlers can call it
    return { updateBattleUI };
  }

  // ── Forfeit overlay ────────────────────────────────────────────────────
  function showForfeitOverlay(forfeit, cb) {
    gs._myForfeitAck = false;
    gs._oppForfeitAck = false;

    const box = document.createElement('div');
    box.style.cssText = 'background:#1a0a0a;border:2px solid #8b0000;border-radius:12px;padding:20px;text-align:center;max-width:320px;';
    box.innerHTML = `
      <div style="font-size:15px;font-weight:bold;color:#ff4040;margin-bottom:10px;">💀 Dark Wizard Spell</div>
      <div style="font-size:13px;color:#e8dfc8;margin-bottom:16px;line-height:1.5;">${esc(forfeit.text)}</div>
      <button id="forfeit-ok">I'll do it</button>
      <div id="forfeit-wait" style="display:none;font-size:12px;color:#888;margin-top:8px;">Waiting for both players to acknowledge…</div>
    `;
    showOverlay(box);
    box.querySelector('#forfeit-ok').addEventListener('click', () => {
      box.querySelector('#forfeit-ok').disabled = true;
      box.querySelector('#forfeit-wait').style.display = 'block';
      gs._myForfeitAck = true;
      socket.send({ type: MSG.WI_FORFEIT_ACK });
      checkBothForfeitAck();
    });

    function checkBothForfeitAck() {
      if (gs._myForfeitAck && gs._oppForfeitAck) {
        closeOverlay();
        cb();
      }
    }

    // Store so opp_forfeit_ack handler can call it
    gs._forfeitAckCb = checkBothForfeitAck;
  }

  // ── End screen ─────────────────────────────────────────────────────────
  function showEndScreen(winnerKey, reason) {
    gs.phase = 'ended';
    setActions('');
    const me = gs.players[myKey];
    const opp = gs.players[oppKey];
    const iWon = winnerKey === myKey;

    const box = document.createElement('div');
    box.style.cssText = 'background:#1a1a2e;border:2px solid #5c3d8c;border-radius:12px;padding:20px;max-width:400px;width:90%;max-height:80vh;overflow-y:auto;';
    box.innerHTML = `
      <div style="font-size:18px;font-weight:bold;color:${iWon ? '#40ff80' : '#ff4040'};text-align:center;margin-bottom:8px;">
        ${iWon ? '🏆 You Win!' : '💀 You Lose'}
      </div>
      <div style="font-size:13px;color:#888;text-align:center;margin-bottom:14px;">${esc(reason)}</div>
      ${buildForfeitList('A', me, opp, myKey)}
      ${buildForfeitList('B', opp, me, myKey)}
      <div style="text-align:center;margin-top:16px;">
        <button id="end-lobby">Back to Lobby</button>
      </div>
    `;
    showOverlay(box);
    box.querySelector('#end-lobby').addEventListener('click', () => {
      closeOverlay();
      navigate(`#/session/${state.sessionId}`);
    });
  }

  function buildForfeitList(key, player, other, myKey) {
    if (!player.forfeitLog.length) return `<div style="font-size:12px;color:#666;margin-bottom:8px;">${esc(player.name)}: no forfeits</div>`;
    return `<div style="margin-bottom:10px;">
      <div style="font-size:13px;font-weight:bold;color:${key === myKey ? '#4a9eff' : '#ff6b4a'};">${esc(player.name)} — Forfeits:</div>
      ${player.forfeitLog.map(f => `<div style="font-size:12px;color:#e8dfc8;padding:4px 0;border-bottom:1px solid #333;">• ${esc(f.text)}</div>`).join('')}
    </div>`;
  }

  // ── Game flow helpers ──────────────────────────────────────────────────
  function afterBattleEnded() {
    const bs = gs.battleState;
    gs.battleState = null;
    gs.phase = 'rolling';

    const win = checkWinCondition(gs);
    if (win) { showEndScreen(win.winner, win.reason); return; }

    const continueEvents = gs._battleContinuation;
    gs._battleContinuation = null;

    // Handle boss defeat / loss
    if (bs.type === 'boss') {
      if (bs.winner === 'wizard') {
        // Player loses to boss
        const victimKey = bs.playerKey;
        const winnerName = 'the Dark Wizard';
        gs.players[victimKey].stamina = 3; // wound penalty
        const forfeit = drawWizardSpell(gs, victimKey, winnerName);
        showForfeitOverlay(forfeit, () => {
          if (state.wiWinCondition !== 'normal') respawnWizard(gs);
          updateHud();
          drawBoard();
          proceedToRoll();
        });
        return;
      } else {
        // Player defeats wizard
        gs.wizard.defeated = true;
        gs.wizard._defeatedBy = bs.winner;
        if (state.wiWinCondition === 'normal') {
          // winner gets to assign a forfeit to opponent
          const oppVictimKey = bs.winner === 'A' ? 'B' : 'A';
          const forfeit = drawWizardSpell(gs, oppVictimKey, gs.players[bs.winner].name);
          showForfeitOverlay(forfeit, () => {
            const win2 = checkWinCondition(gs);
            if (win2) showEndScreen(win2.winner, win2.reason);
            else proceedToRoll();
          });
          return;
        } else {
          respawnWizard(gs);
        }
      }
    } else if (bs.type === 'pvp') {
      const loserKey = bs.winner === 'A' ? 'B' : 'A';
      gs.players[loserKey].stamina = Math.max(1, gs.players[loserKey].stamina);
    }

    updateHud();
    drawBoard();
    if (continueEvents) continueEvents();
    else proceedToRoll();
  }

  function proceedToRoll() {
    gs.phase = 'rolling';
    gs._myRollReady = false;
    updateHud();
    renderSpellHand();
    drawBoard();
    setStatus('Choose a spell or roll to move.');
    showRollButton();
  }

  // ── Socket handlers ────────────────────────────────────────────────────
  let activeBattleUI = null;

  const onRollGo = () => {
    gs._myRollReady = false;
    gs.phase = 'animating';
    setStatus('Rolling…');
    setActions('');

    // Deal fresh islands before resolving
    const events = resolveRolls(gs, rng);

    updateTokenTargets();
    animateTokens(() => {
      setStatus('');
      updateHud();
      drawBoard();
      processEvents(events, 0);
    });
  };

  function processEvents(events, idx) {
    if (idx >= events.length) {
      proceedToRoll();
      return;
    }
    const ev = events[idx];
    const next = () => processEvents(events, idx + 1);

    if (ev.type === 'moved') {
      const rollMe = myKey === 'A' ? ev.rollA : ev.rollB;
      const rollOpp = myKey === 'A' ? ev.rollB : ev.rollA;
      const fogMsg = ev.fogTurns > 0 ? ' (fog — rolls hidden)' : '';
      setStatus(`You rolled ${rollMe}. Opponent rolled ${ev.fogTurns > 0 ? '?' : rollOpp}.${fogMsg}`);
      next();
      return;
    }

    if (ev.type === 'wizard_battle') {
      const isMyBattle = ev.player === myKey;
      setStatus(isMyBattle ? '💀 The Dark Wizard attacks you!' : `💀 Dark Wizard attacks ${gs.players[ev.player].name}!`);
      if (gs.players[ev.player].cancelNextBattle) {
        gs.players[ev.player].cancelNextBattle = false;
        setStatus('Shield Ward deflected the wizard!');
        setTimeout(next, 1200);
        return;
      }
      gs._battleContinuation = next;
      activeBattleUI = showBattleOverlay('boss', ev.player);
      return;
    }

    if (ev.type === 'pvp_battle') {
      setStatus('⚔ You landed on the same island — battle!');
      if (gs.players[myKey].cancelNextBattle) {
        gs.players[myKey].cancelNextBattle = false;
        setStatus('Shield Ward deflected the battle!');
        setTimeout(next, 1200);
        return;
      }
      gs._battleContinuation = next;
      activeBattleUI = showBattleOverlay('pvp', myKey);
      return;
    }

    if (ev.type === 'island_card') {
      const result = revealIslandCard(gs, ev.player);
      if (result) {
        showCardOverlay(result, ev.player, next);
      } else {
        next();
      }
      return;
    }

    if (ev.type === 'cursed_forfeit') {
      if (ev.player === myKey) {
        const forfeit = drawWizardSpell(gs, myKey, 'the curse');
        showForfeitOverlay(forfeit, () => { updateHud(); next(); });
      } else {
        // Opponent handles their own forfeit ack; we just wait
        next();
      }
      return;
    }

    if (ev.type === 'island_sinks') {
      const sunkIdx = sinkRandomIsland(gs, rng);
      if (sunkIdx >= 0) setStatus(`Island ${sunkIdx + 1} (${ISLANDS[sunkIdx].name}) sinks into the sea!`);
      updateHud();
      drawBoard();
      setTimeout(next, 1500);
      return;
    }

    next();
  }

  const onBattleRollGo = () => {
    const bs = gs.battleState;
    if (!bs) return;
    bs.myRollReady = false;
    bs.oppRollReady = false;
    resolveBattleRound(gs, rng);
    if (activeBattleUI) activeBattleUI.updateBattleUI();
    updateHud();
    if (bs.ended) {
      setTimeout(() => {
        closeOverlay();
        activeBattleUI = null;
        afterBattleEnded();
      }, 1800);
    }
  };

  const onOppCardAck = () => {
    // Opponent finished their card screen — no action needed on our end
  };

  const onSpellPlay = (ev) => {
    const { spellId, targetIsland } = ev.detail;
    const target = targetIsland >= 0 ? targetIsland : null;
    const result = applySpell(gs, spellId, oppKey, target, rng);
    const idx = gs.players[oppKey].spells.findIndex(s => s.id === spellId);
    if (idx >= 0) gs.players[oppKey].spells.splice(idx, 1);
    if (result?.haptic && result.haptic.target === myKey && haptics.isConnected()) {
      haptics.pulse(result.haptic.intensity, result.haptic.duration);
    }
    if (result?.message) setStatus(`${gs.players[oppKey].name}: ${result.message}`);
    updateHud();
    renderSpellHand();
    drawBoard();
  };

  const onSpellDiscard = (ev) => {
    const { spellId } = ev.detail;
    const idx = gs.players[oppKey].spells.findIndex(s => s.id === spellId);
    if (idx >= 0) gs.players[oppKey].spells.splice(idx, 1);
    updateHud();
  };

  const onWildChoice = (ev) => {
    // Opponent chose a wild card type — already handled by both resolving from rng
    updateHud();
    drawBoard();
  };

  const onForfeitAck = () => {
    gs._oppForfeitAck = true;
    if (gs._forfeitAckCb) gs._forfeitAckCb();
  };

  const onHaptic = (ev) => {
    if (ev.detail.target === myKey && haptics.isConnected()) {
      haptics.pulse(ev.detail.intensity, ev.detail.duration);
    }
  };

  const onPeerLeft = () => {
    setStatus('Opponent disconnected.');
    setActions('<div style="color:#aaa;font-size:13px;">You win by default.</div>');
  };

  const onBattleRollReady = () => {
    const bs = gs.battleState;
    if (!bs) return;
    bs.oppRollReady = true;
    // For boss battles where we're the watcher, auto-echo so server can fire roll_go
    if (bs.type === 'boss' && bs.playerKey !== myKey) {
      socket.send({ type: MSG.WI_BATTLE_ROLL_READY });
    }
    if (activeBattleUI) activeBattleUI.updateBattleUI();
  };

  socket.addEventListener(MSG.WI_ROLL_GO, onRollGo);
  socket.addEventListener(MSG.WI_BATTLE_ROLL_GO, onBattleRollGo);
  socket.addEventListener(MSG.WI_OPP_CARD_ACK, onOppCardAck);
  socket.addEventListener(MSG.WI_SPELL_PLAY, onSpellPlay);
  socket.addEventListener(MSG.WI_SPELL_DISCARD, onSpellDiscard);
  socket.addEventListener(MSG.WI_WILD_CHOICE, onWildChoice);
  socket.addEventListener(MSG.WI_OPP_FORFEIT_ACK, onForfeitAck);
  socket.addEventListener(MSG.WI_HAPTIC, onHaptic);
  socket.addEventListener(MSG.WI_BATTLE_ROLL_READY, onBattleRollReady);
  socket.addEventListener(MSG.PEER_LEFT, onPeerLeft);

  const cleanup = () => {
    if (animFrame) cancelAnimationFrame(animFrame);
    window.removeEventListener('resize', resizeCanvas);
    socket.removeEventListener(MSG.WI_ROLL_GO, onRollGo);
    socket.removeEventListener(MSG.WI_BATTLE_ROLL_GO, onBattleRollGo);
    socket.removeEventListener(MSG.WI_OPP_CARD_ACK, onOppCardAck);
    socket.removeEventListener(MSG.WI_SPELL_PLAY, onSpellPlay);
    socket.removeEventListener(MSG.WI_SPELL_DISCARD, onSpellDiscard);
    socket.removeEventListener(MSG.WI_WILD_CHOICE, onWildChoice);
    socket.removeEventListener(MSG.WI_OPP_FORFEIT_ACK, onForfeitAck);
    socket.removeEventListener(MSG.WI_HAPTIC, onHaptic);
    socket.removeEventListener(MSG.WI_BATTLE_ROLL_READY, onBattleRollReady);
    socket.removeEventListener(MSG.PEER_LEFT, onPeerLeft);
  };
  window.addEventListener('hashchange', cleanup, { once: true });

  // ── Instructions overlay then start ───────────────────────────────────
  const instructBox = document.createElement('div');
  instructBox.style.cssText = 'background:#1a1a2e;border:1px solid #5c3d8c;border-radius:12px;padding:20px;text-align:center;max-width:320px;';
  instructBox.innerHTML = `
    <div style="font-size:16px;font-weight:bold;color:#c4a0e0;margin-bottom:8px;">⚔ Wizard Island</div>
    <div style="font-size:12px;color:#aaa;text-align:left;line-height:1.6;margin-bottom:14px;">
      🎲 Both players roll simultaneously to move around the islands.<br>
      📦 Land on an island to collect a face-down card.<br>
      ⚔ Land on the same island as your opponent → PvP battle.<br>
      💀 Land on the wizard's island → boss fight.<br>
      🔮 Collect spell cards and play them to gain advantages.<br>
      🏆 Win condition: <strong>${state.wiWinCondition}</strong>
    </div>
    <button id="wi-ready-btn">Ready!</button>
  `;
  showOverlay(instructBox);
  instructBox.querySelector('#wi-ready-btn').addEventListener('click', () => {
    closeOverlay();
    updateHud();
    renderSpellHand();
    drawBoard();
    proceedToRoll();
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function typeEmoji(type) {
  return { attack: '⚔', defence: '🛡', stamina: '❤', armour: '🧥', spell: '🔮' }[type] || '';
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
