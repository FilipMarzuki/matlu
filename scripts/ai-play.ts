/**
 * Let an AI play the Artificer (#1226).
 *
 *   npm run ai:play -- --player claude      [--model claude-opus-5-5] [--effort medium]
 *   npm run ai:play -- --player openrouter  [--model anthropic/claude-haiku-4.5]
 *   npm run ai:play -- --player scripted                (no API key needed)
 *   npm run ai:play -- --player random --mode legal|uniform --runs 200 [--seed 1]   (baselines, no API key)
 *   options: --runs N (default 1) --carry (each run starts with the last run's tools, #1455)
 *            --road (a run that survives the thaw rides the caravan road to Mistheim, #1251)
 *            --out DIR (default ai-runs) --quiet
 *            --talents hardy,forager (two of: hardy sharp lightEater carefulHands quickLearner coldBlooded tough keenEye forager hunter waterfinder silverTongue)
 *            --stats str=13,int=13 | balanced | strong | clever  (the point-buy spread, as a person would pick; default all 10s;
 *                     the random baseline picks a random legal spread per run unless this is given)
 *            --budget USD (no model call starts once actual spend has reached this, so a long run stops
 *                          mid-game, saved as "stopped (budget)"; OpenRouter reports real cost)
 *
 * Writes one JSON transcript per run to --out and prints a summary table.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { playRun, aiCharacterId, BudgetExceeded, type Player, type RunResult, type SpendLedger } from '../src/artificer-ai/runner';
import { scriptedPlayer } from '../src/artificer-ai/players/scripted';
import { claudePlayer, type Effort } from '../src/artificer-ai/players/claude';
import { openRouterPlayer } from '../src/artificer-ai/players/openrouter';
import { randomPlayer, type RandomMode } from '../src/artificer-ai/players/random';
import { heirloomsOf } from '../src/artificer/legacy';
import { parseStatSpread, randomSpread, spreadText } from '../src/artificer-ai/spreads';
import { validPick, TALENT_PICKS, TALENT_IDS, talentOffer, seedOf, pickRandomFromOffer, type TalentId } from '../src/artificer/talents';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (name: string): boolean => args.includes(`--${name}`);

const which = flag('player') ?? 'scripted';
const runs = Number(flag('runs') ?? 1);
const out = flag('out') ?? 'ai-runs';
const quiet = has('quiet');

const seed = Number(flag('seed') ?? 1);
const talents = (flag('talents') ?? '').split(',').map(t => t.trim()).filter(Boolean);
if (!validPick(talents)) { console.error(`--talents needs exactly ${TALENT_PICKS} of: ${TALENT_IDS.join(', ')}`); process.exit(1); }
// The stat spread (#1259): checked exactly like a person's point-buy, so an AI can't start stronger.
const statsArg = flag('stats');
const parsedStats = statsArg !== undefined ? parseStatSpread(statsArg) : null;
if (parsedStats && 'error' in parsedStats) { console.error(`--stats: ${parsedStats.error}`); process.exit(1); }
const budget = flag('budget') !== undefined ? Number(flag('budget')) : Infinity;
const usd = (x: number | null): string => (x === null ? 'cost unknown' : `$${x < 0.01 && x > 0 ? x.toFixed(4) : x.toFixed(3)}`);

function makePlayer(n: number): Player {
  if (which === 'claude') return claudePlayer({ model: flag('model'), effort: flag('effort') as Effort | undefined });
  if (which === 'openrouter') return openRouterPlayer({ model: flag('model'), schema: !has('no-schema') });
  if (which === 'scripted') return scriptedPlayer();
  // Each run gets its own seed, so a batch is varied but repeats exactly.
  if (which === 'random') return randomPlayer({ mode: (flag('mode') ?? 'legal') as RandomMode, seed: seed + n - 1 });
  throw new Error(`unknown --player ${which} (claude | openrouter | scripted | random)`);
}

const queueText = (q: RunResult['turns'][number]['queue']): string =>
  q.map(i => (typeof i === 'string' ? i : `${i.q}{${Object.entries(i.opts).map(([k, v]) => `${k}=${v}`).join(',')}}`)).join(', ') || '—';

async function main(): Promise<void> {
  mkdirSync(out, { recursive: true });
  const results: RunResult[] = [];
  const crashes: string[] = [];
  const violations: string[] = [];
  let spent = 0;
  const ledger: SpendLedger = { spent: 0, budget };
  if (Number.isFinite(budget) && which === 'claude') console.log('⚠ --budget: the Claude player reports no cost, so the budget is not enforced for it.');
  let carry: RunResult | undefined;
  for (let n = 1; n <= runs; n++) {
    const player = makePlayer(n); // fresh conversation per run
    if (!quiet) console.log(`\n▶ Run ${n}/${runs} — ${player.name}`);
    // Each run is its own Warden (#1267, #1455). With --carry, the new one starts with the last
    // one's heirlooms: the tools it ended with, wherever it ended (#1251: the road, if it rode).
    const lastEnd = carry?.road?.final ?? carry?.final;
    const characterId = aiCharacterId(player.name, `s${seed}-r${n}`);
    // The random baseline picks a random pair from its offer (seeded); others ask for --talents, else take the first two.
    const wanted = which === 'random' && !talents.length ? pickRandomFromOffer(talentOffer(seedOf(characterId)), seed + n - 1) : talents as TalentId[];
    if (!quiet) {
      const offer = talentOffer(seedOf(characterId));
      if (talents.length && !talents.every(t => offer.includes(t as TalentId))) console.log(`  (--talents ${talents.join(',')} not both offered — offer was ${offer.join(', ')}; taking the first two)`);
    }
    let result: RunResult;
    try {
      result = await playRun(player, {
      // Same rule as the game (#1455): the items pass on, the mind doesn't.
      legacy: has('carry') && lastEnd ? heirloomsOf(lastEnd) : undefined,
      characterId,
      talents: wanted,
      // One ledger for the whole batch (#1449): the runner checks it before every model call.
      ...(Number.isFinite(budget) ? { ledger } : {}),
      // A spread given with --stats; else the random baseline rolls one per run (seeded), and others keep all 10s.
      stats: parsedStats?.stats ?? (which === 'random' ? randomSpread(seed + n - 1) : undefined),
      road: has('road'),
      onRoadTurn: t => {
        if (quiet) return;
        console.log(`  R${String(t.day).padStart(2)} ${t.invalid ? `invalid reply — day passed (${t.errors?.[0] ?? 'no reply'})` : t.actions.join(', ') || '—'}`);
        if (t.thoughts) console.log(`      “${t.thoughts}”`);
        if (t.violations) console.log(`      ⚠ invariants: ${t.violations.join('; ')}`);
        console.log(`      marks ${t.progress.marks} · trust ${t.progress.totalTrust} · quests ${t.progress.questsDone} · cond ${t.progress.vitals.condition} · food ${t.progress.stores.rawFood}`);
      },
      onTurn: t => {
        if (quiet) return;
        const head = t.invalid ? `invalid reply — day passed (${t.errors?.[0] ?? 'no reply'})` : queueText(t.queue);
        console.log(`  D${String(t.day).padStart(2)} ${head}${t.site ? `  [camp: ${t.site}]` : ''}`);
        if (t.thoughts) console.log(`      “${t.thoughts}”`);
        if (t.violations) console.log(`      ⚠ invariants: ${t.violations.join('; ')}`);
        console.log(`      vigor ${t.after.vigor} · clarity ${t.after.clarity} · cond ${t.after.condition} · food ${t.after.food} · water ${t.after.water} · fuel ${t.after.firewood} · rations ${t.after.rations} · warmth ${Math.round(t.after.warmth * 100)}%`);
      },
      });
    } catch (err) {
      // Out of budget mid-run (#1449): keep what was played, marked as stopped, and end the batch.
      if (err instanceof BudgetExceeded) {
        spent += err.partial.usage.cost ?? 0;
        // A run stopped before its first call has nothing worth keeping.
        const file = err.partial.turns.length ? join(out, `${new Date().toISOString().replace(/[:.]/g, '-')}-${which}-run${n}-stopped.json`) : null;
        if (file) writeFileSync(file, JSON.stringify(err.partial, null, 2));
        console.log(`\n■ Budget $${budget} reached ($${spent.toFixed(3)} spent) — run ${n} stopped on day ${err.partial.record.day}${file ? `; partial transcript ${file}` : ''}`);
        break;
      }
      // A crash is a sim bug worth seeing, not a reason to lose the rest of a batch.
      crashes.push(`run ${n} (${player.name}): ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      continue;
    }
    spent += result.usage.cost ?? 0;
    for (const t of result.turns) if (t.violations) violations.push(`run ${n} day ${t.day}: ${t.violations.join('; ')}`);
    for (const t of result.road?.turns ?? []) if (t.violations) violations.push(`run ${n} road day ${t.day}: ${t.violations.join('; ')}`);
    carry = result;
    results.push(result);
    const file = join(out, `${new Date().toISOString().replace(/[:.]/g, '-')}-${which}${which === 'random' ? `-${flag('mode') ?? 'legal'}` : ''}-run${n}.json`);
    const { final: _final, road, ...rest } = result;
    const saved = road ? { ...rest, road: { turns: road.turns, start: road.start, record: road.record } } : rest;
    writeFileSync(file, JSON.stringify(saved, null, 2));
    if (!quiet && result.roadStopped) console.log('  → road: not played — budget reached at the thaw');
    if (!quiet && road) console.log(`  → road: ${road.record.kind} · ${road.record.road?.villages.length ?? 0} villages · ${road.record.road?.quests ?? 0} quests · ${road.record.road?.marks ?? 0} marks`);
    if (!quiet && result.spread) console.log(`  → stats: made ${spreadText(result.spread)} · started ${spreadText(result.start.stats ?? result.spread)} · ended ${spreadText(result.road?.turns.at(-1)?.progress.stats ?? result.turns.at(-1)?.progress.stats ?? result.spread)}`);
    if (!quiet) console.log(`  → ${result.record.kind} (${result.record.choice}) on day ${result.record.day}${result.record.grade ? ` (${result.record.grade})` : ''}${result.record.readyDay ? `, winter-ready day ${result.record.readyDay}` : ', never winter-ready'} · ${usd(result.usage.cost)} · transcript ${file}`);
    if (spent >= budget && n < runs) { console.log(`\n■ Budget $${budget} reached ($${spent.toFixed(3)} spent) — stopping after run ${n}/${runs}.`); break; }
  }

  console.log('\nSUMMARY');
  if (results.length > 12) {
    // Big batches (random baselines): a distribution, not a line per run.
    const kinds: Record<string, number> = {};
    for (const r of results) kinds[r.record.kind] = (kinds[r.record.kind] ?? 0) + 1;
    const ready = results.filter(r => r.record.readyDay !== null);
    console.log(`  ${results.length} runs: ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${Math.round(100 * n / results.length)}%`).join(' · ')}`);
    console.log(`  winter-ready in ${ready.length}/${results.length}${ready.length ? `, mean day ${(ready.reduce((n, r) => n + r.record.readyDay!, 0) / ready.length).toFixed(1)}` : ''}`);
  } else for (const [i, r] of results.entries()) {
    const u = r.usage;
    console.log(`  run ${i + 1}: ${r.record.kind.padEnd(10)} day ${String(r.record.day).padStart(2)} · ready ${r.record.readyDay ?? '—'} · invalid days ${r.turns.filter(t => t.invalid).length} · tokens in ${u.input} (cache read ${u.cacheRead}, write ${u.cacheWrite}) out ${u.output} · ${usd(u.cost)}`);
  }
  const known = results.filter(r => r.usage.cost !== null);
  if (known.length) console.log(`  spend: $${spent.toFixed(3)} total · $${(spent / known.length).toFixed(3)} per game${known.length < results.length ? ` (${results.length - known.length} run(s) didn't report cost)` : ''}`);
  if (crashes.length) { console.log(`\nCRASHES (${crashes.length}):`); for (const c of crashes) console.log(`  ${c}`); }
  if (violations.length) { console.log(`\nINVARIANT VIOLATIONS (${violations.length}):`); for (const v of violations.slice(0, 40)) console.log(`  ${v}`); }
  if (crashes.length || violations.length) process.exitCode = 1;
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
