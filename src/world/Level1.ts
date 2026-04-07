/**
 * Level 1 configuration — zones, collectible items, and parent meeting dialog.
 *
 * Level 1 is the introduction level: no combat system, no abilities, no path
 * chosen yet. The child explores a world divided into three zones that differ
 * in corruption level and feel, accidentally cleanses something for the first
 * time, and eventually reaches the plateau where the parent is waiting.
 *
 * ## Zone layout (world coordinates, 2400×2000px usable area)
 *
 *   Zone 1 — Startplatsen   (corrupt 65%)   x 0–600,   y 700–1300
 *   Zone 2 — Skogen         (half-corrupt 35%) x 600–1600, y 500–1350
 *   Zone 3 — Platån         (clean 5%)      x 1600–2500, y 100–900
 *
 * The portal (FIL-11) sits at (2100, 220), inside Zone 3 — reaching the
 * portal area is the natural endpoint of Level 1.
 */

// ─── Zone definitions ─────────────────────────────────────────────────────────

export interface ZoneDef {
  id: string;
  x: number; y: number;
  w: number; h: number;
  /** 0–100 — how corrupted the zone starts */
  corruption: number;
  /** Hex color for the corruption tint overlay */
  tintColor: number;
  /** Alpha for the corruption tint overlay (0 = invisible) */
  tintAlpha: number;
}

export const ZONES: ZoneDef[] = [
  {
    id: 'zone1', x: 0, y: 700, w: 600, h: 600,
    corruption: 65, tintColor: 0x556677, tintAlpha: 0.32,
  },
  {
    id: 'zone2', x: 600, y: 500, w: 1000, h: 850,
    corruption: 35, tintColor: 0x667788, tintAlpha: 0.14,
  },
  {
    id: 'zone3', x: 1600, y: 100, w: 900, h: 800,
    corruption: 5, tintColor: 0x88ffcc, tintAlpha: 0.04,
  },
];

// ─── Collectible items ────────────────────────────────────────────────────────

export interface ItemDef {
  id: string;
  x: number; y: number;
  /** Main fill color */
  color: number;
  /** Glow/pulse color for the idle tween */
  glowColor: number;
  /** Short Swedish label shown when collected */
  label: string;
  /** Which zone this item belongs to */
  zoneId: string;
}

/**
 * Three things to find — one per world (Jordens, Spinolandet, Vattenpandalandet).
 * None are marked on any map. The child finds them through curiosity.
 */
export const ITEMS: ItemDef[] = [
  {
    id: 'jordens',
    x: 350, y: 1020,
    color: 0xcc7722, glowColor: 0xffaa44,
    label: 'En trasig motorpart',
    zoneId: 'zone1',
  },
  {
    id: 'spinolandet',
    x: 980, y: 830,
    color: 0x44aadd, glowColor: 0x88ddff,
    label: 'En jättefjäder',
    zoneId: 'zone2',
  },
  {
    id: 'vattenpandalandet',
    x: 2050, y: 430,
    color: 0x44ffaa, glowColor: 0xaaffdd,
    label: 'Något som glöder',
    zoneId: 'zone3',
  },
];

/** Radius in world-px within which the player picks up an item */
export const ITEM_PICKUP_RADIUS = 40;

// ─── Parent meeting ───────────────────────────────────────────────────────────

/** World position of the parent trigger zone (on the plateau near the portal) */
export const PARENT_TRIGGER_X = 2100;
export const PARENT_TRIGGER_Y = 370;
export const PARENT_TRIGGER_RADIUS = 100;

/**
 * What the parent says — varies by how many of the three things the child found.
 * Displayed as an array of sequential lines in DialogScene.
 */
export const PARENT_DIALOG_LINES: Record<number, string[]> = {
  0: [
    'Jag vet inte hur jag ska förklara det här.',
    'Det finns tre sätt jag sett folk hitta kraft i den här världen...',
    'Du måste välja.',
  ],
  1: [
    'Det där du bär — det är något.',
    'Det tillhör en av de tre...',
    'Du måste välja.',
  ],
  2: [
    'Du har sett mer av det här än jag har.',
    'Var hittade du allt det där?',
    'Du måste välja.',
  ],
  3: [
    '...',
    'Du har sett mer än jag.',
    'Du måste välja.',
  ],
};

/** The three paths the child can choose at the end of Level 1 */
export const PATH_CHOICES = [
  { id: 'jordens',           label: 'Jordens väg'            },
  { id: 'spinolandet',       label: 'Spinolandets väg'        },
  { id: 'vattenpandalandet', label: 'Vattenpandalandets väg'  },
];

// ─── Passive cleanse ──────────────────────────────────────────────────────────

/**
 * While standing in Zone 3, the cleanse bar fills passively at this rate.
 * Units: percent per millisecond. At 60 fps (delta≈16 ms) this gives
 * roughly 0.03 % per frame — 20 % maximum passive fill over ~11 seconds.
 */
export const PASSIVE_CLEANSE_RATE = 0.002;
export const PASSIVE_CLEANSE_CAP  = 20;
