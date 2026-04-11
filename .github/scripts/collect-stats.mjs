/**
 * collect-stats.mjs
 *
 * Collects weekly engineering metrics from GitHub and Linear,
 * then posts a new stats page to Notion under the Stats root page.
 *
 * Run via GitHub Actions (see .github/workflows/stats.yml).
 * All credentials come from environment variables — never hardcoded.
 */

import { Octokit } from '@octokit/rest';
import { LinearClient } from '@linear/sdk';
import { Client as NotionClient } from '@notionhq/client';

// ── Config ────────────────────────────────────────────────────────────────────

const OWNER  = process.env.GITHUB_REPO_OWNER;
const REPO   = process.env.GITHUB_REPO_NAME;
const STATS_PAGE_ID = process.env.NOTION_STATS_PAGE;

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const linear  = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });
const notion  = new NotionClient({ auth: process.env.NOTION_API_KEY });

// ── Date range: last 7 days ───────────────────────────────────────────────────

const now     = new Date();
const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
const weekAgoISO = weekAgo.toISOString();

// Format: "Week of 2026-04-14"
const weekLabel = `Week of ${now.toISOString().slice(0, 10)}`;

console.log(`Collecting stats for: ${weekLabel}`);

// ── GitHub metrics ────────────────────────────────────────────────────────────

async function getGitHubMetrics() {
  // Merged PRs in the last 7 days
  const prsRes = await octokit.pulls.list({
    owner: OWNER, repo: REPO,
    state: 'closed',
    sort: 'updated',
    direction: 'desc',
    per_page: 100,
  });

  const mergedPRs = prsRes.data.filter(pr =>
    pr.merged_at && new Date(pr.merged_at) >= weekAgo
  );

  // Fetch full PR details for size + file counts
  const prDetails = await Promise.all(
    mergedPRs.map(pr => octokit.pulls.get({ owner: OWNER, repo: REPO, pull_number: pr.number }))
  );

  const sizes = prDetails.map(r => (r.data.additions ?? 0) + (r.data.deletions ?? 0));
  const avgSize = sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : 0;

  // Time to merge (hours)
  const mergeTimes = mergedPRs
    .filter(pr => pr.merged_at)
    .map(pr => (new Date(pr.merged_at).getTime() - new Date(pr.created_at).getTime()) / 3_600_000);
  const avgMergeHours = mergeTimes.length
    ? Math.round(mergeTimes.reduce((a, b) => a + b, 0) / mergeTimes.length)
    : 0;

  // Fix/revert PRs
  const fixPRs = mergedPRs.filter(pr =>
    /\b(fix|revert|hotfix)\b/i.test(pr.title)
  );

  // CI run pass rate
  const runsRes = await octokit.actions.listWorkflowRunsForRepo({
    owner: OWNER, repo: REPO,
    created: `>=${weekAgoISO}`,
    per_page: 100,
  });
  const runs = runsRes.data.workflow_runs.filter(r => r.status === 'completed');
  const passedRuns = runs.filter(r => r.conclusion === 'success').length;
  const ciPassRate = runs.length ? Math.round((passedRuns / runs.length) * 100) : 100;

  // Top 5 most-changed files
  const fileCounts = {};
  for (const detail of prDetails) {
    const filesRes = await octokit.pulls.listFiles({
      owner: OWNER, repo: REPO, pull_number: detail.data.number, per_page: 100,
    });
    for (const file of filesRes.data) {
      fileCounts[file.filename] = (fileCounts[file.filename] ?? 0) + 1;
    }
  }
  const topFiles = Object.entries(fileCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([file, count]) => `${file} (×${count})`);

  return {
    prsMerged: mergedPRs.length,
    avgPrSize: avgSize,
    avgMergeHours,
    fixPRs: fixPRs.length,
    fixPRPercent: mergedPRs.length ? Math.round((fixPRs.length / mergedPRs.length) * 100) : 0,
    ciPassRate,
    ciTotal: runs.length,
    topFiles,
  };
}

// ── Linear metrics ────────────────────────────────────────────────────────────

async function getLinearMetrics() {
  const issues = await linear.issues({
    filter: {
      completedAt: { gte: weekAgoISO },
      team: { name: { eq: 'Fills Pills' } },
    },
    first: 100,
  });

  const completedIssues = issues.nodes;
  const completed = completedIssues.length;

  // Cycle time: createdAt → completedAt in days
  const cycleTimes = completedIssues
    .filter(i => i.completedAt && i.createdAt)
    .map(i => (new Date(i.completedAt).getTime() - new Date(i.createdAt).getTime()) / 86_400_000);
  const avgCycleDays = cycleTimes.length
    ? Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length * 10) / 10
    : 0;

  // Rework: issues updated this week that are NOT in Done state (moved back)
  // Approximate via: issues with updatedAt in range and state not Done/Canceled
  const reworkIssues = await linear.issues({
    filter: {
      updatedAt: { gte: weekAgoISO },
      state: { type: { in: ['started', 'unstarted'] } },
      completedAt: { null: true },
      team: { name: { eq: 'Fills Pills' } },
    },
    first: 100,
  });
  const rework = reworkIssues.nodes.length;

  return { completed, avgCycleDays, rework };
}

// ── Build Notion page content ─────────────────────────────────────────────────

function buildMarkdown(gh, lin) {
  const topFilesText = gh.topFiles.length
    ? gh.topFiles.map((f, i) => `${i + 1}. ${f}`).join('\n')
    : '_No PRs merged this week_';

  return `## Delivery

| Metric | Value |
|--------|-------|
| PRs merged | ${gh.prsMerged} |
| Avg PR size (lines) | ${gh.avgPrSize} |
| Issues completed | ${lin.completed} |

## Quality

| Metric | Value |
|--------|-------|
| CI pass rate | ${gh.ciPassRate}% (${gh.ciTotal} runs) |
| PRs with fix/revert in title | ${gh.fixPRs} (${gh.fixPRPercent}%) |

## Velocity

| Metric | Value |
|--------|-------|
| Avg time to merge | ${gh.avgMergeHours}h |
| Avg issue cycle time | ${lin.avgCycleDays} days |
| Rework (issues moved back) | ${lin.rework} |

## Hotspots

Top 5 most-changed files this week:

${topFilesText}
`;
}

// ── Post to Notion ────────────────────────────────────────────────────────────

async function postToNotion(title, markdownBody) {
  await notion.pages.create({
    parent: { page_id: STATS_PAGE_ID },
    properties: {
      title: { title: [{ text: { content: title } }] },
    },
    children: [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: markdownBody } }],
        },
      },
    ],
  });
  console.log(`Posted Notion page: ${title}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Collecting GitHub metrics...');
  const gh = await getGitHubMetrics();
  console.log('GitHub:', gh);

  console.log('Collecting Linear metrics...');
  const lin = await getLinearMetrics();
  console.log('Linear:', lin);

  const body = buildMarkdown(gh, lin);
  console.log('Posting to Notion...');
  await postToNotion(weekLabel, body);

  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
