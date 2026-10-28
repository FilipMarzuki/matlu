import { test, expect, type Page } from '@playwright/test';

/**
 * #1868 — keeping a heading, in a real browser. A Warden who packs no map and compass reaches
 * Explore's chooser with the eight ways greyed and a note saying what's missing (unless the sun is
 * out today); with the sewing kit packed, Make a needle compass is a card in the actions. It fits a
 * phone without scrolling sideways, and the page throws nothing.
 *
 * SHOTS=<dir> also saves screenshots of the chooser and the card there.
 */

const SHOTS = process.env['SHOTS'];

async function throughIntro(page: Page, name = 'Signe'): Promise<void> {
  for (let i = 0; i < 14 && (await page.locator('[data-intro="next"]').isVisible()); i++) {
    if (await page.locator('.tchoice').first().isVisible()) {
      await page.locator('#wname').fill(name);
      await page.locator('.tchoice').nth(0).click();
      await page.locator('.tchoice').nth(1).click();
    }
    // The pack (#1401): the leader's list, without the map and compass, with the sewing kit.
    const compass = page.locator('[data-kit="map-compass"]');
    if (await compass.isVisible() && (await compass.getAttribute('aria-pressed')) === 'true') {
      await compass.click();
      const sewing = page.locator('[data-kit="sewing-kit"]');
      if (await sewing.isVisible() && (await sewing.getAttribute('aria-pressed')) !== 'true') await sewing.click();
    }
    await page.locator('[data-intro="next"]').click();
  }
  await expect(page.locator('[data-intro="next"]')).toHaveCount(0);
}

for (const lang of ['en', 'sv'] as const) {
  for (const [label, width, height] of [['phone', 400, 860], ['desktop', 1280, 860]] as const) {
    test(`${lang} ${label}: with no compass the eight ways are greyed, and the needle compass is a card`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('/artificer.html');
      await page.evaluate(lang => {
        localStorage.clear();
        localStorage.setItem('artificer.lang', lang);
        // The whole intro, with its creation screen (the quick start, #1928, would Play past it).
        localStorage.setItem('artificer.features', JSON.stringify({ 'quick-start': false }));
      }, lang);
      await page.reload();
      // The first day's weather is the run's own (seeded): on a clear day the shadow stick keeps a heading and nothing is greyed.
      await throughIntro(page);
      await page.locator('[data-startexplore]').click();
      const ack = page.locator('[data-wxack]');
      if (await ack.isVisible()) await ack.click();
      await expect(page.locator('.ringpick')).toBeVisible();
      const compass = page.locator('.ringpick .compass');
      // Greyed unless today's sky shows the sun (seeded weather): then the shadow stick keeps a heading.
      if (await compass.evaluate(el => el.classList.contains('nohead'))) {
        await expect(compass.locator('.cpb.locked')).toHaveCount(8);
        await expect(compass.locator('[data-way="here"]')).toBeEnabled();
        await expect(compass.locator('.cpnote')).toContainText(lang === 'en' ? 'you need something to keep a heading' : 'du behöver något att hålla kursen med');
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (SHOTS) {
        await page.locator('.ringpick').screenshot({ path: `${SHOTS}/1868-compass-greyed-${lang}-${label}.png` });
        await page.screenshot({ path: `${SHOTS}/1868-plan-${lang}-${label}.png`, fullPage: true });
      }
      const card = page.locator('[data-q="needlecompass"]');
      await expect(card).toBeVisible();
      await expect(card).toContainText(lang === 'en' ? 'MAKE A NEEDLE COMPASS' : 'GÖR EN NÅLKOMPASS');
      if (SHOTS) await card.screenshot({ path: `${SHOTS}/1868-needle-card-${lang}-${label}.png` });
      // Queued, it's in the plan.
      await card.click();
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/1868-needle-queued-${lang}-${label}.png`, fullPage: true });
      expect(errors).toEqual([]);
    });
  }
}
