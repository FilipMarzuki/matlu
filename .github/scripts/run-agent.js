#!/usr/bin/env node
// Per-issue agent runner. Invoked by the GitHub Actions matrix in
// .github/workflows/agent-nightly.yml — one cell per GitHub issue.
//
// Responsibilities:
//   1. Fetch the GitHub issue (title + body).
//   2. Mark it as in-progress via an `agent:in-progress` label (best-effort).
//   3. Render the per-issue prompt from .agents/per-issue.md.
//   4. Spawn Claude Code in headless mode, scoped to exactly this issue.
//   5. Apply an `agent:<outcome>` label and post a summary comment on the issue.
//
// The goal of this script is orchestration only — all reasoning lives inside
// the Claude Code session itself. Keep this file boring.
//
// Usage:
//   GITHUB_TOKEN=… ANTHROPIC_API_KEY=… node run-agent.js 42

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const GITHUB_TOKEN             = process.env.GITHUB_TOKEN;
// Claude Code accepts either auth method. Prefer the subscription OAuth
// token (tied to a Pro/Max/Team-premium seat, no per-call API billing) and
// fall back to a pay-as-you-go API key if the OAuth secret is unset.
const CLAUDE_CODE_OAUTH_TOKEN  = process.env.CLAUDE_CODE_OAUTH_TOKEN;
const ANTHROPIC_API_KEY        = process.env.ANTHROPIC_API_KEY;
const REPO                     = 'FilipMarzuki/matlu';

const issueArg = process.argv[2];

if (!issueArg) {
  console.error('Usage: run-agent.js <ISSUE_NUMBER>');
  process.exit(1);
}
if (!GITHUB_TOKEN) {
  console.error('Missing GITHUB_TOKEN');
  process.exit(1);
}
if (!CLAUDE_CODE_OAUTH_TOKEN && !ANTHROPIC_API_KEY) {
  console.error('Missing CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY');
  process.exit(1);
}

const issueNumber = parseInt(issueArg, 10);
if (isNaN(issueNumber)) {
  console.error(`Invalid issue number: ${issueArg}`);
  process.exit(1);
}

// ── GitHub Issues REST API ────────────────────────────────────────────────────

async function githubRequest(method, path, body = null) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub API → ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchIssue(number) {
  return githubRequest('GET', `/issues/${number}`);
}

async function moveToInProgress(issue) {
  // GitHub Issues has no "state" concept equivalent to Linear's "In Progress"
  // — add `agent:in-progress` label so humans can see work has begun.
  // Best-effort: if the label doesn't exist in the repo this will fail with
  // 422; we log the error but continue rather than aborting the session.
  const currentLabels = issue.labels.map((l) => l.name);
  if (currentLabels.includes('agent:in-progress')) return;
  try {
    await githubRequest('POST', `/issues/${issue.number}/labels`, {
      labels: ['agent:in-progress'],
    });
  } catch (err) {
    console.warn(`[run-agent] Could not apply agent:in-progress label: ${err.message}`);
  }
}

async function applyOutcomeLabel(issue, outcome) {
  await githubRequest('POST', `/issues/${issue.number}/labels`, {
    labels: [`agent:${outcome}`],
  });
}

async function comment(issue, body) {
  await githubRequest('POST', `/issues/${issue.number}/comments`, { body });
}

// ── Prompt rendering ──────────────────────────────────────────────────────────

function renderPrompt(issue) {
  const template = readFileSync(
    join(__dirname, '..', '..', '.agents', 'per-issue.md'),
    'utf8'
  );
  // Use the plain GitHub issue number as the identifier (e.g. "42").
  // The template uses {{issue_id_lower}} for branch names — numbers have no
  // case so both replacements receive the same string.
  const issueId = String(issue.number);
  return template
    .replaceAll('{{issue_id}}', issueId)
    .replaceAll('{{issue_id_lower}}', issueId)
    .replaceAll('{{title}}', issue.title)
    .replaceAll('{{description}}', issue.body || '_(no description provided)_');
}

// ── Claude Code invocation ────────────────────────────────────────────────────

function runClaude(prompt) {
  // Headless (`--print`) runs Claude Code non-interactively and streams output
  // to stdout. We use `bypassPermissions` rather than `acceptEdits` because
  // `acceptEdits` only auto-approves file edits — git, npm, gh, and other
  // Bash calls still trigger a permission prompt that, in `--print` mode,
  // has nowhere to go. The agent then gives up without committing. In a
  // disposable CI runner this is the right trade-off: the sandbox is torn
  // down after the session regardless, so "the agent has full shell access"
  // costs us nothing extra.
  const result = spawnSync(
    'npx',
    [
      '--yes',
      '@anthropic-ai/claude-code',
      '--print',
      '--permission-mode',
      'bypassPermissions',
      prompt,
    ],
    {
      stdio: 'inherit',
      // Pass whichever credential(s) the workflow provided. Claude Code uses
      // CLAUDE_CODE_OAUTH_TOKEN when set (no API billing — charged against
      // the subscription quota) and otherwise falls back to ANTHROPIC_API_KEY.
      // All other env vars (including LINEAR_API_KEY if set) are forwarded so
      // the spawned session can reach Linear for its own wrap-up steps.
      env: {
        ...process.env,
        ...(CLAUDE_CODE_OAUTH_TOKEN ? { CLAUDE_CODE_OAUTH_TOKEN } : {}),
        ...(ANTHROPIC_API_KEY       ? { ANTHROPIC_API_KEY }       : {}),
      },
    }
  );
  return result.status === 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[run-agent] Starting session for issue #${issueNumber}`);
  let issue;

  // The bookkeeping stage can also fail (e.g. network blip, missing label).
  // If it crashes after we've fetched the issue, try to leave an `agent:failed`
  // breadcrumb so the operator sees it on the issue instead of silently on
  // the Actions tab.
  try {
    issue = await fetchIssue(issueNumber);
    await moveToInProgress(issue);
  } catch (err) {
    console.error(`[run-agent] Bookkeeping failed for #${issueNumber}: ${err.message}`);
    if (issue) {
      try {
        await applyOutcomeLabel(issue, 'failed');
        await comment(
          issue,
          `⚠️ Per-issue agent bookkeeping crashed before the Claude session started. See the GitHub Actions run logs for details.`
        );
      } catch (e) {
        console.error(`[run-agent] Could not post failure breadcrumb: ${e.message}`);
      }
    }
    throw err;
  }

  const prompt = renderPrompt(issue);
  const ok = runClaude(prompt);

  // If the session crashes before reaching its own wrap-up, leave a breadcrumb
  // so the operator can triage. A successful session is expected to label and
  // comment itself — we only act here on hard failure.
  if (!ok) {
    console.error(`[run-agent] Claude Code exited non-zero for #${issueNumber}`);
    try {
      await applyOutcomeLabel(issue, 'failed');
      await comment(
        issue,
        `⚠️ The per-issue agent session exited with a non-zero status before completing. See the GitHub Actions run logs for details.`
      );
    } catch (e) {
      console.error(`[run-agent] Could not post failure breadcrumb: ${e.message}`);
    }
    process.exit(1);
  }

  console.log(`[run-agent] Completed #${issueNumber}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
