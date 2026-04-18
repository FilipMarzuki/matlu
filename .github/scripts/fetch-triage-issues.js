#!/usr/bin/env node
// Fetches Linear Backlog issues that haven't been triaged yet.
//
// "Not triaged" = Backlog issue with none of the triage labels:
//   ready, needs-refinement, blocked, too-large,
//   agent:success, agent:partial, agent:failed, agent:wrong-interpretation
//
// Linear's filter API can express "has none of these labels" using a nested
// AND-NOT, but client-side filtering after fetching all Backlog issues is
// simpler and avoids complex GraphQL filter composition.
//
// Emits a JSON array of Linear issue identifiers on stdout.
// In GitHub Actions, also appends `issues=[...]` to $GITHUB_OUTPUT.
//
// Usage:
//   node fetch-triage-issues.js                # all un-triaged Backlog issues
//   node fetch-triage-issues.js --issue FIL-42 # single-issue override

import { appendFileSync } from 'fs';

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const GITHUB_OUTPUT  = process.env.GITHUB_OUTPUT;

if (!LINEAR_API_KEY) {
  console.error('Missing LINEAR_API_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const issueOverrideIdx = args.indexOf('--issue');
const issueOverride = issueOverrideIdx >= 0 ? args[issueOverrideIdx + 1] : null;

// Issues carrying any of these labels have already been assessed — skip them.
const TRIAGE_SKIP_LABELS = new Set([
  'ready',
  'needs-refinement',
  'blocked',
  'too-large',
  'agent:success',
  'agent:partial',
  'agent:failed',
  'agent:wrong-interpretation',
]);

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
    // Paginate through all Backlog issues and filter client-side.
    const allIssues = [];
    let hasNextPage = true;
    let after = null;

    while (hasNextPage) {
      const data = await linearQuery(`
        query UntriagedIssues($after: String) {
          issues(
            first: 50
            after: $after
            filter: {
              state: { type: { eq: "backlog" } }
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

    // Keep only issues with none of the triage labels.
    identifiers = allIssues
      .filter(i => !i.labels.nodes.some(l => TRIAGE_SKIP_LABELS.has(l.name)))
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
