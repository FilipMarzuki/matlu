/**
 * Acceptance test for #1456, criterion 6 — the TOOLS line in the AI observation shows what an
 * unlearned heirloom still holds, and drops it once it has taught. Criteria 1–5 (the sim) are
 * in src/artificer/heirloom-teaching.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from '../artificer/region1';
import type { Tool } from '../artificer/crafting';
import { observe } from './observe';

const toolsLine = (s: Region1State): string => observe(s).split('\n').find(l => l.startsWith('TOOLS:'))!;

describe('TOOLS line shows what an unlearned heirloom holds (#1456)', () => {
  it('given a Warden holding an unlearned heirloom stone-knife (fine, made: { sharpening: 2 }), shows what it holds; once taught, shows just the tool', () => {
    const knife: Tool = { item: 'stone-knife', grade: 'fine', heirloom: true, made: { sharpening: 2 } };
    const unlearned: Region1State = { ...createRegion1(), tools: [knife] };
    expect(toolsLine(unlearned)).toContain('stone-knife (fine, holds sharpening 2)');

    const taught: Region1State = { ...unlearned, taughtBy: ['stone-knife'] };
    expect(toolsLine(taught)).toContain('stone-knife (fine)');
    expect(toolsLine(taught)).not.toContain('holds');
  });
});
