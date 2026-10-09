// The changed files in full, for the paid reviewers (#1483).
//
// The second opinion and the focused lenses (run-second-review.js) used to see only the diff.
// Since #1481 their verdicts gate medium- and high-risk merges, so a finding born of missing
// context ("this output is never set" — it is, in a line outside the diff) holds a PR for
// nothing. They now also get each changed text file as it stands at the head commit, within
// caps that keep a review's cost sensible.
//
// Pure: the script fetches the files; this decides what goes in and lays it out.

/** A changed file bigger than this is named, not attached. */
export const FILE_CAP_BYTES = 50_000;
/** All the attached files together stay under this (about 30k tokens). */
export const TOTAL_CAP_BYTES = 120_000;

const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|skills-lock\.json)$/;
const BINARY = /\.(png|jpe?g|gif|webp|ico|bmp|svgz|mp3|ogg|wav|m4a|flac|woff2?|ttf|otf|zip|gz|tgz|pdf|psd|aseprite|glb|bin)$/i;
const GENERATED = /(^|\/)(dist|build|node_modules)\/|\.min\.(js|css)$|(^|\/)[\w-]*manifest\.json$/;

/**
 * Why a changed file isn't attached in full, or null when it is. `file` is a GitHub PR-files
 * entry ({ filename, status }). A removed file has nothing at the head commit: its diff says
 * what went.
 */
export function skipReason(file) {
  if (file.status === 'removed') return 'removed (its diff shows what went)';
  if (LOCKFILE.test(file.filename)) return 'lockfile';
  if (BINARY.test(file.filename)) return 'binary';
  if (GENERATED.test(file.filename)) return 'generated';
  return null;
}

const LANG = { ts: 'ts', tsx: 'tsx', js: 'js', mjs: 'js', cjs: 'js', mts: 'ts', json: 'json', yml: 'yaml', yaml: 'yaml', md: 'md', css: 'css', html: 'html', astro: 'astro', sh: 'bash' };
const langOf = (p) => LANG[p.split('.').pop()?.toLowerCase() ?? ''] ?? '';
/** A fence longer than any run of backticks in the text, so a file holding ``` can't close it early. */
const fenceFor = (text) => '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1)));
const kb = (n) => Math.round(n / 1000);

/**
 * The prompt section with the changed files in full (pure). `entries`: in the PR's order,
 * { path, text } for a fetched file or { path, skip } for one left out. Files over the per-file
 * cap, or past the total, are named instead of attached. Empty when no file changed.
 */
export function contextSection(sha, entries, { fileCap = FILE_CAP_BYTES, totalCap = TOTAL_CAP_BYTES } = {}) {
  if (!entries.length) return '';
  const attached = [];
  const left = [];
  let total = 0;
  for (const e of entries) {
    if (e.skip) { left.push(`- \`${e.path}\` — ${e.skip}`); continue; }
    const size = Buffer.byteLength(e.text, 'utf8');
    if (size > fileCap) { left.push(`- \`${e.path}\` — ${kb(size)} KB, over the ${kb(fileCap)} KB cap per file`); continue; }
    if (total + size > totalCap) { left.push(`- \`${e.path}\` — over the ${kb(totalCap)} KB total for files in full`); continue; }
    total += size;
    const fence = fenceFor(e.text);
    attached.push(`### ${e.path}\n\n${fence}${langOf(e.path)}\n${e.text.endsWith('\n') ? e.text : `${e.text}\n`}${fence}`);
  }
  return [
    `## Changed files in full, at ${sha.slice(0, 7)}`,
    '',
    "Context for the diff above: the code around a change, what a function returns, what a step's output is. Judge the change itself from the diff.",
    '',
    ...attached.flatMap(a => [a, '']),
    ...(left.length ? ['Not attached:', ...left, ''] : []),
  ].join('\n').trimEnd();
}
