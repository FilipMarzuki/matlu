#!/usr/bin/env node
/**
 * Draft a weekly Agentic Experiments blog post.
 *
 * 1. Fetch merged PRs from GitHub for the past 7 days.
 * 2. Fetch Learning Summary and Release Notes pages from Notion.
 * 3. Write dev/src/content/blog/<iso-date>-weekly.md with draft: true.
 * 4. Create branch claude/dev-blog-draft-<date>, commit, push, open PR.
 *
 * Uses only Node.js built-ins (fetch available in Node 18+).
 * Handles missing Notion data gracefully — blog draft still writes.
 */

import { execSync }  from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname }    from 'path';
import { fileURLToPath }    from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = join(__dirname, '..', '..');

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const NOTION_KEY    = process.env.NOTION_API_KEY;
const REPO_OWNER    = process.env.REPO_OWNER || 'FilipMarzuki';
const REPO_NAME     = process.env.REPO_NAME  || 'matlu';

// Notion Dev Blog parent page ID (from LORE.md key pages)
const DEV_BLOG_PAGE_ID = '33f843c0-718f-8197-8972-fb2b6e44754a';
const NOTION_VERSION   = '2022-06-28';

// ── Date helpers ──────────────────────────────────────────────────────────────

const now      = new Date();
const weekAgo  = new Date(now - 7 * 24 * 60 * 60 * 1000);

function isoDate(d = now) {
  return d.toISOString().split('T')[0];
}

function shortDate(d = now) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── GitHub helpers ────────────────────────────────────────────────────────────

async function ghGet(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} → ${res.status}`);
  return res.json();
}

async function fetchMergedPRs() {
  const pulls = await ghGet(
    `/repos/${REPO_OWNER}/${REPO_NAME}/pulls?state=closed&per_page=100&sort=updated&direction=desc`
  );
  return pulls
    .filter((pr) => pr.merged_at && new Date(pr.merged_at) >= weekAgo)
    .map((pr) => ({
      number: pr.number,
      title:  pr.title,
      url:    pr.html_url,
      merged: pr.merged_at,
      author: pr.user?.login ?? 'unknown',
      labels: (pr.labels ?? []).map((l) => l.name),
    }));
}

// ── Notion helpers ────────────────────────────────────────────────────────────

async function notionGet(path) {
  if (!NOTION_KEY) return null;
  try {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      headers: {
        Authorization:    `Bearer ${NOTION_KEY}`,
        'Notion-Version': NOTION_VERSION,
      },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/** Get all child pages of a Notion page, sorted newest-first. */
async function getChildPages(pageId) {
  const data = await notionGet(`/blocks/${pageId}/children?page_size=100`);
  if (!data?.results) return [];
  return data.results.filter((b) => b.type === 'child_page');
}

/** Extract plain text from Notion rich_text array. */
function richText(arr = []) {
  return arr.map((t) => t.plain_text).join('');
}

/** Get the plain-text content of a Notion page's blocks (one level deep). */
async function getPageText(pageId) {
  const data = await notionGet(`/blocks/${pageId}/children?page_size=50`);
  if (!data?.results) return '';
  return data.results
    .map((b) => {
      const type = b.type;
      if (!b[type]?.rich_text) return '';
      return richText(b[type].rich_text);
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Find the most recent child page of DEV_BLOG_PAGE_ID whose title
 * matches the given prefix (e.g. "Weekly Learning", "Release Notes").
 */
async function findRecentPage(titlePrefix) {
  const children = await getChildPages(DEV_BLOG_PAGE_ID);
  for (const block of children) {
    const title = block.child_page?.title ?? '';
    if (title.toLowerCase().startsWith(titlePrefix.toLowerCase())) {
      return { title, text: await getPageText(block.id) };
    }
  }
  return null;
}

// ── Blog markdown builder ─────────────────────────────────────────────────────

function buildMarkdown({ date, prs, learningSummary, releaseNotes }) {
  const dateLabel  = isoDate(new Date(date));
  const humanDate  = shortDate(new Date(date));
  const prCount    = prs.length;

  // Derive a short headline from PR titles
  const agentPRs   = prs.filter((p) => p.author === 'github-actions[bot]' || p.labels.includes('agent:success') || p.labels.includes('agent:partial'));
  const headline   = prCount > 0
    ? `${prCount} PR${prCount !== 1 ? 's' : ''} merged${agentPRs.length ? `, ${agentPRs.length} by agents` : ''}`
    : 'a quiet week';

  // Group PRs by project (game / wiki / dev)
  const gamePRs  = prs.filter((p) => !p.title.match(/\[(wiki|codex|dev|agentic)\]/i) && !p.labels.includes('infrastructure'));
  const wikPRs   = prs.filter((p) => p.title.match(/codex|wiki/i) || p.labels.includes('lore') || p.labels.includes('world'));
  const devPRs   = prs.filter((p) => p.title.match(/agentic|dev.*blog|dev.*agent/i) || p.labels.includes('infrastructure'));
  const otherPRs = prs.filter((p) => !gamePRs.includes(p) && !wikPRs.includes(p) && !devPRs.includes(p));

  function prLine(p) {
    const outcome = p.labels.find((l) => l.startsWith('agent:'));
    const tag = outcome ? ` *(${outcome.replace('agent:', '')})*` : '';
    return `- [#${p.number}](${p.url}) — ${p.title}${tag}`;
  }

  const sections = [];

  // PRs merged section
  sections.push('## What shipped\n');
  if (prs.length === 0) {
    sections.push('No PRs merged this week.\n');
  } else {
    if (gamePRs.length)  sections.push(`**Game**\n${gamePRs.map(prLine).join('\n')}\n`);
    if (wikPRs.length)   sections.push(`**Codex**\n${wikPRs.map(prLine).join('\n')}\n`);
    if (devPRs.length)   sections.push(`**Dev site**\n${devPRs.map(prLine).join('\n')}\n`);
    if (otherPRs.length) sections.push(`**Other**\n${otherPRs.map(prLine).join('\n')}\n`);
  }

  // What we learned
  sections.push('## What we learned\n');
  if (learningSummary?.text) {
    // Take the first 600 chars as a prose snippet
    const snippet = learningSummary.text.trim().slice(0, 600).replace(/\n{3,}/g, '\n\n');
    sections.push(snippet + (learningSummary.text.length > 600 ? '\n\n*(see full Learning Summary in Notion)*' : '') + '\n');
  } else {
    sections.push('*Learning summary not available this week — check the Notion Dev Blog.*\n');
  }

  // Metrics snapshot (placeholder — populated by human before publishing)
  sections.push('## Metrics snapshot\n');
  sections.push('| Metric | Value |\n|--------|-------|\n| PRs merged | ' + prCount + ' |\n| Agent PRs | ' + agentPRs.length + ' |\n\n*(Add Supabase stats_weekly data before publishing.)*\n');

  // Release notes snippet
  if (releaseNotes?.text) {
    sections.push('## From the release notes\n');
    const snippet = releaseNotes.text.trim().slice(0, 400).replace(/\n{3,}/g, '\n\n');
    sections.push(snippet + (releaseNotes.text.length > 400 ? '\n\n*(see full Release Notes in Notion)*' : '') + '\n');
  }

  const frontmatter = [
    '---',
    `title: "Week of ${humanDate}: ${headline}"`,
    `date: ${dateLabel}`,
    `summary: "This week: ${headline}. ${prCount > 0 ? prs[0].title.slice(0, 60) + (prs[0].title.length > 60 ? '…' : '') + '.' : 'A quiet week in the Matlu automation stack.'}"`,
    'tags: ["weekly", "agents", "automation"]',
    'draft: true',
    '---',
  ].join('\n');

  return `${frontmatter}\n\n${sections.join('\n')}`;
}

// ── Git helpers ───────────────────────────────────────────────────────────────

function exec(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function execOut(cmd) {
  return execSync(cmd, { encoding: 'utf-8' }).trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const date   = isoDate();
  const branch = `claude/dev-blog-draft-${date}`;

  console.log(`Draft blog post for ${date}`);

  // 1. Fetch data
  console.log('Fetching merged PRs…');
  const prs = GITHUB_TOKEN ? await fetchMergedPRs().catch(() => []) : [];
  console.log(`  ${prs.length} PRs merged this week`);

  console.log('Fetching Notion pages…');
  const [learningSummary, releaseNotes] = await Promise.all([
    findRecentPage('Weekly Learning').catch(() => null),
    findRecentPage('Release Notes').catch(() => null),
  ]);
  console.log(`  Learning Summary: ${learningSummary ? 'found' : 'not found'}`);
  console.log(`  Release Notes:   ${releaseNotes    ? 'found' : 'not found'}`);

  // 2. Build markdown
  const md = buildMarkdown({ date, prs, learningSummary, releaseNotes });
  const filename = `${date}-weekly.md`;
  const outDir   = join(REPO_ROOT, 'dev', 'src', 'content', 'blog');
  const outPath  = join(outDir, filename);

  // 3. Write file on new branch
  exec(`git checkout -b ${branch}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, md, 'utf-8');
  console.log(`Wrote ${outPath}`);

  // 4. Commit + push
  exec(`git add "${outPath}"`);
  exec(`git commit -m "feat(blog): weekly draft ${date} [skip ci]"`);
  exec(`git push -u origin ${branch}`);
  console.log(`Pushed branch ${branch}`);

  // 5. Open PR
  const prBody = [
    '## Weekly blog draft',
    '',
    `Auto-generated draft for the week ending **${date}**.`,
    '',
    '**To publish:**',
    '1. Review and edit the draft in `dev/src/content/blog/' + filename + '`',
    '2. Change `draft: true` → `draft: false`',
    '3. Fill in the Metrics snapshot table with real Supabase data',
    '4. Merge this PR — Vercel will rebuild the Agentic Experiments site',
    '',
    `**Source data:**`,
    `- ${prs.length} PRs merged (${new Date(weekAgo).toISOString().split('T')[0]} – ${date})`,
    `- Notion Learning Summary: ${learningSummary ? '✓' : '—'}`,
    `- Notion Release Notes: ${releaseNotes ? '✓' : '—'}`,
    '',
    '🤖 Generated with [Claude Code](https://claude.ai/claude-code)',
  ].join('\n');

  exec(`gh pr create --title "feat(blog): weekly draft ${date}" --body "${prBody.replace(/"/g, '\\"')}" --draft --label "tech"`, {
    env: { ...process.env, GH_TOKEN: GITHUB_TOKEN },
  });

  console.log('Done. PR opened.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
