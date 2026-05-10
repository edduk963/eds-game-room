import Phaser from 'phaser';
import { MainScene } from './MainScene.js';

export function bootGame({ parent, seed, startAt, myName, opponentName, onScore, onEnd, onVibeAdd, onVibeOpponent, onVTimeAdd, onClockExtend }) {
  const sceneData = { seed, startAt, myName, opponentName, onScore, onEnd, onVibeAdd, onVibeOpponent, onVTimeAdd, onClockExtend };
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
        g.scene.add('main', MainScene, true, sceneData);
      },
    },
  });
  return game;
}
