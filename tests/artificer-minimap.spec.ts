import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * #2016 — the minimap, in a real browser: nine squares around the Warden, top-down. On a tablet it's
 * in the status line; on a phone, where the status line has no room, at the start of the queue's
 * strip. Either way the status line stays one line. While a day plays, the timer's bigger minimap
 * walks the Warden out to the work and back: its middle square changes as the trip plays. No page
 * errors, no sideways scroll.
 *
 * SHOTS=<dir> also saves screenshots there.
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
  await expect(page.locator('.statusbar')).toBeVisible();
  return errors;
}

const statusHeight = async (page: Page): Promise<number> => (await page.locator('.statusbar').boundingBox())!.height;

for (const lang of ['en', 'sv'] as const) {
  test(`${lang} tablet (1024 × 700): the minimap in the status line, which stays one line`, async ({ page }) => {
    const errors = await openPlan(page, 1024, 700, lang);
    const mini = page.locator('.cline .minimap');
    await expect(mini).toBeVisible();
    await expect(mini).toHaveAttribute('role', 'img');
    await expect(mini).toHaveAttribute('aria-label', lang === 'en' ? /^Where you stand: / : /^Där du står: /);
    await expect(mini.locator('i')).toHaveCount(25);
    await expect(mini.locator('.mm-here')).toHaveCount(1);
    expect((await mini.boundingBox())!.width).toBeLessThanOrEqual(40);
    expect(await statusHeight(page)).toBeLessThanOrEqual(56);
    if (SHOTS) await page.locator('.statusbar').screenshot({ path: `${SHOTS}/2016-status-${lang}-tablet.png` });
    expect(errors).toEqual([]);
  });

  test(`${lang} phone (400 × 860): the minimap in the queue's strip, and the status line stays one line`, async ({ page }) => {
    const errors = await openPlan(page, 400, 860, lang);
    await expect(page.locator('.cline .minimap')).toBeHidden();
    await expect(page.locator('.planq .qstrip .minimap')).toBeVisible();
    expect(await statusHeight(page)).toBeLessThanOrEqual(56);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(400);
    if (SHOTS) await page.locator('.planq .qstrip').screenshot({ path: `${SHOTS}/2016-strip-${lang}-phone.png` });
    expect(errors).toEqual([]);
  });
}

for (const [label, width, height] of [['tablet', 1024, 700], ['phone', 400, 860]] as const) {
  test(`${label}: while the day plays, the Warden walks the timer's minimap out to the work`, async ({ page }) => {
    const errors = await openPlan(page, width, height);
    await page.locator('[data-cmd="day"]:visible').first().click();
    const mini = page.locator('.timer #pb-mini');
    await expect(mini).toBeVisible();
    await page.locator('.timer [data-speed="4"]').click();
    // The squares around the Warden, as drawn: they change as the Warden steps onto another square.
    const view = (): Promise<string> => mini.evaluate(m => [...m.querySelectorAll('i')].map(i => i.className).join('|')).catch(() => '');
    const first = await view();
    await expect.poll(view, { timeout: 20_000, intervals: [250] }).not.toBe(first);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (SHOTS) await page.locator('.timer').screenshot({ path: `${SHOTS}/2016-timer-${label}.png` });
    expect(errors).toEqual([]);
  });
}
