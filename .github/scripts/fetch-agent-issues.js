#!/usr/bin/env node
// Fetches Linear Backlog issues eligible for the per-issue nightly agent.
//
// Eligibility: Backlog issues with the "ready" label but NOT "blocked".
//
// Emits a JSON array of Linear issue identifiers (e.g. ["FIL-42", "FIL-43"])
// on stdout. In GitHub Actions, also appends `issues=[...]` to $GITHUB_OUTPUT
// so the downstream matrix job can fan out over them.
//
// Usage:
//   node fetch-agent-issues.js                # full Backlog scan
//   node fetch-agent-issues.js --issue FIL-42 # single-issue override (workflow_dispatch)

import { appendFileSync } from 'fs';

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const GITHUB_OUTPUT  = process.env.GITHUB_OUTPUT;

if (!LINEAR_API_KEY) {
  console.error('Missing LINEAR_API_KEY');
  process.exit(1);
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const issueOverrideIdx = args.indexOf('--issue');
const issueOverride = issueOverrideIdx >= 0 ? args[issueOverrideIdx + 1] : null;

// ── Linear GraphQL API ────────────────────────────────────────────────────────

async function linearQuery(query, variables = {}) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: LINEAR_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear API → ${res.status} ${await res.text()}`);
  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(`Linear GraphQL errors: ${JSON.stringify(errors)}`);
  return data;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  let identifiers;

  if (issueOverride) {
    if (!/^[A-Z]+-\d+$/.test(issueOverride)) {
      console.error(`Invalid Linear issue identifier: ${issueOverride} (expected e.g. FIL-42)`);
      process.exit(1);
    }
    identifiers = [issueOverride];
  } else {
    // Paginate through Backlog issues carrying the "ready" label.
    const allIssues = [];
    let hasNextPage = true;
    let after = null;

    while (hasNextPage) {
      const data = await linearQuery(`
        query EligibleIssues($after: String) {
          issues(
            first: 50
            after: $after
            filter: {
              state: { type: { eq: "backlog" } }
              labels: { name: { eq: "ready" } }
            }
          ) {
            nodes {
              identifier
              labels { nodes { name } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `, { after });

      const { nodes, pageInfo } = data.issues;
      allIssues.push(...nodes);
      hasNextPage = pageInfo.hasNextPage;
      after = pageInfo.endCursor;
    }

    // Exclude issues that also carry the "blocked" label — they can't be worked on yet.
    identifiers = allIssues
      .filter(i => !i.labels.nodes.some(l => l.name === 'blocked'))
      .map(i => i.identifier);
  }

  const serialised = JSON.stringify(identifiers);
  console.log(serialised);

  if (GITHUB_OUTPUT) {
    appendFileSync(GITHUB_OUTPUT, `issues=${serialised}\n`);
    appendFileSync(GITHUB_OUTPUT, `has_issues=${identifiers.length > 0}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
