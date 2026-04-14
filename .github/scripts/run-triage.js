#!/usr/bin/env node
// Per-issue triage runner. Invoked by the GitHub Actions matrix in
// .github/workflows/agent-triage.yml — one cell per un-triaged issue.
//
// Responsibilities:
//   1. Fetch the Linear issue (title + description).
//   2. Render the triage prompt from .agents/triage.md.
//   3. Spawn Claude Code in headless mode (read-only codebase access).
//   4. If the session crashes, post a comment on the issue.
//
// The triage agent does NOT write code, commit, or push. It only reads
// the codebase and writes back to Linear (labels + description edits +
// comments). All Linear mutations happen inside the Claude session via
// the GraphQL API — the runner itself doesn't apply labels.
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

const issueId = process.argv[2];

if (!issueId) {
  console.error('Usage: run-triage.js <ISSUE_ID>');
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

// ── Linear GraphQL ────────────────────────────────────────────────────────────

async function linear(query, variables = {}) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: LINEAR_API_KEY.replace(/^Bearer\s+/i, ''),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear → ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Linear GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data;
}

async function fetchIssue(id) {
  const data = await linear(
    `query($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        team { id }
        labels { nodes { id name } }
        state { id name type }
      }
    }`,
    { id }
  );
  if (!data.issue) throw new Error(`Issue ${id} not found`);
  return data.issue;
}

async function comment(issue, body) {
  await linear(
    `mutation($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) { success }
    }`,
    { issueId: issue.id, body }
  );
}

// ── Prompt rendering ──────────────────────────────────────────────────────────

function renderPrompt(issue) {
  const template = readFileSync(
    join(__dirname, '..', '..', '.agents', 'triage.md'),
    'utf8'
  );
  return template
    .replaceAll('{{issue_id}}', issue.identifier)
    .replaceAll('{{title}}', issue.title)
    .replaceAll('{{description}}', issue.description || '_(no description provided)_');
}

// ── Claude Code invocation ────────────────────────────────────────────────────

function runClaude(prompt) {
  // bypassPermissions so the agent can run `ls`, `cat`, `grep` etc. to read
  // the codebase and `curl` to hit the Linear API. The triage agent prompt
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
  console.log(`[run-triage] Starting triage for ${issueId}`);
  let issue;

  try {
    issue = await fetchIssue(issueId);
  } catch (err) {
    console.error(`[run-triage] Failed to fetch ${issueId}: ${err.message}`);
    throw err;
  }

  const prompt = renderPrompt(issue);
  const ok = runClaude(prompt);

  if (!ok) {
    console.error(`[run-triage] Claude Code exited non-zero for ${issueId}`);
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

  console.log(`[run-triage] Completed triage for ${issueId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
