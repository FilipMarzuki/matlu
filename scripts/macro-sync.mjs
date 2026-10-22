#!/usr/bin/env node
/**
 * Macro-world sync (#1642, the sync half of #1640): the repo's macro-world JSON is master canon,
 * and Supabase is generated from it.
 *
 *   npm run macro:sync                  Write a migration for what the JSON changed since origin/main
 *   npm run macro:sync -- --full        Write one for every entity (a baseline, or to repair drift)
 *   npm run macro:sync -- --allow-delete  Also delete the rows the JSON removed (cascades: see docs/canon.md)
 *   npm run macro:sync -- --stdout      Print the SQL instead of writing a file
 *   npm run macro:sync -- --verify      Fail if the branch's sync migration doesn't match its JSON change (CI-able, no network)
 *   npm run macro:export                The check: drift between the JSON and the live database, no writes
 *   npm run macro:export -- --live-dump dump.json   The check against a dump (from --print-dump-query via the Supabase MCP)
 *
 * Options: --base <git ref> (default origin/main), --name <suffix> for the migration file.
 *
 * The migration lands in supabase/migrations/<UTC timestamp>_macro_sync[_suffix].sql. Re-running on
 * the same branch rewrites that branch's sync file instead of adding a second one. Nothing here
 * writes to Supabase: the migration is applied after the PR merges (docs/canon.md, supabase/README.md).
 *
 * The pure JSON → SQL step is in scripts/lib/macro-sync-core.mjs, tested in src/macro-sync.test.ts.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MACRO_FILES, LIVE_TABLES, entitiesFromFiles, diffEntities, isEmptyDiff, generateSyncSql,
  describeDiff, compareEntities, exportFromRows, liveDumpQuery, KINDS,
} from './lib/macro-sync-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = 'supabase/migrations';

const args = process.argv.slice(2);
const flag = f => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** The six master files from the working tree. */
function readHead() {
  return Object.fromEntries(Object.entries(MACRO_FILES).map(([k, p]) => [k, JSON.parse(readFileSync(join(root, p), 'utf8'))]));
}

/** The six master files at a git ref; a file the ref lacks reads as empty. */
function readAt(ref) {
  try { git('rev-parse', '--verify', `${ref}^{commit}`); } catch {
    throw new Error(`git ref "${ref}" not found. Fetch it (git fetch origin main) or pass --base <ref>`);
  }
  return Object.fromEntries(Object.entries(MACRO_FILES).map(([k, p]) => {
    try { return [k, JSON.parse(git('show', `${ref}:${p}`))]; } catch { return [k, undefined]; }
  }));
}

/** Sync migrations on this branch that the base doesn't have. */
function branchSyncFiles(base) {
  const atBase = new Set(git('ls-tree', '--name-only', `${base}`, `${MIGRATIONS}/`).split('\n').map(s => s.trim()).filter(Boolean));
  return readdirSync(join(root, MIGRATIONS))
    .filter(f => /_macro_sync(_[a-z0-9_]+)?\.sql$/.test(f) && !atBase.has(`${MIGRATIONS}/${f}`))
    .sort();
}

/** The SQL for this branch: the diff since base, or everything with --full. */
function buildSql(base) {
  const head = entitiesFromFiles(readHead());
  if (flag('--full')) {
    return { sql: generateSyncSql(head.entities, { biomes: head.biomes, header: ['Full sync: every entity in the JSON.'] }), summary: ['full sync'] };
  }
  const before = entitiesFromFiles(readAt(base));
  const diff = diffEntities(before.entities, head.entities);
  if (isEmptyDiff(diff)) return { sql: '', summary: [] };
  const summary = describeDiff(diff);
  const sql = generateSyncSql(head.entities, {
    only: diff, allowDelete: flag('--allow-delete'), biomes: head.biomes,
    header: [`The JSON's change since ${base}:`, ...summary.map(s => `  ${s}`)],
  });
  return { sql, summary };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function sync() {
  const base = opt('--base', 'origin/main');
  const { sql, summary } = buildSql(base);
  if (!sql) {
    console.log(`macro-sync: the JSON matches ${base}; no migration needed.`);
    return 0;
  }
  if (flag('--stdout')) { process.stdout.write(sql); return 0; }
  const existing = branchSyncFiles(base);
  if (existing.length > 1) {
    throw new Error(`this branch has ${existing.length} sync migrations (${existing.join(', ')}); keep one, then re-run`);
  }
  const suffix = (opt('--name', '') || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const file = existing[0] ?? `${timestamp()}_macro_sync${suffix ? `_${suffix}` : ''}.sql`;
  writeFileSync(join(root, MIGRATIONS, file), sql);
  console.log(`macro-sync: ${existing[0] ? 'rewrote' : 'wrote'} ${MIGRATIONS}/${file}`);
  for (const s of summary) console.log(`  ${s}`);
  console.log('Commit it with the JSON change. It is applied after the PR merges (docs/canon.md).');
  return 0;
}

/** --verify: the branch's sync migration is exactly what its JSON change generates. */
function verify() {
  const base = opt('--base', 'origin/main');
  const { sql, summary } = buildSql(base);
  const files = branchSyncFiles(base);
  if (!sql && !files.length) { console.log('macro-sync verify: no JSON change, no sync migration. OK'); return 0; }
  if (!sql) { console.error(`macro-sync verify: ${files.join(', ')} but the JSON hasn't changed since ${base}`); return 1; }
  if (!files.length) {
    console.error(`macro-sync verify: the JSON changed (${summary.join('; ')}) but there's no sync migration. Run npm run macro:sync and commit it.`);
    return 1;
  }
  if (files.length > 1) { console.error(`macro-sync verify: more than one sync migration: ${files.join(', ')}`); return 1; }
  const have = readFileSync(join(root, MIGRATIONS, files[0]), 'utf8');
  if (have !== sql) {
    console.error(`macro-sync verify: ${files[0]} is out of date with the JSON. Re-run npm run macro:sync and commit it.`);
    return 1;
  }
  console.log(`macro-sync verify: ${files[0]} matches the JSON change. OK`);
  return 0;
}

/** Read every table the check needs, with the service key. */
async function fetchLive() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const out = {};
  for (const t of LIVE_TABLES) {
    const rows = [];
    // PostgREST caps a response (1000 rows by default), so page through.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(t).select('*').range(from, from + 999);
      if (error) throw new Error(`${t}: ${error.message}`);
      rows.push(...data);
      if (data.length < 1000) break;
    }
    out[t] = rows;
  }
  return out;
}

/** --check: compare the live database with the JSON. Exit 1 on drift, 0 when it matches or can't check. */
async function check() {
  const dumpPath = opt('--live-dump', null);
  let rows;
  if (dumpPath) {
    const raw = JSON.parse(readFileSync(resolve(dumpPath), 'utf8'));
    // Accept the MCP's result shape ([{ dump: {...} }]) or the bare object.
    rows = Array.isArray(raw) ? raw[0].dump : raw.dump ?? raw;
  } else {
    rows = await fetchLive();
    if (!rows) {
      console.log('macro-sync check: skipped. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or --live-dump <file>');
      console.log('  (dump with the Supabase MCP execute_sql: node scripts/macro-sync.mjs --print-dump-query).');
      return 0;
    }
  }
  for (const t of LIVE_TABLES) if (!Array.isArray(rows[t])) throw new Error(`live data has no "${t}" rows`);
  const live = entitiesFromFiles(exportFromRows(rows)).entities;
  const repo = entitiesFromFiles(readHead()).entities;
  const report = compareEntities(repo, live);
  let drift = false;
  for (const k of KINDS) {
    const r = report[k];
    const lines = [];
    if (r.missingLive.length) lines.push(`  in the JSON, missing live: ${r.missingLive.join(', ')}`);
    if (r.differs.length) lines.push(`  differ: ${r.differs.join(', ')}`);
    if (r.liveOnly.length) lines.push(`  live only (not in the JSON): ${r.liveOnly.join(', ')}`);
    if (lines.length) { drift = true; console.log(`${k}:`); lines.forEach(l => console.log(l)); }
    if (flag('--verbose')) {
      for (const key of r.differs) console.log(`    ${key}\n      json: ${JSON.stringify(repo[k][key])}\n      live: ${JSON.stringify(live[k][key])}`);
    }
  }
  console.log(drift
    ? 'macro-sync check: the live database differs from the JSON (master). Apply the pending migrations in supabase/migrations/, or write one with npm run macro:sync -- --full.'
    : 'macro-sync check: the live database matches the JSON.');
  return drift ? 1 : 0;
}

async function main() {
  if (flag('--print-dump-query')) { console.log(liveDumpQuery()); return 0; }
  if (flag('--check')) return check();
  if (flag('--verify')) return verify();
  if (!existsSync(join(root, MIGRATIONS))) throw new Error(`${MIGRATIONS}/ not found`);
  return sync();
}

main().then(code => process.exit(code)).catch(err => {
  console.error(`macro-sync: ${err.message}`);
  process.exit(2);
});
