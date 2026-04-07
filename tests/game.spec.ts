import { test, expect } from '@playwright/test';

const GAME_BOOT_MS = 8_000; // time to wait for Phaser to boot and first scene to render

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

  // Skip WilderviewScene by pressing Enter → starts GameScene
  await page.keyboard.press('Enter');

  // Give GameScene time to boot
  await page.waitForTimeout(2_000);

  // Read initial player Y position from window.__game
  const initialY = await page.evaluate(() => {
    const game = (window as unknown as Record<string, Phaser.Game>)['__game'];
    const scene = game?.scene?.getScene('GameScene') as
      | (Phaser.Scene & { player?: Phaser.GameObjects.Container })
      | null;
    return scene?.player?.y ?? null;
  });

  expect(initialY).not.toBeNull();

  // Hold W for 300ms to move up
  await page.keyboard.down('w');
  await page.waitForTimeout(300);
  await page.keyboard.up('w');

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
