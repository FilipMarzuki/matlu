#!/usr/bin/env node
/**
 * pixellab-burn.mjs — Automated PixelLab generation loop.
 *
 * Reads a queue file (pixellab-queue.json), processes items sequentially:
 * animate characters, poll for completion, download results, commit.
 * Runs until credits are exhausted or the queue is empty.
 *
 * Usage:
 *   node scripts/pixellab-burn.mjs                  # process entire queue
 *   node scripts/pixellab-burn.mjs --dry-run         # log actions without calling API
 *   node scripts/pixellab-burn.mjs --limit 10        # stop after 10 items
 *   node scripts/pixellab-burn.mjs --skip-download   # generate only, no download/commit
 *
 * Requires:
 *   PIXELLAB_API_KEY in .env or environment
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const QUEUE_FILE = join(ROOT, 'pixellab-queue.json');
const LOG_FILE = join(ROOT, 'pixellab-burn.log');

// ── ENV ──────────────────────────────────────────────────────────────────────

function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    const p = join(ROOT, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
}
loadEnv();

const API_KEY = process.env.PIXELLAB_API_KEY;
if (!API_KEY) { console.error('Missing PIXELLAB_API_KEY'); process.exit(1); }

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_DOWNLOAD = args.includes('--skip-download');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;

// ── MCP HTTP client ──────────────────────────────────────────────────────────
// PixelLab MCP is a JSON-RPC 2.0 server over HTTP at https://api.pixellab.ai/mcp

const MCP_URL = 'https://api.pixellab.ai/mcp';
const MCP_HEADERS = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

let rpcId = 1;

async function mcpCall(tool, params) {
  const body = {
    jsonrpc: '2.0',
    id: rpcId++,
    method: 'tools/call',
    params: { name: tool, arguments: params },
  };
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`MCP ${res.status}: ${raw}`);

  // MCP may respond as SSE (Server-Sent Events) or plain JSON.
  // SSE lines look like: "event: message\ndata: {json}\n\n"
  // Extract the last JSON data line.
  let json;
  if (raw.startsWith('event:') || raw.startsWith('data:')) {
    const dataLines = raw.split('\n').filter(l => l.startsWith('data: '));
    const lastData = dataLines[dataLines.length - 1];
    if (!lastData) throw new Error(`No data in SSE response: ${raw.slice(0, 200)}`);
    json = JSON.parse(lastData.slice(6)); // strip "data: " prefix
  } else {
    json = JSON.parse(raw);
  }

  if (json.error) throw new Error(`MCP error: ${JSON.stringify(json.error)}`);
  // MCP tool results come in json.result.content[0].text (plain text)
  const content = json.result?.content;
  if (content && content.length > 0 && content[0].text) {
    return content[0].text;
  }
  return JSON.stringify(json.result);
}

// ── Rate-limit aware MCP call ─────────────────────────────────────────────────
// Wraps mcpCall with retry logic: if response contains "rate limit", wait and retry.

const RATE_LIMIT_WAIT_MS = 30000; // 30 seconds between retries
const RATE_LIMIT_MAX_RETRIES = 10; // give up after 5 minutes

async function mcpCallWithRetry(tool, params) {
  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    const text = await mcpCall(tool, params);
    if (text.includes('rate limit') || text.includes('rate_limit') || text.includes('job slots')) {
      if (attempt >= RATE_LIMIT_MAX_RETRIES) {
        throw new Error(`Rate limited after ${RATE_LIMIT_MAX_RETRIES} retries: ${text.slice(0, 100)}`);
      }
      log(`  ⏳ Rate limited (${attempt + 1}/${RATE_LIMIT_MAX_RETRIES}), waiting ${RATE_LIMIT_WAIT_MS / 1000}s...`);
      await new Promise(r => setTimeout(r, RATE_LIMIT_WAIT_MS));
      continue;
    }
    return text;
  }
}

// ── REST API fallback (for balance + direct character fetch) ──────────────────

const REST_BASE = 'https://api.pixellab.ai';
const REST_HEADERS = { 'Authorization': `Bearer ${API_KEY}` };

async function restGet(path) {
  const res = await fetch(`${REST_BASE}${path}`, { headers: REST_HEADERS });
  if (!res.ok) throw new Error(`REST ${res.status} on GET ${path}`);
  return res.json();
}

// ── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { writeFileSync(LOG_FILE, line + '\n', { flag: 'a' }); } catch {}
}

// ── Balance check ────────────────────────────────────────────────────────────

async function getBalance() {
  const text = await mcpCall('get_balance', {});
  // Parse "generations_remaining: N" from the response text
  const match = text.match(/generations_remaining:\s*(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

// ── Animate character ────────────────────────────────────────────────────────

async function animateCharacter(charId, templateAnimId, directions, mode, actionDescription, frameCount) {
  const params = { character_id: charId };
  if (templateAnimId) params.template_animation_id = templateAnimId;
  if (directions) params.directions = directions;
  if (mode) params.mode = mode;
  if (actionDescription) params.action_description = actionDescription;
  if (frameCount) params.frame_count = frameCount;

  log(`  Firing animate_character: ${templateAnimId || actionDescription || 'custom'} [${(directions || ['all']).join(',')}] ${mode === 'pro' ? '(PRO)' : ''}`);
  if (DRY_RUN) { log('  [DRY RUN] skipped'); return 'dry-run'; }

  // Pro mode requires confirm_cost flow: first call to see price, then confirm
  if (mode === 'pro') {
    params.confirm_cost = false;
    const costText = await mcpCallWithRetry('animate_character', params);
    log(`  Pro cost check: ${costText.slice(0, 150)}`);
    // Now confirm
    params.confirm_cost = true;
    const text = await mcpCallWithRetry('animate_character', params);
    log(`  Response: ${text.slice(0, 200)}`);
    return text;
  }

  const text = await mcpCallWithRetry('animate_character', params);
  log(`  Response: ${text.slice(0, 200)}`);
  return text;
}

// ── Get character (poll for completion) ───────────────────────────────────────

async function getCharacter(charId) {
  const text = await mcpCall('get_character', { character_id: charId, include_preview: false });
  return text;
}

async function waitForAnimations(charId, expectedAnims, pollInterval = 30000, timeout = 900000) {
  const deadline = Date.now() + timeout;
  log(`  Polling for completion (timeout ${timeout / 1000}s)...`);

  // First poll: short wait to let PixelLab register the job
  await new Promise(r => setTimeout(r, 5000));

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollInterval));
    const text = await getCharacter(charId);

    // Look for active job indicators — "N jobs" processing/pending
    // The get_character response shows "processing (N%)" for active jobs
    // and "jobs" count for queued work. Check for these specific patterns.
    const hasActiveJobs = /\d+\s*jobs?/i.test(text) || /processing\s*\(\d+%\)/i.test(text);
    // Also check the status line at the top of the response
    const isProcessing = text.startsWith('status: processing');

    if (hasActiveJobs || isProcessing) {
      const elapsed = Math.round((Date.now() - (deadline - timeout)) / 1000);
      log(`  Still processing (${elapsed}s elapsed)...`);
      continue;
    }

    // If response says "status: completed" or just lists animations without jobs, we're done
    if (text.includes('failed')) {
      log(`  ⚠ Some animations failed`);
      return { status: 'partial', text };
    }

    log(`  ✓ All animations complete`);
    return { status: 'done', text };
  }

  log(`  ⚠ Timed out after ${timeout / 1000}s`);
  return { status: 'timeout' };
}

// ── Download (delegates to existing script) ──────────────────────────────────

function downloadCharacter(item) {
  if (DRY_RUN || SKIP_DOWNLOAD) {
    log(`  [SKIP] download for ${item.species}`);
    return;
  }
  log(`  Downloading ${item.species}...`);
  try {
    // NPC characters: use --id + --outdir for custom path
    // Wildlife: use --species (looks up in pixellab-ids.json)
    const isNpc = (item.pass || '').startsWith('npc');
    let cmd;
    if (isNpc && item.characterId) {
      const outDir = join(ROOT, 'public/assets/sprites/characters/npcs', item.species);
      cmd = `node scripts/download-pixellab-strips.mjs --id=${item.characterId} --outdir="${outDir}" --name=${item.species}`;
    } else {
      cmd = `node scripts/download-pixellab-strips.mjs --species=${item.species}`;
    }
    execSync(cmd, { cwd: ROOT, stdio: 'pipe', timeout: 120000 });
    log(`  ✓ Downloaded ${item.species}`);
  } catch (e) {
    log(`  ✗ Download failed for ${item.species}: ${e.message}`);
  }
}

// ── Git commit ───────────────────────────────────────────────────────────────

function commitItem(item, animType) {
  if (DRY_RUN || SKIP_DOWNLOAD) return;
  const isNpc = (item.pass || '').startsWith('npc');
  const spriteDir = isNpc
    ? `public/assets/sprites/characters/npcs/${item.species}`
    : `public/assets/sprites/wildlife/${item.species}`;
  const issueRef = isNpc ? '#1035' : '#929';
  try {
    execSync(`git add "${spriteDir}"`, { cwd: ROOT, stdio: 'pipe' });
    const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' });
    if (status.trim()) {
      execSync(`git commit -m "art(${issueRef}): ${item.species} ${animType} sprites from PixelLab burn"`, {
        cwd: ROOT,
        stdio: 'pipe',
      });
      log(`  ✓ Committed ${item.species} ${animType}`);
    } else {
      log(`  (no new files to commit for ${item.species})`);
    }
  } catch (e) {
    log(`  ✗ Commit failed: ${e.message}`);
  }
}

// ── Queue management ─────────────────────────────────────────────────────────

function generateQueue() {
  log('Generating queue from current state...');
  try {
    execSync('node scripts/pixellab-queue-generate.mjs', { cwd: ROOT, stdio: 'pipe' });
  } catch (e) {
    log(`⚠ Queue generation failed: ${e.message}`);
  }
}

function loadQueue() {
  generateQueue();
  if (!existsSync(QUEUE_FILE)) {
    log('Queue file not found after generation. Exiting.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(QUEUE_FILE, 'utf8'));
}

function saveQueue(queue) {
  writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2) + '\n');
}

// ── All 8 directions ─────────────────────────────────────────────────────────

const ALL_8_DIRS = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];

// ── Main loop ────────────────────────────────────────────────────────────────

async function main() {
  log('=== PixelLab Burn Started ===');
  if (DRY_RUN) log('DRY RUN mode — no API calls will be made');

  // Check balance
  let balance;
  try {
    balance = await getBalance();
    log(`Credits remaining: ${balance}`);
  } catch (e) {
    log(`⚠ Could not check balance: ${e.message}. Proceeding anyway.`);
    balance = Infinity;
  }

  if (balance <= 0 && !DRY_RUN) {
    log('No credits remaining. Exiting.');
    return;
  }

  const queue = loadQueue();
  const pending = queue.filter(item => item.status !== 'done');
  log(`Queue: ${pending.length} pending, ${queue.length - pending.length} done, ${queue.length} total`);

  let processed = 0;

  for (const item of queue) {
    if (item.status === 'done') continue;
    if (processed >= LIMIT) { log(`Limit reached (${LIMIT})`); break; }

    // Refresh balance every 5 items
    if (processed > 0 && processed % 5 === 0 && !DRY_RUN) {
      try {
        balance = await getBalance();
        log(`Credits remaining: ${balance}`);
        if (balance <= 0) { log('Credits exhausted. Stopping.'); break; }
      } catch {}
    }

    log(`\n[${processed + 1}/${pending.length}] ${item.species || item.name} — ${item.template || item.type}`);

    try {
      if (item.type === 'animate') {
        // Queue animation
        const dirs = item.directions === 8 ? ALL_8_DIRS
          : item.directions === 1 ? ['south']
          : Array.isArray(item.directions) ? item.directions
          : ALL_8_DIRS;

        await animateCharacter(
          item.characterId,
          item.template,
          dirs,
          item.mode || null,
          item.actionDescription || null,
          item.frameCount || null,
        );

        if (!DRY_RUN) {
          // Wait for completion
          const result = await waitForAnimations(item.characterId, 1);
          if (result.status === 'done' || result.status === 'partial') {
            downloadCharacter(item);
            commitItem(item, item.template || item.actionDescription || 'anim');
            item.status = 'done';
            item.completedAt = new Date().toISOString();
          } else {
            item.status = 'timeout';
            log(`  Marking as timeout — will retry next run`);
          }
        } else {
          item.status = 'done';
        }

      } else if (item.type === 'create_object_state') {
        log(`  create_object_state: ${item.description}`);
        if (!DRY_RUN) {
          const text = await mcpCallWithRetry('create_object_state', {
            character_id: item.characterId,
            edit_description: item.description,
            state_name: item.name,
          });
          log(`  Response: ${text.slice(0, 200)}`);
          // Poll and download would go here
          item.status = 'done';
          item.completedAt = new Date().toISOString();
        } else {
          item.status = 'done';
        }

      } else if (item.type === 'create_map_object') {
        log(`  create_map_object: ${item.description}`);
        if (!DRY_RUN) {
          const text = await mcpCallWithRetry('create_map_object', {
            description: item.description,
            width: item.width || 32,
            height: item.height || 32,
            view: item.view || 'low top-down',
            count: item.count || 1,
          });
          log(`  Response: ${text.slice(0, 200)}`);
          item.status = 'done';
          item.completedAt = new Date().toISOString();
        } else {
          item.status = 'done';
        }

      } else if (item.type === 'create_isometric_tile') {
        log(`  create_isometric_tile: ${item.description?.slice(0, 80)}`);
        if (!DRY_RUN) {
          const params = { description: item.description };
          if (item.tile_shape) params.tile_shape = item.tile_shape;
          const text = await mcpCallWithRetry('create_isometric_tile', params);
          log(`  Response: ${text.slice(0, 200)}`);
          item.status = 'done';
          item.completedAt = new Date().toISOString();
        } else {
          item.status = 'done';
        }

      } else if (item.type === 'create_character') {
        log(`  create_character: ${item.description?.slice(0, 80)}`);
        if (!DRY_RUN) {
          const params = {
            description: item.description,
            directions: item.directions || 8,
            pixel_size: item.size || 32,
          };
          const text = await mcpCallWithRetry('create_character', params);
          log(`  Response: ${text.slice(0, 200)}`);
          item.status = 'done';
          item.completedAt = new Date().toISOString();
          item.note = (item.note || '') + ` | result: ${text.slice(0, 100)}`;
        } else {
          item.status = 'done';
        }

      } else {
        log(`  Unknown type: ${item.type}, skipping`);
        continue;
      }

      // Save progress after each item
      saveQueue(queue);
      processed++;

    } catch (e) {
      log(`  ✗ Error: ${e.message}`);
      item.status = 'error';
      item.error = e.message;
      saveQueue(queue);
      // Continue to next item rather than stopping
      processed++;
    }
  }

  log(`\n=== Burn Complete: ${processed} items processed ===`);

  // Final balance check
  try {
    balance = await getBalance();
    log(`Credits remaining: ${balance}`);
  } catch {}
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
