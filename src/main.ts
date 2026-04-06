import Phaser from 'phaser';
import * as Sentry from '@sentry/browser';
import './lib/supabaseClient';
import { AttractionScene } from './scenes/AttractionScene';
import { GameScene } from './scenes/GameScene';

Sentry.init({
  dsn: import.meta.env.VITE_BETTERSTACK_DSN,
  tunnel: 'https://ingest.sentry.io',
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_GIT_SHA,
  tracesSampleRate: 0.2,
  replaysOnErrorSampleRate: 1.0,
});

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
