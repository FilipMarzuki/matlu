#!/usr/bin/env node
// Spawns a Claude Code session to review an audio sync PR.
//
// Fetches the list of added files from the GitHub PR, renders the
// audio-review.md prompt, and runs Claude Code which will post a
// GitHub review (approve / request changes / comment).
//
// Usage:
//   GITHUB_TOKEN=… CLAUDE_CODE_OAUTH_TOKEN=… node run-audio-review.js <PR_NUMBER>

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const PR_NUMBER             = process.argv[2];
const GITHUB_TOKEN          = process.env.GITHUB_TOKEN;
const CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
const ANTHROPIC_API_KEY     = process.env.ANTHROPIC_API_KEY;

if (!PR_NUMBER) {
  console.error('Usage: run-audio-review.js <PR_NUMBER>');
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

// ── Fetch PR file list from GitHub ────────────────────────────────────────────

async function fetchPRFiles(prNumber) {
  const res = await fetch(
    `https://api.github.com/repos/FilipMarzuki/matlu/pulls/${prNumber}/files`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
    }
  );
  if (!res.ok) throw new Error(`GitHub API → ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[run-audio-review] Reviewing PR #${PR_NUMBER}`);

  const allFiles = await fetchPRFiles(PR_NUMBER);
  const audioFiles = allFiles
    .filter(f => f.filename.startsWith('public/assets/packs/audio/') && f.status === 'added')
    .map(f => f.filename);

  if (audioFiles.length === 0) {
    console.log('[run-audio-review] No new audio files in PR — skipping review.');
    return;
  }

  const template = readFileSync(
    join(__dirname, '..', '..', '.agents', 'audio-review.md'),
    'utf8'
  );

  const prompt = template
    .replaceAll('{{pr_number}}', PR_NUMBER)
    .replaceAll('{{files}}', audioFiles.map(f => `- ${f}`).join('\n'));

  const result = spawnSync(
    'npx',
    ['--yes', '@anthropic-ai/claude-code', '--print', '--permission-mode', 'bypassPermissions', prompt],
    {
      stdio: 'inherit',
      timeout: 5 * 60 * 1000,
      env: {
        ...process.env,
        ...(CLAUDE_CODE_OAUTH_TOKEN ? { CLAUDE_CODE_OAUTH_TOKEN } : {}),
        ...(ANTHROPIC_API_KEY       ? { ANTHROPIC_API_KEY }       : {}),
        GITHUB_TOKEN,
      },
    }
  );

  if (result.status !== 0) {
    console.error(`[run-audio-review] Claude Code exited non-zero for PR #${PR_NUMBER}`);
    process.exit(1);
  }

  console.log(`[run-audio-review] Review complete for PR #${PR_NUMBER}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
