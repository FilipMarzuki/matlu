import { test, expect, type Page } from '@playwright/test';

/**
 * #1839 — Explore's compass in a real browser: from LAND's Explore button to PLAN, the chooser
 * opens with a compass (look around in the middle, the eight ways around it) above the distances.
 * Picking a way opens every distance (heading out needs no ground known first) and marks them with
 * the way; tapping one heads out. It fits a phone without scrolling sideways, and the page throws
 * nothing. Switched off, there's no compass.
 *
 * SHOTS=<dir> also saves screenshots of the chooser there.
 */

const SHOTS = process.env['SHOTS'];

async function throughIntro(page: Page): Promise<void> {
  for (let i = 0; i < 14 && (await page.locator('[data-intro="next"]').isVisible()); i++) {
    if (await page.locator('.tchoice').first().isVisible()) {
      await page.locator('#wname').fill('Signe');
      await page.locator('.tchoice').nth(0).click();
      await page.locator('.tchoice').nth(1).click();
    }
    await page.locator('[data-intro="next"]').click();
  }
  await expect(page.locator('[data-intro="next"]')).toHaveCount(0);
}

async function toChooser(page: Page, lang: 'en' | 'sv', features: Record<string, boolean> = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/artificer.html');
  await page.evaluate(({ lang, features }) => {
    localStorage.clear();
    localStorage.setItem('artificer.lang', lang);
    localStorage.setItem('artificer.features', JSON.stringify(features));
  }, { lang, features });
  await page.reload();
  await throughIntro(page);
  await page.locator('[data-startexplore]').click();
  const ack = page.locator('[data-wxack]');
  if (await ack.isVisible()) await ack.click();
  await expect(page.locator('.ringpick')).toBeVisible();
  return errors;
}

const words = { en: { head: 'Which way?', look: 'Look around', ne: 'NE' }, sv: { head: 'Åt vilket håll?', look: 'Se dig omkring', ne: 'NO' } };

for (const lang of ['en', 'sv'] as const) {
  for (const [label, width, height] of [['phone', 400, 860], ['desktop', 1280, 860]] as const) {
    test(`${lang} ${label}: Explore's chooser has a compass, and a way opens every distance`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const errors = await toChooser(page, lang);
      const w = words[lang];
      const compass = page.locator('.ringpick .compass');
      await expect(compass).toContainText(w.head);
      await expect(compass.locator('.cpb')).toHaveCount(9);
      await expect(compass.locator('[data-way="here"]')).toHaveText(w.look);
      await expect(compass.locator('[data-way="here"]')).toHaveAttribute('aria-pressed', 'true');
      // Looking around: only close by is known yet, so the further distances are greyed.
      await expect(page.locator('.ringpick .rpopt[disabled]')).toHaveCount(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (SHOTS) await page.locator('.ringpick').screenshot({ path: `${SHOTS}/1839-compass-${lang}-${label}.png` });

      // North-east: picked, and every distance open, marked with the way.
      await compass.locator('[data-way="ne"]').click();
      await expect(page.locator('.ringpick .compass [data-way="ne"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.ringpick .compass [data-way="ne"]')).toHaveText(w.ne);
      await expect(page.locator('.ringpick .rpopt[disabled]')).toHaveCount(0);
      await expect(page.locator('.ringpick .rpopt[data-pickway="ne"]')).toHaveCount(3);
      if (SHOTS) {
        await page.locator('.ringpick').screenshot({ path: `${SHOTS}/1839-compass-ne-${lang}-${label}.png` });
        await page.screenshot({ path: `${SHOTS}/1839-plan-${lang}-${label}.png` });
      }
      // Tapped again, back to looking around.
      await page.locator('.ringpick .compass [data-way="ne"]').click();
      await expect(page.locator('.ringpick .compass [data-way="here"]')).toHaveAttribute('aria-pressed', 'true');
      expect(errors).toEqual([]);
    });
  }
}

test('switched off, Explore has no compass', async ({ page }) => {
  const errors = await toChooser(page, 'en', { 'directed-explore': false });
  await expect(page.locator('.ringpick .compass')).toHaveCount(0);
  expect(errors).toEqual([]);
});
