import * as Phaser from 'phaser';
import './lib/supabaseClient';

// Phaser 4's ESM bundle (built with webpack) references `Phaser` as a global
// in several internal paths (e.g. `Phaser.Textures.FilterMode.LINEAR` inside
// `setSmoothPixelArt`, `instanceof Phaser.Textures.Texture` in filter setters).
// In a Vite/ESM context the import namespace is NOT window.Phaser automatically,
// so we assign it. Must happen before new Phaser.Game() and before any Phaser
// game object constructors that trigger these paths.
(window as unknown as Record<string, unknown>)['Phaser'] = Phaser;
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

// Direct URL routing — lets testers jump straight to a scene without
// navigating through the main menu. Vercel rewrites all paths to index.html
// so these URLs work as direct links or bookmarks.
//   /arena  → CombatArenaScene  (combat testing)
//   /world  → GameScene         (world/wilderview testing)
//   /       → MainMenuScene     (default — full game flow)
const path = window.location.pathname.replace(/\/$/, '');
const sceneOrder = (() => {
  const all = [MainMenuScene, WilderviewScene, GameScene, CreditsScene, NpcDialogScene, SettingsScene, PauseMenuScene, GameOverScene, LevelCompleteScene, CombatArenaScene, UpgradeScene, NavScene, EndingScene, StatsScene, LoreScene, ShopScene];
  if (path === '/arena') return [CombatArenaScene, ...all.filter(s => s !== CombatArenaScene)];
  if (path === '/world') return [GameScene,        ...all.filter(s => s !== GameScene)];
  return all;
})();

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
  // MainMenuScene is the entry point (first in array = auto-started).
  // WilderviewScene is kept for compatibility but now redirects to MainMenuScene.
  scene: sceneOrder,
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
