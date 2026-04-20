/**
 * Level 2 configuration — The Spine Reaches (Spinaria dominant).
 *
 * ## Setting: A former Earth city consumed by Spinaria biology
 *
 * What used to be a city is no longer recognisable as one. Earth ruins
 * stand as scaffolding for something that has grown around and through
 * them — enormous evolved arthropods, bioluminescent fungal networks,
 * tunnel openings that exhale warm humid air. Bioluminescent forest.
 * Loud, alive, overwhelming.
 *
 * The Blight — Spinaria's strain of the Skymning — severs the
 * interdependencies that kept the ecosystem alive. Fungal networks stop
 * sharing nutrients. Predators hunt without selection. Hive minds
 * fragment into isolated bodies acting on individual panic. The result
 * is not chaos but monoculture: one organism consuming everything until
 * there is nothing left.
 *
 * The player arrives through a tear in reality, from the northeast of
 * Höga Kusten. Nothing here is familiar. Even the light is wrong —
 * bioluminescence instead of sunlight, and the sky (where it is visible)
 * is the colour of old amber.
 *
 * ## Zone layout (world coordinates, 4500×3000 world)
 *
 *  Zone 1 — Ruinekanten (The Ruined Edge)
 *    Entry zone. Earth ruins with Spinaria biology growing through
 *    them — concrete pillars wrapped in chitinous shell, collapsed
 *    buildings serving as habitat for creatures that never evolved for
 *    open-air existence. Static and Blight corruption blend here.
 *
 *  Zone 2 — Lyslunden (The Bioluminescent Grove)
 *    The Spinaria canopy fully established. Enormous arthropods move
 *    through the upper tiers; fungal mats underfoot pulse faintly with
 *    mana. Pure Blight corruption — the ecosystem is fragmenting.
 *
 *  Zone 3 — Sporhvälvet (The Spore Vault)
 *    Deep Spinaria territory near the next portal. Pockets of
 *    Mistheim bleed begin appearing: magical springs that flow
 *    upward, water pooling on vertical surfaces. Two worlds' bleeds
 *    colliding.
 *
 * ## Collectibles
 *  Three objects, one per zone. Artifacts of the blended world —
 *  no map marker, found by curiosity.
 *
 * ## Survivor meeting
 *  Walking within 100px of MEETING_POINT triggers a dialog with the
 *  first non-Earth survivors the player encounters. Communication is
 *  difficult — Spinaria peoples do not use language in the same way.
 *  Ends with three path-choice buttons reflecting which world's approach
 *  the player chooses to take forward.
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
    // Ruinekanten — entry zone where Earth ruins meet Spinaria biology.
    // Static + Blight corruption at their worst: infrastructure and ecosystem
    // both fragmenting simultaneously.
    id: 'zone-ruins',
    x: 0, y: 2100, w: 900, h: 900,
    corruption: 70,
    tintColor: 0x2a1a0a,  // dark amber-rust (Earth decay + Spinaria warmth)
    tintAlpha: 0.04,
  },
  {
    // Lyslunden — the bioluminescent grove, full Spinaria dominance.
    // Deep purple-teal glow. Arthropods the size of cattle. Fungal mats
    // that consume everything that stays still too long.
    id: 'zone-canopy',
    x: 1500, y: 900, w: 1200, h: 1000,
    corruption: 50,
    tintColor: 0x1a0a2a,  // deep purple (bioluminescent Spinaria)
    tintAlpha: 0.03,
  },
  {
    // Sporhvälvet — spore vault near the portal. Where two worlds' bleeds
    // collide: Blight corruption and the first signs of Dry (Mistheim).
    // Water flows sideways. Spore clouds drift through magical springs.
    id: 'zone-sporefall',
    x: 3300, y: 200, w: 1200, h: 800,
    corruption: 60,
    tintColor: 0x1a2a1a,  // sickly green (Blight + emerging Dry)
    tintAlpha: 0.03,
  },
];

// ── Collectibles ───────────────────────────────────────────────────────────────

export const COLLECTIBLES: Collectible[] = [
  {
    id: 'item-ruins',
    x: 350, y: 2500,
    // A corroded machine component, still faintly warm. Stamped with a
    // manufacturer's mark — a company from a city that no longer exists
    // as a city.
    label: 'Maskindelen',
    zoneId: 'zone-ruins',
  },
  {
    id: 'item-canopy',
    x: 2100, y: 1400,
    // A shed carapace plate the size of a palm, still faintly glowing at
    // the seams. The mana-glow pulses at an interval that feels almost
    // like a heartbeat — but the rhythm is not quite right.
    label: 'Skalplattan',
    zoneId: 'zone-canopy',
  },
  {
    id: 'item-sporefall',
    x: 3800, y: 550,
    // A crystal of deep-rock mana pulled loose by the tearing of the
    // dimensional membrane. It hums at a frequency you feel in your
    // teeth, not your ears.
    label: 'Djupkristallen',
    zoneId: 'zone-sporefall',
  },
  // ── Secrets ───────────────────────────────────────────────────────────────────
  {
    id: 'secret-1',
    x: 900, y: 1700,
    // The keycard of a building that no longer has walls. The photo on
    // the back shows someone smiling in front of a glass entrance.
    label: 'Passkortet',
    zoneId: '',
  },
  {
    id: 'secret-2',
    x: 2800, y: 2200,
    // A colony marker — a chemical signal post left by a tunnel-borer
    // colony to mark territory. Touching it triggers a brief,
    // disorienting sensation of shared awareness.
    label: 'Kolonimärket',
    zoneId: '',
  },
];

// ── Secrets and zone markers ───────────────────────────────────────────────────

/**
 * Positions of secret collectibles — used to stamp HIDDEN_HOLLOW chunks and
 * to add a faint hint circle during world generation.
 */
export const SECRET_POSITIONS: Array<{ x: number; y: number; label: string }> = [
  { x:  900, y: 1700, label: 'Passkortet'   },
  { x: 2800, y: 2200, label: 'Kolonimärket' },
];

/**
 * Positions where the zone character shifts — marked with WAYMARKER_STONE
 * chunks so the player gets a subtle cue that the world is changing.
 *
 *   (1300, 1800) — ruins → canopy: where the last recognisable wall gives way
 *   (3100, 1000) — canopy → sporefall: where spore density becomes visible
 */
export const ZONE_BOUNDARY_MARKERS: Array<{ x: number; y: number }> = [
  { x: 1300, y: 1800 },
  { x: 3100, y: 1000 },
];

// ── Survivor meeting ───────────────────────────────────────────────────────────

/** Player must walk within this radius (px) of MEETING_POINT to trigger dialog */
export const MEETING_RADIUS = 100;

/** World position of the meeting trigger, near the portal */
export const MEETING_POINT = { x: 3800, y: 480 };

/**
 * Three paths — each a different approach to what the player has encountered.
 * Choice is stored for use in later levels.
 */
export type PathChoice = 'jordens' | 'spinolandets' | 'vattenpandalandets';

export const PATH_CHOICES: Array<{ id: PathChoice; label: string }> = [
  { id: 'jordens',            label: 'Maskinernas väg' },   // way of the machines
  { id: 'spinolandets',       label: 'Koloniernas väg' },   // way of the colonies
  { id: 'vattenpandalandets', label: 'Vattnets väg' },      // way of the water
];

/**
 * Returns the opening dialog line for the survivor meeting.
 * Varies based on how many collectibles the player found — reflecting
 * how carefully they moved through the Spine Reaches.
 */
export function meetingOpeningLine(itemsFound: number): string {
  if (itemsFound === 0) return 'Du luktade annorlunda redan innan du kom hit. Earth-lukt.';
  if (itemsFound === 1) return 'Du bar på något när du gick in. Det märktes på hur kolonin reagerade.';
  if (itemsFound === 2) return 'Maskindelen och plattan. Du rörde vid båda världarna innan du kom hit.';
  return 'Tre föremål. Du förstår mer än du tror — men du förstår ännu inte vad vi är.';
}

/** Passive cleanse rate in zone-sporefall (% per ms) */
export const PASSIVE_CLEANSE_RATE = 0.002;
/** Cap on passive cleanse contribution (%) */
export const PASSIVE_CLEANSE_CAP = 20;

// ── Settlements ────────────────────────────────────────────────────────────────

/**
 * A location significant enough to anchor on the map.
 *
 * In Spinaria-dominant territory the social structure is different:
 * there are Earth survivor outposts and cross-world meeting points,
 * but no permanent villages in the Earth sense.
 *
 *  - outpost: fortified Earth survivor camp in alien territory
 *  - hamlet:  small cross-world meeting point or shelter
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
  type: 'hamlet' | 'outpost';
}

export const SETTLEMENTS: Settlement[] = [
  {
    // Järnskansen — a fortified Earth survivor camp built inside a
    // collapsed parking structure. The walls are cars, stacked and welded.
    // Inside it smells like machine oil, dried food, and too many people.
    id: 'jarnskansen',
    name: 'Järnskansen',
    x: 600,
    y: 2400,
    radius: 140,
    type: 'outpost',
  },
  {
    // Lysgläntan — a meeting point in a natural clearing in the
    // bioluminescent grove. Both Earth and Spinaria creatures avoid
    // the clearing's centre; nobody knows why. People leave offerings.
    id: 'lysglantan',
    name: 'Lysgläntan',
    x: 2100,
    y: 1500,
    radius: 160,
    type: 'hamlet',
  },
  {
    // Porthuset — the building closest to the tear. Nobody lives here
    // permanently. Travelers rest, leave marks on the walls, and move on.
    // The walls are covered in three scripts: Swedish, Spinaria
    // chemical-symbols, and something that arrived from the third world.
    id: 'porthuset',
    name: 'Porthuset',
    x: 3900,
    y: 600,
    radius: 110,
    type: 'outpost',
  },
];
