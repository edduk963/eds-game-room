import * as haptics from '../haptics.js';

// Mastermind-only Edge Mode: the round loser (or both players, on a no-solve round) edges at
// their own pace — indefinite vibe, no adjustable controls — before continuing. Distinct from
// the E-key/lives Edge Mode in edgeMode.js/edgeAssignment.js used by other games, which this
// does not touch. No network round-trip needed: the caller's onReady already routes into the
// existing MM_ROUND_READY / checkBothReady gate that syncs both players before the next round.
// Round-outcome messaging ("Winner is...", "Both players fail...") is the caller's job — this
// component is just the vibe (if any) plus a plain Continue button, identical on both sides.
export function renderEdgeGate({ containerEl, amLoser, onReady }) {
  const btn = document.createElement('button');
  btn.id = amLoser ? 'mm-edge-ready' : 'mm-continue';
  btn.className = 'mm-continue-btn';
  btn.textContent = 'Continue';

  if (!amLoser) {
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Waiting for opponent…';
      onReady();
    }, { once: true });
    containerEl.appendChild(btn);
    return;
  }

  haptics.startContinuousVibe(0.6);
  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Waiting for opponent…';
    haptics.stopContinuousVibe();
    onReady();
  }, { once: true });

  const wrap = document.createElement('div');
  wrap.className = 'mm-claim-section';
  wrap.innerHTML = `<div class="mm-waiting-text" style="margin:8px 0">Take your time. Continue whenever you're ready.</div>`;
  wrap.appendChild(btn);
  containerEl.appendChild(wrap);
}
