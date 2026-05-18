/**
 * UIFactory.ts — shared factory functions for all UI elements.
 *
 * Scenes import these instead of hand-rolling rectangles and text.
 * Every function uses design tokens from theme.ts, ensuring consistency
 * across the entire game.
 *
 * Usage:
 *   import { UI } from '../ui/UIFactory';
 *   const panel = UI.makePanel(this, cx, cy, 400, 300, 'system');
 *   const btn = UI.makeButton(this, cx, cy, 'START', () => startGame());
 */

import {
  Color, TextColor, Space, Size, Font, Border, Depth, Anim,
  NineSlice,
} from './theme';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PanelResult {
  bg: Phaser.GameObjects.Rectangle;
  border: Phaser.GameObjects.Graphics;
  /** Convenience: destroy both objects. */
  destroy: () => void;
}

export interface ButtonOptions {
  /** Override default fixedWidth (auto-sized if omitted). */
  fixedWidth?: number;
  /** Font config override. Defaults to Font.label. */
  font?: typeof Font.label;
  /** Depth override. */
  depth?: number;
  /** ScrollFactor override (set to 0 for HUD overlays). */
  scrollFactor?: number;
  /** Button variant. Defaults to 'primary'. */
  variant?: 'primary' | 'accent' | 'danger';
  /** Disable the button (non-interactive, muted style). */
  disabled?: boolean;
}

export interface SlotResult {
  bg: Phaser.GameObjects.Rectangle;
  border: Phaser.GameObjects.Rectangle;
  /** Call to switch to selected state. */
  select: () => void;
  /** Call to switch back to default state. */
  deselect: () => void;
  /** The container zone for interaction (same position/size as the slot). */
  zone: Phaser.GameObjects.Zone;
  destroy: () => void;
}

export interface BarResult {
  track: Phaser.GameObjects.Rectangle;
  fill: Phaser.GameObjects.Rectangle;
  /** Set the fill proportion (0–1). */
  setProgress: (pct: number) => void;
  destroy: () => void;
}

export interface TabOptions {
  /** Colour for the active underline (as 0x number). */
  color: number;
}

// ── Sound helpers ────────────────────────────────────────────────────────────

function playHoverSfx(scene: Phaser.Scene): void {
  const sfx = scene.sound.get('sfx-hover') ?? scene.sound.get('hover');
  if (sfx) sfx.play({ volume: 0.18 });
}

function playClickSfx(scene: Phaser.Scene): void {
  const sfx = scene.sound.get('sfx-click') ?? scene.sound.get('click');
  if (sfx) sfx.play({ volume: 0.4 });
}

// ── Factory functions ────────────────────────────────────────────────────────

/**
 * Create a full-screen dimming backdrop.
 * Click handler is optional — pass `onClose` to make it dismissible.
 */
function makeBackdrop(
  scene: Phaser.Scene,
  alpha = 0.78,
  tint: number = Color.backdropBlack,
  onClose?: () => void,
): Phaser.GameObjects.Rectangle {
  const { width, height } = scene.cameras.main;
  const bg = scene.add.rectangle(width / 2, height / 2, width, height, tint, alpha)
    .setDepth(Depth.OVERLAY - 1)
    .setScrollFactor(0);

  if (onClose) {
    bg.setInteractive().on('pointerdown', onClose);
  }

  return bg;
}

/**
 * Create a panel with the Tech-Rune double-border.
 *
 * @param variant 'system' (teal accent) | 'fantasy' (gold accent) |
 *                'danger' (red) | 'success' (green) | 'sub' (subtle)
 */
/** Sprite texture keys for nine-slice panel variants (loaded in preload). */
const PANEL_TEXTURE: Record<string, string> = {
  system:  'ui-panel-system-9s',
  fantasy: 'ui-panel-fantasy-9s',
  tooltip: 'ui-panel-tooltip-9s',
};

function makePanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  variant: 'system' | 'fantasy' | 'danger' | 'success' | 'sub' = 'system',
  depth: number = Depth.OVERLAY,
): PanelResult {
  const textureKey = PANEL_TEXTURE[variant];
  const hasTexture = textureKey && scene.textures.exists(textureKey);

  if (hasTexture) {
    // ── Nine-slice sprite panel (preferred) ──────────────────────────
    const m = NineSlice.panel;
    const ns = scene.add.nineslice(
      x, y, textureKey, undefined,
      w, h, m.left, m.right, m.top, m.bottom,
    )
      .setDepth(depth)
      .setScrollFactor(0)
      .setInteractive();

    // NineSlice doesn't have a separate border object — return a
    // no-op Graphics stub so the PanelResult interface stays consistent.
    const gfx = scene.add.graphics().setDepth(depth + 1).setScrollFactor(0);

    return {
      bg: ns as unknown as Phaser.GameObjects.Rectangle,
      border: gfx,
      destroy() {
        ns.destroy();
        gfx.destroy();
      },
    };
  }

  // ── Graphics fallback (for variants without sprites yet) ───────────
  const accentMap: Record<string, number> = {
    system:  Color.accentTech,
    fantasy: Color.accentFantasy,
    danger:  Color.danger,
    success: Color.positive,
    sub:     Color.borderOuter,
  };
  const accent = accentMap[variant];

  // Background fill
  const bg = scene.add.rectangle(x, y, w, h, Color.panelBg, 0.95)
    .setDepth(depth)
    .setScrollFactor(0);

  // Swallow clicks so they don't pass through to the backdrop
  bg.setInteractive();

  // Double border via Graphics
  const gfx = scene.add.graphics().setDepth(depth + 1).setScrollFactor(0);
  const left = x - w / 2;
  const top = y - h / 2;

  // Outer border
  gfx.lineStyle(Border.panelOuter.width, Color.borderOuter, 0.8);
  gfx.strokeRoundedRect(left, top, w, h, Border.panelOuter.radius);

  // Inner accent border (inset 2px)
  gfx.lineStyle(Border.panelInner.width, accent, 0.6);
  gfx.strokeRoundedRect(left + 2, top + 2, w - 4, h - 4, Border.panelInner.radius);

  return {
    bg,
    border: gfx,
    destroy() {
      bg.destroy();
      gfx.destroy();
    },
  };
}

/**
 * Preload UI sprite assets. Call this in any scene's preload() that uses
 * nine-slice panels or sprite-based UI elements.
 */
function preloadUI(scene: Phaser.Scene): void {
  scene.load.image('ui-panel-system-9s', '/assets/sprites/ui/ui-panel-system-9s.png');
  scene.load.image('ui-panel-fantasy-9s', '/assets/sprites/ui/ui-panel-fantasy-9s.png');
  // Add more UI sprites here as they're created:
  // scene.load.image('ui-panel-tooltip-9s', '/assets/sprites/ui/ui-panel-tooltip-9s.png');
}

/**
 * Create a styled button.
 *
 * Returns a Phaser Text object with hover/click wiring and consistent styling.
 */
function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  opts: ButtonOptions = {},
): Phaser.GameObjects.Text {
  const {
    fixedWidth,
    font = Font.label,
    depth = Depth.OVERLAY + 2,
    scrollFactor = 0,
    variant = 'primary',
    disabled = false,
  } = opts;

  // Determine colours based on variant
  const colorMap = {
    primary: { normal: TextColor.interactive, hover: TextColor.hover, bg: '#1a1c2ecc' },
    accent:  { normal: TextColor.dark, hover: TextColor.dark, bg: '#c8922acc' },
    danger:  { normal: TextColor.danger, hover: TextColor.hover, bg: '#331818cc' },
  };
  const colors = colorMap[variant];

  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    ...font,
    color: disabled ? TextColor.disabled : colors.normal,
    backgroundColor: disabled ? '#1a1c2e66' : colors.bg,
    padding: { x: Size.btnPadX, y: Size.btnPadY },
    align: 'center',
    fixedWidth: fixedWidth ?? undefined,
  };

  const btn = scene.add.text(x, y, label, style)
    .setOrigin(0.5)
    .setDepth(depth)
    .setScrollFactor(scrollFactor);

  if (disabled) {
    btn.setAlpha(0.4);
    return btn;
  }

  btn.setInteractive({ useHandCursor: true });

  btn.on('pointerover', () => {
    btn.setStyle({ color: colors.hover });
    playHoverSfx(scene);
  });

  btn.on('pointerout', () => {
    btn.setStyle({ color: colors.normal });
  });

  btn.on('pointerdown', () => {
    playClickSfx(scene);
    onClick();
  });

  return btn;
}

/**
 * Create a close (X) button, positioned in the top-right of a panel.
 */
function makeCloseButton(
  scene: Phaser.Scene,
  panelX: number,
  panelY: number,
  panelW: number,
  panelH: number,
  onClose: () => void,
  depth = Depth.OVERLAY + 2,
): Phaser.GameObjects.Text {
  const x = panelX + panelW / 2 - Space.md;
  const y = panelY - panelH / 2 + Space.md;

  const btn = scene.add.text(x, y, '\u2715', {
    ...Font.heading,
    color: TextColor.secondary,
    padding: { x: 4, y: 2 },
  })
    .setOrigin(0.5)
    .setDepth(depth)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });

  btn.on('pointerover', () => {
    btn.setStyle({ color: TextColor.hover });
    playHoverSfx(scene);
  });
  btn.on('pointerout', () => {
    btn.setStyle({ color: TextColor.secondary });
  });
  btn.on('pointerdown', () => {
    playClickSfx(scene);
    onClose();
  });

  return btn;
}

/**
 * Create an inventory/item slot.
 */
function makeSlot(
  scene: Phaser.Scene,
  x: number,
  y: number,
  depth = Depth.OVERLAY + 1,
): SlotResult {
  const s = Size.slot;

  const bg = scene.add.rectangle(x, y, s, s, Color.slotBg, 0.8)
    .setDepth(depth)
    .setScrollFactor(0);

  const border = scene.add.rectangle(x, y, s, s)
    .setStrokeStyle(Border.slot.width, Color.slotBorder, 0.8)
    .setFillStyle(0x000000, 0)   // transparent fill — border only
    .setDepth(depth + 1)
    .setScrollFactor(0);

  const zone = scene.add.zone(x, y, s, s)
    .setDepth(depth + 2)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });

  // Hover effect
  zone.on('pointerover', () => {
    bg.setFillStyle(Color.slotHoverBg, 0.9);
    border.setStrokeStyle(Border.slot.width, Color.accentTech, 0.8);
  });
  zone.on('pointerout', () => {
    bg.setFillStyle(Color.slotBg, 0.8);
    border.setStrokeStyle(Border.slot.width, Color.slotBorder, 0.8);
  });

  return {
    bg,
    border,
    zone,
    select() {
      border.setStrokeStyle(Border.slot.selectedWidth, Color.slotSelected, 1.0);
    },
    deselect() {
      border.setStrokeStyle(Border.slot.width, Color.slotBorder, 0.8);
    },
    destroy() {
      bg.destroy();
      border.destroy();
      zone.destroy();
    },
  };
}

/**
 * Create a horizontal resource bar (HP, stamina, essence, etc.).
 *
 * @param fillColor The bar fill colour (e.g. Color.hp, Color.stamina).
 */
function makeBar(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  fillColor: number,
  depth = Depth.HUD,
): BarResult {
  const h = Size.barHeight;
  const trackH = Size.barTrackH;

  // Track (background)
  const track = scene.add.rectangle(x, y, width, trackH, Color.panelBg, 0.9)
    .setOrigin(0, 0.5)
    .setDepth(depth)
    .setScrollFactor(0)
    .setStrokeStyle(Border.bar.width, Color.borderOuter, 0.6);

  // Fill (foreground)
  const fill = scene.add.rectangle(
    x + Border.bar.width + 1, y, width - 4, h, fillColor, 0.9,
  )
    .setOrigin(0, 0.5)
    .setDepth(depth + 1)
    .setScrollFactor(0);

  const maxFillW = width - 4;

  return {
    track,
    fill,
    setProgress(pct: number) {
      fill.width = Math.max(0, Math.min(1, pct)) * maxFillW;
    },
    destroy() {
      track.destroy();
      fill.destroy();
    },
  };
}

/**
 * Create a scene title (e.g. "PAUSE", "CRAFTING").
 */
function makeTitle(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  depth = Depth.OVERLAY + 2,
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text.toUpperCase(), {
    ...Font.title,
    color: TextColor.primary,
  })
    .setOrigin(0.5)
    .setDepth(depth)
    .setScrollFactor(0);
}

/**
 * Create a horizontal divider line.
 */
function makeDivider(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  depth = Depth.OVERLAY + 1,
): Phaser.GameObjects.Graphics {
  const gfx = scene.add.graphics()
    .setDepth(depth)
    .setScrollFactor(0);
  gfx.lineStyle(1, 0xffffff, 0.10);
  gfx.lineBetween(x - width / 2, y, x + width / 2, y);
  return gfx;
}

/**
 * Create body text with standard styling.
 */
function makeText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  style: 'body' | 'small' | 'tiny' | 'heading' | 'label' = 'body',
  color = TextColor.primary,
  depth = Depth.OVERLAY + 2,
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, {
    ...Font[style],
    color,
    wordWrap: { width: 600 },
  })
    .setDepth(depth)
    .setScrollFactor(0);
}

// ── Public API ───────────────────────────────────────────────────────────────

export const UI = {
  preloadUI,
  makeBackdrop,
  makePanel,
  makeButton,
  makeCloseButton,
  makeSlot,
  makeBar,
  makeTitle,
  makeDivider,
  makeText,

  // Re-export theme for convenience (scenes can do UI.Color.hp, etc.)
  Color,
  TextColor,
  Space,
  Size,
  Font,
  Border,
  Depth,
  Anim,
} as const;
