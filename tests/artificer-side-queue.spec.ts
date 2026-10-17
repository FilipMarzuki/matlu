import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * #1826 — the queue frozen beside or over the actions, in a real browser. On a tablet and desktop
 * the queue's column sits right of the actions; on a phone in portrait (under 700px) the queue is a
 * strip over full-width actions, which unfolds to the whole queue. Either way it stays in view when
 * the actions are scrolled to their bottom, and the page never scrolls sideways. No page errors.
 */

/** A run that has learned to plan, with a few tasks queued (made by the game's own code, tests/helpers). */
const planned = (): { saveKey: string; guideKey: string; save: string } =>
  JSON.parse(execFileSync('npx', ['tsx', fileURLToPath(new URL('./helpers/artificer-planned-save.ts', import.meta.url))], { encoding: 'utf8' }));

async function openPlan(page: Page, width: number, height: number, errors: string[]): Promise<void> {
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height });
  await page.goto('/artificer.html');
  await page.evaluate(({ saveKey, guideKey, save }) => {
    localStorage.clear();
    localStorage.setItem('artificer.lang', 'en');
    localStorage.setItem(saveKey, save);
    // Through the first-morning guide already, so every part of PLAN shows.
    localStorage.setItem(guideKey, JSON.stringify({ done: true, run: null }));
    localStorage.setItem('artificer.tab', 'plan');
  }, planned());
  await page.reload();
  await expect(page.locator('.plan.sideq .planq')).toBeVisible();
}

/** Scroll the actions' bottom to the bottom of the screen. */
async function toActionsBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const r = document.querySelector('.planacts')!.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + r.bottom - window.innerHeight);
  });
  await page.waitForTimeout(200);
}

async function inView(page: Page, selector: string, height: number): Promise<void> {
  const box = (await page.locator(selector).boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
}

for (const [label, width, height] of [['tablet', 800, 1000], ['desktop', 1280, 860]] as const) {
  test(`${label}: the queue's column beside the actions stays in view after scrolling them to the bottom`, async ({ page }) => {
    const errors: string[] = [];
    await openPlan(page, width, height, errors);
    const queue = page.locator('.planq');
    await expect(page.locator('.qstrip')).toBeHidden();
    await expect(queue.locator('.queue li[data-qi]')).toHaveCount(4);
    // Beside the actions, on their right.
    const acts = (await page.locator('.planacts').boundingBox())!;
    const q0 = (await queue.boundingBox())!;
    expect(q0.x).toBeGreaterThan(acts.x + acts.width - 1);
    expect(Math.abs(q0.y - acts.y)).toBeLessThan(40);

    await toActionsBottom(page);
    await inView(page, '.planq', height);
    await expect(queue.locator('.runbar [data-cmd="day"]')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(errors).toEqual([]);
  });
}

test('tablet: the narrow column is compact, and ▲ moves a task up', async ({ page }) => {
  const errors: string[] = [];
  await openPlan(page, 800, 1000, errors);
  const queue = page.locator('.planq');
  await expect(queue.locator('li[data-qi="1"] .qc')).toBeVisible();
  await expect(queue.locator('li[data-qi="1"] .qc')).toContainText('Wood');
  await queue.locator('[data-qup="1"]').click();
  await expect(queue.locator('li[data-qi="0"] .qc')).toContainText('Wood');
  expect(errors).toEqual([]);
});

test('400px: a frozen strip over full-width actions, in view after scrolling, unfolding to the whole queue', async ({ page }) => {
  const errors: string[] = [];
  await openPlan(page, 400, 800, errors);
  const strip = page.locator('.planq .qstrip');
  await expect(strip).toBeVisible();
  await expect(strip.locator('.qschip')).toHaveCount(4);
  await expect(strip).toContainText('Wood');
  // Folded: the whole queue isn't shown; the strip is above the actions, which take the full width.
  await expect(page.locator('.planq .planqfull')).toBeHidden();
  const s0 = (await page.locator('.planq').boundingBox())!;
  const acts = (await page.locator('.planacts').boundingBox())!;
  expect(s0.y + s0.height).toBeLessThanOrEqual(acts.y + 1);
  expect(acts.width).toBeGreaterThan(340);

  await toActionsBottom(page);
  await inView(page, '.planq', 800);
  await expect(strip.locator('[data-cmd="day"]')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(400);

  // A tap unfolds the whole queue in place; × removes there; another tap folds it.
  await strip.locator('[data-cmd="qstrip"]').click();
  await expect(strip.locator('[data-cmd="qstrip"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.planq .planqfull')).toBeVisible();
  await page.locator('.planq .planqfull [data-x="0"]').click();
  await expect(page.locator('.planq .queue li[data-qi]')).toHaveCount(3);
  await expect(strip.locator('.qschip')).toHaveCount(3);
  await strip.locator('[data-cmd="qstrip"]').click();
  await expect(page.locator('.planq .planqfull')).toBeHidden();
  expect(errors).toEqual([]);
});
