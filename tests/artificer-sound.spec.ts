import { test, expect, type Page } from '@playwright/test';

/**
 * #1828 — the ⚙ Menu's Sound section, in a real browser: off by default; turning it on starts the
 * ambience with no page errors, the volume is kept; and a browser without Web Audio simply has none.
 */

/** A new English player, guide off, through the intro to the game. */
async function toGame(page: Page): Promise<void> {
  await page.goto('/artificer.html');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('artificer.lang', 'en'); localStorage.setItem('artificer.features', JSON.stringify({ guide: false, 'quick-start': false })); });
  await page.reload();
  for (let i = 0; i < 10 && (await page.locator('[data-intro="next"]').isVisible()); i++) {
    if (await page.locator('.tchoice').first().isVisible()) {
      await page.locator('#wname').fill('Sigrid');
      await page.locator('.tchoice').nth(0).click();
      await page.locator('.tchoice').nth(1).click();
    }
    await page.locator('[data-intro="next"]').click();
  }
  await page.locator('header [data-cmd="meny"]').click();
}

test('turning Sound on in the Menu plays with no page errors, and keeps the volume', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await toGame(page);
  const toggle = page.locator('#meny [data-meny="sound"] [data-sound="toggle"]');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-sound="volume"]')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const vol = page.locator('[data-sound="volume"]');
  await expect(vol).toBeVisible();
  await vol.fill('30');
  // Let the scheduler run a few rounds (gusts, drips, the fire).
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => localStorage.getItem('artificer.sound'))).toBe(JSON.stringify({ on: true, volume: 0.3 }));
  // Back to the game and a redraw or two: still no errors.
  await page.locator('#meny [data-cmd="menyclose"]').click();
  await page.locator('header [data-cmd="meny"]').click();
  await page.locator('#meny [data-sound="toggle"]').click();
  await expect(page.locator('#meny [data-sound="toggle"]')).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('without Web Audio, Sound on does nothing and throws nothing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w['AudioContext'];
    delete w['webkitAudioContext'];
  });
  await toGame(page);
  await page.locator('#meny [data-sound="toggle"]').click();
  await expect(page.locator('#meny [data-sound="toggle"]')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});
