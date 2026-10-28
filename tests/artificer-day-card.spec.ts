import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * #1929 — the day's result as a card, in a real browser. A camp with more raw food than a warm
 * night keeps runs its day: when the timer ends it, a card says what was brought back, what the
 * night took (the spoiled food among it) and tomorrow's sky. Its Journal button opens the journal as
 * a sheet, which the status bar's 📓 opens too; Escape and OK shut them. Off, the day ends as before:
 * no card, no 📓. No page errors, no sideways scroll.
 *
 * SHOTS=<dir> also saves screenshots of the card (and the sheet) there, at both sizes and in both
 * languages, as the issue's acceptance asks.
 */
test.use({ hasTouch: true });

const SHOTS = process.env['SHOTS'];

const spoiling = (): { saveKey: string; guideKey: string; save: string } =>
  JSON.parse(execFileSync('npx', ['tsx', fileURLToPath(new URL('./helpers/artificer-day-card-save.ts', import.meta.url))], { encoding: 'utf8' }));

async function openPlan(page: Page, lang: 'en' | 'sv', features: Record<string, boolean> = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/artificer.html');
  await page.evaluate(({ saveKey, guideKey, save, lang, features }) => {
    localStorage.clear();
    localStorage.setItem('artificer.lang', lang);
    localStorage.setItem(saveKey, save);
    // Through the first-morning guide already, so the status bar shows everything.
    localStorage.setItem(guideKey, JSON.stringify({ done: true, run: null }));
    localStorage.setItem('artificer.tab', 'plan');
    localStorage.setItem('artificer.features', JSON.stringify(features));
  }, { ...spoiling(), lang, features });
  await page.reload();
  return errors;
}

/** Run the queued day and skip the timer to its end. */
async function runDay(page: Page): Promise<void> {
  await page.locator('[data-cmd="day"]:visible').first().click();
  await page.locator('[data-pbskip]').click();
  await expect(page.locator('.timer')).toHaveCount(0);
}

const words = {
  en: { title: 'Day 1 is done', brought: 'Brought back', night: 'The night', tomorrow: 'Tomorrow', spoiled: /raw food went bad/, ok: 'On to day 2 ▸', journal: 'Journal' },
  sv: { title: 'Dag 1 är slut', brought: 'Det du bar hem', night: 'Natten', tomorrow: 'I morgon', spoiled: /mat blev dålig/, ok: 'Vidare till dag 2 ▸', journal: 'Dagbok' },
};

for (const lang of ['en', 'sv'] as const) {
  for (const [label, width, height] of [['tablet', 1024, 700], ['phone', 400, 860]] as const) {
    test(`${lang} ${label}: the card after the day, its night's spoilage, and the journal a tap away`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const errors = await openPlan(page, lang);
      const w = words[lang];
      await runDay(page);

      const card = page.locator('.daycard');
      await expect(card).toBeVisible();
      await expect(card.locator('h2')).toHaveText(w.title);
      for (const head of [w.brought, w.night, w.tomorrow]) await expect(card).toContainText(head);
      await expect(card.locator('.dchard')).toContainText(w.spoiled);
      await expect(card.locator('.dcchange.up').first()).toBeVisible();
      await expect(card.locator('[data-cmd="daycardok"]')).toHaveText(w.ok);
      await expect(card.locator('[data-cmd="daycardok"]')).toBeFocused();
      await expect(card.locator('[data-cmd="daycardok"]')).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/1929-card-${lang}-${label}.png` }); }

      // Journal: the card goes, and the journal opens over the page with the night's lines in it.
      await card.locator('[data-cmd="daycardjournal"]').click();
      await expect(page.locator('.daycard')).toHaveCount(0);
      const sheet = page.locator('.jsheet');
      await expect(sheet).toBeVisible();
      await expect(sheet.locator('h2')).toHaveText(w.journal);
      await expect(sheet.locator('ul.full li').first()).toBeVisible();
      if (SHOTS && label === 'phone') { await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/1929-journal-${lang}-${label}.png` }); }
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);

      // The 📓 in the status bar opens it again from the page, and Close shuts it.
      const jbtn = page.locator('.statusbar [data-cmd="jsheet"]');
      await expect(jbtn).toBeInViewport();
      await jbtn.click();
      await expect(page.locator('.jsheet')).toBeVisible();
      await page.locator('[data-cmd="jsheetclose"]').click();
      await expect(page.locator('.jsheet')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
}

test('OK shuts the card, and a reload doesn\'t bring it back', async ({ page }) => {
  const errors = await openPlan(page, 'en');
  await runDay(page);
  await page.locator('[data-cmd="daycardok"]').click();
  await expect(page.locator('.daycard')).toHaveCount(0);
  // The card is the moment, not part of the game: nothing saves it.
  await page.reload();
  await expect(page.locator('.daycard')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a tap beside the card shuts it, and Escape shuts it too', async ({ page }) => {
  const errors = await openPlan(page, 'en');
  await runDay(page);
  // The backdrop's corner, outside the card.
  await page.locator('[data-daycard]').click({ position: { x: 4, y: 4 } });
  await expect(page.locator('.daycard')).toHaveCount(0);
  const again = await openPlan(page, 'en');
  await runDay(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.daycard')).toHaveCount(0);
  expect([...errors, ...again]).toEqual([]);
});

test('switched off, the day ends as before: no card and no 📓', async ({ page }) => {
  const errors = await openPlan(page, 'en', { 'day-card': false });
  await runDay(page);
  await expect(page.locator('.daycard')).toHaveCount(0);
  await expect(page.locator('[data-cmd="jsheet"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
