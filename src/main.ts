import * as Phaser from 'phaser';
import VirtualJoystickPlugin from 'phaser4-rex-plugins/plugins/virtualjoystick-plugin';
import './lib/supabaseClient';
import { log } from './lib/logger';
import { MainMenuScene } from './scenes/MainMenuScene';
import { WilderviewScene } from './scenes/WilderviewScene';
import { GameScene } from './scenes/GameScene';
import { CreditsScene } from './scenes/CreditsScene';
import { NpcDialogScene } from './scenes/NpcDialogScene';
import { SettingsScene } from './scenes/SettingsScene';
import { PauseMenuScene } from './scenes/PauseMenuScene';
import { GameOverScene } from './scenes/GameOverScene';
import { LevelCompleteScene } from './scenes/LevelCompleteScene';
import { CombatArenaScene } from './scenes/CombatArenaScene';
import { UpgradeScene } from './scenes/UpgradeScene';
import { NavScene } from './scenes/NavScene';
import { EndingScene } from './scenes/EndingScene';
import { StatsScene } from './scenes/StatsScene';
import { LoreScene } from './scenes/LoreScene';
import { ShopScene } from './scenes/ShopScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: 0x2d6b2e,
  // Disable anti-aliasing so pixel-art sprites render crisp rather than blurry.
  render: { pixelArt: true },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  // RESIZE makes the canvas fill the full viewport — no letterboxing.
  // UI elements must use this.scale.width/height instead of hardcoded 800×600.
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // Register the rex virtual joystick plugin from npm rather than CDN so it
  // works reliably in production (raw.githubusercontent.com is not dependable).
  plugins: {
    global: [
      {
        key: 'rexvirtualjoystickplugin',
        plugin: VirtualJoystickPlugin,
        start: true,
      },
    ],
  },
  // MainMenuScene is the entry point (first in array = auto-started).
  // WilderviewScene is kept for compatibility but now redirects to MainMenuScene.
  scene: [MainMenuScene, WilderviewScene, GameScene, CreditsScene, NpcDialogScene, SettingsScene, PauseMenuScene, GameOverScene, LevelCompleteScene, CombatArenaScene, UpgradeScene, NavScene, EndingScene, StatsScene, LoreScene, ShopScene],
});

// Restore mute preference saved by SettingsScene.
// Must run after the game is created so the sound manager exists.
if (typeof localStorage !== 'undefined' && localStorage.getItem('matlu_muted') === 'true') {
  game.sound.setMute(true);
}

// Expose game instance for Playwright tests and dev tooling.
// Always set so that preview-mode Playwright tests can access it.
(window as unknown as Record<string, unknown>)['__game'] = game;

// ── Global error capture ──────────────────────────────────────────────────────
// Catches unhandled JS errors and promise rejections anywhere in the client.
// These are the most important signals — they reach Better Stack even when
// the user never reports anything.
window.addEventListener('error', (ev) => {
  log.error('unhandled error', {
    message: ev.message,
    filename: ev.filename,
    line:     ev.lineno,
    col:      ev.colno,
    stack:    ev.error?.stack,
  });
});

window.addEventListener('unhandledrejection', (ev) => {
  const reason = ev.reason instanceof Error
    ? { message: ev.reason.message, stack: ev.reason.stack }
    : { message: String(ev.reason) };
  log.error('unhandled promise rejection', reason);
});

// Phaser's internal error bus — catches errors thrown inside scene update loops.
game.events.on('error', (err: Error) => {
  log.error('phaser game error', { message: err.message, stack: err.stack });
});
