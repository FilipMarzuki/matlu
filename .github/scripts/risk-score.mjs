#!/usr/bin/env node
// Risk score for a PR (#1431): which tier of review it gets.
//
// The score comes from a script, not a model: weights in .github/review-risk.json
// for the paths a PR touches, its size, and whether code changed without tests.
// The tier decides the review — low: the review agent; medium: + the OpenRouter
// second opinion; high: + focused lens passes on a stronger model, and a human
// approves before DevCycle 4 merges.
//
// Usage:
//   node .github/scripts/risk-score.mjs --pr 123 [--apply]
//     --apply   label the PR risk:<tier> and post/update a comment with the reasons
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY. Writes tier, lenses, same_repo, draft to $GITHUB_OUTPUT.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RULES_PATH = path.resolve(__dirname, '..', 'review-risk.json');
export const TIERS = ['low', 'medium', 'high'];
const MARKER = '<!-- risk-score -->';

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
  const names = files.map(f => f.filename);
  const reasons = [];
  const lenses = new Set();
  let score = 0;

  for (const rule of config.rules) {
    const hit = names.filter(n => matchesAny(n, rule.paths) && !matchesAny(n, rule.exclude));
    if (!hit.length) continue;
    score += rule.weight;
    if (rule.lens) lenses.add(rule.lens);
    reasons.push(`${rule.label} (+${rule.weight}): ${hit.slice(0, 3).join(', ')}${hit.length > 3 ? `, +${hit.length - 3} more` : ''}`);
  }

  const lines = files.reduce((n, f) => n + (f.additions ?? 0) + (f.deletions ?? 0), 0);
  const size = [...config.size].sort((a, b) => b.lines - a.lines).find(s => lines >= s.lines);
  if (size) { score += size.weight; reasons.push(`${lines} lines changed (+${size.weight})`); }

  const u = config.untested;
  const code = names.some(n => matchesAny(n, u.codePaths) && !matchesAny(n, u.testPaths));
  if (code && !names.some(n => matchesAny(n, u.testPaths))) { score += u.weight; reasons.push(`${u.label} (+${u.weight})`); }

  // Nothing but docs, styles or assets, and no rule touched: low, whatever the size.
  const lowOnly = names.length > 0 && names.every(n => matchesAny(n, config.lowRisk.paths));
  if (lowOnly && !reasons.some(r => !/lines changed/.test(r))) {
    return { score: 0, tier: 'low', reasons: [config.lowRisk.label], lenses: [] };
  }

  const tier = score >= config.tiers.high ? 'high' : score >= config.tiers.medium ? 'medium' : 'low';
  if (tier === 'high' && !lenses.size && config.defaultLens) lenses.add(config.defaultLens);
  return { score, tier, reasons: reasons.length ? reasons : ['no risk rules matched'], lenses: tier === 'high' ? [...lenses] : [] };
}

export const loadRules = () => JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));

// ── CLI ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true') : undefined; };
  const prNumber = Number(flag('pr'));
  const apply = flag('apply') === 'true';
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!prNumber || !repo || !token) { console.error('Usage: risk-score.mjs --pr <n> [--apply]  (needs GITHUB_TOKEN, GITHUB_REPOSITORY)'); process.exit(2); }

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
  console.log(JSON.stringify({ pr: prNumber, ...result, sameRepo, draft: pr.draft }, null, 2));

  if (apply) {
    for (const t of TIERS) if (t !== result.tier && pr.labels.some(l => l.name === `risk:${t}`)) await gh(`/issues/${prNumber}/labels/${encodeURIComponent(`risk:${t}`)}`, { method: 'DELETE' });
    await gh(`/issues/${prNumber}/labels`, { method: 'POST', body: { labels: [`risk:${result.tier}`] } });
    const what = { low: 'the review agent', medium: 'the review agent + a second opinion from another model family', high: `the review agent + a second opinion + focused passes (${result.lenses.join(', ')}); merge waits for a \`human-approved\` label` }[result.tier];
    const body = [MARKER, `**Review risk: ${result.tier}** (score ${result.score}) — reviews: ${what}.`, '', ...result.reasons.map(r => `- ${r}`), '', '_Rules: `.github/review-risk.json` (#1431)._'].join('\n');
    const comments = await gh(`/issues/${prNumber}/comments?per_page=100`);
    const mine = comments.find(c => c.body?.startsWith(MARKER));
    if (mine) await gh(`/issues/comments/${mine.id}`, { method: 'PATCH', body: { body } });
    else await gh(`/issues/${prNumber}/comments`, { method: 'POST', body: { body } });
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `tier=${result.tier}\nlenses=${JSON.stringify(result.lenses)}\nsame_repo=${sameRepo}\ndraft=${pr.draft}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(e => { console.error(e); process.exit(1); });
