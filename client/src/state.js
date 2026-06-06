export const state = {
  myName: '',
  sessionId: null,
  role: null,
  hostName: null,
  guestName: null,
  guest2Name: null,
  playerCount: 2,
  seed: null,
  startAt: null,
  myFinal: null,
  oppFinal: null,
  myVibeResidual: 0,
  oppVibeResidual: 0,
  devMode: false,
  devPreselect: 'splitloot',
  gameType: 'galactic',
  gameRounds: 3,
  gameMode: 'easy',
  forfeitDuration: 30,
  edgeMode: false,
  edgeLives: 3,
  hiloMode: 'submission',
  hiloCycles: 1,
  hiloDeckSize: 1,
  hiloVibeRamp: 10,
  hiloLives: 3,
  hiloVibeTarget: 'both',
  stlDifficulty: 'normal',
  stlForfeitCards: ['truth', 'dare', 'control', 'strip', 'drink', 'surrender'],
  btdForfeits: [],
  btdMode: 'draw',
  btdGameMode: 'dealer',
  wiWinCondition: 'normal',
  wiSpellLimit: 5,
  diceVibeRule: 'lowest',
  lcTimer: false,
  lcMinutes: 10,
  lcDeckSize: 2,
  lcReward: 'full',
  bsGridSize: 'standard',
  bsVibeMultiplier: 1.5,
};

export function reset() {
  state.sessionId = null;
  state.role = null;
  state.hostName = null;
  state.guestName = null;
  state.guest2Name = null;
  state.playerCount = 2;
  state.seed = null;
  state.startAt = null;
  state.myFinal = null;
  state.oppFinal = null;
  state.myVibeResidual = 0;
  state.oppVibeResidual = 0;
  state.devMode = false;
  state.devPreselect = 'splitloot';
  state.gameType = 'galactic';
  state.gameRounds = 3;
  state.gameMode = 'easy';
  state.forfeitDuration = 30;
  state.edgeMode = false;
  state.edgeLives = 3;
  state.hiloMode = 'submission';
  state.hiloCycles = 1;
  state.hiloDeckSize = 1;
  state.hiloVibeRamp = 10;
  state.hiloLives = 3;
  state.hiloVibeTarget = 'both';
  state.stlDifficulty = 'normal';
  state.stlForfeitCards = ['truth', 'dare', 'control', 'strip', 'drink', 'surrender'];
  state.btdForfeits = [];
  state.btdMode = 'draw';
  state.btdGameMode = 'dealer';
  state.wiWinCondition = 'normal';
  state.wiSpellLimit = 5;
  state.diceVibeRule = 'lowest';
  state.lcTimer = false;
  state.lcMinutes = 10;
  state.lcDeckSize = 2;
  state.lcReward = 'full';
  state.bsGridSize = 'standard';
  state.bsVibeMultiplier = 1.5;
}
