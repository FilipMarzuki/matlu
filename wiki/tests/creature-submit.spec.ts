/**
 * End-to-end tests for the creature submission form (/creatures/submit).
 *
 * Supabase API calls are intercepted with page.route() — no real database
 * writes or storage uploads happen. This lets the tests run without
 * production credentials and without polluting the live bucket.
 *
 * The two Supabase calls the form makes:
 *   1. POST /storage/v1/object/creature-art/<path>   — image upload
 *   2. POST /rest/v1/creature_submissions             — row insert
 *   3. DELETE /storage/v1/object/creature-art        — rollback (on insert failure)
 *
 * Run: cd wiki && npm test
 */

import { test, expect, type Page } from '@playwright/test';

// ── Test fixtures ─────────────────────────────────────────────────────────────

// Minimal 1×1 PNG (68 bytes) — smallest valid PNG Playwright can pass to a
// file input. Using a real PNG means the MIME-type check passes as expected.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fill every required field so the submit button becomes enabled.
 *
 * Required fields (per computeScore + consent check in the form):
 *   - creature_name (non-empty)
 *   - art_file (valid image)
 *   - lore_description (≥ 20 chars)
 *   - license_accepted checkbox
 *   - parental_consent checkbox
 */
async function fillRequired(page: Page) {
  await page.fill('#creature_name', 'Gloomfin');
  await page.locator('#art_file').setInputFiles({
    name: 'gloomfin.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  });
  await page.fill(
    '#lore_description',
    'A sleek river predator with bioluminescent fins that pulse in rhythm with its heartbeat.',
  );
  await page.check('#license_accepted');
  await page.check('#parental_consent');
}

/**
 * Wire up route mocks that return success for both the storage upload
 * and the creature_submissions insert. Call this before submitting.
 */
function mockSuccess(page: Page) {
  // Storage upload — respond with the shape the JS SDK expects on success.
  page.route('**/storage/v1/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ Key: 'creature-art/pending/test.png', Id: 'test-uuid' }),
    }),
  );
  // Table insert — 201 Created with an empty result set.
  page.route('**/rest/v1/creature_submissions**', route =>
    route.fulfill({ status: 201, contentType: 'application/json', body: '{}' }),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('creature submission form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/creatures/submit');
  });

  // ── Submit button gating ──────────────────────────────────────────────────

  test('submit button is disabled on load', async ({ page }) => {
    // No fields filled — all required checks fail.
    await expect(page.locator('#submit-btn')).toBeDisabled();
  });

  test('submit button stays disabled with only creature name filled', async ({ page }) => {
    // Name is present but image, description, and consent are missing.
    await page.fill('#creature_name', 'Gloomfin');
    await expect(page.locator('#submit-btn')).toBeDisabled();
  });

  test('submit button stays disabled when description is under 20 characters', async ({ page }) => {
    // lore_description requires at least 20 chars (computeScore awards 0 pts otherwise).
    // This catches regressions where the min-length check is accidentally removed.
    await page.fill('#creature_name', 'Gloomfin');
    await page.locator('#art_file').setInputFiles({ name: 'g.png', mimeType: 'image/png', buffer: TINY_PNG });
    await page.fill('#lore_description', 'Too short.');  // 10 chars
    await page.check('#license_accepted');
    await page.check('#parental_consent');
    await expect(page.locator('#submit-btn')).toBeDisabled();
    // Topping it up to exactly 20 should flip the button.
    await page.fill('#lore_description', 'Exactly twenty chars!');  // 21 chars — over threshold
    await expect(page.locator('#submit-btn')).toBeEnabled();
  });

  test('submit button stays disabled without consent checkboxes', async ({ page }) => {
    // All content fields done but consent not ticked.
    await page.fill('#creature_name', 'Gloomfin');
    await page.locator('#art_file').setInputFiles({ name: 'g.png', mimeType: 'image/png', buffer: TINY_PNG });
    await page.fill('#lore_description', 'Lives in the brackish waters of the southern delta.');
    // Deliberately skip license_accepted and parental_consent.
    await expect(page.locator('#submit-btn')).toBeDisabled();
  });

  test('submit button enables when all required fields are complete', async ({ page }) => {
    await fillRequired(page);
    await expect(page.locator('#submit-btn')).toBeEnabled();
  });

  // ── File validation ───────────────────────────────────────────────────────

  test('rejects non-image files', async ({ page }) => {
    // The form checks file.type against ALLOWED_MIME before accepting the file.
    await page.locator('#art_file').setInputFiles({
      name: 'essay.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    });
    await expect(page.locator('#art_file_error')).toBeVisible();
    await expect(page.locator('#art_file_error')).toContainText('JPG, PNG, GIF, or WebP');
  });

  test('GIF passes frontend validation but storage bucket rejects it', async ({ page }) => {
    // The form's ALLOWED_MIME list includes image/gif, but the Supabase storage
    // bucket's allowed_mime_types does NOT. A GIF upload will therefore pass the
    // client-side check but fail at the bucket.
    //
    // This test documents that mismatch so it's visible if the bucket config ever
    // changes (or if someone removes gif from ALLOWED_MIME to fix it properly).
    //
    // Simulate the bucket rejecting the GIF with the error Supabase returns for
    // a disallowed MIME type.
    page.route('**/storage/v1/**', route =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 400, error: 'invalid_mime_type', message: 'mime type image/gif is not supported' }),
      }),
    );

    await page.fill('#creature_name', 'Gloomfin');
    await page.locator('#art_file').setInputFiles({
      name: 'drawing.gif',
      mimeType: 'image/gif',
      buffer: TINY_PNG,  // content doesn't matter — the bucket rejects on MIME type
    });
    // Frontend validation accepts GIF — no inline error, file stays selected.
    await expect(page.locator('#art_file_error')).toBeHidden();

    await page.fill('#lore_description', 'Lives deep in the canopy, rarely seen by human eyes.');
    await page.check('#license_accepted');
    await page.check('#parental_consent');
    await page.click('#submit-btn');

    // Upload fails at the bucket — form should show the upload error.
    await expect(page.locator('#form-status')).toContainText('Could not upload', { timeout: 10_000 });
  });

  test('rejects images over 5 MB', async ({ page }) => {
    // MAX_SIZE in the form is 5 * 1024 * 1024. One byte over should trip the check.
    // Buffer.alloc creates a zeroed buffer efficiently — content doesn't matter,
    // only the size, since the check is `file.size > MAX_SIZE`.
    await page.locator('#art_file').setInputFiles({
      name: 'huge.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
    });
    await expect(page.locator('#art_file_error')).toBeVisible();
    await expect(page.locator('#art_file_error')).toContainText('too large');
  });

  // ── Submission flow ───────────────────────────────────────────────────────

  test('shows success message and resets form after successful submit', async ({ page }) => {
    mockSuccess(page);
    await fillRequired(page);
    await page.click('#submit-btn');

    // The form handler sets statusEl.textContent to the success string.
    await expect(page.locator('#form-status')).toContainText('Thanks!', { timeout: 10_000 });

    // form.reset() should clear text inputs.
    await expect(page.locator('#creature_name')).toHaveValue('');
  });

  test('shows error and re-enables submit button when image upload fails', async ({ page }) => {
    // Supabase storage returns an error — the form should surface it and
    // re-enable the button so the user can retry.
    page.route('**/storage/v1/**', route =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 400, error: 'Bad Request', message: 'upload failed' }),
      }),
    );

    await fillRequired(page);
    await page.click('#submit-btn');

    await expect(page.locator('#form-status')).toContainText('Could not upload', { timeout: 10_000 });
    await expect(page.locator('#submit-btn')).toBeEnabled();
  });

  test('rolls back uploaded image and shows error when database insert fails', async ({ page }) => {
    // The form does a best-effort DELETE of the already-uploaded file when the
    // insert fails. We verify that rollback call is made.
    let rollbackCalled = false;

    page.route('**/storage/v1/**', async route => {
      if (route.request().method() === 'DELETE') {
        // This is the rollback: `supabase.storage.from('creature-art').remove([path])`
        rollbackCalled = true;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      } else {
        // Upload succeeds so we can reach the insert step.
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ Key: 'creature-art/pending/test.png', Id: 'test-uuid' }),
        });
      }
    });

    page.route('**/rest/v1/creature_submissions**', route =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: '23505', message: 'duplicate key' }),
      }),
    );

    await fillRequired(page);
    await page.click('#submit-btn');

    // The form handler awaits the rollback BEFORE setting the error text, so by
    // the time this assertion passes rollbackCalled is guaranteed to be true.
    await expect(page.locator('#form-status')).toContainText('went wrong', { timeout: 10_000 });
    expect(rollbackCalled).toBe(true);
  });

  // ── Draft persistence ─────────────────────────────────────────────────────

  test('draft is saved to localStorage and restored after page reload', async ({ page }) => {
    // Fill several fields — the form debounce-saves to localStorage('creature-draft-v1')
    // 500 ms after every input/change event.
    await page.fill('#creature_name', 'Thornback');
    await page.fill('#lore_description', 'A spiny creature that haunts the highland moors.');
    await page.selectOption('#kind_size', 'large');
    await page.check('input[name="kind_movement"][value="walk"]');

    // Wait for the 500 ms debounce to flush, plus a small buffer.
    await page.waitForTimeout(800);

    // Verify the draft was written to localStorage before reloading.
    const draft = await page.evaluate(() => localStorage.getItem('creature-draft-v1'));
    expect(draft).not.toBeNull();
    const parsed = JSON.parse(draft!);
    expect(parsed.creature_name).toBe('Thornback');

    // Reload and click Resume — the form should restore the saved values.
    await page.reload();
    await expect(page.locator('#draft-banner')).toBeVisible();
    await page.click('#btn-resume');

    await expect(page.locator('#creature_name')).toHaveValue('Thornback');
    await expect(page.locator('#lore_description')).toHaveValue(
      'A spiny creature that haunts the highland moors.',
    );
    await expect(page.locator('#kind_size')).toHaveValue('large');
    await expect(
      page.locator('input[name="kind_movement"][value="walk"]'),
    ).toBeChecked();

    // The image-resume hint should appear (file inputs can't be saved in drafts).
    await expect(page.locator('#image-resume-hint')).toBeVisible();
  });

  test('Start fresh clears the draft banner and localStorage', async ({ page }) => {
    // Seed localStorage directly so we don't need to wait for the debounce.
    await page.evaluate(() => {
      localStorage.setItem('creature-draft-v1', JSON.stringify({
        creature_name: 'OldCreature',
        lore_description: 'Some old description that should be discarded.',
        savedAt: new Date().toISOString(),
      }));
    });

    await page.reload();
    await expect(page.locator('#draft-banner')).toBeVisible();
    await page.click('#btn-fresh');

    // Banner should hide and localStorage entry should be gone.
    await expect(page.locator('#draft-banner')).toBeHidden();
    const draft = await page.evaluate(() => localStorage.getItem('creature-draft-v1'));
    expect(draft).toBeNull();

    // The form fields should remain at their default empty state.
    await expect(page.locator('#creature_name')).toHaveValue('');
  });
});
