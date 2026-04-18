/**
 * download-creature-sounds.js
 *
 * Downloads CC0 creature sounds from freesound.org for mini-velcrid ambient chirps.
 * Requires a free Freesound API key: https://freesound.org/apiv2/apply/
 *
 * Usage:
 *   FREESOUND_API_KEY=your_key node scripts/download-creature-sounds.js
 *
 * Saves to: public/assets/audio/creatures/mini-velcrid/
 * Overwrites the current placeholder files.
 */

import fs   from 'fs';
import path from 'path';
import https from 'https';

const API_KEY = process.env.FREESOUND_API_KEY;
if (!API_KEY) {
  console.error('Set FREESOUND_API_KEY. Get a free key at https://freesound.org/apiv2/apply/');
  process.exit(1);
}

const OUT_DIR = 'public/assets/audio/creatures/mini-velcrid';
fs.mkdirSync(OUT_DIR, { recursive: true });

// CC0 insect click/chirp sounds chosen for mini-velcrid ambient:
//   194145 — dry chitinous click ~100ms (potentjello, CC0)
//   194144 — slightly heavier click ~145ms (potentjello, CC0)
//   512472 — alien creature clicks, synthesized (michael_grinnell, CC0)
const SOUNDS = [
  { id: 194145, out: 'mini-velcrid-chirp-0.ogg' },
  { id: 194144, out: 'mini-velcrid-chirp-1.ogg' },
  { id: 512472, out: 'mini-velcrid-chirp-2.ogg' },
];

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: `Token ${API_KEY}` } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const follow = (u) => {
      https.get(u, { headers: { Authorization: `Token ${API_KEY}` } }, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          follow(res.headers.location);
          return;
        }
        const out = fs.createWriteStream(destPath);
        res.pipe(out);
        out.on('finish', () => { out.close(); resolve(); });
      }).on('error', reject);
    };
    follow(url);
  });
}

for (const sound of SOUNDS) {
  console.log(`Fetching sound ${sound.id}...`);
  const info = await fetchJson(`https://freesound.org/apiv2/sounds/${sound.id}/?format=json&fields=name,previews,download`);

  // Prefer OGG HQ preview (no extra auth needed beyond API key)
  const url = info.previews?.['preview-hq-ogg'] ?? info.download;
  const dest = path.join(OUT_DIR, sound.out);

  console.log(`  Downloading → ${dest}`);
  await downloadFile(url, dest);
  console.log(`  Done: ${sound.out}`);
}

console.log('\nAll sounds downloaded. Run `npm run entity:audit` to verify.');
