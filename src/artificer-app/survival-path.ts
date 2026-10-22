/**
 * The Survival path (#1793, part 2 of the guide epic #1791): five steps from the first morning to
 * a winter you can sit out, shown through the FOCUS chip and its picker so the player always sees
 * what to do next.
 *
 *   1. find a suitable camp site  →  2. make camp  →  3. a roof over you  →  4. food laid by  →
 *   5. ready for winter
 *
 * A pure function of the game state: nothing new is saved, nothing in the sim changes, and the
 * same state always gives the same path. Each step is done while its fact is true, and the current
 * step is the first one that isn't, so if the larder runs low after step 4 the chip goes back to
 * it. That's on purpose: it's a pointer to what's missing now, not a trophy shelf.
 *
 * App-side because it only reads the state; the play API, the console and the AI players don't
 * see it. Behind the `guide` ui feature (features.ts): with it off, the chip and picker are as before.
 */

import { knownSpots, campAsActionOn, siteRatingsOn, siteRating } from '../artificer/camp-sites';
import { scouted } from '../artificer/exploration';
import { naturalRoof } from '../artificer/built-warmth';
import { pillars } from '../artificer/readiness';
import { readinessInput, winterOutlook, winterReady, type Region1State } from '../artificer/region1';
import type { GoalId } from '../artificer/focus';
import { hasCamp } from './camp-view';
import { outlookShortfalls } from './progress-view';

/** The ui feature this lives behind (features.ts): switch it off and the chip is as it was. */
export const GUIDE_FEATURE = 'guide';

export type PathStepId = 'site' | 'camp' | 'roof' | 'food' | 'winter';
export const PATH_STEPS: readonly PathStepId[] = ['site', 'camp', 'roof', 'food', 'winter'];

/**
 * "Food laid by": nights of food in the stores, raw food and rations together, at one a night
 * (`winterOutlook().foodDays`, the night's meal in region1.ts). A week's worth: a run starts with
 * 2 raw food and at most 4 packed rations (kit.ts, the weekend food), so 7 is more than any pack
 * brings and has to be gathered, yet well short of winter's larder of 20 rations (readiness.ts),
 * which is step 5's business.
 */
export const FOOD_LAID_BY = 7;

export interface PathStep { id: PathStepId; done: boolean }

export interface SurvivalPath {
  steps: PathStep[];
  /** The first step not done (0-based), or null once all five are: the path is finished. */
  current: number | null;
}

/**
 * Step 1's fact: you know a place worth camping at, other than where you woke up.
 * - With camp as an action and the site ratings (#1732, #1756): a known site, not the start,
 *   that you believe is good or great.
 * - With camp as an action but no ratings: any known site that isn't the start.
 * - Without camp as an action (the old site picker): the near ring scouted, which is when the
 *   picker's sites can be chosen.
 * The start is left out so a new run always begins at step 1, exploring; camping at the start is
 * still fine: a camp made counts for step 1 too.
 */
export function suitableSiteKnown(s: Region1State): boolean {
  if (!campAsActionOn(s)) return scouted(s.explore, 1);
  const others = knownSpots(s).filter(p => !p.start);
  if (!siteRatingsOn(s)) return others.length > 0;
  return others.some(p => siteRating(s, p) !== 'poor');
}

/** Step 3's fact: a shelter built at camp (tier 1 or 2), or a cave, whose rock is a roof (`naturalRoof`). */
export const hasRoof = (s: Region1State): boolean => hasCamp(s) && (s.tier > 0 || naturalRoof(s));

/** Step 4's fact: at least `FOOD_LAID_BY` nights of food in the stores. */
export const foodLaidBy = (s: Region1State): boolean => winterOutlook(s).foodDays >= FOOD_LAID_BY;

/**
 * How the path is read. `outlook` (the `standing-line` ui feature, #1926): step 5 is done only while
 * the winter outlook holds too (progress-view.ts `outlookShortfalls`), so the path never reads as
 * done beside a PROGRESS tab that says the food or the firewood falls short. Without it, step 5 is
 * the four readiness pillars alone, as before.
 */
export interface PathOptions { outlook?: boolean }

/** The Survival path for this state. */
export function survivalPath(s: Region1State, opts: PathOptions = {}): SurvivalPath {
  const camp = hasCamp(s);
  const facts: Record<PathStepId, boolean> = {
    site: camp || suitableSiteKnown(s),
    camp,
    roof: hasRoof(s),
    food: foodLaidBy(s),
    winter: winterReady(s) && !(opts.outlook && outlookShortfalls(s).length > 0),
  };
  const steps = PATH_STEPS.map(id => ({ id, done: facts[id] }));
  // Ready for winter is the goal itself: once it holds, the path is done, whatever else wobbles.
  const i = facts.winter ? -1 : steps.findIndex(x => !x.done);
  return { steps, current: i < 0 ? null : i };
}

/**
 * The goal focus that helps with a step, if one does: exploring finds a site, Shelter builds the
 * roof, Larder lays food by. Making camp has none (it's one action). For winter, the first of
 * winter's pillars still short: the larder → Larder, the shelter or the woodpile → Shelter (its
 * actions are build and wood); the body's isn't a goal's. With `outlook` (#1926), what the winter
 * outlook says falls short comes first: food → Larder, firewood or warmth → Shelter.
 */
export function stepGoal(s: Region1State, id: PathStepId, opts: PathOptions = {}): GoalId | null {
  switch (id) {
    case 'site': return 'explore';
    case 'camp': return null;
    case 'roof': return 'shelter';
    case 'food': return 'larder';
    case 'winter': {
      const out = opts.outlook ? outlookShortfalls(s)[0]?.what : undefined;
      if (out) return out === 'food' ? 'larder' : 'shelter';
      const short = pillars(readinessInput(s), s.config.thresholds).find(p => !p.done)?.key;
      return short === 'larder' ? 'larder' : short === 'shelter' || short === 'fuel' ? 'shelter' : null;
    }
  }
}
