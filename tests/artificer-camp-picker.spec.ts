import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * #1986 — Make camp's picker, in a real browser. A Warden who knows two places to camp taps Make
 * camp: a popup lists both, each with what can be told of its surroundings, and tapping one queues
 * Make camp there. Cancel, Escape and a tap beside it queue nothing. Off, the card queues Make camp
 * itself, as before. No page errors, no sideways scroll.
 *
 * SHOTS=<dir> also saves screenshots of the picker there, at both sizes and in both languages, as
 * the issue's acceptance asks.
 */
test.use({ hasTouch: true });

const SHOTS = process.env['SHOTS'];

interface Saved { saveKey: string; guideKey: string; save: string; spots: string[] }
/** The save, made once for the whole file (the game's own code, so it costs a few sim days to make). */
const EXPLORED: Saved =
  JSON.parse(execFileSync('npx', ['tsx', fileURLToPath(new URL('./helpers/artificer-camp-picker-save.ts', import.meta.url))], { encoding: 'utf8' }));

async function openPlan(page: Page, lang: 'en' | 'sv', features: Record<string, boolean> = {}): Promise<{ errors: string[]; saved: Saved }> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const saved = EXPLORED;
  await page.goto('/artificer.html');
  await page.evaluate(({ saveKey, guideKey, save, lang, features }) => {
    localStorage.clear();
    localStorage.setItem('artificer.lang', lang);
    localStorage.setItem(saveKey, save);
    // Through the first-morning guide already, so every action shows.
    localStorage.setItem(guideKey, JSON.stringify({ done: true, run: null }));
    localStorage.setItem('artificer.tab', 'plan');
    localStorage.setItem('artificer.features', JSON.stringify(features));
  }, { ...saved, lang, features });
  await page.reload();
  return { errors, saved };
}

/** The queue as the page saved it: what a tap really queued, whatever the screen shows. */
const queueOf = (page: Page, saveKey: string): Promise<unknown[]> =>
  page.evaluate(key => (JSON.parse(localStorage.getItem(key) ?? '{}') as { queue?: unknown[] }).queue ?? [], saveKey);

const words = { en: { title: 'Where will you make camp?', cancel: 'Cancel' }, sv: { title: 'Var slår du läger?', cancel: 'Avbryt' } };

for (const lang of ['en', 'sv'] as const) {
  for (const [label, width, height] of [['tablet', 1024, 700], ['phone', 400, 860]] as const) {
    test(`${lang} ${label}: Make camp opens the places you know, and the one tapped is queued`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const { errors, saved } = await openPlan(page, lang);
      const before = await queueOf(page, saved.saveKey);

      await page.locator('[data-campick]:visible').first().click();
      const pick = page.locator('.campick');
      await expect(pick).toBeVisible();
      await expect(pick.locator('h2')).toHaveText(words[lang].title);
      await expect(pick.locator('[data-camp]')).toHaveCount(saved.spots.length);
      await expect(pick.locator('[data-camp]').first()).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/1986-picker-${lang}-${label}.png` }); }

      // The second place: Make camp is queued there, and the popup goes.
      const spot = saved.spots[1];
      await pick.locator(`[data-camp="${spot}"]`).click();
      await expect(page.locator('.campick')).toHaveCount(0);
      expect(await queueOf(page, saved.saveKey)).toEqual([...before, { q: 'camp', opts: { spot } }]);
      expect(errors).toEqual([]);
    });
  }
}

test('Cancel, Escape and a tap beside it shut the picker, and queue nothing', async ({ page }) => {
  const { errors, saved } = await openPlan(page, 'en');
  const before = await queueOf(page, saved.saveKey);
  const card = page.locator('[data-campick]:visible').first();

  await card.click();
  await page.locator('[data-cmd="campickclose"]').click();
  await expect(page.locator('.campick')).toHaveCount(0);
  await expect(card).toBeFocused();

  await card.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.campick')).toHaveCount(0);

  await card.click();
  await page.locator('[data-campickwrap]').click({ position: { x: 4, y: 4 } });
  await expect(page.locator('.campick')).toHaveCount(0);

  expect(await queueOf(page, saved.saveKey)).toEqual(before);
  expect(errors).toEqual([]);
});

test('Tab and Shift+Tab stay inside the picker while it\'s open', async ({ page }) => {
  const { errors } = await openPlan(page, 'en');
  await page.locator('[data-campick]:visible').first().click();
  await expect(page.locator('.campick')).toBeVisible();
  for (const shift of [false, false, false, true, true, true, true]) {
    await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.campick'))).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('switched off, Make camp queues itself as before: no picker', async ({ page }) => {
  const { errors, saved } = await openPlan(page, 'en', { 'camp-picker': false });
  const before = await queueOf(page, saved.saveKey);
  await expect(page.locator('[data-campick]')).toHaveCount(0);
  await page.locator('[data-q="camp"]:visible').first().click();
  await expect(page.locator('.campick')).toHaveCount(0);
  expect(await queueOf(page, saved.saveKey)).toEqual([...before, 'camp']);
  expect(errors).toEqual([]);
});
