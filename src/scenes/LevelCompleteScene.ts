import * as Phaser from 'phaser';
import { t } from '../lib/i18n';

/**
 * LevelCompleteScene — displayed when the player enters the portal.
 *
 * Launched as a Phaser overlay over the paused GameScene (same pattern as
 * PauseMenuScene and GameOverScene). The frozen world stays visible behind it.
 *
 * ## Data received via scene.settings.data
 * ```ts
 * { cleanse: number; kills: number; durationMs: number }
 * ```
 *
 * ## Buttons
 * - Play Again: restarts GameScene fresh
 * - Main Menu: returns to MainMenuScene
 */

interface LevelCompleteData {
  cleanse: number;
  kills: number;
  durationMs: number;
}

export class LevelCompleteScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LevelCompleteScene' });
  }

  create(): void {
    const data = this.scene.settings.data as unknown as LevelCompleteData;
    const cleanse    = data?.cleanse    ?? 0;
    const kills      = data?.kills      ?? 0;
    const durationMs = data?.durationMs ?? 0;

    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cy = height / 2;

    // ── Backdrop ──────────────────────────────────────────────────────────────
    // Green tint to reinforce the cleansing/victory theme
    this.add
      .rectangle(cx, cy, width, height, 0x001100, 0.82)
      .setScrollFactor(0)
      .setDepth(800)
      .setInteractive();

    // ── Panel ─────────────────────────────────────────────────────────────────
    const panelW = 320;
    const panelH = 280;
    this.add
      .rectangle(cx, cy, panelW, panelH, 0x0a180a, 0.97)
      .setScrollFactor(0)
      .setDepth(801)
      .setInteractive();

    const border = this.add.graphics().setScrollFactor(0).setDepth(802);
    border.lineStyle(1, 0x66ff88, 0.35);
    border.strokeRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH);

    // ── Title ─────────────────────────────────────────────────────────────────
    this.add
      .text(cx, cy - panelH / 2 + 28, t('levelcomplete.title'), {
        fontSize: '14px',
        color: '#88ffaa',
        fontStyle: 'italic',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);

    this.add
      .text(cx, cy - panelH / 2 + 54, t('levelcomplete.subtitle'), {
        fontSize: '22px',
        color: '#f0ead6',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);

    // ── Stars / grade (simple cleanse-based rating) ───────────────────────────
    // Gives the player a sense of score without a separate ranking system.
    const stars = cleanse >= 90 ? '★★★' : cleanse >= 60 ? '★★☆' : '★☆☆';
    this.add
      .text(cx, cy - panelH / 2 + 88, stars, {
        fontSize: '26px',
        color: '#ffe066',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);

    // ── Stats ─────────────────────────────────────────────────────────────────
    const statsY  = cy - 20;
    const statGap = 26;
    this.addStatRow(cx, statsY,              t('levelcomplete.cleanse'), `${cleanse}%`);
    this.addStatRow(cx, statsY + statGap,    t('levelcomplete.kills'),   String(kills));
    this.addStatRow(cx, statsY + statGap * 2, t('levelcomplete.time'),    formatDuration(durationMs));

    // ── Buttons ───────────────────────────────────────────────────────────────
    const btnY  = cy + panelH / 2 - 66;
    const btnGap = 44;
    this.makeButton(cx, btnY,          t('levelcomplete.play_again'), () => this.playAgain());
    this.makeButton(cx, btnY + btnGap, t('levelcomplete.main_menu'),  () => this.goToMainMenu());

    this.input.keyboard?.on('keydown-ENTER', () => this.playAgain());
    this.input.keyboard?.on('keydown-ESC',   () => this.goToMainMenu());
  }

  private addStatRow(cx: number, y: number, label: string, value: string): void {
    const col = 80;
    this.add
      .text(cx - col, y, label, { fontSize: '12px', color: '#5a886a' })
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

  private playAgain(): void {
    this.scene.start('GameScene');
  }

  private goToMainMenu(): void {
    this.scene.stop('GameScene');
    this.scene.start('MainMenuScene');
  }
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const minutes  = Math.floor(totalSec / 60);
  const seconds  = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
