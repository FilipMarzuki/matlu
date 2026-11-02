import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * #2016 — the minimap, in a real browser: nine squares around the Warden, top-down. On a tablet it's
 * in the status line; on a phone, where the status line has no room, at the start of the queue's
 * strip. Either way the status line stays one line. While a day plays, the timer shows the ground
 * (#2022): 3 × 3 squares of about 2 m, the Warden walking out to the work and back, so what it draws
 * keeps changing. No page errors, no sideways scroll.
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
  test(`${label}: while the day plays, the Warden walks the ground in the timer out to the work`, async ({ page }) => {
    const errors = await openPlan(page, width, height);
    await page.locator('[data-cmd="day"]:visible').first().click();
    const ground = page.locator('.timer canvas#pb-ground');
    await expect(ground).toBeVisible();
    await expect(ground).toHaveAttribute('role', 'img');
    await expect(ground).toHaveAttribute('aria-label', /^Where you stand: /);
    // Square, and a thumb's width or more.
    const box = (await ground.boundingBox())!;
    expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(90);
    // What it draws, a few frames apart, at the timer's own pace: the ground going by, the Warden walking.
    const frame = (): Promise<string> => ground.evaluate(c => (c as HTMLCanvasElement).toDataURL()).catch(() => '');
    const frames = new Set<string>();
    for (let k = 0; k < 6; k++) { frames.add(await frame()); await page.waitForTimeout(400); }
    expect(frames.size).toBeGreaterThan(2);
    // The tiles and the Warden are drawn, not just the flat colours shown while they load: many colours.
    const colours = (): Promise<number> => ground.evaluate(c => {
      const cv = c as HTMLCanvasElement;
      const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
      const seen = new Set<number>();
      for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return seen.size;
    });
    await expect.poll(colours, { timeout: 10_000 }).toBeGreaterThan(20);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (SHOTS) await page.locator('.timer').screenshot({ path: `${SHOTS}/2022-timer-${label}.png` });
    expect(errors).toEqual([]);
  });
}
