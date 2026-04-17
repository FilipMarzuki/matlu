#!/usr/bin/env node
// Per-issue triage runner. Invoked by the GitHub Actions matrix in
// .github/workflows/agent-triage.yml — one cell per un-triaged issue.
//
// Responsibilities:
//   1. Fetch the GitHub issue (title + body).
//   2. Render the triage prompt from .agents/triage.md.
//   3. Spawn Claude Code in headless mode (read-only codebase access).
//
// The triage agent does NOT write code, commit, or push. It only reads
// the codebase and writes back via the APIs available in its session.
// All label mutations happen inside the Claude session — the runner itself
// doesn't apply labels.
//
// Usage:
//   GITHUB_TOKEN=… ANTHROPIC_API_KEY=… node run-triage.js 42

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const GITHUB_TOKEN             = process.env.GITHUB_TOKEN;
const CLAUDE_CODE_OAUTH_TOKEN  = process.env.CLAUDE_CODE_OAUTH_TOKEN;
const ANTHROPIC_API_KEY        = process.env.ANTHROPIC_API_KEY;
const REPO_OWNER               = process.env.REPO_OWNER || 'FilipMarzuki';
const REPO_NAME                = process.env.REPO_NAME  || 'matlu';

const issueArg = process.argv[2];

if (!issueArg) {
  console.error('Usage: run-triage.js <ISSUE_NUMBER>');
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

async function comment(issue, body) {
  await githubRequest('POST', `/issues/${issue.number}/comments`, { body });
}

// ── Prompt rendering ──────────────────────────────────────────────────────────

function renderPrompt(issue) {
  const template = readFileSync(
    join(__dirname, '..', '..', '.agents', 'triage.md'),
    'utf8'
  );
  const id = String(issue.number);
  return template
    .replaceAll('{{issue_id}}', String(issue.number))
    .replaceAll('{{title}}', issue.title)
    .replaceAll('{{description}}', issue.body || '_(no description provided)_');
}

// ── Claude Code invocation ────────────────────────────────────────────────────

function runClaude(prompt) {
  // bypassPermissions so the agent can run `ls`, `cat`, `grep` etc. to read
  // the codebase and `curl` to hit APIs. The triage agent prompt forbids write
  // operations — bypassPermissions is still needed because even read-only shell
  // commands trigger permission prompts in acceptEdits mode.
  // LINEAR_API_KEY and other env vars are forwarded so the spawned session can
  // reach Linear for its own mutations (labels, estimates, comments).
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
      timeout: 4 * 60 * 1000, // 4 minutes — triage should finish in under 3
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
  console.log(`[run-triage] Starting triage for issue #${issueNumber}`);
  let issue;

  try {
    issue = await fetchIssue(issueNumber);
  } catch (err) {
    console.error(`[run-triage] Failed to fetch #${issueNumber}: ${err.message}`);
    throw err;
  }

  const prompt = renderPrompt(issue);
  const ok = runClaude(prompt);

  if (!ok) {
    console.error(`[run-triage] Claude Code exited non-zero for #${issueNumber}`);
    try {
      await comment(
        issue,
        `⚠️ The triage agent session crashed before completing. See the GitHub Actions run logs for details.`
      );
    } catch (e) {
      console.error(`[run-triage] Could not post failure comment: ${e.message}`);
    }
    process.exit(1);
  }

  console.log(`[run-triage] Completed triage for #${issueNumber}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
