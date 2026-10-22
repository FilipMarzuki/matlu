#!/usr/bin/env node
// Auto-unblock (#1934): removes the `blocked` label from an open issue once every
// issue its body says it's blocked by has been closed as completed.
//
// The nightly agent (fetch-agent-issues.js) skips anything labelled `blocked`, and
// nothing used to remove the label when the blocker closed, so chains such as the
// hex-world steps (#1895–#1910, #1920) stalled until someone removed it by hand.
//
// What counts as a reference: only a line that states a dependency. The phrasings
// used in the repo's issues look like
//   **Blocked by #1897:** remove `blocked` once it merges.
//   **Blocked by #1900 and #1898:** remove `blocked` once both merge.
//   Blocked by #1902 (and #1900). Remove `blocked` once they merge.
//   - **Depends on:** #1896 (fields), #1897 (rivers). **Blocked by #1897:** …
// plus "Waits on #N" / "Waiting on #N" / "Blocked on #N". After the phrase we read a
// LIST of references (`#N`, optionally with a parenthetical, joined by commas, "and",
// "&" or "+") and stop at the first thing that isn't part of the list, so the stray
// "(#1904 merges well before it)" after a colon, or "#N" mentions elsewhere in the
// body, are never treated as blockers. References inside the parenthetical of a
// listed item ("#1902 (and #1900)") do count. Missing a blocker is the dangerous
// direction (it unblocks too early); counting one too many only keeps the label on.
//
// Decision: unblock only when every referenced issue is closed with state_reason
// "completed" (a merged PR counts as completed). One closed as not planned or as a
// duplicate keeps the label and is reported in the job summary, since a person has
// to decide what happens to the chain. No reference at all → untouched.
//
// Usage:
//   node .github/scripts/unblock-issues.mjs            # GITHUB_TOKEN + GITHUB_REPOSITORY
//   node .github/scripts/unblock-issues.mjs --dry-run  # report only, no label/comment changes

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BLOCKED_LABEL = 'blocked';

// The dependency phrases. `\b` on both sides so "unblocked by" or "blocked byte" don't match.
const PHRASE = /\b(?:blocked\s+(?:by|on)|wait(?:s|ing)\s+(?:on|for)|depends\s+on)\b/gi;
// Markdown noise allowed between the phrase and the first reference: bold/italic markers,
// a colon, whitespace ("**Depends on:** #1896").
const LEAD = /^[\s*_:]*/;
// One list item: a same-repo reference, not part of a word, a path or another repo's
// "owner/repo#N", optionally followed by a parenthetical. Then an optional separator.
const ITEM = /^#(\d+)\b(\s*\([^()\n]*\))?/;
const SEP = /^\s*(?:,\s*(?:and\s+|&\s*)?|and\s+|&\s*|\+\s*)/i;
const REF_IN_PAREN = /(?<![\w/])#(\d+)\b/g;

/**
 * The issue numbers an issue body says it's blocked by, in first-seen order, without
 * duplicates. Fenced code blocks are skipped. Returns [] when there's no reference.
 * @param {string | null | undefined} body
 * @returns {number[]}
 */
export function parseBlockers(body) {
  const found = [];
  const add = n => { if (n > 0 && !found.includes(n)) found.push(n); };
  let inFence = false;
  for (const line of String(body ?? '').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    for (const m of line.matchAll(PHRASE)) {
      let rest = line.slice(m.index + m[0].length).replace(LEAD, '');
      // Read the list: item (sep item)*. Anything else ends it.
      for (;;) {
        const item = ITEM.exec(rest);
        if (!item) break;
        add(Number(item[1]));
        if (item[2]) for (const p of item[2].matchAll(REF_IN_PAREN)) add(Number(p[1]));
        rest = rest.slice(item[0].length);
        const sep = SEP.exec(rest);
        const next = rest.slice(sep ? sep[0].length : 0);
        if (!next.startsWith('#')) break;
        rest = next;
      }
    }
  }
  return found;
}

/**
 * Whether to remove `blocked` from an issue.
 * @param {{ number: number, body?: string | null, labels?: (string | { name: string })[] }} issue
 * @param {Record<number, { state: string, stateReason?: string | null } | null | undefined>} blockerStates
 *   Each blocker's state, keyed by number. `stateReason` is "completed", "not_planned",
 *   "duplicate", … (missing/null on a closed issue is treated as completed, GitHub's
 *   default before state_reason existed). A missing entry means the blocker couldn't
 *   be fetched.
 * @returns {{ unblock: boolean, reason: string, blockers: number[], notPlanned: number[], open: number[], unknown: number[] }}
 */
export function decide(issue, blockerStates) {
  const labels = (issue.labels ?? []).map(l => (typeof l === 'string' ? l : l.name));
  const blockers = parseBlockers(issue.body).filter(n => n !== issue.number);
  const result = { unblock: false, reason: '', blockers, notPlanned: [], open: [], unknown: [] };
  if (!labels.includes(BLOCKED_LABEL)) return { ...result, reason: 'not labelled blocked' };
  if (blockers.length === 0) return { ...result, reason: 'no parseable blocker reference' };
  for (const n of blockers) {
    const s = blockerStates[n];
    if (!s) result.unknown.push(n);
    else if (s.state !== 'closed') result.open.push(n);
    else if ((s.stateReason ?? 'completed') !== 'completed') result.notPlanned.push(n);
  }
  const refs = ns => ns.map(n => `#${n}`).join(', ');
  if (result.notPlanned.length) return { ...result, reason: `closed without completing: ${refs(result.notPlanned)}` };
  if (result.open.length) return { ...result, reason: `still open: ${refs(result.open)}` };
  if (result.unknown.length) return { ...result, reason: `couldn't read: ${refs(result.unknown)}` };
  return { ...result, unblock: true, reason: `all closed: ${refs(blockers)}` };
}

/** The one comment left on an unblocked issue: "Unblocked: #N, #M closed." */
export function unblockComment(blockers) {
  return `Unblocked: ${blockers.map(n => `#${n}`).join(', ')} closed.`;
}

// ── GitHub REST API ───────────────────────────────────────────────────────────

function api(token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  async function call(method, url, body) {
    const res = await fetch(url.startsWith('http') ? url : `https://api.github.com${url}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const err = new Error(`GitHub API ${method} ${url} → ${res.status} ${await res.text()}`);
      err.status = res.status;
      throw err;
    }
    return { json: res.status === 204 ? null : await res.json(), link: res.headers.get('link') };
  }
  async function all(url) {
    const items = [];
    for (let next = url; next;) {
      const { json, link } = await call('GET', next);
      items.push(...json);
      next = link?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    }
    return items;
  }
  return { call, all };
}

/** A blocker's state as decide() wants it. A PR counts as completed only when merged. */
async function blockerState(gh, repo, n) {
  try {
    const { json } = await gh.call('GET', `/repos/${repo}/issues/${n}`);
    if (json.pull_request) {
      if (json.state !== 'closed') return { state: 'open' };
      return { state: 'closed', stateReason: json.pull_request.merged_at ? 'completed' : 'not_planned' };
    }
    return { state: json.state, stateReason: json.state_reason ?? null };
  } catch (e) {
    console.warn(`  couldn't read #${n}: ${e.message}`);
    return null;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    console.error(`unblock-issues: missing ${[!token && 'GITHUB_TOKEN', !repo && 'GITHUB_REPOSITORY'].filter(Boolean).join(' and ')}.`);
    console.error('Set GITHUB_TOKEN (a token that can read issues; write too unless --dry-run) and GITHUB_REPOSITORY (owner/repo).');
    process.exit(1);
  }
  const gh = api(token);

  // The issues endpoint also returns PRs; a PR labelled `blocked` isn't ours to touch.
  const issues = (await gh.all(`/repos/${repo}/issues?state=open&labels=${BLOCKED_LABEL}&per_page=100`))
    .filter(i => !i.pull_request);
  console.log(`${issues.length} open issue(s) labelled ${BLOCKED_LABEL}${dryRun ? ' (dry run)' : ''}`);

  const cache = new Map();
  const rows = [];
  for (const issue of issues) {
    const states = {};
    for (const n of parseBlockers(issue.body)) {
      if (n === issue.number) continue;
      if (!cache.has(n)) cache.set(n, await blockerState(gh, repo, n));
      states[n] = cache.get(n);
    }
    const d = decide(issue, states);
    let action = d.unblock ? (dryRun ? 'would unblock' : 'unblocked') : 'kept';
    if (d.unblock && !dryRun) {
      try {
        // Remove only `blocked`; DELETE on the one label leaves the others alone.
        await gh.call('DELETE', `/repos/${repo}/issues/${issue.number}/labels/${BLOCKED_LABEL}`);
        await gh.call('POST', `/repos/${repo}/issues/${issue.number}/comments`, { body: unblockComment(d.blockers) });
      } catch (e) {
        action = 'failed';
        console.error(`  #${issue.number}: ${e.message}`);
      }
    }
    console.log(`#${issue.number}: ${action} (${d.reason})`);
    rows.push({ issue, d, action });
  }

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const line = r => `| #${r.issue.number} | ${r.action} | ${r.d.reason} |`;
    const attention = rows.filter(r => r.d.notPlanned.length || r.d.unknown.length || r.action === 'failed');
    const md = [
      `## Auto-unblock${dryRun ? ' (dry run)' : ''}`, '',
      `${rows.filter(r => r.d.unblock).length} of ${rows.length} blocked issue(s) ${dryRun ? 'would be unblocked' : 'unblocked'}.`, '',
    ];
    if (attention.length) {
      md.push('### Needs a person', '', 'A blocker was closed without completing (not planned / duplicate / unmerged PR), couldn\'t be read, or the label edit failed. The label stays.', '',
        '| Issue | Action | Why |', '|---|---|---|', ...attention.map(line), '');
    }
    if (rows.length) md.push('### All blocked issues', '', '| Issue | Action | Why |', '|---|---|---|', ...rows.map(line), '');
    appendFileSync(summary, md.join('\n') + '\n');
  }
  if (rows.some(r => r.action === 'failed')) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(e => { console.error(e); process.exit(1); });
