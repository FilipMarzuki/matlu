/**
 * Play the whole model roster (src/artificer-ai/roster.ts) in one go (#1231).
 *
 *   npm run ai:bench                         # every roster model, 1 game each
 *   npm run ai:bench -- --runs 2 --budget 1  # 2 games each, stop at $1 spent
 *   npm run ai:bench -- --skip deepseek      # leave out models matching a substring (comma-separated)
 *   npm run ai:bench -- --only haiku,llama   # just these
 *   npm run ai:bench -- --dry                # print the plan and estimate, play nothing
 *
 * Keys: OPENROUTER_API_KEY plays the roster. With ANTHROPIC_API_KEY set too, Claude entries
 * (those with a `claude` model) play directly on that key until its credit runs out, then go
 * through OpenRouter (#1506). Either key alone plays what it can, and skips the rest.
 *
 * Models play in parallel (each model's own games run one after another), so
 * the slowest model sets the wall-clock time. Spend is shared: once actual cost
 * reaches --budget, no new game starts. Transcripts go to ai-runs/bench-<time>/,
 * then: npm run ai:report -- --in <that dir>
 */

import { playtimeOf, playtimeText } from '../src/artificer-ai/playtime';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { playRun, BudgetExceeded, committed, fillTally, type RunResult, type SpendLedger } from '../src/artificer-ai/runner';
import { openRouterPlayer } from '../src/artificer-ai/players/openrouter';
import { claudePlayer } from '../src/artificer-ai/players/claude';
import { withFallback } from '../src/artificer-ai/players/fallback';
import type { Player } from '../src/artificer-ai/runner';
import type { RosterEntry } from '../src/artificer-ai/roster';
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
// Which Claude entries play on the Anthropic key (#1506), and so cost its credit, not OpenRouter's.
const onKey = process.env.ANTHROPIC_API_KEY ? roster.filter(r => r.claude) : [];
if (onKey.length) console.log(`On the Anthropic key while it has credit: ${onKey.map(r => r.claude).join(', ')} (then through OpenRouter)`);
if (args.includes('--dry')) process.exit(0);
if (!roster.length) { console.error('No models left after --only/--skip.'); process.exit(1); }

// One ledger for every game, all models at once (#1449): checked before each model call.
const ledger: SpendLedger = { spent: 0, budget };
const results: { model: string; r: RunResult }[] = [];
const failures: string[] = [];

// The keys we have (#1506): Claude entries play on the Anthropic key while it has credit.
const hasClaude = !!process.env.ANTHROPIC_API_KEY;
const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
/** Set once the Anthropic key runs out of credit: every Claude game after that goes through OpenRouter. */
let claudeOut = false;

/** Who plays this entry's next game, under what name, or why it can't. */
function playerFor(entry: RosterEntry): { player: Player; label: string } | { skip: string } {
  if (hasClaude && entry.claude && !claudeOut) {
    const direct = claudePlayer({ model: entry.claude });
    if (!hasOpenRouter) return { player: direct, label: entry.claude };
    const player = withFallback(direct, openRouterPlayer({ model: entry.model }), why => {
      claudeOut = true;
      console.log(`  ${entry.claude}: the Anthropic key is out of credit (${why.slice(0, 120)}); carrying on through OpenRouter as ${entry.model}`);
    });
    return { player, label: entry.claude };
  }
  if (!hasOpenRouter) return { skip: hasClaude && entry.claude ? 'the Anthropic key is out of credit, and there is no OpenRouter key' : 'no OpenRouter key' };
  return { player: openRouterPlayer({ model: entry.model }), label: entry.model };
}

async function playModel(entry: RosterEntry): Promise<void> {
  for (let n = 1; n <= runs; n++) {
    const who = playerFor(entry);
    if ('skip' in who) { console.log(`  ${entry.model}: skipped — ${who.skip}`); return; }
    const model = who.label;
    // Calls other games have in flight count too (#1491).
    if (committed(ledger) >= ledger.budget) { console.log(`  ${model}: budget reached, skipping game ${n}`); return; }
    try {
      const r = await playRun(who.player, { ledger, fillDay: true });
      results.push({ model, r });
      const { final: _final, ...saved } = r;
      writeFileSync(join(out, `${model.replace('/', '_')}-run${n}.json`), JSON.stringify(saved, null, 2));
      const fills = fillTally(r.turns); // short days asked about, and filled (#1473)
      console.log(`  ${model.padEnd(32)} game ${n}: ${r.record.kind.padEnd(8)} ready ${r.record.readyDay ?? '—'} · ${r.usage.cost === null ? 'cost ?' : `$${r.usage.cost.toFixed(3)}`} · total $${ledger.spent.toFixed(3)} · a person: ${playtimeText(playtimeOf(r))} · short days filled ${fills.filled}/${fills.asked}`);
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
await Promise.all(roster.map(r => playModel(r)));

console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s · ${results.length} games · spent $${ledger.spent.toFixed(3)} (estimate was $${estimate.toFixed(2)})`);
if (failures.length) { console.log('Failures:'); for (const f of failures) console.log(`  ${f}`); }
console.log(`Report: npm run ai:report -- --in ${out} --out ${join(out, 'report.html')}`);
