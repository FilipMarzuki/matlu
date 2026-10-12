// Who writes a paid review (#1509): OpenRouter first; on any failure there, or with no OpenRouter
// key, Claude on the owner's Anthropic key. The owner's rule: a credit problem never stops a merge.
//
// A Claude review is *weak*: the second opinion is meant to come from another model family than
// the review agent (Claude). So a fallback review keeps the merge gate's heading and marker (it
// counts), says it's weak under them, and the script labels the PR `weak-review`, so those PRs
// can be found later (`is:pr label:weak-review`) and revisited.
//
// Plain fetch, like the OpenRouter call beside it: the review jobs run the base branch's scripts
// with no `npm ci`, so there's no SDK to import here.

import { claudeUsage, usageLine } from './review-cost.mjs';

export const FALLBACK_MODEL = 'claude-sonnet-5-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
/**
 * Room for adaptive thinking plus a review's few hundred words; at medium effort it stays well
 * inside it. Like OpenRouter's cap (review-cost.mjs), it also bounds what one review can cost (#1654).
 */
export const CLAUDE_MAX_TOKENS = 12_000;

/** One line of why, short and safe inside an HTML comment or a sentence. */
const short = (s) => String(s).replace(/\s+/g, ' ').replace(/-->|<|>/g, ' ').slice(0, 160).trim();

/**
 * Review with OpenRouter, or Claude when OpenRouter can't (#1509). `openRouter` and `claude` are
 * thunks returning `{ text, usedModel }`. Returns that plus `weak` (null, or why it fell back), or
 * null when there's nothing to review with (no keys: the script skips, as before).
 */
export async function reviewWithFallback({ openRouter, claude, hasOpenRouter, hasClaude, log = console.log }) {
  if (hasOpenRouter) {
    try {
      return { ...(await openRouter()), weak: null };
    } catch (err) {
      if (!hasClaude) throw err;
      const weak = `OpenRouter failed: ${short(err?.message ?? err)}`;
      log(`⚠ ${weak} — falling back to a Claude review (weak).`);
      return { ...(await claude()), weak };
    }
  }
  if (!hasClaude) return null;
  log('⚠ No OpenRouter key — reviewing with Claude (weak).');
  return { ...(await claude()), weak: 'no OpenRouter key' };
}

/** A review from Claude through the Messages API: its text blocks (thinking left out) and its token usage (#1654). */
export async function claudeReview({ prompt, system, model = FALLBACK_MODEL, key, fetch: f = fetch }) {
  const res = await f(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: CLAUDE_MAX_TOKENS,
      // Adaptive thinking is on by default on current models; medium effort keeps a review quick and cheap.
      output_config: { effort: 'medium' },
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic → ${res.status}: ${short(await res.text())}`);
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error('Claude declined the review');
  const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text) throw new Error(`Claude returned no text (stop_reason ${data.stop_reason})`);
  return { text, usedModel: data.model || model, usage: claudeUsage(data.usage) };
}

/**
 * The review's body. Line 1 is the header and line 2 the marker: the merge gate reads exactly
 * those (risk-score.mjs tierReviews), so a weak review counts. The warning goes below them.
 *
 * #1654: `key` is the review's reviewKey (the PR diff, the model asked and the instructions); it
 * goes in the marker so a later head with the same key can carry the verdict over. `carried`
 * ({ from, url }) makes the body that carry-over: the verdict of the review at `url`, first read on
 * commit `from`, re-posted with no paid call (a weak one stays weak). `usage` is a paid call's
 * tokens and cost, for the footer.
 */
export function reviewBody({ focus, usedModel, verdict, findings = '?', text = '', weak = null, key = null, usage, carried = null }) {
  const tag = key ? ` key=${key}` : '';
  const marker = focus ? `<!-- focused lens=${focus} findings=${findings}${tag} -->` : `<!-- second-opinion verdict=${verdict}${tag} -->`;
  const gates = focus
    ? 'any finding holds the merge (risk:high) until a new commit, which is reviewed again'
    : 'anything but approve holds the merge (risk:medium and high) until a new commit, which is reviewed again';
  const who = `${usedModel}${weak ? ', fallback' : ''}${carried ? ', carried over' : ''}`;
  const main = carried
    ? `Carried over from [the review of commit ${carried.from.slice(0, 7)}](${carried.url}): this commit's PR diff is byte-identical to the one that review read, for the same model and review instructions (key \`${key}\`), so no paid call was made. A change to any of them gets a fresh review.`
    : text.trim();
  return [
    focus ? `## Focused review — ${focus} (${who})` : `## Second opinion (${who})`,
    marker,
    ...(carried ? [`<!-- carried-over from=${carried.from} -->`] : []),
    ...(weak ? [
      `<!-- weak-review reason=${short(weak)} -->`,
      '',
      `> ⚠ **Weak review:** ${short(weak)}, so Claude reviewed instead of another model family. It counts for the merge, and the PR is labelled \`weak-review\` to revisit.`,
    ] : []),
    '',
    `_${focus ? 'Result' : 'Verdict'}: **${verdict}** — ${gates}._`,
    '',
    main,
    '',
    '---',
    // What the review cost (#1654); a carry-over made no call, and says so above.
    ...(carried ? [] : [`_${usageLine(usage)}_`, '']),
    '_Generated by [Claude Code](https://claude.ai/code)_',
  ].join('\n');
}
