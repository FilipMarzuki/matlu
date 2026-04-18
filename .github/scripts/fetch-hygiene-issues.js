#!/usr/bin/env node
// Fetches GitHub Issues that need hygiene work and outputs them as a matrix.
//
// Three query types, merged into one array of "NUMBER:type" strings:
//   mark-done  — open issues with `in-progress` label (check if PR is merged)
//   split      — open issues with `too-large` label
//   enrich     — open issues with `needs-refinement` label
//
// Usage:
//   node fetch-hygiene-issues.js
//   node fetch-hygiene-issues.js --issue 42:mark-done  # single override

import { appendFileSync } from 'fs';

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;
const REPO          = 'FilipMarzuki/matlu';

if (!GITHUB_TOKEN) {
  console.error('Missing GITHUB_TOKEN');
  process.exit(1);
}

const args = process.argv.slice(2);
const overrideIdx = args.indexOf('--issue');
const issueOverride = overrideIdx >= 0 ? args[overrideIdx + 1] : null;

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

async function fetchByLabel(label) {
  const items = [];
  let nextUrl = `https://api.github.com/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`;
  while (nextUrl) {
    const { json, linkHeader } = await githubFetch(nextUrl);
    items.push(...json.filter(i => !i.pull_request));
    const match = linkHeader?.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = match ? match[1] : null;
  }
  return items;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  let entries; // array of "42:type" strings

  if (issueOverride) {
    if (!issueOverride.includes(':')) {
      console.error('Single-issue override must include type, e.g. 42:mark-done');
      process.exit(1);
    }
    entries = [issueOverride];
  } else {
    const [inProgress, tooLarge, needsRefinement] = await Promise.all([
      fetchByLabel('in-progress'),
      fetchByLabel('too-large'),
      fetchByLabel('needs-refinement'),
    ]);

    const markDone = inProgress.map(i => `${i.number}:mark-done`);

    // Skip too-large issues that already have a `split` label (already split)
    const split = tooLarge
      .filter(i => !i.labels.some(l => l.name === 'split'))
      .map(i => `${i.number}:split`);

    const enrich = needsRefinement.map(i => `${i.number}:enrich`);

    entries = [...markDone, ...split, ...enrich];
  }

  // Deduplicate (an issue could match multiple queries)
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
