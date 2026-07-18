import { state } from '../state.js';
import { socket } from '../net/socket.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import { bootTugOfWar } from '../game/bootTugOfWar.js';
import * as haptics from '../haptics.js';
import { initEdgeMode } from '../game/edgeMode.js';
import { showEdgeReadyOverlay } from '../game/edgeAssignment.js';
import { initVibeBattery } from '../vibeBattery.js';
import { initVibeModeBar } from '../vibeModeBar.js';

let currentGame = null;
let scoreThrottle = 0;
let vibeLoopInterval = null;
let edgeModeInstance = null;
let vibeBatteryInstance = null;
let vibeModeBarInstance = null;

function computeVibeIntensity(myScore, oppScore) {
  if (!state.startAt) return 0;
  const elapsed = Math.max(0, Date.now() - state.startAt);
  const poolSteps = Math.floor(elapsed / 10_000);
  const totalPool = Math.min(1.0, 0.20 + poolSteps * 0.10);
  const denom = Math.max(Math.abs(myScore) + Math.abs(oppScore), 1);
  const myShare = Math.max(0, Math.min(1, 0.5 + (oppScore - myScore) / (2 * denom)));
  return myShare * totalPool;
}

function startVibeLoop() {
  if (vibeLoopInterval) return;
  vibeLoopInterval = setInterval(() => {
    const scene = currentGame?.scene?.getScene('tugofwar');
    if (!scene || scene.gameOver || !scene.gameStarted) return;
    haptics.testVibe(computeVibeIntensity(scene.score, scene.oppScore));
  }, 200);
}

function stopVibeLoop() {
  if (vibeLoopInterval) { clearInterval(vibeLoopInterval); vibeLoopInterval = null; }
  haptics.testVibe(0);
}

export function renderTugOfWar(root) {
  root.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px;width:100%;">
      <div style="width:100%;max-width:640px;display:flex;">
        <button class="ghost" id="back-to-lobby" style="padding:6px 14px;font-size:13px;">← Lobby</button>
      </div>
      <div id="game-root"></div>
    </div>`;
  const host = root.querySelector('#game-root');
  vibeBatteryInstance = initVibeBattery(root);
  vibeModeBarInstance = initVibeModeBar(root);

  root.querySelector('#back-to-lobby').addEventListener('click', () => {
    state.myFinal = null;
    state.oppFinal = null;
    state.seed = null;
    state.startAt = null;
    navigate(`#/session/${state.sessionId}`);
  });

  const myName = (state.role === 'host' ? state.hostName : state.guestName) || 'You';
  const opponentName = (state.role === 'host' ? state.guestName : state.hostName) || 'Opponent';

  let prevScore = 0;
  const onScore = (value) => {
    prevScore = value;
    const now = performance.now();
    if (now - scoreThrottle < 80) return;
    scoreThrottle = now;
    socket.send({ type: MSG.SCORE, value });
  };

  const onGameStarted = () => startVibeLoop();

  const onEnd = (finalScore) => {
    stopVibeLoop();
    state.myFinal = finalScore;
    state.myVibeResidual = 0;
    socket.send({ type: MSG.FINAL, value: finalScore, vibeSeconds: 0 });
    setTimeout(() => navigate('#/results'), 1500);
  };

  function bootAndGo() {
    currentGame = bootTugOfWar({
      parent: host,
      seed: state.seed,
      startAt: state.startAt,
      myName,
      opponentName,
      onScore,
      onGameStarted,
      onEnd,
    });
  }

  function _startEdgeAndInstructions(assignment) {
    if (state.edgeMode) {
      let savedHaptics = null;
      edgeModeInstance = initEdgeMode({
        role: state.role,
        myLives: state.edgeLives,
        assignment,
        containerEl: root,
        onPause: () => {
          const scene = currentGame?.scene?.getScene('tugofwar');
          if (scene) scene.pauseScene();
          stopVibeLoop();
          savedHaptics = haptics.pauseHaptics();
        },
        onResume: () => {
          const scene = currentGame?.scene?.getScene('tugofwar');
          if (scene) scene.resumeScene();
          haptics.resumeHaptics(savedHaptics);
          startVibeLoop();
        },
      });
    }
    _showTugOfWarInstructions(state, bootAndGo);
  }

  if (state.edgeMode) {
    showEdgeReadyOverlay({ role: state.role, seed: state.seed, roundIndex: 0, onReady: _startEdgeAndInstructions });
  } else {
    _showTugOfWarInstructions(state, bootAndGo);
  }

  const onOppScore = (ev) => {
    const newScore = ev.detail.value;
    const scene = currentGame?.scene?.getScene('tugofwar');
    if (scene?.setOpponentScore) scene.setOpponentScore(newScore);
  };

  const onPeerLeft = () => {
    const scene = currentGame?.scene?.getScene('tugofwar');
    if (!scene) return;
    scene.opponentName = `${opponentName} (left)`;
    if (scene.setOpponentScore) scene.setOpponentScore(scene.oppScore || 0);
  };

  socket.addEventListener(MSG.OPP_SCORE, onOppScore);
  socket.addEventListener(MSG.PEER_LEFT, onPeerLeft);

  window.addEventListener('hashchange', cleanup, { once: true });

  function cleanup() {
    socket.removeEventListener(MSG.OPP_SCORE, onOppScore);
    socket.removeEventListener(MSG.PEER_LEFT, onPeerLeft);
    if (edgeModeInstance) { edgeModeInstance.destroy(); edgeModeInstance = null; }
    if (vibeBatteryInstance) { vibeBatteryInstance.destroy(); vibeBatteryInstance = null; }
    if (vibeModeBarInstance) { vibeModeBarInstance.destroy(); vibeModeBarInstance = null; }
    stopVibeLoop();
    if (currentGame) { currentGame.destroy(true); currentGame = null; }
    haptics.stopAll();
  }
}

function _showTugOfWarInstructions(state, onReady) {
  const forfeitSecs = state.forfeitDuration ?? 30;
  const overlay = document.createElement('div');
  overlay.className = 'instructions-overlay';
  overlay.innerHTML = `
    <div class="instructions-box">
      <h2>Tug of War</h2>
      <div class="instructions-section">
        <div class="instructions-heading">Goal</div>
        <ul class="instructions-list">
          <li>Shoot invaders to score. Highest score after 90 seconds wins.</li>
          <li>Avoid debris and civilians — hitting them costs points (and can go negative!).</li>
        </ul>
      </div>
      <div class="instructions-section">
        <div class="instructions-heading">Controls</div>
        <ul class="instructions-list">
          <li>← → or A / D — move left / right</li>
          <li>Space — shoot</li>
        </ul>
      </div>
      <div class="instructions-section">
        <div class="instructions-heading">Vibe</div>
        <ul class="instructions-list">
          <li>Both devices vibrate continuously the entire round.</li>
          <li>Starts at 10% intensity each. Every 10 seconds the total pool grows by 10% (up to 100%).</li>
          <li>The losing player (lower score) gets a bigger share of the vibe — fall behind and you feel it.</li>
        </ul>
      </div>
      <p class="instructions-forfeit">Loser pays forfeit: <strong>${forfeitSecs}s</strong> vibe after the game.</p>
      <button id="inst-ready">Got it — I'm ready!</button>
      <p class="instructions-waiting" id="inst-wait" style="visibility:hidden">Waiting for opponent…</p>
    </div>
  `;
  document.body.appendChild(overlay);

  const readyBtn = overlay.querySelector('#inst-ready');
  const waitEl = overlay.querySelector('#inst-wait');
  let settled = false;

  function proceed(startAt) {
    if (settled) return;
    settled = true;
    state.startAt = startAt;
    socket.removeEventListener(MSG.INST_GO, onGo);
    overlay.remove();
    onReady();
  }

  const onGo = (ev) => proceed(ev.detail.startAt);
  socket.addEventListener(MSG.INST_GO, onGo);

  readyBtn.addEventListener('click', () => {
    readyBtn.disabled = true;
    waitEl.style.visibility = 'visible';
    socket.send({ type: MSG.INST_READY });
  });

  window.addEventListener('hashchange', () => {
    settled = true;
    socket.removeEventListener(MSG.INST_GO, onGo);
    overlay.remove();
  }, { once: true });
}
