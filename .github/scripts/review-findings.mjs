// The severity gate (#1780): read a paid review's findings and their severity (pure).
//
// The lens and second-opinion prompts (.agents/review-lenses/_shape.md, .agents/review-second-opinion.md)
// ask for each finding as a title line followed by three fields:
//
//   ### <one sentence: what is wrong>
//   severity: high | medium | low
//   fails when: <a concrete input or state, and the wrong result it gives>
//   evidence: path/to/file.ts:LINE
//
// Only a high finding holds the merge, and only with a concrete `fails when` and an `evidence` line
// naming a file and line (`src/a.ts:12`, `src/a.ts:12-20`): a "high" missing either is counted as
// medium. Medium and low findings are still posted, under a "not blocking" heading.
//
// A breach of a "Must pass" rule in .agents/review.md (security, TypeScript, unrelated changes,
// acceptance tests, design decisions) blocks as it did before the gate, scenario or not: the second
// opinion marks it with a `rule:` line naming the rule, and that finding counts as high whatever its
// grade. Some breaches have no single line (a missing section), so its evidence may be a file or
// `PR body` instead of file:line; with no evidence at all it is counted as medium. Correctness and
// regressions are bugs, so a `rule:` naming only those is graded like any other finding. A finding the model announced (`FINDINGS: n`) but left without a severity line counts
// as high, as an old-format marker does at the gate (risk-score.mjs): nothing slips through when a
// model ignores the shape.
//
// Plain module, no dependencies: the review jobs run the base branch's scripts with no `npm ci`.

/** A field line, after any bullet, numbering or emphasis: `- **Severity:** high`, `_Fails when:_ ...`. */
const FIELD = /^[\s>*_\-+•`]*(severity|rule|fails when|evidence)[*_`\s]*:[*_`\s]*(.*)$/i;
/** Values that say there is no scenario (or no rule, or no evidence). */
const PLACEHOLDER = /^(?:n\/?a|none|no|-|—|–|unknown|tbd|\?|nothing|not applicable)\.?$/i;
/** The closing "What I checked" line starts the tail. */
const TAIL = /^[\s>*_#\-]*what i checked/i;
/** The count and verdict lines the shapes open with. */
const COUNT = /FINDINGS:\s*\*{0,2}\s*(\d+)/i;
const VERDICT = /VERDICT:\s*\*{0,2}\s*(approve|request-changes)/i;

/** A file and line: `src/a.ts:12`, `src/a.ts:L12-L20`, `src/a.ts#L12`, `Makefile:3`, `.github/x.yml:4`. */
const FILE_LINE = /(?:^|[^\w@~./-])((?:[\w@~.-]+\/)*[\w@~.-]*\w)(?::|#)L?\d+\b/g;
export function hasFileLine(evidence = '') {
  for (const m of String(evidence).matchAll(FILE_LINE)) {
    const file = m[1];
    if (/^https?$/i.test(file)) continue;
    // A path (with a slash or an extension), or a bare name such as Makefile; not a time like 12:30.
    if (/[/.]/.test(file) || /^[A-Za-z][\w-]*$/.test(file)) return true;
  }
  return false;
}
/** The must-pass rule a `rule:` line names, or '' when it names none (or only correctness/regressions). */
function mustPassRule(value) {
  const v = value.toLowerCase();
  if (!v || PLACEHOLDER.test(v)) return '';
  if (/correct|regress/.test(v) && !/secur|secret|type ?script|\bts\b|\bany\b|unrelated|scope|acceptance|design|wrong if/.test(v)) return '';
  return value;
}

const clean = (s) => s.replace(/[*_`\s]+$/, '').trim();
/** A severity word, or 'high' for anything it can't read: an unknown grade must not slip through. */
function grade(value) {
  const v = value.toLowerCase();
  if (/\b(high|critical|blocker|severe)\b/.test(v)) return 'high';
  if (/\b(medium|moderate|med)\b/.test(v)) return 'medium';
  if (/\b(low|minor|nit|trivial|info)\b/.test(v)) return 'low';
  return 'high';
}

/**
 * Parse a review's text. Returns
 * - `stated`: the `FINDINGS: n` count, or null;
 * - `findings`: [{ title, claimed, severity, rule, failsWhen, evidence, downgraded, note, lines }] in
 *   order — `claimed` is what the model wrote, `severity` what counts: a high without a concrete
 *   scenario or a file:line evidence → medium; a must-pass `rule` breach → high (medium with no
 *   evidence at all); `note` says why when they differ, or why a rule breach blocks;
 * - `total`: how many findings there are (the larger of the stated count and those parsed), null
 *   when the text says neither;
 * - `high`: the high findings, plus any announced but left ungraded; null when `total` is;
 * - `preamble` and `tail`: the lines before the first finding and from "What I checked" on.
 */
export function parseFindings(text = '') {
  const lines = String(text).split('\n');
  const statedM = COUNT.exec(text);
  const stated = statedM ? Number(statedM[1]) : null;

  // Each finding is anchored on its severity line; its title is the line just above it.
  const anchors = [];
  for (let i = 0; i < lines.length; i++) {
    const m = FIELD.exec(lines[i]);
    if (!m || m[1].toLowerCase() !== 'severity') continue;
    const prev = i - 1;
    const prevOk = prev >= 0 && lines[prev].trim() && !FIELD.test(lines[prev]) && !COUNT.test(lines[prev]) && !VERDICT.test(lines[prev])
      && (!anchors.length || prev > anchors[anchors.length - 1].sev);
    anchors.push({ sev: i, start: prevOk ? prev : i, value: m[2] });
  }

  let tailStart = lines.length;
  const lastSev = anchors.length ? anchors[anchors.length - 1].sev : -1;
  for (let i = lastSev + 1; i < lines.length; i++) if (TAIL.test(lines[i])) { tailStart = i; break; }
  if (!anchors.length) tailStart = lines.length;

  const findings = anchors.map((a, k) => {
    const end = k + 1 < anchors.length ? anchors[k + 1].start : tailStart;
    const block = lines.slice(a.start, end);
    let failsWhen = '';
    let evidence = '';
    let rule = '';
    for (let j = a.sev + 1; j < end; j++) {
      const m = FIELD.exec(lines[j]);
      if (!m) continue;
      const field = m[1].toLowerCase();
      let value = clean(m[2]);
      // A field's value may start on the next line.
      if (!value && j + 1 < end && lines[j + 1].trim() && !FIELD.test(lines[j + 1])) value = clean(lines[j + 1].replace(/^[\s>*_\-+•]+/, ''));
      if (field === 'fails when' && !failsWhen) failsWhen = value;
      if (field === 'evidence' && !evidence) evidence = value;
      if (field === 'rule' && !rule) rule = mustPassRule(value);
    }
    const claimed = grade(a.value);
    const concrete = !!failsWhen && !PLACEHOLDER.test(failsWhen);
    const located = hasFileLine(evidence);
    const pointed = !!evidence && !PLACEHOLDER.test(evidence);
    let severity = claimed;
    let note = '';
    if (rule) {
      // A must-pass breach blocks whatever its grade, as before #1780; it only has to say where.
      severity = pointed ? 'high' : 'medium';
      note = pointed
        ? `Breaks a must-pass rule (${rule}), so it blocks whatever its grade (#1780).`
        : `Names a must-pass rule (${rule}) but no \`evidence\` of where, so counted as medium (#1780).`;
    } else if (claimed === 'high' && (!concrete || !located)) {
      severity = 'medium';
      const missing = [!concrete && 'a concrete `fails when` scenario', !located && 'an `evidence` line naming a file and line'].filter(Boolean).join(' or ');
      note = `Marked high without ${missing}, so counted as medium (#1780).`;
    }
    const title = a.start < a.sev ? clean(lines[a.start].replace(/^[\s>#*_\-+•]*(?:\d+[.)]\s*)?/, '')) : '';
    // Drop the blank lines a block ends with, so the rendered comment stays tidy.
    while (block.length && !block[block.length - 1].trim()) block.pop();
    const rank = { low: 0, medium: 1, high: 2 };
    return { title, claimed, severity, rule, failsWhen: concrete ? failsWhen : '', evidence, downgraded: rank[severity] < rank[claimed], note, lines: block };
  });

  const total = stated === null && !findings.length ? null : Math.max(stated ?? 0, findings.length);
  const ungraded = total === null ? 0 : total - findings.length;
  const high = total === null ? null : findings.filter((f) => f.severity === 'high').length + ungraded;
  return {
    stated, findings, total, high,
    preamble: lines.slice(0, anchors.length ? anchors[0].start : lines.length),
    tail: lines.slice(tailStart),
  };
}

/**
 * The second opinion's verdict under the severity gate: `approve` unless a high finding is present.
 * - a high finding (or one announced but ungraded) → request-changes, whatever the model's line says;
 * - the model wrote request-changes but graded nothing → request-changes (counted as one ungraded
 *   high finding): it says something blocks, and nothing says what;
 * - otherwise a VERDICT line or graded findings → approve; neither → unclear.
 * Returns { verdict, total, high, findings } (total and high null only when unclear).
 */
export function secondOpinionVerdict(text = '') {
  const p = parseFindings(text);
  const said = VERDICT.exec(text)?.[1]?.toLowerCase() ?? null;
  if (p.high) return { verdict: 'request-changes', total: p.total, high: p.high, findings: p.findings };
  if (said === 'request-changes' && !p.findings.length) {
    const total = Math.max(p.total ?? 0, 1);
    return { verdict: 'request-changes', total, high: total, findings: p.findings };
  }
  if (said || p.total !== null) return { verdict: 'approve', total: p.total ?? 0, high: 0, findings: p.findings };
  return { verdict: 'unclear', total: null, high: null, findings: p.findings };
}

/**
 * The review text as posted: the graded findings regrouped under "Blocking" (high) and "Not
 * blocking" (medium, low) headings, each as the model wrote it, with a note on any downgraded one and on any rule breach.
 * Text with no graded findings is posted as it came.
 */
export function renderFindings(text = '', parsed = parseFindings(text)) {
  if (!parsed.findings.length) return String(text).trim();
  const block = (f) => [...f.lines, ...(f.note ? ['', `_${f.note}_`] : [])].join('\n');
  const high = parsed.findings.filter((f) => f.severity === 'high');
  const rest = parsed.findings.filter((f) => f.severity !== 'high');
  return [
    parsed.preamble.join('\n').trim(),
    ...(high.length ? [`### Blocking — ${high.length} high-severity finding(s)`, ...high.map(block)] : []),
    ...(rest.length ? [`### Not blocking — ${rest.length} medium or low finding(s)`, '_Posted to be seen; they don\'t hold the merge (#1780)._', ...rest.map(block)] : []),
    parsed.tail.join('\n').trim(),
  ].filter(Boolean).join('\n\n');
}
