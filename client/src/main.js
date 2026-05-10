import './style.css';
import { socket } from './net/socket.js';
import { state, reset } from './state.js';
import { renderLanding } from './screens/landing.js';
import { renderLobby } from './screens/lobby.js';
import { renderGame } from './screens/game.js';
import { renderResults } from './screens/results.js';
import { renderMastermind } from './screens/mastermind.js';
import { renderEndurance } from './screens/endurance.js';
import { renderTugOfWar } from './screens/tugofwar.js';

const app = document.getElementById('app');

export function navigate(hash) {
  if (location.hash !== hash) {
    location.hash = hash;
  } else {
    route();
  }
}

function route() {
  const hash = location.hash || '#/';
  app.innerHTML = '';

  if (hash === '#/' || hash === '') {
    reset();
    socket.close();
    renderLanding(app);
    return;
  }

  const lobbyMatch = hash.match(/^#\/session\/([A-Z0-9]+)$/);
  if (lobbyMatch) {
    state.sessionId = lobbyMatch[1];
    renderLobby(app);
    return;
  }

  if (hash === '#/game') {
    if (!state.seed) { navigate('#/'); return; }
    renderGame(app);
    return;
  }

  if (hash === '#/mastermind') {
    if (!state.seed) { navigate('#/'); return; }
    renderMastermind(app);
    return;
  }

  if (hash === '#/endurance') {
    if (!state.seed) { navigate('#/'); return; }
    renderEndurance(app);
    return;
  }

  if (hash === '#/tugofwar') {
    if (!state.seed) { navigate('#/'); return; }
    renderTugOfWar(app);
    return;
  }

  if (hash === '#/results') {
    renderResults(app);
    return;
  }

  navigate('#/');
}

window.addEventListener('hashchange', route);

socket.addEventListener('opp_final', (ev) => {
  state.oppFinal = ev.detail.value;
  state.oppVibeResidual = ev.detail.vibeSeconds || 0;
  window.dispatchEvent(new CustomEvent('opp-final-landed'));
});

socket.addEventListener('begin', (ev) => {
  state.seed = ev.detail.seed;
  state.startAt = ev.detail.startAt;
  state.gameType = ev.detail.gameType || 'galactic';
  state.gameRounds = ev.detail.rounds || 3;
  state.gameMode = ev.detail.mode || 'easy';
  state.forfeitDuration = ev.detail.forfeitDuration || 30;
  const gt = state.gameType;
  navigate(gt === 'mastermind' ? '#/mastermind' : gt === 'endurance' ? '#/endurance' : gt === 'tugofwar' ? '#/tugofwar' : '#/game');
});

route();
