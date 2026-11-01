import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * #1924 — the compact status line and the bottom tab bar, in a real browser (the only status bar
 * since #2009). The status bar is one line (day, vitals as dots, the key box), and under 900px the
 * tabs sit in a bar fixed to the bottom of the screen; the ⚙ stays in the header (#2005). No page
 * errors, and the first action card is visible without scrolling.
 *
 * Touch, not a mouse (CLAUDE.md: "Primary platform: Android tablet"): `pointer: coarse` is what
 * actually governs chrome height on the owner's device, and it's taller than a mouse's — the
 * touch-target floor (#1927, 44px) applies to the queue strip's bar, the tab buttons and the ⚙.
 */
test.use({ hasTouch: true });

const planned = (): { saveKey: string; guideKey: string; save: string } =>
  JSON.parse(execFileSync('npx', ['tsx', fileURLToPath(new URL('./helpers/artificer-planned-save.ts', import.meta.url))], { encoding: 'utf8' }));

async function openPlan(page: Page, width: number, height: number, o: { lang?: string } = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height });
  await page.goto('/artificer.html');
  await page.evaluate(({ saveKey, guideKey, save, lang }) => {
    localStorage.clear();
    localStorage.setItem('artificer.lang', lang ?? 'en');
    localStorage.setItem(saveKey, save);
    // Through the first-morning guide already, so every part of the bar shows.
    localStorage.setItem(guideKey, JSON.stringify({ done: true, run: null }));
    localStorage.setItem('artificer.tab', 'plan');
  }, { ...planned(), lang: o.lang });
  await page.reload();
  await expect(page.locator('.plan.sideq .planq, .plan .planside')).toBeVisible();
  return errors;
}

/**
 * The sticky/fixed chrome's total height: the status bar, and under 900px the phone's frozen queue
 * strip and the fixed bottom tab bar, whichever are actually on screen. `offsetParent` can't say
 * whether a `position: fixed` element (the bottom tab bar) is shown — it's always null for one,
 * visible or not — so this checks the computed style instead.
 */
async function frozenChromeHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const h = (sel: string): number => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return 0;
      const cs = getComputedStyle(el);
      return cs.display === 'none' || cs.visibility === 'hidden' ? 0 : el.getBoundingClientRect().height;
    };
    return h('.statusbar') + h('.planq .qstrip') + h('.tabbar');
  });
}

test('tablet (1024×700): one-line status bar, first card visible without scrolling, frozen chrome ≤ 15%', async ({ page }) => {
  const errors = await openPlan(page, 1024, 700);
  await expect(page.locator('.statusbar.compact')).toBeVisible();
  const card = (await page.locator('.planacts .act').first().boundingBox())!;
  expect(card.y).toBeGreaterThanOrEqual(0);
  expect(card.y).toBeLessThan(700);
  expect((await frozenChromeHeight(page)) / 700).toBeLessThanOrEqual(0.15);
  expect(errors).toEqual([]);
});

/**
 * Phone (400×860): the same bar and the bottom tabs cut chrome from the ~33% the issue measured
 * before this change to well under a quarter — but not to 15%. The queue strip (#1826, out of
 * scope here) has its own 44px touch floor, and the tab bar's buttons and the ⚙ need the same floor
 * (#1927) to stay tappable; stacking the strip, the one-line bar and the bottom tabs, all at that
 * floor, already accounts for most of the height below. Flagged honestly rather than asserting a
 * number this change can't actually reach without shrinking a touch target or touching the strip.
 */
test('phone (400×860): one-line status bar, first card visible without scrolling, frozen chrome well under a quarter', async ({ page }) => {
  const errors = await openPlan(page, 400, 860);
  await expect(page.locator('.statusbar.compact')).toBeVisible();
  const card = (await page.locator('.planacts .act').first().boundingBox())!;
  expect(card.y).toBeGreaterThanOrEqual(0);
  expect(card.y).toBeLessThan(860);
  expect((await frozenChromeHeight(page)) / 860).toBeLessThanOrEqual(0.23);
  expect(errors).toEqual([]);
});

// The ⚙ stays in the header beside Feedback on a phone too (#2005), not in the bottom bar (#1924 had it there).
test('phone (400px): the tabs sit in a bar fixed to the bottom; the ⚙ stays in the header beside Feedback, on its line', async ({ page }) => {
  await openPlan(page, 400, 860);
  const nav = page.locator('.tabbar');
  const navBox = (await nav.boundingBox())!;
  expect(navBox.y + navBox.height).toBeGreaterThan(850); // within a few px of the viewport's foot
  await expect(nav.locator('.menybtn')).toHaveCount(0);
  const gear = page.locator('header .menybtn');
  await expect(gear).toBeVisible();
  const [g, fb] = [(await gear.boundingBox())!, (await page.locator('header .fbbtn').boundingBox())!];
  expect(Math.abs(g.y - fb.y)).toBeLessThan(4); // one header line, side by side
  expect(g.x).toBeLessThan(fb.x);
});

test('tablet (1024px): the tabs stay at the top; the header keeps its own ⚙', async ({ page }) => {
  await openPlan(page, 1024, 700);
  const nav = page.locator('.tabbar');
  const navBox = (await nav.boundingBox())!;
  expect(navBox.y).toBeLessThan(400); // in the page's normal flow, not pinned to the foot
  await expect(page.locator('header .menybtn')).toBeVisible();
});


// With the standing line on (the default, #1951), the line that opens the focus picker sits in its
// own row under the one-line bar, so the ⋯ panel holds pain, injuries and TODAY but not the line.
test('the ⋯ opens and closes its panel, and the standing line sits under the bar, not in it', async ({ page }) => {
  await openPlan(page, 400, 860);
  await expect(page.locator('.standrow [data-cmd="focuspop"]')).toBeVisible();
  const more = page.locator('[data-cmd="compactmore"]');
  await expect(more).toBeVisible();
  await expect(page.locator('#compactmore')).toBeHidden();
  await more.click();
  await expect(page.locator('#compactmore')).toBeVisible();
  await expect(page.locator('#compactmore [data-cmd="focuspop"]')).toHaveCount(0);
  await more.click();
  await expect(page.locator('#compactmore')).toBeHidden();
});

test('sv: the compact bar and the bottom tabs render with no page errors', async ({ page }) => {
  const errors = await openPlan(page, 400, 860, { lang: 'sv' });
  await expect(page.locator('.statusbar.compact')).toBeVisible();
  await expect(page.locator('header .menybtn')).toBeVisible();
  expect(errors).toEqual([]);
});
