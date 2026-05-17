/**
 * Biome screenshot capture for the Codex biome cards.
 *
 * Run with: npm run screenshots:biomes
 *
 * Uses the local Vite preview build through playwright.screenshot.config.ts.
 * Keep this headed: WebGL terrain previews can render incorrectly in headless
 * Chromium, and the generated PNGs are committed as wiki assets.
 */

import { test, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { BIOMES } from '../wiki/src/data/biomes';

const OUT_DIR = path.resolve('public/assets/screenshots/biomes');
const BOOT_MS = 12_000;
const SCENE_READY_MS = 20_000;
const RENDER_SETTLE_MS = 1_500;

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function waitForWorldForge(page: Page, biomeIndex: number): Promise<void> {
  await page.waitForFunction(
    (idx: number) => {
      const game = (window as unknown as Record<string, Phaser.Game>)['__game'];
      const scene = game?.scene?.getScene('WorldForgeScene') as
        | (Phaser.Scene & { selectedBiome?: number })
        | null;

      return scene?.sys?.settings?.active === true && scene.selectedBiome === idx;
    },
    biomeIndex,
    { timeout: SCENE_READY_MS },
  );
}

test.beforeAll((): void => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

for (const [index, biome] of BIOMES.entries()) {
  test(`biome screenshot: ${biome.name}`, async ({ page }): Promise<void> => {
    await page.goto(`/biome?biome=${index}`);
    await page.waitForFunction(
      () => !!(window as unknown as Record<string, unknown>)['__game'],
      { timeout: BOOT_MS },
    );
    await waitForWorldForge(page, index);

    // Let tile sprites, decor scatter, and WebGL batches settle before capture.
    await page.waitForTimeout(RENDER_SETTLE_MS);

    await page.screenshot({
      path: path.join(OUT_DIR, `${slugify(biome.name)}.png`),
      fullPage: false,
    });
  });
}
