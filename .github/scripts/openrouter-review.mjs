#!/usr/bin/env node
// OpenRouter/DeepSeek PR reviewer — the model half of DevCycle 3.
//
// Reads a PR's diff, asks a model (via OpenRouter) to review it against the
// same checklist as .agents/review.md, and either:
//   - SHADOW mode (default): posts an advisory *comment* with the verdict it
//     WOULD give. Does not submit a GitHub review, so it never affects the
//     DevCycle 4 — Merge gate. Safe to run alongside the existing Claude
//     reviewer for signal comparison.
//   - LIVE mode: submits a real GitHub review (APPROVE / REQUEST_CHANGES),
//     which is what DevCycle 4 checks before auto-merging.
//
// Env:
//   OPENROUTER_API_KEY   (required)
//   GH_TOKEN             (GitHub token, for the REST API)
//   GITHUB_REPOSITORY    owner/repo (provided by Actions)
//   PR_NUMBER            (required)
//   OPENROUTER_MODEL     default 'deepseek/deepseek-chat' (V3). 'deepseek/deepseek-r1' = deeper, slower.
//   REVIEW_MODE          'shadow' (default) | 'live'
//   DRY_RUN              '1' = build the request and print it, call nothing (local testing)
//   MAX_DIFF_CHARS       default 50000 — diffs larger than this are truncated with a note
//
// No dependencies: uses global fetch (Node 20+).

const {
  OPENROUTER_API_KEY,
  GH_TOKEN,
  GITHUB_REPOSITORY,
  PR_NUMBER,
  OPENROUTER_MODEL = 'deepseek/deepseek-chat',
  REVIEW_MODE = 'shadow',
  DRY_RUN = '',
  MAX_DIFF_CHARS = '50000',
} = process.env;

const DRY = DRY_RUN === '1' || DRY_RUN === 'true';
const LIVE = REVIEW_MODE === 'live';
const maxDiff = parseInt(MAX_DIFF_CHARS, 10) || 50000;

function fail(msg) { console.error(`openrouter-review: ${msg}`); process.exit(DRY ? 1 : 0); } // never break the pipeline in CI

if (!PR_NUMBER) fail('PR_NUMBER not set — nothing to review.');
if (!DRY && !OPENROUTER_API_KEY) fail('OPENROUTER_API_KEY not set.');
const [owner, repo] = (GITHUB_REPOSITORY || 'FilipMarzuki/matlu').split('/');

// ── GitHub REST helpers ──────────────────────────────────────────────────────
const GH = 'https://api.github.com';
async function gh(path, { method = 'GET', accept = 'application/vnd.github+json', body } = {}) {
  const res = await fetch(`${GH}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return accept.includes('diff') ? res.text() : res.json();
}

// ── The review prompt — mirrors .agents/review.md ────────────────────────────
const SYSTEM_PROMPT = `You are a senior engineer reviewing a single pull request for "Matlu", a Phaser 3 + TypeScript (strict) game. CI has already passed. Review the DIFF only; be concise and decisive.

Verdict rules:
- "request_changes" ONLY if a MUST-PASS criterion is clearly violated:
  * Correctness — the code does not do what the PR says, or is logically wrong.
  * Regression — it breaks existing functionality.
  * Security — hardcoded secrets, injection/XSS vectors.
  * Type safety — \`any\` casts that bypass types, ignored/suppressed errors.
  * Scope — changes clearly unrelated to the PR's stated purpose.
- Otherwise "approve". When uncertain, APPROVE with a note. Only security issues justify blocking on suspicion; for everything else prefer approve-with-comment over blocking. (False blocks stall good work.)

Also SURFACE (never block on these):
- Naming, leftover dead code / unused imports, and missing brief explanatory comments on non-obvious game-dev patterns (the author is learning).
- High-risk files touched — set high_risk_note if the diff changes any of: .github/workflows/, CLAUDE.md, vite.config.ts, tsconfig.json, package.json (dependency changes; script-only edits are fine). The note should say a human should glance at it.
Do NOT comment on code style/formatting (tooling handles it) or test coverage (no test framework).

Respond with ONLY a JSON object, no prose, no markdown fences:
{
  "verdict": "approve" | "request_changes",
  "summary": "one or two sentences on what you checked and concluded",
  "findings": [ { "severity": "blocker" | "note", "file": "path", "line": <number|null>, "title": "short", "detail": "what and why" } ],
  "high_risk_note": "string or empty if none"
}
Keep findings high-signal: at most 6, most important first. severity "blocker" only for the MUST-PASS violations that drove a request_changes.`;

function buildUserMessage(pr, diff, truncated) {
  return `PR #${pr.number}: ${pr.title}
Branch: ${pr.head?.ref} → ${pr.base?.ref}
+${pr.additions} / -${pr.deletions} across ${pr.changed_files} files

Description:
${(pr.body || '(no description)').slice(0, 2000)}

Unified diff${truncated ? ' (TRUNCATED — too large; review what is shown and note the truncation)' : ''}:
\`\`\`diff
${diff}
\`\`\``;
}

// ── OpenRouter call ──────────────────────────────────────────────────────────
async function callModel(messages) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': `https://github.com/${owner}/${repo}`,
      'X-Title': 'Matlu PR Review',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature: 0.1,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
      messages,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

function parseVerdict(raw) {
  let txt = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  // R1 and friends sometimes prepend reasoning — grab the first {...} block.
  const start = txt.indexOf('{'), end = txt.lastIndexOf('}');
  if (start >= 0 && end > start) txt = txt.slice(start, end + 1);
  try {
    const v = JSON.parse(txt);
    if (v.verdict !== 'approve' && v.verdict !== 'request_changes') v.verdict = 'approve';
    v.findings = Array.isArray(v.findings) ? v.findings.slice(0, 6) : [];
    return v;
  } catch {
    // Couldn't parse — fail safe to a non-blocking comment.
    return { verdict: 'approve', summary: String(raw).slice(0, 500), findings: [], high_risk_note: '', _unparsed: true };
  }
}

// ── Render the comment / review body ─────────────────────────────────────────
function render(v, meta) {
  const icon = v.verdict === 'request_changes' ? '🔴 Request changes' : '🟢 Approve';
  const lines = [];
  lines.push(`**Verdict:** ${icon}`, '', v.summary || '');
  if (v.findings?.length) {
    lines.push('', '**Findings**');
    for (const f of v.findings) {
      const where = f.file ? ` \`${f.file}${f.line ? ':' + f.line : ''}\`` : '';
      const sev = f.severity === 'blocker' ? '⛔' : '·';
      lines.push(`- ${sev}${where} **${f.title || 'note'}** — ${f.detail || ''}`);
    }
  }
  if (v.high_risk_note) lines.push('', `⚠️ ${v.high_risk_note}`);
  if (v._unparsed) lines.push('', '_(model output was not valid JSON — shown verbatim above; defaulted to non-blocking.)_');
  lines.push('', `<sub>🤖 ${meta.model} via OpenRouter · ${meta.mode === 'live' ? 'DevCycle 3 — Review' : 'SHADOW — advisory only, does not gate merge'}</sub>`);
  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    const pr = DRY
      ? { number: +PR_NUMBER, title: '(dry-run)', body: 'dry run', additions: 0, deletions: 0, changed_files: 0, draft: false, head: { ref: 'x' }, base: { ref: 'main' } }
      : await gh(`/repos/${owner}/${repo}/pulls/${PR_NUMBER}`);

    if (pr.draft) { console.log('PR is a draft — skipping review.'); return; }

    let diff = DRY ? 'diff --git a/x b/x\n+// dry run' : await gh(`/repos/${owner}/${repo}/pulls/${PR_NUMBER}`, { accept: 'application/vnd.github.v3.diff' });
    const truncated = diff.length > maxDiff;
    if (truncated) diff = diff.slice(0, maxDiff) + '\n… [diff truncated] …';

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(pr, diff, truncated) },
    ];

    if (DRY) {
      console.log('--- DRY RUN: model =', OPENROUTER_MODEL, '| mode =', REVIEW_MODE, '---');
      console.log(JSON.stringify(messages, null, 2).slice(0, 4000));
      return;
    }

    const raw = await callModel(messages);
    const verdict = parseVerdict(raw);
    const body = render(verdict, { model: OPENROUTER_MODEL, mode: REVIEW_MODE });
    console.log(`Verdict: ${verdict.verdict} (${verdict.findings.length} findings)`);

    if (LIVE) {
      // Real review — this is the merge gate. Posts as the token's identity
      // (must NOT be the PR author, or GitHub rejects the APPROVE).
      await gh(`/repos/${owner}/${repo}/pulls/${PR_NUMBER}/reviews`, {
        method: 'POST',
        body: { event: verdict.verdict === 'request_changes' ? 'REQUEST_CHANGES' : 'APPROVE', body },
      });
      console.log('Submitted GitHub review.');
    } else {
      // Shadow — advisory comment only, does not create a review state.
      await gh(`/repos/${owner}/${repo}/issues/${PR_NUMBER}/comments`, { method: 'POST', body: { body } });
      console.log('Posted shadow comment.');
    }
  } catch (err) {
    // Never break the pipeline — log and exit 0 (in CI). DRY surfaces the error.
    console.error('openrouter-review error:', err.message);
    process.exit(DRY ? 1 : 0);
  }
})();
