#!/usr/bin/env node
// Fetches GitHub Issues eligible for the per-issue nightly agent.
//
// Eligibility: open issues with "ready" label but NOT "blocked", "epic",
// "in-progress" or "agent:in-progress", and not already closed by an open PR on
// any branch (avoids building work twice while a PR is in flight, #1593).
//
// Emits a JSON array of GitHub issue numbers (e.g. [42, 43]) on stdout.
// In GitHub Actions, also appends `issues=[...]` to $GITHUB_OUTPUT so the
// downstream matrix job can fan out over them.
//
// Usage:
//   node fetch-agent-issues.js                # default: all ready issues
//   node fetch-agent-issues.js --issue 42     # single-issue override (workflow_dispatch)

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
    // Fetch all open issues with the "ready" label.
    const issues = await fetchAllPages(
      `https://api.github.com/repos/${REPO}/issues?state=open&labels=ready&per_page=100`
    );

    // Fetch all open PRs (drafts too) and build a set of issue numbers one of them
    // already closes. Any branch counts, not only Bender's own (bender/*): an
    // interactive or subagent session's claude/* PR means the work is taken too
    // (#1593). This also covers the race where agent:in-progress is removed after
    // a successful run but the PR hasn't merged yet.
    const openPRs = await fetchAllPages(
      `https://api.github.com/repos/${REPO}/pulls?state=open&per_page=100`
    );
    const issuesWithOpenPR = new Set();
    for (const pr of openPRs) {
      const body = pr.body ?? '';
      // GitHub's closing keywords: close/closes/closed, fix/fixes/fixed, resolve/resolves/resolved.
      for (const m of body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)) {
        issuesWithOpenPR.add(parseInt(m[1], 10));
      }
    }
    console.error(`[fetch] ${issuesWithOpenPR.size} issue(s) taken by open PRs: ${JSON.stringify([...issuesWithOpenPR])}`);

    // GitHub Issues API also returns pull requests — exclude them.
    // Also exclude issues that are blocked, already being built (`in-progress`
    // is set by interactive and subagent sessions, `agent:in-progress` by
    // Bender), or epics: an epic groups sub-issues and is never built itself (#1593).
    // Sort: bugs and rework first (they affect players now), then everything else.
    const hasLabel = (issue, name) => issue.labels.some(l => l.name === name);
    const bugPriority = (issue) => {
      if (hasLabel(issue, 'bug'))    return 0;
      if (hasLabel(issue, 'rework')) return 1;
      return 2;
    };
    numbers = issues
      .filter(i => !i.pull_request)
      .filter(i => !hasLabel(i, 'blocked'))
      .filter(i => !hasLabel(i, 'agent:in-progress'))
      .filter(i => !hasLabel(i, 'in-progress'))
      .filter(i => !hasLabel(i, 'epic'))
      .filter(i => !issuesWithOpenPR.has(i.number))
      .sort((a, b) => bugPriority(a) - bugPriority(b))
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
