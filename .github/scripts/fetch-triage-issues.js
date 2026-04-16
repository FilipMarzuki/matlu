#!/usr/bin/env node
// Fetches Linear Backlog issues that haven't been triaged yet.
//
// "Not triaged" = no `ready`, `needs-refinement`, `blocked`, `too-large`,
// or `agent:*` label. These are the issues the triage agent should assess.
//
// Emits a JSON array of issue identifiers to stdout (and $GITHUB_OUTPUT
// when running in GitHub Actions).
//
// Usage:
//   node fetch-triage-issues.js                # all un-triaged Backlog
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

// ── Linear GraphQL ────────────────────────────────────────────────────────────

async function linearQuery(query, variables = {}) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
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

// Fetch all Backlog issues and filter in JS.
// Linear's `labels: { every: { name: { nin: [...] } } }` silently excludes
// issues with NO labels (empty set fails the `every` predicate in Linear's API),
// so issues that have never been labelled would never be triaged. Fetching all
// and filtering client-side handles both zero-label and labelled issues correctly.
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

const UNTRIAGED_QUERY = `
  query UntriagedIssues {
    issues(
      filter: {
        state: { type: { eq: "backlog" } }
      }
      orderBy: updatedAt
      first: 50
    ) {
      nodes {
        identifier
        labels { nodes { name } }
      }
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
    const data = await linearQuery(UNTRIAGED_QUERY);
    identifiers = data.issues.nodes
      .filter((n) => !n.labels.nodes.some((l) => TRIAGE_SKIP_LABELS.has(l.name)))
      .map((n) => n.identifier);
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
