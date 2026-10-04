/**
 * settlement-map-generate — write a generated settlement to a map file (#1170).
 *
 *   npm run map:settlement -- --seed 42 --id settlement-demo [--geo forest] [--tier 3]
 *
 * Same pipeline SettlementForgeScene runs interactively (generateSettlement →
 * placeBuildings), but instead of drawing the result it emits the LDtk-shaped
 * JSON that MapData.parseLdtkLevel() reads, to public/assets/maps/<id>.json.
 * No browser needed, so it runs in CI and in the terminal.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateSettlement, type SettlementSite } from '../src/world/SettlementGenerator';
import { placeBuildings } from '../src/world/SettlementPlacement';
import { emitSettlementMap } from '../src/world/SettlementMapEmitter';
import { mulberry32 } from '../src/lib/rng';
import type { Geography, SettlementTier } from '../src/world/SettlementSpec';

// ── Args ────────────────────────────────────────────────────────────────────
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1] ?? 'true'), i++;
}
const seed = Number(args.get('seed') ?? 42);
const id = args.get('id') ?? `settlement-${seed}`;
const geography = (args.get('geo') ?? 'forest') as Geography;
const tier = Number(args.get('tier') ?? 2) as SettlementTier;
if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`--id must be [a-z0-9-]+, got "${id}"`);

// Mirrors SettlementForgeScene: same tile size, zone rings and grid sizing,
// so a map emitted here matches what the forge previews.
const TILE = 32;
const ZONE_FRAC = {
  inner:  { min: 0.10, max: 0.38 },
  middle: { min: 0.38, max: 0.65 },
  outer:  { min: 0.65, max: 0.90 },
};

const site: SettlementSite = {
  x: 400, y: 400,
  geography,
  features: ['river-crossing', 'wilderness-edge'],
  adjacentResources: ['timber', 'stone', 'fish'],
  nearCorruption: false,
  tradeRouteCount: tier * 2,
  nearbySettlements: tier,
  cultureId: 'coastborn',
};

const { spec, buildings } = generateSettlement(site, id, mulberry32(seed), tier);
const gridSize = Math.ceil(spec.radius / TILE) * 3 + 8;
const result = placeBuildings({
  buildings,
  radiusTiles: spec.radius / TILE,
  gridSize,
  tileSize: TILE,
  seed,
  zoneFracs: ZONE_FRAC,
  streetPattern: 'grid',
});

const map = emitSettlementMap(result, { identifier: id, gridSize, cellSize: TILE, metersPerTile: 2, label: 'settlement' });

const outDir = resolve(process.cwd(), 'public/assets/maps');
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, `${id}.json`);
writeFileSync(out, JSON.stringify(map, null, 2) + '\n');
console.log(`${out}: ${result.buildings.length} buildings, ${result.roads.length} road tiles, ${gridSize}×${gridSize} cells, tier ${spec.tier}`);
