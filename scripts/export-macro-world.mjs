#!/usr/bin/env node
/**
 * Export the macro-world tables from Supabase into the repo's JSON files. RECOVERY ONLY.
 *
 * Since #1642 the JSON is master canon and Supabase is generated from it (scripts/macro-sync.mjs).
 * `npm run macro:export` is now the check (`macro-sync.mjs --check`): it reports drift and writes
 * nothing. This script still overwrites the master files from the database, for the rare case where
 * the database holds the right data and the JSON doesn't (a lost commit, a bootstrap); it refuses to
 * run without --overwrite-masters, and what it writes goes through a PR like any other JSON change.
 *
 * It also writes public/macro-world/building-registry.json from Supabase `buildings`; which copy
 * of the buildings is master is still open (docs/canon.md G3).
 *
 * Usage:
 *   node --env-file=.env scripts/export-macro-world.mjs --overwrite-masters
 *
 * Issue: #793, #1642
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MACRO_FILES, LIVE_TABLES, exportFromRows } from './lib/macro-sync-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (!process.argv.includes('--overwrite-masters')) {
  console.error('export-macro-world: the macro-world JSON is master (#1642); this would overwrite it from Supabase.');
  console.error('  To compare instead: npm run macro:export (the check). To overwrite anyway: --overwrite-masters.');
  process.exit(1);
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key);

async function fetchAll(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function main() {
  console.log('Exporting macro-world from Supabase (overwriting the master JSON)...\n');
  const rows = Object.fromEntries(await Promise.all(LIVE_TABLES.map(async t => [t, await fetchAll(t)])));
  const out = exportFromRows(rows);
  for (const [k, p] of Object.entries(MACRO_FILES)) {
    writeFileSync(resolve(root, p), JSON.stringify(out[k], null, 2) + '\n');
    console.log(`  ${p}`);
  }
  writeFileSync(resolve(root, 'public/macro-world/building-registry.json'), JSON.stringify(out.buildingRegistry, null, 2) + '\n');
  console.log('  public/macro-world/building-registry.json');
  console.log('\nDone. Review the diff and commit it by PR.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
