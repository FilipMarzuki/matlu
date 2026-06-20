#!/usr/bin/env node
// download-transition-tiles.mjs - Fetches completed transition tiles from PixelLab
// and saves them to public/assets/packs/transition-*/ folders.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const QUEUE_FILE = join(ROOT, 'pixellab-queue.json');
const DRY_RUN = process.argv.includes('--dry-run');

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

  let json;
  if (raw.startsWith('event:') || raw.startsWith('data:')) {
    const dataLines = raw.split('\n').filter(l => l.startsWith('data: '));
    const lastData = dataLines[dataLines.length - 1];
    if (!lastData) throw new Error('No data in SSE response');
    json = JSON.parse(lastData.slice(6));
  } else {
    json = JSON.parse(raw);
  }

  if (json.error) throw new Error(`MCP error: ${JSON.stringify(json.error)}`);
  const content = json.result?.content;
  if (content && content.length > 0 && content[0].text) {
    return content[0].text;
  }
  return JSON.stringify(json.result);
}

async function listAllTransitionTiles() {
  const tiles = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const text = await mcpCall('list_isometric_tiles', { limit, offset });
    const lines = text.split('\n').filter(l => l.includes('transition') || l.includes('pure'));
    for (const line of lines) {
      const match = line.match(/([0-9a-f-]{36})\s*\|\s*(.+?)\s*\|/);
      if (match) {
        tiles.push({ id: match[1], snippet: match[2].trim() });
      }
    }
    if (!text.includes('next:')) break;
    offset += limit;
    console.log(`  Listed ${offset} tiles so far (${tiles.length} transition candidates)...`);
  }

  return tiles;
}

async function getTileDetails(tileId) {
  const text = await mcpCall('get_isometric_tile', { tile_id: tileId });
  const descMatch = text.match(/description:\s*(.+)/);
  const dlMatch = text.match(/download:\s*(https:\S+)/);
  return {
    description: descMatch ? descMatch[1].trim() : '',
    downloadUrl: dlMatch ? dlMatch[1].trim() : null,
  };
}

async function main() {
  const queue = JSON.parse(readFileSync(QUEUE_FILE, 'utf8'));
  const transitionItems = queue.filter(i => i.pass === 'transition-tiles');
  console.log(`Queue has ${transitionItems.length} transition tile items`);

  const descToPath = new Map();
  for (const item of transitionItems) {
    descToPath.set(item.description, item.outputPath);
  }

  console.log('Listing isometric tiles from PixelLab...');
  const candidates = await listAllTransitionTiles();
  console.log(`Found ${candidates.length} transition/pure tile candidates`);

  let downloaded = 0;
  let skipped = 0;
  let noMatch = 0;

  for (let i = 0; i < candidates.length; i++) {
    const tile = candidates[i];
    console.log(`[${i + 1}/${candidates.length}] Fetching ${tile.id}...`);

    const details = await getTileDetails(tile.id);
    if (!details.downloadUrl) {
      console.log('  No download URL, skipping');
      continue;
    }

    const outPath = descToPath.get(details.description);
    if (!outPath) {
      noMatch++;
      continue;
    }

    if (existsSync(outPath)) {
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would download to ${outPath}`);
      downloaded++;
      continue;
    }

    const dir = dirname(outPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const imgRes = await fetch(details.downloadUrl, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    if (!imgRes.ok) {
      console.log(`  Download failed: ${imgRes.status}`);
      continue;
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    writeFileSync(outPath, buf);
    console.log(`  Downloaded ${outPath}`);
    downloaded++;
  }

  console.log(`\nDone! Downloaded: ${downloaded}, Skipped: ${skipped}, No match: ${noMatch}`);
}

main().catch(e => { console.error(e); process.exit(1); });
