#!/usr/bin/env node
// Weekly engineering stats collector.
// Queries GitHub REST API + Linear GraphQL, posts to Supabase (master),
// then pushes a copy to Notion so stats are visible there too.
// Runs via GitHub Actions — all credentials come from environment secrets.
// Uses only Node.js built-ins (fetch is available in Node 18+).

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

// ESM doesn't have __dirname — reconstruct it from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const GITHUB_TOKEN              = process.env.GITHUB_TOKEN;
const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LINEAR_API_KEY            = process.env.LINEAR_API_KEY;
const VERCEL_DEPLOY_HOOK        = process.env.VERCEL_DEPLOY_HOOK;
const VERCEL_TOKEN              = process.env.VERCEL_TOKEN;
const VERCEL_PROJECT_ID         = process.env.VERCEL_PROJECT_ID;
const PIXELLAB_API_KEY          = process.env.PIXELLAB_API_KEY;
const NOTION_API_KEY            = process.env.NOTION_API_KEY;
const NOTION_STATS_PAGE_ID      = process.env.NOTION_STATS_PAGE_ID;
const REPO_OWNER                = process.env.REPO_OWNER || 'FilipMarzuki';
const REPO_NAME                 = process.env.REPO_NAME  || 'matlu';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
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

// Returns today's date as a Notion-compatible ISO date string (YYYY-MM-DD)
const isoDate = () => now.toISOString().slice(0, 10);

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

  // Open PRs — count and average age (for cognitive load snapshot)
  const openPrList       = await ghGet(`/repos/${REPO_OWNER}/${REPO_NAME}/pulls?state=open&per_page=100`);
  const openPrCount      = openPrList.length;
  const openPrAvgAgeDays = openPrList.length
    ? Math.round(avg(openPrList.map(pr => (now - new Date(pr.created_at)) / (1000 * 60 * 60 * 24))) * 10) / 10
    : 0;

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
    openPrCount,
    openPrAvgAgeDays,
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

// ── Linear lead time (DORA metric 2) ─────────────────────────────────────────

/**
 * Queries Linear GraphQL for issues completed in the last 14 days and computes
 * lead time (completedAt − createdAt) for this week and the prior week.
 *
 * Lead time is the most direct measure of delivery speed: from the moment an
 * issue is created to the moment it is marked done. Long lead times indicate
 * batching, blocking, or incomplete issue decomposition.
 *
 * Returns null gracefully when LINEAR_API_KEY is absent.
 */
async function getLinearLeadTimeStats() {
  if (!LINEAR_API_KEY) {
    console.log('LINEAR_API_KEY not set — skipping lead time stats.');
    return null;
  }

  const query = `
    query LeadTime($after: DateTime!) {
      issues(
        filter: { completedAt: { gte: $after } }
        first: 250
        orderBy: completedAt
      ) {
        nodes {
          id
          completedAt
          createdAt
        }
      }
    }
  `;

  let nodes;
  try {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        Authorization: LINEAR_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { after: twoWeeksAgo.toISOString() },
      }),
    });
    if (!res.ok) {
      console.warn(`Linear GraphQL → ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (data.errors) {
      console.warn('Linear GraphQL errors:', JSON.stringify(data.errors));
      return null;
    }
    nodes = data.data?.issues?.nodes ?? [];
  } catch (e) {
    console.warn('getLinearLeadTimeStats failed:', e.message);
    return null;
  }

  // Split into this-week and last-week buckets by completedAt.
  const thisWeekNodes = nodes.filter(n => new Date(n.completedAt) >= weekAgo);
  const lastWeekNodes = nodes.filter(
    n => new Date(n.completedAt) >= twoWeeksAgo && new Date(n.completedAt) < weekAgo,
  );

  // Lead time in fractional days (completedAt − createdAt).
  const leadDays = (n) =>
    (new Date(n.completedAt) - new Date(n.createdAt)) / (1000 * 60 * 60 * 24);

  const p90 = (arr) => {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * 0.9) - 1;
    return Math.round(sorted[Math.max(0, idx)] * 10) / 10;
  };

  const thisWeekTimes = thisWeekNodes.map(leadDays);
  const lastWeekTimes = lastWeekNodes.map(leadDays);

  const thisAvg = thisWeekTimes.length
    ? Math.round(avg(thisWeekTimes) * 10) / 10
    : null;
  const lastAvg = lastWeekTimes.length
    ? Math.round(avg(lastWeekTimes) * 10) / 10
    : null;

  // Trend: >10% improvement is "improving", >10% degradation is "degrading".
  let trend = 'stable';
  if (thisAvg !== null && lastAvg !== null && lastAvg > 0) {
    const changePct = (thisAvg - lastAvg) / lastAvg;
    if (changePct < -0.10) trend = 'improving';
    else if (changePct >  0.10) trend = 'degrading';
  }

  return {
    thisWeek: {
      avg:   thisAvg,
      p90:   p90(thisWeekTimes),
      count: thisWeekNodes.length,
    },
    lastWeek: {
      avg:   lastAvg,
      p90:   p90(lastWeekTimes),
      count: lastWeekNodes.length,
    },
    trend,
  };
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

// ── Issue stats (GitHub) ──────────────────────────────────────────────────────

async function getIssueStats() {
  // Issues closed this week — GitHub's `since` param filters by updated_at,
  // so we also check closed_at client-side. PRs share the issues endpoint;
  // filter them out via the pull_request field.
  const closed = await ghGet(
    `/repos/${REPO_OWNER}/${REPO_NAME}/issues?state=closed&since=${weekAgoISO}&per_page=100`
  );
  const thisWeek = closed.filter(
    i => !i.pull_request && i.closed_at && new Date(i.closed_at) >= weekAgo
  );
  const completedCount = thisWeek.length;

  // Cycle time: created_at → closed_at in days
  const cycleTimes = thisWeek.map(
    i => (new Date(i.closed_at) - new Date(i.created_at)) / (1000 * 60 * 60 * 24)
  );
  const avgCycleTime = Math.round(avg(cycleTimes) * 10) / 10;

  // Open issues sorted oldest-updated-first as a proxy for "stale in progress"
  const open = await ghGet(
    `/repos/${REPO_OWNER}/${REPO_NAME}/issues?state=open&per_page=20&sort=updated&direction=asc`
  );
  const openIssues = open.filter(i => !i.pull_request);
  const staleInProgress = openIssues
    .map(i => ({
      id:              `#${i.number}`,
      title:           i.title,
      daysSinceUpdate: Math.round((now - new Date(i.updated_at)) / (1000 * 60 * 60 * 24)),
    }))
    .sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate)
    .slice(0, 5);

  return { completedCount, avgCycleTime, reworkRate: 0, staleInProgress, inProgressCount: openIssues.length };
}

// ── AI token usage ────────────────────────────────────────────────────────────

// token-log.json lives at the repo root and is written by log-tokens.cjs after
// each Claude Code session. The GitHub Actions checkout brings it into the runner.

// Merges local token-log.json (developer sessions) with Supabase ai_sessions
// (GitHub Actions agent sessions) into a unified weekly AI usage snapshot.
async function getAiStats() {
  // ── Local sessions (token-log.json, written by Stop hook) ────────────────
  let localEntries = [];
  try {
    const logPath = join(__dirname, '../../token-log.json');
    const all = JSON.parse(readFileSync(logPath, 'utf8'));
    localEntries = all
      .filter(e => new Date(e.date) >= weekAgo)
      .map(e => ({
        issueId:         e.issueId,
        branch:          e.branch,
        model:           e.model,
        source:          e.source ?? 'claude-code',
        inputTokens:     e.inputTokens      ?? 0,
        outputTokens:    e.outputTokens     ?? 0,
        cacheReadTokens: e.cacheReadTokens  ?? 0,
        cacheWriteTokens:e.cacheWriteTokens ?? 0,
        estimatedCostUsd:e.estimatedCostUsd ?? 0,
      }));
  } catch (e) { /* no local log yet */ }

  // ── CI sessions (Supabase ai_sessions, written by log-session-tokens.js) ─
  let ciEntries = [];
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const since = weekAgo.toISOString().slice(0, 10);
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/ai_sessions?select=*&recorded_at=gte.${since}&source=eq.github-actions`,
        { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
      );
      if (res.ok) {
        const rows = await res.json();
        ciEntries = rows.map(r => ({
          issueId:          r.issue_id  ?? r.workflow,
          branch:           r.branch,
          model:            r.model,
          source:           r.source,
          inputTokens:      r.input_tokens       ?? 0,
          outputTokens:     r.output_tokens      ?? 0,
          cacheReadTokens:  r.cache_read_tokens  ?? 0,
          cacheWriteTokens: r.cache_write_tokens ?? 0,
          estimatedCostUsd: parseFloat(r.estimated_cost_usd ?? 0),
        }));
      }
    } catch (e) {
      console.warn('getAiStats: Supabase fetch failed:', e.message);
    }
  }

  const weekEntries = [...localEntries, ...ciEntries];
  if (!weekEntries.length) return null;

  // Total tokens and cost
  const totalInput      = weekEntries.reduce((s, e) => s + e.inputTokens,      0);
  const totalOutput     = weekEntries.reduce((s, e) => s + e.outputTokens,     0);
  const totalCacheRead  = weekEntries.reduce((s, e) => s + e.cacheReadTokens,  0);
  const totalCacheWrite = weekEntries.reduce((s, e) => s + e.cacheWriteTokens, 0);
  const totalCost       = weekEntries.reduce((s, e) => s + e.estimatedCostUsd, 0);

  // Cost per issue (group sessions by issueId), tracking model used
  const byIssue = {};
  for (const e of weekEntries) {
    const key = e.issueId || e.branch || 'unknown';
    if (!byIssue[key]) byIssue[key] = { cost: 0, sessions: 0, models: new Set() };
    byIssue[key].cost     += e.estimatedCostUsd;
    byIssue[key].sessions += 1;
    if (e.model) byIssue[key].models.add(e.model);
  }

  // Cost per model
  const byModel = {};
  for (const e of weekEntries) {
    const key = e.model || 'unknown';
    if (!byModel[key]) byModel[key] = { cost: 0, sessions: 0 };
    byModel[key].cost     += e.estimatedCostUsd;
    byModel[key].sessions += 1;
  }

  // Cost by source (local dev vs CI agents)
  const bySource = {};
  for (const e of weekEntries) {
    const key = e.source || 'unknown';
    if (!bySource[key]) bySource[key] = { cost: 0, sessions: 0 };
    bySource[key].cost     += e.estimatedCostUsd;
    bySource[key].sessions += 1;
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
    bySource,
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

// ── Agent outcome stats (GitHub) ─────────────────────────────────────────────

// Queries GitHub Issues for issues with agent:* labels updated this week.
// Returns outcome counts + per-category breakdown stored in metrics.agentOutcome.
async function getAgentOutcomeStats() {
  const outcomeNames = [
    'agent:success', 'agent:partial', 'agent:failed', 'agent:wrong-interpretation',
  ];

  let issues;
  try {
    // Fetch all issues (open + closed) updated since weekAgo; filter PRs out.
    const all = await ghGet(
      `/repos/${REPO_OWNER}/${REPO_NAME}/issues?state=all&since=${weekAgoISO}&per_page=100`
    );
    issues = all.filter(
      i => !i.pull_request &&
           i.labels.some(l => outcomeNames.includes(l.name))
    );
  } catch (e) {
    console.warn('getAgentOutcomeStats failed:', e.message);
    return null;
  }

  if (!issues.length) return null;

  const counts = {
    'agent:success': 0,
    'agent:partial': 0,
    'agent:failed': 0,
    'agent:wrong-interpretation': 0,
  };
  const byType = {};

  for (const issue of issues) {
    const labelNames = issue.labels.map(l => l.name);
    const outcome = outcomeNames.find(n => labelNames.includes(n));
    if (!outcome) continue;
    counts[outcome]++;

    // Use the first non-agent label as the category, falling back to 'other'.
    const category = labelNames.find(l => !l.startsWith('agent:')) || 'other';
    if (!byType[category]) {
      byType[category] = { success: 0, partial: 0, failed: 0, wrong_interp: 0, total: 0 };
    }
    const key = outcome === 'agent:wrong-interpretation' ? 'wrong_interp' : outcome.replace('agent:', '');
    byType[category][key]++;
    byType[category].total++;
  }

  const total = issues.length;
  const failureRate = total
    ? Math.round(
        ((counts['agent:failed'] + counts['agent:wrong-interpretation']) / total) * 100
      )
    : 0;

  return {
    total,
    success:     counts['agent:success'],
    partial:     counts['agent:partial'],
    failed:      counts['agent:failed'],
    wrongInterp: counts['agent:wrong-interpretation'],
    failureRate,
    byType,
  };
}

// ── Slugify ───────────────────────────────────────────────────────────────────

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// ── Build markdown ────────────────────────────────────────────────────────────

function buildMarkdown(gh, linear, commitSpread, bundle, pixellab, cogLoad, deployStats, ai, quality, rework, agentOutcome, leadTime) {
  const lines = [];
  const h2 = (t) => { lines.push(`## ${t}`, ''); };
  const li = (t) => lines.push(`- ${t}`);
  const p  = (t) => { lines.push(t, ''); };

  h2('Delivery');
  li(`PRs merged: **${gh.mergedCount}** (human: ${gh.humanMergedCount}, agent: ${gh.agentMergedCount})`);
  li(`Avg PR size: **${gh.avgPrSize} lines**`);
  li(`Issues completed: **${linear.completedCount}**`);
  if (commitSpread) li(`Active coding days: **${commitSpread.activeDays}/7** (${commitSpread.totalCommits} commits)`);
  lines.push('');

  h2('Velocity');
  li(`Avg time to merge: **${gh.avgMergeTime} hours**`);
  li(`Avg issue cycle time: **${linear.avgCycleTime} days**`);
  if (leadTime?.thisWeek?.avg !== null && leadTime?.thisWeek?.avg !== undefined) {
    const trendArrow = leadTime.trend === 'improving' ? ' ↓' : leadTime.trend === 'degrading' ? ' ↑⚠️' : '';
    li(`Lead time (Linear, this week): **${leadTime.thisWeek.avg}d** avg / **${leadTime.thisWeek.p90}d** p90 (n=${leadTime.thisWeek.count})${trendArrow}`);
    if (leadTime.lastWeek?.avg !== null && leadTime.lastWeek?.avg !== undefined) {
      li(`Lead time (last week): ${leadTime.lastWeek.avg}d avg / ${leadTime.lastWeek.p90}d p90 (n=${leadTime.lastWeek.count})`);
    }
  }
  li(`Rework rate: **${linear.reworkRate}%**`);
  lines.push('');

  h2('Quality');
  li(`CI pass rate: **${gh.ciPassRate}%**`);
  li(`PRs with fix/revert in title: **${gh.fixRevertCount}** (${gh.fixRevertPct}%)`);
  lines.push('');

  h2('Automation');
  li(`Agent PRs this week: **${gh.agentMergedCount}** (${gh.agentPrPct}% of merged)`);
  if (gh.agentSuccessRate !== null) li(`Agent success rate: **${gh.agentSuccessRate}%** (merged / closed claude/ PRs)`);
  lines.push('');

  if (agentOutcome) {
    const pct = (n) => agentOutcome.total ? ` (${Math.round((n / agentOutcome.total) * 100)}%)` : '';
    h2('Agent Outcome Breakdown');
    li(`Issues processed: **${agentOutcome.total}**`);
    li(`Success: **${agentOutcome.success}**${pct(agentOutcome.success)} | Partial: **${agentOutcome.partial}**${pct(agentOutcome.partial)} | Failed: **${agentOutcome.failed}**${pct(agentOutcome.failed)} | Wrong interpretation: **${agentOutcome.wrongInterp}**${pct(agentOutcome.wrongInterp)}`);
    li(`Failure rate: **${agentOutcome.failureRate}%**${agentOutcome.failureRate >= 20 ? ' ⚠️' : ''}`);
    if (Object.keys(agentOutcome.byType).length) {
      const typeRows = Object.entries(agentOutcome.byType)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([cat, c]) => {
          const rate = c.total ? Math.round(((c.failed + c.wrong_interp) / c.total) * 100) : 0;
          return `${cat}: ${c.total} issues (✓${c.success} ~${c.partial} ✗${c.failed} ?${c.wrong_interp}) ${rate >= 20 ? '⚠️' : ''}`;
        })
        .join('\n');
      p('By category:');
      p(typeRows);
    }
  }

  const top5Text = gh.top5Files.length
    ? gh.top5Files.map(([f, n], i) => `${i + 1}. \`${f}\` (${n} changes)`).join('\n')
    : 'No file data available.';
  h2('Hotspots');
  p('Top 5 most-changed files this week:');
  p(top5Text);

  const stale = (linear.staleInProgress || []).filter(i => i.daysSinceUpdate >= 2);
  if (stale.length) {
    const staleText = stale
      .map((i, n) => `${n + 1}. ${i.id} — "${i.title}" (${i.daysSinceUpdate}d since update)`)
      .join('\n');
    h2('In Progress (stale)');
    p('Tickets with no update in ≥2 days:');
    p(staleText);
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

    h2('AI Usage (Claude Code)');
    li(`Sessions this week: **${ai.sessions}**`);
    li(`Total tokens: **${(totalTokens / 1000).toFixed(1)}k** (${(ai.totalInput/1000).toFixed(1)}k in / ${(ai.totalOutput/1000).toFixed(1)}k out / ${(ai.totalCacheRead/1000).toFixed(1)}k cache-read)`);
    li(`Estimated cost: **$${ai.totalCost}**`);
    p('Cost by model:');
    p(perModelLines || 'No data');
    p('Cost by feature:');
    p(perIssueLines || 'No data');
  }

  if (quality) {
    const net = quality.linesAdded - quality.linesDeleted;
    h2('Code Quality');
    li(`\`as any\` usages: **${quality.anyCount}**`);
    li(`\`@ts-ignore\` usages: **${quality.tsIgnoreCount}**`);
    li(`TODO / FIXME / HACK: **${quality.todoCount}**`);
    li(`Test files: **${quality.testFileCount}**`);
    li(`Net lines this week: **${net >= 0 ? '+' : ''}${net}** (+${quality.linesAdded} / -${quality.linesDeleted})`);
    lines.push('');
  }

  if (bundle) {
    h2('Bundle Size');
    li(`JS: **${bundle.jsKb} kB** (gzip: ${bundle.gzipKb} kB)`);
    if (bundle.cssKb > 0) li(`CSS: **${bundle.cssKb} kB**`);
    li(`Total: **${bundle.totalKb} kB**`);
    lines.push('');
  }

  if (pixellab) {
    h2('PixelLab Credits');
    li(`Balance: **$${pixellab.usd.toFixed(2)}**`);
    lines.push('');
  }

  if (deployStats) {
    const trend = deployStats.lastWeek === 0 ? ''
      : deployStats.thisWeek > deployStats.lastWeek ? ' ↑'
      : deployStats.thisWeek < deployStats.lastWeek ? ' ↓'
      : ' →';
    h2('Deployment Frequency');
    li(`Deploys this week: **${deployStats.thisWeek}**${trend}`);
    li(`Deploys last week: **${deployStats.lastWeek}**`);
    lines.push('');
  }

  if (cogLoad) {
    const top = cogLoad.top10[0];
    const topList = cogLoad.top10
      .map((f, i) => `${i + 1}. \`${f.file}\` — **${f.score}** (${f.lines}L × ${f.branches}br)`)
      .join('\n');
    h2('Cognitive Load');
    li(`Total codebase score: **${cogLoad.totalScore}** (${cogLoad.fileCount} files)`);
    li(`Hottest file: **${top.file}** — score **${top.score}** (${top.lines} lines × ${top.branches} branches)`);
    p('Top 10 by cognitive load:');
    p(topList);
  }

  if (rework) {
    const topList = rework.topReworkFiles
      .map((f, i) => `${i + 1}. \`${f.file}\` — **${f.changes}** changes`)
      .join('\n');
    h2('Rework');
    li(`Rework rate: **${rework.reworkRate}%** (${rework.reworkFileCount} of ${rework.totalFiles} files touched this week were also changed in prior 3 weeks)`);
    li(`New files: **${rework.newFileCount}** | Rework files: **${rework.reworkFileCount}**`);
    if (rework.topReworkFiles.length > 0) {
      p('Top rework hotspots:');
      p(topList);
    }
  }

  return lines.join('\n');
}

// ── Rework stats ─────────────────────────────────────────────────────────────

/**
 * Computes rework rate: % of src/ files changed this week that were also
 * changed in the prior 3 weeks (indicating churn / repeated edits).
 */
function getReworkStats() {
  const repoRoot = join(__dirname, '../..');
  try {
    const threeWeeksAgo    = new Date(now - 28 * 24 * 60 * 60 * 1000);
    const threeWeeksAgoISO = threeWeeksAgo.toISOString();

    const gitNumstat = (since, until) => {
      const untilFlag = until ? `--until="${until}"` : '';
      return execSync(
        `git -C "${repoRoot}" log --since="${since}" ${untilFlag} --numstat --format="" -- src/`,
        { encoding: 'utf8' }
      );
    };

    const parseFiles = (out) => {
      const files = {};
      for (const line of out.trim().split('\n').filter(Boolean)) {
        const [a, d, file] = line.split('\t');
        if (!file || a === '-' || d === '-') continue;
        files[file] = (files[file] || 0) + (parseInt(a) || 0) + (parseInt(d) || 0);
      }
      return files;
    };

    const thisWeekFiles = parseFiles(gitNumstat(weekAgoISO));
    const priorFiles    = new Set(Object.keys(parseFiles(gitNumstat(threeWeeksAgoISO, weekAgoISO))));

    const totalFiles = Object.keys(thisWeekFiles).length;
    if (!totalFiles) return null;

    const reworkEntries  = Object.entries(thisWeekFiles).filter(([f]) => priorFiles.has(f));
    const reworkFileCount = reworkEntries.length;
    const reworkRate      = Math.round((reworkFileCount / totalFiles) * 100);
    const topReworkFiles  = reworkEntries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([file, changes]) => ({ file, changes }));

    return {
      reworkRate,
      reworkFileCount,
      newFileCount:   totalFiles - reworkFileCount,
      totalFiles,
      topReworkFiles,
    };
  } catch (e) {
    console.warn('getReworkStats failed:', e.message);
    return null;
  }
}

// ── Post to Supabase ──────────────────────────────────────────────────────────

async function postToSupabase(title, content, metrics, { gh, linear, commitSpread, bundle, pixellab, cogLoad, deployStats, ai, quality, rework, agentOutcome, leadTime }) {
  const ao = agentOutcome;
  const aiTotalTokens = ai
    ? (ai.totalInput + ai.totalOutput + ai.totalCacheRead + ai.totalCacheWrite)
    : null;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/stats_weekly?on_conflict=week_of`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      week_of: isoDate(),
      title,
      slug:    slugify(title),
      content,
      metrics,

      // ── Delivery ────────────────────────────────────────────────────────────
      prs_merged:               gh.mergedCount,
      human_prs:                gh.humanMergedCount,
      agent_prs:                gh.agentMergedCount,
      avg_pr_size:              gh.avgPrSize,
      issues_completed:         linear.completedCount,
      active_days:              commitSpread?.activeDays   ?? null,
      total_commits:            commitSpread?.totalCommits ?? null,

      // ── Velocity ────────────────────────────────────────────────────────────
      avg_merge_time_hours:     gh.avgMergeTime,
      avg_cycle_time_days:      linear.avgCycleTime,

      // ── Quality ─────────────────────────────────────────────────────────────
      ci_pass_rate_pct:         gh.ciPassRate,
      fix_revert_count:         gh.fixRevertCount,
      fix_revert_pct:           gh.fixRevertPct,
      any_count:                quality?.anyCount       ?? null,
      ts_ignore_count:          quality?.tsIgnoreCount  ?? null,
      todo_count:               quality?.todoCount      ?? null,
      test_file_count:          quality?.testFileCount  ?? null,
      lines_added:              quality?.linesAdded     ?? null,
      lines_deleted:            quality?.linesDeleted   ?? null,

      // ── Automation ──────────────────────────────────────────────────────────
      agent_pr_share_pct:       gh.agentPrPct,
      agent_success_rate_pct:   gh.agentSuccessRate,

      // ── Rework ──────────────────────────────────────────────────────────────
      rework_rate_pct:          rework?.reworkRate      ?? null,
      rework_file_count:        rework?.reworkFileCount ?? null,
      new_file_count:           rework?.newFileCount    ?? null,
      total_files_changed:      rework?.totalFiles      ?? null,
      top_rework_file:          rework?.topReworkFiles?.[0]?.file    ?? null,
      top_rework_hits:          rework?.topReworkFiles?.[0]?.changes ?? null,

      // ── Cognitive load ──────────────────────────────────────────────────────
      cognitive_load_total:     cogLoad?.totalScore     ?? null,
      cognitive_load_top_file:  cogLoad?.top10?.[0]?.file  ?? null,
      cognitive_load_top_score: cogLoad?.top10?.[0]?.score ?? null,
      ts_file_count:            cogLoad?.fileCount      ?? null,
      cognitive_load_top10:     cogLoad?.top10          ?? null,

      // ── AI usage ────────────────────────────────────────────────────────────
      ai_sessions:              ai?.sessions            ?? null,
      ai_total_tokens:          aiTotalTokens,
      ai_input_tokens:          ai?.totalInput          ?? null,
      ai_output_tokens:         ai?.totalOutput         ?? null,
      ai_cache_read_tokens:     ai?.totalCacheRead      ?? null,
      ai_cache_write_tokens:    ai?.totalCacheWrite     ?? null,
      ai_total_cost_usd:        ai?.totalCost           ?? null,

      // ── Bundle ──────────────────────────────────────────────────────────────
      bundle_js_kb:             bundle?.jsKb            ?? null,
      bundle_css_kb:            bundle?.cssKb           ?? null,
      bundle_gzip_kb:           bundle?.gzipKb          ?? null,
      bundle_total_kb:          bundle?.totalKb         ?? null,

      // ── Deploys ─────────────────────────────────────────────────────────────
      deploys_this_week:        deployStats?.thisWeek   ?? null,
      deploys_last_week:        deployStats?.lastWeek   ?? null,

      // ── Lead time (DORA metric 2) ────────────────────────────────────────────
      lead_time_avg_days:       leadTime?.thisWeek?.avg   ?? null,
      lead_time_p90_days:       leadTime?.thisWeek?.p90   ?? null,
      lead_time_count:          leadTime?.thisWeek?.count ?? null,
      lead_time_trend:          leadTime?.trend           ?? null,
      lead_time_prev_avg:       leadTime?.lastWeek?.avg   ?? null,

      // ── PixelLab ────────────────────────────────────────────────────────────
      pixellab_balance_usd:     pixellab?.usd           ?? null,

      // ── Agent outcome ────────────────────────────────────────────────────────
      agent_issues_processed:     ao?.total       ?? null,
      agent_outcome_success:      ao?.success      ?? null,
      agent_outcome_partial:      ao?.partial      ?? null,
      agent_outcome_failed:       ao?.failed       ?? null,
      agent_outcome_wrong_interp: ao?.wrongInterp  ?? null,
      agent_failure_rate_pct:     ao?.failureRate  ?? null,
      agent_outcome_by_type:      ao?.byType       ?? null,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase insert failed: ${res.status} ${body}`);
  }
  console.log(`Stats upserted to Supabase for week ${isoDate()}.`);
}


// ── Push stats to Notion ──────────────────────────────────────────────────────

async function notionFetch(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`Notion ${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Converts the markdown generated by buildMarkdown() into Notion block objects.
 * Handles: ## headings, - bullets, numbered lists, ```code fences, **bold**, `inline code`.
 */
function markdownToNotionBlocks(markdown) {
  const blocks = [];
  const lines  = markdown.split('\n');
  let i = 0;

  const parseRichText = (text) => {
    const parts  = [];
    const regex  = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let last = 0, match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > last)
        parts.push({ type: 'text', text: { content: text.slice(last, match.index) } });
      const raw = match[0];
      if (raw.startsWith('**'))
        parts.push({ type: 'text', text: { content: raw.slice(2, -2) }, annotations: { bold: true } });
      else
        parts.push({ type: 'text', text: { content: raw.slice(1, -1) }, annotations: { code: true } });
      last = match.index + raw.length;
    }
    if (last < text.length)
      parts.push({ type: 'text', text: { content: text.slice(last) } });
    return parts.length ? parts : [{ type: 'text', text: { content: text } }];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('## ')) {
      blocks.push({ type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: line.slice(3) } }] } });
    } else if (line.startsWith('- ')) {
      blocks.push({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: parseRichText(line.slice(2)) } });
    } else if (/^\d+\.\s/.test(line)) {
      blocks.push({ type: 'numbered_list_item', numbered_list_item: { rich_text: parseRichText(line.replace(/^\d+\.\s/, '')) } });
    } else if (line.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      if (codeLines.length)
        blocks.push({ type: 'code', code: { rich_text: [{ type: 'text', text: { content: codeLines.join('\n') } }], language: 'plain text' } });
    } else if (line.trim()) {
      blocks.push({ type: 'paragraph', paragraph: { rich_text: parseRichText(line) } });
    }

    i++;
  }

  return blocks;
}

async function postToNotion(title, content) {
  if (!NOTION_API_KEY || !NOTION_STATS_PAGE_ID) {
    console.log('NOTION_API_KEY or NOTION_STATS_PAGE_ID not set — skipping Notion push.');
    return;
  }
  try {
    // Archive any existing child page for the same week so Notion stays clean
    const { results } = await notionFetch(`/blocks/${NOTION_STATS_PAGE_ID}/children?page_size=100`);
    for (const block of results ?? []) {
      if (block.type === 'child_page' && block.child_page?.title === title) {
        await notionFetch(`/pages/${block.id}`, 'PATCH', { archived: true });
        console.log(`Archived existing Notion stats page: ${title}`);
      }
    }

    // Create the new page; Notion caps children at 100 per request
    const blocks    = markdownToNotionBlocks(content);
    const firstPage = blocks.slice(0, 100);
    const page = await notionFetch('/pages', 'POST', {
      parent:     { page_id: NOTION_STATS_PAGE_ID },
      properties: { title: { title: [{ type: 'text', text: { content: title } }] } },
      children:   firstPage,
    });

    // Append any remaining blocks in batches of 100
    for (let j = 100; j < blocks.length; j += 100) {
      await notionFetch(`/blocks/${page.id}/children`, 'PATCH', {
        children: blocks.slice(j, j + 100),
      });
    }

    console.log(`Stats page pushed to Notion: ${title} (${blocks.length} blocks)`);
  } catch (e) {
    console.warn('postToNotion failed (non-fatal):', e.message);
  }
}

// ── Trigger Vercel rebuild ────────────────────────────────────────────────────

// ── Cognitive load snapshot ───────────────────────────────────────────────────

// Writes one row per week to the `cognitive_load` table using the same raw data
// already computed above — no extra API calls needed.
//
// Score formula (0–100):
//   open_prs × 8   → max 40 pts (5 PRs)
//   avg_age × 2    → max 20 pts (10 days)
//   in_progress × 7 → max 28 pts (4 issues)
//   rework_rate × 0.12 → max 12 pts (100%)

async function postCognitiveLoad({ gh, linear, rework }) {
  const openPrs    = gh.openPrCount        ?? 0;
  const avgAge     = gh.openPrAvgAgeDays   ?? 0;
  const inProg     = linear.inProgressCount ?? 0;
  const reworkRate = rework?.reworkRate     ?? 0;

  const a     = Math.min(openPrs   *  8,    40);
  const b     = Math.min(avgAge    *  2,    20);
  const c     = Math.min(inProg    *  7,    28);
  const d     = Math.min(reworkRate * 0.12, 12);
  const score = Math.min(100, Math.max(0, Math.round((a + b + c + d) * 10) / 10));

  // Anchor to the Sunday of the current ISO week so each snapshot has a
  // consistent date regardless of which day the script actually runs.
  const day     = now.getUTCDay(); // 0 = Sunday
  const diff    = day === 0 ? 0 : 7 - day;
  const sunday  = new Date(now);
  sunday.setUTCDate(now.getUTCDate() + diff);
  const weekDate = sunday.toISOString().slice(0, 10);

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/cognitive_load?on_conflict=recorded_at`,
    {
      method: 'POST',
      headers: {
        apikey:          SUPABASE_SERVICE_ROLE_KEY,
        Authorization:   `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type':  'application/json',
        Prefer:          'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        recorded_at:        weekDate,
        score,
        open_prs:           openPrs,
        avg_pr_age_days:    Math.round(avgAge * 10) / 10,
        issues_in_progress: inProg,
        rework_rate:        reworkRate,
        details: {
          rework_files_recent:  rework?.totalFiles      ?? 0,
          rework_files_overlap: rework?.reworkFileCount ?? 0,
        },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.warn(`cognitive_load upsert failed: ${res.status} ${body}`);
  } else {
    console.log(`Cognitive load upserted for week ${weekDate} (score=${score}).`);
  }
}

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

  const [gh, linear, commitSpread, pixellab, deployStats, agentOutcome, leadTime] = await Promise.all([
    getGitHubStats(),
    getIssueStats(),
    getCommitSpread(),
    getPixelLabStats(),
    getDeployStats(),
    getAgentOutcomeStats(),
    getLinearLeadTimeStats(),
  ]);

  // Synchronous stats — run after async work so the build step doesn't block network calls
  const bundle  = getBundleSize();
  const cogLoad = getCognitiveLoadStats();
  const quality = getCodeQualityStats();
  const rework  = getReworkStats();
  // getAiStats is async: merges local token-log.json + Supabase ai_sessions
  const ai      = await getAiStats();

  console.log('GitHub stats:', gh);
  console.log('Linear stats:', linear);
  console.log('Commit spread:', commitSpread);
  console.log('Bundle:', bundle);
  console.log('PixelLab:', pixellab);
  console.log('Deploy stats:', deployStats);
  console.log('Lead time:', leadTime ? `avg=${leadTime.thisWeek?.avg}d p90=${leadTime.thisWeek?.p90}d trend=${leadTime.trend}` : 'N/A');
  console.log('Cognitive load:', cogLoad ? `total=${cogLoad.totalScore}, top=${cogLoad.top10[0]?.file}` : 'N/A');
  console.log('Rework:', rework ? `rate=${rework.reworkRate}%, files=${rework.reworkFileCount}/${rework.totalFiles}` : 'N/A');
  console.log('Agent outcomes:', agentOutcome ? `total=${agentOutcome.total}, failureRate=${agentOutcome.failureRate}%` : 'N/A');

  const content = buildMarkdown(gh, linear, commitSpread, bundle, pixellab, cogLoad, deployStats, ai, quality, rework, agentOutcome, leadTime);
  const metrics = {
    delivery:      { mergedCount: gh.mergedCount, humanMergedCount: gh.humanMergedCount, agentMergedCount: gh.agentMergedCount, avgPrSize: gh.avgPrSize, completedCount: linear.completedCount, activeDays: commitSpread?.activeDays ?? null, totalCommits: commitSpread?.totalCommits ?? null },
    velocity:      { avgMergeTime: gh.avgMergeTime, avgCycleTime: linear.avgCycleTime, reworkRate: linear.reworkRate },
    quality:       { ciPassRate: gh.ciPassRate, fixRevertCount: gh.fixRevertCount, fixRevertPct: gh.fixRevertPct, ...(quality ?? {}) },
    automation:    { agentMergedCount: gh.agentMergedCount, agentPrPct: gh.agentPrPct, agentSuccessRate: gh.agentSuccessRate },
    cognitiveLoad: cogLoad      ?? null,
    rework:        rework       ?? null,
    aiUsage:       ai           ?? null,
    bundleSize:    bundle       ?? null,
    deployStats:   deployStats  ?? null,
    pixellab:      pixellab     ?? null,
    agentOutcome:  agentOutcome ?? null,
    leadTime:      leadTime     ?? null,
  };
  await postToSupabase(weekLabel, content, metrics, {
    gh, linear, commitSpread, bundle, pixellab, cogLoad, deployStats, ai, quality, rework, agentOutcome, leadTime,
  });
  await postCognitiveLoad({ gh, linear, rework });
  await postToNotion(weekLabel, content);

  await triggerVercelDeploy();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
