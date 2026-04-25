/**
 * SettlementScene — placeholder shell for settlement build mode.
 *
 * Same architectural pattern as `WorldForgeScene` (biome design tool) and
 * `CombatArenaScene` (dungeon): own scene, own input, own UI. Keeps build-mode
 * concerns out of `GameScene` and gives `SettlementLayout` / `BuildingCatalogue`
 * a clean place to wire into.
 *
 * This file is deliberately minimal — it boots, draws an iso ground patch,
 * shows a placeholder label, and lets the player return to the main menu.
 * Building placement, resource UI, persistence, and the overworld entry trigger
 * land in follow-up issues (see #628).
 *
 * Access: `/settlement` or `/build` URL routes (see `main.ts`).
 */

import * as Phaser from 'phaser';
import { SimpleJoystick } from '../lib/SimpleJoystick';
import { worldToIso, WORLD_TILE_SIZE } from '../lib/IsoTransform';
import { preloadTilePacks } from '../world/TilePacks';

/** Meadow biome tile pack — used for the placeholder ground patch. */
const PLACEHOLDER_PACK = 'meadow';

/** Size of the placeholder iso ground patch, in logical world tiles. */
const PATCH_TILES = 12;

export class SettlementScene extends Phaser.Scene {
  constructor() {
    super({ key: 'SettlementScene' });
  }

  preload(): void {
    // Same biome floor textures the other scenes use — shared loader so a fix
    // in one place fixes all four scenes (FIL-466 / issue #627).
    preloadTilePacks(this);
  }

  create(): void {
    const { width: W, height: H } = this.scale;

    this.cameras.main.setBackgroundColor(0x1a1a22);

    this.drawPlaceholderGround(W / 2, H / 2 - 40);

    this.add.text(W / 2, 48, 'Settlement (placeholder)', {
      fontSize: '22px',
      color: '#ffe066',
      fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0);

    this.add.text(W / 2, 80, 'Build mode coming — see issue #628', {
      fontSize: '13px',
      color: '#aaaaaa',
      fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0);

    this.buildExitButton();
    this.buildTouchJoystick();

    // Keyboard return — ESC and Backspace both go back to the main menu.
    // Using on('down') (not once) so re-entering the scene rebinds cleanly.
    this.input.keyboard?.on('keydown-ESC',       this.exitToMainMenu, this);
    this.input.keyboard?.on('keydown-BACKSPACE', this.exitToMainMenu, this);
  }

  /**
   * Draws a small diamond patch of meadow tiles centred on (cx, cy) so the
   * scene has visible content while we figure out what build mode looks like.
   * Uses the same `worldToIso` math as the real world scene so positions
   * translate 1:1 once we start placing real buildings.
   */
  private drawPlaceholderGround(cx: number, cy: number): void {
    // Translate every tile so the patch's centre tile lands at (cx, cy).
    const centre = worldToIso(
      (PATCH_TILES / 2) * WORLD_TILE_SIZE,
      (PATCH_TILES / 2) * WORLD_TILE_SIZE,
    );
    const dx = cx - centre.x;
    const dy = cy - centre.y;

    for (let ty = 0; ty < PATCH_TILES; ty++) {
      for (let tx = 0; tx < PATCH_TILES; tx++) {
        const iso = worldToIso(tx * WORLD_TILE_SIZE, ty * WORLD_TILE_SIZE);
        // Variant 0–3 picked from a stable hash so neighbours don't all match.
        const variant = (tx * 7 + ty * 13) & 3;
        this.add.image(iso.x + dx, iso.y + dy, `${PLACEHOLDER_PACK}-${variant}`)
          .setOrigin(0.5, 0);
      }
    }
  }

  private buildExitButton(): void {
    const padding = 16;
    const btn = this.add.text(padding, padding, '← Back', {
      fontSize: '16px',
      color: '#ffffff',
      fontFamily: 'monospace',
      backgroundColor: '#222244',
      padding: { x: 10, y: 6 },
    })
      .setScrollFactor(0)
      .setDepth(9999)
      .setInteractive({ useHandCursor: true });

    btn.on('pointerup', () => { this.exitToMainMenu(); });
  }

  /**
   * Touch-only joystick stub. Mounted so mobile testers see the same control
   * affordance as the other scenes — but it doesn't drive anything yet because
   * there's no hero or camera in the placeholder. Wire up when build mode lands.
   */
  private buildTouchJoystick(): void {
    if (navigator.maxTouchPoints === 0) return;

    const cx = 120;
    const cy = this.scale.height - 120;
    const r  = 50;
    const DEPTH = 9999;

    this.add.circle(cx, cy, r, 0x444444, 0.45).setScrollFactor(0).setDepth(DEPTH);
    const thumb = this.add.circle(cx, cy, 22, 0xcccccc, 0.60).setScrollFactor(0).setDepth(DEPTH);
    // Instance is retained by scene.input listeners — no need to hold a field
    // until build mode actually reads `joystick.force` / `joystick.rotation`.
    new SimpleJoystick(this, cx, cy, r, thumb);
  }

  private exitToMainMenu(): void {
    this.scene.start('MainMenuScene');
  }
}
