import Phaser from 'phaser';
import { TugOfWarScene } from './TugOfWarScene.js';

export function bootTugOfWar({ parent, seed, startAt, myName, opponentName, onScore, onEnd, onGameStarted }) {
  const sceneData = { seed, startAt, myName, opponentName, onScore, onEnd, onGameStarted };
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    parent,
    backgroundColor: '#0a0e1a',
    physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
    scale: { mode: Phaser.Scale.NONE },
    disableVisibilityChange: true,
    callbacks: {
      postBoot: (g) => {
        g.scene.add('tugofwar', TugOfWarScene, true, sceneData);
      },
    },
  });
  return game;
}
