/**
 * Acceptance tests for #1431 — the risk score that routes a PR to deeper review. The score
 * is pure (paths + size + tests in, tier + reasons + lenses out), so it's checked here
 * against the real rules file, .github/review-risk.json.
 */

import { describe, it, expect } from 'vitest';
import { scoreRisk, loadRules, globToRegex, mergeGate, parseNumstatZ, type ChangedFile } from '../.github/scripts/risk-score.mjs';

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

  it('counts a rename for the path it left', () => {
    const r = scoreRisk([{ filename: 'src/artificer/util/rng.ts', previous_filename: 'src/artificer/rng.ts', additions: 3, deletions: 3 }], rules);
    expect(r.tier).toBe('high');
    expect(r.lenses).toContain('determinism');
  });

  // 5. The merge gate: CI first; a high-risk PR waits for a person's label added after the last commit.
  it('holds a high-risk PR until a person approves after the last commit', () => {
    const person = { actor: 'filip', actorType: 'User', at: '2026-10-08T12:00:00Z' };
    const headAt = '2026-10-08T11:00:00Z';
    expect(mergeGate({ tier: 'low', ciOk: true, approval: null, headAt }).merge).toBe(true);
    expect(mergeGate({ tier: 'low', ciOk: false, approval: null, headAt }).merge).toBe(false);
    expect(mergeGate({ tier: 'high', ciOk: true, approval: null, headAt }).merge).toBe(false);
    expect(mergeGate({ tier: 'high', ciOk: true, approval: person, headAt }).merge).toBe(true);
    expect(mergeGate({ tier: 'high', ciOk: false, approval: person, headAt }).merge).toBe(false);
    // A bot adding the label, or a commit pushed after the approval: hold.
    expect(mergeGate({ tier: 'high', ciOk: true, approval: { ...person, actorType: 'Bot' }, headAt }).merge).toBe(false);
    expect(mergeGate({ tier: 'high', ciOk: true, approval: person, headAt: '2026-10-08T13:00:00Z' }).merge).toBe(false);
  });

  it('matches globs the way the rules expect', () => {
    expect(globToRegex('src/artificer/*.ts').test('src/artificer/region1.ts')).toBe(true);
    expect(globToRegex('src/artificer/*.ts').test('src/artificer/sub/x.ts')).toBe(false);
    expect(globToRegex('**/*.md').test('README.md')).toBe(true);
    expect(globToRegex('**/*.md').test('a/b/c.md')).toBe(true);
    expect(globToRegex('storytelling/**').test('storytelling/tick.ts')).toBe(true);
  });
});

/** #1433 — `risk-score.mjs --local` scores this checkout's `git diff -z --numstat -M` output. */
describe('Local risk score from git diff (#1433)', () => {
  // 1. Docs only: low.
  it('scores a docs-only diff low', () => {
    const r = scoreRisk(parseNumstatZ('12\t3\tdocs/notes.md\0' + '4\t0\tdocs/other.md\0'), rules);
    expect(r.tier).toBe('low');
  });

  // 2. The RNG: high, with the determinism reason; renames keep both paths; binaries count 0 lines.
  it('scores an RNG change high and keeps renames and binaries', () => {
    const files = parseNumstatZ('5\t2\tsrc/artificer/rng.ts\0' + '1\t1\t\0src/artificer/old.ts\0src/artificer/new.ts\0' + '-\t-\tpublic/a.png\0');
    expect(files).toEqual([
      { filename: 'src/artificer/rng.ts', additions: 5, deletions: 2 },
      { filename: 'src/artificer/new.ts', previous_filename: 'src/artificer/old.ts', additions: 1, deletions: 1 },
      { filename: 'public/a.png', additions: 0, deletions: 0 },
    ]);
    const r = scoreRisk(files, rules);
    expect(r.tier).toBe('high');
    expect(r.reasons.some(x => x.startsWith('seeded randomness / golden hashes'))).toBe(true);
  });

  it('stops at a truncated rename record instead of inventing a path', () => {
    expect(parseNumstatZ('2\t0\tsrc/a.ts\0' + '1\t1\t\0src/old.ts\0')).toEqual([{ filename: 'src/a.ts', additions: 2, deletions: 0 }]);
  });
});
