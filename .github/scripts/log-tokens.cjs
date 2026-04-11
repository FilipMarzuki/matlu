#!/usr/bin/env node
// Logs Claude Code token usage for the current session to token-log.json.
// Designed to run as a Claude Code Stop hook or manually from the project root.
//
// Automatic mode (Stop hook / default):
//   node log-tokens.cjs
//   Reads the latest Claude Code session JSONL from ~/.claude/projects/<project>/
//
// Manual mode (Cursor, cloud agents, any external tool):
//   node log-tokens.cjs --manual <issueId> <inputTokens> <outputTokens> [cacheRead] [cacheWrite]
//   Example: node log-tokens.cjs --manual FIL-148 45000 8000
//   Uses a generated session ID based on date+issue to deduplicate same-day manual entries.

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Config ────────────────────────────────────────────────────────────────────

// Sonnet 4.6 pricing (USD per 1M tokens, approximate)
const PRICING = {
  input:       3.00,
  output:     15.00,
  cacheWrite:  3.75,  // ephemeral cache write
  cacheRead:   0.30,
};

const SESSIONS_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME,
  '.claude', 'projects', 'C--Users-marzu-matlu'
);

const TOKEN_LOG = path.join(__dirname, '../../token-log.json');

// ── Find most recent session JSONL ────────────────────────────────────────────

function findLatestSession() {
  const files = fs.readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({
      file: path.join(SESSIONS_DIR, f),
      mtime: fs.statSync(path.join(SESSIONS_DIR, f)).mtime,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (!files.length) throw new Error('No session files found in ' + SESSIONS_DIR);
  return files[0].file;
}

// ── Parse session JSONL ───────────────────────────────────────────────────────

function parseSession(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');

  let sessionId = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;

  for (const line of lines) {
    let record;
    try { record = JSON.parse(line); } catch (e) { continue; }

    // Session ID is on the first line (permission-mode record)
    if (record.type === 'permission-mode' && record.sessionId) {
      sessionId = record.sessionId;
    }

    // Token usage is on assistant message records
    if (record.type === 'assistant' && record.message?.usage) {
      const u = record.message.usage;
      // Each assistant turn has the *cumulative* session totals — take the last one
      inputTokens      = u.input_tokens                  ?? inputTokens;
      outputTokens     = u.output_tokens                 ?? outputTokens;
      cacheReadTokens  = u.cache_read_input_tokens       ?? cacheReadTokens;
      cacheWriteTokens = u.cache_creation_input_tokens   ?? cacheWriteTokens;
    }
  }

  if (!sessionId) throw new Error('Could not find session ID in ' + filePath);

  return { sessionId, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
}

// ── Estimate cost ─────────────────────────────────────────────────────────────

function estimateCost({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }) {
  return (
    (inputTokens      / 1_000_000) * PRICING.input      +
    (outputTokens     / 1_000_000) * PRICING.output      +
    (cacheReadTokens  / 1_000_000) * PRICING.cacheRead   +
    (cacheWriteTokens / 1_000_000) * PRICING.cacheWrite
  );
}

// ── Git branch → issue ID ─────────────────────────────────────────────────────

function getBranchInfo() {
  try {
    const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    // Match patterns like FIL-146, FIL-12, etc.
    const match = branch.match(/([A-Z]+-\d+)/i);
    const issueId = match ? match[1].toUpperCase() : null;
    return { branch, issueId };
  } catch (e) {
    return { branch: 'unknown', issueId: null };
  }
}

// ── Read / write token log ────────────────────────────────────────────────────

function readLog() {
  if (!fs.existsSync(TOKEN_LOG)) return [];
  try { return JSON.parse(fs.readFileSync(TOKEN_LOG, 'utf8')); } catch (e) { return []; }
}

function writeLog(entries) {
  fs.writeFileSync(TOKEN_LOG, JSON.stringify(entries, null, 2) + '\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

function mainAuto() {
  const sessionFile = findLatestSession();
  const session     = parseSession(sessionFile);
  const { branch, issueId } = getBranchInfo();

  const log = readLog();
  const existingIdx = log.findIndex(e => e.sessionId === session.sessionId);

  const entry = {
    sessionId:        session.sessionId,
    date:             new Date().toISOString().slice(0, 10),
    branch,
    issueId,
    source:           'claude-code',
    inputTokens:      session.inputTokens,
    outputTokens:     session.outputTokens,
    cacheReadTokens:  session.cacheReadTokens,
    cacheWriteTokens: session.cacheWriteTokens,
    estimatedCostUsd: Math.round(estimateCost(session) * 10000) / 10000,
  };

  if (existingIdx >= 0) {
    log[existingIdx] = entry;
    console.log(`Updated session ${session.sessionId} (${branch})`);
  } else {
    log.push(entry);
    console.log(`Logged session ${session.sessionId} (${branch})`);
  }
  console.log(`  Tokens: ${session.inputTokens} in / ${session.outputTokens} out / ${session.cacheReadTokens} cache-read / ${session.cacheWriteTokens} cache-write`);
  console.log(`  Estimated cost: $${entry.estimatedCostUsd}`);
  writeLog(log);
}

function mainManual(args) {
  // Usage: --manual <issueId> <inputTokens> <outputTokens> [cacheRead=0] [cacheWrite=0]
  const [issueId, inputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0] = args;
  if (!issueId || !inputTokens || !outputTokens) {
    console.error('Usage: log-tokens.cjs --manual <issueId> <inputTokens> <outputTokens> [cacheRead] [cacheWrite]');
    console.error('Example: node log-tokens.cjs --manual FIL-148 45000 8000');
    process.exit(1);
  }

  const { branch } = getBranchInfo();
  const date = new Date().toISOString().slice(0, 10);
  // Stable ID for same-day manual entries for the same issue (idempotent re-runs)
  const sessionId = `manual-${date}-${issueId}`;

  const session = {
    inputTokens:      parseInt(inputTokens, 10),
    outputTokens:     parseInt(outputTokens, 10),
    cacheReadTokens:  parseInt(cacheReadTokens, 10),
    cacheWriteTokens: parseInt(cacheWriteTokens, 10),
  };

  const log = readLog();
  const existingIdx = log.findIndex(e => e.sessionId === sessionId);

  const entry = {
    sessionId,
    date,
    branch,
    issueId: issueId.toUpperCase(),
    source: 'manual',
    ...session,
    estimatedCostUsd: Math.round(estimateCost(session) * 10000) / 10000,
  };

  if (existingIdx >= 0) {
    log[existingIdx] = entry;
    console.log(`Updated manual entry ${sessionId}`);
  } else {
    log.push(entry);
    console.log(`Logged manual entry for ${issueId}`);
  }
  console.log(`  Tokens: ${session.inputTokens} in / ${session.outputTokens} out`);
  console.log(`  Estimated cost: $${entry.estimatedCostUsd}`);
  writeLog(log);
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--manual') {
    mainManual(args.slice(1));
  } else {
    mainAuto();
  }
}

main();
