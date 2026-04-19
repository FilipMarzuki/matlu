/**
 * Level 3 configuration — Mistheim Mist (Mistheim dominant).
 *
 * ## Setting: Floating river delta, bamboo highlands, mist valleys
 *
 * Mistheim is a world of stories and Myst — where mana (called Myst here,
 * or Mysten by scholars) is the animating current beneath everything.
 * Rivers flow because Myst moves through them. Mist hangs in valleys where
 * Myst concentrates. Memory lives in water because Myst carried it there.
 * "Vatten" in the old tongue meant Myst-water — water alive with current.
 * Most people have forgotten this and call it water magic. The scholars
 * haven't forgotten.
 *
 * This level occupies a high river delta where those scholars keep their
 * oldest records: bamboo highlands rising above mist-filled valleys,
 * standing stones that glow at dawn where Myst pools overnight, rivers
 * that run sideways because the Myst beneath them runs that way.
 *
 * Ancient panda settlements, some intact, some crumbling. Earth technology
 * salvaged and repurposed — machines running on channelled Myst, turbines
 * in rivers that moved before anyone understood why. The most visually
 * surreal level in the arc.
 *
 * The corruption here is the Dry — Mistheim's strain of the Skymning.
 * It does not drain water. It severs the Myst. Rivers stop not because
 * they dry up but because the animating current beneath them is gone.
 * A [Healer] whose Skill works in reverse. An inn whose warmth turns cold.
 * An ancient river, still flowing, but flowing wrong — the water moves but
 * nothing moves with it.
 *
 * ## Zone layout (world coordinates, 4500×3000 world)
 *
 *  Zone 1 — Deltagrunden (The Delta Floor)
 *    Entry zone. The lower river delta where Spinolandet creatures have
 *    already begun to arrive. Rivers run sideways. The bamboo at the
 *    waterline is the wrong shade of green — not dead, not healthy, not
 *    anything that has a name. The Myst here is thin and confused.
 *
 *  Zone 2 — Mistdalen (The Mist Valley)
 *    Bamboo highlands where Myst pools visibly as drifting mist.
 *    Ancient panda settlements, some inhabited, some abandoned to the Dry.
 *    Earth machines run on channelled Myst — turbines of salvaged metal
 *    turning in rivers that the Myst still moves, just barely.
 *    The settlements here are defined more by who left than who stayed.
 *
 *  Zone 3 — Skriftberget (The Scholar's Height)
 *    Where the Pandor scholars keep their oldest records. Near-clean,
 *    protected by old agreement and by the concentration of Myst at
 *    altitude. The tear here is the largest so far — something on the
 *    other side visible through it, not another landscape, just light.
 *
 * ## Collectibles
 *  Three objects, one per zone. Artifacts of Mistheim — Myst-stone,
 *  Myst-script, and the three-world record.
 *
 * ## Scholar meeting
 *  Walking within 100px of MEETING_POINT triggers dialog with the Pandor
 *  scholars. They have records. The Skymning was always present — in all
 *  three worlds, in small amounts, as a natural force. Something amplified
 *  it. The records point to a location.
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
    // Deltagrunden — the lower delta. Dry corruption has begun to work:
    // rivers still flow but the banks are drying. Spinolandet creatures
    // wade through shallows that used to be too deep to cross.
    id: 'zone-delta',
    x: 0, y: 2000, w: 900, h: 1000,
    corruption: 55,
    tintColor: 0x1a3830,  // teal-jade (Mistheim fading)
    tintAlpha: 0.04,
  },
  {
    // Mistdalen — the highland mist valley where the panda settlements sit.
    // Some inhabited; some abandoned to the Dry. The mist is neither water
    // nor weather — it is something older than the settlements that grew
    // up inside it.
    id: 'zone-mist',
    x: 1400, y: 900, w: 1300, h: 1000,
    corruption: 40,
    tintColor: 0x283a32,  // jade-mist (mid corruption)
    tintAlpha: 0.03,
  },
  {
    // Skriftberget — the scholar's height. The records are here. The tear
    // is here. Looking through it is like looking at a wound that has not
    // yet been named.
    id: 'zone-scholars',
    x: 3200, y: 100, w: 1300, h: 900,
    corruption: 30,
    tintColor: 0x101a1a,  // dim teal (near the tear, near-clean)
    tintAlpha: 0.02,
  },
];

// ── Collectibles ───────────────────────────────────────────────────────────────

export const COLLECTIBLES: Collectible[] = [
  {
    id: 'item-delta',
    x: 400, y: 2500,
    // A river stone that still holds water inside it — permanently damp to
    // the touch, even on its cut surface. Water magic made this, before
    // the Dry began.
    label: 'Vattenstenen',
    zoneId: 'zone-delta',
  },
  {
    id: 'item-mist',
    x: 2000, y: 1350,
    // A bamboo scroll sealed with wax, showing a panda in a [Waterscribe]
    // Class pose — a notation system that runs on mana rather than ink.
    // Still legible. Still active.
    label: 'Vattenskriften',
    zoneId: 'zone-mist',
  },
  {
    id: 'item-scholars',
    x: 3800, y: 400,
    // The oldest record the scholars have. A stone tablet with three
    // scripts running parallel — the same event recorded from three
    // different worlds. All three accounts end at the same moment,
    // then continue differently.
    label: 'Urminnesplattan',
    zoneId: 'zone-scholars',
  },
  // ── Secrets ───────────────────────────────────────────────────────────────────
  {
    id: 'secret-1',
    x: 800, y: 1500,
    // An inn-sign, carved with the universal symbol — a flame above a door.
    // The sign has been here longer than the settlement it was attached to.
    // The building is gone. The sign remains.
    label: 'Värdshusskylten',
    zoneId: '',
  },
  {
    id: 'secret-2',
    x: 3000, y: 2100,
    // A Deepwalker memory-shell — a curved plate of calcified oral history,
    // worn smooth by handling. The encoded record inside is not in any
    // script you recognise, but the emotion in it is clear: this is a
    // record of something ending.
    label: 'Minnesskalet',
    zoneId: '',
  },
];

// ── Secrets and zone markers ───────────────────────────────────────────────────

/**
 * Positions of secret collectibles — used to stamp HIDDEN_HOLLOW chunks and
 * to add a faint hint circle during world generation.
 */
export const SECRET_POSITIONS: Array<{ x: number; y: number; label: string }> = [
  { x:  800, y: 1500, label: 'Värdshusskylten' },
  { x: 3000, y: 2100, label: 'Minnesskalet'    },
];

/**
 * Positions where the zone character shifts — marked with WAYMARKER_STONE chunks.
 *
 *   (1200, 1800) — delta → mist: where the bamboo thickens and the ground rises
 *   (3000, 1000) — mist → scholars: where permanent mist gives way to clear air
 */
export const ZONE_BOUNDARY_MARKERS: Array<{ x: number; y: number }> = [
  { x: 1200, y: 1800 },
  { x: 3000, y: 1000 },
];

// ── Scholar meeting ────────────────────────────────────────────────────────────

/** Player must walk within this radius (px) of MEETING_POINT to trigger dialog */
export const MEETING_RADIUS = 100;

/** World position of the meeting trigger, at the scholar's archive */
export const MEETING_POINT = { x: 3700, y: 400 };

/**
 * Three paths — each a different understanding of what the records reveal.
 * Choice is stored for use in later levels.
 */
export type PathChoice = 'jordens' | 'spinolandets' | 'vattenpandalandets';

export const PATH_CHOICES: Array<{ id: PathChoice; label: string }> = [
  { id: 'jordens',            label: 'Maskinernas väg' },    // way of the machines
  { id: 'spinolandets',       label: 'Kolonins väg' },       // way of the colony
  { id: 'vattenpandalandets', label: 'Berättelsens väg' },   // way of the story
];

/**
 * Returns the opening dialog line for the scholar meeting.
 * Varies based on how many collectibles the player found — reflecting
 * how carefully they moved through Mistheim Mist.
 */
export function meetingOpeningLine(itemsFound: number): string {
  if (itemsFound === 0) return 'Du har kommit långt utan att bära på något. Det säger oss något.';
  if (itemsFound === 1) return 'Den sten du bär — vi känner igen vad den är. Var hittade du den?';
  if (itemsFound === 2) return 'Stenen och skriften. Du samlar bevis, inte troféer. Det är sällsynt.';
  return 'Tre föremål från tre världar. Du är den vi väntade på — inte som hjälte, utan som vittne.';
}

/** Passive cleanse rate in zone-scholars (% per ms) */
export const PASSIVE_CLEANSE_RATE = 0.002;
/** Cap on passive cleanse contribution (%) */
export const PASSIVE_CLEANSE_CAP = 20;

// ── Settlements ────────────────────────────────────────────────────────────────

/**
 * Significant locations in Mistheim Mist.
 *
 * The settlement types here reflect the world's structure:
 *  - hamlet:    working panda community
 *  - sanctuary: inn-protected neutral ground (violence does not happen here)
 *  - ruin:      a settlement the Dry reached first
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
  type: 'hamlet' | 'sanctuary' | 'ruin';
}

export const SETTLEMENTS: Settlement[] = [
  {
    // Flodbyn — a working panda settlement at the delta mouth. They trade
    // river-caught fish for Earth salvage and Spinolandet shell. The market
    // runs without common language; price is communicated by gesture and weight.
    id: 'flodbyn',
    name: 'Flodbyn',
    x: 550,
    y: 2600,
    radius: 160,
    type: 'hamlet',
  },
  {
    // Mistklostret — a panda scholarly community in the mist valley.
    // Neutral ground by old agreement. Earth machines run here — turbines
    // built from salvaged metal, driven by channelled water magic.
    // Warm inside. The coffee is good.
    id: 'mistklostret',
    name: 'Mistklostret',
    x: 2200,
    y: 1300,
    radius: 200,
    type: 'sanctuary',
  },
  {
    // Torrdalen — a settlement the Dry reached first. The buildings are
    // intact; the people left. The river that ran through it stopped three
    // months ago. Birds still come here, looking for water that isn't there.
    id: 'torrdalen',
    name: 'Torrdalen',
    x: 3200,
    y: 700,
    radius: 130,
    type: 'ruin',
  },
];
