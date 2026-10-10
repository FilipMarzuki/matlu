/**
 * Acceptance tests for #1509 — when a paid review can't run on OpenRouter (out of credit, down),
 * Claude reviews instead, so a credit problem never stops a merge. Every such review is marked
 * weak, warned about and labelled, so those PRs can be revisited.
 */

import { describe, it, expect, vi } from 'vitest';
import { reviewWithFallback, claudeReview, reviewBody } from '../.github/scripts/review-fallback.mjs';
import { tierReviews, REVIEW_BOT } from '../.github/scripts/risk-score.mjs';

const ok = (text: string, model = 'or-model') => async () => ({ text, usedModel: model });
const fails = (msg: string) => async () => { throw new Error(msg); };

describe('Claude fallback for paid reviews (#1509)', () => {
  // 1. OpenRouter fails, an Anthropic key is there: Claude reviews, marked weak with the reason.
  it('falls back to Claude when OpenRouter fails, and marks it weak', async () => {
    const claude = vi.fn(ok('VERDICT: approve', 'claude-sonnet-5-5'));
    const r = await reviewWithFallback({ openRouter: fails('OpenRouter → 402: {"error":{"message":"Insufficient credits"}}'), claude, hasOpenRouter: true, hasClaude: true });
    expect(claude).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ text: 'VERDICT: approve', usedModel: 'claude-sonnet-5-5' });
    expect(r?.weak).toMatch(/OpenRouter/);
    expect(r?.weak).toMatch(/402/);
  });

  // 2. OpenRouter works: Claude isn't asked, and nothing is weak.
  it('uses OpenRouter when it works', async () => {
    const claude = vi.fn(ok('VERDICT: approve', 'claude-sonnet-5-5'));
    const r = await reviewWithFallback({ openRouter: ok('VERDICT: approve', 'google/gemini-2.5-pro'), claude, hasOpenRouter: true, hasClaude: true });
    expect(claude).not.toHaveBeenCalled();
    expect(r).toEqual({ text: 'VERDICT: approve', usedModel: 'google/gemini-2.5-pro', weak: null });
  });

  // 3. No OpenRouter key, an Anthropic key: Claude reviews, weak for that reason. No keys at all: skip, as before.
  it('reviews with Claude when there is no OpenRouter key, and skips with neither', async () => {
    const r = await reviewWithFallback({ openRouter: fails('unused'), claude: ok('FINDINGS: 0', 'claude-sonnet-5-5'), hasOpenRouter: false, hasClaude: true });
    expect(r?.weak).toBe('no OpenRouter key');
    expect(await reviewWithFallback({ openRouter: fails('x'), claude: fails('y'), hasOpenRouter: false, hasClaude: false })).toBeNull();
    // OpenRouter fails and there's no fallback: the failure stands, as today.
    await expect(reviewWithFallback({ openRouter: fails('OpenRouter → 500'), claude: fails('unused'), hasOpenRouter: true, hasClaude: false })).rejects.toThrow(/500/);
  });

  // 4. A weak review still counts at the gate, and says it's weak.
  it('builds a weak review the merge gate still reads, with the warning', () => {
    const second = reviewBody({ usedModel: 'claude-sonnet-5-5', verdict: 'approve', text: 'VERDICT: approve\n- fine', weak: 'OpenRouter failed: 402' });
    const lens = reviewBody({ focus: 'saves', usedModel: 'claude-sonnet-5-5', verdict: '0 finding(s)', findings: '0', text: 'FINDINGS: 0', weak: 'no OpenRouter key' });
    for (const body of [second, lens]) {
      expect(body).toMatch(/weak review/i);
      expect(body).toMatch(/<!-- weak-review reason=/);
    }
    const reviews = [second, lens].map((body, i) => ({ body, commit_id: 'abc', user: { login: REVIEW_BOT }, state: 'COMMENTED', submitted_at: `2026-10-10T09:0${i}:00Z` }));
    expect(tierReviews(reviews, 'abc')).toMatchObject({ second: 'approve', focused: { saves: 0 } });
    // A reason can't break out of its HTML comment.
    expect(reviewBody({ usedModel: 'm', verdict: 'approve', text: 't', weak: 'boom --> <script>' })).not.toMatch(/boom -->/);
  });

  // The Claude call itself: the Messages API, its text blocks, and a clear error otherwise.
  it('calls the Messages API and reads its text', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: 'VERDICT: approve' }] }), { status: 200 }));
    const r = await claudeReview({ prompt: 'p', system: 's', model: 'claude-sonnet-5-5', key: 'k', fetch: fetchFn as unknown as typeof fetch });
    expect(r).toEqual({ text: 'VERDICT: approve', usedModel: 'claude-sonnet-5-5' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
    const bad = vi.fn(async () => new Response('{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}', { status: 400 }));
    await expect(claudeReview({ prompt: 'p', system: 's', model: 'm', key: 'k', fetch: bad as unknown as typeof fetch })).rejects.toThrow(/400/);
  });
});
