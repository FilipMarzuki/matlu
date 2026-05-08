/**
 * generate-earth-map.ts — imports the generated Earth heightmap into Azgaar FMG.
 *
 * Usage:
 *   tsx macro-world/scripts/generate-earth-map.ts
 *   tsx macro-world/scripts/generate-earth-map.ts --headed
 *
 * Input: macro-world/earth-reference/heightmap.png
 *
 * This script intentionally automates Azgaar through Playwright instead of
 * adding an Azgaar dependency. FMG is a browser app, and its public globals are
 * the stable integration surface used by its own UI.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium, type Browser, type Page } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const HEIGHTMAP_PATH = path.join(REPO_ROOT, 'macro-world', 'earth-reference', 'heightmap.png');
const AZGAAR_URL =
  'https://azgaar.github.io/Fantasy-Map-Generator/?seed=earth1&width=1920&height=960&options=default';

const DEFAULT_TIMEOUT_MS = 120_000;
const LAND_RATIO_MIN = 0.2;
const LAND_RATIO_MAX = 0.4;
const EARTH_LAND_RATIO_TARGET = 0.29;

interface CliOptions {
  headed: boolean;
  timeoutMs: number;
}

interface AzgaarStats {
  cellCount: number;
  landCells: number;
  landRatio: number;
  nonZeroBiomes: number;
  riverCount: number;
}

type EditHeightmapOptions = {
  mode: 'erase';
  tool: 'imageConverter';
};

type AzgaarWindow = Window & {
  editHeightmap?: (options: EditHeightmapOptions) => void;
  pack?: {
    cells?: {
      h?: ArrayLike<number>;
      biome?: ArrayLike<number>;
    };
    rivers?: ArrayLike<unknown>;
  };
  grid?: {
    cells?: {
      h?: ArrayLike<number>;
    };
  };
};

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let headed = false;
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--headed') {
      headed = true;
    } else if (arg === '--timeout-ms' && args[i + 1]) {
      timeoutMs = Number.parseInt(args[++i], 10);
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
        throw new Error('--timeout-ms must be a positive integer');
      }
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { headed, timeoutMs };
}

function printUsage(): void {
  console.log(`Usage:
  tsx macro-world/scripts/generate-earth-map.ts [--headed] [--timeout-ms 120000]

Imports macro-world/earth-reference/heightmap.png into Azgaar FMG, waits for
terrain regeneration, and verifies the resulting land ratio and biome data.`);
}

function assertHeightmapExists(): void {
  if (fs.existsSync(HEIGHTMAP_PATH)) return;

  throw new Error(
    `Missing heightmap input: ${HEIGHTMAP_PATH}\n` +
      'Run `npm run worldgen:heightmap` first, or create heightmap.png with the converter script.',
  );
}

async function waitForAzgaar(page: Page, timeoutMs: number): Promise<void> {
  await page.goto(AZGAAR_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForFunction(
    () => {
      const azgaar = window as unknown as AzgaarWindow;
      return Boolean(azgaar.pack?.cells?.h && document.querySelector('#map'));
    },
    null,
    { timeout: timeoutMs },
  );
}

async function openImageConverter(page: Page, timeoutMs: number): Promise<void> {
  await page.evaluate(() => {
    const azgaar = window as unknown as AzgaarWindow;
    if (typeof azgaar.editHeightmap !== 'function') {
      throw new Error('Azgaar editHeightmap() is not available');
    }

    azgaar.editHeightmap({ mode: 'erase', tool: 'imageConverter' });
  });

  await page.locator('#imageToLoad').waitFor({ state: 'attached', timeout: timeoutMs });
  await page.locator('#convertAutoLum').waitFor({ state: 'visible', timeout: timeoutMs });
}

async function importHeightmap(page: Page, timeoutMs: number): Promise<void> {
  await page.locator('#imageToLoad').setInputFiles(HEIGHTMAP_PATH);

  // The converter populates SVG preview/assignment data asynchronously after the
  // file input change event. A visible Complete button means the image converter
  // panel is active; the short wait gives FileReader/canvas work a chance to finish.
  await page.waitForTimeout(500);

  await page.locator('#convertAutoLum').click({ timeout: timeoutMs });
  await page.waitForTimeout(500);

  await page.locator('#convertComplete').click({ timeout: timeoutMs });
  await page.locator('#imageConverter').waitFor({ state: 'hidden', timeout: timeoutMs });
}

async function normalizeImportedLandRatio(page: Page): Promise<number> {
  return page.evaluate((targetLandRatio: number) => {
    const azgaar = window as unknown as AzgaarWindow;
    const heights = azgaar.grid?.cells?.h;
    if (!heights) throw new Error('Azgaar grid height data is unavailable');

    const heightValues = Array.from(heights);
    if (heightValues.length === 0) throw new Error('Azgaar grid has zero height cells');

    const sortedHeights = [...heightValues].sort((a, b) => a - b);
    const thresholdIndex = Math.max(
      0,
      Math.min(sortedHeights.length - 1, Math.floor((1 - targetLandRatio) * sortedHeights.length)),
    );
    const seaLevelSourceValue = sortedHeights[thresholdIndex];
    const maxSourceValue = Math.max(...heightValues);
    const sourceLandRange = Math.max(1, maxSourceValue - seaLevelSourceValue);

    const normalized = heightValues.map(height => {
      if (height <= seaLevelSourceValue) {
        const waterRatio = seaLevelSourceValue <= 0 ? 0 : height / seaLevelSourceValue;
        return Math.max(0, Math.min(19, Math.round(waterRatio * 19)));
      }

      const landRatio = (height - seaLevelSourceValue) / sourceLandRange;
      return Math.max(20, Math.min(100, Math.round(20 + landRatio * 80)));
    });

    azgaar.grid.cells.h = new Uint8Array(normalized);
    const landCells = normalized.filter(height => height >= 20).length;
    return landCells / normalized.length;
  }, EARTH_LAND_RATIO_TARGET);
}

async function finalizeHeightmap(page: Page, timeoutMs: number): Promise<void> {
  await page.locator('#finalizeHeightmap').click({ timeout: timeoutMs });

  await page.waitForFunction(
    () => {
      const azgaar = window as unknown as AzgaarWindow;
      const biomes = azgaar.pack?.cells?.biome;
      const finalizeButton = document.querySelector<HTMLElement>('#finalizeHeightmap');
      const finalized = !finalizeButton || finalizeButton.offsetParent === null;
      return finalized && Boolean(biomes && Array.from(biomes).some(value => value > 0));
    },
    null,
    { timeout: timeoutMs },
  );
}

async function collectStats(page: Page): Promise<AzgaarStats> {
  return page.evaluate(() => {
    const azgaar = window as unknown as AzgaarWindow;
    const heights = azgaar.grid?.cells?.h;
    const biomes = azgaar.pack?.cells?.biome;

    if (!heights || !biomes) {
      throw new Error('Azgaar grid/pack cell data is unavailable');
    }

    const heightValues = Array.from(heights);
    const biomeValues = Array.from(biomes);
    const landCells = heightValues.filter(height => height >= 20).length;
    const cellCount = heightValues.length;

    return {
      cellCount,
      landCells,
      landRatio: cellCount === 0 ? 0 : landCells / cellCount,
      nonZeroBiomes: biomeValues.filter(biome => biome > 0).length,
      riverCount: azgaar.pack?.rivers?.length ?? 0,
    };
  });
}

function validateStats(stats: AzgaarStats): void {
  if (stats.cellCount === 0) {
    throw new Error('Azgaar generated zero cells');
  }

  if (stats.landRatio < LAND_RATIO_MIN || stats.landRatio > LAND_RATIO_MAX) {
    throw new Error(
      `Land ratio ${(stats.landRatio * 100).toFixed(1)}% is outside expected ` +
        `${LAND_RATIO_MIN * 100}-${LAND_RATIO_MAX * 100}% range`,
    );
  }

  if (stats.nonZeroBiomes === 0) {
    throw new Error('Biome regeneration did not complete: all biome values are zero');
  }
}

async function run(): Promise<void> {
  const options = parseArgs();
  assertHeightmapExists();

  let browser: Browser | null = null;

  try {
    console.log(`Launching Azgaar FMG (${options.headed ? 'headed' : 'headless'})...`);
    browser = await chromium.launch({ headless: !options.headed });
    const page = await browser.newPage({ viewport: { width: 1920, height: 960 } });

    console.log('Loading Azgaar...');
    await waitForAzgaar(page, options.timeoutMs);

    console.log('Opening heightmap image converter...');
    await openImageConverter(page, options.timeoutMs);

    console.log(`Importing ${path.relative(REPO_ROOT, HEIGHTMAP_PATH)}...`);
    await importHeightmap(page, options.timeoutMs);

    const importedLandRatio = await normalizeImportedLandRatio(page);
    console.log(`Normalized imported grid land ratio to ${(importedLandRatio * 100).toFixed(1)}%.`);

    console.log('Finalizing heightmap and regenerating terrain...');
    await finalizeHeightmap(page, options.timeoutMs);

    const stats = await collectStats(page);
    validateStats(stats);

    console.log('\nEarth heightmap import complete.');
    console.log(`  Grid cells: ${stats.cellCount}`);
    console.log(`  Land cells: ${stats.landCells} (${(stats.landRatio * 100).toFixed(1)}%)`);
    console.log(`  Biome cells:${stats.nonZeroBiomes}`);
    console.log(`  Rivers:     ${stats.riverCount}`);
  } finally {
    await browser?.close();
  }
}

void run().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nError: ${message}`);
  process.exit(1);
});
