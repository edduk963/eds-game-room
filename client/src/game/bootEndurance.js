import Phaser from 'phaser';
import { EnduranceScene } from './EnduranceScene.js';

export function bootEndurance({ parent, seed, startAt, myName, opponentName, onScore, onEnd, onShootVibe, onVTimeAdd, onShootVibeActive, onVibeOpponent }) {
  const sceneData = { seed, startAt, myName, opponentName, onScore, onEnd, onShootVibe, onVTimeAdd, onShootVibeActive, onVibeOpponent };
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
        g.scene.add('endurance', EnduranceScene, true, sceneData);
      },
    },
  });
  return game;
}
