import { socket } from './net/socket.js';
import { MSG } from './shared/messages.js';
import { getBattery } from './haptics.js';

export function initVibeBattery(containerEl) {
  let myLevel = null;
  let oppLevel = null;
  let pollInterval = null;

  const bar = document.createElement('div');
  bar.className = 'vibe-battery-bar';
  containerEl.prepend(bar);

  function _render() {
    const myText  = myLevel  !== null ? `${myLevel}%`  : '--';
    const oppText = oppLevel !== null ? `${oppLevel}%` : '--';
    bar.innerHTML =
      `<span class="vbb-label">🔋</span>` +
      `<span class="vbb-you">You: ${myText}</span>` +
      `<span class="vbb-sep">|</span>` +
      `<span class="vbb-opp">Opp: ${oppText}</span>`;
  }

  async function _poll() {
    const level = await getBattery();
    if (level !== myLevel) {
      myLevel = level;
      _render();
      if (level !== null) socket.send({ type: MSG.VIBE_BATTERY, level });
    }
  }

  function _onOppBattery(ev) {
    oppLevel = ev.detail.level;
    _render();
  }

  socket.addEventListener(MSG.OPP_VIBE_BATTERY, _onOppBattery);

  _render();
  _poll();
  pollInterval = setInterval(_poll, 30_000);

  return {
    destroy() {
      if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
      socket.removeEventListener(MSG.OPP_VIBE_BATTERY, _onOppBattery);
      bar.remove();
    },
  };
}
