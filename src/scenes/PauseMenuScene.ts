import * as Phaser from 'phaser';
import { t } from '../lib/i18n';
import { DiscoveryScene } from './DiscoveryScene';

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

    // Full-screen semi-transparent backdrop.
    // setInteractive + pointerdown lets the player click outside the panel to resume —
    // a common mobile-game pattern that feels natural on tablet.
    this.add
      .rectangle(cx, cy, width, height, 0x000000, 0.78)
      .setScrollFactor(0)
      .setDepth(800)
      .setInteractive()
      .on('pointerdown', () => this.resumeGame());

    // Opaque panel — needs to be interactive so clicks on it don't fall through
    // to the backdrop and accidentally dismiss the menu.
    const panelW = 260;
    const panelH = 256;
    this.add
      .rectangle(cx, cy, panelW, panelH, 0x111a11, 0.95)
      .setScrollFactor(0)
      .setDepth(801)
      .setInteractive();

    // Subtle border drawn with Graphics — Text objects can't have outlines,
    // so we use strokeRect on a Graphics layer positioned above the panel.
    const border = this.add.graphics().setScrollFactor(0).setDepth(802);
    border.lineStyle(1, 0xffffff, 0.15);
    border.strokeRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH);

    // Title
    this.add
      .text(cx, cy - panelH / 2 + 28, t('pause.title'), {
        fontSize: '22px',
        color: '#f0ead6',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);

    // Buttons — stacked vertically inside the panel (4 buttons, centered)
    const btnY  = cy - 36;
    const btnGap = 46;
    this.makeButton(cx, btnY,              t('pause.resume'),    () => this.resumeGame());
    this.makeButton(cx, btnY + btnGap,     t('pause.discovery'), () => this.openDiscovery());
    this.makeButton(cx, btnY + btnGap * 2, t('pause.settings'),  () => this.openSettings());
    this.makeButton(cx, btnY + btnGap * 3, t('pause.quit'),      () => this.quitToMenu());

    // Keyboard shortcuts — ESC and P both resume, matching common game conventions
    this.input.keyboard?.on('keydown-ESC', () => this.resumeGame());
    this.input.keyboard?.on('keydown-P',   () => this.resumeGame());
  }

  /**
   * Reusable button factory — matches MainMenuScene's button style for visual
   * consistency across the menu system (FIL-81). Gold text on dark olive bg,
   * brightens to white on hover.
   */
  private makeButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
  ): Phaser.GameObjects.Text {
    const btn = this.add
      .text(x, y, label, {
        fontSize: '15px',
        color: '#ffe066',
        backgroundColor: '#333300aa',
        padding: { x: 14, y: 8 },
        fixedWidth: 200,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => {
        btn.setStyle({ color: '#ffffff' });
        if (this.game.device.os.desktop && this.cache.audio.has('sfx-hover')) {
          this.sound.play('sfx-hover', { volume: 0.18 });
        }
      })
      .on('pointerout',  () => btn.setStyle({ color: '#ffe066' }))
      .on('pointerdown', () => {
        if (this.cache.audio.has('sfx-click')) this.sound.play('sfx-click', { volume: 0.4 });
        onClick();
      });

    return btn;
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
