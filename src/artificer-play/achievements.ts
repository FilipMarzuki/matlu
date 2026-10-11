/**
 * Achievements (#1559, plan: docs/spikes/artificer-play-api.md): how a finished run compares with
 * everyone else's, as a handful of named marks: "outlasted the median AI", "top 10% larder at
 * midwinter", "reached Mistheim".
 *
 * Most are percentiles over the run records, not fixed targets. A fixed target ("40 rations at
 * midwinter") goes stale as players get better or a game version makes the winter harder; a
 * percentile always means "better than most people and AIs playing this version now". The caller
 * picks who a run is compared with: the records of the same game version, and for a run of the
 * weekly world (weekly.ts) only that week's, so everyone it's compared with played the same world.
 *
 * Pure, and free of game code like records.ts, so the Records page can use it without loading the
 * sim, and the API, the console, the MCP server and the web game all show the same marks.
 */

import { isRanked, percentBeaten, tierOf, type Run } from './records';

/** What a run needs for every achievement: the ranking fields and the few measures they read. */
export type Comparable = Pick<Run, 'playerKind' | 'outcome' | 'stage' | 'endDay' | 'grade' | 'readyDay' | 'milestones' | 'larderMidwinter' | 'skillLevels' | 'surface'> & {
  id?: string; week?: string | null; detail?: { week?: string };
};

/**
 * - `earned`: this run has it.
 * - `missed`: it doesn't (the detail says what it had, or lacked).
 * - `open`: too few runs to compare with yet, so a percentile wouldn't mean anything.
 */
export type AchievementStatus = 'earned' | 'missed' | 'open';

export interface Achievement {
  id: string;
  name: string;
  /** What it takes, in a line. */
  rule: string;
  status: AchievementStatus;
  /** How this run stands: "Further than 64% of 25 AI runs." */
  detail: string;
}

/**
 * Fewer runs than this to compare with and a percentile says nothing: beating the only other run
 * on the board isn't "the top 10%". Until then a percentile achievement is `open`.
 */
export const MIN_RUNS = 5;

/** The cut-offs, as the share of the runs compared with that a run must beat (0–100). */
export const THRESHOLDS = { medianAi: 50, topTenth: 90, larder: 90, readyEarly: 75, skills: 75 };

/**
 * The share (0–100, rounded) of `values` that `mine` beats, ties counting as half: the same rule
 * as records.ts percentBeaten, so a "top 10%" can't be earned by tying with a crowd at zero.
 * `better(a, b)` is positive when a is the better one.
 */
export function shareBeaten<T>(mine: T, values: readonly T[], better: (a: T, b: T) => number): number | null {
  if (!values.length) return null;
  const score = values.reduce((n, v) => { const c = better(mine, v); return n + (c > 0 ? 1 : c === 0 ? 0.5 : 0); }, 0);
  return Math.round((100 * score) / values.length);
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** How a run stands on one achievement. */
type Standing = Pick<Achievement, 'status' | 'detail'>;
const open = (have: number, one: string, many?: string): Standing =>
  ({ status: 'open', detail: `Needs ${plural(MIN_RUNS, one, many)} to compare with; ${have} so far.` });
/** Earned when `share` reaches `cut` (or passes it, when `strictly`). */
const byShare = (share: number, cut: number, detail: string, strictly = false): Standing =>
  ({ status: (strictly ? share > cut : share >= cut) ? 'earned' : 'missed', detail });

/**
 * Every achievement for `run`, compared with `others` (the run itself is left out if it's among
 * them, matched by id). Always the same list in the same order, earned or not, so a page can show
 * what's still to get.
 */
export function achievementsOf(run: Comparable, others: readonly Comparable[]): Achievement[] {
  // Only ranked runs count, on either side (records.ts isRanked): a web run on a world the page
  // picked itself is compared with nobody, and nobody is compared with it.
  if (!isRanked(run)) return unranked();
  const rest = (run.id ? others.filter(o => o.id !== run.id) : [...others]).filter(isRanked);
  const ais = rest.filter(o => o.playerKind === 'ai');
  const enough = rest.length >= MIN_RUNS;

  // 1. Outlasted the median AI: further than half the AIs' runs, by records.ts rankKey. Strictly:
  // tying the median isn't outlasting it.
  const vsAi = ais.length >= MIN_RUNS ? percentBeaten(run, ais) : null;
  const medianAi = vsAi === null ? open(ais.length, 'AI run')
    : byShare(vsAi, THRESHOLDS.medianAi, `Further than ${vsAi}% of ${plural(ais.length, 'AI run')}.`, true);

  // 2. The top tenth of all runs, by how far they got.
  const vsAll = enough ? percentBeaten(run, rest) : null;
  const top = vsAll === null ? open(rest.length, 'run')
    : byShare(vsAll, THRESHOLDS.topTenth, `Further than ${vsAll}% of ${plural(rest.length, 'run')}.`);

  // 3. The larder at midwinter, among the runs that lived to see midwinter: the others have none to compare.
  const larders = rest.map(o => o.larderMidwinter).filter((x): x is number => x !== null);
  const mine = run.larderMidwinter;
  let larder: Standing;
  if (mine === null) larder = { status: 'missed', detail: 'Didn\'t live to see midwinter.' };
  else if (larders.length < MIN_RUNS) larder = open(larders.length, 'run at midwinter', 'runs at midwinter');
  else {
    const share = shareBeaten(mine, larders, (a, b) => a - b)!;
    larder = byShare(share, THRESHOLDS.larder, `${plural(mine, 'ration')} at midwinter: more than ${share}% of the ${plural(larders.length, 'run')} that got there.`);
  }

  // 4. Winter-ready early: sooner than three runs in four. A run that never got ready counts as
  // later than any that did, so this compares with every run, not only the ready ones.
  const sooner = (a: number | null, b: number | null): number => (a === null ? (b === null ? 0 : -1) : b === null ? 1 : b - a);
  let ready: Standing;
  if (run.readyDay === null) ready = { status: 'missed', detail: 'Never winter-ready.' };
  else if (!enough) ready = open(rest.length, 'run');
  else {
    const share = shareBeaten<number | null>(run.readyDay, rest.map(o => o.readyDay), sooner)!;
    ready = byShare(share, THRESHOLDS.readyEarly, `Winter-ready on day ${run.readyDay}: sooner than ${share}% of ${plural(rest.length, 'run')}.`);
  }

  // 5. Skills: more skill levels than three runs in four.
  const skillShare = enough ? shareBeaten(run.skillLevels, rest.map(o => o.skillLevels), (a, b) => a - b) : null;
  const skills = skillShare === null ? open(rest.length, 'run')
    : byShare(skillShare, THRESHOLDS.skills, `${plural(run.skillLevels, 'skill level')}: more than ${skillShare}% of ${plural(rest.length, 'run')}.`);

  // 6. Reached Mistheim: a fixed mark, the end of the road. How rare it is says what it's worth.
  const arrived = rest.filter(o => tierOf(o) === 3).length;
  const rarity = rest.length ? ` ${Math.round((100 * arrived) / rest.length)}% of ${plural(rest.length, 'run')} do.` : '';
  const there = tierOf(run) === 3;
  const mistheim: Standing = { status: there ? 'earned' : 'missed', detail: `${there ? 'Made it to Mistheim.' : 'Didn\'t reach Mistheim.'}${rarity}` };

  const standings: Record<string, Standing> = {
    'outlasted-median-ai': medianAi, 'top-tenth': top, 'full-larder': larder, 'ready-early': ready, 'quick-study': skills, 'reached-mistheim': mistheim,
  };
  return KINDS.map(k => ({ ...k, ...standings[k.id] }));
}

/** Every achievement, in the order shown: the same list whether a run has them or not. */
const KINDS: readonly Pick<Achievement, 'id' | 'name' | 'rule'>[] = [
  { id: 'outlasted-median-ai', name: 'Outlasted the median AI', rule: 'Go further than half the AI runs.' },
  { id: 'top-tenth', name: 'Top 10%', rule: 'Go further than 90% of runs.' },
  { id: 'full-larder', name: 'Top 10% larder at midwinter', rule: 'Have more rations laid by at midwinter than 90% of the runs that got that far.' },
  { id: 'ready-early', name: 'Ready early', rule: 'Be winter-ready sooner than 75% of runs.' },
  { id: 'quick-study', name: 'Quick study', rule: 'Learn more skill levels than 75% of runs.' },
  { id: 'reached-mistheim', name: 'Reached Mistheim', rule: 'Ride the caravan all the way to Mistheim.' },
];

/** What an unranked run shows: every achievement, none of them for this world. */
export const OWN_WORLD = 'Played on your own world, so it isn\'t ranked. Play this week\'s world (📅) to rank.';
function unranked(): Achievement[] {
  return KINDS.map(k => ({ ...k, status: 'open' as const, detail: OWN_WORLD }));
}

/** The earned ones as lines, for text players: "Outlasted the median AI: Further than 64% of 25 AI runs." */
export function achievementLines(list: readonly Achievement[]): string[] {
  return list.filter(a => a.status === 'earned').map(a => `${a.name}: ${a.detail}`);
}
