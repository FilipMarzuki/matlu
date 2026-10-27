import { test, expect, type Page } from '@playwright/test';

/**
 * #1928 — the quick start, in a real browser. From a fresh start (the language picker first), one
 * story page, then the card "You're Saga, 12, a scout." with Play and Change: Play starts the game
 * on LAND, and Explore there is the fourth tap. Change reaches the creation and pack screens and
 * comes back to the card with what was chosen. Skip on the story page is Play. No page errors, no
 * sideways scroll.
 *
 * SHOTS=<dir> also saves screenshots of the story page and the card there, at both sizes and in
 * both languages, as the issue's acceptance asks.
 */

const SHOTS = process.env['SHOTS'];

const words = {
  en: { ready: "You're Saga, 12, a scout. Your pack is ready.", play: 'PLAY ▸', change: 'Change who I am / what I packed', note: 'Your patrol leader always said: scout first.' },
  sv: { ready: 'Du är Saga, 12 år, scout. Packningen är klar.', play: 'SPELA ▸', change: 'Ändra vem jag är / vad jag packat', note: 'Patrulledaren brukade säga: spana först.' },
};

/** A first visit: nothing stored, so the language picker comes first. */
async function firstVisit(page: Page, features: Record<string, boolean> = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/artificer.html');
  await page.evaluate(features => {
    localStorage.clear();
    if (Object.keys(features).length) localStorage.setItem('artificer.features', JSON.stringify(features));
  }, features);
  await page.reload();
  return errors;
}

const noSideScroll = async (page: Page, width: number) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

for (const lang of ['en', 'sv'] as const) {
  for (const [label, width, height] of [['tablet', 1024, 700], ['phone', 400, 860]] as const) {
    test(`${lang} ${label}: the story page, the card, and Explore on the fourth tap`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const errors = await firstVisit(page);
      const w = words[lang];
      let taps = 0;

      await page.locator(`[data-pick="${lang}"]`).click(); taps++;
      // The story page: the hike and the seam, with Skip and Continue.
      await expect(page.locator('.intro .beat[data-beat="fall"]')).toBeVisible();
      await expect(page.locator('[data-intro="skip"]')).toBeVisible();
      await noSideScroll(page, width);
      if (SHOTS) { await page.waitForTimeout(2600); await page.screenshot({ path: `${SHOTS}/1928-story-${lang}-${label}.png` }); }

      await page.locator('[data-intro="next"]').click(); taps++;
      // The card: who you are, Play and Change, and no Skip.
      const card = page.locator('.intro .beat[data-beat="ready"]');
      await expect(card).toContainText(w.ready);
      await expect(page.locator('[data-intro="change"]')).toHaveText(w.change);
      await expect(page.locator('[data-intro="next"]')).toHaveText(w.play);
      await expect(page.locator('[data-intro="skip"]')).toHaveCount(0);
      await expect(page.locator('[data-intro="change"]')).toBeInViewport();
      await expect(page.locator('[data-intro="next"]')).toBeInViewport();
      await noSideScroll(page, width);
      if (SHOTS) { await page.waitForTimeout(2600); await page.screenshot({ path: `${SHOTS}/1928-card-${lang}-${label}.png` }); }

      // A stray tap on the card's words doesn't Play.
      await card.click();
      await expect(card).toBeVisible();

      await page.locator('[data-intro="next"]').click(); taps++;
      await expect(page.locator('.intro')).toBeHidden();
      await expect(page.locator('.who').first()).toContainText('Saga');
      // The game opens on LAND (#1853) with the patrol leader's advice and its Explore button.
      await expect(page.locator('.landstart')).toContainText(w.note);
      await page.locator('[data-startexplore]').click(); taps++;
      await expect(page.locator('.tabbtn[data-tab="plan"]')).toHaveAttribute('aria-selected', 'true');
      expect(taps).toBeLessThanOrEqual(4);
      expect(errors).toEqual([]);
    });
  }
}

test('Change reaches the creation and pack screens, and the card comes back with what was chosen', async ({ page }) => {
  const errors = await firstVisit(page);
  await page.locator('[data-pick="en"]').click();
  await page.locator('[data-intro="next"]').click();
  await page.locator('[data-intro="change"]').click();

  // Who you are first (the run's `stats-before-pack`), the name already Saga, and changeable.
  await expect(page.locator('.intro .beat[data-beat="create"]')).toContainText('Who are you?');
  await expect(page.locator('#wname')).toHaveValue('Saga');
  await page.locator('#wname').fill('Vega');
  await page.locator('[data-age="14"]').click();
  await page.locator('.tchoice').nth(0).click();
  await page.locator('[data-intro="next"]').click();

  // Then the pack, ticked for her; "Off we go" leads back to the card.
  await expect(page.locator('.intro .beat[data-beat="pack"]')).toBeVisible();
  await expect(page.locator('.kchoice').first()).toBeVisible();
  await page.locator('[data-intro="next"]').click();
  await expect(page.locator('.intro .beat[data-beat="ready"]')).toContainText("You're Vega, 14, a scout. Your pack is ready.");

  // Enter on a focused Change is Change, not Play.
  await page.locator('[data-intro="change"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#wname')).toHaveValue('Vega');
  await page.locator('[data-intro="next"]').click();
  await page.locator('[data-intro="next"]').click();

  await page.locator('[data-intro="next"]').click();
  await expect(page.locator('.intro')).toBeHidden();
  await expect(page.locator('.who').first()).toContainText('Vega');
  expect(errors).toEqual([]);
});

test('Skip on the story page is Play', async ({ page }) => {
  const errors = await firstVisit(page);
  await page.locator('[data-pick="en"]').click();
  await page.locator('[data-intro="skip"]').click();
  await expect(page.locator('.intro')).toBeHidden();
  await expect(page.locator('.who').first()).toContainText('Saga');
  // Saved: a reload goes to the game, not back to the intro.
  await page.reload();
  await expect(page.locator('.intro')).toBeHidden();
  await expect(page.locator('.who').first()).toContainText('Saga');
  expect(errors).toEqual([]);
});

test('switched off, the whole arrival plays as before', async ({ page }) => {
  const errors = await firstVisit(page, { 'quick-start': false });
  await page.locator('[data-pick="en"]').click();
  await expect(page.locator('.intro .beat[data-beat="hike"]')).toBeVisible();
  await page.locator('[data-intro="next"]').click();
  await expect(page.locator('.intro .beat[data-beat="create"]')).toBeVisible();
  await expect(page.locator('#wname')).toHaveValue('');
  await expect(page.locator('[data-intro="change"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
