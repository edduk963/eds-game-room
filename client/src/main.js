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
import { renderDice } from './screens/dice.js';
import { renderHilo } from './screens/hilo.js';
import { renderSplitLoot } from './screens/splitloot.js';
import { renderWizardIsland } from './screens/wizardisland.js';
import { renderBeatDealer } from './screens/beatdealer.js';
import { renderStandoff } from './screens/standoff.js';

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

  if (hash === '#/dice') {
    renderDice(app);
    return;
  }

  if (hash === '#/hilo') {
    if (!state.seed) { navigate('#/'); return; }
    renderHilo(app);
    return;
  }

  if (hash === '#/splitloot') {
    if (!state.seed) { navigate('#/'); return; }
    renderSplitLoot(app);
    return;
  }

  if (hash === '#/wizardisland') {
    if (!state.seed) { navigate('#/'); return; }
    renderWizardIsland(app);
    return;
  }

  if (hash === '#/beatdealer') {
    if (!state.seed) { navigate('#/'); return; }
    renderBeatDealer(app);
    return;
  }

  if (hash === '#/standoff') {
    if (!state.seed) { navigate('#/'); return; }
    renderStandoff(app);
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
  state.edgeMode = !!ev.detail.edgeMode;
  state.edgeLives = ev.detail.edgeLives || 3;
  state.hiloMode = ev.detail.hiloMode || 'submission';
  state.hiloCycles = ev.detail.hiloCycles ?? 1;
  state.hiloDeckSize = ev.detail.hiloDeckSize ?? 1;
  state.hiloVibeRamp = ev.detail.hiloVibeRamp || 10;
  state.hiloLives = ev.detail.hiloLives || 3;
  state.hiloVibeTarget = ev.detail.hiloVibeTarget || 'both';
  state.playerCount = ev.detail.playerCount || 2;
  if (ev.detail.guest2Name) state.guest2Name = ev.detail.guest2Name;
  state.stlDifficulty = ev.detail.stlDifficulty || 'normal';
  state.stlForfeitCards = ev.detail.stlForfeitCards || ['truth', 'dare', 'control', 'strip', 'drink', 'surrender'];
  state.wiWinCondition = ev.detail.wiWinCondition || 'normal';
  state.wiSpellLimit = ev.detail.wiSpellLimit || 5;
  const gt = state.gameType;
  if (gt === 'mastermind') navigate('#/mastermind');
  else if (gt === 'endurance') navigate('#/endurance');
  else if (gt === 'tugofwar') navigate('#/tugofwar');
  else if (gt === 'dice') navigate('#/dice');
  else if (gt === 'hilo') navigate('#/hilo');
  else if (gt === 'splitloot') navigate('#/splitloot');
  else if (gt === 'wizardisland') navigate('#/wizardisland');
  else if (gt === 'beatdealer') navigate('#/beatdealer');
  else if (gt === 'standoff') navigate('#/standoff');
  else navigate('#/game');
});

route();
