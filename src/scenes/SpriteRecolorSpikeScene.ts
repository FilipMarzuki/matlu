/**
 * SpriteRecolorSpikeScene — Issue #703 POC: base Skald frame + recolored variants.
 *
 * Route: `/recolor` (see `main.ts`).
 *
 * Row 1 — `setTint` (whole-sprite multiply): cheap, but shifts skin and cloth together.
 * Row 2 — 3-slot palette remap shader: garment tones can move independently if source
 * art clusters into a few RGBs (here, colours measured from `idle_south_0`).
 */

import * as Phaser from 'phaser';
import {
  SPRITE_RECOLOR_PALETTE_FRAG,
  SPRITE_RECOLOR_PALETTE_VERT,
} from '../shaders/spriteRecolorPaletteGlsl';

const SKALD_ATLAS = 'skald';
const SKALD_FRAME = 'idle_south_0';
const DISPLAY_SCALE = 4;

/** sRGB 0–255 → linear 0–1 for shader uniforms (matches PNG decode in GPU). */
const rgb = (r: number, g: number, b: number): [number, number, number] =>
  [r / 255, g / 255, b / 255];

// Dominant non-outline colours in `idle_south_0` (see spike doc / node histogram).
const SRC0 = rgb(0xe1, 0xbd, 0xa6);
const SRC1 = rgb(0x5d, 0x3c, 0x2b);
const SRC2 = rgb(0xd0, 0x81, 0x61);

type UniformSetter = (name: string, value: unknown) => void;

function makePaletteSetup(
  dst0: readonly [number, number, number],
  dst1: readonly [number, number, number],
  dst2: readonly [number, number, number],
  thresh: number,
): (setUniform: UniformSetter) => void {
  const s0 = new Float32Array(SRC0);
  const s1 = new Float32Array(SRC1);
  const s2 = new Float32Array(SRC2);
  const d0 = new Float32Array(dst0);
  const d1 = new Float32Array(dst1);
  const d2 = new Float32Array(dst2);
  return (setUniform: UniformSetter) => {
    setUniform('uMainSampler', 0);
    setUniform('uSrc0', s0);
    setUniform('uSrc1', s1);
    setUniform('uSrc2', s2);
    setUniform('uDst0', d0);
    setUniform('uDst1', d1);
    setUniform('uDst2', d2);
    setUniform('uThresh', thresh);
  };
}

export class SpriteRecolorSpikeScene extends Phaser.Scene {
  constructor() {
    super({ key: 'SpriteRecolorSpikeScene' });
  }

  preload(): void {
    this.load.atlas(
      SKALD_ATLAS,
      '/assets/sprites/characters/earth/heroes/skald/skald.png',
      '/assets/sprites/characters/earth/heroes/skald/skald.json',
    );
  }

  create(): void {
    const { width: W, height: H } = this.scale;
    this.cameras.main.setBackgroundColor(0x1e1e28);

    this.add.text(W / 2, 36, '#703 — Sprite recolor spike (Skald idle_south_0)', {
      fontSize: '18px',
      color: '#ffe066',
      fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0);

    this.add.text(W / 2, 62, 'Open /recolor · ESC / ← Back to menu', {
      fontSize: '12px',
      color: '#999999',
      fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0);

    const row1Y = H * 0.38;
    const row2Y = H * 0.62;
    const cols = 5;
    const gap = Math.min(W / (cols + 1), 140);
    const startX = W / 2 - ((cols - 1) * gap) / 2;

    const labels1 = ['Base', 'Tint A', 'Tint B', '—', '—'];
    for (let i = 0; i < cols; i++) {
      this.add.text(startX + i * gap, row1Y - 72, labels1[i], {
        fontSize: '11px',
        color: '#bbbbbb',
        fontFamily: 'monospace',
      }).setOrigin(0.5).setScrollFactor(0);
    }

    const labels2 = ['—', '—', '—', 'Palette A', 'Palette B'];
    for (let i = 0; i < cols; i++) {
      this.add.text(startX + i * gap, row2Y - 72, labels2[i], {
        fontSize: '11px',
        color: '#bbbbbb',
        fontFamily: 'monospace',
      }).setOrigin(0.5).setScrollFactor(0);
    }

    const size = 48 * DISPLAY_SCALE;

    const base = this.add.sprite(startX, row1Y, SKALD_ATLAS, SKALD_FRAME);
    base.setScale(DISPLAY_SCALE);

    const tintA = this.add.sprite(startX + gap, row1Y, SKALD_ATLAS, SKALD_FRAME);
    tintA.setScale(DISPLAY_SCALE);
    tintA.setTint(0x88ccff);

    const tintB = this.add.sprite(startX + gap * 2, row1Y, SKALD_ATLAS, SKALD_FRAME);
    tintB.setScale(DISPLAY_SCALE);
    tintB.setTint(0xffaa66);

    const isWebGl = this.sys.renderer.type === Phaser.WEBGL;

    if (isWebGl) {
      const shaderA = this.add.shader(
        {
          name: 'SpriteRecolor703PaletteA',
          shaderName: 'SpriteRecolor703PaletteA',
          vertexSource: SPRITE_RECOLOR_PALETTE_VERT,
          fragmentSource: SPRITE_RECOLOR_PALETTE_FRAG,
          setupUniforms: makePaletteSetup(
            rgb(0xc8, 0xb8, 0xd8),
            rgb(0x37, 0x4b, 0x82),
            rgb(0xaa, 0x78, 0x5a),
            0.14,
          ),
        },
        startX + gap * 3,
        row2Y,
        size,
        size,
        [SKALD_ATLAS],
      );
      shaderA.setTextureCoordinatesFromFrame(SKALD_FRAME, SKALD_ATLAS);

      const shaderB = this.add.shader(
        {
          name: 'SpriteRecolor703PaletteB',
          shaderName: 'SpriteRecolor703PaletteB',
          vertexSource: SPRITE_RECOLOR_PALETTE_VERT,
          fragmentSource: SPRITE_RECOLOR_PALETTE_FRAG,
          setupUniforms: makePaletteSetup(
            rgb(0xe6, 0xc8, 0xa8),
            rgb(0x2d, 0x6e, 0x3c),
            rgb(0x5a, 0x3c, 0x28),
            0.14,
          ),
        },
        startX + gap * 4,
        row2Y,
        size,
        size,
        [SKALD_ATLAS],
      );
      shaderB.setTextureCoordinatesFromFrame(SKALD_FRAME, SKALD_ATLAS);
    } else {
      this.add.text(W / 2, row2Y, 'Palette row needs WebGL (AUTO fell back to Canvas)', {
        fontSize: '13px',
        color: '#ff6666',
        fontFamily: 'monospace',
      }).setOrigin(0.5).setScrollFactor(0);
    }

    this.buildBackButton();
    this.input.keyboard?.on('keydown-ESC', this.exitToMainMenu, this);
    this.input.keyboard?.on('keydown-BACKSPACE', this.exitToMainMenu, this);
  }

  private buildBackButton(): void {
    const padding = 16;
    const btn = this.add.text(padding, padding, '← Back', {
      fontSize: '16px',
      color: '#ffffff',
      fontFamily: 'monospace',
      backgroundColor: '#222244',
      padding: { x: 10, y: 6 },
    }).setScrollFactor(0).setInteractive({ useHandCursor: true });
    btn.on('pointerup', () => this.exitToMainMenu());
  }

  private exitToMainMenu(): void {
    this.scene.start('MainMenuScene');
  }
}
