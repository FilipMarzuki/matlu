#!/usr/bin/env node
// Fetches GitHub Issues eligible for the per-issue nightly agent.
//
// Eligibility: open issues with label "ready" assigned to FilipMarzuki.
//
// Emits a JSON array of GitHub issue numbers (e.g. [42, 43]) on stdout.
// When run in GitHub Actions, also appends `issues=[...]` to $GITHUB_OUTPUT
// so the downstream matrix job can fan out over them.
//
// Usage:
//   node fetch-agent-issues.js                # default: ready issues
//   node fetch-agent-issues.js --issue 42     # single-issue override
//                                             #   (for workflow_dispatch)

import { appendFileSync } from 'fs';

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;
const REPO          = 'FilipMarzuki/matlu';

if (!GITHUB_TOKEN) {
  console.error('Missing GITHUB_TOKEN');
  process.exit(1);
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const issueOverrideIdx = args.indexOf('--issue');
const issueOverride = issueOverrideIdx >= 0 ? args[issueOverrideIdx + 1] : null;

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

// Follow Link header pagination until no rel="next" page remains.
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
    const { json } = await githubFetch(
      `https://api.github.com/repos/${REPO}/issues/${issueNum}`
    );
    numbers = [json.number];
  } else {
    const issues = await fetchAllPages(
      `https://api.github.com/repos/${REPO}/issues?state=open&labels=ready&assignee=FilipMarzuki&per_page=100`
    );
    // GitHub Issues API returns pull requests too — exclude them.
    numbers = issues.filter((i) => !i.pull_request).map((i) => i.number);
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
