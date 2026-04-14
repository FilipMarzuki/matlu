/**
 * BuildingCatalogue — economy-aware building vocabulary for settlements.
 *
 * Each settlement type has a fixed programme of buildings that reflects what
 * the community *does*. Rather than generic "house" sprites, every structure
 * has a named role derived from the settlement's economy:
 *
 *   coastal  → longhouse, smokehouse, fishing huts, net sheds
 *   forest   → market hall, sawmill, dwellings, workshop, storage
 *   mountain → lodge, smithy, shelter huts
 *
 * ## Zone rings
 * Each building def declares which zone ring it belongs to. The layout
 * generator (SettlementLayout.ts) maps these to radial fractions:
 *
 *   inner:  ~15–38% of settlement radius — civic/economic core
 *   middle: ~38–65%                      — main residential ring
 *   outer:  ~65–88%                      — storage, industry, outskirts
 *
 * Specialty buildings (sawmill, smokehouse) go at inner/outer to match
 * real settlement logic — they're close to the action or kept at the edge
 * because of fire or noise.
 */

/** Which radial ring a building type occupies. */
export type BuildingZone = 'inner' | 'middle' | 'outer';

/** Settlement economy derives from location and livelihood. */
export type SettlementEconomy = 'coastal' | 'forest' | 'mountain';

/**
 * A single entry in the settlement's building programme.
 *
 * `frameKey` must match a named frame registered on the 'building-roofs'
 * texture in GameScene.stampSettlementBuildings() — these correspond to
 * crop regions on the Pixel Crawler Roofs.png spritesheet.
 *
 * `count` is how many instances to place. The layout generator tries up to
 * 40 rejection-sampling attempts per instance and skips if none succeed —
 * so a tight settlement may end up with slightly fewer than count buildings.
 */
export interface BuildingDef {
  /** Human-readable purpose — shown in debug, useful for future tooltip/lore. */
  role: string;
  /** Named frame on the 'building-roofs' texture. */
  frameKey: string;
  /** Preferred placement zone ring. */
  zone: BuildingZone;
  /** Minimum display width in world pixels. */
  minW: number;
  /** Maximum display width in world pixels. */
  maxW: number;
  /** How many of this building type to place. */
  count: number;
}

/**
 * Maps settlement id → economy type so GameScene doesn't need to add a new
 * field to the Settlement interface in Level1.ts.
 */
export const SETTLEMENT_ECONOMY: Record<string, SettlementEconomy> = {
  strandviken:  'coastal',
  skogsglanten: 'forest',
  klippbyn:     'mountain',
};

/**
 * Returns the building programme for a given economy.
 *
 * The programme is a deterministic ordered list — the layout generator places
 * buildings in this order so inner (important) buildings are seated first,
 * giving them priority in the rejection-sampling placement.
 */
export function buildingProgramme(economy: SettlementEconomy): BuildingDef[] {
  switch (economy) {
    // ── Coastal fishing hamlet ────────────────────────────────────────────────
    // Centred on a longhouse (the community gathering hall). A blue-roofed
    // smokehouse/salting shed processes the catch at the inner ring. Fishing
    // huts cluster in the middle; net-storage sheds sit at the edge.
    case 'coastal': return [
      { role: 'longhouse',   frameKey: 'roof-brown-large', zone: 'inner',  minW: 30, maxW: 40, count: 1 },
      { role: 'smokehouse',  frameKey: 'roof-blue',        zone: 'inner',  minW: 18, maxW: 24, count: 1 },
      { role: 'fishing-hut', frameKey: 'roof-brown-small', zone: 'middle', minW: 15, maxW: 20, count: 2 },
      { role: 'net-shed',    frameKey: 'roof-brown-small', zone: 'outer',  minW: 13, maxW: 17, count: 1 },
    ];

    // ── Forest trading village ────────────────────────────────────────────────
    // Largest of the three settlements. A market hall anchors the inner ring;
    // the sawmill sits nearby (both are economic drivers). Dwellings ring the
    // middle. Storage sheds and a workshop occupy the outer ring.
    case 'forest': return [
      { role: 'market-hall', frameKey: 'roof-green-large',   zone: 'inner',  minW: 32, maxW: 42, count: 1 },
      { role: 'sawmill',     frameKey: 'roof-green-complex', zone: 'inner',  minW: 26, maxW: 34, count: 1 },
      { role: 'dwelling',    frameKey: 'roof-brown-large',   zone: 'middle', minW: 22, maxW: 30, count: 3 },
      { role: 'workshop',    frameKey: 'roof-blue',          zone: 'middle', minW: 16, maxW: 22, count: 1 },
      { role: 'storage',     frameKey: 'roof-brown-small',   zone: 'outer',  minW: 12, maxW: 18, count: 3 },
    ];

    // ── Mountain hamlet ───────────────────────────────────────────────────────
    // Small, hardy. A lodge (the main shelter / communal building) holds the
    // inner position. A smithy serves both the hamlet and passing travellers.
    // Shelter huts are scattered at the outer ring — shepherds use them
    // seasonally and they're small enough to nestle between boulders.
    case 'mountain': return [
      { role: 'lodge',       frameKey: 'roof-brown-large',   zone: 'inner', minW: 26, maxW: 36, count: 1 },
      { role: 'smithy',      frameKey: 'roof-green-complex', zone: 'inner', minW: 18, maxW: 24, count: 1 },
      { role: 'shelter-hut', frameKey: 'roof-brown-small',   zone: 'outer', minW: 12, maxW: 18, count: 3 },
    ];
  }
}
