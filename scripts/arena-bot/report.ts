#!/usr/bin/env node
/**
 * Arena bot regression reporter.
 *
 * Reads the arena testplay report (screenshots/arena-testplay-report.json by
 * default, or --report <path>), posts a summary comment on Linear issue FIL-188,
 * and creates one bug issue per detected regression.
 *
 * Usage:
 *   npx tsx scripts/arena-bot/report.ts
 *   npx tsx scripts/arena-bot/report.ts --report path/to/report.json
 *
 * Requires: LINEAR_API_KEY env var (exits 0 gracefully if missing)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ArenaSnapshot {
  simTime:      number;
  wave:         number;
  kills:        number;
  heroDeaths:   number;
  heroAlive:    boolean;
  enemiesAlive: number;
}

interface ArenaSummary {
  finalWave:  number;
  totalKills: number;
  heroDeaths: number;
}

interface ArenaReport {
  generatedAt:  string;
  simSeconds:   number;
  summary:      ArenaSummary;
  balanceHints: string[];
  snapshots:    ArenaSnapshot[];
}

interface Regression {
  metric:      string;
  value:       number;
  targetRange: string;
  title:       string;
}

// ── Regression thresholds ─────────────────────────────────────────────────────
//
// Healthy targets match the comments in tests/arena-testplay.spec.ts.
// A metric is a regression when it falls outside its range.

const HEALTHY = {
  finalWave:  { min: 5,  max: 9,  label: '5–9' },
  totalKills: { min: 15, max: 40, label: '15–40' },
  heroDeaths: { min: 0,  max: 2,  label: '0–2' },
} as const;

function detectRegressions(summary: ArenaSummary): Regression[] {
  const regressions: Regression[] = [];

  if (
    summary.finalWave < HEALTHY.finalWave.min ||
    summary.finalWave > HEALTHY.finalWave.max
  ) {
    regressions.push({
      metric:      'finalWave',
      value:       summary.finalWave,
      targetRange: HEALTHY.finalWave.label,
      title: `Arena regression: finalWave=${summary.finalWave} (target ${HEALTHY.finalWave.label})`,
    });
  }

  if (
    summary.totalKills < HEALTHY.totalKills.min ||
    summary.totalKills > HEALTHY.totalKills.max
  ) {
    regressions.push({
      metric:      'totalKills',
      value:       summary.totalKills,
      targetRange: HEALTHY.totalKills.label,
      title: `Arena regression: totalKills=${summary.totalKills} (target ${HEALTHY.totalKills.label})`,
    });
  }

  // heroDeaths has no lower-bound regression (fewer deaths is always good)
  if (summary.heroDeaths > HEALTHY.heroDeaths.max) {
    regressions.push({
      metric:      'heroDeaths',
      value:       summary.heroDeaths,
      targetRange: HEALTHY.heroDeaths.label,
      title: `Arena regression: heroDeaths=${summary.heroDeaths} (target ${HEALTHY.heroDeaths.label})`,
    });
  }

  return regressions;
}

// ── Linear GraphQL ────────────────────────────────────────────────────────────
//
// Pattern mirrors .github/scripts/run-agent.js: plain key in Authorization
// header (Linear accepts the key directly, without the "Bearer " prefix).

const LINEAR_URL = 'https://api.linear.app/graphql';

async function linearRequest(
  apiKey: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await fetch(LINEAR_URL, {
    method: 'POST',
    headers: {
      // Strip "Bearer " prefix if accidentally included, matching run-agent.js
      Authorization: apiKey.replace(/^Bearer\s+/i, ''),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Linear HTTP ${res.status}: ${await res.text()}`);
  }

  const json = await res.json() as {
    data?: Record<string, unknown>;
    errors?: unknown[];
  };

  if (json.errors) {
    throw new Error(`Linear GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  if (!json.data) throw new Error('Linear returned no data');
  return json.data;
}

interface LinearIssue {
  id:   string;
  team: { id: string };
}

// Linear's issue(id:) field accepts both UUID and shorthand identifiers
// like "FIL-188", so we can look up FIL-188 directly.
async function fetchIssue(apiKey: string, identifier: string): Promise<LinearIssue> {
  const data = await linearRequest(
    apiKey,
    `query($id: String!) {
      issue(id: $id) {
        id
        team { id }
      }
    }`,
    { id: identifier },
  );

  const issue = data['issue'] as LinearIssue | null;
  if (!issue) throw new Error(`Issue ${identifier} not found in Linear`);
  return issue;
}

async function postComment(
  apiKey: string,
  issueId: string,
  body: string,
): Promise<void> {
  await linearRequest(
    apiKey,
    `mutation($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) { success }
    }`,
    { issueId, body },
  );
}

interface CreatedIssue {
  success: boolean;
  issue: { identifier: string; url: string };
}

async function createBugIssue(
  apiKey: string,
  teamId: string,
  title: string,
  description: string,
): Promise<string> {
  const data = await linearRequest(
    apiKey,
    `mutation($teamId: String!, $title: String!, $description: String!) {
      issueCreate(input: {
        teamId: $teamId
        title: $title
        description: $description
      }) {
        success
        issue { identifier url }
      }
    }`,
    { teamId, title, description },
  );

  const result = data['issueCreate'] as CreatedIssue;
  if (!result.success) {
    throw new Error(`issueCreate returned success=false for: ${title}`);
  }
  return result.issue.url;
}

// ── Summary comment ───────────────────────────────────────────────────────────

function statusIcon(ok: boolean): string {
  return ok ? '✅' : '❌';
}

function buildSummaryComment(
  report: ArenaReport,
  regressions: Regression[],
  bugUrls: string[],
): string {
  const { summary, balanceHints, generatedAt, simSeconds } = report;

  const waveOk  = summary.finalWave  >= HEALTHY.finalWave.min  && summary.finalWave  <= HEALTHY.finalWave.max;
  const killsOk = summary.totalKills >= HEALTHY.totalKills.min && summary.totalKills <= HEALTHY.totalKills.max;
  const deathOk = summary.heroDeaths <= HEALTHY.heroDeaths.max;

  const lines: string[] = [
    `## Arena testplay report — ${generatedAt}`,
    '',
    `Simulated **${simSeconds}s** of arena gameplay. Sessions run: 1.`,
    '',
    '### Metrics',
    '',
    '| Metric | Value | Target | |',
    '|--------|-------|--------|--|',
    `| Final wave   | ${summary.finalWave}  | ${HEALTHY.finalWave.label}  | ${statusIcon(waveOk)}  |`,
    `| Total kills  | ${summary.totalKills} | ${HEALTHY.totalKills.label} | ${statusIcon(killsOk)} |`,
    `| Hero deaths  | ${summary.heroDeaths} | ${HEALTHY.heroDeaths.label} | ${statusIcon(deathOk)} |`,
  ];

  if (balanceHints.length > 0) {
    lines.push('', '### Balance hints', '');
    for (const hint of balanceHints) {
      lines.push(`- ${hint}`);
    }
  }

  if (regressions.length === 0) {
    lines.push('', '### Regressions', '', '✅ No regressions detected.');
  } else {
    lines.push('', '### Regressions', '');
    for (let i = 0; i < regressions.length; i++) {
      const reg = regressions[i]!;
      const url = bugUrls[i];
      const issueRef = url ? `[bug filed](${url})` : 'bug filed';
      lines.push(
        `- ❌ **${reg.metric}**=${reg.value} (target ${reg.targetRange}) — ${issueRef}`,
      );
    }
  }

  return lines.join('\n');
}

// ── CLI arg parsing ───────────────────────────────────────────────────────────

function parseArgs(): { reportPath: string } {
  const args = process.argv.slice(2);
  let reportPath = resolve('screenshots', 'arena-testplay-report.json');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--report' && i + 1 < args.length) {
      reportPath = resolve(args[i + 1]!);
      i++;
    }
  }

  return { reportPath };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apiKey = process.env['LINEAR_API_KEY'];
  if (!apiKey) {
    // Graceful exit — testplay may run in environments without Linear access
    console.warn('LINEAR_API_KEY is not set — skipping Linear regression reporting');
    process.exit(0);
  }

  const { reportPath } = parseArgs();
  console.log(`Reading arena report: ${reportPath}`);

  let report: ArenaReport;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8')) as ArenaReport;
  } catch (err) {
    console.error(`Could not read report at ${reportPath}:`, err);
    process.exit(1);
  }

  const { summary } = report;
  console.log(`  finalWave:  ${summary.finalWave}`);
  console.log(`  totalKills: ${summary.totalKills}`);
  console.log(`  heroDeaths: ${summary.heroDeaths}`);

  // Fetch FIL-188 to get its internal UUID and team ID for mutations
  let parentIssue: LinearIssue;
  try {
    parentIssue = await fetchIssue(apiKey, 'FIL-188');
  } catch (err) {
    console.error('Could not fetch FIL-188 from Linear:', err);
    process.exit(1);
  }

  // Detect out-of-range metrics
  const regressions = detectRegressions(summary);
  if (regressions.length === 0) {
    console.log('No regressions detected.');
  } else {
    console.log(`\nRegressions (${regressions.length}):`);
    for (const r of regressions) console.log(`  ${r.title}`);
  }

  // Create one bug issue per regression and collect their URLs
  const bugUrls: string[] = [];
  for (const reg of regressions) {
    const description = [
      `**Detected:** ${report.generatedAt}`,
      '',
      `Arena testplay metric **${reg.metric}** fell outside the healthy range.`,
      '',
      `| Metric | Value | Healthy range |`,
      `|--------|-------|---------------|`,
      `| ${reg.metric} | ${reg.value} | ${reg.targetRange} |`,
      '',
      `Simulated ${report.simSeconds}s of gameplay.`,
      '',
      `See [FIL-188](https://linear.app/fills-pills/issue/FIL-188) for the full testplay summary.`,
    ].join('\n');

    try {
      const url = await createBugIssue(apiKey, parentIssue.team.id, reg.title, description);
      bugUrls.push(url);
      console.log(`  Created bug issue → ${url}`);
    } catch (err) {
      console.error(`  Failed to create issue for ${reg.metric}:`, err);
      bugUrls.push('');
    }
  }

  // Post summary comment on FIL-188
  const commentBody = buildSummaryComment(report, regressions, bugUrls);
  try {
    await postComment(apiKey, parentIssue.id, commentBody);
    console.log('\nPosted summary comment on FIL-188.');
  } catch (err) {
    console.error('Failed to post comment on FIL-188:', err);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
