#!/usr/bin/env node
// The review ledger (#1779, epic #1778): every past review of a PR, what it cost, and what became
// of what it found, so each reviewer can be judged on hit rate and price before anyone changes
// the review setup.
//
// Reviews it reads (all posted as REVIEW_BOT):
//   - the review agent: an APPROVED or CHANGES_REQUESTED review (.agents/review.md);
//   - the second opinion: a COMMENT review, `## Second opinion (model)` + `<!-- second-opinion verdict=… -->`;
//   - a focused lens: `## Focused review — lens (model)` + `<!-- focused lens=… findings=N -->`;
//   - each paid review's footer, `Tokens: … · cost $X` (review-cost.mjs usageLine);
//   - the risk-score comment (the tier) and "A model review (…: failure …) failed" comments.
//
// A finding is a focused review's bullet, or a whole request-changes review. Its label:
//   acted-on   a later non-merge commit on the PR touches a file the finding names;
//   dismissed  the PR merged with no non-merge commit after the review at all;
//   unclear    anything else (later work elsewhere, no file named, or not merged).
// Merge commits don't count: merging main touches whatever main changed, not what the review said.
// The owner corrects any label in the overrides file (default .github/review-ledger-overrides.json):
//   { "overrides": { "<pr>:<reviewId>:<n>": "dismissed", "<pr>:<reviewId>": { "label": "unclear", "note": "why" } } }
// `<pr>:<reviewId>` covers every finding of that review; `:<n>` (1-based) one finding. The ids are
// in the JSON output's findings.
//
// Usage:
//   npm run review:ledger -- --since 2026-09-15 [--include-open] [--out <prefix>] [--json] [--save-fixtures <dir>]
//   npm run review:ledger -- --fixtures <dir> [--since …] [--out <prefix>] [--json]
//   npm run review:ledger -- --dry-run          (the fixtures in src/review-ledger.fixtures)
//   --out p   writes p.md and p.json; otherwise Markdown (or JSON with --json) goes to stdout.
//   --overrides <file>  another overrides file.
// Env (API mode): GITHUB_TOKEN or GH_TOKEN; GITHUB_REPOSITORY (default FilipMarzuki/matlu).
//
// Plain Node and fetch, like the other review scripts: no dependencies.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REVIEW_BOT } from './risk-score.mjs';
import { parseReview } from './review-cost.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
export const DEFAULT_FIXTURES = path.join(ROOT, 'src', 'review-ledger.fixtures');
export const DEFAULT_OVERRIDES = path.join(ROOT, '.github', 'review-ledger-overrides.json');
export const LABELS = ['acted-on', 'dismissed', 'unclear'];

// ── Parsing (pure) ──────────────────────────────────────────────────────────

/** The cost from a review footer (`Tokens: … · cost $0.1378`), or null when none was reported. */
export function parseCost(body = '') {
  const m = /Tokens:[^\n]*·\s*cost \$(\d+(?:\.\d+)?)/.exec(body);
  return m ? Number(m[1]) : null;
}

/** The risk-score comment's tier and score (risk-score.mjs --apply), or null for any other comment. */
export function parseRiskComment(body = '') {
  if (!body.startsWith('<!-- risk-score -->')) return null;
  const m = /\*\*Review risk: (low|medium|high)\*\* \(score (-?\d+)\)/.exec(body);
  return m ? { tier: m[1], score: Number(m[2]) } : null;
}

/**
 * Which paid reviews a "A model review (second opinion: failure, focused: skipped) failed" comment
 * (review-risk.yml) reports as failed: 'second-opinion' and/or 'focused'. The focused job is a
 * matrix, so the comment doesn't say which lens; null for any other comment.
 */
export function parseFailureComment(body = '') {
  const m = /^A model review \(second opinion: (\w+), focused: (\w+)\) failed/.exec(body);
  if (!m) return null;
  return [...(m[1] === 'failure' ? ['second-opinion'] : []), ...(m[2] === 'failure' ? ['focused'] : [])];
}

const EXT = 'ts|tsx|mts|cts|js|mjs|cjs|jsx|json|md|yml|yaml|css|scss|html|astro|sh|py|sql|toml|txt';
// A path: optional folders, then a name with a known extension. `(?![\w/])` stops a match from
// ending inside a longer word; the lookbehind stops it from starting mid-word.
const FILE_RE = new RegExp(`(?<![\\w/.-])((?:\\.?[\\w-]+/)*[\\w.-]*[\\w-]\\.(?:${EXT}))(?![\\w/])`, 'g');

/** The file paths a piece of review text names, in order, without line numbers or duplicates. */
export function namedFiles(text = '') {
  const out = [];
  for (const m of text.matchAll(FILE_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/**
 * A focused review's findings: the top-level `- ` bullets after `FINDINGS: N`, each with its
 * indented continuation lines (the "Fails when:" line). The marker's count is what the gate read,
 * so it decides how many there are: missing bullets become findings with no text.
 */
function lensFindings(body, count) {
  const after = body.split(/^FINDINGS:\s*\d+\s*$/m)[1] ?? '';
  const bullets = [];
  for (const line of after.split('\n')) {
    if (/^- /.test(line)) bullets.push(line.slice(2));
    else if (bullets.length && /^\s+\S/.test(line)) bullets[bullets.length - 1] += `\n${line.trim()}`;
    else if (bullets.length && line.trim() === '') continue;
    else if (bullets.length) break;
  }
  return Array.from({ length: count }, (_, i) => {
    const text = bullets[i] ?? '';
    return { text, files: namedFiles(text) };
  });
}

/**
 * One review from the GitHub API as a ledger entry (pure), or null if it isn't one of ours.
 * kind: 'review-agent' | 'second-opinion' | 'lens'; reviewer: the row it counts under
 * ('review-agent', 'second-opinion', 'lens:<name>'); findings: what it blocked on.
 */
export function parseReviewEntry(r) {
  if (!r || r.user?.login !== REVIEW_BOT) return null;
  const body = r.body ?? '';
  const base = { id: r.id, commitId: r.commit_id ?? null, at: r.submitted_at ?? null, url: r.html_url ?? null };
  if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED') {
    const blocks = r.state === 'CHANGES_REQUESTED';
    return {
      ...base, kind: 'review-agent', reviewer: 'review-agent', lens: null, model: 'claude (review agent)',
      verdict: blocks ? 'request-changes' : 'approve', findingsCount: blocks ? 1 : 0,
      findings: blocks ? [{ text: body, files: namedFiles(body) }] : [],
      cost: parseCost(body), weak: false, carried: false,
    };
  }
  // Only lines 1 and 2 decide what a body is, as at the merge gate.
  const p = parseReview(body);
  if (!p) return null;
  const carried = !!p.from;
  if (p.focus) {
    const n = carried ? 0 : (p.findings ?? 0);
    return {
      ...base, kind: 'lens', reviewer: `lens:${p.focus}`, lens: p.focus, model: p.usedModel,
      verdict: p.verdict, findingsCount: p.findings, findings: lensFindings(body, n),
      cost: carried ? 0 : parseCost(body), weak: !!p.weak, carried,
    };
  }
  const blocks = p.verdict === 'request-changes' && !carried;
  return {
    ...base, kind: 'second-opinion', reviewer: 'second-opinion', lens: null, model: p.usedModel,
    verdict: p.verdict, findingsCount: p.verdict === 'unclear' ? null : blocks ? 1 : 0,
    findings: blocks ? [{ text: body, files: namedFiles(body.split('\n').slice(2).join('\n')) }] : [],
    cost: carried ? 0 : parseCost(body), weak: !!p.weak, carried,
  };
}

// ── Judging (pure) ──────────────────────────────────────────────────────────

/** Does a touched path match a named one? A bare `region1.ts` matches `src/artificer/region1.ts`. */
const sameFile = (touched, named) => {
  const n = named.replace(/^\.\//, '');
  return touched === n || touched.endsWith(`/${n}`);
};

/** The PR's non-merge commits after the reviewed one: by position, or by date if it was rebased away. */
function commitsAfter(fixture, commitId, at) {
  const commits = fixture.commits ?? [];
  const i = commitId ? commits.findIndex(c => c.sha === commitId) : -1;
  const later = i >= 0 ? commits.slice(i + 1) : commits.filter(c => at && Date.parse(c.date) > Date.parse(at));
  return later.filter(c => (c.parents ?? 1) <= 1);
}

/** acted-on / dismissed / unclear for one finding (pure; see the top of the file), with why. */
export function judgeFinding({ files = [], commitId = null, at = null }, fixture) {
  const later = commitsAfter(fixture, commitId, at);
  for (const c of later) {
    const hit = (c.files ?? []).find(t => files.some(f => sameFile(t, f)));
    if (hit) return { label: 'acted-on', commit: c.sha, reason: `${c.sha.slice(0, 7)} touches ${hit}` };
  }
  const merged = !!fixture.pr?.merged_at;
  if (merged && !later.length) return { label: 'dismissed', commit: null, reason: 'merged with no change after the review' };
  if (!merged) return { label: 'unclear', commit: null, reason: fixture.pr?.state === 'open' ? 'the PR is still open' : 'closed without merging' };
  if (!files.length) return { label: 'unclear', commit: null, reason: 'names no file; later commits exist' };
  return { label: 'unclear', commit: null, reason: `later commits touch none of ${files.join(', ')}` };
}

/** An override as { label, note }; a bad label throws, so a typo can't be counted silently. */
function readOverride(v, id) {
  const o = typeof v === 'string' ? { label: v } : v ?? {};
  if (!LABELS.includes(o.label)) throw new Error(`Override ${id}: label must be acted-on, dismissed or unclear (got ${JSON.stringify(o.label)})`);
  return { label: o.label, note: o.note ?? null };
}

/** The tier: the risk-score comment's, else the PR's risk:* label, else 'unknown'. */
function tierOf(fixture) {
  const fromComment = [...(fixture.comments ?? [])].reverse().map(c => parseRiskComment(c.body)).find(Boolean);
  if (fromComment) return fromComment.tier;
  const label = (fixture.pr?.labels ?? []).map(l => (typeof l === 'string' ? l : l.name)).find(n => /^risk:(low|medium|high)$/.test(n ?? ''));
  return label ? label.slice(5) : 'unknown';
}

/**
 * One PR's ledger (pure): its tier, its reviews, the failed runs, every finding with its label,
 * and the re-review rounds findings caused (reviewed commits that had a block and a later commit).
 */
export function ledgerForPr(fixture, overrides = {}) {
  const reviews = (fixture.reviews ?? []).map(parseReviewEntry).filter(Boolean)
    .sort((a, b) => Date.parse(a.at ?? 0) - Date.parse(b.at ?? 0));
  const failures = (fixture.comments ?? []).flatMap(c => parseFailureComment(c.body) ?? []);
  const findings = [];
  const blockedCommits = new Set();
  for (const r of reviews) {
    r.findings.forEach((f, i) => {
      const id = `${fixture.pr.number}:${r.id}:${i + 1}`;
      const judged = judgeFinding({ files: f.files, commitId: r.commitId, at: r.at }, fixture);
      const ov = overrides[id] ?? overrides[`${fixture.pr.number}:${r.id}`];
      const o = ov === undefined ? null : readOverride(ov, id);
      findings.push({
        id, reviewer: r.reviewer, model: r.model, files: f.files, text: f.text.slice(0, 300),
        label: o ? o.label : judged.label, auto: judged.label, reason: judged.reason, commit: judged.commit,
        overridden: !!o, note: o?.note ?? null, url: r.url,
      });
    });
    if (r.findings.length && r.commitId && commitsAfter(fixture, r.commitId, r.at).length) blockedCommits.add(r.commitId);
  }
  const costs = reviews.map(r => r.cost).filter(c => typeof c === 'number');
  return {
    number: fixture.pr.number, title: fixture.pr.title ?? '', url: fixture.pr.html_url ?? null,
    state: fixture.pr.merged_at ? 'merged' : fixture.pr.state ?? 'unknown',
    closedAt: fixture.pr.closed_at ?? null, createdAt: fixture.pr.created_at ?? null,
    tier: tierOf(fixture), reviews, failures, findings, rounds: blockedCommits.size,
    cost: costs.length ? round4(costs.reduce((a, b) => a + b, 0)) : null,
  };
}

// ── Aggregating (pure) ──────────────────────────────────────────────────────

const round4 = (x) => Math.round(x * 1e4) / 1e4;

function emptyRow(reviewer, tier) {
  return { reviewer, ...(tier ? { tier } : {}), models: [], runs: 0, carried: 0, weak: 0, failures: 0, passes: 0, unclearVerdicts: 0, blocks: 0, actedOn: 0, dismissed: 0, unclear: 0, cost: null, hitRate: null, costPerActedOn: null };
}

/** A failure counts under the reviewer it names: the second opinion, or the lenses as one row (the comment doesn't say which). */
const failureReviewer = (kind) => (kind === 'second-opinion' ? 'second-opinion' : 'lens:(any)');

function add(rows, key, reviewer, tier) {
  if (!rows.has(key)) rows.set(key, emptyRow(reviewer, tier));
  return rows.get(key);
}

/** Rows in a fixed order: the review agent, the second opinion, then the lenses by name. */
const order = (r) => (r.reviewer === 'review-agent' ? 0 : r.reviewer === 'second-opinion' ? 1 : 2);

function finish(row) {
  row.cost = row.cost === null ? null : round4(row.cost);
  row.hitRate = row.blocks ? row.actedOn / row.blocks : null;
  row.costPerActedOn = row.actedOn && row.cost !== null ? round4(row.cost / row.actedOn) : null;
  return row;
}

/**
 * The report (pure): per reviewer, per reviewer and tier, and per PR. A run is a review that was
 * paid for or made (carried-over verdicts are counted apart, with no cost); passes are approves
 * or 0-finding results; blocks are findings plus request-changes; hitRate is the share of blocks
 * acted on; costPerActedOn is the reviewer's whole cost over the blocks it got acted on.
 */
export function aggregate(prs) {
  const all = new Map();
  const tiers = new Map();
  for (const pr of prs) {
    const rowsFor = (reviewer) => [add(all, reviewer, reviewer), add(tiers, `${reviewer}|${pr.tier}`, reviewer, pr.tier)];
    for (const r of pr.reviews) {
      for (const row of rowsFor(r.reviewer)) {
        if (!row.models.includes(r.model)) row.models.push(r.model);
        if (r.carried) { row.carried += 1; continue; }
        row.runs += 1;
        if (r.weak) row.weak += 1;
        if (r.findingsCount === null) row.unclearVerdicts += 1;
        else if (r.findingsCount === 0) row.passes += 1;
        if (typeof r.cost === 'number') row.cost = (row.cost ?? 0) + r.cost;
      }
    }
    for (const f of pr.findings) {
      for (const row of rowsFor(f.reviewer)) {
        row.blocks += 1;
        if (f.label === 'acted-on') row.actedOn += 1;
        else if (f.label === 'dismissed') row.dismissed += 1;
        else row.unclear += 1;
      }
    }
    for (const kind of pr.failures) for (const row of rowsFor(failureReviewer(kind))) row.failures += 1;
  }
  const tierRank = { low: 0, medium: 1, high: 2, unknown: 3 };
  const sortRows = (rows) => [...rows].sort((a, b) => order(a) - order(b) || a.reviewer.localeCompare(b.reviewer) || (tierRank[a.tier] ?? 9) - (tierRank[b.tier] ?? 9));
  return {
    generatedFrom: prs.length,
    reviewers: sortRows([...all.values()].map(finish)),
    byTier: sortRows([...tiers.values()].map(finish)),
    prs: [...prs].sort((a, b) => a.number - b.number).map(p => ({
      number: p.number, title: p.title, url: p.url, state: p.state, tier: p.tier,
      reviews: p.reviews.map(r => ({ id: r.id, reviewer: r.reviewer, model: r.model, verdict: r.verdict, commit: r.commitId, cost: r.cost, weak: r.weak, carried: r.carried, url: r.url })),
      failures: p.failures, findings: p.findings, rounds: p.rounds, cost: p.cost,
    })),
  };
}

// ── Rendering (pure) ────────────────────────────────────────────────────────

const money = (x) => (x === null || x === undefined ? '—' : `$${x.toFixed(4)}`);
const pct = (row) => (row.hitRate === null ? '—' : `${row.actedOn}/${row.blocks} (${Math.round(row.hitRate * 100)}%)`);
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The report as Markdown: per reviewer, per reviewer × tier, per PR, then every finding. */
export function renderMarkdown(report, { since = null } = {}) {
  const head = '| Reviewer | Models | Runs | Failures | Passes | Blocks | Acted on | Dismissed | Unclear | Total cost | Cost per acted-on |';
  const sep = '|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|';
  const row = (r, tier) => `| ${r.reviewer} |${tier ? ` ${r.tier} |` : ''} ${cell(r.models.join(', ') || '—')} | ${r.runs}${r.carried ? ` (+${r.carried} carried)` : ''}${r.weak ? ` (${r.weak} weak)` : ''} | ${r.failures} | ${r.passes}${r.unclearVerdicts ? ` (+${r.unclearVerdicts} unclear)` : ''} | ${r.blocks} | ${pct(r)} | ${r.dismissed} | ${r.unclear} | ${money(r.cost)} | ${r.cost && !r.actedOn ? 'no hits' : money(r.costPerActedOn)} |`;
  const reviewsOf = (p) => {
    const by = new Map();
    for (const r of p.reviews) {
      const k = r.reviewer;
      const e = by.get(k) ?? { n: 0, blocks: 0 };
      e.n += 1;
      if (r.verdict === 'request-changes' || /^[1-9]\d* finding/.test(r.verdict)) e.blocks += 1;
      by.set(k, e);
    }
    const parts = [...by].sort(([a], [b]) => order({ reviewer: a }) - order({ reviewer: b }) || a.localeCompare(b)).map(([k, e]) => `${k} ×${e.n}${e.blocks ? ` (${e.blocks} blocking)` : ''}`);
    return parts.join(', ') || '—';
  };
  const lines = [
    '# Review ledger',
    '',
    `${report.prs.length} PR(s)${since ? ` closed since ${since}` : ''}. Generated by \`.github/scripts/review-ledger.mjs\` (#1779). A *block* is a focused review's finding or a request-changes; *acted on* means a later non-merge commit touched a file it names, *dismissed* that the PR merged with no change after it. Owner corrections: \`.github/review-ledger-overrides.json\`.`,
    '',
    '## Per reviewer',
    '',
    head, sep,
    ...report.reviewers.map(r => row(r)),
    '',
    '## Per reviewer and tier',
    '',
    head.replace('| Reviewer |', '| Reviewer | Tier |'), sep.replace('|---|', '|---|---|'),
    ...report.byTier.map(r => row(r, true)),
    '',
    '## Per PR',
    '',
    '| PR | Tier | State | Reviews | Failed runs | Blocks (acted on) | Re-review rounds | Cost |',
    '|---|---|---|---|--:|--:|--:|--:|',
    ...report.prs.map(p => `| #${p.number} | ${p.tier} | ${p.state} | ${cell(reviewsOf(p))} | ${p.failures.length} | ${p.findings.length} (${p.findings.filter(f => f.label === 'acted-on').length}) | ${p.rounds} | ${money(p.cost)} |`),
  ];
  const findings = report.prs.flatMap(p => p.findings.map(f => ({ ...f, pr: p.number })));
  if (findings.length) {
    lines.push('', '## Findings', '', '| Id | PR | Reviewer | Files | Label | Why |', '|---|---|---|---|---|---|');
    for (const f of findings) lines.push(`| \`${f.id}\` | #${f.pr} | ${f.reviewer} | ${cell(f.files.join(', ') || '—')} | ${f.label}${f.overridden ? ' (override)' : ''} | ${cell(f.overridden && f.note ? f.note : f.reason)} |`);
  }
  return `${lines.join('\n')}\n`;
}

// ── Input ───────────────────────────────────────────────────────────────────

/**
 * The fixture shape (one PR per file) from raw GitHub REST answers, trimmed to what the ledger
 * reads. `commitFiles` maps a sha to its changed paths (null for a merge commit: not fetched).
 */
export function fixtureFromApi({ pr, comments, reviews, commits, commitFiles = {} }) {
  return {
    pr: {
      number: pr.number, title: pr.title, html_url: pr.html_url, state: pr.state,
      merged_at: pr.merged_at ?? null, closed_at: pr.closed_at ?? null, created_at: pr.created_at ?? null,
      labels: (pr.labels ?? []).map(l => ({ name: l.name })),
    },
    comments: comments.map(c => ({ id: c.id, user: { login: c.user?.login }, created_at: c.created_at, html_url: c.html_url, body: c.body ?? '' })),
    reviews: reviews.map(r => ({ id: r.id, user: { login: r.user?.login }, state: r.state, commit_id: r.commit_id, submitted_at: r.submitted_at, html_url: r.html_url, body: r.body ?? '' })),
    commits: commits.map(c => ({
      sha: c.sha, date: c.commit?.committer?.date ?? c.commit?.author?.date ?? null,
      message: (c.commit?.message ?? '').split('\n')[0], parents: (c.parents ?? []).length || 1,
      files: commitFiles[c.sha] ?? null,
    })),
  };
}

/** Every `*.json` fixture in a directory, by PR number. */
export function loadFixtures(dir) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .sort((a, b) => a.pr.number - b.pr.number);
}

/** When a PR counts for --since: when it closed, or when it opened if it's still open. */
const whenOf = (fx) => fx.pr.closed_at ?? fx.pr.created_at;

/**
 * API mode: the PRs closed since `since` (and, with includeOpen, those opened since), each as a
 * fixture. `fetch` is injectable so the tests can stand in for GitHub.
 */
export async function fetchFromApi({ repo, token, since, includeOpen = false, log = () => {}, fetch: f = fetch }) {
  const gh = async (p) => {
    const res = await f(`https://api.github.com/repos/${repo}${p}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!res.ok) throw new Error(`GitHub GET ${p} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  };
  const all = async (p) => {
    const out = [];
    for (let page = 1; page <= 30; page++) {
      const batch = await gh(`${p}${p.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  };
  const sinceMs = Date.parse(since);
  const prs = [];
  for (const state of includeOpen ? ['closed', 'open'] : ['closed']) {
    // Newest-updated first: once a whole page was last updated before `since`, nothing older can have closed after it.
    for (let page = 1; page <= 30; page++) {
      const batch = await gh(`/pulls?state=${state}&sort=updated&direction=desc&per_page=100&page=${page}`);
      prs.push(...batch.filter(p => Date.parse(state === 'open' ? p.created_at : p.closed_at) >= sinceMs));
      if (batch.length < 100 || Date.parse(batch[batch.length - 1].updated_at) < sinceMs) break;
    }
  }
  const out = [];
  for (const pr of prs) {
    log(`#${pr.number} ${pr.title}`);
    const [comments, reviews, commits] = await Promise.all([all(`/issues/${pr.number}/comments`), all(`/pulls/${pr.number}/reviews`), all(`/pulls/${pr.number}/commits`)]);
    const commitFiles = {};
    // Merge commits are never counted (see judgeFinding), so their files aren't fetched.
    for (const c of commits) if ((c.parents ?? []).length <= 1) commitFiles[c.sha] = ((await gh(`/commits/${c.sha}`)).files ?? []).map(f => f.filename);
    out.push(fixtureFromApi({ pr, comments, reviews, commits, commitFiles }));
  }
  return out.sort((a, b) => a.pr.number - b.pr.number);
}

// ── CLI ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true') : undefined; };
  const since = flag('since');
  if (since && Number.isNaN(Date.parse(since))) { console.error(`Bad --since: ${since}`); process.exit(2); }
  const dryRun = flag('dry-run') === 'true';
  const fixturesDir = flag('fixtures') ?? (dryRun ? DEFAULT_FIXTURES : undefined);
  const log = (s) => console.error(s);

  const overridesPath = flag('overrides') ?? DEFAULT_OVERRIDES;
  const overrides = fs.existsSync(overridesPath) ? JSON.parse(fs.readFileSync(overridesPath, 'utf8')).overrides ?? {} : {};

  let fixtures;
  if (fixturesDir) {
    fixtures = loadFixtures(fixturesDir);
    if (since) fixtures = fixtures.filter(fx => Date.parse(whenOf(fx)) >= Date.parse(since));
  } else {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!since || !token) {
      console.error('Usage: review-ledger.mjs --since <date> (needs GITHUB_TOKEN) | --fixtures <dir> | --dry-run  [--include-open] [--out <prefix>] [--json] [--save-fixtures <dir>] [--overrides <file>]');
      process.exit(2);
    }
    fixtures = await fetchFromApi({ repo: process.env.GITHUB_REPOSITORY || 'FilipMarzuki/matlu', token, since, includeOpen: flag('include-open') === 'true', log });
    const save = flag('save-fixtures');
    if (save) {
      fs.mkdirSync(save, { recursive: true });
      for (const fx of fixtures) fs.writeFileSync(path.join(save, `pr-${fx.pr.number}.json`), `${JSON.stringify(fx, null, 2)}\n`);
      log(`Saved ${fixtures.length} fixture(s) to ${save}`);
    }
  }

  const report = aggregate(fixtures.map(fx => ledgerForPr(fx, overrides)));
  const md = renderMarkdown(report, { since });
  const out = flag('out');
  if (out) {
    fs.writeFileSync(`${out}.md`, md);
    fs.writeFileSync(`${out}.json`, `${JSON.stringify(report, null, 2)}\n`);
    log(`Wrote ${out}.md and ${out}.json`);
  } else process.stdout.write(flag('json') === 'true' ? `${JSON.stringify(report, null, 2)}\n` : md);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(e => { console.error(e.message ?? e); process.exit(1); });
