#!/usr/bin/env node
// Per-issue agent runner. Invoked by the GitHub Actions matrix in
// .github/workflows/agent-nightly.yml — one cell per Linear issue.
//
// Responsibilities:
//   1. Fetch the Linear issue (title + description).
//   2. Render the per-issue prompt from .agents/per-issue.md.
//   3. Spawn Claude Code in headless mode, scoped to exactly this issue.
//
// All Linear bookkeeping (outcome labels, comments) happens inside the Claude
// session via the Linear MCP — the runner is orchestration only. The Claude
// session also has access to GITHUB_TOKEN / gh CLI for commits and PRs.
//
// Usage:
//   LINEAR_API_KEY=… ANTHROPIC_API_KEY=… node run-agent.js FIL-42

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const LINEAR_API_KEY           = process.env.LINEAR_API_KEY;
// Claude Code accepts either auth method. Prefer the subscription OAuth
// token (tied to a Pro/Max/Team-premium seat, no per-call API billing) and
// fall back to a pay-as-you-go API key if the OAuth secret is unset.
const CLAUDE_CODE_OAUTH_TOKEN  = process.env.CLAUDE_CODE_OAUTH_TOKEN;
const ANTHROPIC_API_KEY        = process.env.ANTHROPIC_API_KEY;

const issueArg = process.argv[2];

if (!issueArg) {
  console.error('Usage: run-agent.js <LINEAR_ISSUE_ID> (e.g. FIL-42)');
  process.exit(1);
}
if (!LINEAR_API_KEY) {
  console.error('Missing LINEAR_API_KEY');
  process.exit(1);
}
if (!CLAUDE_CODE_OAUTH_TOKEN && !ANTHROPIC_API_KEY) {
  console.error('Missing CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY');
  process.exit(1);
}
if (!/^[A-Z]+-\d+$/.test(issueArg)) {
  console.error(`Invalid Linear issue identifier: ${issueArg} (expected e.g. FIL-42)`);
  process.exit(1);
}

// ── Linear GraphQL API ─────────────────────────────────────────────────────────

async function linearQuery(query, variables = {}) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: LINEAR_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear API → ${res.status} ${await res.text()}`);
  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(`Linear GraphQL errors: ${JSON.stringify(errors)}`);
  return data;
}

async function fetchIssue(identifier) {
  const data = await linearQuery(`
    query Issue($identifier: String!) {
      issues(filter: { identifier: { eq: $identifier } }, first: 1) {
        nodes {
          id
          identifier
          title
          description
        }
      }
    }
  `, { identifier });

  const nodes = data.issues.nodes;
  if (!nodes.length) throw new Error(`Linear issue not found: ${identifier}`);
  return nodes[0];
}

// ── Prompt rendering ──────────────────────────────────────────────────────────

function renderPrompt(issue) {
  const template = readFileSync(
    join(__dirname, '..', '..', '.agents', 'per-issue.md'),
    'utf8'
  );
  // issue.identifier = "FIL-42", issue.id = Linear UUID (needed for MCP calls)
  const id      = issue.identifier;
  const idLower = id.toLowerCase();
  return template
    .replaceAll('{{issue_id}}',       id)
    .replaceAll('{{issue_id_lower}}', idLower)
    .replaceAll('{{issue_uuid}}',     issue.id)
    .replaceAll('{{title}}',          issue.title)
    .replaceAll('{{description}}',    issue.description || '_(no description provided)_');
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
      // LINEAR_API_KEY and GITHUB_TOKEN are forwarded so the spawned session
      // can reach Linear (via MCP) and GitHub (via gh CLI) for wrap-up steps.
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
  console.log(`[run-agent] Starting session for ${issueArg}`);

  const issue = await fetchIssue(issueArg);
  const prompt = renderPrompt(issue);
  const ok = runClaude(prompt);

  if (!ok) {
    console.error(`[run-agent] Claude Code exited non-zero for ${issueArg}`);
    process.exit(1);
  }

  console.log(`[run-agent] Completed ${issueArg}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
