import * as Phaser from 'phaser';
import { t } from '../lib/i18n';

/**
 * GameOverScene — displayed when the player's HP reaches 0.
 *
 * Launched as a Phaser overlay over the paused GameScene (same pattern as
 * PauseMenuScene). The frozen world stays visible behind it.
 *
 * ## Data received via scene.settings.data
 * ```ts
 * { cleanse: number; kills: number; durationMs: number }
 * ```
 * GameScene passes this when calling `scene.launch('GameOverScene', data)`.
 *
 * ## Buttons
 * - Try Again: stops both scenes and restarts GameScene fresh
 * - Main Menu: stops both scenes and returns to MainMenuScene
 */

interface GameOverData {
  cleanse: number;
  kills: number;
  durationMs: number;
}

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameOverScene' });
  }

  create(): void {
    const data = this.scene.settings.data as unknown as GameOverData;
    const cleanse    = data?.cleanse    ?? 0;
    const kills      = data?.kills      ?? 0;
    const durationMs = data?.durationMs ?? 0;

    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cy = height / 2;

    // ── Backdrop ──────────────────────────────────────────────────────────────
    // Dark red tint distinguishes game-over from the neutral pause menu backdrop
    this.add
      .rectangle(cx, cy, width, height, 0x220000, 0.85)
      .setScrollFactor(0)
      .setDepth(800)
      .setInteractive(); // absorbs clicks — no accidental dismiss on touch

    // ── Panel ─────────────────────────────────────────────────────────────────
    const panelW = 300;
    const panelH = 260;
    this.add
      .rectangle(cx, cy, panelW, panelH, 0x110808, 0.97)
      .setScrollFactor(0)
      .setDepth(801)
      .setInteractive();

    const border = this.add.graphics().setScrollFactor(0).setDepth(802);
    border.lineStyle(1, 0xff4444, 0.3);
    border.strokeRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH);

    // ── Title ─────────────────────────────────────────────────────────────────
    this.add
      .text(cx, cy - panelH / 2 + 28, t('gameover.title'), {
        fontSize: '22px',
        color: '#ff6666',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);

    this.add
      .text(cx, cy - panelH / 2 + 58, t('gameover.subtitle'), {
        fontSize: '12px',
        color: '#996666',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);

    // ── Stats ─────────────────────────────────────────────────────────────────
    // Three rows: Cleanse %, Enemies defeated, Time survived.
    // Shown in a simple label: value layout centred in the panel.
    const statsY  = cy - 30;
    const statGap = 26;

    this.addStatRow(cx, statsY,              t('gameover.cleanse'), `${cleanse}%`);
    this.addStatRow(cx, statsY + statGap,    t('gameover.kills'),   String(kills));
    this.addStatRow(cx, statsY + statGap * 2, t('gameover.time'),    formatDuration(durationMs));

    // ── Buttons ───────────────────────────────────────────────────────────────
    const btnY  = cy + panelH / 2 - 62;
    const btnGap = 44;
    this.makeButton(cx, btnY,          t('gameover.try_again'), () => this.tryAgain());
    this.makeButton(cx, btnY + btnGap, t('gameover.main_menu'), () => this.goToMainMenu());

    // Enter = try again, Escape = main menu — common game-over conventions
    this.input.keyboard?.on('keydown-ENTER', () => this.tryAgain());
    this.input.keyboard?.on('keydown-ESC',   () => this.goToMainMenu());
  }

  /** Two-column stat row: muted label on the left, bright value on the right */
  private addStatRow(cx: number, y: number, label: string, value: string): void {
    const col = 70;
    this.add
      .text(cx - col, y, label, { fontSize: '12px', color: '#886666' })
      .setOrigin(1, 0.5)
      .setScrollFactor(0)
      .setDepth(802);
    this.add
      .text(cx - col + 8, y, value, { fontSize: '12px', color: '#f0ead6', fontStyle: 'bold' })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(802);
  }

  private makeButton(x: number, y: number, label: string, onClick: () => void): void {
    const btn = this.add
      .text(x, y, label, {
        fontSize: '15px',
        color: '#ffe066',
        backgroundColor: '#333300aa',
        padding: { x: 14, y: 8 },
        fixedWidth: 220,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => btn.setStyle({ color: '#ffffff' }))
      .on('pointerout',  () => btn.setStyle({ color: '#ffe066' }))
      .on('pointerdown', onClick);
  }

  private tryAgain(): void {
    // scene.start() automatically stops the current scene and all overlays,
    // then boots GameScene fresh — no manual cleanup needed.
    this.scene.start('GameScene');
  }

  private goToMainMenu(): void {
    this.scene.stop('GameScene');
    this.scene.start('MainMenuScene');
  }
}

/** Format milliseconds as m:ss — e.g. 90000 → "1:30" */
function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const minutes  = Math.floor(totalSec / 60);
  const seconds  = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
