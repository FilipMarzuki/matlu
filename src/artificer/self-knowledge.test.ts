/**
 * Tests for #1266 — which journal lines the app styles as self-knowledge: the hints at a
 * hidden talent and its reveal (#1265), and a quirk's reveal (#1362). Nothing else.
 */

import { describe, it, expect } from 'vitest';
import { isSelfKnowledge } from './self-knowledge';
import { HINTS, TALENT_IDS, giftLine } from './talents';
import { QUIRKS } from './quirks';

describe('Self-knowledge lines (#1266)', () => {
  it('marks every hint, reveal and quirk reveal — and nothing else', () => {
    for (const id of TALENT_IDS) {
      for (const line of [HINTS[id].vague, HINTS[id].closer, HINTS[id].reveal, giftLine(id)]) expect(isSelfKnowledge(line)).toBe(true);
    }
    expect(isSelfKnowledge(QUIRKS.runner.revealed)).toBe(true);
    for (const line of ['Fetched 3 water.', 'Hungry — no food.', 'Milestone — Shelter', 'Something in you has settled; it comes easier than it did.']) {
      expect(isSelfKnowledge(line)).toBe(false);
    }
  });
});
