/**
 * Acceptance tests for #1779 — the review ledger: every past review (the review agent, the second
 * opinion, the focused lenses), what each cost, and what became of its findings, so the reviewers
 * can be judged on hit rate and cost (epic #1778).
 *
 * The fixtures in src/review-ledger.fixtures/ are real PRs, trimmed to the fields the ledger reads:
 * #1748 (a determinism finding, fixed by a sort tiebreak), #1762 (a request-changes, fixed),
 * #1764 (risk:low, one approve), #1767 (high, all pass) and #1769 (second opinions that failed).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  parseCost, parseRiskComment, parseFailureComment, parseReviewEntry, namedFiles, judgeFinding,
  ledgerForPr, aggregate, renderMarkdown, loadFixtures, fetchFromApi, type PrFixture, type PrLedger,
} from '../.github/scripts/review-ledger.mjs';
import { REVIEW_BOT } from '../.github/scripts/risk-score.mjs';

const FIXTURES = join(__dirname, 'review-ledger.fixtures');
const fixture = (n: number): PrFixture => JSON.parse(readFileSync(join(FIXTURES, `pr-${n}.json`), 'utf8'));
const bot = { login: REVIEW_BOT };

/** A small made-up PR: one review on commit c1, then the given later commits, then a merge. */
function synthetic(o: { review: { state?: string; body: string }; later?: { sha: string; files: string[]; parents?: number }[]; merged?: boolean }): PrFixture {
  return {
    pr: { number: 1, title: 'x', state: 'closed', merged_at: o.merged === false ? null : '2026-10-01T12:00:00Z', closed_at: '2026-10-01T12:00:00Z', created_at: '2026-10-01T09:00:00Z', labels: [{ name: 'risk:high' }] },
    comments: [],
    reviews: [{ id: 10, user: bot, state: o.review.state ?? 'COMMENTED', commit_id: 'c1', submitted_at: '2026-10-01T10:00:00Z', body: o.review.body }],
    commits: [
      { sha: 'c1', date: '2026-10-01T09:30:00Z', message: 'first', parents: 1, files: ['src/x.ts', 'src/y.ts'] },
      ...(o.later ?? []).map((c, i) => ({ sha: c.sha, date: `2026-10-01T11:0${i}:00Z`, message: 'later', parents: c.parents ?? 1, files: c.files })),
    ],
  };
}
const lensBody = (findings: string, bullets: string[], cost = '0.1000') => [
  '## Focused review — determinism (openai/gpt-5)',
  `<!-- focused lens=determinism findings=${findings} key=0123456789abcdef -->`,
  '', `_Result: **${findings} finding(s)**_`, '', `FINDINGS: ${findings}`, ...bullets, '', '---',
  `_Tokens: in 1,000 / out 200 · cost $${cost}_`,
].join('\n');

describe('Review ledger (#1779)', () => {
  // 1. Given fixture PR comments with the three markers and cost lines, the parser extracts the
  //    verdict, the findings count, the lens and the cost.
  it('parses the second-opinion and focused markers, the risk comment, cost lines and failures', () => {
    const pr = fixture(1748);
    const entries = pr.reviews.map(parseReviewEntry).filter(Boolean);
    const second = entries.find(e => e!.kind === 'second-opinion')!;
    expect(second).toMatchObject({ verdict: 'approve', findingsCount: 0, lens: null, model: 'google/gemini-2.5-pro', cost: 0.1378 });
    const det = entries.find(e => e!.lens === 'determinism')!;
    expect(det).toMatchObject({ kind: 'lens', verdict: '1 finding(s)', findingsCount: 1, model: 'openai/gpt-5', cost: 0.141 });
    expect(det.findings).toHaveLength(1);
    expect(det.findings[0].files).toEqual(['src/artificer/camp-sites.ts']);
    expect(entries.find(e => e!.lens === 'saves')).toMatchObject({ findingsCount: 0, cost: 0.1343 });
    // The review agent: approve or request-changes, free (no cost line).
    expect(entries.find(e => e!.kind === 'review-agent')).toMatchObject({ verdict: 'approve', cost: null, findingsCount: 0 });

    expect(parseCost('_Tokens: in 72,639 (21,888 cached) / out 4,070 · cost $0.1069_')).toBe(0.1069);
    expect(parseCost('_Tokens: in 10 / out 5_')).toBeNull();
    expect(parseCost('Tokens: not reported')).toBeNull();

    expect(parseRiskComment(pr.comments[0].body)).toEqual({ tier: 'high', score: 9 });
    expect(parseRiskComment('A plain comment')).toBeNull();

    const failed = fixture(1769).comments.map(c => parseFailureComment(c.body));
    expect(failed).toEqual([null, ['second-opinion'], ['second-opinion'], ['second-opinion']]);
    expect(parseFailureComment('A model review (second opinion: success, focused: failure) failed, so…')).toEqual(['focused']);

    // A request-changes from the review agent is one finding, with the files it names.
    const rc = fixture(1762).reviews.map(parseReviewEntry).find(e => e?.verdict === 'request-changes')!;
    expect(rc).toMatchObject({ kind: 'review-agent', findingsCount: 1 });
    expect(rc.findings[0].files).toEqual(['region1.ts']);

    // Someone else's review, or a body that only quotes a marker, isn't a review we count.
    expect(parseReviewEntry({ ...pr.reviews[1], user: { login: 'mallory' } })).toBeNull();
    expect(parseReviewEntry({ ...pr.reviews[1], body: `quoted:\n${pr.reviews[1].body}` })).toBeNull();
  });

  it('finds file names in finding text', () => {
    expect(namedFiles('- src/artificer/camp-sites.ts:193 — knownSpots sorts…')).toEqual(['src/artificer/camp-sites.ts']);
    expect(namedFiles('`moveCamp` (region1.ts:813-821) and region1.ts:2304')).toEqual(['region1.ts']);
    expect(namedFiles('see .github/scripts/risk-score.mjs and package.json; e.g. v1.2 or 0.5x')).toEqual(['.github/scripts/risk-score.mjs', 'package.json']);
  });

  // 2. A finding naming src/x.ts and a later commit touching src/x.ts → acted on; no later change
  //    before the merge → dismissed.
  it('labels a finding acted on when a later commit touches its file, dismissed when nothing changed', () => {
    const finding = lensBody('1', ['- src/x.ts:12 — a sort with ties.']);
    const acted = ledgerForPr(synthetic({ review: { body: finding }, later: [{ sha: 'c2', files: ['src/x.ts'] }] }));
    expect(acted.findings).toHaveLength(1);
    expect(acted.findings[0]).toMatchObject({ label: 'acted-on', files: ['src/x.ts'], commit: 'c2' });
    expect(acted.rounds).toBe(1);

    const dismissed = ledgerForPr(synthetic({ review: { body: finding } }));
    expect(dismissed.findings[0].label).toBe('dismissed');
    expect(dismissed.rounds).toBe(0);

    // Neither: later work on other files only, a merge of main that happens to touch src/x.ts,
    // or a PR that never merged.
    expect(ledgerForPr(synthetic({ review: { body: finding }, later: [{ sha: 'c2', files: ['src/z.ts'] }] })).findings[0].label).toBe('unclear');
    expect(ledgerForPr(synthetic({ review: { body: finding }, later: [{ sha: 'm1', files: ['src/x.ts'], parents: 2 }] })).findings[0].label).toBe('dismissed');
    expect(ledgerForPr(synthetic({ review: { body: finding }, merged: false })).findings[0].label).toBe('unclear');

    // A file named by its base name matches the full path; a different folder's x.ts doesn't.
    expect(judgeFinding({ files: ['x.ts'], commitId: 'c1', at: '2026-10-01T10:00:00Z' }, synthetic({ review: { body: finding }, later: [{ sha: 'c2', files: ['src/x.ts'] }] })).label).toBe('acted-on');
    expect(judgeFinding({ files: ['lib/x.ts'], commitId: 'c1', at: '2026-10-01T10:00:00Z' }, synthetic({ review: { body: finding }, later: [{ sha: 'c2', files: ['src/x.ts'] }] })).label).toBe('unclear');

    // The real cases: #1748's sort tiebreak and #1762's pit-rot fix were both acted on.
    const l1748 = ledgerForPr(fixture(1748));
    expect(l1748.findings.map(f => [f.reviewer, f.label, f.commit?.slice(0, 7)])).toEqual([['lens:determinism', 'acted-on', '55748bb']]);
    const l1762 = ledgerForPr(fixture(1762));
    expect(l1762.findings.map(f => [f.reviewer, f.label, f.commit?.slice(0, 7)])).toEqual([['review-agent', 'acted-on', 'bb28f33']]);
    expect([l1748.rounds, l1762.rounds]).toEqual([1, 1]);
  });

  // 3. An override entry wins.
  it('lets an override map correct any label', () => {
    const pr = fixture(1748);
    const id = ledgerForPr(pr).findings[0].id;
    const exact = ledgerForPr(pr, { [id]: { label: 'dismissed', note: 'JS sort is stable; the fix was cosmetic' } });
    expect(exact.findings[0]).toMatchObject({ label: 'dismissed', overridden: true, note: 'JS sort is stable; the fix was cosmetic' });
    // A key without the finding's index covers every finding of that review; a bare string works too.
    const [prNum, reviewId] = id.split(':');
    expect(ledgerForPr(pr, { [`${prNum}:${reviewId}`]: 'unclear' }).findings[0]).toMatchObject({ label: 'unclear', overridden: true });
    // An override names a real label, or it's refused rather than silently counted.
    expect(() => ledgerForPr(pr, { [id]: 'maybe' })).toThrow(/acted-on, dismissed or unclear/);
  });

  // 4. The aggregate: per-reviewer cost and hit rate.
  it('computes per-reviewer and per-tier runs, hit rate and cost per acted-on finding', () => {
    const a = ledgerForPr(synthetic({ review: { body: lensBody('2', ['- src/x.ts — one', '- src/y.ts — two'], '0.3000') }, later: [{ sha: 'c2', files: ['src/x.ts'] }] }));
    const b = ledgerForPr({ ...synthetic({ review: { body: lensBody('0', [], '0.1000') } }), pr: { ...synthetic({ review: { body: '' } }).pr, number: 2 } });
    const report = aggregate([a, b]);
    const det = report.reviewers.find(r => r.reviewer === 'lens:determinism')!;
    expect(det).toMatchObject({ runs: 2, failures: 0, passes: 1, blocks: 2, actedOn: 1, dismissed: 0, unclear: 1, cost: 0.4 });
    expect(det.hitRate).toBe(0.5);
    expect(det.costPerActedOn).toBeCloseTo(0.4);
    expect(report.byTier).toEqual([expect.objectContaining({ reviewer: 'lens:determinism', tier: 'high', runs: 2, blocks: 2, actedOn: 1 })]);

    // The real fixtures.
    const real = aggregate([1748, 1762, 1764, 1767, 1769].map(n => ledgerForPr(fixture(n))));
    const by = Object.fromEntries(real.reviewers.map(r => [r.reviewer, r]));
    // The review agent: 8 runs (1764, 1767 and 1769 one each; 1748 two; 1762 three), one request-changes, acted on, free.
    expect(by['review-agent']).toMatchObject({ runs: 8, passes: 7, blocks: 1, actedOn: 1, cost: null, hitRate: 1, costPerActedOn: null });
    // The second opinion: 6 approves (1748 ×2, 1762 ×3, 1767 ×1), 3 failed runs on 1769, nothing to act on.
    expect(by['second-opinion']).toMatchObject({ runs: 6, failures: 3, passes: 6, blocks: 0, actedOn: 0, hitRate: null, costPerActedOn: null });
    expect(by['second-opinion'].cost).toBeCloseTo(0.1378 + 0.1527 + 0.1059 + 0.1131 + 0.1095 + 0.1205, 4);
    // Determinism: 6 runs, one finding (1748's sort tiebreak), acted on, so one hit cost the lens's whole bill.
    expect(by['lens:determinism']).toMatchObject({ runs: 6, passes: 5, blocks: 1, actedOn: 1, hitRate: 1 });
    expect(by['lens:determinism'].cost).toBeCloseTo(0.141 + 0.1069 + 0.097 + 0.0936 + 0.1035 + 0.1172, 4);
    expect(by['lens:determinism'].costPerActedOn).toBeCloseTo(by['lens:determinism'].cost!, 4);
    expect(by['lens:saves']).toMatchObject({ runs: 6, passes: 6, blocks: 0, actedOn: 0, costPerActedOn: null });
    expect(real.prs.map(p => [p.number, p.tier, p.rounds])).toEqual([[1748, 'high', 1], [1762, 'high', 1], [1764, 'low', 0], [1767, 'high', 0], [1769, 'medium', 0]]);
    expect(real.prs.find(p => p.number === 1769)!.failures).toEqual(['second-opinion', 'second-opinion', 'second-opinion']);

    const md = renderMarkdown(real);
    expect(md).toMatch(/^# Review ledger/);
    expect(md).toContain('| lens:determinism |');
    expect(md).toContain('| #1762 | high |');
  });

  // 5. An offline mode reads a fixture directory instead of the API.
  it('runs offline from a fixture directory', () => {
    const prs = loadFixtures(FIXTURES);
    expect(prs.map(p => p.pr.number)).toEqual([1748, 1762, 1764, 1767, 1769]);
    const script = join(__dirname, '..', '.github', 'scripts', 'review-ledger.mjs');
    const json = execFileSync(process.execPath, [script, '--fixtures', FIXTURES, '--json'], { encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: '' } });
    const report = JSON.parse(json) as { prs: PrLedger[] };
    expect(report.prs.map(p => p.number)).toEqual([1748, 1762, 1764, 1767, 1769]);
    // --since filters fixtures too, by when the PR closed (or opened, if it's still open).
    const late = JSON.parse(execFileSync(process.execPath, [script, '--fixtures', FIXTURES, '--json', '--since', '2026-10-15T14:00:00Z'], { encoding: 'utf8' })) as { prs: PrLedger[] };
    expect(late.prs.map(p => p.number)).toEqual([1767, 1769]);
    const md = execFileSync(process.execPath, [script, '--dry-run'], { encoding: 'utf8' });
    expect(md).toMatch(/^# Review ledger/);
  });

  // The API mode reads the same shape the fixtures hold: PRs closed since the date, their
  // comments, reviews and commits, and each non-merge commit's files (merges aren't fetched).
  it('reads PRs since a date from the GitHub API into the fixture shape', async () => {
    const fx = fixture(1748);
    const calls: string[] = [];
    const pulls = [
      { number: 1748, title: fx.pr.title, html_url: fx.pr.html_url, state: 'closed', merged_at: fx.pr.merged_at, closed_at: fx.pr.closed_at, created_at: fx.pr.created_at, updated_at: fx.pr.closed_at, labels: [{ name: 'risk:high' }] },
      { number: 1700, title: 'old', state: 'closed', merged_at: '2026-10-01T00:00:00Z', closed_at: '2026-10-01T00:00:00Z', created_at: '2026-09-30T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', labels: [] },
    ];
    const answer = (p: string): unknown => {
      if (p.startsWith('/pulls?state=closed')) return pulls;
      if (p.startsWith('/issues/1748/comments')) return fx.comments;
      if (p.startsWith('/pulls/1748/reviews')) return fx.reviews;
      if (p.startsWith('/pulls/1748/commits')) return fx.commits.map(c => ({ sha: c.sha, commit: { message: c.message, committer: { date: c.date } }, parents: Array.from({ length: c.parents ?? 1 }, () => ({})) }));
      const sha = /^\/commits\/(\w+)$/.exec(p)?.[1];
      const c = fx.commits.find(x => x.sha === sha);
      if (c) return { files: (c.files ?? []).map(filename => ({ filename })) };
      throw new Error(`unexpected ${p}`);
    };
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      const p = String(url).replace('https://api.github.com/repos/o/r', '');
      calls.push(p);
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer t');
      return new Response(JSON.stringify(answer(p)), { status: 200 });
    };
    const got = await fetchFromApi({ repo: 'o/r', token: 't', since: '2026-10-10', fetch: fakeFetch as typeof fetch });
    expect(got).toEqual([fx]);
    // The old PR isn't read, and the merge commit's files aren't fetched.
    expect(calls.some(c => c.includes('1700'))).toBe(false);
    expect(calls.filter(c => c.startsWith('/commits/'))).toHaveLength(fx.commits.filter(c => (c.parents ?? 1) <= 1).length);
    expect(ledgerForPr(got[0]).findings[0].label).toBe('acted-on');
  });
});
