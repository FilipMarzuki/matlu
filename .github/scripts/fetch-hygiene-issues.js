#!/usr/bin/env node
// Fetches Linear issues that need hygiene work and outputs them as a matrix.
//
// Three query types, merged into one array of "ISSUE_ID:type" strings:
//   mark-done  — In Progress issues assigned to me (check if PR is merged)
//   split      — Issues labelled `too-large`
//   enrich     — Issues labelled `needs-refinement`
//
// Usage:
//   node fetch-hygiene-issues.js
//   node fetch-hygiene-issues.js --issue FIL-42:mark-done  # single override

import { appendFileSync } from 'fs';

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const GITHUB_OUTPUT  = process.env.GITHUB_OUTPUT;

if (!LINEAR_API_KEY) {
  console.error('Missing LINEAR_API_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const overrideIdx = args.indexOf('--issue');
const issueOverride = overrideIdx >= 0 ? args[overrideIdx + 1] : null;

// ── Linear GraphQL ────────────────────────────────────────────────────────────

async function linear(query, variables = {}) {
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

// In Progress issues assigned to me — check if their PR is merged
const IN_PROGRESS_QUERY = `
  query {
    issues(filter: {
      state: { type: { eq: "started" } }
      assignee: { isMe: { eq: true } }
    }, first: 50, orderBy: updatedAt) {
      nodes { identifier }
    }
  }
`;

// Issues labelled too-large (not already split)
const TOO_LARGE_QUERY = `
  query {
    issues(filter: {
      labels: { name: { eq: "too-large" } }
      state: { type: { nin: ["completed", "cancelled"] } }
    }, first: 20, orderBy: updatedAt) {
      nodes {
        identifier
        labels { nodes { name } }
        children { nodes { id } }
      }
    }
  }
`;

// Issues labelled needs-refinement
const NEEDS_REFINEMENT_QUERY = `
  query {
    issues(filter: {
      labels: { name: { eq: "needs-refinement" } }
      state: { type: { nin: ["completed", "cancelled"] } }
    }, first: 20, orderBy: updatedAt) {
      nodes { identifier }
    }
  }
`;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  let entries; // array of "FIL-123:type" strings

  if (issueOverride) {
    // Single-issue override — must include type suffix
    if (!issueOverride.includes(':')) {
      console.error('Single-issue override must include type, e.g. FIL-42:mark-done');
      process.exit(1);
    }
    entries = [issueOverride];
  } else {
    const [inProgress, tooLarge, needsRefinement] = await Promise.all([
      linear(IN_PROGRESS_QUERY),
      linear(TOO_LARGE_QUERY),
      linear(NEEDS_REFINEMENT_QUERY),
    ]);

    const markDone = inProgress.issues.nodes
      .map(n => `${n.identifier}:mark-done`);

    // Skip issues that already have children (already split)
    const split = tooLarge.issues.nodes
      .filter(n => n.children.nodes.length === 0)
      .filter(n => !n.labels.nodes.some(l => l.name === 'split'))
      .map(n => `${n.identifier}:split`);

    const enrich = needsRefinement.issues.nodes
      .map(n => `${n.identifier}:enrich`);

    entries = [...markDone, ...split, ...enrich];
  }

  // Deduplicate (an issue could theoretically match multiple queries)
  const seen = new Set();
  entries = entries.filter(e => {
    if (seen.has(e)) return false;
    seen.add(e);
    return true;
  });

  console.log(`Found ${entries.length} hygiene task(s):`);
  for (const e of entries) console.log(`  ${e}`);

  const serialised = JSON.stringify(entries);

  if (GITHUB_OUTPUT) {
    appendFileSync(GITHUB_OUTPUT, `issues=${serialised}\n`);
    appendFileSync(GITHUB_OUTPUT, `has_issues=${entries.length > 0}\n`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
