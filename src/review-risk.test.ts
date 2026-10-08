/**
 * Acceptance tests for #1431 — the risk score that routes a PR to deeper review. The score
 * is pure (paths + size + tests in, tier + reasons + lenses out), so it's checked here
 * against the real rules file, .github/review-risk.json.
 */

import { describe, it, expect } from 'vitest';
import { scoreRisk, loadRules, globToRegex, type ChangedFile } from '../.github/scripts/risk-score.mjs';

const rules = loadRules();
const files = (...names: string[]): ChangedFile[] => names.map(filename => ({ filename, additions: 10, deletions: 2 }));

describe('Review risk score (#1431)', () => {
  // 1. Only docs and wiki pages: low, whatever the size.
  it('scores docs and wiki changes low', () => {
    const r = scoreRisk([
      { filename: 'wiki/src/pages/lore/index.astro', additions: 900, deletions: 300 },
      { filename: 'docs/notes.md', additions: 40, deletions: 0 },
    ], rules);
    expect(r).toMatchObject({ tier: 'low', score: 0, lenses: [] });
    expect(r.reasons).toEqual(['docs, styles or assets only']);
  });

  // 2. Seeded randomness is high on its own, and the reason names the rule.
  it('scores the RNG and the story engine high', () => {
    for (const f of ['src/artificer/rng.ts', 'storytelling/tick.ts']) {
      const r = scoreRisk(files(f, 'src/artificer/rng.test.ts'), rules);
      expect(r.tier).toBe('high');
      expect(r.reasons.some(x => x.startsWith('seeded randomness / golden hashes') && x.includes(f))).toBe(true);
    }
  });

  // 3. The save controller with no test changes: both reasons.
  it('names the save format and the missing tests', () => {
    const r = scoreRisk(files('src/artificer-app/controller.ts'), rules);
    expect(r.reasons.some(x => x.startsWith('save format'))).toBe(true);
    expect(r.reasons.some(x => x.startsWith('no test changes'))).toBe(true);
    expect(r.tier).toBe('high');
    // With a test alongside, the "no test changes" reason goes away.
    const tested = scoreRisk(files('src/artificer-app/controller.ts', 'src/artificer-app/controller.test.ts'), rules);
    expect(tested.reasons.some(x => x.startsWith('no test changes'))).toBe(false);
  });

  // 4. A high tier runs the lenses of every rule that matched; lower tiers run none.
  it('collects the matched lenses for a high tier', () => {
    const r = scoreRisk(files('src/artificer/rng.ts', 'src/artificer/legacy.ts'), rules);
    expect(r.tier).toBe('high');
    expect(r.lenses.sort()).toEqual(['determinism', 'saves']);
    // High through a rule without a lens (workflows): the general lens.
    expect(scoreRisk(files('.github/workflows/ci.yml'), rules).lenses).toEqual(['general']);
    // Medium: no lenses.
    const medium = scoreRisk(files('CLAUDE.md'), rules);
    expect(medium).toMatchObject({ tier: 'medium', lenses: [] });
  });

  it('keeps ordinary game code with tests low, and size nudges it up', () => {
    expect(scoreRisk(files('src/scenes/GameScene.ts', 'src/scenes/GameScene.test.ts'), rules).tier).toBe('low');
    const big = scoreRisk([{ filename: 'src/scenes/GameScene.ts', additions: 900, deletions: 200 }], rules);
    expect(big.reasons).toContain('1100 lines changed (+2)');
    expect(big.tier).toBe('medium');
  });

  it('matches globs the way the rules expect', () => {
    expect(globToRegex('src/artificer/*.ts').test('src/artificer/region1.ts')).toBe(true);
    expect(globToRegex('src/artificer/*.ts').test('src/artificer/sub/x.ts')).toBe(false);
    expect(globToRegex('**/*.md').test('README.md')).toBe(true);
    expect(globToRegex('**/*.md').test('a/b/c.md')).toBe(true);
    expect(globToRegex('storytelling/**').test('storytelling/tick.ts')).toBe(true);
  });
});
