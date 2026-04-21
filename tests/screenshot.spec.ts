/**
 * Visual screenshot capture — not a pass/fail test.
 * Run with: npm run screenshot
 *
 * Uses --headed so the real GPU renders the WebGL RenderTexture terrain correctly.
 * Headless Chrome cannot batch-draw RenderTextures, making the ground appear flat grey.
 *
 * Saves to screenshots/ at the project root. Future agents should read these files
 * to understand the current visual state of the game before suggesting visual changes.
 * A manifest (screenshots/manifest.json) lists each file and what it shows.
 */

import { test } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT_DIR = path.resolve('screenshots');

// Generous timeouts — GameScene.create() is heavy (terrain + animals).
const BOOT_MS        = 12_000;
const SCENE_READY_MS = 20_000;

// Shared manifest built up across tests and written in afterAll.
const manifest: { file: string; description: string; capturedAt: string }[] = [];

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

test.afterAll(() => {
  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
});

// ── helpers ───────────────────────────────────────────────────────────────────

async function bootGame(
  page: import('@playwright/test').Page,
  route = '/',
) {
  await page.goto(route);
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>)['__game'],
    { timeout: BOOT_MS },
  );
}

async function startGameScene(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const game = (window as unknown as Record<string, Phaser.Game>)['__game'];
    // Stop MainMenuScene and its background scenes before starting GameScene.
    // CombatArenaScene runs as a background behind MainMenuScene; stopping it
    // first frees GPU/CPU so GameScene.create() completes within the timeout.
    game?.scene?.stop('CombatArenaScene');
    game?.scene?.stop('WilderviewScene');
    game?.scene?.stop('MainMenuScene');
    game?.scene?.start('GameScene');
  });
  await page.waitForFunction(
    () => {
      const g = (window as unknown as Record<string, { scene?: { getScene?: (k: string) => { player?: unknown } | null } }>)['__game'];
      return !!g?.scene?.getScene?.('GameScene')?.player;
    },
    { timeout: SCENE_READY_MS },
  );
}

async function exitAttractMode(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup',   { key: 'a', code: 'KeyA', keyCode: 65, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  });
  await page.waitForFunction(
    () => {
      const g = (window as unknown as Record<string, unknown>)['__game'] as { scene?: { getScene?: (k: string) => Record<string, unknown> | null } } | undefined;
      return g?.scene?.getScene?.('GameScene')?.['attractMode'] === false;
    },
    { timeout: 8_000 },
  );
}

async function capture(
  page: import('@playwright/test').Page,
  filename: string,
  description: string,
) {
  const filePath = path.join(OUT_DIR, filename);
  await page.screenshot({ path: filePath, fullPage: false });
  manifest.push({ file: filename, description, capturedAt: new Date().toISOString() });
}

// ── 1. Main menu ──────────────────────────────────────────────────────────────

test('screenshot: main menu', async ({ page }) => {
  await bootGame(page, '/menu');

  await page.waitForFunction(
    () => {
      const game = (window as unknown as Record<string, Phaser.Game>)['__game'];
      return !!game?.scene?.getScene('MainMenuScene')?.sys?.settings?.active;
    },
    { timeout: BOOT_MS },
  );

  // Settle any intro animation
  await page.waitForTimeout(2_500);

  await capture(page, '01-main-menu.png', 'Main menu scene — title, nav buttons, background');
});

// ── 2. Game world — player view (zoom 3) ─────────────────────────────────────

test('screenshot: game world player view', async ({ page }) => {
  await bootGame(page);
  await startGameScene(page);
  await exitAttractMode(page);

  // Settle particles and overlays
  await page.waitForTimeout(1_500);

  await capture(
    page,
    '02-game-world-player-view.png',
    'Game world at default zoom (3×) — HUD visible, player centred, terrain and nearby objects',
  );
});

// ── 3. Game world — zoomed out (zoom 1) ──────────────────────────────────────

test('screenshot: game world overview', async ({ page }) => {
  await bootGame(page);
  await startGameScene(page);
  await exitAttractMode(page);

  // Pull camera back to show a large slice of the world map
  await page.evaluate(() => {
    const game = (window as unknown as Record<string, Phaser.Game>)['__game'];
    const scene = game?.scene?.getScene('GameScene') as Phaser.Scene | null;
    scene?.cameras?.main?.setZoom(0.6);
  });

  await page.waitForTimeout(1_000);

  await capture(
    page,
    '03-game-world-overview.png',
    'Game world at 0.6× zoom — wide view showing terrain biomes, settlements, and animal distribution',
  );
});

// ── 4. Pause menu overlay ─────────────────────────────────────────────────────

test('screenshot: pause menu', async ({ page }) => {
  await bootGame(page);
  await startGameScene(page);
  await exitAttractMode(page);
  await page.waitForTimeout(800);

  // Open pause via keyboard
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  });

  // Wait for PauseMenuScene to become active
  await page.waitForFunction(
    () => {
      const game = (window as unknown as Record<string, Phaser.Game>)['__game'];
      return !!game?.scene?.getScene('PauseMenuScene')?.sys?.settings?.active;
    },
    { timeout: 4_000 },
  );

  await page.waitForTimeout(400);

  await capture(page, '04-pause-menu.png', 'Pause menu overlay — backdrop, panel, Resume/Settings/Quit buttons');
});

// ── 5. Combat arena ───────────────────────────────────────────────────────────

test('screenshot: combat arena', async ({ page }) => {
  await bootGame(page, '/menu');

  // Wait for MainMenuScene to settle, then click the Arena button.
  // This mirrors the real user flow and ensures CombatArenaScene starts in
  // foreground mode (not as a background, which suppresses the HUD).
  await page.waitForFunction(
    () => {
      const game = (window as unknown as Record<string, Phaser.Game>)['__game'];
      return !!game?.scene?.getScene('MainMenuScene')?.sys?.settings?.active;
    },
    { timeout: BOOT_MS },
  );
  await page.waitForTimeout(1_000);

  // Stop all background scenes and restart CombatArenaScene in foreground mode.
  // Pass {} explicitly so Phaser doesn't reuse the stale { background: true }
  // init data from the bgMode launch — that would suppress the HUD and nav panel.
  await page.evaluate(() => {
    const game = (window as unknown as Record<string, Phaser.Game>)['__game'];
    game?.scene?.stop('CombatArenaScene');
    game?.scene?.stop('WilderviewScene');
    game?.scene?.stop('MainMenuScene');
    game?.scene?.start('CombatArenaScene', {});
  });

  // Wait until MainMenuScene is gone and CombatArenaScene is the only active scene.
  await page.waitForFunction(
    () => {
      const g = (window as unknown as Record<string, Phaser.Game>)['__game'];
      const menuGone  = !g?.scene?.getScene('MainMenuScene')?.sys?.settings?.active;
      const arenaUp   = !!g?.scene?.getScene('CombatArenaScene')?.sys?.settings?.active;
      return menuGone && arenaUp;
    },
    { timeout: 8_000 },
  );

  // Let the first wave spawn and the hero start fighting.
  await page.waitForTimeout(4_000);

  await capture(page, '05-combat-arena.png', 'Combat arena — colosseum floor, ashlar walls, wave 1 enemies vs Tinkerer');
});
