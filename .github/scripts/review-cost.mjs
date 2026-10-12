// What a paid review costs, and how to pay for fewer of them (#1654). The owner's rule: prefer
// price-effectiveness over speed, as long as the quality stays similar.
//
// - A capped request: OpenRouter reserves a request's whole possible output against the balance
//   before it runs, so with no `max_tokens` a 65k-output model needs credit for 65k tokens and a
//   low balance gets a 402 although the review would cost cents (#1651).
// - Usage: tokens and cost per review, in the run log and the body's footer, so a saving can be
//   checked and models compared before anyone switches one.
// - Carry-over: a new head commit whose PR diff is byte-identical to the one an earlier passing
//   review read (merging main, say), asked of the same model with the same instructions, gets that
//   verdict re-posted on the new head, with no paid call.
//
// Pure functions, so the tests can pin them; run-second-review.js does the fetching and posting.

import { createHash } from 'node:crypto';
import { REVIEW_BOT } from './risk-score.mjs';

/**
 * The OpenRouter output cap: room for a reasoning model's thinking plus a review of a few hundred
 * words. Without one, OpenRouter reserves the model's full output (65,536 tokens) against the
 * balance, which 402'd on #1651 with credit left. A review that runs out of room fails loudly and
 * falls back to Claude, rather than posting half a verdict.
 */
export const OPENROUTER_MAX_TOKENS = 16_000;

/**
 * The OpenRouter request body. The system message and the prompt's instructions are fixed and come
 * first, the PR's own text last, so a provider's prompt cache can reuse the shared prefix.
 * `usage.include` asks OpenRouter for tokens and cost in the answer.
 */
export function openRouterBody({ model, system, prompt }) {
  return {
    model,
    temperature: 0.2,
    max_tokens: OPENROUTER_MAX_TOKENS,
    usage: { include: true },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
  };
}

/** OpenRouter's `usage` as { input, output, cached?, cost? }; undefined when it sent none. */
export function openRouterUsage(u) {
  if (!u || typeof u.prompt_tokens !== 'number') return undefined;
  return {
    input: u.prompt_tokens,
    output: u.completion_tokens ?? 0,
    ...(u.prompt_tokens_details?.cached_tokens ? { cached: u.prompt_tokens_details.cached_tokens } : {}),
    ...(typeof u.cost === 'number' ? { cost: u.cost } : {}),
  };
}

/**
 * The Messages API's `usage` in the same shape; undefined when it sent none. No cost: the API
 * doesn't return one, and a price table kept here would go stale without anyone noticing.
 */
export function claudeUsage(u) {
  if (!u || typeof u.input_tokens !== 'number') return undefined;
  const cached = u.cache_read_input_tokens ?? 0;
  return {
    // Cached and cache-written tokens are billed apart from input_tokens; count them as input.
    input: u.input_tokens + cached + (u.cache_creation_input_tokens ?? 0),
    output: u.output_tokens ?? 0,
    ...(cached ? { cached } : {}),
  };
}

/** One line for the log and the body's footer, e.g. `Tokens: in 12,340 / out 2,100 · cost $0.0412`. */
export function usageLine(usage) {
  if (!usage) return 'Tokens: not reported';
  const n = (x) => x.toLocaleString('en-US');
  return [
    `Tokens: in ${n(usage.input)}${usage.cached ? ` (${n(usage.cached)} cached)` : ''} / out ${n(usage.output)}`,
    ...(typeof usage.cost === 'number' ? [`cost $${usage.cost.toFixed(4)}`] : []),
  ].join(' · ');
}

/**
 * The carry-over key: the first 16 hex characters of a SHA-256 over everything that decides a
 * verdict's quality, so a verdict only stands for the same question asked of the same reviewer.
 * - `diff`: the whole diff GitHub serves for the PR (merge base → head, what the review reads),
 *   before any truncation for the prompt. Merging main that doesn't touch the PR's files leaves it
 *   byte-identical, index lines included; anything that changes what the PR changes, or the base of
 *   a file it touches, changes it.
 * - `model`: the model id asked for (not the one a provider says it served): a new model, or the
 *   fallback instead of the primary, is a new review.
 * - `instructions`: the system prompt and the rules files the prompt opens with (review.md and its
 *   second-opinion override, or the lens and its shape), as filled in for this PR.
 * The PR's title and body are left out: editing the description doesn't change the code reviewed.
 * Each part is length-prefixed, so no two different inputs run together into the same bytes.
 */
export function reviewKey({ diff, model, instructions }) {
  const h = createHash('sha256');
  for (const part of [diff, model, instructions]) h.update(`${Buffer.byteLength(part, 'utf8')}:`).update(part, 'utf8');
  return h.digest('hex').slice(0, 16);
}

/**
 * Read one of run-second-review.js's own review bodies (pure): which review it is, its result, the
 * key it was read under (reviewKey) and whether it was weak or itself carried over. Null for
 * anything else. Only lines 1 and 2 decide what it is, as at the merge gate (risk-score.mjs tierReviews).
 */
export function parseReview(body = '') {
  const so = /^## Second opinion \(([^)\n]*)\)\n<!-- second-opinion verdict=(approve|request-changes|unclear)(?: key=([0-9a-f]+))? -->/.exec(body);
  const fo = so ? null : /^## Focused review — ([a-z][a-z0-9-]*) \(([^)\n]*)\)\n<!-- focused lens=\1 findings=(\d+|\?)(?: key=([0-9a-f]+))? -->/.exec(body);
  if (!so && !fo) return null;
  const who = (so ? so[1] : fo[2]).split(', ')[0];
  const weak = /^<!-- weak-review reason=(.*?) -->$/m.exec(body)?.[1] ?? null;
  const from = /^<!-- carried-over from=([0-9a-f]+) -->$/m.exec(body)?.[1] ?? null;
  if (so) {
    const verdict = so[2];
    return { focus: null, verdict, findings: null, key: so[3] ?? null, usedModel: who, weak, from,
      pass: verdict === 'approve', blocks: verdict === 'request-changes' };
  }
  const findings = fo[3] === '?' ? null : Number(fo[3]);
  return { focus: fo[1], verdict: `${fo[3]} finding(s)`, findings, key: fo[4] ?? null, usedModel: who, weak, from,
    pass: findings === 0, blocks: findings !== null && findings > 0 };
}

/**
 * May an earlier verdict stand for this head instead of a paid review (pure, #1654)? `reviews` is
 * the PR's reviews from the GitHub API, `focus` the lens (null for the second opinion), `keys` this
 * head's reviewKeys: the primary model's, and the fallback's (a weak review is keyed on the model
 * that wrote it, and carries over only as weak). Only our own reviews of the same kind count (a lens
 * never stands in for another, nor for the second opinion). It carries over when the latest such
 * review passed (approve, or 0 findings) under one of `keys`, and no review under those keys ever
 * blocked (request-changes, or a finding): a block is never washed out by re-running. An unclear
 * or '?' review in between doesn't stop it, as a re-run may replace those at the gate too.
 *
 * Returns null (pay for a fresh review) or { review, parsed, from, onHead }: `from` is the commit
 * the verdict was first read on (through any earlier carry-overs), `onHead` that the review is
 * already pinned to `headSha`, so there's nothing to post.
 */
export function carryOver({ reviews, focus = null, keys, headSha, bot = REVIEW_BOT }) {
  const ok = new Set((keys ?? []).filter(Boolean));
  if (!ok.size) return null;
  const mine = [...reviews]
    .filter((r) => r.user?.login === bot && r.commit_id)
    .map((r) => ({ r, p: parseReview(r.body ?? '') }))
    .filter(({ p }) => p && p.focus === (focus ?? null))
    .sort((a, b) => Date.parse(a.r.submitted_at ?? 0) - Date.parse(b.r.submitted_at ?? 0));
  if (!mine.length) return null;
  if (mine.some(({ p }) => ok.has(p.key) && p.blocks)) return null;
  const { r, p } = mine[mine.length - 1];
  if (!ok.has(p.key) || !p.pass) return null;
  return { review: r, parsed: p, from: p.from ?? r.commit_id, onHead: r.commit_id === headSha };
}
