/**
 * Level 4 configuration — The Seam (Convergence zone).
 *
 * ## Setting: All three worlds at equal weight
 *
 * The Seam is where the dimensional membranes have torn completely. No
 * single world dominates. A cliff is simultaneously granite (Earth),
 * chitinous shell (Spinolandet), and floating stone (Vattenpandalandet).
 * Visual instability. Physics uncertain in patches.
 *
 * In stable patches, the overlay resolves into something new — a hybrid
 * ecology that exists in none of the source worlds. In unstable patches,
 * the landscape flickers between what it was and what it is becoming.
 *
 * All three Skymning strains are present here at full strength: Static
 * (Earth), Blight (Spinolandet), Dry (Vattenpandalandet). They do not
 * cancel each other — they layer. Cross-world hybrid enemies appear here
 * for the first time: creatures that have absorbed elements from multiple
 * worlds (a Static-Blighted machine-organism, a Dry-Static corrupted
 * mage-soldier).
 *
 * ## Zone layout (world coordinates, 4500×3000 world)
 *
 *  Zone 1 — Jordfållen (The Earth Fold)
 *    Entry zone. An Earth-leaning patch near the point of arrival.
 *    Recognisable shapes: roads, building outlines, familiar tree forms.
 *    But the ground underfoot is warm, and the shadows do not fall the
 *    right way.
 *
 *  Zone 2 — Sömmen (The Seam)
 *    Central convergence — the Seam proper. All three world aesthetics
 *    at equal weight, sometimes simultaneously. Some patches stable;
 *    others flicker. Hybrid enemies spawn here. The air tastes like three
 *    things at once.
 *
 *  Zone 3 — Källnärmen (The Source Approach)
 *    Pre-source corridor. The player finds evidence of the cause: not a
 *    villain, but a machine or ritual from before the apocalypse, still
 *    running, still amplifying the Skymning. It is ahead.
 *
 * ## Collectibles
 *  Three hybrid artifacts, one per zone. Each exists in more than one
 *  world simultaneously and cannot be fully categorised.
 *
 * ## Final approach dialog
 *  Walking within 100px of MEETING_POINT shows the player what lies ahead.
 *  The thing at the Source is not an enemy. It is a system. The path
 *  choices here reflect what the player intends to do with that knowledge.
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
    // Jordfållen — the Earth fold. Entry zone. Familiar shapes are still
    // here, but wrong: roads that end mid-stride, trees with carapace
    // bark, a traffic sign half-submerged in a magical spring.
    id: 'zone-earthfold',
    x: 0, y: 2100, w: 1000, h: 900,
    corruption: 75,
    tintColor: 0x1a1a1a,  // near-black (all three strains present)
    tintAlpha: 0.05,
  },
  {
    // Sömmen — the Seam itself. World aesthetics shift as the player moves.
    // Stable patches: a new hybrid ecology forming. Unstable patches: the
    // landscape flickers. Hybrid enemies spawn anywhere in this zone.
    id: 'zone-seam',
    x: 1200, y: 800, w: 1800, h: 1400,
    corruption: 85,
    tintColor: 0x0a0a14,  // void-blue (convergence of all three corruptions)
    tintAlpha: 0.06,
  },
  {
    // Källnärmen — the Source approach. Quiet in a way that is wrong —
    // not peaceful quiet, but absence-of-sound quiet. Some of the
    // amplification mechanism is visible here. Some of it is still running.
    id: 'zone-source-approach',
    x: 3200, y: 100, w: 1300, h: 800,
    corruption: 90,
    tintColor: 0x050508,  // near-void
    tintAlpha: 0.06,
  },
];

// ── Collectibles ───────────────────────────────────────────────────────────────

export const COLLECTIBLES: Collectible[] = [
  {
    id: 'item-earthfold',
    x: 400, y: 2500,
    // A machine component that has grown biological structures from its
    // surface — mana-organs, crystalline and translucent, emerging from
    // industrial steel as if they had always been there. Still warm.
    // Both things simultaneously. Neither thing completely.
    label: 'Hybridkomponenten',
    zoneId: 'zone-earthfold',
  },
  {
    id: 'item-seam',
    x: 2100, y: 1500,
    // A carapace shard with panda script carved into its inner surface.
    // The script describes an arthropod. The arthropod in the description
    // does not exist in any world — it is written as if observed from
    // outside all three of them.
    label: 'Sömstenen',
    zoneId: 'zone-seam',
  },
  {
    id: 'item-source-approach',
    x: 3700, y: 450,
    // A fragment of the amplification mechanism, fallen off and left
    // behind. Still active. It carries all three corruption strains
    // simultaneously — and also none of them. Animals flee from it.
    // People stop moving.
    label: 'Källfragmentet',
    zoneId: 'zone-source-approach',
  },
  // ── Secrets ───────────────────────────────────────────────────────────────────
  {
    id: 'secret-1',
    x: 700, y: 1600,
    // A junction point — a place where all three worlds' paths literally
    // cross. Three grooves in the ground meeting at a point, each a
    // different material: tarmac, chitin, bamboo. Something was marked here.
    label: 'Korsningspunkten',
    zoneId: '',
  },
  {
    id: 'secret-2',
    x: 2900, y: 2200,
    // A hybrid creature — dead, long dead. Its skeleton shows bones from
    // two worlds. The pose is peaceful. It died lying down, on its side,
    // in a patch of untouched moss.
    label: 'Hybridkroppen',
    zoneId: '',
  },
];

// ── Secrets and zone markers ───────────────────────────────────────────────────

/**
 * Positions of secret collectibles — used to stamp HIDDEN_HOLLOW chunks and
 * to add a faint hint circle during world generation.
 */
export const SECRET_POSITIONS: Array<{ x: number; y: number; label: string }> = [
  { x:  700, y: 1600, label: 'Korsningspunkten' },
  { x: 2900, y: 2200, label: 'Hybridkroppen'    },
];

/**
 * Positions where the zone character shifts — marked with WAYMARKER_STONE chunks.
 *
 *   (1100, 1800) — earthfold → seam: where the familiar fully disappears
 *   (3100, 900)  — seam → source approach: where the silence begins
 */
export const ZONE_BOUNDARY_MARKERS: Array<{ x: number; y: number }> = [
  { x: 1100, y: 1800 },
  { x: 3100, y: 900  },
];

// ── Final approach dialog ──────────────────────────────────────────────────────

/** Player must walk within this radius (px) of MEETING_POINT to trigger dialog */
export const MEETING_RADIUS = 100;

/** World position of the dialog trigger, at the edge of the Source approach */
export const MEETING_POINT = { x: 3700, y: 350 };

/**
 * Three paths — what the player intends to do at the Source.
 * These choices carry the most weight: they feed directly into the
 * final confrontation in Level 5.
 */
export type PathChoice = 'jordens' | 'spinolandets' | 'vattenpandalandets';

export const PATH_CHOICES: Array<{ id: PathChoice; label: string }> = [
  { id: 'jordens',            label: 'Stäng av maskinen' },     // shut down the machine
  { id: 'spinolandets',       label: 'Låt ekosystemet välja' }, // let the ecosystem decide
  { id: 'vattenpandalandets', label: 'Reskriv berättelsen' },   // rewrite the story
];

/**
 * Returns the opening dialog line for the final approach.
 * Varies based on how many collectibles the player found — reflecting
 * how much evidence they carry of what the Source is.
 */
export function meetingOpeningLine(itemsFound: number): string {
  if (itemsFound === 0) return 'Det är inte ett monster. Det är ett system. Det gör ingen skillnad.';
  if (itemsFound === 1) return 'Du bär på ett fragment av det. Vet du det?';
  if (itemsFound === 2) return 'Fragmentet och stenen. Du förstår vad som hände. Frågan är vad du gör med det.';
  return 'Tre föremål. Du har sett sömmen från tre vinklar. Vad du ser nu är ursprunget.';
}

/** Passive cleanse rate in zone-source-approach (% per ms)
 *  Slower than previous levels — the convergence resists cleansing. */
export const PASSIVE_CLEANSE_RATE = 0.001;
/** Cap on passive cleanse contribution (%) */
export const PASSIVE_CLEANSE_CAP = 15;

// ── Remnants ───────────────────────────────────────────────────────────────────

/**
 * In Level 4 there are no permanent settlements — the Seam is too
 * unstable for long-term habitation. Instead: remnants. Places where
 * something tried to establish itself and partly succeeded.
 *
 *  - outpost: temporary camp maintained by people passing through
 *  - hybrid:  cross-world gathering point, unplanned, improvised
 *  - remnant: abandoned attempt at settlement
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
  type: 'outpost' | 'hybrid' | 'remnant';
}

export const SETTLEMENTS: Settlement[] = [
  {
    // Genomgångslägret — a transit camp maintained by people moving through
    // the Seam, not settling in it. Fires burn but nobody sleeps here.
    // Three languages on the walls and one shared rule: no weapons drawn.
    id: 'genomgangslagret',
    name: 'Genomgångslägret',
    x: 600,
    y: 2500,
    radius: 130,
    type: 'outpost',
  },
  {
    // Sömmötet — the place in the Seam where all three worlds' refugees
    // arrived simultaneously. Not built — arrived at. The shelter is
    // improvised from all three worlds' materials and it stands because
    // nothing here is strong enough to pull it apart yet.
    id: 'sommottet',
    name: 'Sömmötet',
    x: 2100,
    y: 1600,
    radius: 180,
    type: 'hybrid',
  },
  {
    // Det Sista Försöket — the last attempt at permanent settlement before
    // the Source approach. Abandoned. The structure is intact. The door
    // is still locked from the inside.
    id: 'det-sista-forsoket',
    name: 'Det Sista Försöket',
    x: 3600,
    y: 500,
    radius: 100,
    type: 'remnant',
  },
];
