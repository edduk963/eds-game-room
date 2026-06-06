import { navigate } from '../main.js';

const PALETTE = [
  '#5cffd4', '#ff5577', '#ffcc44', '#7b7fff', '#ff9f43',
  '#26de81', '#fc5c65', '#45aaf2', '#fd9644', '#a55eea',
  '#2bcbba', '#eb3b5a', '#f7b731', '#3867d6', '#20bf6b',
];

const STORAGE_KEY = 'wheel_forfeits';

function loadForfeits() {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}

function saveForfeits(text) {
  try { localStorage.setItem(STORAGE_KEY, text); } catch {}
}

export function renderWheel(root) {
  root.innerHTML = `
    <div class="wheel-root">
      <div class="wheel-left">
        <div class="wheel-canvas-wrap">
          <canvas id="wheel-canvas" width="420" height="420"></canvas>
          <div class="wheel-pointer">▼</div>
        </div>
        <button id="wheel-spin-btn" class="wheel-spin-btn">SPIN</button>
        <div id="wheel-result" class="wheel-result" style="display:none"></div>
      </div>
      <div class="wheel-right">
        <div class="wheel-panel-header">
          <button class="ghost" id="wheel-leave" style="padding:6px 14px;font-size:13px;">← Back</button>
          <h2 style="margin:0;">Spin the Wheel</h2>
        </div>
        <label for="wheel-textarea">Forfeits (one per line)</label>
        <textarea id="wheel-textarea" class="wheel-textarea" placeholder="Enter one forfeit per line&#10;e.g. Take a drink&#10;Do 10 push-ups&#10;Truth or dare">${loadForfeits()}</textarea>
        <div id="wheel-count" class="wheel-count"></div>
      </div>
    </div>
  `;

  const canvas = root.querySelector('#wheel-canvas');
  const ctx = canvas.getContext('2d');
  const textarea = root.querySelector('#wheel-textarea');
  const spinBtn = root.querySelector('#wheel-spin-btn');
  const resultEl = root.querySelector('#wheel-result');
  const countEl = root.querySelector('#wheel-count');

  let spinning = false;
  let currentAngle = 0;
  let animFrame = null;

  function getItems() {
    return textarea.value.split('\n').map(s => s.trim()).filter(Boolean);
  }

  function drawWheel(angle) {
    const items = getItems();
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const r = cx - 8;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (items.length === 0) {
      ctx.save();
      ctx.fillStyle = '#1e2a45';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8794b8';
      ctx.font = '16px Segoe UI, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Add forfeits on the right →', cx, cy);
      ctx.restore();
      return;
    }

    const slice = (Math.PI * 2) / items.length;

    items.forEach((item, i) => {
      const start = angle + i * slice;
      const end = start + slice;
      const color = PALETTE[i % PALETTE.length];

      // Segment
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, end);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#0a0e1a';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Text
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(start + slice / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0a0e1a';
      ctx.font = `bold ${items.length > 10 ? 11 : 13}px Segoe UI, system-ui, sans-serif`;
      const maxLen = 22;
      const label = item.length > maxLen ? item.slice(0, maxLen - 1) + '…' : item;
      ctx.fillText(label, r - 10, 0);
      ctx.restore();
    });

    // Center cap
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0e1a';
    ctx.fill();
    ctx.strokeStyle = '#25304d';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function easeOut(t) {
    return 1 - Math.pow(1 - t, 4);
  }

  function spin() {
    const items = getItems();
    if (items.length < 2) return;
    spinning = true;
    spinBtn.disabled = true;
    resultEl.style.display = 'none';

    const extraSpins = 6 + Math.random() * 4;
    const targetOffset = Math.random() * Math.PI * 2;
    const totalRotation = extraSpins * Math.PI * 2 + targetOffset;
    const duration = 3500 + Math.random() * 1000;
    const startAngle = currentAngle;
    const startTime = performance.now();

    function frame(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = easeOut(t);
      currentAngle = startAngle + totalRotation * eased;
      drawWheel(currentAngle);

      if (t < 1) {
        animFrame = requestAnimationFrame(frame);
      } else {
        currentAngle = startAngle + totalRotation;
        drawWheel(currentAngle);
        spinning = false;
        spinBtn.disabled = false;
        showResult(currentAngle, items);
      }
    }

    animFrame = requestAnimationFrame(frame);
  }

  function showResult(angle, items) {
    // Pointer is at the top (angle = -PI/2 from canvas perspective, but we
    // draw from angle 0 = right. Pointer sits at top = -PI/2 in standard coords).
    // The winning segment is the one under the top pointer (12 o'clock).
    const slice = (Math.PI * 2) / items.length;
    // Normalize angle so 0 = right; top = -PI/2 → adjust
    const pointer = -Math.PI / 2;
    // Which segment index is at pointer position?
    let normalised = ((pointer - angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const idx = Math.floor(normalised / slice) % items.length;
    const winner = items[idx];

    resultEl.style.display = '';
    resultEl.innerHTML = `<span class="wheel-result-label">🎯 ${escapeHtml(winner)}</span>`;
    resultEl.style.borderColor = PALETTE[idx % PALETTE.length];
  }

  // Redraw on textarea change
  textarea.addEventListener('input', () => {
    saveForfeits(textarea.value);
    const items = getItems();
    countEl.textContent = items.length === 0 ? '' : `${items.length} item${items.length !== 1 ? 's' : ''}`;
    spinBtn.disabled = items.length < 2;
    drawWheel(currentAngle);
  });

  spinBtn.addEventListener('click', () => { if (!spinning) spin(); });

  root.querySelector('#wheel-leave').addEventListener('click', () => navigate('#/'));

  window.addEventListener('hashchange', () => {
    if (animFrame) cancelAnimationFrame(animFrame);
  }, { once: true });

  // Initial draw
  const initialItems = getItems();
  countEl.textContent = initialItems.length === 0 ? '' : `${initialItems.length} item${initialItems.length !== 1 ? 's' : ''}`;
  spinBtn.disabled = initialItems.length < 2;
  drawWheel(currentAngle);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
