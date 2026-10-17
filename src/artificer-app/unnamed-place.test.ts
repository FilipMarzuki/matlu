/**
 * #1810: the place has no name yet. The header calls it the wilderness ("Vildmarken" in Swedish),
 * no line the player reads names Greywind Reach, and the header's Run counter is gone.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { en } from '../artificer/i18n/en';
import { sv } from '../artificer/i18n/sv';
import { RULES } from '../artificer-ai/observe';

describe('the place is unnamed (#1810)', () => {
  it('the header says THE WILDERNESS / VILDMARKEN', () => {
    expect(makeT('en')('top.titleHtml')).toBe('❄ THE <span class="mark">WILDERNESS</span>');
    expect(makeT('sv')('top.titleHtml')).toBe('❄ <span class="mark">VILDMARKEN</span>');
  });

  it('no catalog line, in either language, names Greywind Reach; the Run counter has no label', () => {
    for (const cat of [en, sv] as Record<string, string>[]) {
      expect(Object.values(cat).filter(v => /greywind/i.test(v))).toEqual([]);
      expect('top.run' in cat).toBe(false);
    }
  });

  it('the AI is told it plays the Artificer, in an unnamed valley', () => {
    expect(RULES).toContain('the Artificer');
    expect(RULES).toContain('an unnamed valley');
    expect(RULES).not.toMatch(/greywind/i);
  });
});
