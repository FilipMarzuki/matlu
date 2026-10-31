import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * #1998 — fewer rows on top on a wide screen (ui switch `wide-top`), in a real browser. On a 1024 × 700
 * tablet the "where you stand" line sits in the status line, the weather row's button in the tab row
 * (what it opens still opens under the tabs), and the day is said once; the first action card starts
 * near the top. Narrower than 901px, where the tabs are the phone's bottom bar, the page is as before,
 * and crossing the line draws it again. Off, as before. No page errors.
 *
 * Touch, not a mouse (the owner's tablet): `pointer: coarse` sets the 44px targets the rows are made of.
 */
test.use({ hasTouch: true });

const planned = (): { saveKey: string; guideKey: string; save: string } =>
  JSON.parse(execFileSync('npx', ['tsx', fileURLToPath(new URL('./helpers/artificer-planned-save.ts', import.meta.url))], { encoding: 'utf8' }));
const SAVE = planned();

async function openPlan(page: Page, width: number, o: { on?: boolean; lang?: string } = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height: 700 });
  await page.goto('/artificer.html');
  await page.evaluate(({ saveKey, guideKey, save, on, lang }) => {
    localStorage.clear();
    localStorage.setItem('artificer.lang', lang ?? 'en');
    localStorage.setItem(saveKey, save);
    // Through the first-morning guide already, so every part of the bar shows.
    localStorage.setItem(guideKey, JSON.stringify({ done: true, run: null }));
    localStorage.setItem('artificer.tab', 'plan');
    // The weather box opened once before, so its "tap here" is retired, as for a returning player.
    localStorage.setItem('artificer.weatherFold', JSON.stringify({ acked: true, open: false, hintSeen: true }));
    if (on !== undefined) localStorage.setItem('artificer.features', JSON.stringify({ 'wide-top': on }));
  }, { ...SAVE, on: o.on, lang: o.lang });
  await page.reload();
  await expect(page.locator('.plan .act').first()).toBeVisible();
  return errors;
}

const firstCardTop = (page: Page): Promise<number> =>
  page.evaluate(() => Math.min(...[...document.querySelectorAll('.plan .act')].map(e => e.getBoundingClientRect().top + scrollY)));

/** As before (#1924, #1951): the line in a row of its own, the weather in its box under the tabs, the day in the title too. */
async function asBefore(page: Page): Promise<void> {
  await expect(page.locator('.standrow .standline')).toBeVisible();
  await expect(page.locator('.cline .standin')).toHaveCount(0);
  await expect(page.locator('.tabrow > .wxtab')).toHaveCount(0);
  await expect(page.locator('.seasonbox .wxonerow')).toBeVisible();
}

for (const lang of ['en', 'sv'] as const) {
  test(`${lang} tablet (1024 × 700): the line in the status line, the weather in the tab row, the day once, the first card near the top`, async ({ page }) => {
    const errors = await openPlan(page, 1024, { lang });
    await expect(page.locator('.statusbar .cline .standin .standline')).toBeVisible();
    await expect(page.locator('.standrow')).toHaveCount(0);
    await expect(page.locator('.tabrow > .wxtab')).toBeVisible();
    // Beside the tab list, not in it: a tab list holds only tabs.
    await expect(page.locator('[role="tablist"] .wxtab')).toHaveCount(0);
    // Folded, with no blizzard, nothing is left under the tabs.
    await expect(page.locator('.seasonbox')).toHaveCount(0);
    // The day once: in the status line, not in the title.
    await expect(page.locator('header .counter')).toHaveCount(0);
    await expect(page.locator('.cline .cday')).toBeVisible();
    // The status line is still one line, and the first card starts near the top (it was 407 at #1997).
    expect((await page.locator('.statusbar').boundingBox())!.height).toBeLessThanOrEqual(56);
    expect(await firstCardTop(page)).toBeLessThanOrEqual(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('tablet: the weather button opens its box under the tabs and shuts it; the line opens its picker under it', async ({ page }) => {
  await openPlan(page, 1024);
  const wx = page.locator('.tabrow > .wxtab');
  await wx.click();
  await expect(page.locator('.tabrow > .wxtab')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.seasonbox .wxonedetails')).toBeVisible();
  await page.locator('.tabrow > .wxtab').click();
  await expect(page.locator('.seasonbox')).toHaveCount(0);
  await page.locator('.cline .standin [data-cmd="focuspop"]').click();
  const pop = page.locator('.cline .standin .focuspop');
  await expect(pop).toBeVisible();
  // As wide as under its own row (440px), not squeezed to the line's width, and under the bar.
  const [p, bar] = [(await pop.boundingBox())!, (await page.locator('.statusbar').boundingBox())!];
  expect(p.width).toBeGreaterThan(400);
  expect(p.y).toBeGreaterThanOrEqual(bar.y + bar.height);
});

test('narrower than 901px the page is as before, and crossing the line draws it again', async ({ page }) => {
  await openPlan(page, 1024);
  await expect(page.locator('.tabrow > .wxtab')).toBeVisible();
  await page.setViewportSize({ width: 900, height: 700 });
  await asBefore(page);
  await page.setViewportSize({ width: 1024, height: 700 });
  await expect(page.locator('.tabrow > .wxtab')).toBeVisible();
  await expect(page.locator('.cline .standin')).toBeVisible();
});

test('a phone (400 × 860) is as before', async ({ page }) => {
  await openPlan(page, 400);
  await asBefore(page);
});

test('switched off, a tablet is as before', async ({ page }) => {
  const errors = await openPlan(page, 1024, { on: false });
  await asBefore(page);
  await expect(page.locator('header .counter')).toBeVisible();
  expect(errors).toEqual([]);
});
