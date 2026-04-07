/**
 * Level 1 configuration — zones, collectibles, and the story meeting.
 *
 * Level 1 is the introduction: no combat abilities yet. The player explores,
 * accidentally cleanses something via their first collectible pickup, and
 * eventually meets a character near the portal who asks them to choose a path.
 *
 * ## Zone layout (world coordinates, 8000×8000 world)
 *
 *  Zone 1 — Start area (Startplatsen)
 *    High corruption; dark grey-ash tint overlay. Player spawns here.
 *
 *  Zone 2 — The Forest (Skogen)
 *    Medium corruption; muted green tint. Transition zone.
 *
 *  Zone 3 — The Plateau (Platån)
 *    Near-clean; faint transparent tint. Contains the portal.
 *
 * ## Collectibles
 *  Three small pulsing circles, one per zone. No map marker — found by curiosity.
 *  On pickup the zone's corruption overlay fades and an expanding ring plays.
 *
 * ## Parent meeting
 *  Walking within 100px of MEETING_POINT near the portal triggers a dialog.
 *  The opening line varies by how many collectibles were found (0–3).
 *  Ends with three path-choice buttons — stored but no gameplay effect in Level 1.
 */

export interface Zone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Initial corruption 0–100 */
  corruption: number;
  /** Color of the overlay rectangle */
  tintColor: number;
  /** Initial alpha of the overlay */
  tintAlpha: number;
}

export interface Collectible {
  id: string;
  x: number;
  y: number;
  /** Human-readable name shown when picked up */
  label: string;
  /** Which zone this collectible belongs to */
  zoneId: string;
}

// ── Zones ──────────────────────────────────────────────────────────────────────

export const ZONES: Zone[] = [
  {
    id: 'zone-start',
    x: 0, y: 700, w: 600, h: 600,
    corruption: 65,
    tintColor: 0x303030,
    tintAlpha: 0.30,
  },
  {
    id: 'zone-forest',
    x: 600, y: 500, w: 1000, h: 850,
    corruption: 35,
    tintColor: 0x2a3a28,
    tintAlpha: 0.18,
  },
  {
    id: 'zone-plateau',
    x: 1600, y: 100, w: 900, h: 800,
    corruption: 5,
    tintColor: 0x506070,
    tintAlpha: 0.06,
  },
];

// ── Collectibles ───────────────────────────────────────────────────────────────

export const COLLECTIBLES: Collectible[] = [
  {
    id: 'item-start',
    x: 350, y: 1020,
    label: 'Jordens sak',
    zoneId: 'zone-start',
  },
  {
    id: 'item-forest',
    x: 980, y: 830,
    label: 'Spinolandets sak',
    zoneId: 'zone-forest',
  },
  {
    id: 'item-plateau',
    x: 2050, y: 430,
    label: 'Vattenpandalandets sak',
    zoneId: 'zone-plateau',
  },
];

// ── Parent meeting ─────────────────────────────────────────────────────────────

/** Player must walk within this radius (px) of MEETING_POINT to trigger dialog */
export const MEETING_RADIUS = 100;

/** World position of the meeting trigger, just before the portal */
export const MEETING_POINT = { x: 2100, y: 370 };

/** Path choices shown at the end of the meeting dialog */
export type PathChoice = 'jordens' | 'spinolandets' | 'vattenpandalandets';

export const PATH_CHOICES: Array<{ id: PathChoice; label: string }> = [
  { id: 'jordens',          label: 'Jordens väg' },
  { id: 'spinolandets',     label: 'Spinolandets väg' },
  { id: 'vattenpandalandets', label: 'Vattenpandalandets väg' },
];

/**
 * Returns the opening dialog line for the parent meeting.
 * Varies based on how many collectibles the player found.
 */
export function meetingOpeningLine(itemsFound: number): string {
  if (itemsFound === 0) return 'Jag vet inte hur jag ska förklara det här.';
  if (itemsFound === 1) return 'Det där du bär — det är något.';
  if (itemsFound === 2) return 'Du har sett mer av det här än jag har.';
  return '...';
}

/** Passive cleanse rate in Zone 3 — fills the cleanse bar slowly (% per ms) */
export const PASSIVE_CLEANSE_RATE = 0.002;
/** Cap on passive cleanse contribution (%) */
export const PASSIVE_CLEANSE_CAP = 20;
