import Phaser from 'phaser';
import './lib/supabaseClient';
import { AttractionScene } from './scenes/AttractionScene';
import { GameScene } from './scenes/GameScene';

new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: 'game-container',
  backgroundColor: 0x2d6b2e,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // AttractionScene is the default entry point; it launches GameScene on demand
  scene: [AttractionScene, GameScene],
});
