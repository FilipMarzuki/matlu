import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * #2011 — the phone's queue as day bars, in a real browser. Unfolded on a phone (under 700px), the
 * queue is one bar per day with the activities in one row over it, no card per activity: a tap on an
 * activity opens its row under the bars, where ◀ ▶ move it and ✕ removes it. The bar's segments follow
 * the hours. A tablet keeps its rows, and crossing the width draws the page the other way. No page
 * errors, no sideways scroll.
 *
 * SHOTS=<dir> also saves screenshots of the unfolded queue there, in both languages.
 */

const SHOTS = process.env['SHOTS'];

test.use({ hasTouch: true });

/** A run that has learned to plan, with water, wood, food and rest queued (tests/helpers). */
const planned = (): { saveKey: string; guideKey: string; save: string } =>
  JSON.parse(execFileSync('npx', ['tsx', fileURLToPath(new URL('./helpers/artificer-planned-save.ts', import.meta.url))], { encoding: 'utf8' }));

async function openPlan(page: Page, width: number, height: number, lang: 'en' | 'sv' = 'en'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height });
  await page.goto('/artificer.html');
  await page.evaluate(({ saveKey, guideKey, save, lang }) => {
    localStorage.clear();
    localStorage.setItem('artificer.lang', lang);
    localStorage.setItem(saveKey, save);
    localStorage.setItem(guideKey, JSON.stringify({ done: true, run: null }));
    localStorage.setItem('artificer.tab', 'plan');
  }, { ...planned(), lang });
  await page.reload();
  await expect(page.locator('.plan.sideq .planq')).toBeVisible();
  return errors;
}

const chips = (page: Page) => page.locator('.planq .dbchip');
const detail = (page: Page) => page.locator('#qseldetail li[data-qi]');
const hoursOf = async (page: Page): Promise<number[]> =>
  (await chips(page).locator('b').allTextContents()).map(s => Number(s.replace(',', '.').replace('h', '')));

for (const lang of ['en', 'sv'] as const) {
  test(`${lang} phone (400 × 860): unfolded, one bar per day and the activities in a row, no cards`, async ({ page }) => {
    const errors = await openPlan(page, 400, 860, lang);
    await page.locator('[data-cmd="qstrip"]').click();
    await expect(page.locator('.planq .planqfull .queue.daybars')).toBeVisible();
    await expect(chips(page)).toHaveCount(4);
    await expect(detail(page)).toHaveCount(0);
    await expect(page.locator('.planq .queue .loadrow')).toHaveCount(0);
    // The strip's own chips step aside while the bars say them; Run the day is the strip's alone.
    await expect(page.locator('.qstrip .qschips')).toBeHidden();
    await expect(page.locator('[data-cmd="day"]:visible')).toHaveCount(1);
    await expect(page.locator('.qstrip [data-cmd="day"]')).toBeVisible();
    // Each day's segments follow the hours: their widths keep the hours' proportions.
    for (const day of await page.locator('.dayb').all()) {
      const hours = (await day.locator('.dbchip:not(.skip) b').allTextContents()).map(s => Number(s.replace(',', '.').replace('h', '')));
      const widths = await day.locator('.dbseg').evaluateAll(els => els.map(e => e.getBoundingClientRect().width));
      expect(widths).toHaveLength(hours.length);
      for (let k = 1; k < hours.length; k++) expect(widths[k] / widths[0]).toBeCloseTo(hours[k] / hours[0], 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(400);
    if (SHOTS) { await page.waitForTimeout(300); await page.locator('.planq').screenshot({ path: `${SHOTS}/2011-bars-${lang}.png` }); }
    expect(errors).toEqual([]);
  });
}

test('phone: a tap opens an activity\'s row, ◀ ▶ move it, ✕ removes it, another tap shuts it', async ({ page }) => {
  const errors = await openPlan(page, 400, 860);
  await page.locator('[data-cmd="qstrip"]').click();
  const before = await hoursOf(page);
  const wood = chips(page).nth(1);
  await expect(wood).toContainText('Wood');
  await wood.click();
  await expect(page.locator('[data-qsel="1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(detail(page)).toHaveCount(1);
  await expect(detail(page)).toHaveAttribute('data-qi', '1');
  await expect(detail(page)).toContainText(/GATHER WOOD/);
  await expect(detail(page).locator('.loadrow')).toBeVisible();
  if (SHOTS) await page.locator('.planq').screenshot({ path: `${SHOTS}/2011-detail-en.png` });

  // ▶: one place later, and the row goes with it.
  await detail(page).locator('[data-qdown="1"]').click();
  await expect(chips(page).nth(2)).toContainText('Wood');
  await expect(page.locator('[data-qsel="2"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(detail(page)).toHaveAttribute('data-qi', '2');
  // Focus stays on ▶, now the moved activity's, so another press moves it on.
  await expect(page.locator('[data-qdown="2"]')).toBeFocused();
  // ◀: back where it was.
  await page.locator('[data-qup="2"]').click();
  await expect(chips(page).nth(1)).toContainText('Wood');
  await expect(detail(page)).toHaveAttribute('data-qi', '1');
  expect(await hoursOf(page)).toEqual(before);

  // Another tap on its chip shuts the row.
  await page.locator('[data-qsel="1"]').click();
  await expect(detail(page)).toHaveCount(0);
  await expect(page.locator('[data-qsel="1"]')).toHaveAttribute('aria-pressed', 'false');

  // ✕ removes it: three left, nothing open.
  await page.locator('[data-qsel="1"]').click();
  await detail(page).locator('[data-x="1"]').click();
  await expect(chips(page)).toHaveCount(3);
  await expect(chips(page).filter({ hasText: 'Wood' })).toHaveCount(0);
  await expect(detail(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a tablet keeps a row per activity, and crossing 700px draws the page the other way', async ({ page }) => {
  const errors = await openPlan(page, 1024, 700);
  await expect(page.locator('.planq .queue li[data-qi]')).toHaveCount(4);
  await expect(page.locator('.dayb')).toHaveCount(0);
  await page.setViewportSize({ width: 400, height: 860 });
  await page.locator('[data-cmd="qstrip"]').click();
  await expect(chips(page)).toHaveCount(4);
  await expect(page.locator('.planq .queue li[data-qi]')).toHaveCount(0);
  await page.setViewportSize({ width: 1024, height: 700 });
  await expect(page.locator('.planq .queue li[data-qi]')).toHaveCount(4);
  await expect(page.locator('.dayb')).toHaveCount(0);
  expect(errors).toEqual([]);
});
