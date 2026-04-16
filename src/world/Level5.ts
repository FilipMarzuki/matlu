/**
 * Level 5 configuration — The Source (Ground zero).
 *
 * ## Setting: The wound itself
 *
 * No birdsong. No wind. The landscape is all three worlds simultaneously
 * and none of them. The Skymning is visible as a physical presence — a
 * darkness that has colour in it. Not black: something deeper than black
 * that the eye keeps trying to resolve into a shape.
 *
 * The player is here to confront what broke the Skymning. Not a villain.
 * Not a monster. A machine or a ritual from before the apocalypse, still
 * running, still amplifying. It did not mean to do this. Meaning does not
 * enter into it.
 *
 * The most powerful tier of each world's enemies guards this space. No
 * swarm enemies — everything here is meaningful. Cross-world hybrids.
 * Nothing in Level 5 is filler.
 *
 * ## The final choice
 *
 * Can the worlds be separated again, or must they learn to exist as one
 * blended world? The ending depends on the player's choice — or on how
 * well they played.
 *
 * Three possible outcomes (driven by alignment and final choice):
 *
 *  - Separation (jordens): the worlds are pulled apart. Each world loses
 *    what it gained from the blending. The player returns to a world
 *    that is intact and smaller.
 *
 *  - Integration (spinolandets): the worlds are left blended. The Skymning
 *    is diminished but not gone. A hybrid ecology begins. Nobody knows
 *    what comes next.
 *
 *  - Silencing (vattenpandalandets): the Source is destroyed. The worlds
 *    remain blended but the amplification stops. The corruption fades
 *    slowly over years. The most costly choice — it requires something
 *    the player carried from the beginning.
 *
 * ## Zone layout (world coordinates, 4500×3000 world)
 *
 *  Zone 1 — Yttersåret (The Outer Wound)
 *    Entry zone — the approach to the Source across blighted ground. The
 *    three corruption strains have merged here into something that has no
 *    name in any of the three worlds. The most hostile environment in the
 *    game. The most powerful enemies guard this space.
 *
 *  Zone 2 — Källan (The Source)
 *    Ground zero. The machine or ritual. No swarm enemies here —
 *    everything in this zone is singular and present. The Source itself
 *    is at the centre.
 *
 * ## Collectibles
 *  Two objects mark the path. There are no casual curiosities in Level 5 —
 *  only evidence, and the thing the player carried here without knowing it.
 *
 * ## The Source confrontation
 *  Reaching MEETING_POINT triggers the final confrontation.
 *  The ending is determined by alignment scores accumulated across all
 *  five levels and by which final choice the player makes here.
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
    // Yttersåret — the outer wound. The three corruption strains operate
    // simultaneously. The ground is neither Earth, Spinaria, nor
    // Mistheim. It is scar tissue. The most dangerous zone in
    // the game.
    id: 'zone-outer-wound',
    x: 0, y: 1500, w: 2000, h: 1500,
    corruption: 95,
    tintColor: 0x020204,  // near-absolute void
    tintAlpha: 0.07,
  },
  {
    // Källan — the Source. Ground zero. The machine or ritual, still
    // running. The Skymning is visible here as a physical presence. The
    // Source light overrides the darkness at the very centre — rendering
    // should treat tintColor here as a base, not a ceiling.
    id: 'zone-source',
    x: 1800, y: 400, w: 2700, h: 2200,
    corruption: 100,
    tintColor: 0x000000,  // absolute void (overridden at centre by Source light)
    tintAlpha: 0.08,
  },
];

// ── Collectibles ───────────────────────────────────────────────────────────────
// There are no casual collectibles in Level 5 — only evidence.

export const COLLECTIBLES: Collectible[] = [
  {
    id: 'item-wound',
    x: 800, y: 2200,
    // The last object that still carries the world the player came from.
    // What it is depends on how the player walked here — but it brought
    // itself to this place, drawn by the Source. It is necessary for
    // the final choice.
    label: 'Det Sista Föremålet',
    zoneId: 'zone-outer-wound',
  },
  {
    id: 'item-source-edge',
    x: 2800, y: 1800,
    // A fragment of the Source mechanism at the perimeter — broken off,
    // left behind. Still active. It shows, in a way that cannot be put
    // into a label, what the Source was originally built to do.
    // Not malice. Purpose.
    label: 'Källans Kant',
    zoneId: 'zone-source',
  },
];

// No secrets in Level 5 — there are no hidden things here.
// Everything hidden has already been found. What remains is visible.
export const SECRET_POSITIONS: Array<{ x: number; y: number; label: string }> = [];

/**
 * One zone boundary marker: the moment the Source becomes visible,
 * at the transition from outer wound to the Source zone.
 */
export const ZONE_BOUNDARY_MARKERS: Array<{ x: number; y: number }> = [
  { x: 1900, y: 1500 },  // outer wound → source: where the machine becomes visible
];

// ── The Source confrontation ────────────────────────────────────────────────────

/**
 * Larger trigger radius than previous levels — the Source announces itself
 * before the player reaches it. The player should feel the pull.
 */
export const MEETING_RADIUS = 150;

/** World position of the final confrontation trigger, at the Source centre */
export const MEETING_POINT = { x: 3200, y: 1200 };

/**
 * Three paths — what the player chooses to do with the Source.
 * Unlike previous levels, these choices have irreversible consequences
 * and determine the ending.
 */
export type PathChoice = 'jordens' | 'spinolandets' | 'vattenpandalandets';

export const PATH_CHOICES: Array<{ id: PathChoice; label: string }> = [
  { id: 'jordens',            label: 'Separera världarna' },      // separate the worlds
  { id: 'spinolandets',       label: 'Lämna dem sammanvävda' },   // leave them blended
  { id: 'vattenpandalandets', label: 'Tysta källan' },            // silence the Source
];

/**
 * Returns the response when the player reaches the Source.
 * The Source does not speak — but it responds. What the player hears
 * depends on how carefully they walked here.
 *
 * Level 5 has only two collectibles, so the range is 0–2.
 */
export function meetingOpeningLine(itemsFound: number): string {
  if (itemsFound === 0) return 'Det händer ingenting. Det är redan i rörelse.';
  if (itemsFound === 1) return 'Du är här. Det räcker.';
  return 'Du bär på beviset. Det är tillräckligt för ett val.';
}

/** Passive cleanse rate in zone-source (% per ms)
 *  Extremely slow — the Source actively resists. */
export const PASSIVE_CLEANSE_RATE = 0.0005;
/** Cap on passive cleanse contribution (%) */
export const PASSIVE_CLEANSE_CAP = 10;

// ── No settlements at the Source ───────────────────────────────────────────────

/**
 * There are no settlements in Level 5. There are traces — the remains of
 * expeditions: Pandor scholars who came to understand, Earth scavengers
 * who came for salvage, Spinaria scouts sent to map the tear. None of
 * them established settlements. Some of them left marks.
 *
 *  - trace: a campfire ring, a discarded pack, a sleeping position —
 *    evidence that someone was here before the player and did not return
 */
export interface Settlement {
  id: string;
  /** Name shown as a label on the map */
  name: string;
  /** World-space centre x */
  x: number;
  /** World-space centre y */
  y: number;
  /** Boundary radius in pixels */
  radius: number;
  type: 'trace';
}

export const SETTLEMENTS: Settlement[] = [
  {
    // Sista Fotspåren — the last camp. A firepit ring, a sleeping position,
    // a pile of objects from three worlds, discarded at the threshold.
    // The person who made this camp reached the Source before the player.
    // They did not come back.
    id: 'sista-fotsparen',
    name: 'Sista Fotspåren',
    x: 1200,
    y: 2100,
    radius: 80,
    type: 'trace',
  },
];
