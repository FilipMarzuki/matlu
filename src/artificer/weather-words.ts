/**
 * The weather and the season in words, until the Warden earns the calendar (#1729, switch `weather-words`).
 *
 * The owner's idea, after the descriptive map (#1686): the season strip with its FIRST SNOW and
 * MIDWINTER markers, and a line like "Overcast · 11.5h light · 10°C", are too high-tech for a scout
 * who has just fallen into another world. At the start you know the weather the way you'd say it
 * to a friend: "Cloudy and windy. Cool; you can see your breath in the morning. The birches are
 * nearly bare; it feels like autumn closing in on winter." Precision comes later, the way the
 * compass sharpens the map:
 *
 * - **words** — at the start: the sky, the cold as you feel it, the snow underfoot and the season
 *   as you sense it. No numbers.
 * - **tally** — once you keep count of the days: the notebook, if you packed it (you write the date
 *   in it from the first night), or a week of notches cut in a stick. Then the day by your count,
 *   and about how many days to the first snow.
 * - **strip** — once you've watched a season turn (the first snow has fallen): the season strip
 *   comes back, first snow, midwinter and thaw marked. Hours of light and degrees never come back
 *   in Region 1: there's no thermometer in the kit. (Dev mode shows them, app-side.)
 *
 * Pure and deterministic, and presentation only. Everything comes from what the run already has:
 * the day, the calendar, today's weather (already rolled), the snow cover and the pack. Nothing is
 * saved and nothing draws on a random stream, so the same seed plays the same game with the switch
 * on or off. Each level only ever comes true (the day only grows, the pack never changes), so what
 * you've earned stays earned.
 *
 * Like the descriptive map, the sim hands over parts (a band for each line) and writes the same
 * words in English for the AI; the page puts the parts into the viewer's language (sim-words.ts),
 * and a test checks the two Englishes agree.
 */

import { featureOn } from './features';
import { hasKit } from './kit';
import { MIDWINTER_AFTER, seasonOf, type Calendar } from './winter';
import { lateFrom, tempAt } from './weather';
import type { WeatherId } from './world';
import type { Region1State } from './region1';

/** The rule switch (features.ts). */
export const WEATHER_WORDS = 'weather-words';

/** What a run needs for this: its switches and calendar, the day, today's weather and snow, the pack. */
type Run = Pick<Region1State, 'config' | 'day' | 'weatherToday' | 'snowDepth' | 'kit'>;

export const weatherWordsOn = (s: Pick<Region1State, 'config'>): boolean => featureOn(s.config.world.features, WEATHER_WORDS);

// ── How much the Warden knows ───────────────────────────────────────────────

/**
 * What the weather box shows: `numbers` is today's strip and numbers (the switch off); `words`,
 * `tally` and `strip` are the three steps of earned precision.
 */
export type SeasonView = 'numbers' | 'words' | 'tally' | 'strip';

/** Without the notebook, a tally is trusted once it holds a week of notches: from day 8. */
export const TALLY_FROM = 8;

/** How the Warden keeps count of the days, or null while they don't. */
export type TallyHow = 'notebook' | 'notches';
export function tallyOf(s: Pick<Region1State, 'day' | 'kit'>): TallyHow | null {
  if (hasKit(s, 'notebook')) return 'notebook';
  return s.day >= TALLY_FROM ? 'notches' : null;
}

/** Has the Warden watched a season turn? Once the first snow has fallen, the year has a shape. */
export const seenSeasonTurn = (s: Pick<Region1State, 'config' | 'day'>): boolean => s.day >= s.config.calendar.winterDay;

/** How much the Warden knows of the calendar. */
export function seasonView(s: Run): SeasonView {
  if (!weatherWordsOn(s)) return 'numbers';
  if (seenSeasonTurn(s)) return 'strip';
  return tallyOf(s) ? 'tally' : 'words';
}

// ── The words, as bands ─────────────────────────────────────────────────────

/** The sky and the wind: today's weather, by its winter name once winter has come. */
export type SkyWord = WeatherId | 'storm.winter' | 'snow.winter';
export function skyWord(w: WeatherId, day: number, cal: Calendar): SkyWord {
  return seasonOf(day, cal) !== 'autumn' && (w === 'storm' || w === 'snow') ? `${w}.winter` : w;
}

/** The cold as you feel it in the morning. */
export type FeltWord = 'mild' | 'cool' | 'chilly' | 'frosty' | 'hard' | 'bitter';
/** The morning hour the cold is judged at: an hour or two after waking. */
const MORNING = 8;
/** The lowest morning temperature (°C) of each band, warmest first; below the last is bitter. */
const FELT_FROM: readonly [FeltWord, number][] = [['mild', 7], ['cool', 3], ['chilly', 0], ['frosty', -4], ['hard', -9]];
export function feltWord(day: number, w: WeatherId, cal: Calendar): FeltWord {
  const t = tempAt(day, MORNING, w, cal);
  return FELT_FROM.find(([, from]) => t >= from)?.[0] ?? 'bitter';
}

/** The snow underfoot, or null on bare ground. */
export type GroundWord = 'thin' | 'ankle' | 'knee' | 'deep';
export function groundWord(depth: number): GroundWord | null {
  if (depth <= 0) return null;
  if (depth < 0.2) return 'thin';
  if (depth < 0.45) return 'ankle';
  return depth < 0.75 ? 'knee' : 'deep';
}

/** The season as you sense it: four parts of autumn, four of winter, and the thaw. */
export type SeasonWord = 'early' | 'mid' | 'late' | 'snowSoon' | 'firstWinter' | 'deep' | 'lateWinter' | 'thawSoon' | 'thaw';
/** Within this many days of the first snow (or of the thaw) you can feel it coming. */
export const SOON_DAYS = 5;
/** Midwinter's deep cold runs this many days either side of it. */
const DEEP_DAYS = 4;
export function seasonWord(day: number, cal: Calendar): SeasonWord {
  const season = seasonOf(day, cal);
  if (season === 'thaw') return 'thaw';
  if (season === 'autumn') {
    if (cal.winterDay - day <= SOON_DAYS) return 'snowSoon';
    if (day < Math.ceil(lateFrom(cal) / 2)) return 'early';
    return day < lateFrom(cal) ? 'mid' : 'late';
  }
  const midwinter = cal.winterDay + MIDWINTER_AFTER;
  if (cal.thawDay - day <= SOON_DAYS) return 'thawSoon';
  if (day < midwinter - DEEP_DAYS) return 'firstWinter';
  return day <= midwinter + DEEP_DAYS ? 'deep' : 'lateWinter';
}

/** "About N days": exact up to a week, to the nearest five beyond (nobody counts a month ahead to the day). */
export const aboutDays = (n: number): number => (n <= 7 ? Math.max(1, n) : Math.round(n / 5) * 5);

// ── The report ──────────────────────────────────────────────────────────────

export interface WeatherReport {
  view: SeasonView;
  /** The sky and wind, the cold and the snow underfoot: null in a world without weather (tests). */
  sky: SkyWord | null;
  felt: FeltWord | null;
  ground: GroundWord | null;
  season: SeasonWord;
  /** How you keep count of the days (from `tally` on), else null. */
  tally: TallyHow | null;
  /** About how many days to the first snow, once you count the days (autumn only), else null. */
  toSnow: number | null;
  /** About how many days to the thaw, once the strip is earned (winter only), else null. */
  toThaw: number | null;
  /** The same, as English lines: what the AI and the English API read. */
  lines: string[];
}

const SKY_TEXT: Readonly<Record<SkyWord, string>> = {
  clear: 'Clear skies, hardly a breath of wind.',
  overcast: 'Cloudy, with a light breeze.',
  rain: 'Rain from a low grey sky.',
  fog: 'Fog lies thick over the ground, still and grey.',
  wind: 'Cloudy and windy.',
  storm: 'Stormy: rain driven sideways on a hard wind.',
  'storm.winter': 'A blizzard: snow on a howling wind, and you can barely see.',
  snow: 'Wet snow is falling, though it won\'t lie long.',
  'snow.winter': 'Snow is falling, soft and steady.',
};
const FELT_TEXT: Readonly<Record<FeltWord, string>> = {
  mild: 'Cool and fresh in the morning, mild by midday.',
  cool: 'Cool; you can see your breath in the morning.',
  chilly: 'Cold; there\'s frost on the grass at dawn.',
  frosty: 'Frosty; the puddles are iced over in the morning.',
  hard: 'A hard frost; the cold bites at your face and fingers.',
  bitter: 'Bitter cold; the air hurts to breathe and your lashes frost over.',
};
const GROUND_TEXT: Readonly<Record<GroundWord, string>> = {
  thin: 'A thin cover of snow on the ground.',
  ankle: 'The snow is ankle-deep.',
  knee: 'The snow is knee-deep in places.',
  deep: 'Deep snow everywhere; every step is wading.',
};
const SEASON_TEXT: Readonly<Record<SeasonWord, string>> = {
  early: 'The birches are just starting to turn; it feels like early autumn.',
  mid: 'The birches are gold and the evenings are drawing in; autumn is well under way.',
  late: 'The birches are nearly bare; it feels like autumn closing in on winter.',
  snowSoon: 'The leaves are down and the ground is hard in the mornings. The first snow can\'t be far off.',
  firstWinter: 'The snow has come to stay; it\'s winter now.',
  deep: 'The days are as short as they get; this is the depth of winter.',
  lateWinter: 'The days are drawing out again, though the cold holds.',
  thawSoon: 'The sun has some warmth in it at midday. The thaw can\'t be far off.',
  thaw: 'The snow is going; the thaw has come.',
};
const TALLY_TEXT: Readonly<Record<TallyHow, (n: number) => string>> = {
  notebook: n => `Day ${n}, by the notebook.`,
  notches: n => `Day ${n}, by the notches on your stick.`,
};
const toSnowText = (n: number): string => (n === 1 ? 'About a day to the first snow.' : `About ${n} days to the first snow.`);
const toThawText = (n: number): string => (n === 1 ? 'About a day to the thaw.' : `About ${n} days to the thaw.`);

/** The weather and the season as the Warden knows them today. With the switch off: `numbers`, and no lines. */
export function weatherReport(s: Run): WeatherReport {
  const cal = s.config.calendar;
  const view = seasonView(s);
  const seeded = s.config.world.weather === 'seeded';
  const sky = seeded ? skyWord(s.weatherToday, s.day, cal) : null;
  const felt = seeded ? feltWord(s.day, s.weatherToday, cal) : null;
  const ground = seeded ? groundWord(s.snowDepth ?? 0) : null;
  const season = seasonWord(s.day, cal);
  const tally = view === 'numbers' || view === 'words' ? null : tallyOf(s);
  const autumn = seasonOf(s.day, cal) === 'autumn';
  const toSnow = tally && autumn ? aboutDays(cal.winterDay - s.day) : null;
  const toThaw = view === 'strip' && seasonOf(s.day, cal) === 'winter' ? aboutDays(cal.thawDay - s.day) : null;
  const lines = view === 'numbers' ? [] : [
    ...(sky ? [SKY_TEXT[sky]] : []),
    ...(felt ? [FELT_TEXT[felt]] : []),
    ...(ground ? [GROUND_TEXT[ground]] : []),
    SEASON_TEXT[season],
    ...(tally ? [TALLY_TEXT[tally](s.day)] : []),
    ...(toSnow !== null ? [toSnowText(toSnow)] : []),
    ...(toThaw !== null ? [toThawText(toThaw)] : []),
  ];
  return { view, sky, felt, ground, season, tally, toSnow, toThaw, lines };
}

/** The season in a few words, for the AI's day line ("late autumn"). */
export const SEASON_SHORT: Readonly<Record<SeasonWord, string>> = {
  early: 'early autumn', mid: 'autumn', late: 'late autumn', snowSoon: 'late autumn, winter close',
  firstWinter: 'winter', deep: 'deep winter', lateWinter: 'late winter', thawSoon: 'late winter, the thaw close', thaw: 'the thaw',
};
