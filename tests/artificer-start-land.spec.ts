import { test, expect, type Page } from '@playwright/test';

/**
 * #1853 — a new Warden starts on LAND, in a real browser: after the intro the first view is LAND
 * with the patrol leader's advice and the near area; its Explore button goes to PLAN, where (with
 * the first-morning guide) the weather card shows first and, once it's acknowledged, the Explore
 * card glows with its distance chooser open at the nearest distance. A reload opens the stored tab.
 * Switched off, the game starts on PLAN as before. No page errors.
 *
 * SHOTS=<dir> also saves screenshots (LAND with the note, PLAN after the tap) there.
 */

const SHOTS = process.env['SHOTS'];

/** Through the intro to the game, naming the Warden and picking two talents on the way. */
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

async function fresh(page: Page, lang: 'en' | 'sv', features: Record<string, boolean> = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/artificer.html');
  await page.evaluate(({ lang, features }) => {
    localStorage.clear();
    localStorage.setItem('artificer.lang', lang);
    // The whole intro, with its creation screen (the quick start, #1928, would Play past it).
    localStorage.setItem('artificer.features', JSON.stringify({ 'quick-start': false, ...features }));
  }, { lang, features });
  await page.reload();
  await throughIntro(page);
  return errors;
}

const words = {
  en: { note: 'Your patrol leader always said: scout first.', go: 'Explore', near: 'Unknown' },
  sv: { note: 'Patrulledaren brukade säga: spana först.', go: 'Utforska', near: 'Okänt' },
};

for (const lang of ['en', 'sv'] as const) {
  for (const [label, width, height] of [['phone', 400, 860], ['desktop', 1280, 860]] as const) {
    test(`${lang} ${label}: starts on LAND with the note, and Explore leads to PLAN with the chooser open`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const errors = await fresh(page, lang);
      const w = words[lang];

      // LAND, with the note, the near area and one Explore button.
      await expect(page.locator('.tabbtn[data-tab="land"]')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('.landstart')).toContainText(w.note);
      await expect(page.locator('#land-ring-1')).toBeVisible();
      await expect(page.locator('.ringfold').first()).toContainText(w.near);
      await expect(page.locator('.landexplore')).toHaveCount(0);
      const go = page.locator('[data-startexplore]');
      await expect(go).toHaveText(w.go);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/1853-land-${lang}-${label}.png`, fullPage: true });

      await go.click();
      await expect(page.locator('.tabbtn[data-tab="plan"]')).toHaveAttribute('aria-selected', 'true');
      // The guide's first-morning weather card shows first; its "Got it" brings the actions in.
      const ack = page.locator('[data-wxack]');
      if (await ack.isVisible()) {
        await expect(page.locator('.ringpick')).toHaveCount(0);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/1853-plan-weather-${lang}-${label}.png` });
        await ack.click();
      }
      // Explore glows, its chooser open at the nearest distance, which has the focus.
      const card = page.locator('[data-chooser="explore"]');
      await expect(card).toHaveClass(/guide-suggest/);
      await expect(card).toHaveAttribute('aria-expanded', 'true');
      const on = page.locator('.ringpick .rpopt.on');
      await expect(on).toHaveAttribute('data-pickring', '1');
      await expect(on).toBeFocused();
      await expect(on).toBeInViewport();
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/1853-plan-${lang}-${label}.png` });

      // A reload opens the stored tab (PLAN), not LAND again.
      await page.reload();
      await expect(page.locator('.tabbtn[data-tab="plan"]')).toHaveAttribute('aria-selected', 'true');
      // And going back to LAND on day 1 still shows the note.
      await page.locator('.tabbtn[data-tab="land"]').click();
      await expect(page.locator('.landstart')).toBeVisible();
      await page.locator('.tabbtn[data-tab="plan"]').click();
      await page.reload();
      await expect(page.locator('.tabbtn[data-tab="plan"]')).toHaveAttribute('aria-selected', 'true');
      expect(errors).toEqual([]);
    });
  }
}

test('without the guide, the tap opens the chooser at once', async ({ page }) => {
  const errors = await fresh(page, 'en', { guide: false });
  await expect(page.locator('.tabbtn[data-tab="land"]')).toHaveAttribute('aria-selected', 'true');
  await page.locator('[data-startexplore]').click();
  await expect(page.locator('[data-chooser="explore"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.ringpick .rpopt.on')).toHaveAttribute('data-pickring', '1');
  // Tapping elsewhere shuts it, and the highlight goes with it.
  await page.locator('header').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.ringpick')).toHaveCount(0);
  await expect(page.locator('[data-chooser="explore"]')).not.toHaveClass(/guide-suggest/);
  expect(errors).toEqual([]);
});

test('switched off, a new Warden starts on PLAN as before', async ({ page }) => {
  const errors = await fresh(page, 'en', { 'start-on-land': false });
  await expect(page.locator('.tabbtn[data-tab="plan"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.landstart')).toHaveCount(0);
  expect(errors).toEqual([]);
});
