#!/usr/bin/env node
/**
 * check-deploy-health.js — FIL-183 DORA Phase 2
 *
 * Detects whether the most recent Vercel production deployment caused a
 * production error spike, then records the result in Supabase and (when
 * a spike is found) files a Linear `bug` + `rework` issue.
 *
 * Run on a schedule (every 2 h) by agent-deploy-health.yml so fresh deploys
 * are caught within one polling interval.
 *
 * Algorithm
 * ---------
 * 1. Fetch the most recent Vercel production deploy (READY state).
 * 2. Skip if it was created >2 h ago (already checked or stale).
 * 3. Query Better Stack Connect for error counts in two 30-min windows:
 *      baseline  = [deploy_time − 30 min, deploy_time]
 *      post-deploy = [deploy_time, deploy_time + 30 min]
 * 4. Spike criteria (any one triggers failure):
 *    - post_error_count > 0 AND baseline_count == 0 (new errors appeared)
 *    - post_error_count > baseline_count * 1.5 (≥50% increase)
 * 5. Upsert to Supabase `deploy_health` table.
 * 6. If failed: create Linear bug+rework issue with first_seen timestamp.
 *
 * Required env vars
 * -----------------
 * VERCEL_TOKEN            — Vercel API token
 * VERCEL_PROJECT_ID       — Vercel project ID
 * BETTERSTACK_CONNECT_USER — Better Stack Connect username
 * BETTERSTACK_CONNECT_PASS — Better Stack Connect password
 * SUPABASE_URL            — Supabase project URL
 * SUPABASE_SERVICE_ROLE_KEY — Supabase service role key
 * LINEAR_API_KEY          — Linear API key
 */

import { execSync } from 'child_process';

const VERCEL_TOKEN              = process.env.VERCEL_TOKEN;
const VERCEL_PROJECT_ID         = process.env.VERCEL_PROJECT_ID;
const BS_USER                   = process.env.BETTERSTACK_CONNECT_USER;
const BS_PASS                   = process.env.BETTERSTACK_CONNECT_PASS;
const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LINEAR_API_KEY            = process.env.LINEAR_API_KEY;

const BS_ENDPOINT = 'https://eu-fsn-3-connect.betterstackdata.com';
const BS_TABLE    = 't523686_matlu_logs';

// Max age for a deploy to be considered "fresh" and worth checking.
const MAX_DEPLOY_AGE_MS = 2 * 60 * 60 * 1000; // 2 h
// Monitoring window after deploy.
const WINDOW_MINUTES = 30;
// Error spike threshold: post ≥ baseline × this factor.
const SPIKE_FACTOR = 1.5;

// Linear team/project constants (Fills Pills / Matlu)
const LINEAR_TEAM_ID    = '84cc2660-9d7a-424a-99c6-3e858a67db4c';
const LINEAR_PROJECT_ID = 'c3622eaf-83ff-48b9-a611-c9b21fd8f039';
const LINEAR_ASSIGNEE   = '563bef3c-ccc8-4d5e-9922-47b90c4e2595';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoWindow(fromMs, toMs) {
  // ClickHouse expects 'YYYY-MM-DD HH:MM:SS' (UTC).
  const fmt = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  return { from: fmt(fromMs), to: fmt(toMs) };
}

async function bsErrorCount(fromMs, toMs) {
  if (!BS_USER || !BS_PASS) return null;
  const { from, to } = isoWindow(fromMs, toMs);
  const sql = `
    SELECT count() AS n
    FROM remote(${BS_TABLE})
    WHERE dt >= toDateTime64('${from}', 0, 'UTC')
      AND dt <= toDateTime64('${to}', 0, 'UTC')
      AND JSONExtractString(raw, 'level') = 'error'
    FORMAT JSONEachRow
  `.trim();

  const auth = Buffer.from(`${BS_USER}:${BS_PASS}`).toString('base64');
  try {
    const res = await fetch(BS_ENDPOINT + '?output_format_pretty_row_numbers=0', {
      method:  'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-type': 'plain/text' },
      body:    sql,
    });
    if (!res.ok) {
      console.warn(`Better Stack returned ${res.status}`);
      return null;
    }
    const text = await res.text();
    const line = text.trim().split('\n')[0];
    if (!line) return 0;
    const row = JSON.parse(line);
    return Number(row.n ?? 0);
  } catch (e) {
    console.warn('bsErrorCount failed:', e.message);
    return null;
  }
}

async function bsNewErrorTypes(fromMs, toMs) {
  // Returns distinct error messages that appeared in the post-deploy window
  // but NOT in the baseline window. Used to detect brand-new error categories.
  if (!BS_USER || !BS_PASS) return [];
  const { from: baseFrom, to: baseTo } = isoWindow(fromMs - WINDOW_MINUTES * 60_000, fromMs);
  const { from: postFrom, to: postTo } = isoWindow(fromMs, toMs);

  const sql = `
    SELECT JSONExtractString(raw, 'message') AS msg
    FROM remote(${BS_TABLE})
    WHERE dt >= toDateTime64('${postFrom}', 0, 'UTC')
      AND dt <= toDateTime64('${postTo}', 0, 'UTC')
      AND JSONExtractString(raw, 'level') = 'error'
    GROUP BY msg
    HAVING msg NOT IN (
      SELECT JSONExtractString(raw, 'message')
      FROM remote(${BS_TABLE})
      WHERE dt >= toDateTime64('${baseFrom}', 0, 'UTC')
        AND dt <= toDateTime64('${baseTo}', 0, 'UTC')
        AND JSONExtractString(raw, 'level') = 'error'
      GROUP BY JSONExtractString(raw, 'message')
    )
    LIMIT 10
    FORMAT JSONEachRow
  `.trim();

  const auth = Buffer.from(`${BS_USER}:${BS_PASS}`).toString('base64');
  try {
    const res = await fetch(BS_ENDPOINT + '?output_format_pretty_row_numbers=0', {
      method:  'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-type': 'plain/text' },
      body:    sql,
    });
    if (!res.ok) return [];
    const text = await res.text();
    return text.trim().split('\n')
      .filter(Boolean)
      .map(l => { try { return JSON.parse(l).msg; } catch { return null; } })
      .filter(Boolean);
  } catch (e) {
    console.warn('bsNewErrorTypes failed:', e.message);
    return [];
  }
}

async function supabaseUpsert(table, body) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?on_conflict=deploy_id`,
    {
      method:  'POST',
      headers: {
        apikey:          SUPABASE_SERVICE_ROLE_KEY,
        Authorization:   `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type':  'application/json',
        Prefer:          'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase ${table} upsert failed: ${res.status} ${txt}`);
  }
}

async function linearMutation(query, variables) {
  const res = await fetch('https://api.linear.app/graphql', {
    method:  'POST',
    headers: {
      Authorization:  LINEAR_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear GraphQL → ${res.status}`);
  const data = await res.json();
  if (data.errors) throw new Error(`Linear errors: ${JSON.stringify(data.errors)}`);
  return data.data;
}

async function createLinearBugIssue(deploy, firstSeenMs, newErrorTypes, spikePct) {
  // Resolve label IDs for 'bug' and 'rework' in the team.
  const labelQuery = `
    query { team(id: "${LINEAR_TEAM_ID}") { labels { nodes { id name } } } }
  `;
  const labelData = await linearMutation(labelQuery, {});
  const labels = labelData?.team?.labels?.nodes ?? [];
  const bugLabel   = labels.find(l => l.name === 'bug')?.id;
  const reworkLabel = labels.find(l => l.name === 'rework')?.id;
  const labelIds = [bugLabel, reworkLabel].filter(Boolean);

  const firstSeenISO = new Date(firstSeenMs).toISOString();
  const deployISO    = new Date(deploy.createdAt).toISOString();
  const errList = newErrorTypes.length
    ? newErrorTypes.map(t => `- \`${t}\``).join('\n')
    : '_(no new types detected — rate spike only)_';

  const description = [
    `## Post-deploy error spike`,
    ``,
    `**Deploy ID:** \`${deploy.uid}\``,
    `**Deploy time:** ${deployISO}`,
    `**first_seen:** ${firstSeenISO}`,
    `**Error spike:** ${spikePct !== null ? `${Math.round(spikePct)}%` : 'new error type'} increase`,
    ``,
    `## New error types detected`,
    errList,
    ``,
    `## Next steps`,
    `Check Better Stack → Logs → Live Tail filtered by \`level:error\` for full context.`,
    `Revert or hotfix the deploy at https://vercel.com/dashboard.`,
  ].join('\n');

  const mutation = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        issue { id identifier }
      }
    }
  `;
  const result = await linearMutation(mutation, {
    input: {
      teamId:      LINEAR_TEAM_ID,
      projectId:   LINEAR_PROJECT_ID,
      assigneeId:  LINEAR_ASSIGNEE,
      title:       `Post-deploy error spike: ${deploy.uid}`,
      description,
      priority:    1, // Urgent
      labelIds,
    },
  });
  return result?.issueCreate?.issue ?? null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) {
    console.log('VERCEL_TOKEN or VERCEL_PROJECT_ID not set — skipping.');
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing Supabase credentials.');
    process.exit(1);
  }

  // 1. Fetch the most recent READY production deploy.
  const url =
    `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/deployments` +
    `?limit=5&target=production`;
  const vRes = await fetch(url, {
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
  });
  if (!vRes.ok) {
    console.warn(`Vercel API → ${vRes.status}`);
    process.exit(0);
  }
  const { deployments = [] } = await vRes.json();
  const deploy = deployments.find(d => d.target === 'production' && d.state === 'READY');
  if (!deploy) {
    console.log('No recent ready production deploy found.');
    return;
  }

  const deployTimeMs = deploy.createdAt; // Unix ms
  const age = Date.now() - deployTimeMs;
  if (age > MAX_DEPLOY_AGE_MS) {
    console.log(`Most recent deploy (${deploy.uid}) is ${Math.round(age / 60000)} min old — skip.`);
    return;
  }

  // Wait until the 30-min window has elapsed before evaluating.
  const postWindowEnd = deployTimeMs + WINDOW_MINUTES * 60_000;
  if (Date.now() < postWindowEnd) {
    console.log(`Deploy window not yet complete for ${deploy.uid} — skip.`);
    return;
  }

  // 2. Check if we already have a result for this deploy.
  const existing = await fetch(
    `${SUPABASE_URL}/rest/v1/deploy_health?deploy_id=eq.${deploy.uid}&select=id`,
    {
      headers: {
        apikey:        SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  const existingRows = await existing.json();
  if (existingRows.length > 0) {
    console.log(`Deploy ${deploy.uid} already recorded — skip.`);
    return;
  }

  console.log(`Checking deploy ${deploy.uid} (deployed ${Math.round(age / 60000)} min ago)...`);

  // 3. Query Better Stack for baseline and post-deploy error counts.
  const baselineStart = deployTimeMs - WINDOW_MINUTES * 60_000;
  const baselineEnd   = deployTimeMs;
  const postStart     = deployTimeMs;
  const postEnd       = postWindowEnd;

  const [preCount, postCount, newErrorTypes] = await Promise.all([
    bsErrorCount(baselineStart, baselineEnd),
    bsErrorCount(postStart, postEnd),
    bsNewErrorTypes(postStart, postEnd),
  ]);

  console.log(`  Baseline errors: ${preCount ?? 'N/A'}`);
  console.log(`  Post-deploy errors: ${postCount ?? 'N/A'}`);
  console.log(`  New error types: ${newErrorTypes.join(', ') || 'none'}`);

  // 4. Determine healthy/failed.
  let healthy = true;
  let spikePct = null;

  if (postCount !== null && preCount !== null) {
    if (preCount === 0 && postCount > 0) {
      healthy = false;
      spikePct = null; // new errors from zero baseline
    } else if (preCount > 0 && postCount > preCount * SPIKE_FACTOR) {
      healthy = false;
      spikePct = ((postCount - preCount) / preCount) * 100;
    }
  }
  if (newErrorTypes.length > 0) {
    healthy = false;
  }

  console.log(`  Result: ${healthy ? 'HEALTHY' : 'FAILED'}`);

  // 5. Upsert to Supabase.
  const record = {
    deploy_id:        deploy.uid,
    deploy_time:      new Date(deployTimeMs).toISOString(),
    healthy,
    pre_error_count:  preCount,
    post_error_count: postCount,
    error_spike_pct:  spikePct !== null ? Math.round(spikePct) : null,
    new_error_types:  newErrorTypes.length ? newErrorTypes : null,
  };

  // 6. If failed and Linear is configured, create a bug issue.
  if (!healthy && LINEAR_API_KEY) {
    try {
      const issue = await createLinearBugIssue(
        deploy,
        deployTimeMs, // first_seen = deploy time (earliest possible error onset)
        newErrorTypes,
        spikePct,
      );
      if (issue) {
        record.linear_issue_id    = issue.id;
        record.linear_identifier  = issue.identifier;
        console.log(`  Linear issue created: ${issue.identifier}`);
      }
    } catch (e) {
      console.warn('  Linear issue creation failed:', e.message);
    }
  }

  await supabaseUpsert('deploy_health', record);
  console.log(`Deploy health recorded: ${deploy.uid} → ${healthy ? 'healthy' : 'FAILED'}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
