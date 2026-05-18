/**
 * theme.ts — Tech-Rune UI design tokens.
 *
 * Single source of truth for all UI colours, sizes, spacing, and typography.
 * No Phaser dependency — pure data constants.
 *
 * See docs/UI_STYLE_GUIDE.md for the full design rationale.
 */

// ── Colours (as 0x numbers for Phaser, and '#hex' strings for Text styles) ───

export const Color = {
  // Panel backgrounds
  panelBg:        0x0d0e1a,  // Deep Void
  panelBgWarm:    0x141210,  // Dark Ember
  panelBgSub:     0x1a1c2e,  // Slot Dark (reused for sub-panels)

  // Borders
  borderOuter:    0x2a2c3e,  // Slate Edge
  accentTech:     0x4dd4f0,  // Rune Teal
  accentFantasy:  0xc8922a,  // Amber Gold

  // Backdrops
  backdropBlack:  0x000000,
  backdropDanger: 0x220000,
  backdropSuccess:0x001100,

  // Semantic
  hp:             0xe03030,
  stamina:        0x40c0a0,
  essence:        0xaa66ff,
  positive:       0x88ff88,
  warning:        0xffaa33,
  danger:         0xff4444,

  // Slots
  slotBg:         0x1a1c2e,
  slotBorder:     0x3a3c52,
  slotHoverBg:    0x222438,
  slotSelected:   0x4dd4f0,  // = accentTech

  // Rarity borders
  rarityCommon:   0x9090a8,
  rarityUncommon: 0x40c0a0,
  rarityRare:     0x4488dd,
  rarityEpic:     0xaa66ff,
  rarityLegendary:0xc8922a,

  // Button fills
  btnBg:          0x1a1c2e,
  btnHoverBg:     0x222438,
  btnPressedBg:   0x161828,
  btnAccentBg:    0xc8922a,
  btnDangerBg:    0x331818,
} as const;

/** Hex-string versions for Phaser Text styles (which use CSS colour strings). */
export const TextColor = {
  primary:     '#f0f0e8',  // Warm White
  secondary:   '#9090a8',  // Muted Grey
  interactive: '#ffe066',  // Button Gold
  hover:       '#ffffff',  // Pure White
  positive:    '#88ff88',
  warning:     '#ffaa33',
  danger:      '#ff4444',
  disabled:    '#606068',
  dark:        '#111111',  // For inverted/accent buttons
} as const;

// ── Spacing (4px base grid) ──────────────────────────────────────────────────

export const Space = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  24,
  xxl: 32,
} as const;

// ── Component sizes ──────────────────────────────────────────────────────────

export const Size = {
  // Slots
  slot:           56,
  slotIconPad:    12,   // (56 - 32) / 2
  slotGap:        4,

  // Buttons
  btnMinHeight:   48,
  btnPadX:        12,
  btnPadY:        8,
  btnClose:       28,
  btnArrow:       28,

  // Tabs
  tabHeight:      44,

  // Bars
  barWidth:       140,
  barHeight:      12,
  barTrackH:      16,   // barHeight + 2px border top/bottom
  barIconSize:    16,

  // HUD
  deploySlot:     40,
  deployGap:      6,
  buildBtn:       44,
  buildGap:       6,
  badgeSize:      40,

  // Joystick
  joystickBase:   40,   // radius
  joystickThumb:  14,   // radius
  actionBtn:      28,   // radius
} as const;

// ── Panel size classes ───────────────────────────────────────────────────────

export const PanelSize = {
  small:  { w: 300, h: 280 },   // Pause, Settings, GameOver, LevelComplete
  medium: { w: 400, h: 400 },   // Shop, Stats, Upgrades
  large:  { w: 500, h: 400 },   // Lore
  full:   { w: 720, h: 520 },   // Crafting, Discovery
} as const;

// ── Typography ───────────────────────────────────────────────────────────────

const PIXEL_FONT = '"Silkscreen", monospace';
const SYSTEM_FONT = 'sans-serif';

export const Font = {
  logo:    { fontFamily: PIXEL_FONT, fontSize: '48px', fontStyle: 'bold' },
  title:   { fontFamily: PIXEL_FONT, fontSize: '22px', fontStyle: 'bold' },
  heading: { fontFamily: PIXEL_FONT, fontSize: '16px', fontStyle: 'bold' },
  label:   { fontFamily: SYSTEM_FONT, fontSize: '13px', fontStyle: 'bold' },
  body:    { fontFamily: SYSTEM_FONT, fontSize: '12px', fontStyle: 'normal' },
  small:   { fontFamily: SYSTEM_FONT, fontSize: '10px', fontStyle: 'normal' },
  tiny:    { fontFamily: SYSTEM_FONT, fontSize: '8px',  fontStyle: 'normal' },
} as const;

// ── Borders ──────────────────────────────────────────────────────────────────

export const Border = {
  panelOuter:   { width: 1, radius: 4 },
  panelInner:   { width: 1, radius: 3 },   // inset 1px from outer
  button:       { width: 1, radius: 4 },
  slot:         { width: 1, radius: 4, selectedWidth: 2 },
  tooltip:      { width: 1, radius: 3 },
  bar:          { width: 1, radius: 2 },
  chip:         { width: 1, radius: 4 },
} as const;

// ── Nine-slice margins ───────────────────────────────────────────────────────

export const NineSlice = {
  panel:   { left: 8, right: 8, top: 8, bottom: 8 },
  tooltip: { left: 6, right: 6, top: 6, bottom: 6 },
  button:  { left: 6, right: 6, top: 6, bottom: 6 },
  bar:     { left: 6, right: 6, top: 2, bottom: 2 },
} as const;

// ── Depth layers ─────────────────────────────────────────────────────────────

export const Depth = {
  HUD:       300,
  HUD_ABOVE: 310,
  OVERLAY:   800,
  CRAFTING:  900,
  TOAST:     100_000,
} as const;

// ── Animation ────────────────────────────────────────────────────────────────

export const Anim = {
  /** Backdrop fade-in duration (ms). */
  backdropFadeMs: 150,
  /** Panel slide/scale-in duration (ms). */
  panelEnterMs:   200,
  /** HUD auto-fade delay when idle (ms). */
  hudFadeDelayMs: 5_000,
  /** HUD idle opacity (0 = hidden, 1 = fully visible). */
  hudIdleAlpha:   0.3,
} as const;
