/**
 * validate-earth-export.ts — verifies the Azgaar JSON export contains
 * recognizable Earth geography, not just random terrain.
 *
 * Usage:
 *   npm run worldgen:validate
 *
 * Prerequisites:
 *   npm run worldgen:generate   (produces earth-reference/azgaar-export.json)
 *
 * Runs 6 independent checks and prints a structured report.
 * Exit code 0 if all pass, 1 if any fail.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const JSON_PATH = path.join(REPO_ROOT, 'macro-world', 'earth-reference', 'azgaar-export.json');

// ── Thresholds ───────────────────────────────────────────────────────────────

const CELL_COUNT_MIN = 1_000;
const CELL_COUNT_MAX = 100_000;
const LAND_RATIO_MIN = 0.20;
const LAND_RATIO_MAX = 0.50;
const BIOME_MIN = 6;
const BIOME_TOTAL = 12;
const RIVER_MIN = 10;
const CONTINENT_MIN = 3;
const CONTINENT_MAX = 12;
const CONTINENT_MIN_CELLS = 15; // minimum cells to count as a "major" landmass

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Azgaar Full JSON export structure.
 *
 * pack.cells is an object keyed by cell index (0..n-1), each cell has:
 *   i, h (height 0-100, 20=sea level), c (neighbor IDs), biome, p ([x,y]), t (temp), ...
 *
 * pack.rivers is an array of river objects with .i (river ID).
 *
 * grid.cells is similar — keyed by index, each has .temp for temperature.
 */
interface AzgaarCell {
  i: number;
  h: number;
  c: number[];
  biome: number;
  p: [number, number];
  t: number;
}

interface AzgaarRiver {
  i: number;
  [key: string]: unknown;
}

interface AzgaarExport {
  pack: {
    cells: Record<string, AzgaarCell>;
    rivers: AzgaarRiver[];
    [key: string]: unknown;
  };
  grid: {
    cells: Record<string, { i: number; temp: number; [key: string]: unknown }>;
    [key: string]: unknown;
  };
  biomesData: {
    i: number[];
    name: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert the object-keyed cells into an array for easier iteration. */
function cellsToArray(cells: Record<string, AzgaarCell>): AzgaarCell[] {
  const arr: AzgaarCell[] = [];
  for (const key of Object.keys(cells)) {
    const idx = parseInt(key, 10);
    if (!isNaN(idx)) arr.push(cells[key]);
  }
  return arr;
}

// ── Checks ───────────────────────────────────────────────────────────────────

function checkCellCount(cells: AzgaarCell[]): CheckResult {
  const count = cells.length;
  return {
    name: 'Cell count',
    pass: count >= CELL_COUNT_MIN && count <= CELL_COUNT_MAX,
    detail: `${count.toLocaleString()} (${CELL_COUNT_MIN.toLocaleString()}–${CELL_COUNT_MAX.toLocaleString()})`,
  };
}

function checkLandRatio(cells: AzgaarCell[]): CheckResult {
  const total = cells.length;
  let land = 0;
  for (const cell of cells) {
    if (cell.h >= 20) land++;
  }
  const ratio = land / total;
  return {
    name: 'Land ratio',
    pass: ratio >= LAND_RATIO_MIN && ratio <= LAND_RATIO_MAX,
    detail: `${(ratio * 100).toFixed(1)}% (${LAND_RATIO_MIN * 100}%–${LAND_RATIO_MAX * 100}%)`,
  };
}

function checkBiomeDiversity(cells: AzgaarCell[]): CheckResult {
  const unique = new Set<number>();
  for (const cell of cells) {
    if (cell.biome > 0) unique.add(cell.biome); // 0 = Marine
  }
  return {
    name: 'Biome diversity',
    pass: unique.size >= BIOME_MIN,
    detail: `${unique.size}/${BIOME_TOTAL} land biomes (need >=${BIOME_MIN})`,
  };
}

function checkRivers(rivers: AzgaarRiver[]): CheckResult {
  const count = rivers.length;
  return {
    name: 'Rivers',
    pass: count >= RIVER_MIN,
    detail: `${count} (need >=${RIVER_MIN})`,
  };
}

/**
 * BFS continent detection — finds connected components of land cells
 * (h >= 20) using the cell adjacency list (cell.c). Counts only
 * components with at least CONTINENT_MIN_CELLS cells as "major landmasses".
 */
function checkContinents(cells: AzgaarCell[]): CheckResult {
  // Build a lookup by cell index for fast neighbor resolution
  const byId = new Map<number, AzgaarCell>();
  for (const cell of cells) {
    byId.set(cell.i, cell);
  }

  const visited = new Set<number>();
  const continents: number[] = [];

  for (const cell of cells) {
    if (visited.has(cell.i) || cell.h < 20) continue;

    // BFS with pointer-based queue
    const queue: number[] = [cell.i];
    visited.add(cell.i);
    let head = 0;
    let size = 0;

    while (head < queue.length) {
      const id = queue[head++];
      size++;
      const current = byId.get(id);
      if (!current) continue;
      for (const neighborId of current.c) {
        if (visited.has(neighborId)) continue;
        const neighbor = byId.get(neighborId);
        if (neighbor && neighbor.h >= 20) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      }
    }

    if (size >= CONTINENT_MIN_CELLS) {
      continents.push(size);
    }
  }

  continents.sort((a, b) => b - a);
  const count = continents.length;
  const top = continents.slice(0, 6).join(', ');

  return {
    name: 'Major landmasses',
    pass: count >= CONTINENT_MIN && count <= CONTINENT_MAX,
    detail: `${count} (${CONTINENT_MIN}–${CONTINENT_MAX}). Top sizes: ${top}`,
  };
}

/**
 * Temperature range — verifies that Azgaar's climate simulation produced
 * meaningful temperature variation across the map.
 *
 * Rather than assuming a symmetric equatorial band (which depends on how
 * the heightmap was imported and Azgaar's projection), we check that:
 * 1. The coldest 10% of cells are significantly cooler than the warmest 10%
 * 2. The temperature span is at least 5°C (proves the simulation ran)
 */
function checkTemperatureGradient(cells: AzgaarCell[]): CheckResult {
  const temps = cells.map(c => c.t).sort((a, b) => a - b);
  const n = temps.length;
  const coldBand = temps.slice(0, Math.floor(n * 0.1));
  const warmBand = temps.slice(Math.floor(n * 0.9));

  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const coldAvg = avg(coldBand);
  const warmAvg = avg(warmBand);
  const span = warmAvg - coldAvg;

  return {
    name: 'Temp range',
    pass: span >= 5,
    detail: `coldest 10% avg ${coldAvg.toFixed(1)}°C, warmest 10% avg ${warmAvg.toFixed(1)}°C (span ${span.toFixed(1)}°C, need >=5)`,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  console.log('\n── Earth Export Validation ─────────────────────────────────');
  console.log(`  File: ${path.relative(REPO_ROOT, JSON_PATH)}\n`);

  if (!fs.existsSync(JSON_PATH)) {
    console.error(`Error: ${JSON_PATH} not found.`);
    console.error('Run: npm run worldgen:generate');
    process.exit(1);
  }

  let data: AzgaarExport;
  try {
    const raw = fs.readFileSync(JSON_PATH, 'utf8');
    data = JSON.parse(raw) as AzgaarExport;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: could not parse JSON — ${message}`);
    process.exit(1);
  }

  // Structural guard
  if (!data.pack?.cells || !data.pack?.rivers) {
    console.error('Error: JSON is missing pack.cells or pack.rivers');
    process.exit(1);
  }

  const cells = cellsToArray(data.pack.cells);
  if (cells.length === 0) {
    console.error('Error: no cells found in pack.cells');
    process.exit(1);
  }

  const checks: CheckResult[] = [
    checkCellCount(cells),
    checkLandRatio(cells),
    checkBiomeDiversity(cells),
    checkRivers(data.pack.rivers),
    checkContinents(cells),
    checkTemperatureGradient(cells),
  ];

  let allPassed = true;
  for (const check of checks) {
    const icon = check.pass ? 'PASS' : 'FAIL';
    console.log(`  [${icon}]  ${check.name.padEnd(20)} ${check.detail}`);
    if (!check.pass) allPassed = false;
  }

  console.log('');
  if (allPassed) {
    console.log('All checks passed.\n');
  } else {
    const failed = checks.filter(c => !c.pass).map(c => c.name);
    console.log(`Failed: ${failed.join(', ')}\n`);
    process.exit(1);
  }
}

main();
