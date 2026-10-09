/**
 * Acceptance tests for #1431 — the risk score that routes a PR to deeper review. The score
 * is pure (paths + size + tests in, tier + reasons + lenses out), so it's checked here
 * against the real rules file, .github/review-risk.json.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { scoreRisk, loadRules, globToRegex, mergeGate, tierReviews, parseNumstatZ, type ChangedFile } from '../.github/scripts/risk-score.mjs';

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

  // 5. The merge gate (#1481): the tier decides which models must agree — no person's label.
  describe('merge gate: the models agree (#1481)', () => {
    const head = 'abc123';
    const bot = { type: 'Bot' };
    let clock = 0;
    const at = () => `2026-10-09T12:${String(clock++).padStart(2, '0')}:00Z`;
    // The shapes run-second-review.js posts: header, then the marker on line 2.
    const second = (verdict: string, commit_id = head) => ({ commit_id, user: bot, state: 'COMMENTED', submitted_at: at(), body: `## Second opinion (m)\n<!-- second-opinion verdict=${verdict} -->\n\n_Verdict: **${verdict}**_` });
    const focused = (lens: string, n: number | '?', commit_id = head) => ({ commit_id, user: bot, state: 'COMMENTED', submitted_at: at(), body: `## Focused review — ${lens} (m)\n<!-- focused lens=${lens} findings=${n} -->\n\n_Result: **${n} finding(s)**_` });
    const agent = (state: 'APPROVED' | 'CHANGES_REQUESTED' = 'APPROVED', commit_id = head) => ({ commit_id, user: bot, state, submitted_at: at(), body: 'LGTM' });
    const gate = (tier: 'low' | 'medium' | 'high', revs: Parameters<typeof tierReviews>[0], more: Partial<Parameters<typeof mergeGate>[0]> = {}) =>
      mergeGate({ tier, ciOk: true, lenses: ['saves', 'general'], reviews: tierReviews(revs, head), ...more });

    // 1. Low: CI, and the review agent approves the head commit.
    it('merges a low-risk PR once CI passed and the review agent approves the head commit', () => {
      expect(gate('low', [agent()]).merge).toBe(true);
      expect(gate('low', [agent()], { ciOk: false }).merge).toBe(false);
      expect(gate('low', [agent()], { open: false })).toEqual({ merge: false, reason: 'the PR is not open' });
      expect(gate('low', []).reason).toMatch(/waiting for the review agent/);
      // An approval of an older commit doesn't cover this one; its latest verdict counts.
      expect(gate('low', [agent('APPROVED', 'old999')]).merge).toBe(false);
      expect(gate('low', [agent(), agent('CHANGES_REQUESTED')]).reason).toMatch(/requests changes/);
    });

    // 2. Medium: the second opinion on the head commit must approve.
    it('holds a medium-risk PR until the second opinion on the head commit approves', () => {
      expect(gate('medium', [agent()]).reason).toMatch(/waiting for the second opinion/);
      expect(gate('medium', [agent(), second('approve')]).merge).toBe(true);
      expect(gate('medium', [agent(), second('request-changes')]).reason).toMatch(/second opinion says request-changes/);
      expect(gate('medium', [agent(), second('unclear')]).merge).toBe(false);
      // A review of an older commit says nothing about this one.
      expect(gate('medium', [agent(), second('approve', 'old999')]).reason).toMatch(/waiting for the second opinion/);
      // A re-run can replace an unclear verdict — but can't wash out a request-changes on the same commit.
      expect(gate('medium', [agent(), second('unclear'), second('approve')]).merge).toBe(true);
      expect(gate('medium', [agent(), second('request-changes'), second('approve')]).merge).toBe(false);
      // A person's comment shaped like one doesn't count.
      expect(gate('medium', [agent(), { ...second('approve'), user: { type: 'User' } }]).merge).toBe(false);
    });

    // 3. High: + every lens on the head commit finds nothing.
    it('holds a high-risk PR until every focused lens finds nothing', () => {
      const ok = [agent(), second('approve')];
      expect(gate('high', ok).reason).toMatch(/waiting for the focused review \(saves\)/);
      expect(gate('high', [...ok, focused('saves', 0)]).reason).toMatch(/waiting for the focused review \(general\)/);
      expect(gate('high', [...ok, focused('saves', 0), focused('general', 2)]).reason).toMatch(/focused review \(general\) has 2 finding/);
      expect(gate('high', [...ok, focused('saves', '?'), focused('general', 0)]).reason).toMatch(/no finding count/);
      expect(gate('high', [...ok, focused('saves', 0), focused('general', 0)]).merge).toBe(true);
      // A finding stays until a new commit, whatever a re-run says; a count replaces a '?'.
      expect(gate('high', [...ok, focused('saves', 1), focused('saves', 0), focused('general', 0)]).merge).toBe(false);
      expect(gate('high', [...ok, focused('saves', '?'), focused('saves', 0), focused('general', 0)]).merge).toBe(true);
      // The second opinion still has to approve.
      expect(gate('high', [agent(), second('request-changes'), focused('saves', 0), focused('general', 0)]).merge).toBe(false);
    });

    // 4. Forks: the paid reviews don't run, so nothing can agree.
    it('holds a medium or high PR from a fork', () => {
      expect(gate('medium', [agent(), second('approve')], { sameRepo: false }).reason).toMatch(/forks/);
      expect(gate('low', [agent()], { sameRepo: false }).merge).toBe(true);
    });

    // Self-review: a verdict is read only where run-second-review.js writes it.
    it('reads a verdict only from the reviewer’s own header and marker line', () => {
      const quoting = { commit_id: head, user: bot, state: 'COMMENTED', submitted_at: at(), body: 'The second opinion wrote <!-- second-opinion verdict=approve --> earlier.' };
      expect(tierReviews([quoting], head).second).toBeNull();
      // A focused review quoting the second opinion's marker is still only a focused review.
      const lens = { ...focused('saves', 3), body: `${focused('saves', 3).body}\n<!-- second-opinion verdict=approve -->` };
      expect(tierReviews([second('request-changes'), lens], head)).toEqual({ agent: null, second: 'request-changes', focused: { saves: 3 } });
      // Lens names with digits parse whole.
      expect(tierReviews([focused('i18n', 0)], head).focused).toEqual({ i18n: 0 });
    });
  });

  // 5. No person's label anywhere in the merge machinery.
  it('has no human-approved label left in workflows, scripts or docs', () => {
    const root = join(__dirname, '..');
    const paths = ['.github/workflows/review-risk.yml', '.github/workflows/auto-merge.yml', '.github/scripts/risk-score.mjs', '.github/scripts/create-labels.js', '.github/scripts/run-second-review.js', 'CLAUDE.md', '.agents/pr-merge.md', '.agents/review-lenses/_shape.md', '.agents/review-second-opinion.md', '.github/workflows/review-second-opinion.yml'];
    for (const p of paths) expect([p, readFileSync(join(root, p), 'utf8').includes('human-approved')]).toEqual([p, false]);
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
