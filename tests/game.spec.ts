import { test, expect } from '@playwright/test';

const GAME_BOOT_MS = 8_000; // time to wait for Phaser to boot and first scene to render
const SCENE_READY_MS = 15_000; // extra time for GameScene.create() to finish (heavy work)

// ─── Smoke test ───────────────────────────────────────────────────────────────

test('game canvas renders without crashing', async ({ page }) => {
  await page.goto('/');

  // Phaser creates a <canvas> element inside #game-container
  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible({ timeout: GAME_BOOT_MS });

  // No uncaught errors should have occurred
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.waitForTimeout(1_000);
  expect(errors).toHaveLength(0);
});

// ─── Bot test: keyboard input moves the player ───────────────────────────────

test('pressing W key moves the player upward', async ({ page }) => {
  await page.goto('/');

  // Wait for canvas to appear (WilderviewScene is running)
  await expect(page.locator('#game-container canvas')).toBeVisible({ timeout: GAME_BOOT_MS });

  // GameScene.create() does heavy work (terrain, chunks, animals).
  // Poll until the player object exists before interacting with keyboard.
  // This avoids a race where we press Enter before the keydown listener is set up.
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown | null>)['__game']
      && !!((window as unknown as Record<string, { scene?: { getScene?: (k: string) => { player?: unknown } | null } }>)['__game']?.scene?.getScene?.('GameScene')?.player),
    { timeout: SCENE_READY_MS },
  );

  // Dispatch keydown events directly on window so Phaser's keyboard plugin
  // receives them regardless of page focus state in headless Chrome.
  // Phaser uses event.keyCode (not event.key) for key matching, so keyCode must
  // be set correctly. Attract mode needs at least one character typed before Enter.
  await page.evaluate(() => {
    // 'A' keyCode = 65, 'Enter' keyCode = 13
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup',   { key: 'a', code: 'KeyA', keyCode: 65, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  });

  // Poll until attract mode has exited (body enabled and attractMode = false)
  await page.waitForFunction(
    () => {
      const game = (window as unknown as Record<string, unknown>)['__game'] as { scene?: { getScene?: (k: string) => Record<string, unknown> | null } } | undefined;
      const scene = game?.scene?.getScene?.('GameScene');
      if (!scene) return false;
      // attractMode is false once exitAttractMode() has run
      return scene['attractMode'] === false;
    },
    { timeout: 5_000 },
  );

  // Read initial player Y position from window.__game
  const initialY = await page.evaluate(() => {
    const game = (window as unknown as Record<string, Phaser.Game>)['__game'];
    const scene = game?.scene?.getScene('GameScene') as
      | (Phaser.Scene & { player?: Phaser.GameObjects.Container })
      | null;
    return scene?.player?.y ?? null;
  });

  expect(initialY).not.toBeNull();

  // Dispatch W keydown directly on window, hold for ~300ms, then keyup.
  // 'W' keyCode = 87 — Phaser looks up keys by keyCode, not by key string.
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', keyCode: 87, bubbles: true }));
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW', keyCode: 87, bubbles: true }));
  });

  const afterY = await page.evaluate(() => {
    const game = (window as unknown as Record<string, Phaser.Game>)['__game'];
    const scene = game?.scene?.getScene('GameScene') as
      | (Phaser.Scene & { player?: Phaser.GameObjects.Container })
      | null;
    return scene?.player?.y ?? null;
  });

  expect(afterY).not.toBeNull();
  // Player should have moved upward (Y decreases in Phaser's coordinate system)
  expect(afterY as number).toBeLessThan(initialY as number);
});
