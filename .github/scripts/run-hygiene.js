#!/usr/bin/env node
// Single-shot hygiene runner. Invoked by agent-hygiene.yml.
//
// Unlike the per-issue triage/implementation runners, this is one Claude
// session that sweeps the entire Linear workspace — no matrix, no issue ID
// argument. The agent's prompt (hygiene.md) contains all three passes.
//
// Usage:
//   LINEAR_API_KEY=… ANTHROPIC_API_KEY=… node run-hygiene.js

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

if (!LINEAR_API_KEY) {
  console.error('Missing LINEAR_API_KEY');
  process.exit(1);
}
if (!CLAUDE_CODE_OAUTH_TOKEN && !ANTHROPIC_API_KEY) {
  console.error('Missing CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY');
  process.exit(1);
}

// ── Linear GraphQL helper — used only to post a failure comment ───────────────

async function linear(query, variables = {}) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: LINEAR_API_KEY.replace(/^Bearer\s+/i, ''),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.data ?? null;
}

async function postTeamComment(body) {
  // Post a comment on a sentinel issue (or just log) if the session crashes.
  // For now just log — the GitHub Actions run log is the audit trail.
  console.error('[run-hygiene] Session failure:', body);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function runClaude(prompt) {
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
      timeout: 16 * 60 * 1000, // 16 minutes — hygiene budget is 15 min
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

async function main() {
  console.log('[run-hygiene] Starting Linear hygiene sweep');

  const prompt = readFileSync(
    join(__dirname, '..', '..', '.agents', 'hygiene.md'),
    'utf8'
  );

  const ok = runClaude(prompt);

  if (!ok) {
    console.error('[run-hygiene] Claude Code exited non-zero');
    await postTeamComment('Linear hygiene agent session crashed — check Actions run logs.');
    process.exit(1);
  }

  console.log('[run-hygiene] Hygiene sweep complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
