/**
 * Play the whole model roster (src/artificer-ai/roster.ts) in one go (#1231).
 *
 *   npm run ai:bench                         # every roster model, 1 game each
 *   npm run ai:bench -- --runs 2 --budget 1  # 2 games each, stop at $1 spent
 *   npm run ai:bench -- --skip deepseek      # leave out models matching a substring (comma-separated)
 *   npm run ai:bench -- --only haiku,llama   # just these
 *   npm run ai:bench -- --dry                # print the plan and estimate, play nothing
 *
 * Models play in parallel (each model's own games run one after another), so
 * the slowest model sets the wall-clock time. Spend is shared: once actual cost
 * reaches --budget, no new game starts. Transcripts go to ai-runs/bench-<time>/,
 * then: npm run ai:report -- --in <that dir>
 */

import { playtimeOf, playtimeText } from '../src/artificer-ai/playtime';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { playRun, BudgetExceeded, type RunResult, type SpendLedger } from '../src/artificer-ai/runner';
import { openRouterPlayer } from '../src/artificer-ai/players/openrouter';
import { ROSTER, DROPPED, perYear, budgetAdvice } from '../src/artificer-ai/roster';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const list = (name: string): string[] => (flag(name) ?? '').split(',').map(x => x.trim()).filter(Boolean);

const runs = Number(flag('runs') ?? 1);
const budget = flag('budget') !== undefined ? Number(flag('budget')) : Infinity;
const only = list('only'), skip = list('skip');
const roster = ROSTER.filter(r => (!only.length || only.some(o => r.model.includes(o))) && !skip.some(x => r.model.includes(x)));
const out = flag('out') ?? join('ai-runs', `bench-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);

// A game is the whole year now (#1309): ~60 turns, scaled from the ~10-day measurements.
const estimate = roster.reduce((n, r) => n + perYear(r) * runs, 0);
console.log(`Roster: ${roster.length} models × ${runs} game${runs === 1 ? '' : 's'} — estimated $${estimate.toFixed(2)}${Number.isFinite(budget) ? `, budget $${budget}` : ''}`);
for (const r of roster) console.log(`  ${r.model.padEnd(32)} ~$${perYear(r).toFixed(3)}/game  ${r.note}`);
console.log(budgetAdvice(roster, runs, budget));
console.log(`Dropped: ${DROPPED.map(d => d.model.split('/').pop()).join(', ')}`);
if (args.includes('--dry')) process.exit(0);
if (!roster.length) { console.error('No models left after --only/--skip.'); process.exit(1); }

// One ledger for every game, all models at once (#1449): checked before each model call.
const ledger: SpendLedger = { spent: 0, budget };
const results: { model: string; r: RunResult }[] = [];
const failures: string[] = [];

async function playModel(model: string): Promise<void> {
  for (let n = 1; n <= runs; n++) {
    if (ledger.spent >= ledger.budget) { console.log(`  ${model}: budget reached, skipping game ${n}`); return; }
    try {
      const r = await playRun(openRouterPlayer({ model }), { ledger });
      results.push({ model, r });
      const { final: _final, ...saved } = r;
      writeFileSync(join(out, `${model.replace('/', '_')}-run${n}.json`), JSON.stringify(saved, null, 2));
      console.log(`  ${model.padEnd(32)} game ${n}: ${r.record.kind.padEnd(8)} ready ${r.record.readyDay ?? '—'} · ${r.usage.cost === null ? 'cost ?' : `$${r.usage.cost.toFixed(3)}`} · total $${ledger.spent.toFixed(3)} · a person: ${playtimeText(playtimeOf(r))}`);
    } catch (err) {
      if (err instanceof BudgetExceeded) {
        writeFileSync(join(out, `${model.replace('/', '_')}-run${n}-stopped.json`), JSON.stringify(err.partial, null, 2));
        console.log(`  ${model.padEnd(32)} game ${n}: stopped mid-run (budget) on day ${err.partial.record.day} · total $${ledger.spent.toFixed(3)}`);
        return;
      }
      failures.push(`${model} game ${n}: ${err instanceof Error ? err.message : String(err)}`);
      return; // a model that errors (rate limit, outage) stops; the others carry on
    }
  }
}

mkdirSync(out, { recursive: true });
const started = Date.now();
await Promise.all(roster.map(r => playModel(r.model)));

console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s · ${results.length} games · spent $${ledger.spent.toFixed(3)} (estimate was $${estimate.toFixed(2)})`);
if (failures.length) { console.log('Failures:'); for (const f of failures) console.log(`  ${f}`); }
console.log(`Report: npm run ai:report -- --in ${out} --out ${join(out, 'report.html')}`);
