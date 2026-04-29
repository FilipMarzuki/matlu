#!/usr/bin/env node
// One-shot script to classify every open issue with exactly one type:* label.
// Uses keyword heuristics on title + body to pick the label. Idempotent —
// issues that already have a type:* label are skipped.
//
// Usage:
//   GITHUB_TOKEN=... node .github/scripts/backfill-issue-types.js [--dry-run]
//
// Dry-run: prints proposed classification without applying any labels.
// The workflow summary at the end counts how many issues per type.

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER || 'FilipMarzuki';
const REPO_NAME = process.env.REPO_NAME || 'matlu';
const DRY_RUN = process.argv.includes('--dry-run');

if (!GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN or GH_TOKEN must be set');
  process.exit(1);
}

// ── Keyword rules (checked in order; first match wins) ──────────────────────

const TYPE_RULES = [
  {
    type: 'type:bug',
    keywords: ['bug', 'fix', 'broken', 'regression', 'error', 'crash', 'fail', 'incorrect', 'wrong'],
  },
  {
    type: 'type:refactor',
    keywords: ['refactor', 'rename', 'extract', 'move', 'cleanup', 'clean up', 'reorganise', 'reorganize', 'restructure'],
  },
  {
    type: 'type:perf',
    keywords: ['perf', 'performance', 'optimize', 'optimise', 'slow', 'speed', 'latency', 'memory', 'cache'],
  },
  {
    type: 'type:infra',
    keywords: ['ci', 'deploy', 'workflow', 'agent', 'lint', 'tooling', 'pipeline', 'github action', 'vercel', 'supabase migration', 'cron', 'script'],
  },
  {
    type: 'type:docs',
    keywords: ['docs', 'readme', 'document', 'explain', 'plan', 'architecture', 'comment', 'changelog', 'wiki', 'codex'],
  },
  {
    type: 'type:spike',
    keywords: ['spike', 'investigate', 'research', 'explore', 'evaluate', 'prototype', 'experiment', 'proof of concept', 'poc'],
  },
];

/**
 * Returns the type:* label to apply to an issue, based on keyword heuristics
 * applied to the combined title + body text.
 */
function classifyIssue(title, body) {
  const text = `${title} ${body ?? ''}`.toLowerCase();
  for (const rule of TYPE_RULES) {
    if (rule.keywords.some((kw) => text.includes(kw))) {
      return rule.type;
    }
  }
  return 'type:feature';
}

// ── GitHub GraphQL helper ────────────────────────────────────────────────────

async function graphql(query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GraphQL request failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// ── REST helper ──────────────────────────────────────────────────────────────

async function addLabel(issueNumber, labelName) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issueNumber}/labels`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ labels: [labelName] }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to add label to #${issueNumber} (${res.status}): ${text}`);
  }
}

// ── Fetch all open issues (paginated via GraphQL cursor) ─────────────────────

const ISSUES_QUERY = `
  query($owner: String!, $repo: String!, $after: String) {
    repository(owner: $owner, name: $repo) {
      issues(first: 100, after: $after, states: [OPEN]) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          number
          title
          body
          labels(first: 20) {
            nodes {
              name
            }
          }
        }
      }
    }
  }
`;

async function fetchAllOpenIssues() {
  const issues = [];
  let after = null;

  while (true) {
    const data = await graphql(ISSUES_QUERY, {
      owner: REPO_OWNER,
      repo: REPO_NAME,
      after,
    });

    const page = data.repository.issues;
    issues.push(...page.nodes);

    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }

  return issues;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Repo: ${REPO_OWNER}/${REPO_NAME}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no labels will be applied)' : 'LIVE'}\n`);

  const issues = await fetchAllOpenIssues();
  console.log(`Fetched ${issues.length} open issue(s).\n`);

  const TYPE_LABEL_PREFIX = 'type:';
  const counts = {};
  let skipped = 0;
  let applied = 0;

  for (const issue of issues) {
    const existingLabels = issue.labels.nodes.map((l) => l.name);
    const alreadyHasType = existingLabels.some((l) => l.startsWith(TYPE_LABEL_PREFIX));

    if (alreadyHasType) {
      const existing = existingLabels.find((l) => l.startsWith(TYPE_LABEL_PREFIX));
      console.log(`  skip  #${issue.number}  (already has ${existing})`);
      skipped++;
      counts[existing] = (counts[existing] ?? 0) + 1;
      continue;
    }

    const label = classifyIssue(issue.title, issue.body);
    console.log(`  ${DRY_RUN ? 'would apply' : 'apply'}  #${issue.number}  ${label}  — ${issue.title}`);
    counts[label] = (counts[label] ?? 0) + 1;

    if (!DRY_RUN) {
      await addLabel(issue.number, label);
      applied++;
      // Polite rate-limit: GitHub's secondary rate limit asks for ≤1 write/s.
      await new Promise((r) => setTimeout(r, 1100));
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log('\n── Summary ─────────────────────────────────────────────');
  for (const [label, count] of Object.entries(counts).sort()) {
    console.log(`  ${label.padEnd(20)} ${count}`);
  }

  if (DRY_RUN) {
    console.log(`\nDry-run complete. ${issues.length} issue(s) analysed, ${skipped} already labelled.`);
  } else {
    console.log(`\nDone. ${applied} label(s) applied, ${skipped} issue(s) already had a type:* label.`);
  }

  // Write GitHub Actions step summary if available
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const { writeFileSync, appendFileSync } = await import('fs');
    const mode = DRY_RUN ? ' (dry run)' : '';
    let md = `## Backfill type:* labels${mode}\n\n`;
    md += `| Label | Count |\n|---|---|\n`;
    for (const [label, count] of Object.entries(counts).sort()) {
      md += `| \`${label}\` | ${count} |\n`;
    }
    md += `\n**${issues.length} total** — ${applied} labelled, ${skipped} already had a type:*\n`;
    appendFileSync(summaryPath, md);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
