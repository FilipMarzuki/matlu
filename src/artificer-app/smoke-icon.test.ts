/**
 * #1890: food is preserved by smoking, not salting — there is no salt in the wild (see
 * no-salt-in-the-wild.test.ts) — so the *Preserve food* action and the rations store show 💨, not 🧂.
 * Salt that really is salt (Saltmere, the salt trade) keeps its own words; this only pins the icons.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICON, STORE_EMOJI } from './camp-blocks';

describe('smoke, not salt, for preserving (#1890)', () => {
  it('the Preserve food action shows smoke', () => {
    expect(ICON.preserve).toBe('💨');
    expect(ICON.preserve).not.toBe('🧂');
  });

  it('the rations store shows smoke', () => {
    expect(STORE_EMOJI.rations).toBe('💨');
    expect(STORE_EMOJI.rations).not.toBe('🧂');
  });

  it("the status bar's rations fallback in main.ts is smoke too", () => {
    // main.ts draws the page and can't be imported in a test (it touches the DOM), so read its source.
    const src = readFileSync(join(__dirname, 'main.ts'), 'utf8');
    expect(src).toContain("sIcon('rations', '💨'");
    expect(src).not.toContain('🧂');
  });
});
