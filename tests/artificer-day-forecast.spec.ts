import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * #1930 — where the day ends, in words, in a real browser. Under the queue on a tablet, and on the
 * phone's frozen strip, one sentence says where today's plan leaves you (in the Run bar, right over
 * Run, so it stays in view with it): "Back at camp in the
 * afternoon, steady, with water for 28 nights and wood for 28 nights." Two saves: a day that ends
 * back at camp in daylight, and one over budget that ends after dark. The sentence is the game's own
 * (the helper prints it from day-forecast.ts), so the page must show exactly that. It follows the
 * queue as tasks are taken off. Off, the footer is as before. No page errors, no sideways scroll.
 *
 * SHOTS=<dir> also saves screenshots there, at both sizes, in both languages, of both days, as the
 * issue's acceptance asks.
 */
test.use({ hasTouch: true });

const SHOTS = process.env['SHOTS'];

interface Day { save: string; en: string; sv: string }
const saves = (): { saveKey: string; guideKey: string; camp: Day; over: Day } =>
  JSON.parse(execFileSync('npx', ['tsx', fileURLToPath(new URL('./helpers/artificer-day-forecast-save.ts', import.meta.url))], { encoding: 'utf8' }));
const SAVES = saves();

async function openPlan(page: Page, day: Day, lang: 'en' | 'sv', features: Record<string, boolean> = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/artificer.html');
  await page.evaluate(({ saveKey, guideKey, save, lang, features }) => {
    localStorage.clear();
    localStorage.setItem('artificer.lang', lang);
    localStorage.setItem(saveKey, save);
    // Through the first-morning guide already, so every part of PLAN shows.
    localStorage.setItem(guideKey, JSON.stringify({ done: true, run: null }));
    localStorage.setItem('artificer.tab', 'plan');
    localStorage.setItem('artificer.features', JSON.stringify(features));
  }, { saveKey: SAVES.saveKey, guideKey: SAVES.guideKey, save: day.save, lang, features });
  await page.reload();
  await expect(page.locator('.plan.sideq .planq')).toBeVisible();
  // A new morning's weather card comes first; "Got it" folds it, as a player would.
  const ack = page.locator('[data-wxack]');
  if (await ack.isVisible()) { await ack.click(); await expect(ack).toHaveCount(0); }
  return errors;
}

for (const lang of ['en', 'sv'] as const) {
  test(`${lang} tablet (1024 × 700): the line under the queue says where each day ends`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    for (const which of ['camp', 'over'] as const) {
      const day = SAVES[which];
      const errors = await openPlan(page, day, lang);
      // Scroll the actions to their bottom, as the side-queue test does: the queue's column is frozen
      // then, and its foot (the Run bar) on screen.
      await page.evaluate(() => {
        const r = document.querySelector('.planacts')!.getBoundingClientRect();
        window.scrollTo(0, window.scrollY + r.bottom - window.innerHeight);
      });
      await page.waitForTimeout(200);
      // In the Run bar, right over Run: pinned with it at the foot of the frozen column.
      const line = page.locator('.planq .queue .runbar .dayend');
      await expect(line).toHaveText(day[lang]);
      await expect(line).toBeInViewport();
      const lb = (await line.boundingBox())!;
      const run = (await page.locator('.planq .runbar [data-cmd="day"]').boundingBox())!;
      expect(lb.y + lb.height).toBeLessThanOrEqual(run.y);
      await expect(page.locator('.qsline')).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
      if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/1930-${which}-${lang}-tablet.png` }); }
      expect(errors).toEqual([]);
    }
  });

  test(`${lang} phone (400 × 860): the strip says it, and the unfolded queue doesn't say it twice`, async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 860 });
    for (const which of ['camp', 'over'] as const) {
      const day = SAVES[which];
      const errors = await openPlan(page, day, lang);
      const line = page.locator('.qstrip .qsline');
      await expect(line).toHaveText(day[lang]);
      await expect(line).toBeInViewport();
      // The strip stays a strip: the line is one or two rows, not half the screen.
      const strip = (await page.locator('.planq').boundingBox())!;
      expect(strip.height).toBeLessThan(860 * 0.25);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(400);
      if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/1930-${which}-${lang}-phone.png` }); }
      await page.locator('.qsbar').click();
      await expect(page.locator('.planq .planqfull .queue')).toBeVisible();
      await expect(page.locator('.planq .queue .dayend')).toBeHidden();
      await expect(page.locator('.dayend:visible, .qsline:visible')).toHaveCount(1);
      expect(errors).toEqual([]);
    }
  });
}

test('the line follows the queue: take tasks off a day over budget and it ends in daylight', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  const errors = await openPlan(page, SAVES.over, 'en');
  const line = page.locator('.planq .queue .dayend');
  await expect(line).toContainText('after dark');
  for (const i of [4, 3, 2]) await page.locator(`.planq [data-x="${i}"]`).click();
  await expect(page.locator('.planq .queue li[data-qi]')).toHaveCount(2);
  await expect(line).toHaveText(/^Back at camp /);
  await expect(line).not.toContainText('after dark');
  // An empty queue has no day to end.
  for (const i of [1, 0]) await page.locator(`.planq [data-x="${i}"]`).click();
  await expect(page.locator('.dayend')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('switched off, the footer is as before: no line, the time in words, nothing on the strip', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  const errors = await openPlan(page, SAVES.over, 'en', { 'day-forecast': false });
  await expect(page.locator('.dayend')).toHaveCount(0);
  await expect(page.locator('.planq .queue .qtot')).toContainText('This runs past dark.');
  await page.setViewportSize({ width: 400, height: 860 });
  await expect(page.locator('.qstrip')).toBeVisible();
  await expect(page.locator('.qsline')).toHaveCount(0);
  expect(errors).toEqual([]);
});
