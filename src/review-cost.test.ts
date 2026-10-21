/**
 * Acceptance tests for #1654 — the same review quality for less money: a capped request, a verdict
 * carried over to a new head whose PR diff, model and review instructions are unchanged (no paid
 * call), and tokens and cost on every review. The gate still needs a verdict pinned to the head.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  OPENROUTER_MAX_TOKENS, openRouterBody, openRouterUsage, claudeUsage, usageLine, reviewKey, parseReview, carryOver,
} from '../.github/scripts/review-cost.mjs';
import { reviewBody, claudeReview, CLAUDE_MAX_TOKENS } from '../.github/scripts/review-fallback.mjs';
import { tierReviews, mergeGate, REVIEW_BOT, type Review } from '../.github/scripts/risk-score.mjs';

const bot = { login: REVIEW_BOT };
const DIFF1 = 'diff --git a/x b/x\n+one\n';
const DIFF2 = 'diff --git a/x b/x\n+two\n';
const RULES = 'system\nreview rules\n---\noverride';
const key = (o: { diff?: string; model?: string; instructions?: string } = {}) =>
  reviewKey({ diff: o.diff ?? DIFF1, model: o.model ?? 'or-model', instructions: o.instructions ?? RULES });
const K1 = key();
const K2 = key({ diff: DIFF2 });
let t = 0;
const at = () => new Date(Date.UTC(2026, 9, 12, 9, 0, t++)).toISOString();

/** A review as run-second-review.js posts it, pinned to `commit`. */
const posted = (commit: string, o: { focus?: string; verdict?: string; findings?: string; key: string; weak?: string }): Review & { html_url: string } => ({
  commit_id: commit, user: bot, state: 'COMMENTED', submitted_at: at(), html_url: `https://github.com/r/pull/1#review-${commit}`,
  body: reviewBody({
    focus: o.focus, usedModel: 'or-model', verdict: o.focus ? `${o.findings} finding(s)` : o.verdict ?? 'approve',
    findings: o.findings, text: 'VERDICT: approve', key: o.key, weak: o.weak ?? null, usage: { input: 1000, output: 200, cost: 0.01 },
  }),
});

describe('Cheaper paid reviews (#1654)', () => {
  // 1. The request carries a max_tokens cap (the 402 reservation on #1651), and asks for usage.
  it('caps the output of both reviewers', async () => {
    expect(OPENROUTER_MAX_TOKENS).toBe(16_000);
    const body = openRouterBody({ model: 'm', system: 's', prompt: 'p' });
    expect(body.max_tokens).toBe(OPENROUTER_MAX_TOKENS);
    expect(body.usage).toEqual({ include: true });
    expect(body.messages.map(m => m.role)).toEqual(['system', 'user']);

    expect(CLAUDE_MAX_TOKENS).toBe(12_000);
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      model: 'c', stop_reason: 'end_turn', content: [{ type: 'text', text: 'VERDICT: approve' }],
      usage: { input_tokens: 900, output_tokens: 300, cache_read_input_tokens: 100 },
    }), { status: 200 }));
    const r = await claudeReview({ prompt: 'p', system: 's', key: 'k', fetch: fetchFn as unknown as typeof fetch });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).max_tokens).toBe(CLAUDE_MAX_TOKENS);
    expect(r.usage).toEqual({ input: 1000, output: 300, cached: 100 });
  });

  // 2. Same key + an earlier pass → carried over, with the commit it was read on.
  it('carries an approve or zero-findings verdict over to a head with the same diff, model and rules', () => {
    const second = carryOver({ reviews: [posted('aaa', { key: K1 })], keys: [K1], headSha: 'bbb' });
    expect(second).toMatchObject({ from: 'aaa', onHead: false, parsed: { verdict: 'approve', pass: true, key: K1 } });
    const lens = carryOver({ reviews: [posted('aaa', { focus: 'saves', findings: '0', key: K1 })], focus: 'saves', keys: [K1], headSha: 'bbb' });
    expect(lens).toMatchObject({ from: 'aaa', parsed: { findings: 0 } });
    // A carry-over of a carry-over still names the commit the verdict was read on.
    const again = { commit_id: 'bbb', user: bot, state: 'COMMENTED', submitted_at: at(), body: reviewBody({ usedModel: 'or-model', verdict: 'approve', key: K1, carried: { from: 'aaa', url: 'u' } }) };
    expect(carryOver({ reviews: [posted('aaa', { key: K1 }), again], keys: [K1], headSha: 'ccc' })?.from).toBe('aaa');
    // Already on this head: nothing to post.
    expect(carryOver({ reviews: [posted('aaa', { key: K1 })], keys: [K1], headSha: 'aaa' })?.onHead).toBe(true);
  });

  // 3. A changed diff always gets a fresh review.
  it('pays for a fresh review when the diff changed', () => {
    expect(K2).not.toBe(K1);
    expect(carryOver({ reviews: [posted('aaa', { key: K1 })], keys: [K2], headSha: 'bbb' })).toBeNull();
    // An older review with no key in its marker (before #1654) is never carried.
    const old = { commit_id: 'aaa', user: bot, state: 'COMMENTED', submitted_at: at(), body: '## Second opinion (m)\n<!-- second-opinion verdict=approve -->' };
    expect(carryOver({ reviews: [old], keys: [K1], headSha: 'bbb' })).toBeNull();
    // The key covers the whole diff: one byte more is a different diff.
    expect(key({ diff: 'a\n' })).not.toBe(key({ diff: 'a\n\n' }));
    expect(K1).toMatch(/^[0-9a-f]{16}$/);
  });

  // 3b. Same diff, but another model or other review rules (the lens file, review.md…) → fresh.
  it('pays for a fresh review when the model or the review instructions changed', () => {
    const reviews = [posted('aaa', { key: K1 }), posted('aaa', { focus: 'saves', findings: '0', key: K1 })];
    const otherModel = key({ model: 'another-model' });
    const otherRules = key({ instructions: `${RULES}\n- a new rule` });
    for (const k of [otherModel, otherRules]) {
      expect(k).not.toBe(K1);
      expect(carryOver({ reviews, keys: [k], headSha: 'bbb' })).toBeNull();
      expect(carryOver({ reviews, focus: 'saves', keys: [k], headSha: 'bbb' })).toBeNull();
    }
    // The parts are kept apart: moving bytes from the diff into the model is a different key.
    expect(reviewKey({ diff: 'ab', model: 'c', instructions: 'd' })).not.toBe(reviewKey({ diff: 'a', model: 'bc', instructions: 'd' }));
  });

  // 4. A request-changes or a finding is never carried over as a pass — not even under a later approve of the same key.
  it('never carries a request-changes or a finding', () => {
    expect(carryOver({ reviews: [posted('aaa', { verdict: 'request-changes', key: K1 })], keys: [K1], headSha: 'bbb' })).toBeNull();
    expect(carryOver({ reviews: [posted('aaa', { focus: 'saves', findings: '2', key: K1 })], focus: 'saves', keys: [K1], headSha: 'bbb' })).toBeNull();
    const blockedThenApproved = [posted('aaa', { verdict: 'request-changes', key: K1 }), posted('aaa', { key: K1 })];
    expect(carryOver({ reviews: blockedThenApproved, keys: [K1], headSha: 'bbb' })).toBeNull();
    // An unclear or '?' review isn't a pass either.
    expect(carryOver({ reviews: [posted('aaa', { verdict: 'unclear', key: K1 })], keys: [K1], headSha: 'bbb' })).toBeNull();
    expect(carryOver({ reviews: [posted('aaa', { focus: 'saves', findings: '?', key: K1 })], focus: 'saves', keys: [K1], headSha: 'bbb' })).toBeNull();
  });

  // 5. A verdict only stands for its own kind: another lens, or the second opinion, never reuses it.
  it('reuses nothing across lenses or kinds, or from another author', () => {
    const reviews = [posted('aaa', { focus: 'saves', findings: '0', key: K1 })];
    expect(carryOver({ reviews, focus: 'determinism', keys: [K1], headSha: 'bbb' })).toBeNull();
    expect(carryOver({ reviews, keys: [K1], headSha: 'bbb' })).toBeNull();
    expect(carryOver({ reviews: [posted('aaa', { key: K1 })], focus: 'saves', keys: [K1], headSha: 'bbb' })).toBeNull();
    const someoneElse = { ...posted('aaa', { key: K1 }), user: { login: 'mallory' } };
    expect(carryOver({ reviews: [someoneElse], keys: [K1], headSha: 'bbb' })).toBeNull();
  });

  // 6. A weak (fallback) review is keyed on the fallback model, and carries over only as weak.
  it('keeps a weak review weak when it carries over', () => {
    const primary = key();
    const fallback = key({ model: 'fallback-model' });
    const weak = posted('aaa', { key: fallback, weak: 'OpenRouter failed: 402' });
    expect(carryOver({ reviews: [weak], keys: [primary], headSha: 'bbb' })).toBeNull();
    const c = carryOver({ reviews: [weak], keys: [primary, fallback], headSha: 'bbb' });
    expect(c?.parsed.weak).toBe('OpenRouter failed: 402');
    const body = reviewBody({ usedModel: c!.parsed.usedModel, verdict: c!.parsed.verdict, weak: c!.parsed.weak, key: c!.parsed.key, carried: { from: c!.from, url: 'u' } });
    expect(body).toMatch(/<!-- weak-review reason=OpenRouter failed: 402 -->/);
    expect(body.split('\n')[0]).toBe('## Second opinion (or-model, fallback, carried over)');
  });

  // 7. The gate accepts a carried-over verdict pinned to the head, and only there.
  it('counts a carried-over verdict on the head commit at the merge gate', () => {
    const carried = (focus?: string) => ({
      commit_id: 'bbb', user: bot, state: 'COMMENTED', submitted_at: at(),
      body: reviewBody({ focus, usedModel: 'or-model', verdict: focus ? '0 finding(s)' : 'approve', findings: focus ? '0' : undefined, key: K1, carried: { from: 'aaa', url: 'u' } }),
    });
    const agent = { commit_id: 'bbb', user: bot, state: 'APPROVED', submitted_at: at(), body: 'LGTM' };
    const reviews = tierReviews([carried(), carried('saves'), agent], 'bbb');
    expect(reviews).toMatchObject({ agent: 'approved', second: 'approve', focused: { saves: 0 } });
    expect(mergeGate({ tier: 'high', ciOk: true, lenses: ['saves'], reviews }).merge).toBe(true);
    // The same carry-over doesn't count for any other commit.
    expect(tierReviews([carried(), carried('saves')], 'ccc')).toEqual({ agent: null, second: null, focused: {} });
    // A fresh body with the key in its marker reads the same at the gate.
    expect(tierReviews([posted('bbb', { verdict: 'request-changes', key: K1 })], 'bbb').second).toBe('request-changes');
  });

  // 8. Tokens and cost, when the provider sends them, in the footer; a carry-over says it made no call.
  it('shows tokens and cost in the review footer', () => {
    const u = openRouterUsage({ prompt_tokens: 12340, completion_tokens: 2100, cost: 0.0412, prompt_tokens_details: { cached_tokens: 8000 } });
    expect(u).toEqual({ input: 12340, output: 2100, cached: 8000, cost: 0.0412 });
    expect(usageLine(u)).toBe('Tokens: in 12,340 (8,000 cached) / out 2,100 · cost $0.0412');
    expect(usageLine(claudeUsage({ input_tokens: 10, output_tokens: 5 }))).toBe('Tokens: in 10 / out 5');
    expect(usageLine(openRouterUsage(undefined))).toBe('Tokens: not reported');
    expect(reviewBody({ usedModel: 'm', verdict: 'approve', text: 't', key: K1, usage: u })).toContain('_Tokens: in 12,340 (8,000 cached) / out 2,100 · cost $0.0412_');
    const carried = reviewBody({ usedModel: 'm', verdict: 'approve', key: K1, carried: { from: 'aaa1234567', url: 'u' } });
    expect(carried).not.toMatch(/Tokens:/);
    expect(carried).toMatch(/Carried over from \[the review of commit aaa1234\]\(u\).*no paid call/);
    expect(parseReview(carried)).toMatchObject({ key: K1, from: 'aaa1234567', pass: true });
  });
});
