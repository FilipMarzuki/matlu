/**
 * Traps first; hunting and fishing need gear (#1821, the `hunting-gear` rules switch).
 *
 * The owner: "Snares and traps until you have some better tools. Once you have a sling or
 * slingshot, or a bow you can hunt more actively. Same for fishing. You need some gear." And:
 * "Hunt end on kill, unless you can store it in a pack or similar in an easy manner."
 *
 * - **Set traps** (region1.ts `traps`): a line of snares along the game trails in a distance where
 *   you've seen game. It catches overnight, with no more work: by morning there may be small game in
 *   it (a seeded chance, by the odds below). Setting the line thins the game there as a hunt does.
 * - **Hunting** is hidden until the Warden has a ranged tool: a **sling** (cheap, early: small game
 *   only) or a **bow** (later, once the Warden knows hunting well enough: deer too, better odds).
 * - **Fishing** is hidden until the Warden has a **hook and line**.
 * - **A kill ends the hunt**: you walk home with it and the hours left over are free, unless the
 *   catch keeps you within a comfortable load (load.ts): then you stow it and hunt on to the end of
 *   the planned hours, with another chance at a catch. A deer never fits.
 * - **Odds in words**, never numbers: "good odds" / "fair odds" / "a long shot", from what you know
 *   of the game there, the tool, and your Hunting skill (and the game thinning makes them worse).
 *
 * Pure: the rules in numbers and words. region1.ts applies them. The new draws come from
 * string-keyed streams of their own (`streamFor`, as `killMoment` does), never the sim's shared
 * ones, so a run with the switch off or absent is the run it always was.
 */

import { featureOn } from './features';
import { streamFor } from './rng';

/** The switch's id (features.ts). */
export const HUNTING_GEAR = 'hunting-gear';

/** Whether a run has the switch on: as it saved it, off for a run from before it. */
export const huntingGearOn = (s: { config: { world: { features?: Readonly<Record<string, boolean>> } } }): boolean =>
  featureOn(s.config.world.features, HUNTING_GEAR);

/** The gear's items (crafting.ts tools). */
export const SLING = 'sling';
export const BOW = 'bow';
export const HOOK_LINE = 'hook-line';

/** How the Warden takes game: a line of traps, or hunting with a sling or a bow. */
export type HuntTool = 'traps' | 'sling' | 'bow';

/** What each method adds to the odds: traps and a sling alike for small game; a bow reaches much further. */
export const TOOL_SCORE: Readonly<Record<HuntTool, number>> = { traps: 1, sling: 1, bow: 3 };

/** The odds in a word: good odds, fair odds, a long shot. */
export type HuntOdds = 'good' | 'fair' | 'long';
/** Ordered worst to best, to compare them. */
export const HUNT_ODDS: readonly HuntOdds[] = ['long', 'fair', 'good'];
/** The words in English (the sim's journal and the AI's observation; the page says them through `odds.hunt.*`). */
export const HUNT_ODDS_WORDS: Readonly<Record<HuntOdds, string>> = { good: 'good odds', fair: 'fair odds', long: 'a long shot' };

/**
 * The odds as a score: what you know of the game there (0 unknown … 3 detailed), the tool, half
 * your Hunting level (at most 2), less for ground the game has been thinned out of. Pure.
 */
export function huntScore(gameLevel: number, tool: HuntTool, huntingLevel: number, supply: 'plenty' | 'thinning' | 'scarce' | 'bare' = 'plenty'): number {
  const thin = supply === 'scarce' ? -1 : supply === 'bare' ? -2 : 0;
  return gameLevel + TOOL_SCORE[tool] + Math.min(2, Math.floor(Math.max(0, huntingLevel) / 2)) + thin;
}

/** The score in a word. */
export const huntOdds = (score: number): HuntOdds => (score >= 4 ? 'good' : score >= 2 ? 'fair' : 'long');

/** The chance of a catch at those odds: a trap line overnight, or another chance on a hunt that hunts on. */
export const CATCH_CHANCE: Readonly<Record<HuntOdds, number>> = { good: 0.75, fair: 0.5, long: 0.25 };

/** A trap line's night (#1821): its own stream, keyed on the day it was set and its distance. */
export const trapFortune = (seed: number, day: number, ring: number): number => streamFor(seed, day, `traps@${ring}`)();

/** Another chance on a hunt that stowed its catch and hunted on: its own stream, keyed on the hour the hunt began. */
export const huntOnFortune = (seed: number, day: number, key: number): number => streamFor(seed, day, `hunt-on@${key}`)();

/** Hunting before the Warden has a ranged tool: hidden, in the words `reason.unlock` reads back (i18n/en/journal.ts derives them). */
export const HUNT_UNLOCK = { verb: 'hunt actively', how: 'make a sling first, or later a bow' } as const;
/** Fishing before a hook and line. */
export const FISH_UNLOCK = { verb: 'fish without gear', how: 'make a hook and line first' } as const;
/** The bow before the Warden knows hunting (or woodcraft) well enough; its string is sinew, from the same small game. */
export const BOW_UNLOCK = { verb: 'make a bow', how: 'set traps and hunt small game with a sling, for the skill and the sinew its string needs' } as const;

/**
 * Sinew (#1821, the owner: "the bow needs sinew or gut"): what a bowstring is made of, from the
 * game itself. Each small-game catch (a trap line that held something, a sling hunt that brought
 * food, a second catch hunting on) gives `SINEW_SMALL`; a deer gives `SINEW_DEER`. No draw of its
 * own: a catch is already the luck, so the sinew follows from it, and an empty hunt gives none.
 */
export const SINEW_SMALL = 1;
export const SINEW_DEER = 2;
/**
 * Sinew a bow takes: two catches' worth. Traps at fair odds catch about every other night, so a
 * Warden who sets them from the first days has it in about four nights, sooner with sling hunts
 * as well. That's about when the bow's Hunting level comes anyway, so the sinew rarely holds it
 * back for long, but deer (and the bow's better odds) come after small game, not before.
 */
export const BOW_SINEW = 2;
/** The bow's craft card when there's not enough sinew yet (`reason.needSinew`). */
export const NEED_SINEW = 'you need sinew — trap or hunt small game first';
/** The journal's sentence on the sinew a catch gave, appended to the catch's line. */
export const sinewNote = (n: number): string => (n > 0 ? ` Kept ${n} sinew.` : '');
/** The true levels that open the bow: Hunting Apprentice, or Woodcraft Adept. */
export const BOW_LEVEL = { hunting: 2, woodcraft: 3 } as const;
