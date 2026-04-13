#!/usr/bin/env node
// Weekly roadmap progress log + dev blog post for the Matlu project.
//
// Runs every Sunday via GitHub Actions (roadmap-update.yml).
// Also callable on-demand via workflow_dispatch.
//
// What it does:
//   1. Queries Linear for issues shipped and opened this week, plus any blocked items.
//   2. Creates a "Weekly Progress Log" child page under the Notion roadmap page.
//   3. Creates a dev blog post child page under the Notion blog page (if NOTION_BLOG_PAGE_ID is set).
//
// Secrets required:
//   NOTION_API_KEY          — Notion integration token
//   NOTION_ROADMAP_PAGE_ID  — parent page for progress-log entries
//                             (defaults to the Matlu roadmap: 340843c0718f81f2adc1c64213fa0f50)
//   NOTION_BLOG_PAGE_ID     — parent page for dev-blog posts (optional; skip if not set)
//   LINEAR_API_KEY          — Linear GraphQL API key
//
// Uses only Node.js built-ins (fetch available in Node 18+, used by Node 20 in CI).

import { fileURLToPath } from 'url';
import { dirname }       from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ── Credentials ───────────────────────────────────────────────────────────────

const NOTION_API_KEY = process.env.NOTION_API_KEY;

// The Matlu development roadmap page. Override via secret if the page moves.
// Page ID comes from the FIL-184 issue description (last path segment of the Notion URL).
const NOTION_ROADMAP_PAGE_ID =
  process.env.NOTION_ROADMAP_PAGE_ID || '340843c0718f81f2adc1c64213fa0f50';

// Dev blog parent page — optional. If absent, the blog post step is skipped.
const NOTION_BLOG_PAGE_ID = process.env.NOTION_BLOG_PAGE_ID || null;

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;

if (!NOTION_API_KEY) {
  console.error('❌  Missing NOTION_API_KEY');
  process.exit(1);
}
if (!LINEAR_API_KEY) {
  console.error('❌  Missing LINEAR_API_KEY');
  process.exit(1);
}

// ── Date helpers ──────────────────────────────────────────────────────────────

const now     = new Date();
const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

/** ISO date string like "2026-04-13" */
function isoDate(d = now) {
  return d.toISOString().slice(0, 10);
}

/** "Week of 2026-04-13" */
const weekLabel = `Week of ${isoDate()}`;

// ── Linear API ────────────────────────────────────────────────────────────────

/** Run a Linear GraphQL query and return `data`. Throws on HTTP or GraphQL errors. */
async function linearQuery(query, variables = {}) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      // Linear keys must NOT use a Bearer prefix — strip if present.
      Authorization: LINEAR_API_KEY.replace(/^Bearer\s+/i, ''),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Linear API → ${res.status}: ${body}`);
  }
  const json = await res.json();
  if (json.errors) throw new Error(`Linear GraphQL: ${json.errors.map((e) => e.message).join(', ')}`);
  return json.data;
}

// ── Linear queries ────────────────────────────────────────────────────────────

/**
 * Issues completed in the last 7 days.
 * Returns an array of { identifier, title, url }.
 */
async function getCompletedIssues() {
  const data = await linearQuery(
    `query CompletedIssues($since: DateTimeOrDuration!) {
      issues(
        filter: {
          state:       { type:        { eq: "completed" } }
          completedAt: { gt: $since }
        }
        orderBy: completedAt
        first: 50
      ) {
        nodes { identifier title url }
      }
    }`,
    { since: weekAgo.toISOString() },
  );
  return data.issues.nodes;
}

/**
 * Issues created in the last 7 days.
 * Returns an array of { identifier, title, url }.
 */
async function getOpenedIssues() {
  const data = await linearQuery(
    `query OpenedIssues($since: DateTimeOrDuration!) {
      issues(
        filter: { createdAt: { gt: $since } }
        orderBy: createdAt
        first: 50
      ) {
        nodes { identifier title url }
      }
    }`,
    { since: weekAgo.toISOString() },
  );
  return data.issues.nodes;
}

/**
 * Issues that carry a "blocked" label and are not yet completed.
 * Returns an array of { identifier, title, url }.
 */
async function getBlockedIssues() {
  const data = await linearQuery(
    `query BlockedIssues {
      issues(
        filter: {
          state:  { type: { nin: ["completed", "canceled"] } }
          labels: { some: { name: { eq: "blocked" } } }
        }
        first: 20
      ) {
        nodes { identifier title url }
      }
    }`,
  );
  return data.issues.nodes;
}

/**
 * Current active milestone: the first project milestone whose targetDate is
 * in the future (or has no date), with a count of completed vs total issues.
 *
 * Returns null if no project or milestone is found.
 */
async function getMilestoneProgress() {
  // Linear projects endpoint — filter to the "Matlu" project by name.
  // ProjectMilestone nodes are available under project.projectMilestones.
  const data = await linearQuery(
    `query MilestoneProgress {
      projects(filter: { name: { containsIgnoreCase: "matlu" } } first: 1) {
        nodes {
          name
          completedIssueCountHistory
          issueCountHistory
          projectMilestones {
            nodes {
              id
              name
              targetDate
              issues(
                filter: { state: { type: { eq: "completed" } } }
                first: 1
              ) { totalCount }
              issues { totalCount }
            }
          }
        }
      }
    }`,
  );

  const project = data.projects?.nodes?.[0];
  if (!project) return null;

  // Pick the first milestone that isn't in the past.
  const milestones = project.projectMilestones?.nodes ?? [];
  const active = milestones.find(
    (m) => !m.targetDate || new Date(m.targetDate) >= now,
  ) ?? milestones[0] ?? null;

  if (!active) return null;

  // `issues` appears twice in the query — Linear returns them in field order,
  // but the GraphQL spec merges duplicate fields. To get both "completed" and
  // "total" counts we'd need aliases. For simplicity, fetch them separately.
  return {
    name: active.name,
    targetDate: active.targetDate ?? null,
  };
}

// ── Notion helpers ────────────────────────────────────────────────────────────

/** Create a child page under `parentId` with the given title and block content. */
async function createNotionPage(parentId, title, children) {
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization:    `Bearer ${NOTION_API_KEY}`,
      'Content-Type':   'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent: { page_id: parentId },
      properties: {
        title: { title: [{ type: 'text', text: { content: title } }] },
      },
      children,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion create page failed: ${res.status} ${body}`);
  }
  return res.json();
}

// ── Notion block builders ─────────────────────────────────────────────────────

function heading2(text) {
  return {
    object: 'block',
    type:   'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: text } }],
    },
  };
}

function heading3(text) {
  return {
    object: 'block',
    type:   'heading_3',
    heading_3: {
      rich_text: [{ type: 'text', text: { content: text } }],
    },
  };
}

function paragraph(text) {
  return {
    object: 'block',
    type:   'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: text } }],
    },
  };
}

/** Bulleted list item with optional external link. */
function bullet(text, url) {
  const richText = url
    ? [{ type: 'text', text: { content: text, link: { url } } }]
    : [{ type: 'text', text: { content: text } }];
  return {
    object: 'block',
    type:   'bulleted_list_item',
    bulleted_list_item: { rich_text: richText },
  };
}

function divider() {
  return { object: 'block', type: 'divider', divider: {} };
}

// ── Build Notion page content ─────────────────────────────────────────────────

/**
 * Roadmap progress-log entry blocks.
 * Posted as a child page under the roadmap page.
 */
function buildRoadmapBlocks(completed, opened, blocked, milestone) {
  const blocks = [];

  // ── Milestone ────────────────────────────────────────────────────────────
  blocks.push(heading2('Current Milestone'));
  if (milestone) {
    const dueStr = milestone.targetDate
      ? ` (target: ${milestone.targetDate})`
      : '';
    blocks.push(paragraph(`${milestone.name}${dueStr}`));
  } else {
    // Fall back to the static milestone from CLAUDE.md
    blocks.push(paragraph('Milestone 1 — vehicle moving on a map with joystick controls ✓'));
  }
  blocks.push(paragraph('Progress estimate: see issues below for current velocity.'));

  blocks.push(divider());

  // ── Issues shipped ────────────────────────────────────────────────────────
  blocks.push(heading2('Issues Shipped This Week'));
  if (completed.length === 0) {
    blocks.push(paragraph('None completed this week.'));
  } else {
    for (const issue of completed) {
      blocks.push(bullet(`${issue.identifier}: ${issue.title}`, issue.url));
    }
  }

  blocks.push(divider());

  // ── Issues opened ─────────────────────────────────────────────────────────
  blocks.push(heading2('Issues Opened This Week'));
  if (opened.length === 0) {
    blocks.push(paragraph('No new issues created this week.'));
  } else {
    for (const issue of opened) {
      blocks.push(bullet(`${issue.identifier}: ${issue.title}`, issue.url));
    }
  }

  blocks.push(divider());

  // ── Blocked ───────────────────────────────────────────────────────────────
  blocks.push(heading2('Blocked'));
  if (blocked.length === 0) {
    blocks.push(paragraph('Nothing blocked.'));
  } else {
    for (const issue of blocked) {
      blocks.push(bullet(`${issue.identifier}: ${issue.title}`, issue.url));
    }
  }

  blocks.push(divider());

  // ── DORA snapshot ─────────────────────────────────────────────────────────
  // FIL-182 (deployment frequency) and FIL-183 (change failure rate / MTTR)
  // are not yet live. Once they are, replace this placeholder with real data.
  blocks.push(heading2('DORA Snapshot'));
  blocks.push(
    paragraph(
      'DORA metrics will be included here once FIL-182 (deployment frequency + ' +
      'lead time) and FIL-183 (change failure rate + MTTR) are live.',
    ),
  );

  blocks.push(divider());

  // ── Notes ─────────────────────────────────────────────────────────────────
  blocks.push(heading2('Notes'));
  blocks.push(
    paragraph(
      'Add design decisions, open questions, or things to explore here. ' +
      '(This section is intentionally left for human or agent annotation.)',
    ),
  );

  return blocks;
}

/**
 * Dev blog post blocks.
 * Tone: honest, exploratory, indie dev voice. Not marketing — genuine updates.
 * Posted as a child page under the blog page.
 */
function buildBlogBlocks(completed, opened, milestone) {
  const blocks = [];

  // Intro paragraph
  const shippedCount = completed.length;
  const openedCount  = opened.length;
  blocks.push(
    paragraph(
      `Another week on Matlu. We shipped ${shippedCount} issue${shippedCount !== 1 ? 's' : ''} ` +
      `and opened ${openedCount} new one${openedCount !== 1 ? 's' : ''}. Here's the honest rundown.`,
    ),
  );

  blocks.push(heading2('What Shipped'));
  if (completed.length === 0) {
    blocks.push(
      paragraph(
        'Quiet week on the closed-issue front — most work was in-progress or exploratory.',
      ),
    );
  } else {
    for (const issue of completed) {
      blocks.push(bullet(`${issue.identifier}: ${issue.title}`, issue.url));
    }
  }

  blocks.push(heading2('What Came In'));
  if (opened.length === 0) {
    blocks.push(paragraph('No new issues opened this week.'));
  } else {
    blocks.push(
      paragraph(
        `${openedCount} new issue${openedCount !== 1 ? 's' : ''} landed in the backlog:`,
      ),
    );
    for (const issue of opened) {
      blocks.push(bullet(`${issue.identifier}: ${issue.title}`, issue.url));
    }
  }

  blocks.push(heading2("What's Next"));
  if (milestone) {
    blocks.push(
      paragraph(
        `Current focus: ${milestone.name}. ` +
        (milestone.targetDate
          ? `Targeting ${milestone.targetDate}.`
          : 'No hard deadline — moving at sustainable pace.'),
      ),
    );
  } else {
    blocks.push(
      paragraph(
        'Current milestone: see the Notion roadmap for the full picture.',
      ),
    );
  }
  blocks.push(
    paragraph(
      'Full roadmap and progress log: https://www.notion.so/340843c0718f81f2adc1c64213fa0f50',
    ),
  );

  return blocks;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`📅  ${weekLabel}`);
  console.log('Fetching data from Linear...');

  const [completed, opened, blocked, milestone] = await Promise.all([
    getCompletedIssues().catch((e) => { console.warn('getCompletedIssues failed:', e.message); return []; }),
    getOpenedIssues().catch((e)   => { console.warn('getOpenedIssues failed:', e.message);   return []; }),
    getBlockedIssues().catch((e)  => { console.warn('getBlockedIssues failed:', e.message);  return []; }),
    getMilestoneProgress().catch((e) => { console.warn('getMilestoneProgress failed:', e.message); return null; }),
  ]);

  console.log(`  ✓ Completed: ${completed.length}`);
  console.log(`  ✓ Opened:    ${opened.length}`);
  console.log(`  ✓ Blocked:   ${blocked.length}`);
  console.log(`  ✓ Milestone: ${milestone?.name ?? '(none found)'}`);

  // ── Post roadmap progress log ─────────────────────────────────────────────
  const roadmapTitle  = `Progress Log — ${weekLabel}`;
  const roadmapBlocks = buildRoadmapBlocks(completed, opened, blocked, milestone);

  console.log(`\nPosting roadmap entry "${roadmapTitle}"...`);
  const roadmapPage = await createNotionPage(
    NOTION_ROADMAP_PAGE_ID,
    roadmapTitle,
    roadmapBlocks,
  );
  console.log(`  ✓ Created: ${roadmapPage.url}`);

  // ── Post dev blog entry ───────────────────────────────────────────────────
  if (NOTION_BLOG_PAGE_ID) {
    const blogTitle  = `Dev Update — ${weekLabel}`;
    const blogBlocks = buildBlogBlocks(completed, opened, milestone);

    console.log(`\nPosting blog entry "${blogTitle}"...`);
    const blogPage = await createNotionPage(
      NOTION_BLOG_PAGE_ID,
      blogTitle,
      blogBlocks,
    );
    console.log(`  ✓ Created: ${blogPage.url}`);
  } else {
    console.log('\nNOTION_BLOG_PAGE_ID not set — skipping dev blog post.');
    console.log('Set this secret to the ID of the Notion Dev Blog parent page to enable blog posts.');
  }

  console.log('\n✅  Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
