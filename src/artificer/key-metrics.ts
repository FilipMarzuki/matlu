/**
 * The key survival metrics (#1891): the few numbers a region's survival goal turns on, shown in the
 * status bar's key box (under FOCUS) and, against what the winter outlook needs, on the PROGRESS tab.
 *
 * Each region declares its own (`REGION_KEY_METRICS`). Region 1's are food, water and firewood:
 * the owner expects them to matter less as the game goes on, so a later region swaps its own in
 * here and both the status bar and PROGRESS follow, with nothing else to change.
 *
 * Display only: every function here is pure, reads the run as it stands and draws no randomness.
 * The numbers come from the sim's own rules (one meal a night in `sleepNight`, `nightSpoilage`,
 * `nightFuel`, `winterOutlook`), never new ones.
 */

import { meatOf, nightFuel, nightSpoilage, winterOutlook, type Region1State, type WinterOutlook } from './region1';
import { nightTemp } from './weather';

/** The regions that declare key metrics. Only Region 1 so far. */
export type RegionId = 'region1';
export type KeyMetricId = 'food' | 'water' | 'firewood';

/** Each region's key metrics, in the order the status bar shows them. */
export const REGION_KEY_METRICS: Readonly<Record<RegionId, readonly KeyMetricId[]>> = {
  region1: ['food', 'water', 'firewood'],
};

/** The key metrics a region declares (Region 1's when none is named). */
export const keyMetricsOf = (region: RegionId = 'region1'): readonly KeyMetricId[] => REGION_KEY_METRICS[region];

/**
 * Food eaten in a night at full rations: one, raw food first, then rations (region1.ts `sleepNight`).
 * The winter outlook counts food the same way (`winterOutlook().foodDays`), so the box's "4 days"
 * and PROGRESS's "food 4 of ~30" agree with the outlook's holding/short tag.
 */
export const FOOD_PER_NIGHT = 1;

/** Days of food the stores cover: every edible store (raw food and rations) at one meal a night. */
export const foodDays = (s: Pick<Region1State, 'stores'>): number => Math.floor((s.stores.rawFood + s.stores.rations) / FOOD_PER_NIGHT);

/** The food by kind, for the key box's breakdown: raw food (of it, the meat), rations, and what tonight spoils. */
export interface FoodBreakdown {
  /** Raw food: what's gathered, fished and hunted. It spoils. */
  raw: number;
  /** Of the raw food, the meat from hunts and traps (#1823, `camp-scavengers`): 0 when the run doesn't track it. */
  meat: number;
  /** Rations: smoked or dried, the winter larder. They never spoil. */
  rations: number;
  /** Raw food that goes bad tonight (region1.ts `nightSpoilage`): 0 in the flat world, which has no spoilage. */
  spoilsTonight: number;
}

/** The food by kind, and what of it spoils tonight, as the night will reckon it. */
export function foodBreakdown(s: Region1State): FoodBreakdown {
  // Spoilage only happens where the weather is real (endDay's `feelsTemperature`), as the CAMP tab's cold storage says.
  const spoilsTonight = s.config.world.weather === 'seeded' ? nightSpoilage(s, nightTemp(s.day, s.weatherToday, s.config.calendar)).spoiled : 0;
  return { raw: s.stores.rawFood, meat: meatOf(s), rations: s.stores.rations, spoilsTonight };
}

/**
 * The nights the winter outlook measures against: the rest of the winter (all of it, while it's still
 * autumn). Moved here from progress-view.ts so the PROGRESS rows and the outlook use the same count.
 */
export const outlookNights = (s: Region1State): number => nightsOf(winterOutlook(s), s);
const nightsOf = (o: WinterOutlook, s: Region1State): number => Math.min(o.nightsToThaw, s.config.calendar.thawDay - s.config.calendar.winterDay);

/** One key metric as it stands. */
export interface KeyMetric {
  id: KeyMetricId;
  /** Food in days it covers; water and firewood as counted in the stores. */
  value: number;
  unit: 'days' | 'count';
  /** Short now: no food or water for tonight, or not enough firewood for tonight's fire. */
  low: boolean;
  /**
   * What the winter outlook asks of it, in the same unit (food: the nights to last; firewood: the
   * wood the nights to the thaw will burn). Null for water, which is fetched as you go, and when
   * the metrics were asked for without needs.
   */
  need: number | null;
  /** Whether it holds against the outlook (the outlook's own rule); null where `need` is. */
  holding: boolean | null;
}

/**
 * A region's key metrics from the run as it stands. `needs: false` leaves the winter needs out
 * (null), for the status bar, which shows only the values and doesn't need the outlook's night walk.
 */
export function keyMetrics(s: Region1State, opts: { region?: RegionId; needs?: boolean } = {}): KeyMetric[] {
  const o = opts.needs === false ? null : winterOutlook(s);
  const nights = o ? nightsOf(o, s) : 0;
  return keyMetricsOf(opts.region).map((id): KeyMetric => {
    if (id === 'food') {
      const value = foodDays(s);
      // At the thaw there's nothing left to last: it holds.
      return { id, value, unit: 'days', low: value < 1, need: o ? nights : null, holding: o ? nights === 0 || o.foodDays >= nights : null };
    }
    if (id === 'water') return { id, value: s.stores.water, unit: 'count', low: s.stores.water < 1, need: null, holding: null };
    const tonight = nightFuel(s);
    return {
      id, value: s.stores.firewood, unit: 'count', low: tonight > 0 && s.stores.firewood < tonight,
      need: o ? o.fuelToThaw : null, holding: o ? nights === 0 || o.fuelDays >= nights : null,
    };
  });
}
