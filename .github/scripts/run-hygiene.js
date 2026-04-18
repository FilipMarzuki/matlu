#!/usr/bin/env node
// Per-issue hygiene runner. Invoked by the GitHub Actions matrix in
// .github/workflows/agent-hygiene.yml — one cell per hygiene task.
//
// Receives a "NUMBER:type" string (e.g. "42:mark-done") and spawns
// one Claude Code session with the relevant section of hygiene.md.
//
// Types:
//   mark-done        — check if linked PR is merged; close issue if so
//   split            — split a too-large issue into 2–4 focused sub-issues
//   enrich           — enrich a needs-refinement issue with codebase context
//   clean-duplicate  — strip labels from an already-closed duplicate issue
//
// Usage:
//   GITHUB_TOKEN=… ANTHROPIC_API_KEY=… node run-hygiene.js 42:mark-done

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const GITHUB_TOKEN            = process.env.GITHUB_TOKEN;
const CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
const ANTHROPIC_API_KEY       = process.env.ANTHROPIC_API_KEY;
const REPO_OWNER              = process.env.REPO_OWNER || 'FilipMarzuki';
const REPO_NAME               = process.env.REPO_NAME  || 'matlu';

const arg = process.argv[2]; // e.g. "42:mark-done"

if (!arg || !arg.includes(':')) {
  console.error('Usage: run-hygiene.js <ISSUE_NUMBER>:<type>');
  console.error('  Types: mark-done | split | enrich | clean-duplicate');
  process.exit(1);
}

const [issueIdStr, hygieneType] = arg.split(':');
const issueNumber = parseInt(issueIdStr, 10);

const VALID_TYPES = ['mark-done', 'split', 'enrich', 'clean-duplicate'];
if (!VALID_TYPES.includes(hygieneType)) {
  console.error(`Unknown hygiene type "${hygieneType}". Must be one of: ${VALID_TYPES.join(', ')}`);
  process.exit(1);
}
if (isNaN(issueNumber)) {
  console.error(`Invalid issue number: ${issueIdStr}`);
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

// ── GitHub Issues REST API ─────────────────────────────────────────────────────

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

async function postComment(number, body) {
  await githubRequest('POST', `/issues/${number}/comments`, { body });
}

// ── Prompt rendering ──────────────────────────────────────────────────────────

function renderPrompt(issue) {
  const template = readFileSync(
    join(__dirname, '..', '..', '.agents', 'hygiene.md'),
    'utf8'
  );
  const num = String(issue.number);
  return template
    .replaceAll('{{gh_issue_number}}', num)
    .replaceAll('{{title}}',          issue.title)
    .replaceAll('{{description}}',    issue.body || '_(no description)_')
    .replaceAll('{{hygiene_type}}',   hygieneType)
    .replaceAll('{{state}}',          issue.state)
    .replaceAll('{{labels}}',         issue.labels.map(l => l.name).join(', ') || 'none')
    .replaceAll('{{attachments}}',    'none') // GitHub Issues has no attachments API
    .replaceAll('{{children}}',       'none'); // no native child issues in GitHub
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
        ...(GITHUB_TOKEN            ? { GITHUB_TOKEN, GH_TOKEN: GITHUB_TOKEN } : {}),
      },
    }
  );
  return result.status === 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[run-hygiene] Starting ${hygieneType} for #${issueNumber}`);

  const issue = await fetchIssue(issueNumber);
  const prompt = renderPrompt(issue);
  const ok = runClaude(prompt);

  if (!ok) {
    console.error(`[run-hygiene] Claude Code exited non-zero for #${issueNumber}:${hygieneType}`);
    try {
      await postComment(issueNumber,
        `⚠️ Hygiene agent (${hygieneType}) crashed before completing. See the GitHub Actions run logs.`
      );
    } catch (e) {
      console.error(`[run-hygiene] Could not post failure comment: ${e.message}`);
    }
    process.exit(1);
  }

  console.log(`[run-hygiene] Completed ${hygieneType} for #${issueNumber}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
