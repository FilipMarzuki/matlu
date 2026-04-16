#!/usr/bin/env node
// Per-issue hygiene runner. Invoked by the GitHub Actions matrix in
// .github/workflows/agent-hygiene.yml — one cell per hygiene task.
//
// Receives a "ISSUE_ID:type" string (e.g. "FIL-42:mark-done") and spawns
// one Claude Code session with the relevant section of hygiene.md.
//
// Types:
//   mark-done  — check if linked PR is merged; mark issue Done if so
//   split      — split a too-large issue into 2–4 focused sub-issues
//   enrich     — enrich a needs-refinement issue with codebase context
//
// Usage:
//   LINEAR_API_KEY=… ANTHROPIC_API_KEY=… node run-hygiene.js FIL-42:mark-done

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const LINEAR_API_KEY          = process.env.LINEAR_API_KEY;
const GITHUB_TOKEN            = process.env.GITHUB_TOKEN;
const CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
const ANTHROPIC_API_KEY       = process.env.ANTHROPIC_API_KEY;

const arg = process.argv[2]; // e.g. "FIL-42:mark-done"

if (!arg || !arg.includes(':')) {
  console.error('Usage: run-hygiene.js <ISSUE_ID>:<type>');
  console.error('  Types: mark-done | split | enrich');
  process.exit(1);
}

const [issueId, hygieneType] = arg.split(':');

const VALID_TYPES = ['mark-done', 'split', 'enrich'];
if (!VALID_TYPES.includes(hygieneType)) {
  console.error(`Unknown hygiene type "${hygieneType}". Must be one of: ${VALID_TYPES.join(', ')}`);
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
        id identifier title description
        state { name type }
        labels { nodes { id name } }
        attachments { nodes { title url } }
        children { nodes { id identifier title } }
        team { id name }
      }
    }`,
    { id }
  );
  if (!data.issue) throw new Error(`Issue ${id} not found`);
  return data.issue;
}

async function postComment(issue, body) {
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
    join(__dirname, '..', '..', '.agents', 'hygiene.md'),
    'utf8'
  );
  return template
    .replaceAll('{{issue_id}}',     issue.identifier)
    .replaceAll('{{title}}',        issue.title)
    .replaceAll('{{description}}',  issue.description || '_(no description)_')
    .replaceAll('{{hygiene_type}}',  hygieneType)
    .replaceAll('{{state}}',        issue.state.name)
    .replaceAll('{{labels}}',       issue.labels.nodes.map(l => l.name).join(', ') || 'none')
    .replaceAll('{{attachments}}',  issue.attachments.nodes
      .map(a => `${a.title}: ${a.url}`).join('\n') || 'none')
    .replaceAll('{{children}}',     issue.children.nodes
      .map(c => `${c.identifier}: ${c.title}`).join('\n') || 'none');
}

// ── Claude Code invocation ────────────────────────────────────────────────────

function runClaude(prompt) {
  const result = spawnSync(
    'npx',
    ['--yes', '@anthropic-ai/claude-code', '--print', '--permission-mode', 'bypassPermissions', prompt],
    {
      stdio: 'inherit',
      timeout: 7 * 60 * 1000, // 7 minutes per issue
      env: {
        ...process.env,
        ...(CLAUDE_CODE_OAUTH_TOKEN ? { CLAUDE_CODE_OAUTH_TOKEN } : {}),
        ...(ANTHROPIC_API_KEY       ? { ANTHROPIC_API_KEY }       : {}),
        ...(GITHUB_TOKEN            ? { GITHUB_TOKEN }            : {}),
        LINEAR_API_KEY,
      },
    }
  );
  return result.status === 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[run-hygiene] Starting ${hygieneType} for ${issueId}`);
  let issue;

  try {
    issue = await fetchIssue(issueId);
  } catch (err) {
    console.error(`[run-hygiene] Failed to fetch ${issueId}: ${err.message}`);
    throw err;
  }

  const prompt = renderPrompt(issue);
  const ok = runClaude(prompt);

  if (!ok) {
    console.error(`[run-hygiene] Claude Code exited non-zero for ${issueId}:${hygieneType}`);
    try {
      await postComment(issue,
        `⚠️ Hygiene agent (${hygieneType}) crashed before completing. See the GitHub Actions run logs.`
      );
    } catch (e) {
      console.error(`[run-hygiene] Could not post failure comment: ${e.message}`);
    }
    process.exit(1);
  }

  console.log(`[run-hygiene] Completed ${hygieneType} for ${issueId}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
