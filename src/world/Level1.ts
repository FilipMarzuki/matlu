/**
 * Level 1 configuration — zones, collectibles, and the story meeting.
 *
 * ## Setting: Höga Kusten, Swedish High Coast — early spring
 *
 * The world is inspired by the dramatic coastal landscape of Höga Kusten
 * (the High Coast) along the Gulf of Bothnia in northern Sweden. The terrain
 * rises steeply from the sea — glacial rebound has lifted these hills higher
 * than anywhere else in Scandinavia. In early spring the birch buds are just
 * breaking, snow still caps the highest rocks, and the forest smells of cold
 * earth and wet bark. The sea is still pale grey-blue from winter.
 *
 * Wildlife is abundant: deer move through the birch-spruce forest, hares dash
 * across the coastal heathland, fox trails wind between the boulders, and
 * birds — redwings, fieldfares, eagles — fill the sky after months of silence.
 *
 * ## Zone layout (world coordinates, 8000×8000 world)
 *
 *  Zone 1 — Stranden (The Shore)
 *    The rocky shore where the player arrives. High corruption — something has
 *    gone wrong with the land here. Dark grey-ash tint. Player spawns here.
 *
 *  Zone 2 — Skuleskogen (The Forest)
 *    The ancient boreal forest rising from the shore: birch and spruce, spring
 *    green barely emerged. Medium corruption — the trees muffle but don't heal.
 *
 *  Zone 3 — Klipptoppen (The Rock Summit)
 *    The high plateau with bare granite and gnarled mountain birch. On a clear
 *    spring day you can see the archipelago and, beyond it, the open sea. Near-
 *    clean; faint blue-grey tint. Contains the portal.
 *
 * ## Collectibles
 *  Three objects, one per zone. No map marker — found by curiosity.
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
    // Stranden — rocky shore near the SW spawn. Heavy corruption.
    id: 'zone-start',
    x: 0, y: 2200, w: 700, h: 800,
    corruption: 65,
    tintColor: 0x1a1026,
    tintAlpha: 0.24, // deep violet-black corruption hotspot near spawn
  },
  {
    // Skuleskogen — boreal forest mid-corridor. Medium corruption.
    id: 'zone-forest',
    x: 1600, y: 1000, w: 1100, h: 900,
    corruption: 35,
    tintColor: 0x1e2431,
    tintAlpha: 0.14, // desaturated slate-violet forest corruption
  },
  {
    // Klipptoppen — granite summit near the NE portal. Near-clean.
    id: 'zone-plateau',
    x: 3400, y: 100, w: 1100, h: 900,
    corruption: 5,
    tintColor: 0x2b3344,
    tintAlpha: 0.08, // faint cool tint — mostly cleansed plateau
  },
];

// ── Collectibles ───────────────────────────────────────────────────────────────

export const COLLECTIBLES: Collectible[] = [
  {
    id: 'item-start',
    x: 400, y: 2600,
    // A smooth wave-worn stone from the shingle beach — still cold from the sea.
    label: 'Strandstenen',
    zoneId: 'zone-start',
  },
  {
    id: 'item-forest',
    x: 2200, y: 1450,
    // A fragment of resin-amber still smelling of old spruce — the forest's memory.
    label: 'Skogsminnet',
    zoneId: 'zone-forest',
  },
  {
    id: 'item-plateau',
    x: 3900, y: 500,
    // A shard of grey lichen-spotted granite from the highest point of the coast.
    label: 'Klippfragmentet',
    zoneId: 'zone-plateau',
  },
  // ── Secrets (FIL-129) — no zone association, no map marker ───────────────────
  {
    id: 'secret-1',
    x: 750, y: 1600,
    // An ancient runestone almost swallowed by moss — bears marks no one alive can read.
    label: 'Vittnesstenen',
    zoneId: '',  // sentinel: secret collectibles don't belong to any zone
  },
  {
    id: 'secret-2',
    x: 3100, y: 2100,
    // The crumbled stump of a watchtower — someone once climbed this to see the sea.
    label: 'Ödestornet',
    zoneId: '',
  },
];

// ── Secrets and zone markers (FIL-129) ────────────────────────────────────────

/**
 * Positions of secret collectibles — used to stamp HIDDEN_HOLLOW chunks and
 * to add a faint golden hint circle during world generation.
 *
 * These are separate from COLLECTIBLES so GameScene can iterate them without
 * filtering the full collectibles array.
 */
export const SECRET_POSITIONS: Array<{ x: number; y: number; label: string }> = [
  { x:  750, y: 1600, label: 'Vittnesstenen' },
  { x: 3100, y: 2100, label: 'Ödestornet'   },
];

/**
 * Positions where biome zones transition — marked with WAYMARKER_STONE chunks
 * so the player gets a subtle spatial cue that the character of the land is changing.
 *
 *   (1400, 1800) — shore → forest: where the coastal heath gives way to spruce
 *   (3100, 1000) — forest → plateau: where the treeline thins toward open granite
 */
export const ZONE_BOUNDARY_MARKERS: Array<{ x: number; y: number }> = [
  { x: 1400, y: 1800 },
  { x: 3100, y: 1000 },
];

// ── Parent meeting ─────────────────────────────────────────────────────────────

/** Player must walk within this radius (px) of MEETING_POINT to trigger dialog */
export const MEETING_RADIUS = 100;

/** World position of the meeting trigger, just before the portal */
export const MEETING_POINT = { x: 3800, y: 480 };

/**
 * Three paths — each a different relationship with this coastal landscape.
 * No gameplay difference in Level 1; choice is stored for future levels.
 */
export type PathChoice = 'jordens' | 'spinolandets' | 'vattenpandalandets';

export const PATH_CHOICES: Array<{ id: PathChoice; label: string }> = [
  { id: 'jordens',            label: 'Havets väg' },      // way of the sea
  { id: 'spinolandets',       label: 'Skogens väg' },     // way of the forest
  { id: 'vattenpandalandets', label: 'Fjällens väg' },    // way of the mountain
];

/**
 * Returns the opening dialog line for the parent meeting.
 * Varies based on how many collectibles the player found — reflecting
 * how deeply they explored the Höga Kusten landscape before arriving.
 */
export function meetingOpeningLine(itemsFound: number): string {
  if (itemsFound === 0) return 'Jag vet inte vad det är du bär på — men det är inte ingenting.';
  if (itemsFound === 1) return 'Du har hittat något i den här skogen. Det märks på hur du rör dig.';
  if (itemsFound === 2) return 'Stranden och skogen. Du har rört dig längre än de flesta gör.';
  return 'Stenen, minnet, och fragmentet. Du har sett det hela — nu förstår du kanske mer än jag.';
}

/** Passive cleanse rate in Zone 3 — fills the cleanse bar slowly (% per ms) */
export const PASSIVE_CLEANSE_RATE = 0.002;
/** Cap on passive cleanse contribution (%) */
export const PASSIVE_CLEANSE_CAP = 20;

// ── Settlements ────────────────────────────────────────────────────────────────

/**
 * A human settlement on the map — hamlet or village.
 *
 * Positions follow geographic logic (see Level1.ts header comment):
 *  - Coastal hamlets sit near the shore/water transition
 *  - Forest villages occupy clearings at trail junctions
 *  - Mountain hamlets cluster at plateau edges where travelers shelter
 */
export interface Settlement {
  id: string;
  /** Swedish place name shown as a label on the map */
  name: string;
  /** World-space centre x */
  x: number;
  /** World-space centre y */
  y: number;
  /** Boundary radius in pixels — used for rendering and future proximity checks */
  radius: number;
  /** hamlet: small fishing/hunting community; village: farming/trade settlement */
  type: 'hamlet' | 'village';
}

export const SETTLEMENTS: Settlement[] = [
  {
    // Strandviken — a fishing hamlet on the rocky shore, south of the dirt road.
    // Sheltered cove with boats pulled up on the shingle; smell of tar and cold salt.
    // Placed below the shore zone at a natural water-edge position.
    id: 'strandviken',
    name: 'Strandviken',
    x: 450,
    y: 2820,
    radius: 120,
    type: 'hamlet',
  },
  {
    // Skogsgläntan — a forest village in a clearing where the animal trail crosses
    // the forest belt. Loggers, charcoal burners, a small market for the plateau road.
    // Placed at the trail junction around (700, 700) inside the Skuleskogen zone.
    id: 'skogsglanten',
    name: 'Skogsgläntan',
    x: 2300,
    y: 1400,
    radius: 180,
    type: 'village',
  },
  {
    // Klippbyn — an isolated hamlet at the lower plateau edge.
    // Seasonal: shepherds summer here; travelers shelter before the summit.
    // Placed on the lower slope of Klipptoppen, west of the portal.
    id: 'klippbyn',
    name: 'Klippbyn',
    x: 3900,
    y: 620,
    radius: 100,
    type: 'hamlet',
  },
];
