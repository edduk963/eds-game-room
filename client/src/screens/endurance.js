import { state } from '../state.js';
import { socket } from '../net/socket.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import { bootEndurance } from '../game/bootEndurance.js';
import * as haptics from '../haptics.js';

let currentGame = null;
let scoreThrottle = 0;

export function renderEndurance(root) {
  root.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px;width:100%;">
      <div style="width:100%;max-width:640px;display:flex;">
        <button class="ghost" id="back-to-lobby" style="padding:6px 14px;font-size:13px;">← Lobby</button>
      </div>
      <div id="game-root"></div>
    </div>`;
  const host = root.querySelector('#game-root');

  root.querySelector('#back-to-lobby').addEventListener('click', () => {
    state.myFinal = null;
    state.oppFinal = null;
    state.seed = null;
    state.startAt = null;
    navigate(`#/session/${state.sessionId}`);
  });

  _showEnduranceInstructions(state);

  const myName = (state.role === 'host' ? state.hostName : state.guestName) || 'You';
  const opponentName = (state.role === 'host' ? state.guestName : state.hostName) || 'Opponent';

  let myVTime = 0;

  let prevScore = 0;
  const onScore = (value) => {
    const now = performance.now();
    prevScore = value;
    if (now - scoreThrottle < 80) return;
    scoreThrottle = now;
    socket.send({ type: MSG.SCORE, value });
  };

  const onShootVibe = (intensity, seconds) => haptics.addShootVibe(intensity, seconds);

  const onVibeOpponent = (seconds) => socket.send({ type: MSG.VIBE_ADD, seconds });

  const onVTimeAdd = (seconds) => { myVTime += seconds; };

  const onEnd = (finalScore) => {
    state.myFinal = finalScore;
    state.myVibeResidual = myVTime;
    socket.send({ type: MSG.FINAL, value: finalScore, vibeSeconds: myVTime });
    setTimeout(() => navigate('#/results'), 1500);
  };

  currentGame = bootEndurance({
    parent: host,
    seed: state.seed,
    startAt: state.startAt,
    myName,
    opponentName,
    onScore,
    onShootVibe,
    onVTimeAdd,
    onVibeOpponent,
    onShootVibeActive: () => haptics.isShootVibeActive(),
    onEnd,
  });

  let prevOppScore = 0;
  const onOppScore = (ev) => {
    const newScore = ev.detail.value;
    prevOppScore = newScore;
    const scene = currentGame?.scene?.getScene('endurance');
    if (scene?.setOpponentScore) scene.setOpponentScore(newScore);
  };

  const onOppVibeAdd = (ev) => haptics.addVibeSeconds(ev.detail.seconds);

  const onPeerLeft = () => {
    const scene = currentGame?.scene?.getScene('endurance');
    if (!scene) return;
    scene.opponentName = `${opponentName} (left)`;
    if (scene.setOpponentScore) scene.setOpponentScore(scene.oppScore || 0);
  };

  socket.addEventListener(MSG.OPP_SCORE, onOppScore);
  socket.addEventListener(MSG.PEER_LEFT, onPeerLeft);
  socket.addEventListener(MSG.VIBE_ADD, onOppVibeAdd);

  window.addEventListener('hashchange', cleanup, { once: true });

  function cleanup() {
    socket.removeEventListener(MSG.OPP_SCORE, onOppScore);
    socket.removeEventListener(MSG.PEER_LEFT, onPeerLeft);
    socket.removeEventListener(MSG.VIBE_ADD, onOppVibeAdd);
    if (currentGame) { currentGame.destroy(true); currentGame = null; }
    haptics.stopAll();
  }
}

function _showEnduranceInstructions(state) {
  const forfeitSecs = state.forfeitDuration ?? 30;
  const overlay = document.createElement('div');
  overlay.className = 'instructions-overlay';
  overlay.innerHTML = `
    <div class="instructions-box">
      <h2>Galactic Salvage Endurance</h2>
      <div class="instructions-section">
        <div class="instructions-heading">Goal</div>
        <ul class="instructions-list">
          <li>Destroy alien waves before they reach you. Highest score after 90 seconds wins.</li>
        </ul>
      </div>
      <div class="instructions-section">
        <div class="instructions-heading">Controls</div>
        <ul class="instructions-list">
          <li>← → or A / D — move left / right</li>
          <li>Space — shoot</li>
          <li><strong>V — convert 100pts into +10s forfeit bonus</strong> for the loser</li>
        </ul>
      </div>
      <div class="instructions-section">
        <div class="instructions-heading">Vibe</div>
        <ul class="instructions-list">
          <li>Each shot vibes you at 50% for 1s.</li>
          <li>Rapid fire stacks: +1s and +5% intensity per shot while vibe is active.</li>
          <li>Opponent pressing V sends you 5s at 100%.</li>
        </ul>
      </div>
      <p class="instructions-forfeit">Loser pays forfeit: <strong>${forfeitSecs}s</strong> vibe after the game.</p>
      <button id="inst-ready">Got it — I'm ready!</button>
      <p class="instructions-waiting" id="inst-timer"></p>
    </div>
  `;
  document.body.appendChild(overlay);

  const timerEl = overlay.querySelector('#inst-timer');
  const tick = () => {
    const secs = Math.max(0, Math.ceil((state.startAt - Date.now()) / 1000));
    if (timerEl) timerEl.textContent = secs > 0 ? `Game starts in ${secs}s` : 'Starting…';
    if (secs <= 0 && overlay.parentNode) overlay.remove();
  };
  tick();
  const iv = setInterval(() => { tick(); if (!overlay.parentNode) clearInterval(iv); }, 500);

  overlay.querySelector('#inst-ready').addEventListener('click', () => {
    clearInterval(iv);
    overlay.remove();
  });

  window.addEventListener('hashchange', () => { clearInterval(iv); overlay.remove(); }, { once: true });
}
