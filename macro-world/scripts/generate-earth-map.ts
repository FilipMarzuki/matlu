/**
 * generate-earth-map.ts — Playwright automation for Azgaar's Fantasy Map Generator.
 *
 * Imports the Earth heightmap PNG, waits for terrain regeneration, then exports
 * both the native .map save and a full JSON export.
 *
 * Usage:
 *   npm run worldgen:generate              headless (default)
 *   npm run worldgen:generate -- --headed  show the browser for debugging
 *
 * Prerequisites:
 *   npm run worldgen:heightmap   (produces earth-reference/heightmap.png)
 *   npx playwright install chromium
 *
 * Output:
 *   macro-world/earth-reference/azgaar.map          — native Azgaar save
 *   macro-world/earth-reference/azgaar-export.json   — full JSON export
 */

import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ── Paths ────────────────────────────────────────────────────────────────────

const HEIGHTMAP_PATH = path.join(REPO_ROOT, 'macro-world', 'earth-reference', 'heightmap.png');
const MAP_OUT = path.join(REPO_ROOT, 'macro-world', 'earth-reference', 'azgaar.map');
const JSON_OUT = path.join(REPO_ROOT, 'macro-world', 'earth-reference', 'azgaar-export.json');

const FMG_URL = 'https://azgaar.github.io/Fantasy-Map-Generator/';

// ── Thresholds ───────────────────────────────────────────────────────────────

const LAND_RATIO_MIN = 0.20;
const LAND_RATIO_MAX = 0.40;

// ── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs(): { headed: boolean } {
  const args = process.argv.slice(2);
  return { headed: args.includes('--headed') };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { headed } = parseArgs();

  console.log('\n── Azgaar Earth Map Generator ──────────────────────────────');
  console.log(`  Heightmap : ${HEIGHTMAP_PATH}`);
  console.log(`  Mode      : ${headed ? 'headed' : 'headless'}`);
  console.log('');

  // Pre-flight: heightmap must exist
  if (!fs.existsSync(HEIGHTMAP_PATH)) {
    console.error(`Error: heightmap.png not found at ${HEIGHTMAP_PATH}`);
    console.error('Run: npm run worldgen:heightmap');
    process.exit(1);
  }

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(MAP_OUT), { recursive: true });

  const browser = await chromium.launch({
    headless: !headed,
    // SwiftShader provides WebGL in headless mode for canvas-heavy apps
    args: ['--enable-webgl', '--use-gl=swiftshader'],
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);

    // ── Step 1: Navigate to Azgaar FMG ───────────────────────────────────
    console.log('  [1/8] Loading Azgaar Fantasy Map Generator...');
    await page.goto(FMG_URL);

    // Wait for the initial procedural map to finish generating
    await page.waitForFunction(
      () => (window as any).mapId > 0,
      { timeout: 60_000 },
    );
    console.log('  [2/8] Initial map generated');

    // ── Step 2: Open heightmap editor in erase + imageConverter mode ─────
    await page.evaluate(() =>
      (window as any).editHeightmap({ mode: 'erase', tool: 'imageConverter' }),
    );
    await page.waitForSelector('#imageConverter', { state: 'visible' });
    console.log('  [3/8] Image converter opened');

    // ── Step 3: Upload the Earth heightmap ───────────────────────────────
    // The file input (#imageToLoad) is a hidden <input type="file"> inside
    // #fileInputs. setInputFiles bypasses visibility constraints.
    await page.locator('#imageToLoad').setInputFiles(HEIGHTMAP_PATH);
    await page.waitForSelector('#colorsUnassigned', { state: 'visible', timeout: 60_000 });
    console.log('  [4/8] Heightmap uploaded, colors extracted');

    // ── Step 4: Auto-assign heights by luminosity, then complete ─────────
    // Luminosity mode maps dark pixels to ocean and light pixels to
    // mountains — ideal for a grayscale Earth DEM.
    await page.click('#convertAutoLum');
    await page.click('#convertComplete');
    console.log('  [5/8] Height assignment complete');

    // ── Step 5: Finalize heightmap edit ──────────────────────────────────
    // This exits the heightmap editor and triggers full map regeneration
    // (climate, rivers, biomes, cultures, states, etc.). Sets the
    // `customization` global to 0, which is required for JSON export.
    await page.click('#finalizeHeightmap');
    await page.waitForFunction(
      () => {
        const pack = (window as any).pack;
        return pack?.burgs?.length > 1 && pack?.cells?.biome?.some((b: number) => b > 0);
      },
      { timeout: 120_000 },
    );
    console.log('  [6/8] Terrain regeneration complete');

    // ── Step 6: Verify land ratio ────────────────────────────────────────
    const landRatio: number = await page.evaluate(() => {
      const cells = (window as any).pack?.cells;
      if (!cells?.h) throw new Error('pack.cells.h not available');
      const h = cells.h as number[];
      const total = h.length;
      let land = 0;
      for (let i = 0; i < total; i++) {
        if (h[i] >= 20) land++;
      }
      return land / total;
    });

    console.log(`         Land ratio: ${(landRatio * 100).toFixed(1)}%`);
    if (landRatio < LAND_RATIO_MIN || landRatio > LAND_RATIO_MAX) {
      console.warn(
        `  Warning: land ratio ${(landRatio * 100).toFixed(1)}% is outside expected ` +
        `${LAND_RATIO_MIN * 100}%–${LAND_RATIO_MAX * 100}% range`,
      );
    }

    // ── Step 7: Export .map file ─────────────────────────────────────────
    // Register the download listener BEFORE triggering the download.
    // saveMap('machine') bypasses the browser's file-save dialog.
    const dlMap = page.waitForEvent('download');
    await page.evaluate(() => (window as any).saveMap('machine'));
    const mapDownload = await dlMap;
    await mapDownload.saveAs(MAP_OUT);
    console.log(`  [7/8] Saved: ${path.relative(REPO_ROOT, MAP_OUT)}`);

    // ── Step 8: Export full JSON ─────────────────────────────────────────
    // exportToJson('Full') lazy-loads the export module on first call,
    // then creates a Blob download with all map data.
    const dlJson = page.waitForEvent('download');
    await page.evaluate(() => (window as any).exportToJson('Full'));
    const jsonDownload = await dlJson;
    await jsonDownload.saveAs(JSON_OUT);
    console.log(`  [8/8] Saved: ${path.relative(REPO_ROOT, JSON_OUT)}`);

    // ── Quick sanity check on exported JSON ──────────────────────────────
    const raw = fs.readFileSync(JSON_OUT, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Azgaar Full export top-level keys
    const expectedKeys = ['info', 'settings', 'pack', 'grid', 'biomesData'];
    const missing = expectedKeys.filter(k => !(k in parsed));
    if (missing.length > 0) {
      throw new Error(`Exported JSON missing expected keys: ${missing.join(', ')}`);
    }

    const sizeMB = (fs.statSync(JSON_OUT).size / (1024 * 1024)).toFixed(1);
    console.log(`         JSON size: ${sizeMB} MB, structure valid`);

    await context.close();
  } finally {
    await browser.close();
  }

  console.log('\nDone. azgaar.map and azgaar-export.json ready.\n');
}

void main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\nError: ${message}`);
  process.exit(1);
});
