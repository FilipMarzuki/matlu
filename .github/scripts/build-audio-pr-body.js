#!/usr/bin/env node
// Reads the sync-report.json produced by scripts/sync-audio.js and writes
// a markdown PR body to stdout. Used by the audio-sync workflow step that
// calls `gh pr create --body "$(node build-audio-pr-body.js report.json)"`.

import { readFileSync } from 'fs';

const reportPath = process.argv[2];
if (!reportPath) {
  process.stderr.write('Usage: build-audio-pr-body.js <sync-report.json>\n');
  process.exit(1);
}

const { added = [], skipped = [], invalid = [] } = JSON.parse(readFileSync(reportPath, 'utf8'));

const lines = ['## Audio Sync — Google Drive\n'];

if (added.length > 0) {
  lines.push(`### ✅ Added (${added.length})\n`);
  for (const f of added) lines.push(`- \`${f.path}\``);
  lines.push('');
}

if (invalid.length > 0) {
  lines.push(`### ⚠️ Skipped — invalid names (${invalid.length})\n`);
  lines.push('These files were **not downloaded** due to naming issues. Fix the names in Google Drive and re-run.\n');
  for (const f of invalid) lines.push(`- **${f.original}** — ${f.reason}`);
  lines.push('');
  lines.push('**Naming convention:** `entity_soundtype[_variant].ogg` — e.g. `velcrid_death.ogg`, `player_footstep_grass.ogg`\n');
}

if (skipped.length > 0) {
  lines.push(`<details><summary>Already synced, no changes (${skipped.length})</summary>\n`);
  for (const name of skipped) lines.push(`- ${name}`);
  lines.push('\n</details>\n');
}

lines.push('---');
lines.push('_Opened automatically by the audio-sync workflow. Agent review pending._');

process.stdout.write(lines.join('\n') + '\n');
