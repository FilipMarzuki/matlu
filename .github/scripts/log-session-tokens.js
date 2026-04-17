#!/usr/bin/env node
// log-session-tokens.js — CI companion to log-tokens.cjs
//
// Reads the most-recent Claude Code session JSONL from ~/.claude/projects/,
// extracts token usage, and upserts one row to Supabase ai_sessions.
// Add as a workflow step with `if: always()` immediately after every
// `npx @anthropic-ai/claude-code --print` step.
//
// Usage:
//   node .github/scripts/log-session-tokens.js \
//     --workflow "Dev Agent" \
//     [--issue FIL-42]         # Linear issue ID; hygiene passes "FIL-42:mark-done" — colon is stripped
//     [--branch my-branch]     # defaults to `git rev-parse --abbrev-ref HEAD`
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Exit code is always 0 — a metrics failure must never fail the workflow.

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function arg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] ?? null : null;
}

const workflow   = arg('--workflow') ?? 'unknown';
const issueRaw   = arg('--issue');
const issueId    = issueRaw ? issueRaw.split(':')[0] : null; // strip ":mark-done" etc.
const branchArg  = arg('--branch');
const branch     = branchArg ?? (() => {
  try { return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim(); }
  catch { return null; }
})();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.log('[log-session-tokens] Missing Supabase env vars — skipping.');
  process.exit(0);
}

// ── Pricing (USD per 1M tokens) ───────────────────────────────────────────────

const PRICING = {
  'claude-sonnet-4-6':         { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-opus-4-6':           { input: 15.0, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-haiku-4-5-20251001': { input: 0.80, output:  4.00, cacheWrite:  1.00, cacheRead: 0.08 },
};
const DEFAULT_PRICING = PRICING['claude-sonnet-4-6'];

function estimateCost(model, input, output, cacheWrite, cacheRead) {
  const p = PRICING[model] ?? DEFAULT_PRICING;
  return (input / 1e6) * p.input
       + (output / 1e6) * p.output
       + (cacheWrite / 1e6) * p.cacheWrite
       + (cacheRead  / 1e6) * p.cacheRead;
}

// ── Find the most-recently-modified JSONL in ~/.claude/projects/ ──────────────

function findLatestJsonl() {
  const base = join(homedir(), '.claude', 'projects');
  if (!existsSync(base)) {
    console.log('[log-session-tokens] ~/.claude/projects not found — no session to log.');
    return null;
  }
  let latestFile = null;
  let latestMtime = 0;
  for (const dir of readdirSync(base)) {
    const dirPath = join(base, dir);
    try { if (!statSync(dirPath).isDirectory()) continue; } catch { continue; }
    for (const file of readdirSync(dirPath)) {
      if (!file.endsWith('.jsonl')) continue;
      const fp = join(dirPath, file);
      try {
        const mtime = statSync(fp).mtimeMs;
        if (mtime > latestMtime) { latestMtime = mtime; latestFile = fp; }
      } catch { /* skip */ }
    }
  }
  return latestFile;
}

// ── Parse JSONL — sum usage across all assistant turns ────────────────────────

function parseSession(filePath) {
  // Session ID = filename without extension (UUID assigned by Claude Code)
  const sessionId = filePath.replace(/\\/g, '/').split('/').pop().replace('.jsonl', '');

  let input = 0, output = 0, cacheWrite = 0, cacheRead = 0;
  let model = 'claude-sonnet-4-6';

  const lines = readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }

    // Claude Code JSONL lines have a `message` wrapper; usage lives inside it
    // or at top-level depending on the record type.
    const usage = obj?.message?.usage ?? obj?.usage;
    if (!usage) continue;

    input      += usage.input_tokens                 ?? 0;
    output     += usage.output_tokens                ?? 0;
    cacheWrite += usage.cache_creation_input_tokens  ?? 0;
    cacheRead  += usage.cache_read_input_tokens      ?? 0;

    if (obj?.message?.model) model = obj.message.model;
  }

  return { sessionId, model, input, output, cacheWrite, cacheRead };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const filePath = findLatestJsonl();
  if (!filePath) return;

  const { sessionId, model, input, output, cacheWrite, cacheRead } = parseSession(filePath);

  if (input + output + cacheRead + cacheWrite === 0) {
    console.log('[log-session-tokens] Zero tokens in session — skipping.');
    return;
  }

  const costUsd = estimateCost(model, input, output, cacheWrite, cacheRead);

  const row = {
    session_id:         sessionId,
    recorded_at:        new Date().toISOString().slice(0, 10),
    workflow,
    issue_id:           issueId,
    branch,
    model,
    source:             'github-actions',
    input_tokens:       input,
    output_tokens:      output,
    cache_read_tokens:  cacheRead,
    cache_write_tokens: cacheWrite,
    estimated_cost_usd: Math.round(costUsd * 10000) / 10000,
  };

  console.log(
    `[log-session-tokens] ${workflow}${issueId ? ` / ${issueId}` : ''} ` +
    `| ${input}in / ${output}out | $${row.estimated_cost_usd}`
  );

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_sessions?on_conflict=session_id`,
    {
      method: 'POST',
      headers: {
        apikey:         SUPABASE_KEY,
        Authorization:  `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer:         'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`[log-session-tokens] Supabase write failed: ${res.status} ${body}`);
  } else {
    console.log('[log-session-tokens] Logged to ai_sessions.');
  }
}

main().catch(err => {
  // Never let a metrics failure propagate to the workflow exit code.
  console.error('[log-session-tokens] Unexpected error:', err.message);
}).finally(() => process.exit(0));
