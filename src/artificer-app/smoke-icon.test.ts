/**
 * #1890: food is preserved by smoking, not salting — there is no salt in the wild (see
 * no-salt-in-the-wild.test.ts) — so the *Preserve food* action and the rations store show 💨, not 🧂.
 * Salt that really is salt (Saltmere, the salt trade) keeps its own words; this only pins the icons.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICON, STORE_EMOJI } from './camp-blocks';
import { RATIONS_EMOJI } from './key-box';

describe('smoke, not salt, for preserving (#1890)', () => {
  it('the Preserve food action shows smoke', () => {
    expect(ICON.preserve).toBe('💨');
    expect(ICON.preserve).not.toBe('🧂');
  });

  it('the rations store shows smoke', () => {
    expect(STORE_EMOJI.rations).toBe('💨');
    expect(STORE_EMOJI.rations).not.toBe('🧂');
  });

  it("the food breakdown under the key box (#1891) shows rations as smoke too", () => {
    // Rations left the status bar's row in #1891; they show in the key box's food breakdown.
    expect(RATIONS_EMOJI).toBe('💨');
    // main.ts draws the page and can't be imported in a test (it touches the DOM), so read its source.
    for (const f of ['main.ts', 'key-box.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect(src).not.toContain('🧂');
    }
  });
});
