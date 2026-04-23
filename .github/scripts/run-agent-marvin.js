#!/usr/bin/env node
// Per-issue Cursor agent runner (Marvin). Mirrors run-agent.js but spawns
// Cursor CLI instead of Claude Code.
//
// Usage:
//   GITHUB_TOKEN=… CURSOR_API_KEY=… node run-agent-marvin.js 42

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
const CURSOR_API_KEY = process.env.CURSOR_API_KEY;
const REPO_OWNER     = process.env.REPO_OWNER || 'FilipMarzuki';
const REPO_NAME      = process.env.REPO_NAME  || 'matlu';

const issueArg = process.argv[2];

if (!issueArg) {
  console.error('Usage: run-agent-marvin.js <ISSUE_NUMBER>');
  process.exit(1);
}
if (!GITHUB_TOKEN) {
  console.error('Missing GITHUB_TOKEN');
  process.exit(1);
}
if (!CURSOR_API_KEY) {
  console.error('Missing CURSOR_API_KEY');
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
  const current = issue.labels.map(l => l.name);
  if (current.includes('agent:in-progress')) return;
  try {
    await githubRequest('POST', `/issues/${issue.number}/labels`, {
      labels: ['agent:in-progress'],
    });
  } catch (err) {
    console.warn(`[run-agent-marvin] Could not apply agent:in-progress: ${err.message}`);
  }
}

// ── Prompt rendering ──────────────────────────────────────────────────────────

function renderPrompt(issue) {
  const template = readFileSync(
    join(__dirname, '..', '..', '.agents', 'per-issue-marvin.md'),
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

// ── Cursor invocation ─────────────────────────────────────────────────────────

function runCursor(prompt) {
  // `cursor-agent -p` is print/headless mode — analogous to `claude --print`.
  // `--yolo` bypasses every permission prompt (directory trust, shell tool
  // approval, edit approval) — Cursor's equivalent of Claude Code's
  // `bypassPermissions`. Required in CI: --trust alone only covers directory
  // trust, leaving git/gh calls blocked. Without it, the agent reads/edits
  // files but silently can't run shell commands, exits 0, produces no PR.
  // The prompt is a positional argument.
  const argv = ['-p', '--yolo', prompt];

  console.log(
    `[run-agent-marvin] Spawning: cursor-agent -p --yolo <prompt ${prompt.length} chars>`
  );

  const result = spawnSync('cursor-agent', argv, {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: {
      ...process.env,
      CURSOR_API_KEY,
    },
  });

  // Loud diagnostics: if cursor-agent exits silently, we at least see why.
  console.log(
    `[run-agent-marvin] cursor-agent finished: status=${result.status} signal=${result.signal ?? 'none'}`
  );
  if (result.error) {
    console.error('[run-agent-marvin] spawn error:', result.error);
  }

  return result.status === 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[run-agent-marvin] Starting session for issue #${issueNumber}`);

  const issue = await fetchIssue(issueNumber);
  await moveToInProgress(issue);

  const prompt = renderPrompt(issue);
  const ok = runCursor(prompt);

  if (!ok) {
    console.error(`[run-agent-marvin] Cursor exited non-zero for #${issueNumber}`);
    process.exit(1);
  }

  console.log(`[run-agent-marvin] Completed #${issueNumber}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
