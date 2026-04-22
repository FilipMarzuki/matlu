#!/usr/bin/env node
// Creates all required GitHub labels for the Matlu agent workflows.
// Idempotent: skips labels that already exist (no error on re-run).
//
// Usage:
//   GITHUB_TOKEN=... node .github/scripts/create-labels.js [owner/repo]
//   Defaults to FilipMarzuki/matlu if no repo argument is provided.

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const repo = process.argv[2] || 'FilipMarzuki/matlu';

if (!GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN or GH_TOKEN must be set');
  process.exit(1);
}

// All labels required by the agent workflows and task conventions.
// color: 6-char hex without the leading #
const LABELS = [
  // Outcome — applied by the implementation agent after each run
  { name: 'agent:success',              color: '0e8a16', description: 'Agent completed the task successfully' },
  { name: 'agent:partial',              color: 'e4e669', description: 'Agent made partial progress; blocked or incomplete' },
  { name: 'agent:failed',               color: 'b60205', description: 'Agent was unable to make progress' },
  { name: 'agent:wrong-interpretation', color: 'd93f0b', description: 'Agent misread the issue; see comment for details' },
  { name: 'agent:already-shipped',      color: '0e8a16', description: 'Feature already on main; issue closed without re-implementation' },

  // Readiness — applied by the triage agent
  { name: 'ready',            color: '0075ca', description: 'Ready for the nightly implementation agent' },
  { name: 'needs-refinement', color: '7057ff', description: 'Close but missing specifics; description has been edited' },
  { name: 'blocked',          color: 'cfd3d7', description: 'Hard dependency on another issue or missing infrastructure' },
  { name: 'too-large',        color: 'cfd3d7', description: 'Needs to be split into 2+ smaller issues' },

  // State — applied manually or by agents to show active work
  { name: 'in-progress', color: '74d7c4', description: 'Currently being implemented' },

  // Category — used to classify issues by game area
  { name: 'systems',        color: 'f9d0c4', description: '' },
  { name: 'art',            color: 'f9d0c4', description: '' },
  { name: 'lore',           color: 'f9d0c4', description: '' },
  { name: 'infrastructure', color: 'f9d0c4', description: '' },
  { name: 'world',          color: 'f9d0c4', description: '' },
  { name: 'hero',           color: 'f9d0c4', description: '' },
  { name: 'tech',           color: 'f9d0c4', description: '' },
  { name: 'ui-hud',         color: 'f9d0c4', description: '' },
  { name: 'ui-menus',       color: 'f9d0c4', description: '' },
  { name: 'audio',          color: 'f9d0c4', description: '' },
  { name: 'weapons',        color: 'f9d0c4', description: '' },
  { name: 'enemies',        color: 'f9d0c4', description: '' },
  { name: 'waves',          color: 'f9d0c4', description: '' },
  { name: 'upgrades',       color: 'f9d0c4', description: '' },
  { name: 'parts',          color: 'f9d0c4', description: '' },
  { name: 'mobile',         color: 'f9d0c4', description: '' },

  // Type — work type taxonomy (one per issue, set by triage agent at intake).
  { name: 'type:feature',  color: 'a2eeef', description: 'New user-facing capability' },
  { name: 'type:bug',      color: 'd73a4a', description: 'Broken behaviour being fixed' },
  { name: 'type:refactor', color: 'c5def5', description: 'Code reshape, zero behaviour change' },
  { name: 'type:perf',     color: 'fbca04', description: 'Making existing behaviour faster/cheaper' },
  { name: 'type:infra',    color: '5319e7', description: 'CI, deploy, tooling, agent pipelines' },
  { name: 'type:docs',     color: '0075ca', description: 'Words only — README, ARCHITECTURE, plans' },
  { name: 'type:spike',    color: 'e99695', description: 'Time-boxed research, no deliverable' },
];

async function githubRequest(path, method = 'GET', body = null) {
  const url = `https://api.github.com/repos/${repo}${path}`;
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
  };
  if (body !== null) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  return res;
}

async function fetchExistingLabels() {
  const existing = new Set();
  let page = 1;
  while (true) {
    const res = await githubRequest(`/labels?per_page=100&page=${page}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to list labels (${res.status}): ${text}`);
    }
    const data = await res.json();
    for (const label of data) existing.add(label.name);
    if (data.length < 100) break;
    page++;
  }
  return existing;
}

async function main() {
  console.log(`Target repo: ${repo}`);
  const existing = await fetchExistingLabels();
  console.log(`Found ${existing.size} existing label(s).\n`);

  let created = 0;
  let skipped = 0;

  for (const label of LABELS) {
    if (existing.has(label.name)) {
      console.log(`  skip     ${label.name}`);
      skipped++;
      continue;
    }
    const res = await githubRequest('/labels', 'POST', {
      name: label.name,
      color: label.color,
      description: label.description,
    });
    if (res.status === 201) {
      console.log(`  created  ${label.name}`);
      created++;
    } else {
      const data = await res.json();
      console.error(`  error    ${label.name}: ${JSON.stringify(data)}`);
    }
  }

  console.log(`\nDone. ${created} created, ${skipped} skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
