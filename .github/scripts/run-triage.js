#!/usr/bin/env node
// Per-issue triage runner. Invoked by the GitHub Actions matrix in
// .github/workflows/agent-triage.yml — one cell per un-triaged Linear issue.
//
// Responsibilities:
//   1. Fetch the Linear issue (title + description).
//   2. Render the triage prompt from .agents/triage.md.
//   3. Spawn Claude Code in headless mode (read-only codebase access).
//
// The triage agent does NOT write code, commit, or push. All Linear mutations
// (labels, estimates, comments) happen inside the Claude session via the Linear
// MCP — the runner itself is orchestration only.
//
// Usage:
//   LINEAR_API_KEY=… ANTHROPIC_API_KEY=… node run-triage.js FIL-42

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const LINEAR_API_KEY           = process.env.LINEAR_API_KEY;
const CLAUDE_CODE_OAUTH_TOKEN  = process.env.CLAUDE_CODE_OAUTH_TOKEN;
const ANTHROPIC_API_KEY        = process.env.ANTHROPIC_API_KEY;

const issueArg = process.argv[2];

if (!issueArg) {
  console.error('Usage: run-triage.js <LINEAR_ISSUE_ID> (e.g. FIL-42)');
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
    join(__dirname, '..', '..', '.agents', 'triage.md'),
    'utf8'
  );
  return template
    .replaceAll('{{issue_id}}',    issue.identifier)
    .replaceAll('{{issue_uuid}}',  issue.id)
    .replaceAll('{{title}}',       issue.title)
    .replaceAll('{{description}}', issue.description || '_(no description provided)_');
}

// ── Claude Code invocation ────────────────────────────────────────────────────

function runClaude(prompt) {
  // bypassPermissions so the agent can run shell commands to read the codebase
  // and reach Linear via MCP for label/comment mutations. The triage prompt
  // forbids write operations — bypassPermissions is still needed because even
  // read-only shell commands trigger permission prompts in acceptEdits mode.
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
  console.log(`[run-triage] Starting triage for ${issueArg}`);

  const issue = await fetchIssue(issueArg);
  const prompt = renderPrompt(issue);
  const ok = runClaude(prompt);

  if (!ok) {
    console.error(`[run-triage] Claude Code exited non-zero for ${issueArg}`);
    process.exit(1);
  }

  console.log(`[run-triage] Completed triage for ${issueArg}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
