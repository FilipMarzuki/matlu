#!/usr/bin/env node
/**
 * ci-scope (#1533): which of *DevCycle 2 — CI*'s jobs a change needs.
 *
 *   node .github/scripts/ci-scope.mjs    # in CI: reads the PR's changed files from git and
 *                                        # writes job flags (game=true …) to $GITHUB_OUTPUT
 *
 * The CI workflow always runs: the merge gate (risk-score.mjs --gate) and the review chain
 * (DevCycle 3 and 3c, both `workflow_run` on CI) wait for a successful run on the head commit.
 * This only decides which jobs and steps inside it do work; a skipped job counts as success.
 *
 * Safe by default: a file outside every known area runs everything, and so does a push (to
 * `main` or `bender/**`) or anything that goes wrong reading the diff.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The job flags, in the order ci.yml reads them. */
export const FLAGS = ['game', 'artificer', 'engines', 'wiki', 'dev'];

/**
 * Areas, checked in order: the first that matches a file claims it. `docs` needs no job and comes
 * last, so Markdown inside a code area (wiki and dev content, or a file under src/ that code could
 * import as text) counts as that area's. artificer comes before game because src/artificer* is
 * under src/.
 */
export const AREAS = [
  ['wiki', [/^wiki\//]],
  ['dev', [/^dev\//]],
  ['artificer', [/^src\/artificer(-app|-ai)?\//, /^artificer\.html$/, /^artificer\//, /^tests\/artificer-[^/]+\.spec\.ts$/, /^scripts\/(ai-[^/]+|build-artificer\.mjs)$/]],
  ['engines', [/^storytelling\//, /^mapgen\//]],
  ['game', [/^src\//, /^public\//, /^index\.html$/, /^crafting\.html$/, /^tests\//, /^macro-world\//]],
  ['docs', [/^docs\//, /^screenshots\//, /\.md$/]],
];

/** The area a changed file belongs to, or null for a file no area knows (which runs everything). */
export function areaOf(file) {
  for (const [area, patterns] of AREAS) if (patterns.some(p => p.test(file))) return area;
  return null;
}

/**
 * The jobs a set of changed files needs: `{ game, artificer, engines, wiki, dev, reason }`.
 * An engines change also runs the game's checks, because src/ imports storytelling/ and mapgen/.
 * The game's checks cover all of src/ (Artificer's tests and Playwright spec included), so ci.yml
 * runs the Artificer-only subset just when `artificer` is set without `game`.
 */
export function scope(files, { push = false } = {}) {
  const all = reason => ({ ...Object.fromEntries(FLAGS.map(f => [f, true])), reason });
  if (push) return all('push: everything runs');
  if (files.length === 0) return all('no changed files found: everything runs');
  const out = Object.fromEntries(FLAGS.map(f => [f, false]));
  for (const file of files) {
    const area = areaOf(file);
    if (area === null) return all(`${file} is outside every area: everything runs`);
    if (area !== 'docs') out[area] = true;
  }
  if (out.engines) out.game = true;
  const on = FLAGS.filter(f => out[f]);
  return { ...out, reason: on.length ? `runs: ${on.join(', ')}` : 'docs only: no jobs run' };
}

/**
 * A pull_request run checks out the PR merged into the base branch, so HEAD^1 is the base and
 * HEAD^1..HEAD is exactly what the PR changes (ci.yml checks out with fetch-depth 2 for this).
 */
function changedFiles() {
  return execFileSync('git', ['diff', '--name-only', 'HEAD^1', 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

function main() {
  let result;
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') result = scope([], { push: true });
  else {
    try {
      result = scope(changedFiles());
    } catch (e) {
      result = scope([], { push: true });
      result.reason = `couldn't read the diff (${e.message.split('\n')[0]}): everything runs`;
    }
  }
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, FLAGS.map(f => `${f}=${result[f]}\n`).join(''));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
