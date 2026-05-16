/**
 * Biome screenshot capture for the Codex biome cards.
 *
 * Run with: npm run screenshots:biomes
 *
 * The WorldForgeScene is the current biome inspector. The `capture=biome`
 * query param hides editor chrome so these PNGs work as static Codex previews.
 */

import { test, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { BIOMES } from '../wiki/src/data/biomes';

const OUT_DIR = path.resolve('public/assets/screenshots/biomes');
const BOOT_MS = 20_000;
const RENDER_SETTLE_MS = 1_500;

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function waitForWorldForge(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const game = (window as unknown as Record<string, Phaser.Game>)['__game'];
      return !!game?.scene?.getScene('WorldForgeScene')?.sys?.settings?.active;
    },
    { timeout: BOOT_MS },
  );
}

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

for (const [idx, biome] of BIOMES.entries()) {
  test(`biome screenshot: ${biome.name}`, async ({ page }) => {
    await page.goto(`/biome?biome=${idx}&capture=biome`);
    await page.waitForFunction(
      () => !!(window as unknown as Record<string, unknown>)['__game'],
      { timeout: BOOT_MS },
    );
    await waitForWorldForge(page);
    await page.waitForTimeout(RENDER_SETTLE_MS);

    await page.screenshot({
      path: path.join(OUT_DIR, `${slugify(biome.name)}.png`),
      fullPage: false,
    });
  });
}
