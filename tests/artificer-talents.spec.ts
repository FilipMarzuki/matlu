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
  await page.evaluate(() => localStorage.clear());
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

  // The WARDEN tab: the two chosen talents, and the dashed hidden-gift card.
  await page.locator('.tabbtn[data-tab="warden"]').click();
  const known = page.locator('.traits .trait:not(.hidden):not(.quirk):not(.fear) b');
  await expect(known.first()).toBeVisible();
  const names = await known.allTextContents();
  expect(names).toEqual(expect.arrayContaining([offer[0], offer[2]]));
  await expect(page.locator('.trait.hidden', { hasText: 'A hidden gift' })).toBeVisible();

  expect(errors).toEqual([]);
});

test('after New Save, a reload goes back to the Warden being made', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/artificer.html');
  await page.evaluate(() => localStorage.clear());
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
  // A new save: make a second Warden, half-way, then reload.
  await page.locator('[data-cmd="reset"]').first().click();
  await toCreation(page);
  const offer = await offerOf(page);
  await page.locator('#wname').fill('Second');
  await page.reload();
  await toCreation(page);
  expect(await offerOf(page)).toEqual(offer);
  await expect(page.locator('#wname')).toHaveValue('Second');
  expect(errors).toEqual([]);
});
