#!/usr/bin/env node
// One-shot helper for FIL-546: backfill exactly one type:* label onto every
// open GitHub issue that does not already have one.
//
// Default mode is dry-run. Pass --apply to write labels.

import { appendFileSync } from 'fs';

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const repoArg = process.argv.slice(2).find((arg) => !arg.startsWith('--') && /^[^/\s]+\/[^/\s]+$/.test(arg));
const REPO = process.env.GITHUB_REPOSITORY || repoArg || 'FilipMarzuki/matlu';
const APPLY = process.argv.includes('--apply');
const TYPE_LABELS = [
  'type:feature',
  'type:bug',
  'type:refactor',
  'type:perf',
  'type:infra',
  'type:docs',
  'type:spike',
];

const RULES = [
  { label: 'type:bug', patterns: [/\bbug\b/i, /\bfix(?:e[ds])?\b/i, /\bbroken\b/i, /\bregression\b/i] },
  { label: 'type:refactor', patterns: [/\brefactor\b/i, /\brename\b/i, /\bextract\b/i, /\bmove\b/i, /\bcleanup\b/i] },
  { label: 'type:perf', patterns: [/\bperf\b/i, /\bperformance\b/i, /\boptimi[sz]e\b/i, /\bslow\b/i, /\bspeed\b/i] },
  { label: 'type:infra', patterns: [/\bci\b/i, /\bdeploy\b/i, /\bworkflow\b/i, /\bagent\b/i, /\blint\b/i, /\btooling\b/i] },
  { label: 'type:docs', patterns: [/\bdocs\b/i, /\breadme\b/i, /\bdocument\b/i, /\bexplain\b/i, /\bplan\b/i] },
  { label: 'type:spike', patterns: [/\bspike\b/i, /\binvestigate\b/i, /\bresearch\b/i, /\bexplore\b/i, /\bevaluate\b/i] },
];

if (!TOKEN) {
  console.error('Error: GITHUB_TOKEN or GH_TOKEN must be set');
  process.exit(1);
}

const [OWNER, NAME] = REPO.split('/');
if (!OWNER || !NAME) {
  console.error(`Error: invalid repo "${REPO}". Expected owner/name.`);
  process.exit(1);
}

async function githubGraphql(query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) {
    throw new Error(`GitHub GraphQL failed (${res.status}): ${JSON.stringify(data.errors || data)}`);
  }
  return data.data;
}

async function fetchOpenIssues() {
  const issues = [];
  let cursor = null;
  do {
    const data = await githubGraphql(
      `
      query FetchOpenIssues($owner: String!, $name: String!, $cursor: String) {
        repository(owner: $owner, name: $name) {
          issues(first: 100, after: $cursor, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
            nodes {
              id
              number
              title
              body
              labels(first: 100) {
                nodes {
                  id
                  name
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
      `,
      { owner: OWNER, name: NAME, cursor },
    );
    const page = data.repository.issues;
    issues.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return issues;
}

async function fetchTypeLabelIds() {
  const labelsByName = new Map();
  let cursor = null;
  do {
    const data = await githubGraphql(
      `
      query FetchTypeLabels($owner: String!, $name: String!, $cursor: String) {
        repository(owner: $owner, name: $name) {
          labels(first: 100, after: $cursor, query: "type:") {
            nodes {
              id
              name
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
      `,
      { owner: OWNER, name: NAME, cursor },
    );
    const page = data.repository.labels;
    for (const label of page.nodes) {
      if (TYPE_LABELS.includes(label.name)) labelsByName.set(label.name, label.id);
    }
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  const missing = TYPE_LABELS.filter((name) => !labelsByName.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing required labels: ${missing.join(', ')}. Run create-labels first.`);
  }
  return labelsByName;
}

function classifyIssue(issue) {
  const haystack = `${issue.title}\n${issue.body || ''}`;
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) return rule.label;
  }
  return 'type:feature';
}

function summarize(plans, skipped, conflicts) {
  const counts = new Map(TYPE_LABELS.map((label) => [label, 0]));
  for (const plan of plans) counts.set(plan.label, (counts.get(plan.label) || 0) + 1);

  const lines = [
    `# Type label backfill ${APPLY ? 'apply' : 'dry-run'} summary`,
    '',
    `Repository: ${REPO}`,
    `Open issues scanned: ${plans.length + skipped.length + conflicts.length}`,
    `Issues already labelled: ${skipped.length}`,
    `Issues with multiple type labels: ${conflicts.length}`,
    `Issues ${APPLY ? 'labelled' : 'to label'}: ${plans.length}`,
    '',
    '## Count by proposed type',
    '',
    '| Label | Count |',
    '| ----- | ----- |',
    ...TYPE_LABELS.map((label) => `| \`${label}\` | ${counts.get(label) || 0} |`),
  ];

  if (plans.length > 0) {
    lines.push('', '## Proposed changes', '');
    for (const plan of plans) lines.push(`- #${plan.number} \`${plan.label}\` — ${plan.title}`);
  }
  if (conflicts.length > 0) {
    lines.push('', '## Conflicts skipped', '');
    for (const issue of conflicts) lines.push(`- #${issue.number} has multiple type labels: ${issue.typeLabels.join(', ')}`);
  }
  return lines.join('\n');
}

async function addLabel(issueId, labelId) {
  await githubGraphql(
    `
    mutation AddTypeLabel($issueId: ID!, $labelIds: [ID!]!) {
      addLabelsToLabelable(input: { labelableId: $issueId, labelIds: $labelIds }) {
        clientMutationId
      }
    }
    `,
    { issueId, labelIds: [labelId] },
  );
}

async function main() {
  console.log(`Target repo: ${REPO}`);
  console.log(`Mode: ${APPLY ? 'apply' : 'dry-run'}\n`);

  const [issues, labelIds] = await Promise.all([fetchOpenIssues(), fetchTypeLabelIds()]);
  const plans = [];
  const skipped = [];
  const conflicts = [];

  for (const issue of issues) {
    const labelNames = issue.labels.nodes.map((label) => label.name);
    const typeLabels = labelNames.filter((label) => TYPE_LABELS.includes(label));
    if (typeLabels.length === 1) {
      skipped.push(issue);
      continue;
    }
    if (typeLabels.length > 1) {
      conflicts.push({ number: issue.number, title: issue.title, typeLabels });
      continue;
    }
    plans.push({
      id: issue.id,
      number: issue.number,
      title: issue.title,
      label: classifyIssue(issue),
    });
  }

  const summary = summarize(plans, skipped, conflicts);
  console.log(summary);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }

  if (!APPLY) return;

  for (const plan of plans) {
    const labelId = labelIds.get(plan.label);
    console.log(`Applying ${plan.label} to #${plan.number}`);
    await addLabel(plan.id, labelId);
  }

  console.log(`\nDone. Applied ${plans.length} label(s); skipped ${skipped.length}; conflicts ${conflicts.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
