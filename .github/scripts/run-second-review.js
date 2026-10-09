#!/usr/bin/env node
// Second-opinion PR review via OpenRouter (DevCycle 3b).
//
// Fetches the PR + diff from GitHub, sends .agents/review.md (the same rules
// the Claude reviewer uses) plus the second-opinion delivery override to an
// OpenRouter model, and posts the answer as a COMMENT review. GitHub's review
// state stays the review agent's, but the verdict gates the merge (#1481): the
// merge gate in risk-score.mjs reads the hidden marker this writes, and on a
// risk:medium or high PR anything but approve holds it.
//
// With --focus <lens> it is a focused review instead (#1431): the prompt is
// .agents/review-lenses/<lens>.md plus the findings shape in _shape.md, not the
// general rules. The risk workflow runs one per lens on high-risk PRs; any
// finding holds the merge.
//
// Usage:
//   node .github/scripts/run-second-review.js --pr 123 [--dry-run] [--model <id>] [--focus <lens>]
// Env:
//   GITHUB_TOKEN, GITHUB_REPOSITORY (owner/repo)    required
//   OPENROUTER_API_KEY                               required unless --dry-run
//   SECOND_REVIEW_MODEL                              optional (default below)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skipReason, contextSection, noRoom, admit } from './review-context.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_MODEL = 'google/gemini-2.5-pro';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** Keep the request well inside any model's context; past this the tail is cut. */
const DIFF_CAP_BYTES = 180_000;

// ── Args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true') : undefined;
};
const prNumber = Number(flag('pr'));
const dryRun = flag('dry-run') === 'true';
const model = flag('model') || process.env.SECOND_REVIEW_MODEL || DEFAULT_MODEL;
const focus = flag('focus');

if (!prNumber) { console.error('Usage: run-second-review.js --pr <number> [--dry-run] [--model <id>] [--focus <lens>]'); process.exit(2); }
// The lens names a file, so keep it to a plain name (no paths).
if (focus && !/^[a-z][a-z0-9-]*$/.test(focus)) { console.error(`Bad --focus: ${focus}`); process.exit(2); }

const repo = process.env.GITHUB_REPOSITORY;
const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const orKey = process.env.OPENROUTER_API_KEY;
if (!repo || !ghToken) { console.error('GITHUB_REPOSITORY and GITHUB_TOKEN are required'); process.exit(2); }

// Missing key is a configuration gap, not a failure: exit green so the
// workflow doesn't go red on forks or before the secret is set.
if (!orKey && !dryRun) {
  console.log('OPENROUTER_API_KEY is not set — skipping second-opinion review.');
  process.exit(0);
}

// ── GitHub ──────────────────────────────────────────────────────────────────
async function gh(pathname, { accept = 'application/vnd.github+json', method = 'GET', body } = {}) {
  const res = await fetch(`https://api.github.com/repos/${repo}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${pathname} → ${res.status}: ${await res.text()}`);
  return accept.includes('diff') || accept.includes('raw') ? res.text() : res.json();
}

/**
 * The PR's changed files for the prompt (#1483): each one's text at the head commit, or why it's
 * left out. A file that can't be fetched is named, not fatal: the review still has the diff.
 * Fetching stops once nothing more could go in (the same tally contextSection keeps).
 */
async function changedFiles(pr) {
  const files = [];
  for (let page = 1; page <= 30; page++) {
    const batch = await gh(`/pulls/${pr.number}/files?per_page=100&page=${page}`);
    files.push(...batch);
    if (batch.length < 100) break;
  }
  const entries = [];
  const acc = { count: 0, bytes: 0 };
  for (const f of files) {
    const skip = skipReason(f) ?? noRoom(acc);
    if (skip) { entries.push({ path: f.filename, skip }); continue; }
    const at = f.filename.split('/').map(encodeURIComponent).join('/');
    try {
      const text = await gh(`/contents/${at}?ref=${pr.head.sha}`, { accept: 'application/vnd.github.raw' });
      admit(acc, Buffer.byteLength(text, 'utf8'));
      entries.push({ path: f.filename, text });
    } catch (err) {
      entries.push({ path: f.filename, skip: `couldn't be fetched (${String(err.message).slice(0, 80)})` });
    }
  }
  return entries;
}

// ── Prompt ──────────────────────────────────────────────────────────────────
function buildPrompt(pr, diff, files = []) {
  const root = path.resolve(__dirname, '..', '..');
  const read = (...p) => fs.readFileSync(path.join(root, '.agents', ...p), 'utf8');
  // A focused review gets its lens and the findings shape; the second opinion
  // gets the general review rules and its delivery override.
  const rules = focus
    ? read('review-lenses', `${focus}.md`)
    : read('review.md').replace(/\{\{pr_number\}\}/g, String(pr.number));
  const override = focus ? read('review-lenses', '_shape.md') : read('review-second-opinion.md');

  let diffText = diff;
  if (Buffer.byteLength(diffText, 'utf8') > DIFF_CAP_BYTES) {
    diffText = Buffer.from(diffText, 'utf8').subarray(0, DIFF_CAP_BYTES).toString('utf8')
      + `\n\n[diff truncated at ${DIFF_CAP_BYTES} bytes]`;
  }

  return [
    rules,
    '\n---\n',
    override,
    '\n---\n',
    `# PR #${pr.number}: ${pr.title}`,
    `Author: ${pr.user?.login ?? 'unknown'} · Base: ${pr.base?.ref} · Head: ${pr.head?.ref}`,
    '',
    '## PR body',
    '',
    pr.body || '(empty)',
    '',
    '## Unified diff',
    '',
    '```diff',
    diffText,
    '```',
    '',
    contextSection(pr.head.sha, files),
  ].join('\n');
}

// ── OpenRouter ──────────────────────────────────────────────────────────────
async function review(prompt) {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${orKey}`,
      'Content-Type': 'application/json',
      // OpenRouter attribution headers (optional, shown in their dashboard).
      'HTTP-Referer': `https://github.com/${repo}`,
      'X-Title': `${repo} ${focus ? `focused review (${focus})` : 'second-opinion review'}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You are a careful senior reviewer for a Phaser 3 + TypeScript game repository. Follow the review rules and the response shape exactly.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter → ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`OpenRouter returned no content: ${JSON.stringify(data).slice(0, 500)}`);
  return { text, usedModel: data.model || model };
}

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  const pr = await gh(`/pulls/${prNumber}`);
  const diff = await gh(`/pulls/${prNumber}`, { accept: 'application/vnd.github.diff' });
  const prompt = buildPrompt(pr, diff, await changedFiles(pr));

  if (dryRun) {
    console.log(`--- dry run: model=${model}, prompt ${prompt.length} chars ---\n`);
    console.log(prompt);
    return;
  }

  const { text, usedModel } = await review(prompt);
  const findings = /FINDINGS:\s*(\d+)/i.exec(text)?.[1] ?? '?';
  const verdict = focus
    ? `${findings} finding(s)`
    : /VERDICT:\s*(approve|request-changes)/i.exec(text)?.[1]?.toLowerCase() ?? 'unclear';

  // The merge gate reads these (#1481): the tier's models must agree before DevCycle 4 merges.
  const marker = focus ? `<!-- focused lens=${focus} findings=${findings} -->` : `<!-- second-opinion verdict=${verdict} -->`;
  const gates = focus
    ? 'any finding holds the merge (risk:high) until a new commit, which is reviewed again'
    : 'anything but approve holds the merge (risk:medium and high) until a new commit, which is reviewed again';
  const body = [
    focus ? `## Focused review — ${focus} (${usedModel})` : `## Second opinion (${usedModel})`,
    marker,
    '',
    `_${focus ? 'Result' : 'Verdict'}: **${verdict}** — ${gates}._`,
    '',
    text.trim(),
    '',
    '---',
    '_Generated by [Claude Code](https://claude.ai/code)_',
  ].join('\n');

  // COMMENT, never APPROVE / REQUEST_CHANGES: GitHub's review state stays the
  // review agent's; the merge gate (risk-score.mjs, #1481) reads this body's marker.
  // Pinned to the commit whose diff the model read (#1481): posted unpinned, GitHub stamps the
  // review on whatever the head is by now, and the gate would count it for a newer commit.
  await gh(`/pulls/${prNumber}/reviews`, { method: 'POST', body: { event: 'COMMENT', body, commit_id: pr.head.sha } });
  console.log(`Posted ${focus ? `focused (${focus})` : 'second-opinion'} review on #${prNumber} (${usedModel}, ${verdict}).`);
})().catch((err) => { console.error(err); process.exit(1); });
