#!/usr/bin/env node
// Risk score for a PR (#1431): which tier of review it gets.
//
// The score comes from a script, not a model: weights in .github/review-risk.json
// for the paths a PR touches, its size, and whether code changed without tests.
// The tier decides which review models must agree before a merge (#1481) — low:
// the review agent; medium: + the OpenRouter second opinion approves; high: + every
// focused lens pass (a stronger model) finds nothing. People decide game design;
// implementation merges on the models' reviews, never on a person's label.
//
// Usage:
//   node .github/scripts/risk-score.mjs --pr 123 [--apply] [--gate]
//     --apply   label the PR risk:<tier> and post/update a comment with the reasons
//     --gate    may this PR be merged now? Exits 0 if yes, 3 if it must wait: CI must
//               have passed on the head commit, and the tier's model reviews must
//               have reported on it with nothing blocking (see mergeGate).
//               Every merge path (DevCycle 4, DevCycle 5 — Grooming) runs this.
//   node .github/scripts/risk-score.mjs --local [base]
//     score this branch's commits since it left `base` (default origin/main), the same
//     files the PR will show — no GitHub token. Prints `risk:<tier>`. Run it before opening a PR: a
//     medium or high tier means the PR body needs a Design decisions section (#1433).
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY.
// Writes tier, lenses, same_repo, draft, head_sha, ci_ok (and merge with --gate) to $GITHUB_OUTPUT.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RULES_PATH = path.resolve(__dirname, '..', 'review-risk.json');
export const TIERS = ['low', 'medium', 'high'];
const MARKER = '<!-- risk-score -->';
export const CI_WORKFLOW = 'DevCycle 2 — CI';

/** A path glob as a regex: `**` crosses folders (and `**​/` may match nothing), `*` stays within one. */
export function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
const matchesAny = (file, globs = []) => globs.some(g => globToRegex(g).test(file));

/**
 * Score a PR's changed files (pure). `files`: [{ filename, additions, deletions }].
 * Returns the score, the tier, the reasons, and the lenses a high tier runs.
 */
export function scoreRisk(files, config) {
  // A rename counts for both paths: moving rng.ts out of its folder still touches the RNG.
  const names = [...new Set(files.flatMap(f => (f.previous_filename ? [f.filename, f.previous_filename] : [f.filename])))];
  const reasons = [];
  const lenses = new Set();
  let score = 0;
  let ruleHit = false;

  for (const rule of config.rules) {
    const hit = names.filter(n => matchesAny(n, rule.paths) && !matchesAny(n, rule.exclude));
    if (!hit.length) continue;
    score += rule.weight;
    ruleHit = true;
    if (rule.lens) lenses.add(rule.lens);
    reasons.push(`${rule.label} (+${rule.weight}): ${hit.slice(0, 3).join(', ')}${hit.length > 3 ? `, +${hit.length - 3} more` : ''}`);
  }

  const lines = files.reduce((n, f) => n + (f.additions ?? 0) + (f.deletions ?? 0), 0);
  const size = [...config.size].sort((a, b) => b.lines - a.lines).find(s => lines >= s.lines);
  if (size) { score += size.weight; reasons.push(`${lines} lines changed (+${size.weight})`); }

  const u = config.untested;
  const code = names.some(n => matchesAny(n, u.codePaths) && !matchesAny(n, u.testPaths));
  if (code && !names.some(n => matchesAny(n, u.testPaths))) { score += u.weight; ruleHit = true; reasons.push(`${u.label} (+${u.weight})`); }

  // Nothing but docs, styles or assets, and no rule touched: low, whatever the size.
  const lowOnly = names.length > 0 && names.every(n => matchesAny(n, config.lowRisk.paths));
  if (lowOnly && !ruleHit) {
    return { score: 0, tier: 'low', reasons: [config.lowRisk.label], lenses: [] };
  }

  const tier = score >= config.tiers.high ? 'high' : score >= config.tiers.medium ? 'medium' : 'low';
  if (tier === 'high' && !lenses.size && config.defaultLens) lenses.add(config.defaultLens);
  return { score, tier, reasons: reasons.length ? reasons : ['no risk rules matched'], lenses: tier === 'high' ? [...lenses] : [] };
}

/**
 * Parse `git diff -z --numstat -M` output into changed files (pure). Each record is
 * `added<TAB>deleted<TAB>path<NUL>`; a rename leaves the path empty and is followed by
 * `old<NUL>new<NUL>`. Binary files show `-` for the counts.
 */
export function parseNumstatZ(text) {
  const parts = text.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(parts[i]);
    if (!m) continue;
    const count = (v) => (v === '-' ? 0 : Number(v));
    if (m[3] === '') {
      if (!parts[i + 1] || !parts[i + 2]) break; // truncated rename record: stop rather than invent a path
      files.push({ filename: parts[i + 2], previous_filename: parts[i + 1], additions: count(m[1]), deletions: count(m[2]) });
      i += 2;
    }
    else files.push({ filename: m[3], additions: count(m[1]), deletions: count(m[2]) });
  }
  return files;
}

export const loadRules = () => JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));

/**
 * The reviews on the head commit (pure, #1481). Only bot reviews pinned to `headSha` count — a
 * review of an older commit says nothing about this one.
 * - `agent`: the review agent's latest verdict (its APPROVED / CHANGES_REQUESTED review state).
 * - `second`: the second opinion — the worst verdict on this commit. A request-changes holds until
 *   a new commit, so re-running the reviewer can't wash it out; a re-run can replace an `unclear`
 *   or a failed run with a real verdict.
 * - `focused[lens]`: the most findings any focused review of that lens reported on this commit;
 *   null when none of them gave a count.
 * Verdicts are read only from the marker on line 2 of a body that starts with the
 * run-second-review.js header, so a review quoting a marker can't stand in for one.
 */
export function tierReviews(reviews, headSha) {
  const out = { agent: null, second: null, focused: {} };
  const rank = { 'request-changes': 3, approve: 2, unclear: 1 };
  const inOrder = [...reviews].sort((a, b) => Date.parse(a.submitted_at ?? 0) - Date.parse(b.submitted_at ?? 0));
  for (const r of inOrder) {
    if (r.commit_id !== headSha || r.user?.type !== 'Bot') continue;
    if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED') { out.agent = r.state === 'APPROVED' ? 'approved' : 'changes-requested'; continue; }
    const body = r.body ?? '';
    const so = /^## Second opinion[^\n]*\n<!-- second-opinion verdict=(approve|request-changes|unclear) -->/.exec(body);
    if (so) { if (!out.second || rank[so[1]] > rank[out.second]) out.second = so[1]; continue; }
    const fo = /^## Focused review — ([a-z][a-z0-9-]*)[^\n]*\n<!-- focused lens=\1 findings=(\d+|\?) -->/.exec(body);
    if (!fo) continue;
    const n = fo[2] === '?' ? null : Number(fo[2]);
    const had = out.focused[fo[1]];
    out.focused[fo[1]] = had === undefined ? n : n === null ? had : had === null ? n : Math.max(had, n);
  }
  return out;
}

/**
 * May a PR be merged now (pure, #1481)? The tier decides which models must agree on the head commit:
 * - low: CI passed, and the review agent approves;
 * - medium: + the second opinion approves;
 * - high: + every lens the tier runs has a focused review with 0 findings.
 * A request-changes, an unclear verdict, a finding or a missing review holds it; a new commit
 * re-runs the reviews. No person's label is involved. Returns { merge, reason }.
 */
export function mergeGate({ tier, ciOk, open = true, sameRepo = true, lenses = [], reviews = { agent: null, second: null, focused: {} } }) {
  if (!open) return { merge: false, reason: 'the PR is not open' };
  if (!ciOk) return { merge: false, reason: `${CI_WORKFLOW} has not passed on the head commit` };
  if (reviews.agent !== 'approved') return { merge: false, reason: reviews.agent ? 'the review agent requests changes on the head commit' : 'waiting for the review agent to approve the head commit' };
  if (tier === 'low') return { merge: true, reason: 'risk:low, the review agent approves' };
  if (!sameRepo) return { merge: false, reason: `risk:${tier} — the model reviews don't run for PRs from forks; a person merges it` };
  if (!reviews.second) return { merge: false, reason: `risk:${tier} — waiting for the second opinion on the head commit` };
  if (reviews.second !== 'approve') return { merge: false, reason: `risk:${tier} — the second opinion says ${reviews.second}` };
  if (tier === 'medium') return { merge: true, reason: 'risk:medium, the review agent and the second opinion approve' };
  for (const lens of lenses) {
    const n = reviews.focused[lens];
    if (n === undefined) return { merge: false, reason: `risk:high — waiting for the focused review (${lens}) on the head commit` };
    if (n === null) return { merge: false, reason: `risk:high — the focused review (${lens}) gave no finding count; re-run it` };
    if (n > 0) return { merge: false, reason: `risk:high — the focused review (${lens}) has ${n} finding(s)` };
  }
  return { merge: true, reason: `risk:high, the review agent and the second opinion approve and ${lenses.length ? `the focused reviews (${lenses.join(', ')}) find nothing` : 'no lens applies'}` };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true') : undefined; };
  const prNumber = Number(flag('pr'));
  const apply = flag('apply') === 'true';
  const gate = flag('gate') === 'true';

  // Local mode: no GitHub, just this checkout against the base branch.
  const local = flag('local');
  if (local) {
    const base = local === 'true' ? 'origin/main' : local;
    if (base.startsWith('-')) { console.error(`Bad base: ${base}`); process.exit(2); }
    let out;
    try {
      // `base...HEAD` (three dots): the commits on this branch since it left `base` —
      // exactly what the PR will show. Later commits on main don't count, and neither
      // do uncommitted or untracked files, so commit first.
      out = execFileSync('git', ['diff', '-z', '--numstat', '-M', `${base}...HEAD`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch {
      console.error(`Could not diff ${base}...HEAD (see git's error above). If ${base} is missing, \`git fetch origin main\`; in a shallow clone with no merge base, \`git fetch --unshallow origin\`.`);
      process.exit(2);
    }
    const result = scoreRisk(parseNumstatZ(out), loadRules());
    console.log(`risk:${result.tier} (score ${result.score}) — commits since ${base}`);
    for (const r of result.reasons) console.log(`  - ${r}`);
    if (result.lenses.length) console.log(`  lenses: ${result.lenses.join(', ')}`);
    if (result.tier !== 'low') console.log('  → the PR body needs a "## Design decisions" section (see CLAUDE.md).');
    return;
  }

  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!prNumber || !repo || !token) { console.error('Usage: risk-score.mjs --pr <n> [--apply] [--gate]  (needs GITHUB_TOKEN, GITHUB_REPOSITORY) | --local [base]'); process.exit(2); }

  const gh = async (p, { method = 'GET', body } = {}) => {
    const res = await fetch(`https://api.github.com/repos/${repo}${p}`, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (!res.ok && res.status !== 404) throw new Error(`GitHub ${method} ${p} → ${res.status}: ${await res.text()}`);
    return res.status === 204 || res.status === 404 ? null : res.json();
  };

  const pr = await gh(`/pulls/${prNumber}`);
  const files = [];
  for (let page = 1; page <= 30; page++) {
    const batch = await gh(`/pulls/${prNumber}/files?per_page=100&page=${page}`);
    files.push(...batch);
    if (batch.length < 100) break;
  }
  const result = scoreRisk(files, loadRules());
  const sameRepo = pr.head?.repo?.full_name === repo;
  const headSha = pr.head.sha;

  // CI: the latest run of the CI workflow on this exact commit must have succeeded — the PR's own
  // run where there is one: a branch CI also runs on push (bender/**) has a second run on the
  // same commit, and a newer one still in progress mustn't hide the PR run's pass (#1481).
  const runs = (await gh(`/actions/runs?head_sha=${headSha}&per_page=100`))?.workflow_runs ?? [];
  const ciRuns = runs.filter(r => r.name === CI_WORKFLOW);
  const prRuns = ciRuns.filter(r => r.event === 'pull_request');
  const ci = (prRuns.length ? prRuns : ciRuns).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  const ciOk = ci?.conclusion === 'success';
  console.log(JSON.stringify({ pr: prNumber, ...result, sameRepo, draft: pr.draft, headSha, ciOk }, null, 2));

  let verdict;
  if (gate) {
    // The tier's model reviews (#1481): every review on the PR, filtered to the head commit.
    const reviews = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await gh(`/pulls/${prNumber}/reviews?per_page=100&page=${page}`) ?? [];
      reviews.push(...batch);
      if (batch.length < 100) break;
    }
    verdict = mergeGate({ tier: result.tier, ciOk, open: pr.state === 'open', sameRepo, lenses: result.lenses, reviews: tierReviews(reviews, headSha) });
    console.log(`Merge gate: ${verdict.merge ? 'may merge' : 'hold'} — ${verdict.reason}`);
  }

  if (apply) {
    for (const t of TIERS) if (t !== result.tier && pr.labels.some(l => l.name === `risk:${t}`)) await gh(`/issues/${prNumber}/labels/${encodeURIComponent(`risk:${t}`)}`, { method: 'DELETE' });
    await gh(`/issues/${prNumber}/labels`, { method: 'POST', body: { labels: [`risk:${result.tier}`] } });
    const what = {
      low: 'the review agent',
      medium: 'the review agent + a second opinion from another model family, which must approve',
      high: `the review agent + a second opinion, which must approve + focused passes (${result.lenses.join(', ')}) on a stronger model, which must find nothing`,
    }[result.tier];
    const body = [MARKER, `**Review risk: ${result.tier}** (score ${result.score}) — reviews: ${what}.`, '', ...result.reasons.map(r => `- ${r}`), '', '_Rules: `.github/review-risk.json` (#1431)._'].join('\n');
    const comments = await gh(`/issues/${prNumber}/comments?per_page=100`);
    const mine = comments.find(c => c.body?.startsWith(MARKER));
    if (mine) await gh(`/issues/comments/${mine.id}`, { method: 'PATCH', body: { body } });
    else await gh(`/issues/${prNumber}/comments`, { method: 'POST', body: { body } });
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `tier=${result.tier}\nlenses=${JSON.stringify(result.lenses)}\nsame_repo=${sameRepo}\ndraft=${pr.draft}\nhead_sha=${headSha}\nci_ok=${ciOk}\n${verdict ? `merge=${verdict.merge}\n` : ''}`);
  }
  if (verdict && !verdict.merge) process.exit(3);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(e => { console.error(e); process.exit(1); });
