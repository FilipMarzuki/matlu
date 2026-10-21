/**
 * The ambient sound's mix (#1828): what the land sounds like right now, as layer levels.
 *
 * This is the pure half of the ambience. `mixFor` takes what the page already shows (the backdrop's
 * scene: the weather, the season, the time of day and the place; whether the camp fire is going;
 * how much Clarity is left; whether the Warden is out on the land or at camp) and says how loud each
 * synthesized layer should be. ambience.ts plays them. Plain data in, plain data out, so the tests
 * run in Node with no audio at all.
 *
 * **Presentation only.** It reads the state the page draws and never touches the sim or its RNG.
 */

import { ACTIONS, parseItem } from '../artificer/region1';
import { sceneFor, type BackdropUi, type BdPlace, type BdSeason, type BdTime, type BdWeather, NO_UI } from './backdrop';
import type { AppState } from './controller';
import type { DayPlay, Moment } from './playback';

/** The ui switch (features.ts): the Meny's Sound section. The sound itself stays off until turned on. */
export const AMBIENCE_FEATURE = 'ambience';

/** What the mix is worked out from. */
export interface AmbienceInput {
  weather: BdWeather;
  /** A storm in winter: howling wind and snow, no rain or thunder. */
  blizzard: boolean;
  season: BdSeason;
  time: BdTime;
  place: BdPlace;
  /** The camp fire is going (`fireLit`). */
  fire: boolean;
  /** Clarity as a share of its cap, 0–1. */
  clarity: number;
  /** Out on the land (a trip's walk or work while the day plays out), not at camp. */
  out: boolean;
  /** The player's volume, 0–1. */
  volume: number;
}

/**
 * The layer levels, each 0–1 (the engine scales them to gains). `thunderRate` is how often thunder
 * rolls (0 never); `echo` is a cave's reverb; `unease` the low undertone of a worn mind.
 */
export interface AmbienceMix {
  wind: number;
  gusts: number;
  rain: number;
  /** The snow hush: high sounds swallowed by falling or lying snow. */
  snow: number;
  fire: number;
  stream: number;
  drips: number;
  thunderRate: number;
  echo: number;
  unease: number;
  master: number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const round2 = (x: number): number => Math.round(x * 100) / 100;

type Base = Pick<AmbienceMix, 'wind' | 'gusts' | 'rain' | 'snow' | 'drips' | 'thunderRate'>;
/** Each sky's own sound, from the listening page's scenes (#1828). A blizzard is `BLIZZARD`. */
const WEATHER: Readonly<Record<BdWeather, Base>> = {
  clear: { wind: 0.2, gusts: 0.2, rain: 0, snow: 0, drips: 0, thunderRate: 0 },
  overcast: { wind: 0.3, gusts: 0.3, rain: 0, snow: 0, drips: 0, thunderRate: 0 },
  rain: { wind: 0.4, gusts: 0.45, rain: 0.7, snow: 0, drips: 0.3, thunderRate: 0 },
  fog: { wind: 0.08, gusts: 0.05, rain: 0, snow: 0, drips: 0.55, thunderRate: 0 },
  wind: { wind: 0.7, gusts: 0.7, rain: 0, snow: 0, drips: 0, thunderRate: 0 },
  storm: { wind: 0.7, gusts: 0.85, rain: 0.9, snow: 0, drips: 0.4, thunderRate: 0.6 },
  snow: { wind: 0.25, gusts: 0.2, rain: 0, snow: 0.7, drips: 0, thunderRate: 0 },
};
const BLIZZARD: Base = { wind: 0.95, gusts: 0.95, rain: 0, snow: 0.35, drips: 0, thunderRate: 0 };

/**
 * The time of day: `level` the whole bed, `wind` how much of the wind is left (it settles at dusk),
 * `sparse` how many of the scattered sounds (drips, gusts) still come. Quieter and sparser at night.
 */
const TIME: Readonly<Record<BdTime, { level: number; wind: number; sparse: number }>> = {
  night: { level: 0.75, wind: 0.8, sparse: 0.6 },
  dawn: { level: 0.85, wind: 0.8, sparse: 0.8 },
  morning: { level: 1, wind: 1, sparse: 1 },
  midday: { level: 1, wind: 1, sparse: 1 },
  afternoon: { level: 1, wind: 1, sparse: 1 },
  evening: { level: 0.9, wind: 0.75, sparse: 0.9 },
  dusk: { level: 0.85, wind: 0.7, sparse: 0.8 },
};

/**
 * Where you are: how much wind and rain reach you, the stream's nearness, a cave's drips and echo.
 * The open woods (out on the land, or before camp is made) take the weather as it comes.
 */
const PLACE: Readonly<Record<BdPlace, { wind: number; rain: number; stream: number; drips: number; echo: number }>> = {
  woods: { wind: 0.85, rain: 1, stream: 1, drips: 0, echo: 0 },
  tree: { wind: 0.6, rain: 0.8, stream: 1, drips: 0, echo: 0 },
  hill: { wind: 1.35, rain: 1, stream: 0.4, drips: 0, echo: 0 },
  river: { wind: 0.9, rain: 1, stream: 3.5, drips: 0, echo: 0 },
  cave: { wind: 0.3, rain: 0.35, stream: 0.5, drips: 0.45, echo: 0.55 },
  road: { wind: 1, rain: 1, stream: 0, drips: 0, echo: 0 },
  village: { wind: 0.7, rain: 0.9, stream: 0, drips: 0, echo: 0 },
};

/** The stream far off, as the woods always have it; more after rain and in the thaw, little under ice. */
const STREAM_FAR = 0.15;
const STREAM_SEASON: Readonly<Record<BdSeason, number>> = { 'early-autumn': 1, 'late-autumn': 1.1, 'first-snow': 0.5, 'deep-winter': 0.35, thaw: 1.8 };
/** Meltwater: drips off every branch in the thaw. */
const THAW_DRIPS = 0.4;
/** The fire's crackle, and how much rain dampens it. */
const FIRE = 0.55;
/** Below this share of Clarity the undertone creeps in (the status bar's warning band); full at `LOW_FULL`. */
const UNEASE_FROM = 0.45;
const UNEASE_FULL = 0.1;

/** The layer levels for a moment of the game. Same input, same mix (rounded, so it compares cheaply). */
export function mixFor(i: AmbienceInput): AmbienceMix {
  const w = i.blizzard ? BLIZZARD : WEATHER[i.weather];
  const time = TIME[i.time];
  // Out on the land the camp site's shelter is behind you: the open woods.
  const p = PLACE[i.out ? 'woods' : i.place];
  const wind = w.wind * p.wind * time.wind;
  const rain = w.rain * p.rain;
  const stream = (STREAM_FAR + (w.rain > 0 ? 0.1 : 0)) * STREAM_SEASON[i.season] * p.stream;
  const drips = (w.drips + (i.season === 'thaw' ? THAW_DRIPS : 0) + p.drips) * time.sparse;
  // A fire only at camp; heavy rain beats it down, and a storm's rain more so.
  const fire = i.fire && !i.out ? FIRE * (1 - 0.5 * rain) : 0;
  const unease = clamp01((UNEASE_FROM - i.clarity) / (UNEASE_FROM - UNEASE_FULL));
  return {
    wind: round2(clamp01(wind)),
    gusts: round2(clamp01(w.gusts * time.sparse * (i.place === 'hill' && !i.out ? 1.2 : 1))),
    rain: round2(clamp01(rain)),
    snow: round2(clamp01(w.snow)),
    fire: round2(clamp01(fire)),
    stream: round2(clamp01(stream)),
    drips: round2(clamp01(drips)),
    thunderRate: round2(clamp01(w.thunderRate * time.sparse)),
    echo: i.out ? 0 : p.echo,
    unease: round2(unease),
    master: round2(clamp01(i.volume) * time.level),
  };
}

/** A mix as a string: the engine is told only when this changes. */
export const mixKey = (m: AmbienceMix): string => Object.values(m).join('|');

/**
 * The camp fire, as the page can tell it: there's a camp, the Warden is at it, it's dark (the Plan
 * screen's night, dusk or dawn while the day plays), and there's wood to burn. The sim keeps no
 * "lit" flag (the night's fire is burned at the day's end, region1.ts `keepFire`), so this is what
 * the evening looks like, not a rule.
 */
export function fireLit(o: { site: string | null; firewood: number; time: BdTime; out: boolean }): boolean {
  return o.site !== null && !o.out && o.firewood > 0 && (o.time === 'night' || o.time === 'dusk' || o.time === 'dawn' || o.time === 'evening');
}

/**
 * Out on the land while the day plays out: a trip's leg (out, work or back, #1668), or an action
 * that goes out into the rings (foraging, hunting, fetching water…). The night's lines are at camp.
 */
export function isOut(p: DayPlay, m: Moment): boolean {
  const st = p.steps[m.index];
  if (!st || m.index < 0) return false;
  if (m.phase) return true;
  return !!ACTIONS[parseItem(st.item).id]?.ringed;
}

/**
 * The input for the state as the page draws it: the backdrop's scene (weather, season, time, place),
 * the fire, the Clarity bar (the road's own vitals on the road), and whether the Warden is out.
 */
export function inputFor(a: AppState, o: { ui?: BackdropUi; out?: boolean; volume: number }): AmbienceInput {
  const sc = sceneFor(a, o.ui ?? NO_UI);
  const out = !!o.out;
  const road = a.stage === 'road' && a.road;
  const c = road ? a.road!.vitals.clarity : a.sim.vitals.clarity;
  return {
    weather: sc.weather, blizzard: sc.blizzard, season: sc.season, time: sc.time, place: sc.place,
    fire: road ? false : fireLit({ site: a.sim.site, firewood: a.sim.stores.firewood, time: sc.time, out }),
    clarity: c.cap > 0 ? c.current / c.cap : 1,
    out,
    volume: o.volume,
  };
}
