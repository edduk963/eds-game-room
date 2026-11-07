import { socket } from './net/socket.js';
import { MSG } from './shared/messages.js';
import * as haptics from './haptics.js';

// Global "Hard Stop" button. Lives on document.body (outside #app, which the router
// wipes on every navigation), so it's on every screen and still works when a game's
// own state is stuck. One press:
//   1. kills this device now and blocks new vibrate commands for a moment,
//   2. tells every other client in the session to do the same (MSG.VIBE_PANIC),
//   3. fires a 'vibe-panic' window event so the current screen can clear its banners
//      and timers and carry on.
// Shortcut: press Escape twice quickly.

function triggerLocal() {
  haptics.panicStop();
  window.dispatchEvent(new CustomEvent('vibe-panic'));
}

export function hardStop() {
  triggerLocal();
  // Only send on a live connection; socket.send() would otherwise queue the panic and
  // fire it on the next reconnect, stopping someone's vibe out of nowhere.
  if (socket.ws?.readyState === 1) socket.send({ type: MSG.VIBE_PANIC });
  flash();
}

let btn = null;
function flash() {
  if (!btn) return;
  btn.classList.add('hs-fired');
  btn.textContent = 'STOPPED';
  clearTimeout(btn.__t);
  btn.__t = setTimeout(() => { btn.classList.remove('hs-fired'); btn.textContent = '■ STOP'; }, 1500);
}

export function initHardStop() {
  if (btn) return;
  const style = document.createElement('style');
  style.textContent = `
    .hs-btn{position:fixed;right:14px;bottom:14px;z-index:99999;padding:10px 16px;border:2px solid #fff;
      border-radius:999px;background:#dc2626;color:#fff;font:800 14px/1 system-ui,sans-serif;letter-spacing:.06em;
      cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.45);user-select:none;touch-action:manipulation}
    .hs-btn:hover{background:#b91c1c}
    .hs-btn:active{transform:scale(.96)}
    .hs-btn.hs-live{animation:hs-pulse 1.2s ease-in-out infinite}
    .hs-btn.hs-fired{background:#16a34a;animation:none}
    @keyframes hs-pulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.7)}50%{box-shadow:0 0 0 10px rgba(220,38,38,0)}}`;
  document.head.appendChild(style);

  btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hs-btn';
  btn.title = 'Hard stop — stops every vibe in the session (Esc Esc)';
  btn.textContent = '■ STOP';
  // pointerdown rather than click so it fires even if something steals the mouseup
  btn.addEventListener('pointerdown', ev => { ev.preventDefault(); hardStop(); });
  btn.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); hardStop(); } });
  document.body.appendChild(btn);

  let lastEsc = 0;
  window.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    const now = performance.now();
    if (now - lastEsc < 600) { lastEsc = 0; hardStop(); } else lastEsc = now;
  });

  // Another player pressed it — stop here too (no re-broadcast).
  socket.addEventListener(MSG.VIBE_PANIC, () => { triggerLocal(); flash(); });

  // Pulse the button while this device is vibing, so it's easy to find.
  setInterval(() => {
    if (!btn.classList.contains('hs-fired')) btn.classList.toggle('hs-live', haptics.isAnyVibeActive());
  }, 500);
}
