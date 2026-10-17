import { test, expect, type Page } from '@playwright/test';

/**
 * #1266 — talents on the creation screen and the WARDEN tab, in a real browser:
 * the 4 offered talents stay the same across a reload (the draft Warden is kept),
 * picking 2 works, and the WARDEN tab shows the hidden-gift slot. No page errors.
 */

/** Click CONTINUE until the creation form (the talent offer) is showing. */
async function toCreation(page: Page): Promise<void> {
  for (let i = 0; i < 8 && !(await page.locator('.tchoice').first().isVisible()); i++) {
    await page.locator('[data-intro="next"]').click();
  }
  await expect(page.locator('.tchoice')).toHaveCount(4);
}

const offerOf = (page: Page) => page.locator('.tchoice b').allTextContents();

test('talent offer survives a reload, picks work, and the WARDEN tab shows the hidden gift', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/artificer.html');
  // The language picker (#1704) comes first for a viewer with no choice stored: choose English.
  // The guide stays on: the header's Warden button is there from the first screen (#1807).
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('artificer.lang', 'en'); });
  await page.reload();

  await toCreation(page);
  const offer = await offerOf(page);
  expect(offer).toHaveLength(4);
  await expect(page.locator('.beat.create')).toContainText('not yet known');

  // Name the Warden and pick two of the four.
  await page.locator('#wname').fill('Signe');
  await page.locator('.tchoice').nth(0).click();
  await page.locator('.tchoice').nth(2).click();
  await expect(page.locator('.tchoice[aria-pressed="true"]')).toHaveCount(2);

  // A reload keeps the same Warden-to-be: the same offer, name and picks.
  await page.reload();
  await toCreation(page);
  expect(await offerOf(page)).toEqual(offer);
  await expect(page.locator('#wname')).toHaveValue('Signe');
  await expect(page.locator('.tchoice[aria-pressed="true"]')).toHaveCount(2);

  // Past the creation screen, the game isn't saved until the intro ends: a reload here
  // must still bring back the same Warden-to-be, not roll a new one.
  await page.locator('[data-intro="next"]').click();
  await expect(page.locator('.tchoice')).toHaveCount(0);
  await page.reload();
  await toCreation(page);
  expect(await offerOf(page)).toEqual(offer);
  await expect(page.locator('#wname')).toHaveValue('Signe');

  // Through the rest of the intro.
  for (let i = 0; i < 8 && (await page.locator('[data-intro="next"]').isVisible()); i++) {
    await page.locator('[data-intro="next"]').click();
  }

  // The Warden's view, through the header's icon and name (#1807; no Warden tab in the row):
  // the two chosen talents, and the dashed hidden-gift card.
  await expect(page.locator('.tabbtn[data-tab="warden"]')).toHaveCount(0);
  // With the two-row header (#1824) the button leads the sticky status bar's top row.
  const who = page.locator('.who[data-tab="warden"]');
  await expect(who).toHaveAttribute('aria-pressed', 'false');
  await who.click();
  await expect(who).toHaveAttribute('aria-pressed', 'true');
  const known = page.locator('.traits .trait:not(.hidden):not(.quirk):not(.fear) b');
  await expect(known.first()).toBeVisible();
  const names = await known.allTextContents();
  expect(names).toEqual(expect.arrayContaining([offer[0], offer[2]]));
  await expect(page.locator('.trait.hidden', { hasText: 'A hidden gift' })).toBeVisible();

  // A reload keeps the Warden's view open (the kept tab is `warden`); PLAN leaves it.
  await page.reload();
  await expect(page.locator('.trait.hidden', { hasText: 'A hidden gift' })).toBeVisible();
  await expect(who).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.tabbtn[data-tab="plan"]').click();
  await expect(who).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.trait.hidden')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('after New Save, a reload goes back to the Warden being made', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/artificer.html');
  // The language picker (#1704) comes first for a viewer with no choice stored: choose English.
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('artificer.lang', 'en'); localStorage.setItem('artificer.features', JSON.stringify({ guide: false })); });
  await page.reload();
  // Skip through a first Warden to a saved game.
  for (let i = 0; i < 10 && (await page.locator('[data-intro="next"]').isVisible()); i++) {
    if (await page.locator('.tchoice').first().isVisible()) {
      await page.locator('#wname').fill('First');
      await page.locator('.tchoice').nth(0).click();
      await page.locator('.tchoice').nth(1).click();
    }
    await page.locator('[data-intro="next"]').click();
  }
  // A new save, from the ⚙ Menu (#1808): it asks on the page first. Esc shuts the Menu and the
  // focus goes back to the ⚙; then New game, confirmed, makes a second Warden, half-way, then reload.
  await expect(page.locator('header [data-cmd="reset"]')).toHaveCount(0);
  const gear = page.locator('header [data-cmd="meny"]');
  await gear.click();
  await expect(gear).toHaveAttribute('aria-expanded', 'true');
  // Every section but the guide's, which this test has switched off. How to play (#1824) is one of
  // them, and the header has no ? any more.
  await expect(page.locator('#meny [data-meny]')).toHaveCount(9);
  await expect(page.locator('#meny [data-meny="guide"]')).toHaveCount(0);
  await expect(page.locator('#meny [data-meny="howto"]')).toContainText('winter is coming');
  await expect(page.locator('header [data-cmd="help"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#meny')).toHaveCount(0);
  await expect(gear).toBeFocused();
  await gear.click();
  await page.locator('#meny [data-cmd="newgame"]').click();
  await expect(page.locator('#meny .menyconfirm')).toBeVisible();
  await page.locator('#meny [data-cmd="reset"]').click();
  await toCreation(page);
  const offer = await offerOf(page);
  await page.locator('#wname').fill('Second');
  await page.reload();
  await toCreation(page);
  expect(await offerOf(page)).toEqual(offer);
  await expect(page.locator('#wname')).toHaveValue('Second');
  expect(errors).toEqual([]);
});
