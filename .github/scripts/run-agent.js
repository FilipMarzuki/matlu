#!/usr/bin/env node
// Per-issue agent runner. Invoked by the GitHub Actions matrix in
// .github/workflows/agent-nightly.yml — one cell per Linear issue.
//
// Responsibilities:
//   1. Fetch the Linear issue (title + description).
//   2. Move it to "In Progress" so humans can see the agent is working.
//   3. Render the per-issue prompt from .agents/per-issue.md.
//   4. Spawn Claude Code in headless mode, scoped to exactly this issue.
//   5. Apply an `agent:<outcome>` label and post a summary comment on the issue.
//
// The goal of this script is orchestration only — all reasoning lives inside
// the Claude Code session itself. Keep this file boring.
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

const issueId = process.argv[2];

if (!issueId) {
  console.error('Usage: run-agent.js <ISSUE_ID>');
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

async function moveToInProgress(issue) {
  if (issue.state.type === 'started') return; // already In Progress
  const states = await linear(
    `query($teamId: ID!) {
      workflowStates(filter: { team: { id: { eq: $teamId } }, type: { eq: "started" } }) {
        nodes { id name }
      }
    }`,
    { teamId: issue.team.id }
  );
  const inProgress = states.workflowStates.nodes[0];
  if (!inProgress) return;
  // Linear is inconsistent: filter fields expect ID, but mutation arguments
  // (issueUpdate(id: ...), input.stateId, input.labelIds, etc.) are typed
  // String in the schema. Keep String! here even though these ARE IDs.
  await linear(
    `mutation($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) { success }
    }`,
    { id: issue.id, stateId: inProgress.id }
  );
}

async function applyOutcomeLabel(issue, outcome) {
  // Outcome must be one of success|partial|failed|wrong-interpretation.
  // The `agent:<outcome>` label must already exist in Linear (pre-created by
  // the operator) — we look it up by name rather than create it here.
  const labelName = `agent:${outcome}`;
  const data = await linear(
    `query($teamId: ID!, $name: String!) {
      issueLabels(filter: { team: { id: { eq: $teamId } }, name: { eq: $name } }) {
        nodes { id }
      }
    }`,
    { teamId: issue.team.id, name: labelName }
  );
  const label = data.issueLabels.nodes[0];
  if (!label) {
    console.error(`Label "${labelName}" does not exist in Linear — skipping.`);
    return;
  }
  const existing = issue.labels.nodes.map((l) => l.id);
  const next = Array.from(new Set([...existing, label.id]));
  // See note in moveToInProgress — mutation args are String in Linear's schema.
  await linear(
    `mutation($id: String!, $ids: [String!]!) {
      issueUpdate(id: $id, input: { labelIds: $ids }) { success }
    }`,
    { id: issue.id, ids: next }
  );
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
    join(__dirname, '..', '..', '.agents', 'per-issue.md'),
    'utf8'
  );
  return template
    .replaceAll('{{issue_id}}', issue.identifier)
    .replaceAll('{{issue_id_lower}}', issue.identifier.toLowerCase())
    .replaceAll('{{title}}', issue.title)
    .replaceAll('{{description}}', issue.description || '_(no description provided)_');
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
  console.log(`[run-agent] Starting session for ${issueId}`);
  let issue;

  // The bookkeeping stage can also fail (e.g. Linear schema drift, network
  // blip). If it crashes after we've fetched the issue, try to leave an
  // `agent:failed` breadcrumb so the operator sees it in Linear instead of
  // silently on the Actions tab.
  try {
    issue = await fetchIssue(issueId);
    await moveToInProgress(issue);
  } catch (err) {
    console.error(`[run-agent] Bookkeeping failed for ${issueId}: ${err.message}`);
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
    console.error(`[run-agent] Claude Code exited non-zero for ${issueId}`);
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

  console.log(`[run-agent] Completed ${issueId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
