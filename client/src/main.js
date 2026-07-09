import './style.css';
import { socket } from './net/socket.js';
import { state, reset } from './state.js';
import { renderLanding } from './screens/landing.js';
import { renderLobby } from './screens/lobby.js';
import { renderGame } from './screens/game.js';
import { renderResults } from './screens/results.js';
import { renderMastermind } from './screens/mastermind.js';
import { renderMastermind3 } from './screens/mastermind3.js';
import { renderMastermind1P } from './screens/mastermind1p.js';
import { renderEndurance } from './screens/endurance.js';
import { renderTugOfWar } from './screens/tugofwar.js';
import { renderDice } from './screens/dice.js';
import { renderHilo } from './screens/hilo.js';
import { renderHilo1P } from './screens/hilo1p.js';
import { renderSplitLoot } from './screens/splitloot.js';
import { renderWizardIsland } from './screens/wizardisland.js';
import { renderBeatDealer } from './screens/beatdealer.js';
import { renderStandoff } from './screens/standoff.js';
import { renderLastCall } from './screens/lastcall.js';
import { renderBattleships } from './screens/battleships.js';
import { renderWheel } from './screens/wheel.js';
import { renderUno } from './screens/uno.js';
import { renderSnakes } from './screens/snakes.js';
import { renderMemory } from './screens/memory.js';

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

  if (hash === '#/mastermind3') {
    if (!state.seed) { navigate('#/'); return; }
    renderMastermind3(app);
    return;
  }

  if (hash === '#/mastermind1p') {
    if (!state.seed) { navigate('#/'); return; }
    renderMastermind1P(app);
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

  if (hash === '#/hilo1p') {
    if (!state.seed) { navigate('#/'); return; }
    renderHilo1P(app);
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

  if (hash === '#/lastcall') {
    if (!state.seed) { navigate('#/'); return; }
    renderLastCall(app);
    return;
  }

  if (hash === '#/battleships') {
    if (!state.seed) { navigate('#/'); return; }
    renderBattleships(app);
    return;
  }

  if (hash === '#/uno') {
    if (!state.seed) { navigate('#/'); return; }
    renderUno(app);
    return;
  }

  if (hash === '#/snakes') {
    if (!state.seed) { navigate('#/'); return; }
    renderSnakes(app);
    return;
  }

  if (hash === '#/memory') {
    if (!state.seed) { navigate('#/'); return; }
    renderMemory(app);
    return;
  }

  if (hash === '#/wheel') {
    renderWheel(app);
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
  state.btdForfeits = ev.detail.btdForfeits || [];
  state.btdMode = ev.detail.btdMode || 'draw';
  state.btdGameMode = ev.detail.btdGameMode || 'dealer';
  state.wiWinCondition = ev.detail.wiWinCondition || 'normal';
  state.wiSpellLimit = ev.detail.wiSpellLimit || 5;
  state.diceVibeRule = ev.detail.diceVibeRule || 'lowest';
  state.lcTimer = !!ev.detail.lcTimer;
  state.lcMinutes = ev.detail.lcMinutes || 10;
  state.lcDeckSize = ev.detail.lcDeckSize ?? 2;
  state.lcReward = ev.detail.lcReward || 'full';
  state.bsGridSize = ev.detail.bsGridSize || 'standard';
  state.bsVibeMultiplier = ev.detail.bsVibeMultiplier ?? 1.5;
  if (ev.detail.gameType === 'uno') state.gameRounds = ev.detail.unoRounds || ev.detail.rounds || 5;
  state.unoSpecialPacks = ev.detail.unoSpecialPacks || [];
  state.snlMode = ev.detail.snlMode || 'versus';
  state.snlBoardSize = ev.detail.snlBoardSize || 'standard';
  state.snlDensity = ev.detail.snlDensity || 'even';
  state.snlStakeMix = ev.detail.snlStakeMix || 'mixed';
  state.snlVibeScale = ev.detail.snlVibeScale || 'full';
  state.snlWinCondition = ev.detail.snlWinCondition || 'race';
  state.snlFinalRule = ev.detail.snlFinalRule || 'exact';
  state.snlPowerups = ev.detail.snlPowerups !== false;
  state.snlCoopBetray = !!ev.detail.snlCoopBetray;
  state.snlForfeitCards = ev.detail.snlForfeitCards || ['vibe', 'edge', 'strip', 'control', 'task', 'surrender'];
  state.snlForfeitLines = ev.detail.snlForfeitLines || [];
  state.snlAmbient = !!ev.detail.snlAmbient;
  state.snlTapOut = !!ev.detail.snlTapOut;
  state.memMode = ev.detail.memMode || 'versus';
  state.memForfeitLines = ev.detail.memForfeitLines || [];
  state.memVibeDurations = ev.detail.memVibeDurations || [];
  state.memGridSize = ev.detail.memGridSize || '6x6';
  const gt = state.gameType;
  if (gt === 'mastermind') navigate(state.playerCount === 3 ? '#/mastermind3' : state.playerCount === 1 ? '#/mastermind1p' : '#/mastermind');
  else if (gt === 'endurance') navigate('#/endurance');
  else if (gt === 'tugofwar') navigate('#/tugofwar');
  else if (gt === 'dice') navigate('#/dice');
  else if (gt === 'hilo') navigate(state.playerCount === 1 ? '#/hilo1p' : '#/hilo');
  else if (gt === 'splitloot') navigate('#/splitloot');
  else if (gt === 'wizardisland') navigate('#/wizardisland');
  else if (gt === 'beatdealer') navigate('#/beatdealer');
  else if (gt === 'standoff') navigate('#/standoff');
  else if (gt === 'lastcall') navigate('#/lastcall');
  else if (gt === 'battleships') navigate('#/battleships');
  else if (gt === 'uno') navigate('#/uno');
  else if (gt === 'snakes') navigate('#/snakes');
  else if (gt === 'memory') navigate('#/memory');
  else navigate('#/game');
});

route();
