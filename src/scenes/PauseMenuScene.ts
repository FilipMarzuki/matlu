import * as Phaser from 'phaser';
import { t } from '../lib/i18n';
import { DiscoveryScene } from './DiscoveryScene';
import { UI } from '../ui/UIFactory';

/**
 * PauseMenuScene — in-game pause overlay.
 *
 * Launched as a parallel Phaser Scene over GameScene so the world stays
 * rendered but frozen underneath. Follows the same overlay pattern as
 * CreditsScene and SettingsScene:
 *   - caller calls `scene.pause()` then `scene.launch('PauseMenuScene')`
 *   - this scene calls `scene.stop()` + `scene.resume('GameScene')` to dismiss
 *
 * ## Why scene.pause() + scene.launch()?
 * `scene.pause()` freezes the caller's update loop and physics — the world stops
 * moving but stays visible in the background. `scene.launch()` runs this scene
 * in parallel (not instead of) the caller. When this scene stops, it explicitly
 * resumes GameScene, which unfreezes physics automatically.
 *
 * ## Controls
 * - Resume button / Escape / P: unpauses and returns to game
 * - Settings: opens SettingsScene as a nested overlay (returns here on close)
 * - Quit to Main Menu: stops GameScene entirely and navigates to MainMenuScene
 */
export class PauseMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PauseMenuScene' });
  }

  preload(): void {
    UI.preloadUI(this);
  }

  create(): void {
    // FIL-113: Duck GameScene's music and ambience while the pause menu is open.
    // We check isPaused() so this is a no-op if PauseMenuScene is ever launched
    // without GameScene being the one that paused (future-proofing).
    // We pass our own this.tweens because GameScene's tween manager is frozen while
    // it's paused — see GameScene.duckAudio() for the full explanation.
    if (this.scene.isPaused('GameScene')) {
      // Duck-typed access avoids a circular import between PauseMenuScene and GameScene.
      type DuckableScene = Phaser.Scene & { duckAudio?: (tweens: Phaser.Tweens.TweenManager) => void };
      (this.scene.get('GameScene') as DuckableScene).duckAudio?.(this.tweens);
    }

    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cy = height / 2;

    // Full-screen semi-transparent backdrop — click outside panel to resume.
    UI.makeBackdrop(this, 0.78, UI.Color.backdropBlack, () => this.resumeGame());

    // Panel with Tech-Rune double-border (uses nine-slice sprite if loaded).
    const panelW = 300;
    const panelH = 280;
    UI.makePanel(this, cx, cy, panelW, panelH, 'system');

    // Title
    UI.makeTitle(this, cx, cy - panelH / 2 + UI.Space.xxl, t('pause.title'));

    // Buttons — stacked vertically inside the panel
    const btnY  = cy - 36;
    const btnGap = 46;
    UI.makeButton(this, cx, btnY,              t('pause.resume'),    () => this.resumeGame(),    { fixedWidth: 200 });
    UI.makeButton(this, cx, btnY + btnGap,     t('pause.discovery'), () => this.openDiscovery(), { fixedWidth: 200 });
    UI.makeButton(this, cx, btnY + btnGap * 2, t('pause.settings'),  () => this.openSettings(),  { fixedWidth: 200 });
    UI.makeButton(this, cx, btnY + btnGap * 3, t('pause.quit'),      () => this.quitToMenu(),    { fixedWidth: 200 });

    // Keyboard shortcuts — ESC and P both resume, matching common game conventions
    this.input.keyboard?.on('keydown-ESC', () => this.resumeGame());
    this.input.keyboard?.on('keydown-P',   () => this.resumeGame());
  }

  private resumeGame(): void {
    // Stopping this scene and resuming GameScene is all that's needed.
    // Phaser automatically unpauses physics when a scene is resumed — no explicit
    // physics.world.resume() call required.
    this.scene.stop();
    this.scene.resume('GameScene');
  }

  private openDiscovery(): void {
    // Follow the same caller-key pattern as openSettings() — pause this scene
    // so the discovery overlay runs on top, then it resumes us on close.
    this.scene.pause();
    this.scene.launch(DiscoveryScene.KEY, this.scene.key as unknown as object);
  }

  private openSettings(): void {
    // Follow the same caller-key pattern used across the menu system:
    // pause this scene, launch SettingsScene with our key as data.
    // SettingsScene reads scene.settings.data as the caller to resume on close,
    // so it will automatically resume PauseMenuScene when the player closes Settings.
    this.scene.pause();
    this.scene.launch('SettingsScene', this.scene.key as unknown as object);
  }

  private quitToMenu(): void {
    // Stop both scenes (GameScene is still running, paused in the background)
    // then start MainMenuScene fresh. scene.start() stops all other scenes automatically.
    this.scene.stop('GameScene');
    this.scene.start('MainMenuScene');
  }
}
