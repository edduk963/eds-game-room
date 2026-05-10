export const state = {
  myName: '',
  sessionId: null,
  role: null,
  hostName: null,
  guestName: null,
  seed: null,
  startAt: null,
  myFinal: null,
  oppFinal: null,
  myVibeResidual: 0,
  oppVibeResidual: 0,
  gameType: 'galactic',
  gameRounds: 3,
  gameMode: 'easy',
  forfeitDuration: 30,
  edgeMode: false,
  edgeLives: 3,
};

export function reset() {
  state.sessionId = null;
  state.role = null;
  state.hostName = null;
  state.guestName = null;
  state.seed = null;
  state.startAt = null;
  state.myFinal = null;
  state.oppFinal = null;
  state.myVibeResidual = 0;
  state.oppVibeResidual = 0;
  state.gameType = 'galactic';
  state.gameRounds = 3;
  state.gameMode = 'easy';
  state.forfeitDuration = 30;
  state.edgeMode = false;
  state.edgeLives = 3;
}
