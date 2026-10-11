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
/**
 * At most this many files are read for one review, attached or not (a file over the per-file cap
 * is only known to be once it's read): each is one request, in each review job, against the
 * repo's hourly API limit.
 */
export const MAX_FILES = 40;
/** The "Not attached" list names at most this many files, then counts the rest. */
export const MAX_LISTED = 50;

const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|skills-lock\.json)$/;
const BINARY = /\.(png|jpe?g|gif|webp|avif|heic|ico|bmp|svgz|mp3|ogg|wav|m4a|flac|mp4|webm|mov|woff2?|ttf|otf|zip|gz|tgz|tar|7z|rar|bz2|xz|br|pdf|psd|kra|aseprite|glb|wasm|bin|jar|apk|aab|class|so|dll|exe)$/i;
const GENERATED = /(^|\/)(dist|build|node_modules)\/|\.min\.(js|css)$|(^|\/)[\w-]*manifest\.json$/;
// Files that hold credentials when they exist at all (env files, keys, certificates, auth rc files).
// The repo is public, so anything committed is already readable; this keeps it that way if it ever
// goes private. Templates like `.env.example` hold no secrets and go in.
const CREDENTIALS = /(^|\/)(\.env(\.(?!example$)[^/]+)?|\.npmrc|\.netrc|\.pypirc|id_(rsa|dsa|ecdsa|ed25519))$|\.(pem|key|p12|pfx|jks|keystore|crt|cer|der|gpg)$/i;

/**
 * Why a changed file isn't attached in full, or null when it is. `file` is a GitHub PR-files
 * entry ({ filename, status }). A removed file has nothing at the head commit: its diff says
 * what went.
 */
export function skipReason(file) {
  if (file.status === 'removed') return 'removed (its diff shows what went)';
  if (CREDENTIALS.test(file.filename)) return 'may hold credentials (only its diff goes to the reviewer)';
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
 * Why nothing more can be read, given the tally so far (`acc` = { count: files read, bytes:
 * bytes attached }), or null. The script checks this before each fetch, so a PR with hundreds
 * of files costs at most MAX_FILES requests a review, not one per file.
 */
export function noRoom(acc, { totalCap = TOTAL_CAP_BYTES, maxFiles = MAX_FILES } = {}) {
  if (acc.count >= maxFiles) return `past the ${maxFiles}-file limit for files in full`;
  if (acc.bytes >= totalCap) return `over the ${kb(totalCap)} KB total for files in full`;
  return null;
}

/**
 * A binary file the name didn't give away (the BINARY list can't name every format): read as
 * text, it has a NUL byte or bytes that aren't UTF-8 (decoded as U+FFFD), as git judges it.
 */
const looksBinary = (text) => /[\u0000\uFFFD]/.test(text);

/**
 * Tally a file that was read (`text`): null if it goes in, else why not. Every file read counts
 * towards MAX_FILES, attached or not. The script keeps the same tally while fetching that
 * contextSection keeps while laying out, so the two agree on what goes in.
 */
export function admit(acc, text, caps = {}) {
  const fileCap = caps.fileCap ?? FILE_CAP_BYTES;
  const totalCap = caps.totalCap ?? TOTAL_CAP_BYTES;
  const full = noRoom(acc, caps);
  if (full) return full;
  acc.count += 1;
  if (looksBinary(text)) return 'binary';
  const size = Buffer.byteLength(text, 'utf8');
  if (size > fileCap) return `${kb(size)} KB, over the ${kb(fileCap)} KB cap per file`;
  if (acc.bytes + size > totalCap) return `over the ${kb(totalCap)} KB total for files in full`;
  acc.bytes += size;
  return null;
}

/**
 * A path as shown in the prompt. Git allows backticks and line breaks in names; shown raw, they
 * could close the inline code or the heading they sit in, so such a path is shown JSON-escaped.
 */
const shown = (p) => (/[`\r\n]/.test(p) ? JSON.stringify(p).replace(/`/g, '\\u0060') : p);

/**
 * The prompt section with the changed files in full (pure). `entries`: in the PR's order,
 * { path, text } for a fetched file or { path, skip } for one left out. Files over the per-file
 * cap, or past the total or the file count, are named instead of attached. Empty when no file
 * changed.
 */
export function contextSection(sha, entries, caps = {}) {
  const maxListed = caps.maxListed ?? MAX_LISTED;
  if (!entries.length) return '';
  const attached = [];
  const left = [];
  const acc = { count: 0, bytes: 0 };
  for (const e of entries) {
    const why = e.skip ?? admit(acc, e.text, caps);
    if (why) { left.push(`- \`${shown(e.path)}\` — ${why}`); continue; }
    const fence = fenceFor(e.text);
    attached.push(`### ${shown(e.path)}\n\n${fence}${langOf(e.path)}\n${e.text.endsWith('\n') ? e.text : `${e.text}\n`}${fence}`);
  }
  return [
    `## Changed files in full, at ${sha.slice(0, 7)}`,
    '',
    "Context for the diff above: the code around a change, what a function returns, what a step's output is. Judge the change itself from the diff.",
    '',
    ...attached.flatMap(a => [a, '']),
    // Capped too: a PR of a thousand sprites would otherwise list a thousand lines of "binary".
    ...(left.length ? ['Not attached:', ...left.slice(0, maxListed), ...(left.length > maxListed ? [`- …and ${left.length - maxListed} more`] : []), ''] : []),
  ].join('\n').trimEnd();
}
