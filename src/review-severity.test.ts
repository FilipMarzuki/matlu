/**
 * Acceptance tests for #1780 — the severity gate. A paid review's finding holds the merge only when
 * it is high severity and names a concrete failing scenario (`fails when:`). Medium and low findings
 * are still posted, under a "not blocking" heading. Markers carry `findings=N high=H`; an old marker
 * with no `high=` counts every finding as high, so nothing slips through during the change.
 *
 * The fixtures are lens outputs in the new shape (`.agents/review-lenses/_shape.md`), modelled on the
 * real reviews of #1748 (the sort-tie finding) and #1762.
 */

import { describe, it, expect } from 'vitest';
import { parseFindings, secondOpinionVerdict, renderFindings } from '../.github/scripts/review-findings.mjs';
import { reviewBody } from '../.github/scripts/review-fallback.mjs';
import { parseReview, carryOver } from '../.github/scripts/review-cost.mjs';
import { tierReviews, mergeGate, REVIEW_BOT } from '../.github/scripts/risk-score.mjs';

const head = 'abc123';
const bot = { login: REVIEW_BOT, type: 'Bot' };
let clock = 0;
const at = () => `2026-10-16T12:${String(clock++).padStart(2, '0')}:00Z`;

/** A low and a medium finding (#1748's sort tie, as it should have been graded). */
const LOW_AND_MEDIUM = `FINDINGS: 2

### knownSpots sorts with a comparator that can return 0 for distinct spots
severity: medium
fails when: two spots have identical walking hours; Array.sort is stable in every engine we ship on, so the order only changes if the input order does.
evidence: src/artificer/camp-sites.ts:193

### The walking-hours cache is never cleared between runs
severity: low
fails when: theoretical — the cache key includes the seed, so a new run never reads an old entry.
evidence: src/artificer/camp-sites.ts:41

**What I checked:** unseeded randomness, RNG draw order, sort stability and module-level state in camp-sites.ts.`;

/** One high finding with a concrete failing scenario (#1762's pit rot, as a lens would report it). */
const ONE_HIGH = `FINDINGS: 1

### Pit rot is carried across a camp move
severity: high
fails when: a player builds a pit, moves camp, and builds again: the new pit starts with the old pit's rot, so the same seed and actions give a different result than before the move existed.
evidence: src/artificer/region1.ts:812

**What I checked:** the camp move, the pit state and their replay.`;

/** "High" with no concrete scenario: downgraded to medium. */
const HIGH_NO_SCENARIO = `FINDINGS: 1

### The comparator could in principle tie
severity: high
evidence: src/artificer/camp-sites.ts:193

**What I checked:** sort order.`;

/** The same, with a placeholder where the scenario should be. */
const HIGH_PLACEHOLDER = HIGH_NO_SCENARIO.replace('severity: high\n', 'severity: high\nfails when: n/a\n');

/** A second opinion with only medium findings, but a model that still wrote request-changes. */
const SECOND_MEDIUM_ONLY = `VERDICT: request-changes
FINDINGS: 1

### The timeout in dev-mode-ai.test.ts was raised without a reason
severity: medium
fails when: the test gets slower again; nothing fails today.
evidence: src/artificer-play/dev-mode-ai.test.ts:12

**What I checked:** the feature switch, the save field and the acceptance tests.`;

const focusedReview = (lens: string, marker: string, commit_id = head) =>
  ({ commit_id, user: bot, state: 'COMMENTED', submitted_at: at(), body: `## Focused review — ${lens} (m)\n<!-- focused lens=${lens} ${marker} -->\n\nbody` });
const posted = (o: Parameters<typeof reviewBody>[0], commit_id = head) =>
  ({ commit_id, user: bot, state: 'COMMENTED', submitted_at: at(), html_url: 'u', body: reviewBody(o) });
const agent = () => ({ commit_id: head, user: bot, state: 'APPROVED', submitted_at: at(), body: 'LGTM' });
const secondOk = () => posted({ usedModel: 'm', verdict: 'approve', findings: '0', high: '0' });
const gate = (revs: Parameters<typeof tierReviews>[0], tier: 'medium' | 'high' = 'high') =>
  mergeGate({ tier, ciOk: true, lenses: ['determinism'], reviews: tierReviews(revs, head) });

/** What run-second-review.js posts for a focused review's text. */
const lensBody = (text: string) => {
  const p = parseFindings(text);
  return reviewBody({ focus: 'determinism', usedModel: 'openai/gpt-5', verdict: `${p.total} finding(s), ${p.high} high`, findings: String(p.total), high: String(p.high), text: renderFindings(text, p) });
};

describe('Severity gate (#1780)', () => {
  // 1. A low and a medium finding: findings=2 high=0, and the gate passes.
  it('marks a low and a medium finding findings=2 high=0, and lets the gate pass', () => {
    const p = parseFindings(LOW_AND_MEDIUM);
    expect(p).toMatchObject({ total: 2, high: 0 });
    expect(p.findings.map((f) => f.severity)).toEqual(['medium', 'low']);
    const body = lensBody(LOW_AND_MEDIUM);
    expect(body.split('\n')[1]).toBe('<!-- focused lens=determinism findings=2 high=0 -->');
    expect(gate([agent(), secondOk(), { ...posted({ usedModel: 'm', verdict: 'x' }), body }]).merge).toBe(true);
  });

  // 2. One high finding with a failing scenario: the gate holds.
  it('holds the gate on one high finding with a fails-when scenario', () => {
    const p = parseFindings(ONE_HIGH);
    expect(p).toMatchObject({ total: 1, high: 1 });
    expect(p.findings[0]).toMatchObject({ severity: 'high', downgraded: false, evidence: 'src/artificer/region1.ts:812' });
    const body = lensBody(ONE_HIGH);
    expect(body.split('\n')[1]).toBe('<!-- focused lens=determinism findings=1 high=1 -->');
    const g = gate([agent(), secondOk(), { ...posted({ usedModel: 'm', verdict: 'x' }), body }]);
    expect(g.merge).toBe(false);
    expect(g.reason).toMatch(/determinism\) has 1 high-severity finding/);
  });

  // 3. "High" with no fails-when line is downgraded to medium.
  it('downgrades a "high" finding with no fails-when scenario to medium', () => {
    for (const text of [HIGH_NO_SCENARIO, HIGH_PLACEHOLDER]) {
      const p = parseFindings(text);
      expect(p.findings[0]).toMatchObject({ claimed: 'high', severity: 'medium', downgraded: true });
      expect(p).toMatchObject({ total: 1, high: 0 });
    }
    expect(renderFindings(HIGH_NO_SCENARIO)).toMatch(/counted as medium/);
  });

  // 4. An old-format marker `findings=1` counts as one high finding: the gate holds.
  it('holds the gate on an old-format marker findings=1 (backward-compatible)', () => {
    expect(tierReviews([focusedReview('determinism', 'findings=1')], head).focused).toEqual({ determinism: 1 });
    expect(gate([agent(), secondOk(), focusedReview('determinism', 'findings=1 key=0123abcd')]).merge).toBe(false);
    // The new marker: only high findings count.
    expect(tierReviews([focusedReview('determinism', 'findings=3 high=0')], head).focused).toEqual({ determinism: 0 });
    expect(gate([agent(), secondOk(), focusedReview('determinism', 'findings=3 high=0 key=0123abcd')]).merge).toBe(true);
    // A high count it couldn't read is no count.
    expect(gate([agent(), secondOk(), focusedReview('determinism', 'findings=2 high=?')]).reason).toMatch(/no finding count/);
  });

  // 5. A second opinion with only medium findings counts as approve.
  it('counts a second opinion with only medium findings as approve', () => {
    const v = secondOpinionVerdict(SECOND_MEDIUM_ONLY);
    expect(v).toMatchObject({ verdict: 'approve', total: 1, high: 0 });
    const body = reviewBody({ usedModel: 'm', verdict: v.verdict, findings: String(v.total), high: String(v.high), text: renderFindings(SECOND_MEDIUM_ONLY) });
    expect(body.split('\n')[1]).toBe('<!-- second-opinion verdict=approve findings=1 high=0 -->');
    expect(gate([agent(), { ...secondOk(), body }], 'medium').merge).toBe(true);
    // A high finding makes it request-changes, whatever the model's own verdict line says.
    expect(secondOpinionVerdict(ONE_HIGH.replace('FINDINGS: 1', 'VERDICT: approve\nFINDINGS: 1')).verdict).toBe('request-changes');
  });
});

describe('Severity gate — the edges (#1780)', () => {
  it('posts medium and low findings under a "not blocking" heading, and high ones under "blocking"', () => {
    const low = renderFindings(LOW_AND_MEDIUM);
    expect(low).toMatch(/### Not blocking — 2 medium or low finding\(s\)/);
    expect(low).not.toMatch(/### Blocking/);
    expect(low).toContain('knownSpots sorts with a comparator');
    expect(low).toContain('**What I checked:**');
    const mixed = renderFindings(`${ONE_HIGH.replace('FINDINGS: 1', 'FINDINGS: 2').replace(/\n\n\*\*What I checked.*$/s, '')}\n\n${LOW_AND_MEDIUM.split('\n\n')[2]}\n\n**What I checked:** x`);
    expect(mixed.indexOf('### Blocking — 1 high-severity finding')).toBeLessThan(mixed.indexOf('### Not blocking — 1 medium or low'));
  });

  it('reads FINDINGS: 0 as findings=0 high=0, and no count at all as unknown', () => {
    expect(parseFindings('FINDINGS: 0\n\n**What I checked:** everything.')).toMatchObject({ total: 0, high: 0, findings: [] });
    expect(parseFindings('I looked and it seems fine.')).toMatchObject({ total: null, high: null });
    expect(secondOpinionVerdict('No verdict here.')).toMatchObject({ verdict: 'unclear' });
  });

  it('counts findings the model announced but left without a severity line as high', () => {
    // The old shape: FINDINGS: 1 and a bullet with no severity line — as on #1748.
    const old = 'FINDINGS: 1\n- src/artificer/camp-sites.ts:193 — knownSpots sorts with a comparator that can return 0.\n  Fails when: two spots tie.';
    expect(parseFindings(old)).toMatchObject({ total: 1, high: 1 });
    // A request-changes with nothing graded holds too.
    expect(secondOpinionVerdict('VERDICT: request-changes\n\n- **Blocking** — the save field has no default.')).toMatchObject({ verdict: 'request-changes', high: 1 });
    expect(secondOpinionVerdict('VERDICT: approve\n\n**What I checked:** all of it.')).toMatchObject({ verdict: 'approve', total: 0, high: 0 });
  });

  it('reads severity and fails-when lines written with markdown emphasis or bullets', () => {
    const text = 'FINDINGS: 2\n\n1. **A save field has no default**\n   - **Severity:** High\n   - _Fails when:_ last week\'s save loads: `undefined + 1` is NaN.\n   - **Evidence:** `src/artificer-app/controller.ts:88`\n\n2. **Naming**\n   - **Severity**: low\n   - **Fails when**: never.\n   - **Evidence**: src/a.ts:1';
    const p = parseFindings(text);
    expect(p.findings.map((f) => [f.severity, f.downgraded])).toEqual([['high', false], ['low', false]]);
    expect(p.findings[0].evidence).toBe('src/artificer-app/controller.ts:88');
    expect(p).toMatchObject({ total: 2, high: 1 });
  });

  it('keeps the high count through a carry-over, and carries a review with only medium findings', () => {
    const body = lensBody(LOW_AND_MEDIUM).replace(' -->', ' key=00ff00ff00ff00ff -->');
    expect(parseReview(body)).toMatchObject({ findings: 2, high: 0, pass: true, blocks: false });
    const c = carryOver({ reviews: [{ commit_id: 'aaa', user: bot, state: 'COMMENTED', submitted_at: at(), body }], focus: 'determinism', keys: ['00ff00ff00ff00ff'], headSha: 'bbb' });
    expect(c).not.toBeNull();
    const again = reviewBody({ focus: 'determinism', usedModel: 'm', verdict: c!.parsed.verdict, findings: '2', high: String(c!.parsed.high), key: c!.parsed.key, carried: { from: 'aaa', url: 'u' } });
    expect(again.split('\n')[1]).toBe('<!-- focused lens=determinism findings=2 high=0 key=00ff00ff00ff00ff -->');
    // An old marker with findings carries nothing (it blocks); a high one blocks too.
    expect(parseReview('## Focused review — saves (m)\n<!-- focused lens=saves findings=1 key=00ff -->')).toMatchObject({ high: 1, blocks: true });
    expect(parseReview('## Second opinion (m)\n<!-- second-opinion verdict=approve findings=1 high=0 key=00ff -->')).toMatchObject({ verdict: 'approve', pass: true });
  });

  it('says in the review body that only high findings hold the merge', () => {
    expect(lensBody(LOW_AND_MEDIUM)).toMatch(/only a high-severity finding with a concrete failing scenario holds the merge/);
    expect(reviewBody({ usedModel: 'm', verdict: 'approve', findings: '0', high: '0' })).toMatch(/only a high-severity finding/);
  });
});
