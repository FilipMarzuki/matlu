/**
 * Build the AI progression report (#1229) from saved transcripts.
 *
 *   npm run ai:report                       # every transcript under ai-runs/
 *   npm run ai:report -- --in ai-runs/batch3 --out ai-runs/batch3/report.html
 *   npm run ai:report -- --md summary.md     # also write a short Markdown summary (used by the nightly workflow)
 *
 * Writes one self-contained HTML page (data inlined, no network) and prints a
 * short text summary. Transcripts from before #1229 (no `start` snapshot) are
 * skipped — re-run those models to include them.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aggregate, wins, WIN_KINDS, METRICS, EVENTS, type ModelSummary, type Transcript } from '../src/artificer-ai/report';

const args = process.argv.slice(2);
const opt = (name: string, dflt: string): string => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const inDir = opt('in', 'ai-runs');
const outFile = opt('out', join(inDir, 'report.html'));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json') ? [p] : [];
  });
}

const transcripts: Transcript[] = [];
let skipped = 0;
for (const f of walk(inDir)) {
  try {
    const t = JSON.parse(readFileSync(f, 'utf8'));
    if (t.start && Array.isArray(t.turns) && t.turns.every((x: { progress?: unknown }) => x.progress)) transcripts.push(t);
    else skipped++;
  } catch { skipped++; }
}
if (!transcripts.length) { console.error(`No transcripts with progress snapshots under ${inDir} (${skipped} older or unreadable).`); process.exit(1); }

// Transcripts from before #1231 have no recorded cost. Estimate it from their tokens at today's
// OpenRouter prices (marked as estimates); offline, they just stay unknown.
await estimateMissingCosts(transcripts);
const models = aggregate(transcripts);

// ── Text summary ──
console.log(`\n${transcripts.length} runs, ${models.length} models${skipped ? ` (${skipped} older transcripts skipped)` : ''}\n`);
for (const m of models) {
  const out = Object.entries(m.outcomes).map(([k, n]) => `${k} ${n}`).join(', ');
  const cost = m.cost.perGame === null ? 'cost —' : `$${m.cost.perGame.toFixed(3)}/game${m.cost.estimated ? ' (est.)' : ''}`;
  console.log(`  ${m.model.padEnd(34)} ${out.padEnd(22)} ${cost.padEnd(20)} ready ${m.readyDay ?? '—'} (${m.readyRuns}/${m.runs}) · ranks ${m.series.conceptRanks.at(-1)} · recipes ${m.series.recipesKnown.at(-1)} · crafts ${m.series.crafts.at(-1)}`);
  console.log(`  ${''.padEnd(34)} ${survivalLine(m)}`);
  if (m.road) console.log(`  ${''.padEnd(34)} ${roadLine(m)}`);
  if (m.encounters.perRun) console.log(`  ${''.padEnd(34)} ${encounterLine(m)}`);
  const fl = frightLine(m);
  if (fl) console.log(`  ${''.padEnd(34)} ${fl}`);
}

/** Fear in a line (#1365): panics and overrides, spooks and fearful nights per run, fears gained and faded. */
function frightLine(m: ModelSummary): string {
  const f = m.fright;
  const fears = (x: Record<string, number>) => Object.entries(x).map(([id, n]) => `${id.slice(5)} ${n}`).join(', ');
  const parts = [
    f.shaken || f.panicked ? `encounters shaken ${f.shaken}, panicked ${f.panicked}${f.overrides ? ` (${f.overrides} overridden)` : ''}` : '',
    f.spooks ? `spooks ${f.spooks}/run` : '',
    f.uneasyNights || f.sleeplessNights ? `fearful nights ${f.uneasyNights} uneasy + ${f.sleeplessNights} sleepless /run` : '',
    Object.keys(f.fearsGained).length ? `fears gained: ${fears(f.fearsGained)}` : '',
    Object.keys(f.fearsLost).length ? `faded: ${fears(f.fearsLost)}` : '',
  ].filter(Boolean);
  return parts.length ? `fear — ${parts.join(' · ')}` : '';
}

/** Encounters in a line (#1348): how many a run, what was chosen by kind, and which ones killed. */
function encounterLine(m: ModelSummary): string {
  const e = m.encounters;
  const choices = Object.entries(e.choices).map(([kind, by]) => `${kind}: ${Object.entries(by).map(([c, n]) => `${c} ${n}`).join(', ')}`).join(' · ');
  const deaths = Object.entries(e.deaths).map(([id, n]) => `${id} ${n}`).join(', ');
  return `encounters ${e.perRun}/run — ${choices}${deaths ? ` · killed by: ${deaths}` : ''}${e.forced ? ` · ${e.forced} forced` : ''}`;
}

/** The road in a line (#1251): how the runs that rode on ended, and what they came away with. */
function roadLine(m: ModelSummary): string {
  const r = m.road!;
  const out = Object.entries(r.outcomes).map(([k, n]) => `${k} ${n}`).join(', ');
  return `road (${r.runs} run${r.runs === 1 ? '' : 's'}): ${out} · marks ${r.marks ?? '—'} · quests ${r.quests ?? '—'} · trust ${r.trust ?? '—'}${r.invalidDays ? ` · ${r.invalidDays} invalid days` : ''}`;
}

/** The winter in a line (#1309): survival rate, grades, when and how the rest died, and the hard nights per run. */
function survivalLine(m: ModelSummary): string {
  const v = m.survival;
  const grades = (['hale', 'worn', 'broken'] as const).filter(g => v.grades[g]).map(g => `${v.grades[g]} ${g}`).join(', ');
  const deaths = Object.entries(v.deaths).map(([k, n]) => `${k} ${n}`).join(', ');
  const nights = Object.entries(v.nights).map(([k, n]) => `${k} ${n}`).join(', ');
  return `survived ${Math.round(v.rate * 100)}%${grades ? ` (${grades})` : ''}${v.deathDay !== null ? ` · died on day ${v.deathDay} (median) — ${deaths}` : ''}${nights ? ` · hard nights/run: ${nights}` : ''}`;
}

const spend = models.reduce((n, m) => n + (m.cost.total ?? 0), 0);
console.log(`\n  total spend: $${spend.toFixed(2)}${models.some(m => m.cost.estimated) ? ' (includes estimates for runs recorded before cost tracking)' : ''}`);
writeFileSync(outFile, page(models, transcripts.length));
const mdFile = opt('md', '');
if (mdFile) writeFileSync(mdFile, markdown(models, transcripts.length, spend));
console.log(`\nreport → ${outFile}`);

/**
 * What a night of the model roster costs, measured from these runs (#1309) — so the run page
 * says whether the nightly budget (AI_BENCH_BUDGET, default $1) needs raising or the roster trimming.
 */
function rosterCost(models: ModelSummary[]): string {
  const paid = models.filter(m => m.cost.perGame !== null && m.cost.perGame > 0);
  if (!paid.length) return '';
  const night = paid.reduce((n, m) => n + (m.cost.perGame as number), 0);
  return `One game per model costs about $${night.toFixed(2)} a night (${paid.length} models, from these runs). ${night > 1 ? 'That is over the default $1 AI_BENCH_BUDGET: raise it, or trim the roster.' : 'That fits the default $1 AI_BENCH_BUDGET.'}`;
}

/** A compact Markdown summary: outcomes, readiness, key progression and spend per model. */
function markdown(models: ModelSummary[], runs: number, spend: number): string {
  const money = (x: number | null): string => (x === null ? '—' : `$${x.toFixed(3)}`);
  const pct = (m: ModelSummary): string => `${Math.round(100 * wins(m.outcomes) / m.runs)}%`;
  const last = (m: ModelSummary, k: keyof ModelSummary['series']): string => String(m.series[k].filter(v => v !== null).at(-1) ?? '—');
  const grades = (m: ModelSummary): string => (['hale', 'worn', 'broken'] as const).map(g => m.survival.grades[g]).join(' / ');
  const rows = models.map(m => `| ${m.model} | ${m.runs} | ${pct(m)} | ${grades(m)} | ${m.survival.deathDay ?? '—'} | ${m.readyDay ?? 'never'} | ${last(m, 'conceptRanks')} | ${last(m, 'recipesKnown')} | ${last(m, 'crafts')} | ${m.invalidDays} | ${money(m.cost.perGame)} |`);
  return [
    `### Artificer AI playtest — ${runs} runs, ${models.length} players, $${spend.toFixed(2)} spent`,
    '',
    '| Player | Runs | Survived | Hale / worn / broken | Died (median day) | Ready (day) | Concept ranks | Recipes | Crafts | Invalid days | $/game |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
    'End-of-run values are means over runs. The full report (charts, milestone days, action mix) is in the `ai-playtest` artifact.',
    '',
    rosterCost(models),
    '',
  ].join('\n');
}

async function estimateMissingCosts(ts: Transcript[]): Promise<void> {
  const missing = ts.filter(t => typeof t.usage.cost !== 'number' && t.player.startsWith('openrouter:'));
  for (const t of ts) if (typeof t.usage.cost !== 'number' && /^(scripted|random:)/.test(t.player)) t.usage.cost = 0;
  if (!missing.length) return;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(10000) });
    const { data } = await res.json() as { data: { id: string; pricing: { prompt: string; completion: string; input_cache_read?: string } }[] };
    const price = new Map(data.map(m => [m.id, m.pricing]));
    for (const t of missing) {
      const p = price.get(t.player.slice('openrouter:'.length));
      if (!p) continue;
      const pin = Number(p.prompt), pout = Number(p.completion), pcache = Number(p.input_cache_read ?? p.prompt);
      t.usage.cost = (t.usage.input - t.usage.cacheRead) * pin + t.usage.cacheRead * pcache + t.usage.output * pout;
      t.usage.costEstimated = true;
    }
  } catch { /* offline: costs stay unknown */ }
}

// ── The page ──

function page(models: ModelSummary[], runs: number): string {
  const data = {
    generated: new Date().toISOString().slice(0, 10),
    runs,
    models,
    metrics: Object.fromEntries(Object.entries(METRICS).map(([k, v]) => [k, { label: v.label, unit: v.unit }])),
    events: Object.fromEntries(Object.entries(EVENTS).map(([k, v]) => [k, v.label])),
  };
  // JSON inside <script> must not be able to close the tag.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<title>Artificer AI Progression</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&family=Chakra+Petch:wght@400;500;600;700&display=swap">
<style>
:root {
  --bg: #f6f5f1; --panel: #fcfcfb; --ink: #0b0b0b; --ink2: #52514e; --muted: #8a887f; --rule: #e4e2dc; --grid: #ecebe6;
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #e87ba4; --s6: #008300; --s7: #4a3aa7; --s8: #e34948;
  --good: #1f7a3a; --bad: #b3261e;
  --b1: #3d3c39; --b2: #7a786f; --b3: #a9a79e;
  --display: "Silkscreen", "Courier New", monospace; --body: "Chakra Petch", system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0d0e1a; --panel: #161829; --ink: #f0f0e8; --ink2: #b9bccb; --muted: #7c8098; --rule: #2a2c3e; --grid: #22243a;
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767;
  --good: #88e09a; --bad: #ff8a80; --b1: #e4e2d8; --b2: #a6a49a; --b3: #74726a; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0d0e1a; --panel: #161829; --ink: #f0f0e8; --ink2: #b9bccb; --muted: #7c8098; --rule: #2a2c3e; --grid: #22243a;
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767;
  --good: #88e09a; --bad: #ff8a80; --b1: #e4e2d8; --b2: #a6a49a; --b3: #74726a; color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.5 var(--body); }
.wrap { max-width: 1180px; margin: 0 auto; padding-block: 28px 48px; padding-inline: 16px; }
h1 { font: 700 clamp(18px, 3vw, 24px) var(--display); letter-spacing: 1px; margin: 0 0 4px; text-wrap: balance; }
h2 { font: 700 12px var(--display); letter-spacing: 2px; color: var(--ink2); margin: 36px 0 12px; text-transform: uppercase; }
.lede { color: var(--ink2); max-width: 72ch; margin: 0 0 8px; }
.meta { color: var(--muted); font-size: 12px; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 10px; margin: 16px 0 6px; position: sticky; top: env(safe-area-inset-top, 0px); background: var(--bg); padding-block: 8px; z-index: 2; }
.legend button { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--rule); background: var(--panel); color: var(--ink); border-radius: 999px; padding: 4px 11px 4px 8px; font: 12px var(--body); cursor: pointer; }
.legend button[aria-pressed="false"] { opacity: .45; }
.legend button[aria-pressed="false"] .sw { background: transparent !important; outline: 2px solid var(--muted); outline-offset: -2px; }
.sw { width: 12px; height: 12px; border-radius: 3px; flex: none; }
/* Dashed baseline swatches are tiny SVGs: keep the chart SVG sizing off them. */
svg.sw, .card .tip svg.sw { width: 12px; height: 12px; display: inline-block; overflow: visible; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 14px; }
.card { background: var(--panel); border: 1px solid var(--rule); border-radius: 12px; padding: 12px 14px 10px; min-width: 0; position: relative; }
.card h3 { font: 600 13px var(--body); margin: 0 0 4px; display: flex; gap: 8px; align-items: baseline; }
.card h3 .tv { margin-left: auto; font: 11px var(--body); color: var(--ink2); background: none; border: 1px solid var(--rule); border-radius: 6px; padding: 1px 7px; cursor: pointer; }
.card svg { display: block; width: 100%; height: auto; overflow: visible; touch-action: pan-y; }
.card svg text { fill: var(--muted); font: 10px var(--body); font-variant-numeric: tabular-nums; }
.card .gridline { stroke: var(--grid); stroke-width: 1; }
.card .axis { stroke: var(--rule); stroke-width: 1; }
.card .line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.card .xhair { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; }
.card .dot { stroke: var(--panel); stroke-width: 2; }
.tip { position: absolute; pointer-events: none; background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; padding: 6px 9px; font-size: 12px; box-shadow: 0 6px 18px rgba(0,0,0,.18); min-width: 170px; z-index: 3; }
.tip b { display: block; font-weight: 600; margin-bottom: 2px; }
.tip div { display: flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; }
.tip .nm { flex: 1; color: var(--ink2); white-space: nowrap; }
.tip .vl { padding-left: 10px; }
.scroll { overflow-x: auto; border: 1px solid var(--rule); border-radius: 12px; background: var(--panel); }
table { border-collapse: collapse; width: 100%; font-size: 12.5px; font-variant-numeric: tabular-nums; }
th, td { padding: 7px 10px; text-align: right; border-bottom: 1px solid var(--rule); white-space: nowrap; }
th:first-child, td:first-child { text-align: left; position: sticky; left: 0; background: var(--panel); }
thead th { font-weight: 600; color: var(--ink2); font-size: 11.5px; }
tbody tr:last-child td { border-bottom: 0; }
td .na { color: var(--muted); }
td.good { color: var(--good); font-weight: 600; } td.bad { color: var(--bad); }
.mtable { margin-top: 8px; max-height: 220px; overflow: auto; }
.mtable table { font-size: 11.5px; }
.note { color: var(--muted); font-size: 12px; margin-top: 8px; max-width: 80ch; }
</style>
<div class="wrap">
  <h1>Artificer AI Progression</h1>
  <p class="lede">How different models progress through Greywind Reach, day by day: what they learn, build, explore and stockpile, and when key moments land. Each line is one model, averaged over its runs. A day's value is the state at the end of that day; day 0 is the start.</p>
  <p class="meta" id="meta"></p>
  <div class="legend" id="legend" aria-label="Models (tap to hide or show)"></div>

  <h2>Outcomes</h2>
  <div class="scroll"><table id="outcomes"></table></div>

  <h2>The winter <span class="meta">(survivors by grade; median day the others died, and of what; hard nights per run)</span></h2>
  <div class="scroll"><table id="winter"></table></div>

  <h2>Progression by day</h2>
  <div class="grid" id="charts"></div>

  <h2>When things happen <span class="meta">(mean day it first happened; n/N when not every run got there)</span></h2>
  <div class="scroll"><table id="events"></table></div>

  <h2>What they spend their days on <span class="meta">(times queued per run)</span></h2>
  <div class="scroll"><table id="actions"></table></div>
  <p class="note">Generated by <code>npm run ai:report</code> from <code>ai-runs/</code> transcripts. Re-run after <code>npm run ai:play</code> to refresh.</p>
</div>
<script>
const D = ${json};
// AI models take the categorical slots in order; baselines (scripted, random) are a different kind of
// series, drawn in neutral greys with dash patterns so they never borrow — or cycle — a model's colour.
const BASE = { 'scripted': { c: 'var(--b1)', dash: '6 3' }, 'random:legal': { c: 'var(--b2)', dash: '2 3' }, 'random:uniform': { c: 'var(--b3)', dash: '1 4' } };
const isBase = m => m.model in BASE;
const esc = t => String(t).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const fmt = v => v === null || v === undefined ? '—' : (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
const hidden = new Set();
let slot = 0;   // colour follows the model, never its rank or visibility
const models = D.models.map(m => {
  if (isBase(m)) return { ...m, c: BASE[m.model].c, dash: BASE[m.model].dash };
  const c = slot < 8 ? 'var(--s' + (++slot) + ')' : 'var(--muted)';   // a 9th AI model folds to muted, never a cycled hue
  return { ...m, c, dash: null };
});
const sw = m => m.dash
  ? '<svg class="sw" viewBox="0 0 12 12" aria-hidden="true"><line x1="0" y1="6" x2="12" y2="6" stroke="' + m.c + '" stroke-width="2.5" stroke-dasharray="' + (m.dash === '6 3' ? '4 2' : m.dash === '2 3' ? '2 2' : '1 3') + '"/></svg>'
  : '<span class="sw" style="background:' + m.c + '"></span>';
const short = m => m.model.split('/').pop();

// Money: cents precision, "est." when built from tokens × today's price rather than the billed amount.
function money(x, est) { if (x === null || x === undefined) return '<span class="na">—</span>'; return (x === 0 ? '$0' : x < 0.01 ? '$' + x.toFixed(4) : '$' + x.toFixed(3)) + (est ? ' <span class="na">est.</span>' : ''); }
const spend = models.reduce((n, m) => n + (m.cost.total || 0), 0);
document.getElementById('meta').textContent = D.runs + ' runs · ' + models.length + ' models · total AI spend $' + spend.toFixed(2) + (models.some(m => m.cost.estimated) ? ' (partly estimated)' : '') + ' · generated ' + D.generated;

function legend() {
  const el = document.getElementById('legend');
  el.innerHTML = models.map(m => '<button aria-pressed="' + !hidden.has(m.model) + '" data-m="' + esc(m.model) + '">' + sw(m) + esc(isBase(m) ? m.model + ' (baseline)' : short(m)) + '</button>').join('');
}
document.getElementById('legend').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const m = b.dataset.m; if (hidden.has(m)) hidden.delete(m); else hidden.add(m);
  legend(); charts();
});

function outcomes() {
  const kinds = ['survived', 'thrive', 'crossed', 'wintered', 'ragged', 'turnedBack', 'grim', 'collapsed', 'died'].filter(k => models.some(m => m.outcomes[k]));
  document.getElementById('outcomes').innerHTML =
    '<thead><tr><th>Model</th><th>Runs</th>' + kinds.map(k => '<th>' + k + '</th>').join('') + '<th>Ready (day)</th><th>Invalid days</th><th>Cost / game</th><th>Cost / win</th><th>Spend</th><th>Tokens in</th><th>Cached</th><th>Tokens out</th></tr></thead><tbody>' +
    models.map(m => '<tr><td><span style="display:inline-flex;vertical-align:-1px;margin-right:6px">' + sw(m) + '</span>' + esc(m.model) + '</td><td>' + m.runs + '</td>' +
      kinds.map(k => '<td class="' + (WIN_KINDS.includes(k) && m.outcomes[k] ? 'good' : (k === 'ragged' || k === 'grim' || k === 'turnedBack' || k === 'collapsed' || k === 'died') && m.outcomes[k] ? 'bad' : '') + '">' + (m.outcomes[k] || '<span class="na">0</span>') + '</td>').join('') +
      '<td>' + (m.readyDay ?? '<span class="na">never</span>') + (m.readyRuns && m.readyRuns < m.runs ? ' <span class="na">(' + m.readyRuns + '/' + m.runs + ')</span>' : '') + '</td>' +
      '<td>' + m.invalidDays + '</td>' +
      '<td>' + money(m.cost.perGame, m.cost.estimated) + '</td><td>' + (m.cost.perWin === null ? '<span class="na">' + (m.cost.perGame === null ? '—' : 'no win') + '</span>' : money(m.cost.perWin, m.cost.estimated)) + '</td><td>' + money(m.cost.total, m.cost.estimated) + '</td>' +
      '<td>' + m.tokens.input.toLocaleString() + '</td><td>' + Math.round(100 * m.tokens.cacheRead / Math.max(1, m.tokens.input)) + '%</td><td>' + m.tokens.output.toLocaleString() + '</td></tr>').join('') + '</tbody>';
}

function winter() {
  const list = o => Object.entries(o).map(([k, n]) => esc(k) + ' ' + n).join(', ') || '<span class="na">—</span>';
  document.getElementById('winter').innerHTML =
    '<thead><tr><th>Model</th><th>Survived</th><th>Hale</th><th>Worn</th><th>Broken</th><th>Died (median day)</th><th>Causes of death</th><th>Hard nights / run</th></tr></thead><tbody>' +
    models.map(m => { const v = m.survival; return '<tr><td><span style="display:inline-flex;vertical-align:-1px;margin-right:6px">' + sw(m) + '</span>' + esc(m.model) + '</td>' +
      '<td class="' + (v.rate >= 0.8 ? 'good' : v.rate < 0.5 ? 'bad' : '') + '">' + Math.round(v.rate * 100) + '%</td>' +
      '<td>' + v.grades.hale + '</td><td>' + v.grades.worn + '</td><td>' + v.grades.broken + '</td>' +
      '<td>' + (v.deathDay ?? '<span class="na">—</span>') + '</td><td>' + list(v.deaths) + '</td><td>' + list(v.nights) + '</td></tr>'; }).join('') + '</tbody>';
}

// Four gridline steps on a "nice" scale: whole-number steps (1, 2, 5 × 10ⁿ) so counts never get 0.3 ticks.
function scale(vmax, pct) {
  if (pct) return { max: 100, step: 25 };
  const raw = Math.max(1, vmax) / 4, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p;
  const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p);
  return { max: Math.ceil(Math.max(1, vmax) / step) * step, step };
}

const W = 340, H = 190, L = 34, R = 8, T = 10, B = 24;
const tableOpen = new Set();
function charts() {
  const host = document.getElementById('charts');
  const shown = models.filter(m => !hidden.has(m.model));
  host.innerHTML = Object.entries(D.metrics).map(([k, meta]) => {
    const days = Math.max(1, ...models.map(m => m.series[k].length - 1));
    const vals = shown.flatMap(m => m.series[k].filter(v => v !== null));
    const { max, step } = scale(Math.max(0, ...vals), meta.unit === '%');
    const x = d => L + (W - L - R) * d / days, y = v => T + (H - T - B) * (1 - v / max);
    const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
    const xt = Array.from({ length: days + 1 }, (_, d) => d).filter(d => days <= 12 || d % 2 === 0);
    const lines = shown.map(m => {
      const pts = m.series[k].map((v, d) => v === null ? null : x(d).toFixed(1) + ',' + y(v).toFixed(1)).filter(Boolean);
      return '<polyline class="line" style="stroke:' + m.c + (m.dash ? ';stroke-dasharray:' + m.dash : '') + '" points="' + pts.join(' ') + '"/>';
    }).join('');
    const svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(meta.label) + ' by day, per model" data-k="' + k + '" data-days="' + days + '" data-max="' + max + '">' +
      ticks.map(t => '<line class="gridline" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t) + '" y2="' + y(t) + '"/><text x="' + (L - 6) + '" y="' + (y(t) + 3) + '" text-anchor="end">' + fmt(t) + meta.unit + '</text>').join('') +
      '<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>' +
      xt.map(d => '<text x="' + x(d) + '" y="' + (H - 8) + '" text-anchor="middle">' + d + '</text>').join('') +
      lines + '<g class="hover"></g><rect x="' + L + '" y="0" width="' + (W - L - R) + '" height="' + (H - B) + '" fill="transparent" class="hit"/></svg>';
    const table = tableOpen.has(k) ? '<div class="mtable scroll"><table><thead><tr><th>Model</th>' + Array.from({ length: days + 1 }, (_, d) => '<th>D' + d + '</th>').join('') + '</tr></thead><tbody>' +
      shown.map(m => '<tr><td>' + esc(short(m)) + '</td>' + m.series[k].map(v => '<td>' + fmt(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : '';
    return '<div class="card"><h3>' + esc(meta.label) + '<button class="tv" data-tv="' + k + '" aria-pressed="' + tableOpen.has(k) + '">' + (tableOpen.has(k) ? 'Chart only' : 'Table') + '</button></h3>' + svg + table + '</div>';
  }).join('');
}

document.getElementById('charts').addEventListener('click', e => {
  const b = e.target.closest('[data-tv]'); if (!b) return;
  const k = b.dataset.tv; if (tableOpen.has(k)) tableOpen.delete(k); else tableOpen.add(k); charts();
});

// Crosshair + tooltip: snap to the nearest day, list every visible model's value there.
const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true;
function hover(e) {
  const svg = e.target.closest('svg[data-k]'); if (!svg) { tip.hidden = true; return; }
  const k = svg.dataset.k, days = +svg.dataset.days, max = +svg.dataset.max;
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  const d = Math.max(0, Math.min(days, Math.round((p.x - L) / (W - L - R) * days)));
  const x = L + (W - L - R) * d / days, y = v => T + (H - T - B) * (1 - v / max);
  const rows = models.filter(m => !hidden.has(m.model) && m.series[k][d] !== null && m.series[k][d] !== undefined).sort((a, b) => b.series[k][d] - a.series[k][d]);
  svg.querySelector('.hover').innerHTML = '<line class="xhair" x1="' + x + '" x2="' + x + '" y1="' + T + '" y2="' + (H - B) + '"/>' +
    rows.map(m => '<circle class="dot" r="4.5" cx="' + x + '" cy="' + y(m.series[k][d]) + '" style="fill:' + m.c + '"/>').join('');
  const card = svg.closest('.card'); card.appendChild(tip);
  tip.innerHTML = '<b>' + (d === 0 ? 'Start' : 'End of day ' + d) + '</b>' + (rows.length ? rows.map(m => '<div>' + sw(m) + '<span class="nm">' + esc(short(m)) + '</span><span class="vl">' + fmt(m.series[k][d]) + D.metrics[k].unit + '</span></div>').join('') : '<div>no runs this long</div>');
  tip.hidden = false;
  const cr = card.getBoundingClientRect(), left = e.clientX - cr.left;
  tip.style.top = '36px';
  tip.style.left = (left > cr.width / 2 ? left - tip.offsetWidth - 14 : left + 14) + 'px';
}
function unhover(e) { const svg = e.target.closest && e.target.closest('svg[data-k]'); if (svg) svg.querySelector('.hover').innerHTML = ''; tip.hidden = true; }
document.getElementById('charts').addEventListener('pointermove', hover);
document.getElementById('charts').addEventListener('pointerleave', unhover, true);

function events() {
  const keys = Object.keys(D.events);
  document.getElementById('events').innerHTML = '<thead><tr><th>Model</th>' + keys.map(k => '<th>' + esc(D.events[k]) + '</th>').join('') + '</tr></thead><tbody>' +
    models.map(m => '<tr><td>' + esc(short(m)) + '</td>' + keys.map(k => { const e = m.events[k];
      return '<td>' + (e.day === null ? '<span class="na">—</span>' : e.day + (e.runs < m.runs ? ' <span class="na">' + e.runs + '/' + m.runs + '</span>' : '')) + '</td>'; }).join('') + '</tr>').join('') + '</tbody>';
}

function actions() {
  const totals = {};
  models.forEach(m => Object.entries(m.actions).forEach(([a, n]) => totals[a] = (totals[a] || 0) + n));
  const keys = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  document.getElementById('actions').innerHTML = '<thead><tr><th>Model</th>' + keys.map(k => '<th>' + esc(k) + '</th>').join('') + '</tr></thead><tbody>' +
    models.map(m => '<tr><td>' + esc(short(m)) + '</td>' + keys.map(k => '<td>' + (m.actions[k] ? fmt(m.actions[k]) : '<span class="na">·</span>') + '</td>').join('') + '</tr>').join('') + '</tbody>';
}

legend(); outcomes(); winter(); charts(); events(); actions();
</script>
`;
}
