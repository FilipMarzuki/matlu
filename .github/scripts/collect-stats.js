#!/usr/bin/env node
// Weekly engineering stats collector.
// Queries GitHub REST API + Linear GraphQL, then posts a new page to Notion.
// Runs via GitHub Actions — all credentials come from environment secrets.
// Uses only Node.js built-ins (fetch is available in Node 18+).

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ESM doesn't have __dirname — reconstruct it from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const GITHUB_TOKEN        = process.env.GITHUB_TOKEN;
const NOTION_API_KEY      = process.env.NOTION_API_KEY;
const NOTION_STATS_PAGE_ID = process.env.NOTION_STATS_PAGE_ID;
const LINEAR_API_KEY      = process.env.LINEAR_API_KEY;
const VERCEL_DEPLOY_HOOK  = process.env.VERCEL_DEPLOY_HOOK;
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
      Authorization: LINEAR_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear API → ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map(e => e.message).join(', '));
  return json.data;
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

// ── Date range: last 7 days ───────────────────────────────────────────────────

const now     = new Date();
const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
const weekAgoISO = weekAgo.toISOString();

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

  return {
    mergedCount,
    avgPrSize,
    avgMergeTime,
    fixRevertCount,
    fixRevertPct,
    ciPassRate,
    top5Files,
  };
}

// ── Linear stats ──────────────────────────────────────────────────────────────

async function getLinearStats() {
  if (!LINEAR_API_KEY) {
    return { completedCount: 0, avgCycleTime: 0, reworkRate: 0 };
  }

  const data = await linearQuery(`
    query WeeklyStats {
      issues(
        filter: { state: { type: { eq: "completed" } } }
        first: 100
        orderBy: updatedAt
      ) {
        nodes {
          id
          createdAt
          completedAt
        }
      }
    }
  `);

  // Filter client-side to this week's completions
  const issues = data.issues.nodes.filter(
    i => i.completedAt && new Date(i.completedAt) >= weekAgo
  );
  const completedCount = issues.length;

  // Cycle time: createdAt → completedAt in days
  const cycleTimes = issues.map(i =>
    (new Date(i.completedAt) - new Date(i.createdAt)) / (1000 * 60 * 60 * 24)
  );
  const avgCycleTime = Math.round(avg(cycleTimes) * 10) / 10;

  return { completedCount, avgCycleTime, reworkRate: 0 };
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

  // Cost per issue (group sessions by issueId)
  const byIssue = {};
  for (const e of weekEntries) {
    const key = e.issueId || e.branch || 'unknown';
    if (!byIssue[key]) byIssue[key] = { cost: 0, sessions: 0 };
    byIssue[key].cost     += e.estimatedCostUsd || 0;
    byIssue[key].sessions += 1;
  }

  return {
    sessions:         weekEntries.length,
    totalInput,
    totalOutput,
    totalCacheRead,
    totalCacheWrite,
    totalCost:        Math.round(totalCost * 100) / 100,
    byIssue,
  };
}

// ── Build Notion page content ──────────────────────────────────────────────────

function buildNotionBlocks(gh, linear) {
  const top5Text = gh.top5Files.length
    ? gh.top5Files.map(([f, n], i) => `${i + 1}. \`${f}\` (${n} changes)`).join('\n')
    : 'No file data available.';

  const ai = getAiStats();

  const blocks = [
    heading2('Delivery'),
    bullet(`PRs merged: **${gh.mergedCount}**`),
    bullet(`Avg PR size: **${gh.avgPrSize} lines**`),
    bullet(`Issues completed: **${linear.completedCount}**`),
    heading2('Quality'),
    bullet(`CI pass rate: **${gh.ciPassRate}%**`),
    bullet(`PRs with fix/revert in title: **${gh.fixRevertCount}** (${gh.fixRevertPct}%)`),
    heading2('Velocity'),
    bullet(`Avg time to merge: **${gh.avgMergeTime} hours**`),
    bullet(`Avg issue cycle time: **${linear.avgCycleTime} days**`),
    bullet(`Rework rate: **${linear.reworkRate}%**`),
    heading2('Hotspots'),
    paragraph('Top 5 most-changed files this week:'),
    paragraph(top5Text),
  ];

  if (ai) {
    const totalTokens = ai.totalInput + ai.totalOutput + ai.totalCacheRead + ai.totalCacheWrite;
    const perIssueLines = Object.entries(ai.byIssue)
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([id, s]) => `${id}: $${Math.round(s.cost * 100) / 100} (${s.sessions} session${s.sessions > 1 ? 's' : ''})`)
      .join('\n');

    blocks.push(
      heading2('AI Usage (Claude Code)'),
      bullet(`Sessions this week: **${ai.sessions}**`),
      bullet(`Total tokens: **${(totalTokens / 1000).toFixed(1)}k** (${(ai.totalInput/1000).toFixed(1)}k in / ${(ai.totalOutput/1000).toFixed(1)}k out / ${(ai.totalCacheRead/1000).toFixed(1)}k cache-read)`),
      bullet(`Estimated cost: **$${ai.totalCost}**`),
      paragraph('Cost by feature:'),
      paragraph(perIssueLines || 'No data'),
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

  const [gh, linear] = await Promise.all([
    getGitHubStats(),
    getLinearStats(),
  ]);

  console.log('GitHub stats:', gh);
  console.log('Linear stats:', linear);

  const blocks = buildNotionBlocks(gh, linear);
  const page   = await postToNotion(weekLabel, blocks);
  console.log(`Created Notion page: ${page.url}`);

  await triggerVercelDeploy();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
