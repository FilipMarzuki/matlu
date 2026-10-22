/**
 * What kills the baselines, and when (#1852): play the scripted and random players over a batch of
 * seeds with a given set of rule features, and record for each run how it ended (the thaw, or the
 * day and cause of death) and the hard nights along the way. No API: the baselines are local and
 * seeded, so a table repeats exactly.
 *
 * The cause is read from the run's last journal lines (report.ts `deathCause`). A collapse has no
 * single cause in the sim (Condition simply ran out), so each run also counts the nights it went
 * hungry, thirsty and cold: what wore it down.
 */

import { ruleFeatures, type FeatureSwitches } from '../artificer/features';
import { aiCharacterId, playRun, type Player } from './runner';
import { deathCause } from './report';
import { scriptedPlayer } from './players/scripted';
import { randomPlayer } from './players/random';

export interface DeathRow {
  player: string;
  seed: number;
  /** `survived` at the thaw, else how it ended. */
  kind: string;
  /** The day the run ended. */
  day: number;
  /** For a death: what killed it (`deathCause`); `thaw` for a run that made it. */
  cause: string;
  hungry: number;
  thirsty: number;
  cold: number;
}

/** Nights of each hardship, from the journal (the lines sleepNight and endDay write). */
const NIGHT_LINES = {
  hungry: /^Hungry — no food/,
  thirsty: /^Thirsty — no water/,
  cold: /^A cold, broken night|^Dangerously cold|^The fire is long dead/,
} as const;

/** The two baselines, as the bench makes them: a fresh scripted player, or the legal random one on its own seed. */
export const BASELINES: Readonly<Record<string, (seed: number) => Player>> = {
  scripted: () => scriptedPlayer(),
  random: seed => randomPlayer({ mode: 'legal', seed }),
};

/** Play one baseline over seeds 1..n with these rules. Each seed is its own Warden (a string-keyed character id). */
export async function deathRows(baseline: keyof typeof BASELINES, seeds: number, features: FeatureSwitches = ruleFeatures()): Promise<DeathRow[]> {
  const rows: DeathRow[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const player = BASELINES[baseline](seed);
    const r = await playRun(player, { characterId: aiCharacterId(player.name, `s${seed}-r1`), features });
    // Nights, not lines: a bad night can write two lines of the same hardship.
    const count = (re: RegExp): number => new Set(r.final.log.filter(l => re.test(l.text)).map(l => l.day)).size;
    rows.push({
      player: baseline, seed, kind: r.record.kind, day: r.final.day,
      cause: r.record.kind === 'survived' ? 'thaw' : deathCause(r.turns.at(-1)?.journal ?? []),
      hungry: count(NIGHT_LINES.hungry), thirsty: count(NIGHT_LINES.thirsty), cold: count(NIGHT_LINES.cold),
    });
  }
  return rows;
}

export interface DeathSummary {
  runs: number;
  thaw: number;
  /** Deaths by cause. */
  causes: Record<string, number>;
  /** Median day of death, null when none died. */
  medianDeathDay: number | null;
  /** Mean hard nights per run. */
  hungry: number; thirsty: number; cold: number;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]): number => Math.round((xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)) * 10) / 10;

export function summarize(rows: readonly DeathRow[]): DeathSummary {
  const dead = rows.filter(r => r.kind !== 'survived');
  const causes: Record<string, number> = {};
  for (const r of dead) causes[r.cause] = (causes[r.cause] ?? 0) + 1;
  return {
    runs: rows.length, thaw: rows.length - dead.length, causes, medianDeathDay: median(dead.map(r => r.day)),
    hungry: mean(rows.map(r => r.hungry)), thirsty: mean(rows.map(r => r.thirsty)), cold: mean(rows.map(r => r.cold)),
  };
}

/** One markdown table row for a summary. */
export const summaryRow = (label: string, s: DeathSummary): string =>
  `| ${label} | ${s.thaw}/${s.runs} | ${s.medianDeathDay ?? '–'} | ${Object.entries(s.causes).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ') || '–'} | ${s.hungry} | ${s.thirsty} | ${s.cold} |`;

export const SUMMARY_HEAD = '| Rules | Thaw | Median death day | Deaths by cause | Hungry nights | Thirsty nights | Cold nights |\n|---|---|---|---|---|---|---|';
