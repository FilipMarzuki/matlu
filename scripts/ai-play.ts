/**
 * Let an AI play the Artificer (#1226).
 *
 *   npm run ai:play -- --player claude      [--model claude-opus-5-5] [--effort medium]
 *   npm run ai:play -- --player openrouter  [--model google/gemini-2.5-pro]
 *   npm run ai:play -- --player scripted                (no API key needed)
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
import { legacyOf } from '../src/artificer/legacy';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (name: string): boolean => args.includes(`--${name}`);

const which = flag('player') ?? 'scripted';
const runs = Number(flag('runs') ?? 1);
const maxDays = Number(flag('max-days') ?? 16);
const out = flag('out') ?? 'ai-runs';
const quiet = has('quiet');

function makePlayer(): Player {
  if (which === 'claude') return claudePlayer({ model: flag('model'), effort: flag('effort') as Effort | undefined });
  if (which === 'openrouter') return openRouterPlayer({ model: flag('model'), schema: !has('no-schema') });
  if (which === 'scripted') return scriptedPlayer();
  throw new Error(`unknown --player ${which} (claude | openrouter | scripted)`);
}

const queueText = (q: RunResult['turns'][number]['queue']): string =>
  q.map(i => (typeof i === 'string' ? i : `${i.q}{${Object.entries(i.opts).map(([k, v]) => `${k}=${v}`).join(',')}}`)).join(', ') || '—';

async function main(): Promise<void> {
  mkdirSync(out, { recursive: true });
  const results: RunResult[] = [];
  let carry: RunResult | undefined;
  for (let n = 1; n <= runs; n++) {
    const player = makePlayer(); // fresh conversation per run
    console.log(`\n▶ Run ${n}/${runs} — ${player.name}`);
    const result = await playRun(player, {
      maxDays,
      legacy: has('carry') && carry ? legacyOf(carry.final) : undefined,
      onTurn: t => {
        if (quiet) return;
        const head = t.exit ? `EXIT → ${t.exit}` : t.invalid ? `invalid reply — day passed (${t.errors?.[0] ?? 'no reply'})` : queueText(t.queue);
        console.log(`  D${String(t.day).padStart(2)} ${head}${t.site ? `  [camp: ${t.site}]` : ''}`);
        if (t.thoughts) console.log(`      “${t.thoughts}”`);
        console.log(`      vigor ${t.after.vigor} · clarity ${t.after.clarity} · cond ${t.after.condition} · food ${t.after.food} · water ${t.after.water} · fuel ${t.after.firewood} · rations ${t.after.rations} · warmth ${Math.round(t.after.warmth * 100)}%`);
      },
    });
    carry = result;
    results.push(result);
    const file = join(out, `${new Date().toISOString().replace(/[:.]/g, '-')}-${which}-run${n}.json`);
    const { final: _final, ...saved } = result;
    writeFileSync(file, JSON.stringify(saved, null, 2));
    console.log(`  → ${result.record.kind} (${result.record.choice}) on day ${result.record.day}${result.record.readyDay ? `, winter-ready day ${result.record.readyDay}` : ', never winter-ready'}${result.forced ? ' [day cap]' : ''} · transcript ${file}`);
  }

  console.log('\nSUMMARY');
  for (const [i, r] of results.entries()) {
    const u = r.usage;
    console.log(`  run ${i + 1}: ${r.record.kind.padEnd(10)} day ${String(r.record.day).padStart(2)} · ready ${r.record.readyDay ?? '—'} · invalid days ${r.turns.filter(t => t.invalid).length} · tokens in ${u.input} (cache read ${u.cacheRead}, write ${u.cacheWrite}) out ${u.output}`);
  }
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
