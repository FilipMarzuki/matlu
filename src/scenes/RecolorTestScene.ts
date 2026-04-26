import * as Phaser from 'phaser';

/**
 * RecolorTestScene — spike POC for issue #703.
 *
 * Renders the Skald sprite three ways side by side so we can compare:
 *
 *   Row 1 — setTint(): two tinted copies of the base texture.
 *     GPU multiply: every RGBA component is multiplied by the tint color.
 *     Fast (no extra texture), but blends tint color into shadows and
 *     highlights uniformly — looks "painted over" rather than recolored.
 *
 *   Row 2 — canvas hue shift: two load-time recolored texture variants.
 *     Each pixel is converted to HSL, hue is rotated, converted back to RGB.
 *     Costs one extra GPU texture per variant, but shading/highlights are
 *     preserved because luminance is unchanged — looks like a different palette.
 *
 * Navigate to /recolor to reach this scene.
 *
 * @see docs/spikes/sprite-recolor.md  full writeup + recommendation
 */

// ── HSL helpers (strict-typed, zero external deps) ───────────────────────────

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) {
    h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  } else if (max === gn) {
    h = ((bn - rn) / d + 2) / 6;
  } else {
    h = ((rn - gn) / d + 4) / 6;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

/** Rotate the hue of every opaque pixel in-place by `shiftDeg` degrees. */
function pixelHueShift(data: Uint8ClampedArray, shiftDeg: number): void {
  const shift = shiftDeg / 360;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 4) continue; // leave transparent pixels alone
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    const newH = ((h + shift) % 1 + 1) % 1;
    const [r, g, b] = hslToRgb(newH, s, l);
    data[i]     = r;
    data[i + 1] = g;
    data[i + 2] = b;
    // alpha unchanged
  }
}

// ── Aseprite JSON types ───────────────────────────────────────────────────────

interface AseFrame {
  filename: string;
  duration?: number;
}
interface AseTag {
  name: string;
  from: number;
  to: number;
  direction: string;
}
interface AseData {
  frames: AseFrame[];
  meta: { frameTags: AseTag[] };
}

// ── Scene ─────────────────────────────────────────────────────────────────────

export class RecolorTestScene extends Phaser.Scene {
  constructor() {
    super({ key: 'RecolorTestScene' });
  }

  preload(): void {
    // Load as an atlas (PNG + Aseprite JSON).  WorldForgeScene uses the same
    // pattern so the frame names ('idle_south_0', etc.) are stable.
    this.load.atlas(
      'skald',
      '/assets/sprites/characters/earth/heroes/skald/skald.png',
      '/assets/sprites/characters/earth/heroes/skald/skald.json',
    );
  }

  create(): void {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor('#1a1a2e');

    // ── Analyze source palette ─────────────────────────────────────────────────
    // Count unique opaque colors in the raw spritesheet.  This tells us how
    // flat vs gradient the PixelLab output actually is.
    const colorCount = this.countUniqueColors('skald');

    // ── Build recolored texture variants ──────────────────────────────────────
    // Each variant is a new canvas texture with the same frame layout as the
    // base 'skald' atlas.  Cost: one extra GPU texture upload per variant.
    this.createHueShiftedAtlas('skald', 'skald_warm',  -40);   // rust / warm
    this.createHueShiftedAtlas('skald', 'skald_cool',   120);  // violet / cool

    // ── Register animations ────────────────────────────────────────────────────
    // The base atlas shares animation keys with the warm/cool variants so we
    // can play the same animation name on any of the three textures.
    this.createAnimsFromAtlas('skald');
    // Warm/cool use the same JSON timing but reference their own texture key.
    this.createAnimsFromAtlas('skald_warm', 'skald');
    this.createAnimsFromAtlas('skald_cool', 'skald');

    // ── Layout ────────────────────────────────────────────────────────────────
    const cx   = width  / 2;
    const SCALE = 4;        // 48 px × 4 = 192 px — clearly visible on tablet
    const COL_W = 200;
    const ROW1_Y = height * 0.30;
    const ROW2_Y = height * 0.72;

    // Row 1 — setTint() approach
    this.addLabeledSprite(cx - COL_W, ROW1_Y, 'skald',      'skald_idle_south',      SCALE, null,       'Original');
    this.addLabeledSprite(cx,         ROW1_Y, 'skald',      'skald_idle_south',      SCALE, 0xff9966,    'setTint() warm');
    this.addLabeledSprite(cx + COL_W, ROW1_Y, 'skald',      'skald_idle_south',      SCALE, 0x7799ff,    'setTint() cool');

    // Row 2 — canvas hue-shift approach
    this.addLabeledSprite(cx - COL_W, ROW2_Y, 'skald',      'skald_idle_south',      SCALE, null,        'Original');
    this.addLabeledSprite(cx,         ROW2_Y, 'skald_warm', 'skald_warm_idle_south', SCALE, null,         'Canvas −40°');
    this.addLabeledSprite(cx + COL_W, ROW2_Y, 'skald_cool', 'skald_cool_idle_south', SCALE, null,         'Canvas +120°');

    // ── Section headers ────────────────────────────────────────────────────────
    const txtStyle = (color: string) => ({
      fontSize: '14px', color, align: 'center' as const,
      stroke: '#000000', strokeThickness: 2,
    });

    this.add.text(cx, ROW1_Y - 120,
      'Approach 1 — setTint()\nGPU multiply: fast but tint bleeds into shadows & highlights',
      txtStyle('#ffddaa')).setOrigin(0.5);

    this.add.text(cx, ROW2_Y - 120,
      'Approach 2 — Canvas hue shift (load-time)\nHSL rotation: accurate shading preserved, one texture per variant',
      txtStyle('#aaddff')).setOrigin(0.5);

    this.add.text(cx, 22,
      `#703 Sprite Recolor POC — Skald (${colorCount} unique colors in source)`,
      { fontSize: '18px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 },
    ).setOrigin(0.5, 0).setScrollFactor(0);

    this.add.text(cx, height - 14,
      'Navigate to /recolor  |  see docs/spikes/sprite-recolor.md for writeup',
      { fontSize: '12px', color: '#888888' },
    ).setOrigin(0.5, 1).setScrollFactor(0);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Creates a sprite + text label combo.  Plays the animation if found,
   * falls back to the static frame otherwise.
   */
  private addLabeledSprite(
    x: number,
    y: number,
    textureKey: string,
    animKey: string,
    scale: number,
    tint: number | null,
    label: string,
  ): void {
    const sprite = this.add.sprite(x, y, textureKey, 'idle_south_0').setScale(scale);
    if (tint !== null) sprite.setTint(tint);
    if (this.anims.exists(animKey)) {
      sprite.play({ key: animKey, repeat: -1 });
    }

    this.add.text(x, y + (sprite.displayHeight / 2) + 8, label, {
      fontSize: '13px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5, 0);
  }

  /**
   * Counts the number of distinct opaque RGBA colors in a loaded atlas texture.
   * Used to characterise how flat vs gradient the PixelLab output is.
   * Fully transparent pixels are excluded so we measure character pixels only.
   */
  private countUniqueColors(textureKey: string): number {
    const texture = this.textures.get(textureKey);
    const source  = texture.source[0];
    const canvas  = document.createElement('canvas');
    canvas.width  = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return -1;
    ctx.drawImage(source.image as CanvasImageSource, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 4) continue;
      // Pack RGBA into a single 32-bit integer for cheap deduplication.
      seen.add((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]);
    }
    return seen.size;
  }

  /**
   * Clones a loaded atlas texture, applies a per-pixel HSL hue rotation, and
   * registers the result under `destKey`.  The new texture has identical frame
   * geometry so it is a drop-in for the original in any animation or sprite.
   *
   * This runs once at scene create time — not per frame — so the cost is a
   * single canvas readback + upload.  On mobile the bottleneck is the CPU
   * pixel loop; for a 48×192 px strip (~9 000 pixels) it is imperceptible.
   */
  private createHueShiftedAtlas(
    srcKey: string,
    destKey: string,
    hueShiftDeg: number,
  ): void {
    if (this.textures.exists(destKey)) return; // idempotent

    const srcTexture = this.textures.get(srcKey);
    const source     = srcTexture.source[0];

    // Draw the source image onto an offscreen canvas so we can read pixels.
    const canvas  = document.createElement('canvas');
    canvas.width  = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn(`createHueShiftedAtlas: could not get 2D context for ${destKey}`);
      return;
    }
    ctx.drawImage(source.image as CanvasImageSource, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    pixelHueShift(imageData.data, hueShiftDeg);
    ctx.putImageData(imageData, 0, 0);

    // Register the modified canvas as a new Phaser texture.
    const dstTexture = this.textures.addCanvas(destKey, canvas);
    if (!dstTexture) {
      console.warn(`createHueShiftedAtlas: addCanvas returned null for ${destKey}`);
      return;
    }

    // Copy frame geometry from the source atlas.  Frame positions are identical
    // because we only changed pixel colors, not the sprite layout.
    for (const [name, frame] of Object.entries(srcTexture.frames)) {
      if (name === '__BASE') continue;
      dstTexture.add(name, 0, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight);
    }
  }

  /**
   * Registers Phaser animations from the Aseprite JSON that was loaded with
   * `this.load.atlas()`.  Each tag in the JSON becomes one animation.
   *
   * @param textureKey  Which texture to reference in animation frames.
   * @param dataKey     Optional: read timing/tags from a different JSON key
   *                    (used when recolored textures share the base JSON).
   *                    Animation key prefix is replaced with `textureKey`.
   */
  private createAnimsFromAtlas(textureKey: string, dataKey?: string): void {
    const jsonKey = dataKey ?? textureKey;
    const data    = this.cache.json.get(jsonKey) as AseData | null;

    if (!data?.frames || !data.meta?.frameTags) {
      console.warn(`createAnimsFromAtlas: no JSON data for key "${jsonKey}"`);
      return;
    }

    for (const tag of data.meta.frameTags) {
      // When reusing base JSON for a variant texture, swap the character prefix
      // so "skald_idle_south" → "skald_warm_idle_south".
      const animKey = (dataKey && dataKey !== textureKey)
        ? textureKey + tag.name.substring(dataKey.length)
        : tag.name;

      const animFrames: { key: string; frame: string; duration: number }[] = [];
      let totalDuration = 0;
      for (let i = tag.from; i <= tag.to; i++) {
        const f = data.frames[i];
        if (!f) continue;
        const dur = f.duration ?? 100;
        animFrames.push({ key: textureKey, frame: f.filename, duration: dur });
        totalDuration += dur;
      }
      if (tag.direction === 'reverse') animFrames.reverse();

      if (this.anims.exists(animKey)) this.anims.remove(animKey);
      this.anims.create({
        key:      animKey,
        frames:   animFrames,
        duration: totalDuration,
        yoyo:     tag.direction === 'pingpong',
      });
    }
  }
}
