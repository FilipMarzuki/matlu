import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * #2020 — the action categories, in a real browser: the palette's groups as one row of buttons, all
 * on one line, Explore open the first time. Tapping one shows its cards and hides the last one's;
 * tapping the open one shuts it, leaving just the row; a reload keeps what was left open. LAND's
 * Explore opens the Explore category whatever was open before. Every category is a thumb's size, and
 * nothing scrolls sideways. No page errors.
 *
 * SHOTS=<dir> also saves screenshots there, at both sizes and in both languages.
 */

test.use({ hasTouch: true });

const SHOTS = process.env['SHOTS'];

/** A run that has learned to plan, with water, wood, food and rest queued (tests/helpers). */
const PLANNED: { saveKey: string; guideKey: string; save: string } =
  JSON.parse(execFileSync('npx', ['tsx', fileURLToPath(new URL('./helpers/artificer-planned-save.ts', import.meta.url))], { encoding: 'utf8' }));

async function openPlan(page: Page, width: number, height: number, lang: 'en' | 'sv'): Promise<string[]> {
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
  }, { ...PLANNED, lang });
  await page.reload();
  await expect(page.locator('.cats')).toBeVisible();
  return errors;
}

/** The groups whose cards show. */
const openPanels = (page: Page): Promise<string[]> =>
  page.locator('.planacts .group:visible').evaluateAll(els => els.map(e => e.id.replace(/^grp-/, '')));

const names = { en: { explore: 'Explore', provision: 'Gather' }, sv: { explore: 'Utforska', provision: 'Samla' } };

for (const lang of ['en', 'sv'] as const) {
  for (const [label, width, height] of [['tablet', 1024, 700], ['phone', 400, 860]] as const) {
    test(`${lang} ${label}: one row of categories; a tap opens one and shuts the last, the open one tapped shuts`, async ({ page }) => {
      const errors = await openPlan(page, width, height, lang);
      const cats = page.locator('.cats .cat');
      const n = await cats.count();
      expect(n).toBeGreaterThanOrEqual(3);

      // One row: every category on the same line, each a thumb's size. Measured once the web fonts
      // are in (they load with display=swap, so a first look can be in the stand-in font).
      await page.waitForLoadState('load');
      await page.evaluate(async () => { await document.fonts.load('600 12px "Chakra Petch"').catch(() => []); await document.fonts.ready; });
      const boxes = await cats.evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); const nm = e.querySelector('.catname')!; return { top: Math.round(r.top), w: r.width, h: r.height, cut: nm.scrollWidth > nm.clientWidth }; }));
      expect(new Set(boxes.map(b => b.top)).size).toBe(1);
      for (const b of boxes) { expect(b.h).toBeGreaterThanOrEqual(44); expect(b.w).toBeGreaterThanOrEqual(44); }
      // Each whole name shows in the page's own font (Chakra Petch, from Google Fonts). Where it
      // couldn't load, the stand-in font is wider and a long name may end in "…", by design (its
      // button still says it whole), so that's only checked when the font is really there.
      const fontIn = await page.evaluate(() => [...document.fonts].some(f => f.family.replace(/["']/g, '') === 'Chakra Petch' && f.weight === '600' && f.status === 'loaded'));
      if (fontIn) expect(boxes.filter(b => b.cut)).toEqual([]);
      await expect(cats.first()).toHaveAttribute('aria-label', new RegExp(`^${names[lang].explore}: \\d+ `));

      // The first time, Explore is open: its cards show, no other group's.
      const explore = page.locator('.cat[data-group="explore"]');
      const gather = page.locator('.cat[data-group="provision"]');
      await expect(explore).toHaveAttribute('aria-expanded', 'true');
      await expect(explore.locator('.catname')).toHaveText(names[lang].explore);
      expect(await openPanels(page)).toEqual(['explore']);
      await expect(page.locator('[data-chooser="explore"]')).toBeVisible();
      if (SHOTS) await page.locator('.planacts').screenshot({ path: `${SHOTS}/2020-explore-${lang}-${label}.png` });

      // Gather: its cards show and Explore's hide; the keyboard stays on the category.
      await gather.click();
      await expect(gather).toHaveAttribute('aria-expanded', 'true');
      await expect(explore).toHaveAttribute('aria-expanded', 'false');
      await expect(gather.locator('.catname')).toHaveText(names[lang].provision);
      expect(await openPanels(page)).toEqual(['provision']);
      await expect(page.locator('[data-chooser="explore"]')).toBeHidden();
      await expect(page.locator('[data-chooser="water"]')).toBeVisible();
      await expect(gather).toBeFocused();
      if (SHOTS) await page.locator('.planacts').screenshot({ path: `${SHOTS}/2020-gather-${lang}-${label}.png` });

      // Gather again: shut, just the row.
      await gather.click();
      await expect(gather).toHaveAttribute('aria-expanded', 'false');
      expect(await openPanels(page)).toEqual([]);
      if (SHOTS) await page.locator('.planacts').screenshot({ path: `${SHOTS}/2020-shut-${lang}-${label}.png` });

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]);
    });
  }
}

test('a reload keeps the category left open, or all of them shut', async ({ page }) => {
  const errors = await openPlan(page, 1024, 700, 'en');
  const make = page.locator('.cat[data-group="make"]');
  await make.click();
  await page.reload();
  await expect(make).toHaveAttribute('aria-expanded', 'true');
  expect(await openPanels(page)).toEqual(['make']);
  await make.click();
  await page.reload();
  await expect(page.locator('.cats')).toBeVisible();
  expect(await openPanels(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('a new Warden starts with Explore open, whatever an earlier Warden left open', async ({ page }) => {
  const errors = await openPlan(page, 1024, 700, 'en');
  await page.evaluate(() => localStorage.setItem('artificer.group', JSON.stringify({ id: 'w-someone-else', pick: 'make' })));
  await page.reload();
  await expect(page.locator('.cat[data-group="explore"]')).toHaveAttribute('aria-expanded', 'true');
  expect(await openPanels(page)).toEqual(['explore']);
  expect(errors).toEqual([]);
});

test('a distance chooser shuts with its category', async ({ page }) => {
  const errors = await openPlan(page, 1024, 700, 'en');
  await page.locator('[data-chooser="explore"]').click();
  await expect(page.locator('.ringpick')).toBeVisible();
  await page.locator('.cat[data-group="make"]').click();
  await expect(page.locator('.ringpick')).toHaveCount(0);
  expect(await openPanels(page)).toEqual(['make']);
  // And back: Explore's card is there, its chooser shut.
  await page.locator('.cat[data-group="explore"]').click();
  await expect(page.locator('[data-chooser="explore"]')).toHaveAttribute('aria-expanded', 'false');
  expect(errors).toEqual([]);
});

test('while the day plays, a category still opens (it only changes which cards show)', async ({ page }) => {
  const errors = await openPlan(page, 1024, 700, 'en');
  await page.locator('[data-cmd="day"]:visible').first().click();
  await expect(page.locator('.timer')).toBeVisible();
  await page.locator('.cat[data-group="think"]').click();
  await expect(page.locator('.cat[data-group="think"]')).toHaveAttribute('aria-expanded', 'true');
  expect(await openPanels(page)).toEqual(['think']);
  expect(errors).toEqual([]);
});

/** Through the intro to the game (as tests/artificer-start-land.spec.ts does). */
async function throughIntro(page: Page): Promise<void> {
  let changed = false;
  for (let i = 0; i < 14 && (await page.locator('[data-intro="next"]').isVisible()); i++) {
    const change = page.locator('[data-intro="change"]');
    if (!changed && await change.isVisible()) { await change.click(); changed = true; continue; }
    if (await page.locator('.tchoice').first().isVisible()) {
      await page.locator('#wname').fill('Signe');
      await page.locator('.tchoice').nth(0).click();
      await page.locator('.tchoice').nth(1).click();
    }
    await page.locator('[data-intro="next"]').click();
  }
  await expect(page.locator('[data-intro="next"]')).toHaveCount(0);
}

test('LAND\'s Explore opens the Explore category, whatever this Warden had open before', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 400, height: 860 });
  await page.goto('/artificer.html');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('artificer.lang', 'en'); });
  await page.reload();
  await throughIntro(page);
  // This Warden left Make open (the page keeps the pick per Warden), then comes back to LAND's start.
  const id = await page.evaluate(key => (JSON.parse(localStorage.getItem(key) ?? '{}') as { sim?: { character?: { id?: string } } }).sim?.character?.id, PLANNED.saveKey);
  expect(id).toBeTruthy();
  await page.evaluate(id => localStorage.setItem('artificer.group', JSON.stringify({ id, pick: 'make' })), id);
  await page.reload();
  await page.locator('[data-startexplore]').click();
  const ack = page.locator('[data-wxack]');
  if (await ack.isVisible()) await ack.click();
  await expect(page.locator('.cat[data-group="explore"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-chooser="explore"]')).toHaveAttribute('aria-expanded', 'true');
  // It stays open after: the pick is Explore now.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('artificer.group') ?? 'null'))).toEqual({ id, pick: 'explore' });
  expect(errors).toEqual([]);
});
