import { state } from '../state.js';
import { socket } from '../net/socket.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import { bootEndurance } from '../game/bootEndurance.js';
import * as haptics from '../haptics.js';
import { initEdgeMode } from '../game/edgeMode.js';
import { showEdgeReadyOverlay } from '../game/edgeAssignment.js';
import { initVibeBattery } from '../vibeBattery.js';
import { initVibeModeBar } from '../vibeModeBar.js';

let currentGame = null;
let scoreThrottle = 0;
let edgeModeInstance = null;
let vibeBatteryInstance = null;
let vibeModeBarInstance = null;

export function renderEndurance(root) {
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

  function bootAndGo() {
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
          const scene = currentGame?.scene?.getScene('endurance');
          if (scene) scene.pauseScene();
          savedHaptics = haptics.pauseHaptics();
        },
        onResume: () => {
          const scene = currentGame?.scene?.getScene('endurance');
          if (scene) scene.resumeScene();
          haptics.resumeHaptics(savedHaptics);
        },
      });
    }
    _showEnduranceInstructions(state, bootAndGo);
  }

  if (state.edgeMode) {
    showEdgeReadyOverlay({ role: state.role, seed: state.seed, roundIndex: 0, onReady: _startEdgeAndInstructions });
  } else {
    _showEnduranceInstructions(state, bootAndGo);
  }

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
    if (edgeModeInstance) { edgeModeInstance.destroy(); edgeModeInstance = null; }
    if (vibeBatteryInstance) { vibeBatteryInstance.destroy(); vibeBatteryInstance = null; }
    if (vibeModeBarInstance) { vibeModeBarInstance.destroy(); vibeModeBarInstance = null; }
    if (currentGame) { currentGame.destroy(true); currentGame = null; }
    haptics.stopAll();
  }
}

function _showEnduranceInstructions(state, onReady) {
  const forfeitSecs = state.forfeitDuration ?? 30;
  const overlay = document.createElement('div');
  overlay.className = 'instructions-overlay';
  overlay.innerHTML = `
    <div class="instructions-box">
      <h2>Endurance</h2>
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
