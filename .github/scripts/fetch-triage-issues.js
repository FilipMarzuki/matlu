#!/usr/bin/env node
// Fetches GitHub Issues that haven't been triaged yet.
//
// "Not triaged" = open issue with none of: ready, needs-refinement, blocked,
// too-large, agent:success, agent:partial, agent:failed, agent:wrong-interpretation.
//
// GitHub's label filter API can only require ALL listed labels to be present,
// not the inverse (exclude issues having any of these labels). We fetch all
// open issues and filter client-side.
//
// Emits a JSON array of GitHub issue numbers on stdout.
// In GitHub Actions, also appends `issues=[...]` to $GITHUB_OUTPUT.
//
// Usage:
//   node fetch-triage-issues.js                # all un-triaged issues
//   node fetch-triage-issues.js --issue 42     # single-issue override

import { appendFileSync } from 'fs';

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;
const REPO          = 'FilipMarzuki/matlu';

if (!GITHUB_TOKEN) {
  console.error('Missing GITHUB_TOKEN');
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

// ── GitHub Issues REST API ────────────────────────────────────────────────────

async function githubFetch(url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub API → ${res.status} ${await res.text()}`);
  return { json: await res.json(), linkHeader: res.headers.get('link') };
}

async function fetchAllPages(url) {
  const items = [];
  let nextUrl = url;
  while (nextUrl) {
    const { json, linkHeader } = await githubFetch(nextUrl);
    items.push(...json);
    nextUrl = parseNextLink(linkHeader);
  }
  return items;
}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  let numbers;

  if (issueOverride) {
    const issueNum = parseInt(issueOverride, 10);
    if (isNaN(issueNum)) {
      console.error(`Invalid issue number: ${issueOverride}`);
      process.exit(1);
    }
    numbers = [issueNum];
  } else {
    const issues = await fetchAllPages(
      `https://api.github.com/repos/${REPO}/issues?state=open&per_page=100`
    );
    numbers = issues
      // GitHub Issues API also returns pull requests — exclude them.
      .filter(i => !i.pull_request)
      .filter(i => !i.labels.some(l => TRIAGE_SKIP_LABELS.has(l.name)))
      .map(i => i.number);
  }

  const serialised = JSON.stringify(numbers);
  console.log(serialised);

  if (GITHUB_OUTPUT) {
    appendFileSync(GITHUB_OUTPUT, `issues=${serialised}\n`);
    appendFileSync(GITHUB_OUTPUT, `has_issues=${numbers.length > 0}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
