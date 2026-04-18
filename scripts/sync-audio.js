#!/usr/bin/env node
// Downloads new/updated audio files from a shared Google Drive folder into
// public/assets/packs/audio/{entity}/{filename}.
//
// Naming convention enforced: entity_soundtype[_variant].{ogg|wav|mp3}
// e.g. velcrid_death.ogg, player_footstep_grass.ogg, ambient_forest_night.ogg
//
// Files that fail validation are reported but not downloaded — the agent
// review step will surface them in the PR as warnings.
//
// A manifest at public/assets/packs/audio/.drive-sync.json tracks Drive file
// IDs + modifiedTime so unchanged files are skipped on subsequent runs.
//
// Usage:
//   GOOGLE_DRIVE_AUDIO_FOLDER_ID=… GOOGLE_SERVICE_ACCOUNT_JSON='…' node scripts/sync-audio.js

import { google } from 'googleapis';
import { writeFileSync, createWriteStream, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dirname, '..');
const AUDIO_DIR  = join(ROOT, 'public/assets/packs/audio');
const MANIFEST   = join(AUDIO_DIR, '.drive-sync.json');

// Accepts: entity_soundtype[_qualifier…].ogg|wav|mp3 (all lowercase, underscores)
const NAME_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+\.(ogg|wav|mp3)$/;

// ── Auth ──────────────────────────────────────────────────────────────────────

const FOLDER_ID    = process.env.GOOGLE_DRIVE_AUDIO_FOLDER_ID;
const SA_JSON      = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

if (!FOLDER_ID || !SA_JSON) {
  console.error('Missing GOOGLE_DRIVE_AUDIO_FOLDER_ID or GOOGLE_SERVICE_ACCOUNT_JSON');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function listDriveFiles(drive) {
  const files = [];
  let pageToken;
  do {
    const { data } = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: 'nextPageToken, files(id, name, modifiedTime, size)',
      pageSize: 100,
      ...(pageToken && { pageToken }),
    });
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

async function downloadFile(drive, fileId, destPath) {
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );
  return new Promise((resolve, reject) => {
    const dest = createWriteStream(destPath);
    response.data.pipe(dest);
    dest.on('finish', resolve);
    dest.on('error', reject);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(SA_JSON),
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth });

  // Load existing sync manifest (tracks file ID → modifiedTime)
  const manifest = existsSync(MANIFEST)
    ? JSON.parse(readFileSync(MANIFEST, 'utf8'))
    : {};

  const driveFiles = await listDriveFiles(drive);
  const results = { added: [], skipped: [], invalid: [] };

  for (const file of driveFiles) {
    // Normalise: lowercase + collapse spaces to underscores
    const name = file.name.toLowerCase().replace(/\s+/g, '_');

    if (!NAME_RE.test(name)) {
      results.invalid.push({
        original: file.name,
        reason: 'Name must match entity_soundtype[_variant].ogg — e.g. velcrid_death.ogg',
      });
      continue;
    }

    // Skip unchanged files (same Drive modifiedTime)
    if (manifest[file.id]?.modifiedTime === file.modifiedTime) {
      results.skipped.push(name);
      continue;
    }

    // First path segment is the entity → organise into entity subfolder
    const entity  = name.split('_')[0];
    const destDir = join(AUDIO_DIR, entity);
    mkdirSync(destDir, { recursive: true });
    const destPath = join(destDir, name);

    await downloadFile(drive, file.id, destPath);

    manifest[file.id] = { name, modifiedTime: file.modifiedTime };
    results.added.push({
      name,
      entity,
      path: `public/assets/packs/audio/${entity}/${name}`,
    });
    console.error(`  ✔ ${name}`);
  }

  // Persist updated manifest
  mkdirSync(AUDIO_DIR, { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

  // Emit JSON report on stdout — consumed by the workflow and pr-body builder
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
