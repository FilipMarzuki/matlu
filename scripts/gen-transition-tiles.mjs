#!/usr/bin/env node
// gen-transition-tiles.mjs - Generate transition tiles with thick tile shape,
// batch 8 at a time, poll for completion, download, repeat.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 8; // stay under the 10-job limit

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
const MCP_HEADERS = { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };
let rpcId = 1;

async function mcpCall(tool, params) {
  const body = { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name: tool, arguments: params } };
  const res = await fetch(MCP_URL, { method: 'POST', headers: MCP_HEADERS, body: JSON.stringify(body) });
  const raw = await res.text();
  if (!res.ok) throw new Error(`MCP ${res.status}: ${raw}`);
  let json;
  if (raw.startsWith('event:') || raw.startsWith('data:')) {
    const dataLines = raw.split('\n').filter(l => l.startsWith('data: '));
    json = JSON.parse(dataLines[dataLines.length - 1].slice(6));
  } else {
    json = JSON.parse(raw);
  }
  if (json.error) throw new Error(`MCP error: ${JSON.stringify(json.error)}`);
  const content = json.result?.content;
  return (content && content[0]?.text) ? content[0].text : JSON.stringify(json.result);
}

const CORNER_LABELS = ['NW', 'NE', 'SE', 'SW'];
const PAIRS = [
  { folder: 'transition-meadow-forest', descA: 'bright green grass meadow with small flowers', descB: 'dark dense forest floor with leaf litter and moss' },
  { folder: 'transition-meadow-marsh', descA: 'bright green grass meadow', descB: 'dark wet marshy ground with puddles, reeds, and peat' },
  { folder: 'transition-shore-meadow', descA: 'sandy beige shoreline with small pebbles', descB: 'bright green grass meadow' },
  { folder: 'transition-forest-granite', descA: 'dark forest floor with moss and fallen leaves', descB: 'grey exposed granite rock with lichen patches' },
  { folder: 'transition-forest-spruce', descA: 'warm brown forest floor with broad leaves and moss', descB: 'dark cold spruce forest floor with needles and sparse undergrowth' },
  { folder: 'transition-granite-snow', descA: 'grey granite rock surface with lichen', descB: 'white snow covering with ice crystals and frost' },
  { folder: 'transition-meadow-heath', descA: 'bright green grass meadow', descB: 'dry brown heath with heather, sparse rocks, and sandy patches' },
];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function pollAndDownload(pending) {
  while (pending.length > 0) {
    await sleep(15000);
    for (let i = pending.length - 1; i >= 0; i--) {
      const tile = pending[i];
      try {
        const text = await mcpCall('get_isometric_tile', { tile_id: tile.id });
        if (text.includes('status: completed')) {
          const dlMatch = text.match(/download:\s*(https:\S+)/);
          if (dlMatch) {
            const dir = dirname(tile.outPath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            const imgRes = await fetch(dlMatch[1], { headers: { 'Authorization': `Bearer ${API_KEY}` } });
            if (imgRes.ok) {
              writeFileSync(tile.outPath, Buffer.from(await imgRes.arrayBuffer()));
              console.log(`  Downloaded ${tile.name}`);
            }
          }
          pending.splice(i, 1);
        }
      } catch (e) {
        console.log(`  Poll error ${tile.name}: ${e.message}`);
      }
    }
    if (pending.length > 0) {
      console.log(`  ${pending.length} still processing...`);
    }
  }
}

async function main() {
  const packsDir = join(ROOT, 'public/assets/packs');
  const jobs = [];

  for (const pair of PAIRS) {
    for (let mask = 0; mask < 16; mask++) {
      const outPath = join(packsDir, pair.folder, `${mask}.png`);
      if (existsSync(outPath)) continue;
      const corners = mask === 0
        ? `pure ${pair.descA}`
        : CORNER_LABELS.map((label, i) =>
            `${label} corner: ${(mask & (1 << i)) ? pair.descB : pair.descA}`
          ).join(', ');
      const desc = mask === 0
        ? `Isometric 32x32 diamond tile, pure ${pair.descA}. Pixel art style matching existing game tiles. Transparent background.`
        : `Isometric 32x32 diamond transition tile blending two terrain types. ${corners}. Smooth natural gradient between the two materials at the boundary. Pixel art style matching existing game tiles. Transparent background.`;
      jobs.push({ desc, outPath, name: `${pair.folder}-${mask}` });
    }
  }

  console.log(`${jobs.length} tiles to generate (batch size: ${BATCH_SIZE})`);
  if (jobs.length === 0) { console.log('Nothing to do'); return; }
  if (DRY_RUN) { console.log('Dry run complete'); return; }

  let totalDone = 0;
  for (let b = 0; b < jobs.length; b += BATCH_SIZE) {
    const batch = jobs.slice(b, b + BATCH_SIZE);
    console.log(`\nBatch ${Math.floor(b / BATCH_SIZE) + 1} — generating ${batch.length} tiles...`);

    const pending = [];
    for (const job of batch) {
      console.log(`  Generating ${job.name}...`);
      try {
        const text = await mcpCall('create_isometric_tile', {
          description: job.desc,
          tile_shape: 'thick tile',
          size: 32,
          detail: 'medium detail',
          shading: 'basic shading',
        });
        const idMatch = text.match(/id:\s*([0-9a-f-]{36})/);
        if (idMatch) {
          pending.push({ id: idMatch[1], outPath: job.outPath, name: job.name });
        } else if (text.includes('rate limit')) {
          console.log(`  Rate limited, waiting 30s...`);
          await sleep(30000);
          // retry this one
          const retry = await mcpCall('create_isometric_tile', {
            description: job.desc, tile_shape: 'thick tile', size: 32,
            detail: 'medium detail', shading: 'basic shading',
          });
          const retryId = retry.match(/id:\s*([0-9a-f-]{36})/);
          if (retryId) pending.push({ id: retryId[1], outPath: job.outPath, name: job.name });
          else console.log(`  Still rate limited, skipping ${job.name}`);
        } else {
          console.log(`  Unexpected response: ${text.slice(0, 100)}`);
        }
      } catch (e) {
        console.log(`  Error: ${e.message}`);
      }
    }

    console.log(`  Polling ${pending.length} tiles...`);
    await pollAndDownload(pending);
    totalDone += pending.length;
    console.log(`  Batch done (${totalDone}/${jobs.length} total)`);
  }

  console.log(`\nComplete! ${totalDone} tiles generated and downloaded.`);
}

main().catch(e => { console.error(e); process.exit(1); });
