import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * #1826 — the queue beside the actions, in a real browser at phone width: the queue's column sits
 * right of the actions, stays in view when the actions are scrolled to their bottom, the page never
 * scrolls sideways, and the compact queue's ▲ moves a task up. No page errors.
 */

/** A run that has learned to plan, with a few tasks queued (made by the game's own code, tests/helpers). */
const planned = (): { saveKey: string; guideKey: string; save: string } =>
  JSON.parse(execFileSync('npx', ['tsx', fileURLToPath(new URL('./helpers/artificer-planned-save.ts', import.meta.url))], { encoding: 'utf8' }));

test('at 400px the queue stays beside the actions and in view after scrolling them to the bottom', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 400, height: 800 });
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

  const queue = page.locator('.plan.sideq .planq');
  await expect(queue).toBeVisible();
  await expect(queue.locator('.queue li[data-qi]')).toHaveCount(4);
  // Beside the actions, on their right.
  const acts = await page.locator('.planacts').boundingBox();
  const q0 = await queue.boundingBox();
  expect(q0!.x).toBeGreaterThan(acts!.x + acts!.width - 1);
  expect(Math.abs(q0!.y - acts!.y)).toBeLessThan(40);

  // Scroll the actions' bottom to the bottom of the screen: the queue is still on screen.
  await page.evaluate(() => {
    const r = document.querySelector('.planacts')!.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + r.bottom - window.innerHeight);
  });
  await page.waitForTimeout(200);
  const q1 = (await queue.boundingBox())!;
  expect(q1.y).toBeGreaterThanOrEqual(0);
  expect(q1.y + q1.height).toBeLessThanOrEqual(800 + 1);
  await expect(queue.locator('[data-cmd="day"]')).toBeInViewport();

  // No sideways scroll.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(400);

  // The compact row's words show, and ▲ moves the second task (wood) up.
  await expect(queue.locator('li[data-qi="1"] .qc')).toBeVisible();
  await expect(queue.locator('li[data-qi="1"] .qc')).toContainText('Wood');
  await queue.locator('[data-qup="1"]').click();
  await expect(queue.locator('li[data-qi="0"] .qc')).toContainText('Wood');
  // × still removes.
  await queue.locator('[data-x="0"]').click();
  await expect(queue.locator('.queue li[data-qi]')).toHaveCount(3);

  expect(errors).toEqual([]);
});
