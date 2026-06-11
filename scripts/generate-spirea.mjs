/**
 * Generate a pixel art image of "spirea" using the PixelLab API.
 *
 * Usage (from matlu root):
 *   node scripts/generate-spirea.mjs
 *
 * Output: public/assets/sprites/decorations/spirea.png
 *
 * Requires PIXELLAB_API_KEY in .env (already set).
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..');

// Load .env manually (no dotenv dep needed)
function loadEnv() {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const KEY = process.env.PIXELLAB_API_KEY;
if (!KEY) { console.error('Missing PIXELLAB_API_KEY in .env'); process.exit(1); }

const BASE = 'https://api.pixellab.ai/v1';
const headers = { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`API error ${res.status} on ${method} ${path}:`, text);
    throw new Error(`API ${res.status}`);
  }
  return JSON.parse(text);
}

async function poll(path, interval = 5000, timeout = 180000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const data = await api('GET', path);
    console.log(`  status: ${data.status}`);
    if (data.status === 'completed' || data.status === 'done') return data;
    if (data.status === 'failed' || data.status === 'error') throw new Error(`Job failed: ${JSON.stringify(data)}`);
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error('Timed out waiting for generation');
}

async function downloadPng(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const outPath = join(root, 'public', 'assets', 'sprites', 'decorations', 'spirea.png');

console.log('Creating spirea map object in PixelLab...');

let job;
try {
  // Try v1 map-objects endpoint first (matches create_map_object MCP tool)
  job = await api('POST', '/map-objects', {
    description: 'spirea flowering shrub, top-down pixel art, soft pink blossoms, lush green leaves',
    width: 48,
    height: 48,
    view: 'top-down',
    outline: 'hard',
    shading: 'medium',
    detail: 'medium',
  });
} catch (e) {
  console.log('map-objects endpoint failed, trying /imagine...');
  // Fallback: general image generation
  job = await api('POST', '/imagine', {
    prompt: 'spirea flowering shrub, top-down pixel art, soft pink blossoms, lush green leaves, 48x48, transparent background',
    width: 48,
    height: 48,
  });
}

console.log(`Job created: ${job.id || job.object_id || JSON.stringify(job)}`);
const id = job.id || job.object_id;

// Poll for completion
let result;
try {
  result = await poll(`/map-objects/${id}`);
} catch {
  result = await poll(`/objects/${id}`);
}

// Find the download URL
const url = result.url || result.storage_url || result.preview_url || result.image_url;
if (!url) {
  console.error('No download URL in result:', JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(`Downloading from ${url}...`);
await downloadPng(url, outPath);
console.log(`\n✓ Saved to: ${outPath}`);
