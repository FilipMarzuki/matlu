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
 * is hurt in this first version.
 *
 * Two more guards came later, each behind a rules switch of its own, and each only adds a row:
 * - **a lidded cold pit** (#1857, `cold-pit-lid`): one more place Store the meat can use, the best
 *   one, up to what the pit holds. Nothing small and no wolf gets past the stones; a bear can heave
 *   them aside, rarely; mice get in through the gaps, a little.
 * - **walls** (#1858, `walled-larder`): once camp's shelter has walls, the meat lying loose in it is
 *   out of reach of everything bigger than a mouse, day and night.
 * With them come the first **vermin** events: mice, which only come to a camp that has stood at its
 * site a few days (`miceChance`), and only nibble a small share (`rollNibble`). They reach the meat
 * loose behind walls and the meat in the lidded pit; hung or cached meat is out in the trees, away
 * from the shelter they're drawn to, so they leave it be (its vermin column is the rating's only).
 *
 * Pure: the table, the rating and the draw. region1.ts applies them. Every draw comes from a
 * string-keyed stream of its own (`streamFor`: `seedOf` and its own generator), never the sim's
 * shared ones, so a run with the switch off or absent is the run it always was.
 */

import { featureOn } from './features';
import { streamFor } from './rng';
import type { WeatherId } from './world';

/** The switch's id (features.ts). */
export const CAMP_SCAVENGERS = 'camp-scavengers';

/** The switches' ids (features.ts): a lid for the cold pit (#1857), and walls as a larder (#1858). */
export const COLD_PIT_LID = 'cold-pit-lid';
export const WALLED_LARDER = 'walled-larder';

type Switched = { config: { world: { features?: Readonly<Record<string, boolean>> } } };
/** Whether a run has the switch on: as it saved it, off for a run from before it. */
export const scavengersOn = (s: Switched): boolean => featureOn(s.config.world.features, CAMP_SCAVENGERS);
/**
 * Whether a run has the lid (#1857) or the walled larder (#1858). Each needs `camp-scavengers` too:
 * without it no meat is counted, so there is nothing for a lid or walls to keep safe.
 */
export const lidOn = (s: Switched): boolean => scavengersOn(s) && featureOn(s.config.world.features, COLD_PIT_LID);
export const walledLarderOn = (s: Switched): boolean => scavengersOn(s) && featureOn(s.config.world.features, WALLED_LARDER);

/**
 * The threats to food at camp (#1859). Vermin have no base risk in DAY_BASE or NIGHT_BASE: wild mice
 * are shy of people, so their chance depends on the days camp has stood at its site instead
 * (`miceChance`, #1858): none for the first few days, then building.
 */
export type Threat = 'small' | 'big' | 'vermin';
export const THREATS: readonly Threat[] = ['small', 'big', 'vermin'];
/** A share per threat: a guard's pass-through, a base risk, or what's left over. */
export type PerThreat = Readonly<Record<Threat, number>>;

/** What can guard food at camp. #1857 added the lidded cold pit (`lidded`), #1858 walls (`walled`). */
export type Guard = 'campDay' | 'asleep' | 'fire' | 'hung' | 'cache' | 'preserved' | 'lidded' | 'walled';

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
  // Larger animals keep well clear of a fire through the night with a very high chance (the owner),
  // so a fire lets only 2% of the big threat through; a hungry fox still sometimes chances it.
  fire: { small: 0.1, big: 0.02, vermin: 0.8 },
  // Hung in a tree with cord, high and away from the trunk: out of reach of foxes, ravens and wolves,
  // but a bear can climb or pull it down, rarely (the owner: "a bear sometimes gets it").
  hung: { small: 0, big: 0.1, vermin: 0.2 },
  // A stone cache: the meat under a cairn of heavy stones. Wolves can't shift them; a bear can, rarely.
  cache: { small: 0, big: 0.1, vermin: 0.2 },
  // Smoked or dried (rations, from Preserve food): nothing in it draws a fox or a wolf (#1859's "—"), and mice can't
  // get into a smoked, wrapped ration. Never at risk.
  preserved: { small: 0, big: 0, vermin: 0 },
  // A lidded cold pit (#1857): split wood over the pit, heavy stones on top. The owner: "make it
  // realistic". Foxes, ravens and martens can't lift it, and wolves don't dig through a
  // stone-weighted lid, so nothing small gets in. A bear can heave the stones aside, about as rarely
  // as it pulls hung meat down or shifts a cache (the owner left the bear's chance "to tune"): tuned
  // to equal `hung` and `cache`, so Store the meat's pit-first order never puts the meat somewhere
  // worse, and the pit's cold is a pure gain. It's still only ever a bear (raidPit; in winter the
  // bear sleeps, so none).
  // Mice get in through the gaps, at half the rate they reach meat behind walls (the owner, to tune).
  lidded: { small: 0, big: 0.1, vermin: 0.5 },
  // Walls (#1858): a timber or stone-banked shelter with the meat inside. Nothing bigger than a mouse
  // gets in, by day or night, whether you're there or not. Mice don't mind walls at all.
  walled: { small: 0, big: 0, vermin: 1 },
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
 * The rating's band: from the worst of the small and big threats, as a share of the full risk. Above
 * half, it lies open; above a tenth, fairly safe; anything above none, well protected; none, secure.
 *
 * Mice (#1858) only nibble a small share, so they never make meat lie open. With `mice` (mice can
 * come to this camp now: it has stood long enough, `miceChance` > 0), meat nothing bigger can reach
 * but mice can is well protected rather than secure. Without it (the default, and every call from
 * before #1858) the rating is the one it always was.
 */
export function protectionOf(guards: readonly Guard[], mice = false): Protection {
  const l = leftover(guards);
  const worst = Math.max(l.small, l.big);
  if (worst === 0 && mice && l.vermin > 0) return 'well';
  return worst > 0.5 ? 'open' : worst > 0.1 ? 'fair' : worst > 0 ? 'well' : 'secure';
}
export const protectionWord = (guards: readonly Guard[], mice = false): string => PROTECTION_WORDS[protectionOf(guards, mice)];

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
 * Nothing is used up: the stones are only stacked, the cord only tied off.
 *
 * The lidded cold pit (#1857) comes first. The owner: "just a place to store it; the action is the
 * same". It needs the pit at camp with its lid on (`'lid'`), and takes only what the pit holds (8
 * raw food, 12 at the river); the rest goes to the next place, as before.
 */
/** The places meat is put by outside the pit: what `meatStored` keeps. */
export type PutBy = 'cache' | 'hung';
export type MeatPlace = 'pit' | PutBy;
export const MEAT_PLACES: readonly ({ place: 'pit'; needs: 'lid' } | { place: PutBy; needs: { store: 'stone' | 'materials'; n: number } })[] = [
  { place: 'pit', needs: 'lid' },
  { place: 'cache', needs: { store: 'stone', n: 3 } },
  { place: 'hung', needs: { store: 'materials', n: 1 } },
];

/** The lid's cost (#1857): split wood for the boards (materials) and two heavy stones to weigh it down. */
export const LID_COST = { materials: 2, stone: 2 } as const;
/** How long laying the lid takes: a short camp job. */
export const LID_HOURS = 1;

/**
 * Mice (#1858). The owner: "it takes a while for mice to come. They are usually pretty afraid of
 * humans in the wild", and "maybe not on the first few days". So none for the first MICE_FREE_DAYS
 * nights at a site, then a nightly chance that grows by MICE_RAMP a night (crumbs, the smell of
 * food, a warm shelter) up to MICE_CAP. Moving camp sets the days back to zero. Drafts, to tune.
 */
export const MICE_FREE_DAYS = 4;
export const MICE_RAMP = 0.03;
export const MICE_CAP = 0.25;
/** A nibble's share of the meat the mice reach: 5–10% (seeded). */
export const MICE_TAKES = { from: 0.05, to: 0.1 } as const;

/** The nightly chance mice come to a camp that has stood `days` days at its site. Pure. */
export function miceChance(days: number): number {
  if (!(days >= MICE_FREE_DAYS)) return 0;
  return Math.min(MICE_CAP, MICE_RAMP * (Math.floor(days) - MICE_FREE_DAYS + 1));
}

/**
 * How much of `n` meat mice nibble tonight, from the draws `rand` gives and the chance left over
 * (`miceChance` times the guards' vermin pass-through). The first draw decides whether they come,
 * the second the share (5–10%), and a third rounds it up or down in proportion: 20 meat at 7% is
 * 1.4, so 1 six times in ten and 2 four times in ten. On average that's exactly the share drawn,
 * and never more than a tenth rounded up, even on a small pile. Pure.
 */
export function rollNibble(rand: () => number, n: number, chance: number): number {
  if (n <= 0 || chance <= 0) return 0;
  if (rand() >= chance) return 0;
  const share = MICE_TAKES.from + (MICE_TAKES.to - MICE_TAKES.from) * rand();
  return Math.min(n, Math.floor(n * share + rand()));
}

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

/**
 * The lidded pit's own draws at night (#1857): a bear at the pit is a roll of its own, so filling the
 * pit never shifts the open meat's or the hung meat's draws.
 */
export const pitScavengers = (seed: number, day: number): (() => number) => streamFor(seed, day, 'scavengers@night-pit');
/** The journal's line when a bear gets into the lidded pit (#1857). */
export const pitTheftLine = (n: number): string => `A bear came into camp in the night, heaved the stones off the cold pit and tore the lid away: ${n} raw food gone.`;
/**
 * Mice at night (#1858): one stream for the meat loose behind walls and one for the lidded pit, so
 * neither moves the other, and neither moves any stream from before them.
 */
export const verminScavengers = (seed: number, day: number): (() => number) => streamFor(seed, day, 'scavengers@night-vermin');
export const pitVerminScavengers = (seed: number, day: number): (() => number) => streamFor(seed, day, 'scavengers@night-vermin-pit');
/** The journal's lines for mice (#1858): at the meat in the shelter, and in the lidded pit. */
export const miceLine = (n: number): string => `Mice have been at the meat in the night: ${n} raw food gone, and droppings all along the wall.`;
export const pitMiceLine = (n: number): string => `Mice got into the cold pit through the gaps in its lid: ${n} raw food gone.`;
/** The journal's line for laying the lid (#1857). */
export const LID_LINE = 'Laid a lid of split wood over the cold pit and weighed it down with heavy stones.';

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

// ── A banked fire by day (#1865, the `banked-fire` rules switch) ──────────────
//
// #1823 counted a fire only at night, because the sim had no daytime fire. The owner: "a fire is the
// best" guard for meat at camp. So before a long trip the Warden can bank the fire: heap firewood on
// the embers and cover them with ash and turf, so it smoulders for hours without anyone tending it.
// A banked fire adds the `fire` guard to the day roll on the meat lying out (small thieves ×0.1, the
// big ones ×0.02), until it burns down. Heavy rain, a storm or snow can put it out while you're away.

/** The switch's id (features.ts). It needs `camp-scavengers` too: without meat at risk there's nothing to guard. */
export const BANKED_FIRE = 'banked-fire';

/** Whether a run has a banked fire to bank: both switches on, as it saved them. */
export const bankedFireOn = (s: { config: { world: { features?: Readonly<Record<string, boolean>> } } }): boolean =>
  scavengersOn(s) && featureOn(s.config.world.features, BANKED_FIRE);

/**
 * What banking costs and buys: about 1 firewood for every 4 hours away (the owner's tuning guess).
 * One banking lays on `BANK_FIREWOOD` and smoulders `BANK_HOURS`: 12h, the length of a long day trip
 * (a half-day-out trip in the rain runs past 8h, so two firewood would leave it cold before you got
 * back). With less firewood than that, it can't be banked (the gate says why). Drafts, to tune.
 */
export const BANK_HOURS_PER_FIREWOOD = 4;
export const BANK_FIREWOOD = 3;
export const BANK_HOURS = BANK_FIREWOOD * BANK_HOURS_PER_FIREWOOD;
/** How long banking takes: a short job at camp before you set out (raking the embers, heaping on wood, covering it). */
export const BANK_WORK_HOURS = 0.5;

/**
 * The chance, per trip, that the weather puts a banked fire out while you're away. Only heavy wet
 * weather does: rain soaks through the turf, a storm (a blizzard in winter) beats it down, and snow
 * smothers it. A clear, overcast, foggy or windy day leaves it smouldering. Drafts, to tune.
 */
export const FIRE_OUT: Readonly<Partial<Record<WeatherId, number>>> = { rain: 0.35, storm: 0.6, snow: 0.25 };

/**
 * Whether the weather puts the banked fire out on the trip that sets out at `hour`: a draw from a
 * stream of its own (`scavengers@<hour>-fire`), never the meat's own away stream, so banking or not
 * never shifts whether a fox comes.
 */
export const bankedFireDraw = (seed: number, day: number, hour: number): (() => number) => streamFor(seed, day, `scavengers@${hour}-fire`);

/** The journal's lines for a banked fire (English: the sim's log; i18n/{en,sv}/journal.ts read them back). */
export const bankLine = (): string => `Banked the fire with ${BANK_FIREWOOD} firewood: it will smoulder for about ${BANK_HOURS} hours and keep animals off the meat.`;
export function fireOutLine(w: WeatherId): string {
  if (w === 'snow') return 'While you were away, the snow smothered the banked fire, and nothing kept animals off the meat.';
  if (w === 'storm') return 'While you were away, the storm beat out the banked fire, and nothing kept animals off the meat.';
  return 'While you were away, the rain put out the banked fire, and nothing kept animals off the meat.';
}
export const burntDownLine = (): string => 'The banked fire burned down before you got back, and nothing kept animals off the meat.';
