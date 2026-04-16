#!/usr/bin/env node
// Weekly engineering stats collector.
// Queries GitHub REST API + Linear GraphQL, then posts a new page to Notion.
// Runs via GitHub Actions — all credentials come from environment secrets.
// Uses only Node.js built-ins (fetch is available in Node 18+).

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

// ESM doesn't have __dirname — reconstruct it from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const GITHUB_TOKEN        = process.env.GITHUB_TOKEN;
const NOTION_API_KEY      = process.env.NOTION_API_KEY;
const NOTION_STATS_PAGE_ID = process.env.NOTION_STATS_PAGE_ID;
const LINEAR_API_KEY      = process.env.LINEAR_API_KEY;
const VERCEL_DEPLOY_HOOK  = process.env.VERCEL_DEPLOY_HOOK;
const VERCEL_TOKEN        = process.env.VERCEL_TOKEN;
const VERCEL_PROJECT_ID   = process.env.VERCEL_PROJECT_ID;
const PIXELLAB_API_KEY    = process.env.PIXELLAB_API_KEY;
const REPO_OWNER          = process.env.REPO_OWNER || 'FilipMarzuki';
const REPO_NAME           = process.env.REPO_NAME  || 'matlu';

if (!NOTION_API_KEY || !NOTION_STATS_PAGE_ID) {
  console.error('Missing NOTION_API_KEY or NOTION_STATS_PAGE_ID');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ghGet(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} → ${res.status}`);
  return res.json();
}

async function linearQuery(query, variables = {}) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      // Linear API keys must NOT have a Bearer prefix — strip it if present
      Authorization: LINEAR_API_KEY.replace(/^Bearer\s+/i, ''),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Linear API → ${res.status}: ${body}`);
  }
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map(e => e.message).join(', '));
  return json.data;
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

// ── Date range: last 7 days ───────────────────────────────────────────────────

const now          = new Date();
const weekAgo      = new Date(now - 7  * 24 * 60 * 60 * 1000);
const twoWeeksAgo  = new Date(now - 14 * 24 * 60 * 60 * 1000);
const weekAgoISO   = weekAgo.toISOString();

// Week label e.g. "Week of 2026-04-14"
const weekLabel = `Week of ${now.toISOString().slice(0, 10)}`;

// ── GitHub stats ──────────────────────────────────────────────────────────────

async function getGitHubStats() {
  // Fetch recently closed PRs (last 100, we'll filter by merged_at)
  const prs = await ghGet(
    `/repos/${REPO_OWNER}/${REPO_NAME}/pulls?state=closed&per_page=100&sort=updated&direction=desc`
  );

  const merged = prs.filter(
    pr => pr.merged_at && new Date(pr.merged_at) >= weekAgo
  );

  // PR sizes (additions + deletions) — fetch each PR detail
  const prDetails = await Promise.all(
    merged.map(pr => ghGet(`/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${pr.number}`))
  );

  const prSizes      = prDetails.map(pr => (pr.additions || 0) + (pr.deletions || 0));
  const avgPrSize    = Math.round(avg(prSizes));
  const mergedCount  = merged.length;

  // Merge time (hours from created_at → merged_at)
  const mergeTimes = prDetails.map(pr =>
    (new Date(pr.merged_at) - new Date(pr.created_at)) / (1000 * 60 * 60)
  );
  const avgMergeTime = Math.round(avg(mergeTimes));

  // Fix/revert PRs
  const fixOrRevert = merged.filter(pr =>
    /\b(fix|revert)\b/i.test(pr.title)
  );
  const fixRevertCount = fixOrRevert.length;
  const fixRevertPct   = mergedCount
    ? Math.round((fixRevertCount / mergedCount) * 100)
    : 0;

  // CI pass rate: workflow runs in the last 7 days
  const runs = await ghGet(
    `/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs?per_page=100&created=>=${weekAgoISO}`
  );
  const completedRuns = (runs.workflow_runs || []).filter(r => r.conclusion);
  const passedRuns    = completedRuns.filter(r => r.conclusion === 'success');
  const ciPassRate    = completedRuns.length
    ? Math.round((passedRuns.length / completedRuns.length) * 100)
    : 100;

  // Top 5 most-changed files
  const fileCounts = {};
  for (const pr of prDetails) {
    const files = await ghGet(
      `/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${pr.number}/files?per_page=100`
    );
    for (const f of files) {
      fileCounts[f.filename] = (fileCounts[f.filename] || 0) + f.changes;
    }
  }
  const top5Files = Object.entries(fileCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Agent vs human PR ratio
  // claude/ branches are opened by the nightly/scheduled cloud agents
  const agentMerged = merged.filter(pr => (pr.head?.ref || '').startsWith('claude/'));
  const agentPrPct  = mergedCount ? Math.round((agentMerged.length / mergedCount) * 100) : 0;

  // Agent success rate: among all claude/ PRs closed this week, what % were merged?
  const agentClosed = prs.filter(pr =>
    (pr.head?.ref || '').startsWith('claude/') &&
    pr.closed_at && new Date(pr.closed_at) >= weekAgo
  );
  const agentSuccessRate = agentClosed.length
    ? Math.round((agentClosed.filter(pr => pr.merged_at).length / agentClosed.length) * 100)
    : null;

  return {
    mergedCount,
    avgPrSize,
    avgMergeTime,
    fixRevertCount,
    fixRevertPct,
    ciPassRate,
    top5Files,
    agentMergedCount:  agentMerged.length,
    humanMergedCount:  merged.length - agentMerged.length,
    agentPrPct,
    agentSuccessRate,
  };
}

// ── Commit spread ────────────────────────────────────────────────────────────

async function getCommitSpread() {
  try {
    const commits = await ghGet(
      `/repos/${REPO_OWNER}/${REPO_NAME}/commits?since=${weekAgoISO}&per_page=100`
    );
    const days = new Set(commits.map(c => c.commit.author.date.slice(0, 10)));
    return { activeDays: days.size, totalCommits: commits.length };
  } catch (e) {
    console.warn('getCommitSpread failed:', e.message);
    return null;
  }
}

// ── Bundle size ───────────────────────────────────────────────────────────────

function getBundleSize() {
  const repoRoot = join(__dirname, '../..');
  try {
    let output = '';
    try {
      output = execSync('npm run build 2>&1', {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co',
          VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || 'placeholder',
          VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY:
            process.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY || 'placeholder',
        },
      });
    } catch (e) {
      // execSync throws on non-zero exit; output is still in e.stdout
      output = (e.stdout || '') + (e.stderr || '');
    }

    const lines = output.split('\n');

    // Vite prints: "dist/assets/index-xxx.js   342.50 kB │ gzip:  98.12 kB"
    const parseKb = str => {
      const m = str.match(/([\d.]+)\s*kB/);
      return m ? parseFloat(m[1]) : 0;
    };
    const parseGzip = str => {
      const m = str.match(/gzip:\s*([\d.]+)\s*kB/);
      return m ? parseFloat(m[1]) : 0;
    };

    const jsLines  = lines.filter(l => /assets\/.*\.js\b/.test(l) && /kB/.test(l));
    const cssLines = lines.filter(l => /assets\/.*\.css\b/.test(l) && /kB/.test(l));

    const totalJsKb   = jsLines.reduce((s, l)  => s + parseKb(l.split('│')[0]), 0);
    const totalCssKb  = cssLines.reduce((s, l) => s + parseKb(l.split('│')[0]), 0);
    const gzipJsKb    = jsLines.reduce((s, l)  => s + parseGzip(l), 0);

    if (!totalJsKb) return null; // build output didn't match expected format

    return {
      jsKb:   Math.round(totalJsKb  * 10) / 10,
      cssKb:  Math.round(totalCssKb * 10) / 10,
      gzipKb: Math.round(gzipJsKb  * 10) / 10,
      totalKb: Math.round((totalJsKb + totalCssKb) * 10) / 10,
    };
  } catch (e) {
    console.warn('getBundleSize failed:', e.message);
    return null;
  }
}

// ── PixelLab credits ──────────────────────────────────────────────────────────

async function getPixelLabStats() {
  if (!PIXELLAB_API_KEY) return null;
  try {
    const res = await fetch('https://api.pixellab.ai/v1/balance', {
      headers: { Authorization: `Bearer ${PIXELLAB_API_KEY}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    // API may return { usd_balance: 12.34 } or { credits: 847 } — handle both
    // API returns {"type":"usd","usd":0.0}
    const usd = data.usd ?? data.credits ?? data.balance ?? null;
    return usd !== null ? { usd } : null;
  } catch (e) {
    console.warn('getPixelLabStats failed:', e.message);
    return null;
  }
}

// ── Vercel deployment frequency ───────────────────────────────────────────────

/**
 * Queries the Vercel REST API for production deployments in the last 14 days,
 * then splits them into "this week" (0-7 days) and "last week" (7-14 days).
 * Returns null gracefully when VERCEL_TOKEN or VERCEL_PROJECT_ID is absent —
 * the same pattern as getPixelLabStats() so missing secrets don't break the run.
 */
async function getDeployStats() {
  if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) return null;
  try {
    // Fetch up to 100 production deployments created in the last 14 days.
    // `since` is a Unix timestamp in milliseconds.
    const sinceMs = twoWeeksAgo.getTime();
    const url =
      `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/deployments` +
      `?limit=100&target=production&since=${sinceMs}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
    });
    if (!res.ok) {
      console.warn(`Vercel deployments API → ${res.status}`);
      return null;
    }

    const data = await res.json();
    // Only count deployments that are both targeting production and succeeded.
    const deployments = (data.deployments || []).filter(
      d => d.target === 'production' && d.state === 'READY'
    );

    const thisWeek = deployments.filter(d => d.createdAt >= weekAgo.getTime());
    const lastWeek = deployments.filter(
      d => d.createdAt >= twoWeeksAgo.getTime() && d.createdAt < weekAgo.getTime()
    );

    return { thisWeek: thisWeek.length, lastWeek: lastWeek.length };
  } catch (e) {
    console.warn('getDeployStats failed:', e.message);
    return null;
  }
}

// ── Linear stats ──────────────────────────────────────────────────────────────

async function getLinearStats() {
  if (!LINEAR_API_KEY) {
    return { completedCount: 0, avgCycleTime: 0, reworkRate: 0, staleInProgress: [] };
  }

  const [completedData, inProgressData] = await Promise.all([
    linearQuery(`
      query WeeklyCompleted {
        issues(
          filter: { state: { type: { eq: "completed" } } }
          first: 100
          orderBy: updatedAt
        ) {
          nodes { id createdAt completedAt }
        }
      }
    `),
    linearQuery(`
      query InProgress {
        issues(
          filter: { state: { type: { eq: "started" } } }
          first: 20
          orderBy: updatedAt
        ) {
          nodes { identifier title updatedAt }
        }
      }
    `),
  ]);

  // Filter client-side to this week's completions
  const issues = completedData.issues.nodes.filter(
    i => i.completedAt && new Date(i.completedAt) >= weekAgo
  );
  const completedCount = issues.length;

  // Cycle time: createdAt → completedAt in days
  const cycleTimes = issues.map(i =>
    (new Date(i.completedAt) - new Date(i.createdAt)) / (1000 * 60 * 60 * 24)
  );
  const avgCycleTime = Math.round(avg(cycleTimes) * 10) / 10;

  // In-progress tickets sorted by days since last update (stale = stuck)
  const staleInProgress = inProgressData.issues.nodes
    .map(i => ({
      id:       i.identifier,
      title:    i.title,
      daysSinceUpdate: Math.round((now - new Date(i.updatedAt)) / (1000 * 60 * 60 * 24)),
    }))
    .sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate)
    .slice(0, 5);

  return { completedCount, avgCycleTime, reworkRate: 0, staleInProgress };
}

// ── AI token usage ────────────────────────────────────────────────────────────

// token-log.json lives at the repo root and is written by log-tokens.cjs after
// each Claude Code session. The GitHub Actions checkout brings it into the runner.

function getAiStats() {
  const logPath = join(__dirname, '../../token-log.json');
  let entries = [];
  try {
    entries = JSON.parse(readFileSync(logPath, 'utf8'));
  } catch (e) {
    return null; // no log yet — skip the section
  }

  // Filter to this week
  const weekEntries = entries.filter(e => new Date(e.date) >= weekAgo);
  if (!weekEntries.length) return null;

  // Total tokens and cost
  const totalInput      = weekEntries.reduce((s, e) => s + (e.inputTokens      || 0), 0);
  const totalOutput     = weekEntries.reduce((s, e) => s + (e.outputTokens     || 0), 0);
  const totalCacheRead  = weekEntries.reduce((s, e) => s + (e.cacheReadTokens  || 0), 0);
  const totalCacheWrite = weekEntries.reduce((s, e) => s + (e.cacheWriteTokens || 0), 0);
  const totalCost       = weekEntries.reduce((s, e) => s + (e.estimatedCostUsd || 0), 0);

  // Cost per issue (group sessions by issueId), tracking model used
  const byIssue = {};
  for (const e of weekEntries) {
    const key = e.issueId || e.branch || 'unknown';
    if (!byIssue[key]) byIssue[key] = { cost: 0, sessions: 0, models: new Set() };
    byIssue[key].cost     += e.estimatedCostUsd || 0;
    byIssue[key].sessions += 1;
    if (e.model) byIssue[key].models.add(e.model);
  }

  // Cost per model
  const byModel = {};
  for (const e of weekEntries) {
    const key = e.model || 'unknown';
    if (!byModel[key]) byModel[key] = { cost: 0, sessions: 0 };
    byModel[key].cost     += e.estimatedCostUsd || 0;
    byModel[key].sessions += 1;
  }

  return {
    sessions:         weekEntries.length,
    totalInput,
    totalOutput,
    totalCacheRead,
    totalCacheWrite,
    totalCost:        Math.round(totalCost * 100) / 100,
    byIssue,
    byModel,
  };
}

// ── Code quality stats ────────────────────────────────────────────────────────

function getCodeQualityStats() {
  const srcPath  = join(__dirname, '../../src');
  const repoRoot = join(__dirname, '../..');
  try {
    let anyCount = 0, tsIgnoreCount = 0, todoCount = 0, testFileCount = 0;
    let linesAdded = 0, linesDeleted = 0;

    const grepCount = (pattern, path = srcPath) => {
      try {
        const out = execSync(
          `grep -r --include="*.ts" --include="*.tsx" -c "${pattern}" "${path}" 2>/dev/null || true`,
          { encoding: 'utf8' }
        );
        return out.trim().split('\n')
          .filter(l => l.includes(':'))
          .reduce((sum, l) => sum + (parseInt(l.split(':').pop(), 10) || 0), 0);
      } catch { return 0; }
    };

    anyCount      = grepCount('as any');
    tsIgnoreCount = grepCount('@ts-ignore');
    todoCount     = grepCount('TODO\\|FIXME\\|HACK');

    try {
      const testsPath = join(__dirname, '../../tests');
      const testOut = execSync(
        `find "${testsPath}" -name "*.spec.ts" -o -name "*.test.ts" 2>/dev/null | wc -l`,
        { encoding: 'utf8' }
      );
      testFileCount = parseInt(testOut.trim(), 10) || 0;
    } catch { /* tests dir may not exist */ }

    // Net lines of code change this week (src/ only)
    try {
      const diffOut = execSync(
        `git -C "${repoRoot}" log --since="${weekAgoISO}" --numstat --format="" -- src/`,
        { encoding: 'utf8' }
      );
      for (const line of diffOut.trim().split('\n').filter(Boolean)) {
        const [a, d] = line.split('\t');
        // Binary files show '-' — skip them
        if (a === '-' || d === '-') continue;
        linesAdded   += parseInt(a, 10) || 0;
        linesDeleted += parseInt(d, 10) || 0;
      }
    } catch { /* git may not be available */ }

    return { anyCount, tsIgnoreCount, todoCount, testFileCount, linesAdded, linesDeleted };
  } catch (e) {
    console.warn('getCodeQualityStats failed:', e.message);
    return null;
  }
}

// ── Cognitive load ───────────────────────────────────────────────────────────

const NOTION_COGNITIVE_LOAD_DB_ID = process.env.NOTION_COGNITIVE_LOAD_DB_ID || null;

/**
 * Compute per-file cognitive load = (lines × branchCount) / 1000.
 * Branch keywords: if, else if, for, while, case, &&, ||, ternary ?
 * Returns top 10 files + total codebase score.
 */
function getCognitiveLoadStats() {
  try {
    const srcDir = join(__dirname, '..', '..', 'src');
    const files = execSync(`find ${srcDir} -name "*.ts" -type f`, { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);

    const branchRe = /\b(if|else\s+if|for|while|case)\b|\?\s|&&|\|\|/g;
    const results = [];
    let totalScore = 0;

    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n').length;
      const branches = (content.match(branchRe) || []).length;
      const score = Math.round(lines * branches / 1000);
      totalScore += score;

      const relative = filePath.replace(srcDir + '/', '');
      results.push({ file: relative, lines, branches, score });
    }

    results.sort((a, b) => b.score - a.score);
    const top10 = results.slice(0, 10);
    const fileCount = files.length;

    return { top10, totalScore, fileCount };
  } catch (e) {
    console.warn('getCognitiveLoadStats failed:', e.message);
    return null;
  }
}

/**
 * Insert a row into the Cognitive Load Notion database for historical tracking.
 * Creates one row per weekly run with the total score, top file, and top 10 JSON.
 */
async function postCognitiveLoadToNotion(cogLoad) {
  if (!NOTION_COGNITIVE_LOAD_DB_ID || !NOTION_API_KEY || !cogLoad) return;

  const top = cogLoad.top10[0] || { file: 'N/A', score: 0 };
  const properties = {
    Date:            { date: { start: isoDate() } },
    'Total Score':   { number: cogLoad.totalScore },
    'Top File':      { rich_text: [{ type: 'text', text: { content: top.file } }] },
    'Top File Score':{ number: top.score },
    'File Count':    { number: cogLoad.fileCount },
    'Top 10':        { rich_text: [{ type: 'text', text: { content: JSON.stringify(cogLoad.top10) } }] },
  };

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent: { database_id: NOTION_COGNITIVE_LOAD_DB_ID },
      properties,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.warn(`Notion cognitive load insert failed: ${res.status} ${body}`);
  } else {
    console.log('Cognitive load row inserted into Notion.');
  }
}

// ── Build Notion page content ──────────────────────────────────────────────────

function buildNotionBlocks(gh, linear, commitSpread, bundle, pixellab, cogLoad, deployStats) {
  const top5Text = gh.top5Files.length
    ? gh.top5Files.map(([f, n], i) => `${i + 1}. \`${f}\` (${n} changes)`).join('\n')
    : 'No file data available.';

  const ai      = getAiStats();
  const quality = getCodeQualityStats();

  const blocks = [
    heading2('Delivery'),
    bullet(`PRs merged: **${gh.mergedCount}** (human: ${gh.humanMergedCount}, agent: ${gh.agentMergedCount})`),
    bullet(`Avg PR size: **${gh.avgPrSize} lines**`),
    bullet(`Issues completed: **${linear.completedCount}**`),
    ...(commitSpread
      ? [bullet(`Active coding days: **${commitSpread.activeDays}/7** (${commitSpread.totalCommits} commits)`)]
      : []),

    heading2('Velocity'),
    bullet(`Avg time to merge: **${gh.avgMergeTime} hours**`),
    bullet(`Avg issue cycle time: **${linear.avgCycleTime} days**`),
    bullet(`Rework rate: **${linear.reworkRate}%**`),

    heading2('Quality'),
    bullet(`CI pass rate: **${gh.ciPassRate}%**`),
    bullet(`PRs with fix/revert in title: **${gh.fixRevertCount}** (${gh.fixRevertPct}%)`),

    heading2('Automation'),
    bullet(`Agent PRs this week: **${gh.agentMergedCount}** (${gh.agentPrPct}% of merged)`),
    ...(gh.agentSuccessRate !== null
      ? [bullet(`Agent success rate: **${gh.agentSuccessRate}%** (merged / closed claude/ PRs)`)]
      : []),

    heading2('Hotspots'),
    paragraph('Top 5 most-changed files this week:'),
    paragraph(top5Text),
  ];

  // In-progress tickets stale >2 days
  const stale = (linear.staleInProgress || []).filter(i => i.daysSinceUpdate >= 2);
  if (stale.length) {
    const staleText = stale
      .map((i, n) => `${n + 1}. ${i.id} — "${i.title}" (${i.daysSinceUpdate}d since update)`)
      .join('\n');
    blocks.push(
      heading2('In Progress (stale)'),
      paragraph('Tickets with no update in ≥2 days:'),
      paragraph(staleText),
    );
  }

  if (ai) {
    const totalTokens = ai.totalInput + ai.totalOutput + ai.totalCacheRead + ai.totalCacheWrite;
    const perIssueLines = Object.entries(ai.byIssue)
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([id, s]) => {
        const modelStr = s.models.size ? ` [${[...s.models].map(m => m.split('-').slice(-2).join('-')).join(', ')}]` : '';
        return `${id}: $${Math.round(s.cost * 100) / 100} (${s.sessions} session${s.sessions > 1 ? 's' : ''})${modelStr}`;
      })
      .join('\n');
    const perModelLines = Object.entries(ai.byModel)
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([m, s]) => `${m}: $${Math.round(s.cost * 100) / 100} (${s.sessions} session${s.sessions > 1 ? 's' : ''})`)
      .join('\n');

    blocks.push(
      heading2('AI Usage (Claude Code)'),
      bullet(`Sessions this week: **${ai.sessions}**`),
      bullet(`Total tokens: **${(totalTokens / 1000).toFixed(1)}k** (${(ai.totalInput/1000).toFixed(1)}k in / ${(ai.totalOutput/1000).toFixed(1)}k out / ${(ai.totalCacheRead/1000).toFixed(1)}k cache-read)`),
      bullet(`Estimated cost: **$${ai.totalCost}**`),
      paragraph('Cost by model:'),
      paragraph(perModelLines || 'No data'),
      paragraph('Cost by feature:'),
      paragraph(perIssueLines || 'No data'),
    );
  }

  if (quality) {
    const net = quality.linesAdded - quality.linesDeleted;
    blocks.push(
      heading2('Code Quality'),
      bullet(`\`as any\` usages: **${quality.anyCount}**`),
      bullet(`\`@ts-ignore\` usages: **${quality.tsIgnoreCount}**`),
      bullet(`TODO / FIXME / HACK: **${quality.todoCount}**`),
      bullet(`Test files: **${quality.testFileCount}**`),
      bullet(`Net lines this week: **${net >= 0 ? '+' : ''}${net}** (+${quality.linesAdded} / -${quality.linesDeleted})`),
    );
  }

  if (bundle) {
    blocks.push(
      heading2('Bundle Size'),
      bullet(`JS: **${bundle.jsKb} kB** (gzip: ${bundle.gzipKb} kB)`),
      ...(bundle.cssKb > 0 ? [bullet(`CSS: **${bundle.cssKb} kB**`)] : []),
      bullet(`Total: **${bundle.totalKb} kB**`),
    );
  }

  if (pixellab) {
    blocks.push(
      heading2('PixelLab Credits'),
      bullet(`Balance: **$${pixellab.usd.toFixed(2)}**`),
    );
  }

  if (deployStats) {
    const trend =
      deployStats.lastWeek === 0
        ? ''
        : deployStats.thisWeek > deployStats.lastWeek
          ? ' ↑'
          : deployStats.thisWeek < deployStats.lastWeek
            ? ' ↓'
            : ' →';
    blocks.push(
      heading2('Deployment Frequency'),
      bullet(`Deploys this week: **${deployStats.thisWeek}**${trend}`),
      bullet(`Deploys last week: **${deployStats.lastWeek}**`),
    );
  }

  if (cogLoad) {
    const top = cogLoad.top10[0];
    const topList = cogLoad.top10
      .map((f, i) => `${i + 1}. \`${f.file}\` — **${f.score}** (${f.lines}L × ${f.branches}br)`)
      .join('\n');
    blocks.push(
      heading2('Cognitive Load'),
      bullet(`Total codebase score: **${cogLoad.totalScore}** (${cogLoad.fileCount} files)`),
      bullet(`Hottest file: **${top.file}** — score **${top.score}** (${top.lines} lines × ${top.branches} branches)`),
      paragraph('Top 10 by cognitive load:'),
      paragraph(topList),
    );
  }

  return blocks;
}

function heading2(text) {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: text } }],
    },
  };
}

function bullet(text) {
  // Parse **bold** into rich_text segments
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: parseInline(text),
    },
  };
}

function paragraph(text) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: text } }],
    },
  };
}

function parseInline(text) {
  // Split on **bold** markers → array of rich_text segments
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) => ({
    type: 'text',
    text: { content: part },
    annotations: { bold: i % 2 === 1 },
  }));
}

// ── Post to Notion ────────────────────────────────────────────────────────────

async function postToNotion(title, children) {
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent: { page_id: NOTION_STATS_PAGE_ID },
      properties: {
        title: {
          title: [{ type: 'text', text: { content: title } }],
        },
      },
      children,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion create page failed: ${res.status} ${body}`);
  }
  return res.json();
}

// ── Trigger Vercel rebuild ────────────────────────────────────────────────────

async function triggerVercelDeploy() {
  if (!VERCEL_DEPLOY_HOOK) {
    console.log('No VERCEL_DEPLOY_HOOK set — skipping Vercel rebuild.');
    return;
  }
  const res = await fetch(VERCEL_DEPLOY_HOOK, { method: 'POST' });
  if (!res.ok) {
    console.warn(`Vercel deploy hook returned ${res.status} — continuing.`);
  } else {
    console.log('Vercel rebuild triggered.');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Collecting stats for ${weekLabel}...`);

  const [gh, linear, commitSpread, pixellab, deployStats] = await Promise.all([
    getGitHubStats(),
    getLinearStats(),
    getCommitSpread(),
    getPixelLabStats(),
    getDeployStats(),
  ]);

  // Bundle size and cognitive load are synchronous — run after async work
  const bundle  = getBundleSize();
  const cogLoad = getCognitiveLoadStats();

  console.log('GitHub stats:', gh);
  console.log('Linear stats:', linear);
  console.log('Commit spread:', commitSpread);
  console.log('Bundle:', bundle);
  console.log('PixelLab:', pixellab);
  console.log('Deploy stats:', deployStats);
  console.log('Cognitive load:', cogLoad ? `total=${cogLoad.totalScore}, top=${cogLoad.top10[0]?.file}` : 'N/A');

  const blocks = buildNotionBlocks(gh, linear, commitSpread, bundle, pixellab, cogLoad, deployStats);
  const page   = await postToNotion(weekLabel, blocks);
  console.log(`Created Notion page: ${page.url}`);

  // Store cognitive load in dedicated Notion database for historical charting
  await postCognitiveLoadToNotion(cogLoad);

  await triggerVercelDeploy();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
