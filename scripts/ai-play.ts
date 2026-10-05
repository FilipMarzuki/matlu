/**
 * Let an AI play the Artificer (#1226).
 *
 *   npm run ai:play -- --player claude      [--model claude-opus-5-5] [--effort medium]
 *   npm run ai:play -- --player openrouter  [--model google/gemini-2.5-pro]
 *   npm run ai:play -- --player scripted                (no API key needed)
 *   npm run ai:play -- --player random --mode legal|uniform --runs 200 [--seed 1]   (baselines, no API key)
 *   options: --runs N (default 1) --max-days N (default 16) --carry (each run keeps the last run's knowledge)
 *            --out DIR (default ai-runs) --quiet
 *
 * Writes one JSON transcript per run to --out and prints a summary table.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { playRun, type Player, type RunResult } from '../src/artificer-ai/runner';
import { scriptedPlayer } from '../src/artificer-ai/players/scripted';
import { claudePlayer, type Effort } from '../src/artificer-ai/players/claude';
import { openRouterPlayer } from '../src/artificer-ai/players/openrouter';
import { randomPlayer, type RandomMode } from '../src/artificer-ai/players/random';
import { legacyOf } from '../src/artificer/legacy';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (name: string): boolean => args.includes(`--${name}`);

const which = flag('player') ?? 'scripted';
const runs = Number(flag('runs') ?? 1);
const maxDays = Number(flag('max-days') ?? 16);
const out = flag('out') ?? 'ai-runs';
const quiet = has('quiet');

const seed = Number(flag('seed') ?? 1);

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
  let carry: RunResult | undefined;
  for (let n = 1; n <= runs; n++) {
    const player = makePlayer(n); // fresh conversation per run
    if (!quiet) console.log(`\n▶ Run ${n}/${runs} — ${player.name}`);
    let result: RunResult;
    try {
      result = await playRun(player, {
      maxDays,
      legacy: has('carry') && carry ? legacyOf(carry.final) : undefined,
      onTurn: t => {
        if (quiet) return;
        const head = t.exit ? `EXIT → ${t.exit}` : t.invalid ? `invalid reply — day passed (${t.errors?.[0] ?? 'no reply'})` : queueText(t.queue);
        console.log(`  D${String(t.day).padStart(2)} ${head}${t.site ? `  [camp: ${t.site}]` : ''}`);
        if (t.thoughts) console.log(`      “${t.thoughts}”`);
        if (t.violations) console.log(`      ⚠ invariants: ${t.violations.join('; ')}`);
        console.log(`      vigor ${t.after.vigor} · clarity ${t.after.clarity} · cond ${t.after.condition} · food ${t.after.food} · water ${t.after.water} · fuel ${t.after.firewood} · rations ${t.after.rations} · warmth ${Math.round(t.after.warmth * 100)}%`);
      },
      });
    } catch (err) {
      // A crash is a sim bug worth seeing, not a reason to lose the rest of a batch.
      crashes.push(`run ${n} (${player.name}): ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      continue;
    }
    for (const t of result.turns) if (t.violations) violations.push(`run ${n} day ${t.day}: ${t.violations.join('; ')}`);
    carry = result;
    results.push(result);
    const file = join(out, `${new Date().toISOString().replace(/[:.]/g, '-')}-${which}${which === 'random' ? `-${flag('mode') ?? 'legal'}` : ''}-run${n}.json`);
    const { final: _final, ...saved } = result;
    writeFileSync(file, JSON.stringify(saved, null, 2));
    if (!quiet) console.log(`  → ${result.record.kind} (${result.record.choice}) on day ${result.record.day}${result.record.readyDay ? `, winter-ready day ${result.record.readyDay}` : ', never winter-ready'}${result.forced ? ' [day cap]' : ''} · transcript ${file}`);
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
    console.log(`  run ${i + 1}: ${r.record.kind.padEnd(10)} day ${String(r.record.day).padStart(2)} · ready ${r.record.readyDay ?? '—'} · invalid days ${r.turns.filter(t => t.invalid).length} · tokens in ${u.input} (cache read ${u.cacheRead}, write ${u.cacheWrite}) out ${u.output}`);
  }
  if (crashes.length) { console.log(`\nCRASHES (${crashes.length}):`); for (const c of crashes) console.log(`  ${c}`); }
  if (violations.length) { console.log(`\nINVARIANT VIOLATIONS (${violations.length}):`); for (const v of violations.slice(0, 40)) console.log(`  ${v}`); }
  if (crashes.length || violations.length) process.exitCode = 1;
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
