#!/usr/bin/env node
// Historical backfill for stats_weekly.
// Walks full GitHub history and populates metrics derivable retroactively,
// so charts in the Agentic Experiments site show trends from day one.
// Upserts on week_of — idempotent, safe to re-run.
//
// Prerequisites: ensure stats_weekly columns from FIL-483, FIL-484, FIL-488,
// FIL-489 exist (total_lines_added, total_lines_deleted, avg_files_changed,
// avg_lines_added, avg_lines_deleted, refactor_pr_count, total_pr_count,
// refactor_ratio_pct, bug_file_breakdown) before running.
//
// Run: node .github/scripts/backfill-stats.js
// Env: GITHUB_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const GITHUB_TOKEN              = process.env.GITHUB_TOKEN;
const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REPO_OWNER                = process.env.REPO_OWNER || 'FilipMarzuki';
const REPO_NAME                 = process.env.REPO_NAME  || 'matlu';

if (!GITHUB_TOKEN) {
  console.error('Missing GITHUB_TOKEN');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const REPO_ROOT = join(__dirname, '../..');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ghGet(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub GET ${path} → ${res.status} ${res.statusText}`);
  return res.json();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// GitHub's code_frequency timestamps are Unix seconds, anchored to the
// Sunday that starts each calendar week (GitHub's convention).
const tsToDate = ts => new Date(ts * 1000).toISOString().slice(0, 10);

// Return the Sunday (start of week, matching GitHub's convention) for any date.
function weekSunday(dateStr) {
  const d   = new Date(dateStr);
  const day = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

// ── 1. Weekly code churn (code_frequency API) ─────────────────────────────────

async function fetchCodeFrequency() {
  console.log('[1] Fetching code_frequency stats...');
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/stats/code_frequency`;
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // GitHub returns 202 while it computes the stats cache; retry after a delay.
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers });
    if (res.status === 202) {
      console.log(`  Still computing (attempt ${i + 1}/4), waiting 5s...`);
      await sleep(5000);
      continue;
    }
    if (!res.ok) throw new Error(`code_frequency → ${res.status} ${res.statusText}`);

    // Each row: [unix_timestamp, additions, deletions] — deletions are negative integers.
    const rows = await res.json();
    const byWeek = {};
    for (const [ts, additions, deletions] of rows) {
      byWeek[tsToDate(ts)] = {
        total_lines_added:   additions,
        total_lines_deleted: Math.abs(deletions),
      };
    }
    console.log(`  ${Object.keys(byWeek).length} weeks of churn data.`);
    return byWeek;
  }
  throw new Error('code_frequency returned 202 on all 4 attempts; re-run in a minute.');
}

// ── 2 & 3 & 4. Merged PR data ─────────────────────────────────────────────────

const REFACTOR_KEYWORDS = [
  'refactor', 'rewrite', 'rebuild', 'restructure', 'rename',
  'cleanup', 'clean up', 'simplify', 'migrate', 'extract', 'split',
];

const BUG_KEYWORDS = ['fix', 'bug', 'crash', 'broken'];

async function fetchAllMergedPRs() {
  console.log('[2] Fetching all merged PRs (paginated)...');
  const all = [];
  let page  = 1;
  while (true) {
    const prs = await ghGet(
      `/repos/${REPO_OWNER}/${REPO_NAME}/pulls?state=closed&per_page=100&page=${page}&sort=created&direction=desc`
    );
    all.push(...prs.filter(pr => pr.merged_at));
    if (prs.length < 100) break;
    page++;
    await sleep(100);
  }
  console.log(`  ${all.length} merged PRs found.`);
  return all;
}

// additions, deletions, and changed_files are only on the detail endpoint,
// not the list endpoint — each PR needs its own request.
async function fetchPRDetail(number) {
  await sleep(100);
  return ghGet(`/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${number}`);
}

async function fetchPRFiles(number) {
  await sleep(100);
  return ghGet(`/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${number}/files?per_page=100`);
}

// ── 5. Rework rate (git log per week window) ──────────────────────────────────

// Returns the set of src/ filenames that had at least one commit in [since, until).
function srcFilesInRange(since, until) {
  try {
    const out = execSync(
      `git -C "${REPO_ROOT}" log --since="${since}" --until="${until}" --name-only --pretty=format: -- src/`,
      { encoding: 'utf8' }
    );
    return new Set(out.trim().split('\n').map(l => l.trim()).filter(l => l));
  } catch {
    return new Set();
  }
}

function computeRework(weekStart, weekEnd) {
  const thisWeek = srcFilesInRange(weekStart, weekEnd);
  if (!thisWeek.size) return null;

  // Prior 3-week window: [weekStart − 21 days, weekStart)
  const priorDate = new Date(weekStart);
  priorDate.setUTCDate(priorDate.getUTCDate() - 21);
  const priorStart = priorDate.toISOString().slice(0, 10);
  const priorFiles = srcFilesInRange(priorStart, weekStart);

  const reworkCount = [...thisWeek].filter(f => priorFiles.has(f)).length;
  return {
    rework_rate_pct:     Math.round((reworkCount / thisWeek.size) * 100),
    rework_file_count:   reworkCount,
    new_file_count:      thisWeek.size - reworkCount,
    total_files_changed: thisWeek.size,
  };
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

async function upsertWeek(weekOf, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/stats_weekly?on_conflict=week_of`, {
    method: 'POST',
    headers: {
      apikey:         SUPABASE_SERVICE_ROLE_KEY,
      Authorization:  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      // merge-duplicates: update matching columns on existing rows; insert new rows.
      Prefer:         'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ week_of: weekOf, ...data }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase upsert failed (${weekOf}): ${res.status} ${body}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== stats_weekly historical backfill ===\n');

  // Step 1 — code churn (1 API call with possible retries)
  const codeFreq = await fetchCodeFrequency();

  // Step 2 — all merged PRs (paginated list calls)
  const mergedPRs = await fetchAllMergedPRs();

  // Step 3 — PR detail per merged PR (additions/deletions/changed_files)
  console.log(`\n[3] Fetching PR details (${mergedPRs.length} calls, 100ms each)...`);
  const detailMap = {};
  for (let i = 0; i < mergedPRs.length; i++) {
    detailMap[mergedPRs[i].number] = await fetchPRDetail(mergedPRs[i].number);
    if ((i + 1) % 20 === 0 || i === mergedPRs.length - 1)
      console.log(`  ${i + 1}/${mergedPRs.length}`);
  }

  // Step 4 — files touched by bug PRs (expensive: one call per bug PR)
  const bugPRs = mergedPRs.filter(pr => {
    const t = pr.title.toLowerCase();
    return BUG_KEYWORDS.some(kw => t.includes(kw)) ||
      (pr.labels || []).some(l => l.name === 'bug');
  });
  console.log(`\n[4] Fetching files for ${bugPRs.length} bug PRs (100ms each)...`);
  // Accumulates file hit counts per week across all bug PRs.
  const bugFilesByWeek = {};
  for (let i = 0; i < bugPRs.length; i++) {
    const pr     = bugPRs[i];
    const weekOf = weekSunday(pr.merged_at);
    const files  = await fetchPRFiles(pr.number);
    if (!bugFilesByWeek[weekOf]) bugFilesByWeek[weekOf] = {};
    for (const f of files) {
      bugFilesByWeek[weekOf][f.filename] =
        (bugFilesByWeek[weekOf][f.filename] || 0) + f.changes;
    }
    if ((i + 1) % 10 === 0 || i === bugPRs.length - 1)
      console.log(`  ${i + 1}/${bugPRs.length}`);
  }

  // Group PRs by Sunday-anchored week (consistent with code_frequency timestamps).
  const prsByWeek = {};
  for (const pr of mergedPRs) {
    const w = weekSunday(pr.merged_at);
    (prsByWeek[w] ??= []).push(pr);
  }

  // Union of all weeks from any data source.
  const allWeeks = [
    ...new Set([...Object.keys(codeFreq), ...Object.keys(prsByWeek)]),
  ].sort();

  console.log(`\n[5] Rework + upsert for ${allWeeks.length} weeks...`);
  let weeksWritten = 0;

  for (const weekOf of allWeeks) {
    const row = {};

    // 1. Code churn from stats/code_frequency
    if (codeFreq[weekOf]) Object.assign(row, codeFreq[weekOf]);

    // 2 & 3. PR size + refactor ratio
    const weekPRs = prsByWeek[weekOf] || [];
    if (weekPRs.length > 0) {
      const details = weekPRs.map(pr => detailMap[pr.number]).filter(Boolean);
      row.avg_files_changed  = Math.round(avg(details.map(d => d.changed_files || 0)) * 10) / 10;
      row.avg_lines_added    = Math.round(avg(details.map(d => d.additions     || 0)) * 10) / 10;
      row.avg_lines_deleted  = Math.round(avg(details.map(d => d.deletions     || 0)) * 10) / 10;

      const refactorCount = weekPRs.filter(pr =>
        REFACTOR_KEYWORDS.some(kw => pr.title.toLowerCase().includes(kw))
      ).length;
      row.total_pr_count     = weekPRs.length;
      row.refactor_pr_count  = refactorCount;
      row.refactor_ratio_pct = Math.round((refactorCount / weekPRs.length) * 100);
    }

    // 4. Bug file breakdown (JSONB)
    if (bugFilesByWeek[weekOf]) row.bug_file_breakdown = bugFilesByWeek[weekOf];

    // 5. Rework rate via local git log
    const weekEndDate = new Date(weekOf);
    weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 7);
    const rework = computeRework(weekOf, weekEndDate.toISOString().slice(0, 10));
    if (rework) Object.assign(row, rework);

    if (Object.keys(row).length === 0) continue;

    await upsertWeek(weekOf, row);
    weeksWritten++;
  }

  console.log('\n=== Backfill complete ===');
  console.log(`Weeks written:  ${weeksWritten}`);
  console.log(`PRs scanned:    ${mergedPRs.length}`);
  console.log(`Rows upserted:  ${weeksWritten}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
