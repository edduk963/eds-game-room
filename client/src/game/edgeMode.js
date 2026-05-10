import { socket } from '../net/socket.js';
import { MSG } from '../shared/messages.js';

export function initEdgeMode({ role, myLives, onPause, onResume, containerEl }) {
  let myLivesLeft = myLives;
  let oppLivesLeft = myLives;
  let isPaused = false;
  let pauseQueue = [];
  let countdownInterval = null;
  let active = true;

  const livesBar = document.createElement('div');
  livesBar.className = 'edge-lives-bar';
  _updateLives();
  containerEl.prepend(livesBar);

  const countdownOverlay = document.createElement('div');
  countdownOverlay.className = 'edge-countdown-overlay';
  countdownOverlay.style.display = 'none';
  document.body.appendChild(countdownOverlay);

  function _hearts(n) {
    if (n <= 0) return '✗';
    return Array.from({ length: n }, () => '♥').join(' ');
  }

  function _updateLives() {
    livesBar.innerHTML =
      `<span class="edge-lives-you">E: ${_hearts(myLivesLeft)}</span>` +
      `<span class="edge-lives-opp">Opp E: ${_hearts(oppLivesLeft)}</span>`;
  }

  function _onKey(e) {
    if (!active) return;
    if (e.key !== 'e' && e.key !== 'E') return;
    if (myLivesLeft <= 0) return;
    myLivesLeft--;
    _updateLives();
    socket.send({ type: MSG.EDGE_PAUSE });
  }

  document.addEventListener('keydown', _onKey);

  function _onEdgePause(ev) {
    const { duration, byRole } = ev.detail;
    if (byRole !== role) {
      oppLivesLeft = Math.max(0, oppLivesLeft - 1);
      _updateLives();
    }
    if (isPaused) {
      pauseQueue.push(duration);
    } else {
      _startPause(duration);
    }
  }

  socket.addEventListener(MSG.EDGE_PAUSE, _onEdgePause);

  function _startPause(duration) {
    isPaused = true;
    onPause();

    if (duration === 0) {
      setTimeout(_endPause, 50);
      return;
    }

    let remaining = duration;
    countdownOverlay.style.display = 'flex';
    countdownOverlay.innerHTML = `
      <div class="edge-countdown-box">
        <div class="edge-countdown-num">${remaining}</div>
        <div class="edge-countdown-label">Edge pause</div>
      </div>`;

    countdownInterval = setInterval(() => {
      remaining--;
      const numEl = countdownOverlay.querySelector('.edge-countdown-num');
      if (numEl) numEl.textContent = remaining;
      if (remaining <= 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        countdownOverlay.style.display = 'none';
        _endPause();
      }
    }, 1000);
  }

  function _endPause() {
    isPaused = false;
    onResume();
    if (pauseQueue.length > 0) _startPause(pauseQueue.shift());
  }

  function destroy() {
    active = false;
    document.removeEventListener('keydown', _onKey);
    socket.removeEventListener(MSG.EDGE_PAUSE, _onEdgePause);
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    livesBar.remove();
    countdownOverlay.remove();
    if (isPaused) onResume();
  }

  return { destroy };
}
