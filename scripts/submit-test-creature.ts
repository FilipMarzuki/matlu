/**
 * One-off script: fill and submit the creature form at localhost:4323
 * with Färgglad Kordorörn data from the PDF.
 *
 * Run: npx tsx scripts/submit-test-creature.ts
 */

import { chromium } from '@playwright/test';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page    = await browser.newPage();

  await page.goto('http://localhost:4323/creatures/submit');

  // Dismiss any draft banner
  const freshBtn = page.locator('#btn-fresh');
  if (await freshBtn.isVisible()) await freshBtn.click();

  // ── Your creature ────────────────────────────────────────────────────────
  await page.fill('#creature_name', 'Färgglad Kordorörn');

  // ── About you ────────────────────────────────────────────────────────────
  await page.fill('#creator_name',   'Loke Marzuki');
  await page.fill('#maker_age',      '9');
  await page.fill('#contact_email',  'marzuki.filip@gmail.com');

  // ── Picture ──────────────────────────────────────────────────────────────
  await page.locator('#art_file').setInputFiles({
    name: 'kordororn-placeholder.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  });
  await page.fill('#art_credit', 'Loke Marzuki');

  // ── What kind? ───────────────────────────────────────────────────────────
  await page.selectOption('#kind_size', 'medium');
  await page.check('input[name="kind_movement"][value="fly"]');
  await page.check('input[name="kind_solitary"][value="true"]'); // Alone

  // ── Habitat ──────────────────────────────────────────────────────────────
  for (const biome of ['forest', 'meadow', 'mountain', 'ocean', 'river', 'tundra']) {
    await page.check(`input[name="habitat_biome"][value="${biome}"]`);
  }
  await page.selectOption('#habitat_climate', 'temperate');
  await page.fill('#habitat_notes',
    'It spends all its life in the air except for mating and nesting. After that is done it takes off again. It lives in the north. It builds a large nest of sticks and branches.');

  // ── Behaviour ────────────────────────────────────────────────────────────
  await page.selectOption('#behaviour_threat', 'neutral');
  await page.fill('#behaviour_notes', 'Hunts during the day, sleeps in the air at night.');

  // ── Food ─────────────────────────────────────────────────────────────────
  await page.selectOption('#kind_diet', 'omnivore');
  await page.fill('#food_notes',
    'Omnivore — can hunt small animals but prefers carrion. Will hunt and eat fish, smaller rodents, snakes, lizards and other things. Will also eat certain plants and fruits.');

  // ── Story ────────────────────────────────────────────────────────────────
  await page.fill('#lore_description',
    'Male and female look the same. Flies like a big eagle, often soaring on the thermals. Villagers fear it because it can grab smaller children.');

  // ── Consent ──────────────────────────────────────────────────────────────
  await page.check('#credits_opt_in');
  await page.check('#license_accepted');
  await page.check('#parental_consent');

  // ── Submit ───────────────────────────────────────────────────────────────
  await page.waitForFunction(() =>
    !(document.getElementById('submit-btn') as HTMLButtonElement).disabled,
    { timeout: 5_000 },
  );

  console.log('All fields filled — submitting…');
  await page.click('#submit-btn');

  const status = page.locator('#form-status');
  await status.waitFor({ timeout: 15_000 });
  const text = await status.textContent();
  console.log('Form status:', text);

  await page.waitForTimeout(3_000); // leave browser open briefly so you can see it
  await browser.close();
})();
