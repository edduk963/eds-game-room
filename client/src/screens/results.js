import { state, reset } from '../state.js';
import { socket } from '../net/socket.js';
import { navigate } from '../main.js';
import { MSG } from '../shared/messages.js';
import * as haptics from '../haptics.js';
import { initVibeModeBar } from '../vibeModeBar.js';

export function renderResults(root) {
  const me = state.myFinal ?? 0;
  const opp = state.oppFinal;
  const myName = (state.role === 'host' ? state.hostName : state.guestName) || 'You';
  const oppName = (state.role === 'host' ? state.guestName : state.hostName) || 'Opponent';

  let banner = 'Waiting for opponent…';
  let myWin = false, oppWin = false;
  let iAmLoser = false;
  if (opp != null) {
    if (me > opp)      { banner = `${escapeHtml(myName)} wins!`;  myWin = true;  haptics.winPattern(); }
    else if (opp > me) { banner = `${escapeHtml(oppName)} wins!`; oppWin = true; haptics.losePattern(); iAmLoser = true; }
    else               { banner = "It's a tie — you both pay forfeit!"; haptics.losePattern(); }
  }

  const forfeitSecs      = state.forfeitDuration ?? 30;
  const resultKnown      = opp != null;
  const isTie            = resultKnown && me === opp;
  const bothVTime        = (state.myVibeResidual || 0) + (state.oppVibeResidual || 0);
  // On a tie both players forfeit for base + combined V-time; otherwise only the loser forfeits
  const myTotalDuration  = isTie ? forfeitSecs + bothVTime
                         : iAmLoser ? forfeitSecs + (state.oppVibeResidual || 0) : 0;
  const oppTotalDuration = isTie ? forfeitSecs + bothVTime
                         : (!iAmLoser && resultKnown) ? forfeitSecs + (state.myVibeResidual || 0) : 0;
  const hasForfeit       = resultKnown && (myTotalDuration > 0 || oppTotalDuration > 0);

  root.innerHTML = `
    <div class="card">
      <h1>Game over</h1>
      <div class="banner" id="banner">${banner}</div>
      <div class="scoreboard">
        <div class="score-cell ${myWin ? 'winner' : ''}">
          <div class="name">${escapeHtml(myName)}</div>
          <div class="value">${me}</div>
        </div>
        <div class="score-cell ${oppWin ? 'winner' : ''}">
          <div class="name">${escapeHtml(oppName)}</div>
          <div class="value">${opp == null ? '—' : opp}</div>
        </div>
      </div>

      ${hasForfeit ? `
      <div class="forfeit-panel">
        <div class="forfeit-heading">Forfeit vibe
          ${isTie && bothVTime > 0
            ? ` — <strong>${forfeitSecs}s</strong> base + <strong>${bothVTime}s</strong> combined V-bonus`
            : myTotalDuration > 0 && iAmLoser && (state.oppVibeResidual || 0) > 0
              ? ` — <strong>${forfeitSecs}s</strong> base + <strong>${state.oppVibeResidual}s</strong> V-bonus`
              : !iAmLoser && (state.myVibeResidual || 0) > 0
                ? ` — <strong>${forfeitSecs}s</strong> base + <strong>${state.myVibeResidual}s</strong> V-bonus`
                : ` — <strong>${forfeitSecs}s</strong>`}
        </div>
        <div class="forfeit-players">
          <div class="forfeit-cell ${iAmLoser || isTie ? 'forfeit-cell-active' : ''}" id="my-forfeit-cell">
            <div class="forfeit-cell-name">${escapeHtml(myName)}</div>
            <div class="forfeit-cell-time" id="my-vibe-time">${myTotalDuration > 0 ? myTotalDuration + 's' : '—'}</div>
            <div class="forfeit-bar-wrap"><div class="forfeit-bar" id="my-vibe-bar"></div></div>
            <div class="forfeit-cell-status">${iAmLoser || isTie ? 'forfeit' : 'watching'}</div>
          </div>
          <div class="forfeit-cell ${!iAmLoser && resultKnown ? 'forfeit-cell-active' : ''}" id="opp-forfeit-cell">
            <div class="forfeit-cell-name">${escapeHtml(oppName)}</div>
            <div class="forfeit-cell-time" id="opp-vibe-time">${oppTotalDuration > 0 ? oppTotalDuration + 's' : '—'}</div>
            <div class="forfeit-bar-wrap"><div class="forfeit-bar" id="opp-vibe-bar"></div></div>
            <div class="forfeit-cell-status">${!iAmLoser && resultKnown ? 'forfeit' : 'watching'}</div>
          </div>
        </div>
        <div class="forfeit-slider-row">
          <span>Intensity</span>
          <input type="range" id="forfeit-slider" min="0" max="100" value="100" style="flex:1;margin:0 12px;">
          <span id="forfeit-pct">100%</span>
        </div>
        <div class="forfeit-controls" style="display:flex;justify-content:center;margin-top:12px;">
          <button id="forfeit-toggle-btn" style="min-width:100px;">Start</button>
        </div>
      </div>` : ''}

      <div class="actions">
        <button class="ghost" id="home">Home</button>
        <button id="again">Back to lobby</button>
      </div>
    </div>
  `;

  const vibeModeBarInstance = initVibeModeBar(root.querySelector('.card'));

  // If opp final not yet received, wait for the global listener's window event
  const onOppLanded = () => { vibeModeBarInstance.destroy(); renderResults(root); };
  if (state.oppFinal == null) {
    window.addEventListener('opp-final-landed', onOppLanded, { once: true });
  }

  // Forfeit vibe logic
  if (hasForfeit) {
    const myVibeEl   = root.querySelector('#my-vibe-time');
    const oppVibeEl  = root.querySelector('#opp-vibe-time');
    const myBar      = root.querySelector('#my-vibe-bar');
    const oppBar     = root.querySelector('#opp-vibe-bar');
    const slider     = root.querySelector('#forfeit-slider');
    const pctEl      = root.querySelector('#forfeit-pct');
    const toggleBtn  = root.querySelector('#forfeit-toggle-btn');

    let running = false;
    let myRemaining = myTotalDuration;
    let myElapsedBase = 0;
    let myRunStartTime = null;
    let oppRemaining = oppTotalDuration;
    let oppElapsedBase = 0;
    let oppRunStartTime = null;

    function applyToggle(nowRunning, fromRemote) {
      if (running === nowRunning) return;
      running = nowRunning;
      toggleBtn.textContent = running ? 'Stop' : 'Start';
      const now = Date.now();
      if (running) {
        if ((iAmLoser || isTie) && myRemaining > 0) {
          myRunStartTime = now;
          haptics.startForfeitVibe(myRemaining);
        }
        if (oppTotalDuration > 0) oppRunStartTime = now;
      } else {
        if (iAmLoser || isTie) {
          if (myRunStartTime != null) {
            myElapsedBase += (now - myRunStartTime) / 1000;
            myRunStartTime = null;
          }
          myRemaining = Math.max(0, myTotalDuration - myElapsedBase);
          haptics.pauseForfeitVibe();
        }
        if (oppRunStartTime != null) {
          oppElapsedBase += (now - oppRunStartTime) / 1000;
          oppRunStartTime = null;
        }
      }
      if (!fromRemote) socket.send({ type: MSG.FORFEIT_TOGGLE, running });
    }

    toggleBtn.addEventListener('click', () => applyToggle(!running, false));

    const timerTick = setInterval(() => {
      const now = Date.now();
      if (running) {
        if ((iAmLoser || isTie) && myRunStartTime != null) {
          myRemaining = Math.max(0, myTotalDuration - myElapsedBase - (now - myRunStartTime) / 1000);
        }
        if (oppRunStartTime != null) {
          oppRemaining = Math.max(0, oppTotalDuration - oppElapsedBase - (now - oppRunStartTime) / 1000);
        }
      }

      if (myVibeEl) myVibeEl.textContent = myTotalDuration > 0
        ? (myRemaining > 0 ? `${Math.ceil(myRemaining)}s` : 'Done')
        : '—';
      if (oppVibeEl) oppVibeEl.textContent = oppTotalDuration > 0
        ? (oppRemaining > 0 ? `${Math.ceil(oppRemaining)}s` : 'Done')
        : '—';

      if (myBar)  myBar.style.width  = myTotalDuration  > 0 ? `${(myRemaining  / myTotalDuration)  * 100}%` : '0%';
      if (oppBar) oppBar.style.width = oppTotalDuration > 0 ? `${(oppRemaining / oppTotalDuration) * 100}%` : '0%';
    }, 100);

    slider.addEventListener('input', () => {
      const level = slider.value / 100;
      pctEl.textContent = `${slider.value}%`;
      haptics.setForfeitIntensity(level);
      socket.send({ type: MSG.FORFEIT_INTENSITY, level });
    });

    const onForfeitIntensity = (ev) => {
      const level = ev.detail.level;
      slider.value = Math.round(level * 100);
      pctEl.textContent = `${slider.value}%`;
      haptics.setForfeitIntensity(level);
    };

    const onForfeitToggle = (ev) => {
      applyToggle(!!ev.detail.running, true);
    };

    socket.addEventListener(MSG.FORFEIT_INTENSITY, onForfeitIntensity);
    socket.addEventListener(MSG.FORFEIT_TOGGLE, onForfeitToggle);

    const cleanupForfeit = () => {
      clearInterval(timerTick);
      socket.removeEventListener(MSG.FORFEIT_INTENSITY, onForfeitIntensity);
      socket.removeEventListener(MSG.FORFEIT_TOGGLE, onForfeitToggle);
      haptics.stopAll();
    };
    window.addEventListener('hashchange', cleanupForfeit, { once: true });
  }

  const cleanupNav = () => {
    window.removeEventListener('opp-final-landed', onOppLanded);
    vibeModeBarInstance.destroy();
  };
  window.addEventListener('hashchange', cleanupNav, { once: true });

  root.querySelector('#again').addEventListener('click', () => {
    state.myFinal = null;
    state.oppFinal = null;
    state.seed = null;
    navigate(`#/session/${state.sessionId}`);
  });

  root.querySelector('#home').addEventListener('click', () => {
    socket.close();
    reset();
    navigate('#/');
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
