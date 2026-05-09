/**
 * Syncs all PixelLab objects to disk and updates asset-spec.json status.
 *
 * 1. Fetches all objects from PixelLab API
 * 2. Matches each to an asset-spec entry by description
 * 3. Downloads PNGs that aren't already on disk
 * 4. Marks matched entries as "done" in asset-spec.json
 * 5. Writes a pixellab-inventory.json manifest
 *
 * Usage: PIXELLAB_API_KEY=xxx node scripts/sync-pixellab.mjs
 *   or:  node scripts/sync-pixellab.mjs --key xxx
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..');

const key = process.argv.includes('--key')
  ? process.argv[process.argv.indexOf('--key') + 1]
  : process.env.PIXELLAB_API_KEY;

if (!key) { console.error('Missing PIXELLAB_API_KEY'); process.exit(1); }

// Fetch all objects (paginated)
console.log('Fetching objects from PixelLab...');
const objects = [];
let offset = 0;
const limit = 50;
while (true) {
  const res = await fetch(`https://api.pixellab.ai/v2/objects?offset=${offset}&limit=${limit}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) { console.error('API error:', res.status, await res.text()); process.exit(1); }
  const data = await res.json();
  objects.push(...data.objects);
  console.log(`  Fetched ${objects.length} / ${data.total}`);
  if (objects.length >= data.total || data.objects.length < limit) break;
  offset += limit;
}
console.log(`Found ${objects.length} objects total`);

// Load asset-spec to match descriptions
const specPath = join(root, 'src', 'ai', 'asset-spec.json');
const spec = JSON.parse(readFileSync(specPath, 'utf8'));

// Build a lookup: first 40 chars of description → spec entry
// Check icons, itemIcons, and mapObjects
const descMap = new Map();
for (const section of ['icons', 'itemIcons']) {
  for (const entry of spec[section] || []) {
    if (!entry.id || !entry.pixellab?.description) continue;
    const key40 = entry.pixellab.description.slice(0, 40).toLowerCase();
    descMap.set(key40, { section, entry });
  }
}
for (const entry of spec.mapObjects || []) {
  if (!entry.id || !entry.pixellab?.description) continue;
  const key40 = entry.pixellab.description.slice(0, 40).toLowerCase();
  descMap.set(key40, { section: 'mapObjects', entry });
}

// Process each object
let downloaded = 0;
let matched = 0;
let skipped = 0;
const inventory = [];

for (const obj of objects) {
  const prompt40 = (obj.prompt || '').slice(0, 40).toLowerCase();
  const match = descMap.get(prompt40);

  const invEntry = {
    pixellabId: obj.id,
    prompt: obj.prompt?.slice(0, 80),
    size: obj.size,
    tags: obj.tags,
    createdAt: obj.created_at,
    status: obj.status,
    matched: !!match,
    matchedTo: match?.entry?.id || null,
    section: match?.section || null,
    downloaded: false,
    localPath: null,
  };

  if (match && match.entry) {
    matched++;
    const entry = match.entry;
    const outDir = entry.outputDir;
    const outPath = join(root, outDir, `${entry.id}.png`);

    if (!existsSync(outPath)) {
      // Download
      mkdirSync(dirname(outPath), { recursive: true });
      try {
        const imgRes = await fetch(obj.preview_url);
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          writeFileSync(outPath, buf);
          downloaded++;
          invEntry.downloaded = true;
          invEntry.localPath = outPath.replace(root, '').replace(/\\/g, '/');
          console.log(`  ✓ ${entry.id} → ${outDir}`);
        }
      } catch (e) {
        console.log(`  ✗ ${entry.id} download failed: ${e.message}`);
      }
    } else {
      skipped++;
      invEntry.downloaded = true;
      invEntry.localPath = outPath.replace(root, '').replace(/\\/g, '/');
    }

    // Mark as done in spec
    if (entry.status === 'pending') {
      entry.status = 'done';
      entry._pixellabObjectId = obj.id;
    }
  }

  inventory.push(invEntry);
}

// Write updated asset-spec
writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n');

// Write inventory manifest
const invPath = join(root, 'public', 'assets', 'pixellab-inventory.json');
writeFileSync(invPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  total: objects.length,
  matched,
  downloaded,
  skipped,
  unmatched: objects.length - matched - skipped,
  objects: inventory,
}, null, 2));

console.log(`\nDone:`);
console.log(`  ${objects.length} objects in PixelLab`);
console.log(`  ${matched} matched to asset-spec entries`);
console.log(`  ${downloaded} newly downloaded`);
console.log(`  ${skipped} already on disk`);
console.log(`  ${objects.length - matched} unmatched (not in asset-spec)`);
