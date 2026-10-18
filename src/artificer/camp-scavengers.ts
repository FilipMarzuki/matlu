/**
 * Meat left at camp draws animals (#1823, the `camp-scavengers` rules switch), and how well it's
 * protected, in one combined rating (#1859).
 *
 * The owner: "If it's unattended it might draw animals though unless stored in a safe way." And:
 * "Being at camp keeps animals away from the meat, but a fire is the best." And (#1859): "Maybe it's
 * a combined storage or protection rating."
 *
 * Raw meat (from hunting and traps, never foraged plants) at camp is at risk during each long
 * absence and each night. Three threats come for it: **small** scavengers (a fox, ravens), **big**
 * ones (wolves, a bear) and **vermin** (mice, rats). Everything guarding the meat is a **guard**,
 * and each guard lets through a share of each threat (`GUARDS`, its pass-through: 1 lets all of it
 * through, 0 none). Guards stack: the risk left over is the base risk times the product of the
 * pass-throughs of the guards in place (`leftover`), so two guards beat either alone, and nothing is
 * ever certain to be taken. The rating is said in words, never numbers (`protectionWord`).
 *
 * When something gets at it: usually a small thief takes a quarter to a half of the meat lying out
 * (seeded); rarely, at night, something big takes all of it, and the fright costs Clarity. Nobody
 * is hurt in this first version. Vermin have their column in the table but no events yet (the
 * walled shelter, #1858, is where they come in), so #1857 and #1858 only add rows.
 *
 * Pure: the table, the rating and the draw. region1.ts applies them. Every draw comes from a
 * string-keyed stream of its own (`streamFor`: `seedOf` and its own generator), never the sim's
 * shared ones, so a run with the switch off or absent is the run it always was.
 */

import { featureOn } from './features';
import { streamFor } from './rng';

/** The switch's id (features.ts). */
export const CAMP_SCAVENGERS = 'camp-scavengers';

/** Whether a run has the switch on: as it saved it, off for a run from before it. */
export const scavengersOn = (s: { config: { world: { features?: Readonly<Record<string, boolean>> } } }): boolean =>
  featureOn(s.config.world.features, CAMP_SCAVENGERS);

/**
 * The threats to food at camp (#1859). Vermin have no base risk and no events yet: wild mice are
 * shy of people, so when they come (#1858) their base risk will depend on the days camp has stood
 * at the site — none for the first few days (about 3–4), then building.
 */
export type Threat = 'small' | 'big' | 'vermin';
export const THREATS: readonly Threat[] = ['small', 'big', 'vermin'];
/** A share per threat: a guard's pass-through, a base risk, or what's left over. */
export type PerThreat = Readonly<Record<Threat, number>>;

/** What can guard food at camp. #1857 (a lidded cold pit) and #1858 (walls) each add one. */
export type Guard = 'campDay' | 'asleep' | 'fire' | 'hung' | 'cache' | 'preserved';

/**
 * Each guard's pass-through per threat: the share of that threat it lets through. #1859's table,
 * its words read as numbers: none = 1, low = 0.8, half = 0.5, high = 0.1 (fire) or 0.2, full = 0.
 * The values are drafts, to tune.
 */
export const GUARDS: Readonly<Record<Guard, PerThreat>> = {
  // The Warden at camp by day: animals keep off. #1859 says "high"; #1823's acceptance asks that
  // nothing at all is taken by day while you're at camp, so it's full here. Mice don't care.
  campDay: { small: 0, big: 0, vermin: 1 },
  // Asleep at camp at night: you're there, but you don't hear much. Half the risk.
  asleep: { small: 0.5, big: 0.5, vermin: 1 },
  // A fire burning through the night: the best guard you can keep (the owner). A little vermin cover.
  fire: { small: 0.1, big: 0.1, vermin: 0.8 },
  // Hung in a tree with cord, high and away from the trunk: out of reach of foxes, ravens and wolves,
  // but a bear can climb or pull it down, rarely (the owner: "a bear sometimes gets it").
  hung: { small: 0, big: 0.1, vermin: 0.2 },
  // A stone cache: the meat under a cairn of heavy stones. Wolves can't shift them; a bear can, rarely.
  cache: { small: 0, big: 0.1, vermin: 0.2 },
  // Smoked or dried (rations, from Preserve food): nothing in it draws a fox or a wolf (#1859's "—"), and mice can't
  // get into a smoked, wrapped ration. Never at risk.
  preserved: { small: 0, big: 0, vermin: 0 },
};

/**
 * The risk left over with these guards in place: the base risk times the product of their
 * pass-throughs, threat by threat. With no base given, the product alone (the rating). Pure.
 */
export function leftover(guards: readonly Guard[], base: PerThreat = { small: 1, big: 1, vermin: 1 }): PerThreat {
  const out = { ...base };
  for (const g of guards) for (const th of THREATS) out[th] *= GUARDS[g][th];
  return out;
}

/** The protection rating in a word (#1859): from lying open to secure. */
export type Protection = 'open' | 'fair' | 'well' | 'secure';
/** The words in English (the AI's observation; the page says them through `meat.prot.*`). */
export const PROTECTION_WORDS: Readonly<Record<Protection, string>> = { open: 'lies open', fair: 'fairly safe', well: 'well protected', secure: 'secure' };

/**
 * The rating's band: from the worst of the threats that can strike in this version (small and big;
 * vermin join with their events, #1858), as a share of the full risk. Above half, it lies open;
 * above a tenth, fairly safe; anything above none, well protected; none, secure.
 */
export function protectionOf(guards: readonly Guard[]): Protection {
  const l = leftover(guards);
  const worst = Math.max(l.small, l.big);
  return worst > 0.5 ? 'open' : worst > 0.1 ? 'fair' : worst > 0 ? 'well' : 'secure';
}
export const protectionWord = (guards: readonly Guard[]): string => PROTECTION_WORDS[protectionOf(guards)];

/**
 * A long absence: a trip away from camp of at least this many hours (work and walk together). A
 * short errand (fetching water nearby) leaves the camp too briefly for a fox to come in.
 */
export const LONG_AWAY_HOURS = 4;

/**
 * The base risk per threat on one long absence, the meat lying open: about one trip in four. Nothing
 * big by day. Vermin are 0 in both bases until their events come (#1858), when their base will
 * depend on the days camp has stood at the site (none for the first 3–4 days: mice are shy of people).
 */
export const DAY_BASE: PerThreat = { small: 0.25, big: 0, vermin: 0 };
/**
 * The base risk per threat on a night with nobody there and no fire: 0.3 in all, of which a
 * seventh or so is something big (about one unguarded night in fifty, asleep).
 */
export const NIGHT_BASE: PerThreat = { small: 0.255, big: 0.045, vermin: 0 };

/** A small thief's share of the meat lying out: a quarter to a half (seeded). */
export const SMALL_TAKES = { from: 0.25, to: 0.5 } as const;
/** The Clarity a big animal in camp at night costs: a frightening encounter, though nobody is hurt. */
export const BIG_CLARITY = 8;

/** How long Store the meat takes: a short job at camp. */
export const STORE_MEAT_HOURS = 1;

/**
 * Where Store the meat puts the meat, best first: it uses the best place camp has the makings for.
 * #1857 (a lidded cold pit) adds one here. Nothing is used up: the stones are only stacked, the
 * cord only tied off.
 */
export type MeatPlace = 'cache' | 'hung';
export const MEAT_PLACES: readonly { place: MeatPlace; needs: { store: 'stone' | 'materials'; n: number } }[] = [
  { place: 'cache', needs: { store: 'stone', n: 3 } },
  { place: 'hung', needs: { store: 'materials', n: 1 } },
];

/** The animals. A bear only outside winter (it's asleep then); ravens only by day. */
export type Thief = 'fox' | 'ravens' | 'wolves' | 'bear';

/** A theft: who, how much, and whether it was something big. */
export interface Theft { thief: Thief; taken: number; big: boolean }

/**
 * Whether something gets at `n` meat, from the draws `rand` gives (a stream of its own) and the
 * risk left over (`leftover`). The first draw decides whether anything comes and what: under the
 * big risk it's something big (all of it), under big + small a small thief (a quarter to a half),
 * else nothing. Then who it was, and how much a small one took. Pure.
 */
export function rollTheft(rand: () => number, n: number, risk: PerThreat, night: boolean, winter: boolean): Theft | null {
  if (n <= 0) return null;
  const u = rand();
  if (u < risk.big) return { thief: winter || rand() < 0.5 ? 'wolves' : 'bear', taken: n, big: true };
  if (u >= risk.big + risk.small) return null;
  const thief: Thief = night || rand() < 0.5 ? 'fox' : 'ravens';
  const share = SMALL_TAKES.from + (SMALL_TAKES.to - SMALL_TAKES.from) * rand();
  return { thief, taken: Math.min(n, Math.max(1, Math.round(n * share))), big: false };
}

/** A night's draws at camp: a stream of its own, keyed on the day. */
export const nightScavengers = (seed: number, day: number): (() => number) => streamFor(seed, day, 'scavengers@night');
/**
 * The stored meat's own draws at night (#1823): a bear at the hung meat or the cache is a separate
 * roll from the meat lying out, so storing meat never shifts the open meat's draws.
 */
export const storedScavengers = (seed: number, day: number): (() => number) => streamFor(seed, day, 'scavengers@night-stored');
/** The journal's line when a bear gets at the meat that was put by (#1823). Only a bear can: wolves can't climb or shift stones. */
export const storedTheftLine = (n: number): string => `A bear came into camp in the night and got at the meat you'd put by: ${n} raw food gone.`;

/** A long absence's draws: a stream of its own, keyed on the hour the trip began. */
export const awayScavengers = (seed: number, day: number, hour: number): (() => number) => streamFor(seed, day, `scavengers@${hour}`);

/** The journal's line for a theft (English: the sim's log; i18n/{en,sv}/journal.ts read it back). */
export function theftLine(t: Theft, night: boolean): string {
  if (t.thief === 'wolves') return 'Wolves came into camp in the night. You lay still while they tore at the meat, and by first light all of it was gone.';
  if (t.thief === 'bear') return 'A bear came into camp in the night. You lay frozen while it ate, and by first light all the meat was gone.';
  if (t.thief === 'ravens') return `While you were away, ravens got at the meat: ${t.taken} raw food gone, and their tracks all round camp.`;
  return night
    ? `A fox got at the meat in the night: ${t.taken} raw food gone, and its tracks all round camp by morning.`
    : `While you were away, a fox got at the meat: ${t.taken} raw food gone, and its tracks all round camp.`;
}
