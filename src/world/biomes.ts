/**
 * Canonical biome definitions — single source of truth for both the game
 * (GameScene, WorldForgeScene) and the wiki (Astro build step).
 *
 * Ordering follows the 12-entry list from WorldForgeScene, which includes
 * "Meadow" at index 6 (absent from GameScene's older 11-entry classification).
 * GameScene's tileBiomeIdx() uses indices 0–5 and 7–11; index 6 (Meadow) is
 * available for future classification refinement and for the World Forge UI.
 *
 * The `description` field contains 2–3 sentences of in-world lore prose.
 * Descriptions are intentionally grounded — written as if by someone who has
 * lived in or passed through each biome, not an omniscient narrator.
 */

export interface BiomeDef {
  /** Display name shown in dev overlays and the wiki. */
  name: string;
  /** Representative elevation value (0–1) for the canonical centre of this biome. */
  elev: number;
  /** Representative temperature value (0–1). */
  temp: number;
  /** Representative moisture value (0–1). */
  moist: number;
  /** Phaser hex colour used in biome dev overlays and wiki swatches. */
  overlayColor: number;
  /** 2–3 sentence world lore description. Plain text, no markdown. */
  description: string;
  /** Surface scatter types valid for this biome — shown in the World Forge decor toolbar. */
  decorTypes: readonly string[];
}

export const BIOMES: BiomeDef[] = [
  // 0 — Sea
  {
    name:         'Sea',
    elev:         0.12,
    temp:         0.5,
    moist:        0.6,
    overlayColor: 0x1a4f7a,
    description:  'The cold shelf sea that rings Mistheim is rarely calm. Merfolk hold the deep channels and do not welcome surface traffic; fishing boats from coastal holds keep to shallows they have charted for generations.',
    decorTypes: ['Seaweed', 'Kelp', 'Shell'],  },

  // 1 — Rocky Shore
  {
    name:         'Rocky Shore',
    elev:         0.27,
    temp:         0.35,
    moist:        0.45,
    overlayColor: 0x8b6914,
    description:  'Tide-scoured stone and kelp-choked crevices where nothing stays dry for long. Deepwalker stilt-towns perch above the splash zone here, their foundations driven into rock the sea has been trying to reclaim for centuries.',
    decorTypes: ['Kelp', 'Pebble', 'Driftwood'],  },

  // 2 — Sandy Shore
  {
    name:         'Sandy Shore',
    elev:         0.27,
    temp:         0.65,
    moist:        0.25,
    overlayColor: 0xe8c870,
    description:  'Wide flats of pale sand that hold heat through the afternoon and go cold fast after sunset. The sand makes poor farmland but good salt-flats, and several Markfolk clans run salt operations here that the Pandor Kloster networks quietly depend on.',
    decorTypes: ['Shell', 'Pebble', 'Dry Grass'],  },

  // 3 — Marsh / Bog
  {
    name:         'Marsh / Bog',
    elev:         0.38,
    temp:         0.5,
    moist:        0.82,
    overlayColor: 0x4a7a3a,
    description:  'Waterlogged ground where peat stacks to depth and the horizon is never certain. Lövfolk who know the routes can cross in a day; those who do not can wander for three. The smell of it — iron-water and old growth — carries half a mile.',
    decorTypes: ['Reed', 'Lily Pad', 'Moss'],  },

  // 4 — Dry Heath
  {
    name:         'Dry Heath',
    elev:         0.50,
    temp:         0.55,
    moist:        0.15,
    overlayColor: 0xb8904a,
    description:  'Thin soil over stone, too dry for trees and too exposed for anything but heather and wind-hardened scrub. Viddfolk [Heralds] use the long sight lines to run their routes fast; there is nowhere to ambush someone who can see in every direction.',
    decorTypes: ['Heather', 'Pebble', 'Thornbush'],  },

  // 5 — Coastal Heath
  {
    name:         'Coastal Heath',
    elev:         0.50,
    temp:         0.5,
    moist:        0.45,
    overlayColor: 0x7a9a3a,
    description:  'Salted upland where heather and rough grass share ground with occasional thornwood. The wind off the water shapes everything here — trees only grow where a rock breaks the line of it, and they grow sideways.',
    decorTypes: ['Heather', 'Rough Grass', 'Pebble'],  },

  // 6 — Meadow
  {
    name:         'Meadow',
    elev:         0.50,
    temp:         0.55,
    moist:        0.65,
    overlayColor: 0x6abf45,
    description:  'Open grassland with enough rainfall to stay green through dry seasons. Goblins favor meadows for surface camps; the sight lines are good and the soil soft enough that a burrow entrance can be hidden under a grass-covered hatch.',
    decorTypes: ['Grass Tuft', 'Wildflower', 'Clover'],  },

  // 7 — Forest
  {
    name:         'Forest',
    elev:         0.70,
    temp:         0.65,
    moist:        0.55,
    overlayColor: 0x2a7a2a,
    description:  'Broad-leaf canopy where the light arrives filtered and the ground stays damp. Most Lövfolk settlements are built into these slopes — suspended platforms, rope bridges, storage nets hung between trunks. The forest is not wild to them; it is home infrastructure.',
    decorTypes: ['Fern', 'Leaf Litter', 'Mushroom'],  },

  // 8 — Spruce
  {
    name:         'Spruce',
    elev:         0.70,
    temp:         0.35,
    moist:        0.55,
    overlayColor: 0x1a5a1a,
    description:  'Dense spruce at altitude where the canopy closes overhead and ground cover thins to needle-duff. The cold is bone-dry in winter; resin smell is the first thing you notice coming up from the lower forest.',
    decorTypes: ['Pine Needle', 'Mushroom', 'Lichen'],  },

  // 9 — Cold Granite
  {
    name:         'Cold Granite',
    elev:         0.85,
    temp:         0.45,
    moist:        0.35,
    overlayColor: 0x7a7a7a,
    description:  'Exposed bedrock at high altitude where soil is a thin seam between stones and frost cracks the rest. Bergfolk mining shafts have been sunk into granite like this for three centuries; the stone is older than any of their holds but they know its character well.',
    decorTypes: ['Lichen', 'Frost Patch', 'Loose Rock'],  },

  // 10 — Bare Summit
  {
    name:         'Bare Summit',
    elev:         0.88,
    temp:         0.30,
    moist:        0.25,
    overlayColor: 0x9a9898,
    description:  'Wind-blasted ridgeline where nothing roots and everything loose has already blown away. The views are extraordinary and useless — nobody lives here. Bergfolk route-markers sometimes appear at these passes, carved into stone by people who came through once and wanted to be remembered for it.',
    decorTypes: ['Loose Stone', 'Ice Crystal'],  },

  // 11 — Snow Field
  {
    name:         'Snow Field',
    elev:         0.95,
    temp:         0.10,
    moist:        0.70,
    overlayColor: 0xd8e8f8,
    description:  'Permanent snowfield at the highest elevations where the cold does not break between seasons. The Steinfolk say the first snowfields appeared when the first mountain did; they treat them as boundary markers between the world of the living and whatever is above it.',
    decorTypes: ['Snow Drift', 'Ice Crystal', 'Frost'],  },
];
