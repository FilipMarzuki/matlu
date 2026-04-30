/**
 * ArenaSelectScene — minimal tier picker shown before DungeonForgeScene.
 *
 * Renders a numbered list of TIER_CONFIGS.  The player presses 1–5 (keyboard)
 * or taps a row to launch DungeonForgeScene with the chosen config.  ESC or the
 * back button returns to the previous scene.
 *
 * ## How it integrates
 *
 * The `nav-goto-arena` game event (emitted by NavScene's Arena button) now
 * starts this scene instead of DungeonForgeScene directly.  This scene then
 * calls `this.scene.start('DungeonForgeScene', selectedConfig)`.
 */

import * as Phaser from 'phaser';
import { TIER_CONFIGS, ArenaTierConfig } from '../data/arenaTiers';

/** Only tiers marked ready are shown in the selector. */
const READY_TIERS = TIER_CONFIGS.filter(c => c.ready);

export class ArenaSelectScene extends Phaser.Scene {
  static readonly KEY = 'ArenaSelectScene';

  /** Scene key to return to when the player presses ESC or Back. */
  private returnSceneKey = 'GameScene';

  constructor() {
    super({ key: ArenaSelectScene.KEY });
  }

  init(data?: { returnTo?: string }): void {
    this.returnSceneKey = data?.returnTo ?? 'GameScene';
  }

  create(): void {
    const { width: W, height: H } = this.scale;
    const cx = W / 2;

    // ── Background ────────────────────────────────────────────────────────────
    this.add.rectangle(cx, H / 2, W, H, 0x0a0a12, 0.92);

    // ── Title ─────────────────────────────────────────────────────────────────
    this.add.text(cx, 48, 'Select Arena Tier', {
      fontSize: '22px',
      color: '#ffe066',
      fontFamily: 'monospace',
    }).setOrigin(0.5);

    // ── Tier rows ─────────────────────────────────────────────────────────────
    const rowH    = 56;
    const startY  = 120;

    READY_TIERS.forEach((cfg, i) => {
      const y       = startY + i * rowH;
      const keyHint = `[${i + 1}]`;

      // Row background — highlights on hover
      const bg = this.add.rectangle(cx, y, W * 0.72, 44, 0x1a1a2e, 0.8)
        .setInteractive({ useHandCursor: true });

      bg
        .on('pointerover',  () => bg.setFillStyle(0x2a2a4e, 0.9))
        .on('pointerout',   () => bg.setFillStyle(0x1a1a2e, 0.8))
        .on('pointerup',    () => this.launch(cfg));

      // Key hint
      this.add.text(cx - W * 0.32, y, keyHint, {
        fontSize: '16px',
        color: '#888888',
        fontFamily: 'monospace',
      }).setOrigin(0, 0.5);

      // Tier label
      this.add.text(cx - W * 0.32 + 40, y, cfg.label, {
        fontSize: '17px',
        color: '#e8e8ff',
        fontFamily: 'monospace',
      }).setOrigin(0, 0.5);
    });

    // ── Back row ──────────────────────────────────────────────────────────────
    const backY  = startY + READY_TIERS.length * rowH + 20;
    const backBg = this.add.rectangle(cx, backY, W * 0.72, 44, 0x1a1a2e, 0.8)
      .setInteractive({ useHandCursor: true });
    backBg
      .on('pointerover', () => backBg.setFillStyle(0x2a2a2e, 0.9))
      .on('pointerout',  () => backBg.setFillStyle(0x1a1a2e, 0.8))
      .on('pointerup',   () => this.goBack());

    this.add.text(cx, backY, '[ESC]  Back', {
      fontSize: '15px',
      color: '#888888',
      fontFamily: 'monospace',
    }).setOrigin(0.5);

    // ── Keyboard ─────────────────────────────────────────────────────────────
    // Number keys map to ready-tier rows by display index.
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      const idx = parseInt(event.key, 10) - 1;
      if (idx >= 0 && idx < READY_TIERS.length) {
        this.launch(READY_TIERS[idx]);
      } else if (event.key === 'Escape') {
        this.goBack();
      }
    });
  }

  private launch(cfg: ArenaTierConfig): void {
    // Stop this selector then start the arena with the chosen config.
    // DungeonForgeScene.init() receives cfg and stores it as this.tierConfig.
    this.scene.stop(ArenaSelectScene.KEY);
    this.scene.start('DungeonForgeScene', cfg);
  }

  private goBack(): void {
    this.scene.stop(ArenaSelectScene.KEY);
    this.scene.resume(this.returnSceneKey);
  }
}
