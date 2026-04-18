#!/usr/bin/env node
// Per-issue agent runner. Invoked by the GitHub Actions matrix in
// .github/workflows/agent-nightly.yml — one cell per GitHub issue.
//
// Responsibilities:
//   1. Fetch the GitHub issue (title + body).
//   2. Mark it in-progress via an `agent:in-progress` label (best-effort).
//   3. Render the per-issue prompt from .agents/per-issue.md.
//   4. Spawn Claude Code in headless mode, scoped to exactly this issue.
//
// All outcome bookkeeping (agent:success label, summary comment) happens
// inside the Claude session via `gh issue edit` / `gh issue comment`.
// The runner is orchestration only — keep this file boring.
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
const REPO_OWNER               = process.env.REPO_OWNER || 'FilipMarzuki';
const REPO_NAME                = process.env.REPO_NAME  || 'matlu';

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
  const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}${path}`, {
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
  // Best-effort: add `agent:in-progress` label so humans can see work has begun.
  // If the label doesn't exist yet this will fail with 422; log but don't abort.
  const current = issue.labels.map(l => l.name);
  if (current.includes('agent:in-progress')) return;
  try {
    await githubRequest('POST', `/issues/${issue.number}/labels`, {
      labels: ['agent:in-progress'],
    });
  } catch (err) {
    console.warn(`[run-agent] Could not apply agent:in-progress: ${err.message}`);
  }
}

// ── Prompt rendering ──────────────────────────────────────────────────────────

function renderPrompt(issue) {
  const template = readFileSync(
    join(__dirname, '..', '..', '.agents', 'per-issue.md'),
    'utf8'
  );
  const num = String(issue.number);
  return template
    .replaceAll('{{issue_id}}',        num)
    .replaceAll('{{issue_id_lower}}',  num)
    .replaceAll('{{gh_issue_number}}', num)
    .replaceAll('{{title}}',           issue.title)
    .replaceAll('{{description}}',     issue.body || '_(no description provided)_');
}

// ── Claude Code invocation ────────────────────────────────────────────────────

function runClaude(prompt) {
  // Headless (`--print`) runs Claude Code non-interactively. bypassPermissions
  // is used instead of acceptEdits because acceptEdits only auto-approves file
  // edits — git, npm, gh, and Bash calls still trigger prompts that have
  // nowhere to go in --print mode. In a disposable CI sandbox this is fine.
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

  const issue = await fetchIssue(issueNumber);
  await moveToInProgress(issue);

  const prompt = renderPrompt(issue);
  const ok = runClaude(prompt);

  if (!ok) {
    console.error(`[run-agent] Claude Code exited non-zero for #${issueNumber}`);
    process.exit(1);
  }

  console.log(`[run-agent] Completed #${issueNumber}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
