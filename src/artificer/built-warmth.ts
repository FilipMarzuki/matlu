/**
 * Camp warmth comes from what you build (#1763, switch `built-warmth`).
 *
 * Before this switch each kind of site had a ceiling (region1.ts `SITES[...].warmth`: cave 90%,
 * treeline 70%, riverbank 40%, hilltop 20%) and the shelter only realised a share of it, so a
 * hilltop could never be warm however well you built there. With the switch on, two things add up:
 *
 * - **Natural shelter**: what the site gives with nothing built. A cave a lot (rock at your back
 *   and a roof overhead), a treeline some, a riverbank little, a hilltop none.
 * - **Built shelter**: what you add. It closes the gap between the natural shelter and fully warm:
 *   a lean-to closes 45% of it, timber walls 80%, scaled by how well the latest stage was built.
 *   So a proper wood shelter (timber walls, soundly built) with a fire is warm enough for a
 *   midwinter night on any ground; the site only changes how much work that takes.
 *
 * The site still matters, softly:
 * - **Wind** (the hilltop) takes a little off unless something breaks it: walls built sound or
 *   better, or a shelter sited out of the wind (the 📌 sheltered place, #1379).
 * - **Damp** (the riverbank) takes a little off unless the floor is raised: any shelter built sound
 *   or better is (a crude one sits on the wet ground, and so does an open camp).
 *
 * Both reuse what the build already records (its stage, its grade, `sited`) instead of adding a
 * windbreak or a floor as builds of their own: the same choices, read for what they'd mean.
 *
 * And a bed (a bedroll, or the sleeping bag that packs as one) keeps you off the cold ground, so a
 * cave needs only a bed and a fire. Pure, and no draws: it reads state.
 */

import { featureOn } from './features';
import type { Grade } from './crafting';
import type { Region1State, ShelterType, SiteId, WallMaterial } from './region1';

/** The switch (features.ts). */
export const BUILT_WARMTH = 'built-warmth';

type Run = Pick<Region1State, 'config'>;
export const builtWarmthOn = (s: Run): boolean => featureOn(s.config.world.features, BUILT_WARMTH);

/** What each kind of site gives with nothing built (0–1). */
export const NATURAL_SHELTER: Readonly<Record<SiteId, number>> = { cave: 0.65, tree: 0.3, river: 0.1, hill: 0 };

/** How much of the gap to fully warm each stage of shelter closes, soundly built. */
export const ROOF_CLOSES: Readonly<Record<ShelterType, number>> = { leanto: 0.45, hut: 0.55 };
export const WALLS_CLOSE: Readonly<Record<WallMaterial, number>> = { timber: 0.8, stone: 0.9 };

/** What the hilltop's wind takes off without a windbreak, and the riverbank's damp without a raised floor. */
export const WIND_EXPOSURE = 0.1;
export const DAMP = 0.05;
/** A bed off the cold ground. */
export const BED_WARMTH = 0.1;

/** The parts of a run warmth reads. */
export type WarmthRun = Pick<Region1State, 'site' | 'tier' | 'shelter' | 'shelterGrade' | 'tools'>;

/** A shelter built well enough to break the wind or keep off the damp: anything but crude. */
const wellBuilt = (s: WarmthRun): boolean => s.tier > 0 && (s.shelterGrade ?? 'sound') !== 'crude';
/** Something breaks the wind: walls built sound or better, or a shelter sited out of it. */
export const hasWindbreak = (s: WarmthRun): boolean => (s.tier === 2 && wellBuilt(s)) || (s.tier > 0 && !!s.shelter.sited);
/** The floor is raised off the wet ground: any shelter built sound or better. */
export const hasRaisedFloor = (s: WarmthRun): boolean => wellBuilt(s);
/** You sleep in a bed: a bedroll among the tools. */
export const hasBed = (s: Pick<Region1State, 'tools'>): boolean => s.tools.some(t => t.item === 'bedroll');

/** What the site's wind or damp takes off tonight (0 when built against it). */
export function sitePenalty(s: WarmthRun): number {
  if (s.site === 'hill' && !hasWindbreak(s)) return WIND_EXPOSURE;
  if (s.site === 'river' && !hasRaisedFloor(s)) return DAMP;
  return 0;
}

/** How much of the gap the shelter as built closes (0 for an open camp), by its grade (`gradeWarmth`). */
function closes(s: WarmthRun, gradeWarmth: Readonly<Record<Grade, number>>): number {
  if (s.tier === 0) return 0;
  const stage = s.tier === 1 ? ROOF_CLOSES[s.shelter.type ?? 'leanto'] : WALLS_CLOSE[s.shelter.walls ?? 'timber'];
  return Math.min(1, stage * gradeWarmth[s.shelterGrade ?? 'sound']);
}

/**
 * Camp warmth with the switch on, 0..1: the natural shelter, plus what the shelter closes of the
 * rest, less the site's wind or damp, plus a bed and a sited shelter's bonus (`sitedBonus`).
 */
export function builtWarmth(s: WarmthRun, gradeWarmth: Readonly<Record<Grade, number>>, sitedBonus: number): number {
  if (!s.site) return 0;
  const natural = NATURAL_SHELTER[s.site];
  const w = natural + (1 - natural) * closes(s, gradeWarmth) - sitePenalty(s) + (hasBed(s) ? BED_WARMTH : 0) + (s.shelter.sited && s.tier > 0 ? sitedBonus : 0);
  return Math.max(0, Math.min(1, w));
}

/** What the site alone gives (nothing built, no bed), less its wind or damp: for the tests and the AI. */
export const naturalWarmth = (s: Pick<Region1State, 'site'>): number =>
  (s.site ? Math.max(0, NATURAL_SHELTER[s.site] - (s.site === 'hill' ? WIND_EXPOSURE : s.site === 'river' ? DAMP : 0)) : 0);

/** The rock is a roof: a cave keeps the rain off with nothing built. */
export const naturalRoof = (s: Run & Pick<Region1State, 'site'>): boolean => builtWarmthOn(s) && s.site === 'cave';

/**
 * The site's natural shelter and what it needs, in English: what the AI and the API read and the
 * option notes say (the page says `shelter.word.*`, `shelter.why.*`, `shelter.needs.*`).
 */
export const SHELTER_TEXT = {
  word: { cave: 'sheltered', tree: 'some shelter', river: 'little shelter', hill: 'exposed' },
  why: { cave: 'rock at your back', tree: 'the trees break the wind', river: 'damp ground by the water', hill: 'it needs a full shelter' },
  needs: {
    cave: 'a bed and a fire make it warm',
    tree: 'walls and a fire make it warm',
    river: 'walls, soundly built off the damp ground, and a fire make it warm',
    hill: 'walls, soundly built against the wind, and a fire make it warm',
  },
} as const satisfies Record<'word' | 'why' | 'needs', Record<SiteId, string>>;

/** "sheltered: rock at your back · a bed and a fire make it warm". */
export const siteShelterText = (site: SiteId): string => `${SHELTER_TEXT.word[site]}: ${SHELTER_TEXT.why[site]} · ${SHELTER_TEXT.needs[site]}`;
