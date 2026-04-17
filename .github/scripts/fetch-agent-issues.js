#!/usr/bin/env node
// Fetches Linear issues eligible for the per-issue nightly agent.
//
// Eligibility: state=Backlog or Todo, assignee="Filip Marzuki", label="ready".
// Emits a JSON array of Linear issue identifiers (e.g. ["FIL-42","FIL-43"])
// on stdout. When run in GitHub Actions, also appends `issues=[...]` to
// $GITHUB_OUTPUT so the downstream matrix job can fan out over them.
//
// Usage:
//   node fetch-agent-issues.js                     # default: ready issues
//   node fetch-agent-issues.js --issue FIL-42      # single-issue override
//                                                  #   (for workflow_dispatch)

import { appendFileSync } from 'fs';

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const GITHUB_OUTPUT  = process.env.GITHUB_OUTPUT;

if (!LINEAR_API_KEY) {
  console.error('Missing LINEAR_API_KEY');
  process.exit(1);
}

// ── CLI args ──────────────────────────────────────────────────────────────────
// Single-issue override lets workflow_dispatch target one issue on demand
// instead of pulling the full Backlog — handy for mid-day runs.

const args = process.argv.slice(2);
const issueOverrideIdx = args.indexOf('--issue');
const issueOverride = issueOverrideIdx >= 0 ? args[issueOverrideIdx + 1] : null;

// ── Linear GraphQL ────────────────────────────────────────────────────────────

async function linearQuery(query, variables = {}) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      // Linear tokens must NOT use a Bearer prefix
      Authorization: LINEAR_API_KEY.replace(/^Bearer\s+/i, ''),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear → ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Linear GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data;
}

// ── Queries ───────────────────────────────────────────────────────────────────

const READY_QUERY = `
  query ReadyIssues {
    issues(
      filter: {
        state: { type: { in: ["backlog", "unstarted"] } }
        assignee: { name: { eq: "Filip Marzuki" } }
        labels: { some: { name: { eq: "ready" } } }
      }
      orderBy: updatedAt
      first: 50
    ) {
      nodes { identifier }
    }
  }
`;

const ONE_ISSUE_QUERY = `
  query OneIssue($id: String!) {
    issue(id: $id) { identifier }
  }
`;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  let identifiers;

  if (issueOverride) {
    const data = await linearQuery(ONE_ISSUE_QUERY, { id: issueOverride });
    if (!data.issue) {
      console.error(`Issue ${issueOverride} not found`);
      process.exit(1);
    }
    identifiers = [data.issue.identifier];
  } else {
    const data = await linearQuery(READY_QUERY);
    identifiers = data.issues.nodes.map((n) => n.identifier);
  }

  // GitHub Actions' matrix strategy needs strict JSON — no trailing newlines
  // inside the `issues=` value. We also print to stdout for log visibility.
  const serialised = JSON.stringify(identifiers);
  console.log(serialised);

  if (GITHUB_OUTPUT) {
    appendFileSync(GITHUB_OUTPUT, `issues=${serialised}\n`);
    // A boolean flag makes it easy for the downstream job to skip when empty
    appendFileSync(GITHUB_OUTPUT, `has_issues=${identifiers.length > 0}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
