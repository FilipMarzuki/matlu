/**
 * Scans public/assets/sprites/ and public/assets/packs/ for all PNG files.
 * Writes public/assets/sprite-manifest.json — used by AssetViewerScene.
 *
 * Also scans src/ for texture key references to mark each sprite as
 * "wired" (referenced in code) or "unwired" (exists on disk but unused).
 *
 * Run: npm run assets:sprites
 */
import { readdirSync, statSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..');

function walkPngs(dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.name.startsWith('.') || entry.name === '_raw') continue;
    if (entry.isDirectory()) files.push(...walkPngs(full));
    else if (entry.name.endsWith('.png')) files.push(full);
  }
  return files;
}

// Collect all source code to search for texture references
function collectSourceText() {
  const srcDir = join(root, 'src');
  const texts = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.json')) {
        texts.push(readFileSync(full, 'utf8'));
      }
    }
  }
  walk(srcDir);
  // Also check macro-world JSON
  const mwDir = join(root, 'public', 'macro-world');
  if (existsSync(mwDir)) {
    for (const f of readdirSync(mwDir)) {
      if (f.endsWith('.json')) texts.push(readFileSync(join(mwDir, f), 'utf8'));
    }
  }
  return texts.join('\n');
}

const sourceText = collectSourceText();

// Scan sprite folders
const spritesDir = join(root, 'public', 'assets', 'sprites');
const packsDir = join(root, 'public', 'assets', 'packs');

const entries = [];

// Sprites
for (const fullPath of walkPngs(spritesDir)) {
  const rel = relative(join(root, 'public'), fullPath).replace(/\\/g, '/');
  const url = '/' + rel;
  const name = basename(fullPath, '.png');
  const folder = dirname(relative(spritesDir, fullPath)).replace(/\\/g, '/');

  // Derive a likely texture key from folder structure
  // e.g. trees/oak/mature/5.png → tree-oak-5
  // e.g. icons/concepts/patch-flame.png → patch-flame
  const parts = folder.split('/');
  let category = parts[0] || 'other';

  // Check if this sprite is referenced in source code.
  // Use the url path or a derived texture key to avoid false positives
  // (bare names like "0" match everywhere).
  const derivedKey = folder.replace(/\//g, '-').replace(/-candidates.*/, '') + '-' + name;
  const wired = sourceText.includes(url)
    || sourceText.includes(derivedKey)
    || (name.length > 3 && (sourceText.includes(name) || sourceText.includes(basename(fullPath))));

  entries.push({ name, url, folder, category, wired });
}

// Packs — only include PNGs from specific useful packs
const USEFUL_PACKS = /building-objects|tiles$/;
for (const fullPath of walkPngs(packsDir)) {
  const rel = relative(packsDir, fullPath).replace(/\\/g, '/');
  const packName = rel.split('/')[0];
  if (!USEFUL_PACKS.test(packName)) continue;

  const url = '/assets/packs/' + rel;
  const name = basename(fullPath, '.png');
  const folder = dirname(rel).replace(/\\/g, '/');
  const category = packName.includes('building') ? 'buildings' : 'tiles';
  const wired = sourceText.includes(name) || sourceText.includes(basename(fullPath));

  entries.push({ name, url, folder, category, wired });
}

// Group by category
const grouped = {};
for (const e of entries) {
  if (!grouped[e.category]) grouped[e.category] = [];
  grouped[e.category].push(e);
}

// Sort categories
const manifest = {
  generatedAt: new Date().toISOString(),
  totalAssets: entries.length,
  wiredCount: entries.filter(e => e.wired).length,
  unwiredCount: entries.filter(e => !e.wired).length,
  categories: Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, assets]) => ({
      category: cat,
      count: assets.length,
      assets: assets.sort((a, b) => a.name.localeCompare(b.name)),
    })),
};

const outFile = join(root, 'public', 'assets', 'sprite-manifest.json');
writeFileSync(outFile, JSON.stringify(manifest, null, 2));
console.log(`Wrote ${entries.length} assets (${manifest.wiredCount} wired, ${manifest.unwiredCount} unwired) to sprite-manifest.json`);
