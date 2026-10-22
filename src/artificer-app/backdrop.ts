/**
 * The living backdrop (#1802): the page behind the boxes shows the season, today's weather, the time
 * of day, the place and how the Warden feels. The owner's direction: "a dark, woody autumn-night feel
 * to start; a murky background image that is slightly visible; a blend of season, weather, mood, time
 * of day and area."
 *
 * This module is the pure half: `sceneFor` reads the game's state (and, while a day plays out on the
 * timer, the clock) and says what the scene is; `paletteFor` turns a scene into the colours and
 * amounts the canvas draws with. Both are plain data in, plain data out, so the tests run in Node.
 * The drawing is backdrop-view.ts.
 *
 * **It never says more than the weather box.** Everything comes from what the page already shows:
 * the weather and season are read through `weatherReport` (weather-words.ts), the same report the
 * weather box is written from, so the snow on the ground is its band ("ankle-deep"), never the
 * depth the box hides; the season is the box's season word ("autumn closing in on winter"), never
 * the day count; the time of day is the part of the day the timer already tells ("early morning,
 * the sun just up"); the fright is `tonightsFright`, which the status bar's 🌑 chip shows; the
 * vitals are the status bar's bars.
 *
 * **Presentation only.** No sim or save change: a ui feature (`backdrop`, features.ts), switched
 * per browser, and with it off the page is exactly as before. The play API, the console and AI
 * players never see it.
 */

import { tonightsFright } from '../artificer/region1';
import { weatherReport, type GroundWord, type SeasonWord, type FeltWord } from '../artificer/weather-words';
import { lightAt } from '../artificer/clock';
import { dayShape, partAt } from '../artificer/time-words';
import { ROUTE } from '../artificer/road';
import type { AppState } from './controller';

/** The ui switch (features.ts). */
export const BACKDROP_FEATURE = 'backdrop';

// ── The scene ───────────────────────────────────────────────────────────────

/** Five seasons, as the eye tells them: the birches' leaves and the snow on the ground. */
export type BdSeason = 'early-autumn' | 'late-autumn' | 'first-snow' | 'deep-winter' | 'thaw';
/** Today's sky. A storm in winter is a blizzard (`blizzard`). */
export type BdWeather = 'clear' | 'overcast' | 'rain' | 'fog' | 'wind' | 'storm' | 'snow';
/** The time of day: night on the Plan screen; while a day plays out, its parts; dusk once it's done. */
export type BdTime = 'night' | 'dawn' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'dusk';
/**
 * The foreground: the camp's site (a cave's rock, the dense tree line, the river's water, the
 * hilltop's open skyline), the woods before camp is made, and on the road the track or a village.
 */
export type BdPlace = 'woods' | 'cave' | 'tree' | 'river' | 'hill' | 'road' | 'village';

export interface BdMood {
  /** The edges darken with low Vigor or Clarity, 0–1. */
  vignette: number;
  /** Red-dark edges when the night ahead is frightening, 0–1. */
  fear: number;
  /** Frost creeping in from the corners when it's cold, 0–1. */
  frost: number;
}

export interface Scene {
  season: BdSeason;
  weather: BdWeather;
  blizzard: boolean;
  time: BdTime;
  place: BdPlace;
  /** The snow on the ground, by the weather box's band: 0 bare, ¼ thin, ½ ankle, ¾ knee, 1 deep. */
  snow: number;
  mood: BdMood;
}

/** What the page knows that the state doesn't: the timer's clock while a day plays out. */
export interface BackdropUi {
  /** The clock hour (8.5 = 08:30) while the day plays on the timer; null otherwise (night). */
  clock: number | null;
  /** The timer has reached the day's end (the night's lines): dusk. */
  night?: boolean;
}

export const NO_UI: BackdropUi = { clock: null };

const SEASON_OF: Readonly<Record<SeasonWord, BdSeason>> = {
  early: 'early-autumn', mid: 'early-autumn', late: 'late-autumn', snowSoon: 'late-autumn',
  firstWinter: 'first-snow', deep: 'deep-winter', lateWinter: 'deep-winter', thawSoon: 'thaw', thaw: 'thaw',
};
const SNOW_OF: Readonly<Record<GroundWord, number>> = { thin: 0.25, ankle: 0.5, knee: 0.75, deep: 1 };
/** Frost corners by the cold as the weather box says it; milder than frosty, none. */
const FROST_OF: Readonly<Partial<Record<FeltWord, number>>> = { frosty: 0.3, hard: 0.65, bitter: 1 };
/** The fright of tonight, as the status bar's chip shows it (calm shows no chip, and no red). */
const FEAR_OF = { calm: 0, shaken: 0.6, panicked: 1 } as const;
/** Below this share of Vigor or Clarity the edges start to darken (the bars' `warn` band, html.ts `band`). */
const LOW_FROM = 0.45;
/** At or below this share, the darkest. */
const LOW_FULL = 0.1;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** How low the Warden is: 0 while both bars are out of the warning band, 1 near empty. */
export function lowness(v: { vigor: { current: number; cap: number }; clarity: { current: number; cap: number } }): number {
  const share = (p: { current: number; cap: number }): number => (p.cap > 0 ? p.current / p.cap : 0);
  const r = Math.min(share(v.vigor), share(v.clarity));
  return round2(clamp01((LOW_FROM - r) / (LOW_FROM - LOW_FULL)));
}

/** The time of day at a clock hour, as the time words tell it (time-words.ts): parts of the day, and the light. */
export function timeAt(day: number, clock: number, cal: Parameters<typeof dayShape>[1]): BdTime {
  const light = lightAt(day, clock, cal);
  if (light <= 0) return 'night';
  const part = partAt(clock, dayShape(day, cal));
  if (light < 1) return part === 'early' ? 'dawn' : 'dusk';
  return part === 'early' || part === 'morning' ? 'morning' : part === 'night' ? 'dusk' : part;
}

/**
 * The scene for the state as the page draws it. In the Reach: the weather box's report, the camp's
 * site, the vitals and tonight's fright. On the road (after the thaw, no weather, no cold nights):
 * a clear thaw night, on the track or in a village.
 */
export function sceneFor(a: AppState, ui: BackdropUi = NO_UI): Scene {
  const s = a.sim;
  if (a.stage === 'road' && a.road) {
    const leg = ROUTE[a.road.leg] ?? ROUTE[ROUTE.length - 1];
    return {
      season: 'thaw', weather: 'clear', blizzard: false, time: 'night',
      place: leg.kind === 'village' ? 'village' : 'road', snow: 0,
      mood: { vignette: lowness(a.road.vitals), fear: 0, frost: 0 },
    };
  }
  const r = weatherReport(s);
  const sky = r.sky ?? 'overcast';
  const weather = (sky === 'storm.winter' ? 'storm' : sky === 'snow.winter' ? 'snow' : sky) as BdWeather;
  const time: BdTime = ui.night ? 'dusk' : ui.clock === null ? 'night' : timeAt(s.day, ui.clock, s.config.calendar);
  const fright = s.outcome ? null : tonightsFright(s);
  return {
    season: SEASON_OF[r.season],
    weather,
    blizzard: sky === 'storm.winter',
    time,
    place: s.site ?? 'woods',
    snow: r.ground ? SNOW_OF[r.ground] : 0,
    mood: {
      vignette: lowness(s.vitals),
      fear: fright ? FEAR_OF[fright.state] : 0,
      frost: r.felt ? FROST_OF[r.felt] ?? 0 : 0,
    },
  };
}

/** A scene as a string: the canvas redraws its still layer only when this changes. */
export const sceneKey = (sc: Scene): string =>
  [sc.season, sc.weather, sc.blizzard ? 'b' : '', sc.time, sc.place, sc.snow].join('|');

// ── The palette ─────────────────────────────────────────────────────────────

export interface Palette {
  /** The sky, top to horizon. */
  sky: [string, string, string];
  spruce: string;
  birch: string;
  leaf: string;
  /** How much leaf is left on the birches, 0–1. */
  leafAmt: number;
  ground: string;
  /** Rock (the cave) and water (the river). */
  rock: string;
  water: string;
  /** A glow in the sky: the moon on a clear night, the low sun on a clear day; null under cloud. */
  glow: { x: number; y: number; color: string } | null;
  /** Stars on a clear night, 0–1. */
  stars: number;
  /** Over everything, how much is lost to the dark: the night, and the cloud. 0–1. */
  dark: number;
  /** The murk: the noise texture's opacity. */
  murk: number;
  /** Particles: rain, snow, drifting fog and blown leaves, 0–1 each; `speed` 1 is calm, more is wind. */
  rain: number;
  flakes: number;
  fog: number;
  leaves: number;
  wind: number;
}

/** Each season by day (the mock's palettes, a shade murkier); the night is the same, sunk into the dark. */
const DAY: Readonly<Record<BdSeason, Pick<Palette, 'sky' | 'spruce' | 'birch' | 'leaf' | 'leafAmt' | 'ground' | 'rock' | 'water'>>> = {
  'early-autumn': { sky: ['#4d6c8a', '#8597a0', '#b89c72'], spruce: '#263c2a', birch: '#d6ccb8', leaf: '#c08a2c', leafAmt: 1, ground: '#46421f', rock: '#4a4740', water: '#3c5664' },
  'late-autumn': { sky: ['#3d4651', '#5e6670', '#7e7c6e'], spruce: '#1f3023', birch: '#c2b9a6', leaf: '#82582c', leafAmt: 0.35, ground: '#3a3522', rock: '#45423b', water: '#344650' },
  'first-snow': { sky: ['#4e5e72', '#7f90a2', '#b2bec8'], spruce: '#24352f', birch: '#dcdad4', leaf: '#000000', leafAmt: 0, ground: '#8a8c80', rock: '#4c4f52', water: '#3e5262' },
  'deep-winter': { sky: ['#2e3a4a', '#4d5b6c', '#8693a0'], spruce: '#1a2824', birch: '#bfc4ca', leaf: '#000000', leafAmt: 0, ground: '#7a7f7c', rock: '#45494d', water: '#4a5a68' },
  thaw: { sky: ['#5c84aa', '#93adc0', '#c6bc9e'], spruce: '#294333', birch: '#e2dccf', leaf: '#86a452', leafAmt: 0.25, ground: '#6c6a4c', rock: '#525048', water: '#46647a' },
};
/** What the night sinks every colour towards: a deep blue-black, a touch warm (wood smoke, peat). */
const NIGHT = '#05070b';
const SNOW_COLOR = '#dfe6ec';
/** How much of the daylight shows at each time (0 is the night). Even midday stays murky. */
const LIGHT: Readonly<Record<BdTime, number>> = { night: 0, dawn: 0.3, morning: 0.72, midday: 0.9, afternoon: 0.78, evening: 0.5, dusk: 0.24 };
/** How much darker each weather makes it. */
const CLOUD: Readonly<Record<BdWeather, number>> = { clear: 0, overcast: 0.06, rain: 0.1, fog: 0.03, wind: 0.05, storm: 0.16, snow: 0.05 };
/** The night's dark at light 0, and what's left of it at full light. */
const DARK_NIGHT = 0.84, DARK_DAY = 0.3;

const hex = (h: string): [number, number, number] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
/** `a` of the way from one #rrggbb colour to another, as #rrggbb. */
export function mix(from: string, to: string, a: number): string {
  const p = hex(from), q = hex(to), k = clamp01(a);
  return '#' + p.map((c, i) => Math.round(c + (q[i] - c) * k).toString(16).padStart(2, '0')).join('');
}

/** The colours and amounts a scene is drawn with. */
export function paletteFor(sc: Scene): Palette {
  const d = DAY[sc.season];
  const light = LIGHT[sc.time];
  const dark = round2(Math.min(0.92, DARK_NIGHT - (DARK_NIGHT - DARK_DAY) * light + CLOUD[sc.weather] + (sc.blizzard ? 0.08 : 0)));
  // Snow brightens the ground (and lies on it in any season the box says it does).
  const ground = sc.snow > 0 ? mix(d.ground, SNOW_COLOR, 0.35 + sc.snow * 0.5) : d.ground;
  const sink = (c: string, k = 1): string => mix(c, NIGHT, dark * k);
  const clear = sc.weather === 'clear';
  const night = light < 0.35;
  return {
    sky: [sink(d.sky[0]), sink(d.sky[1]), sink(d.sky[2], 0.92)],
    spruce: sink(d.spruce, 1.04),
    birch: sink(d.birch, 0.95),
    leaf: sink(d.leaf),
    leafAmt: d.leafAmt,
    // The snow keeps a little light of its own at night.
    ground: sink(ground, sc.snow > 0 ? 0.85 : 1),
    rock: sink(d.rock),
    water: sink(d.water, 0.9),
    glow: clear ? (night
      ? { x: 0.8, y: 0.18, color: 'rgba(170,190,220,.16)' }
      : { x: sc.time === 'afternoon' || sc.time === 'evening' || sc.time === 'dusk' ? 0.78 : 0.24, y: 0.3, color: `rgba(255,220,160,${round2(0.12 + 0.2 * light)})` }) : null,
    stars: clear && night ? round2(1 - light * 2) : 0,
    dark,
    murk: 0.045,
    rain: sc.weather === 'rain' || (sc.weather === 'storm' && !sc.blizzard) ? 1 : 0,
    flakes: sc.blizzard ? 1 : sc.weather === 'snow' ? 0.55 : 0,
    fog: sc.weather === 'fog' ? 1 : sc.blizzard ? 0.35 : sc.weather === 'rain' ? 0.15 : 0,
    leaves: sc.weather === 'wind' && d.leafAmt > 0 ? 1 : 0,
    wind: sc.weather === 'storm' ? 2.4 : sc.weather === 'wind' ? 1.8 : 1,
  };
}

/** The scene has something that moves: the loop runs only then (and with motion on). */
export const moves = (p: Palette): boolean => p.rain > 0 || p.flakes > 0 || p.fog > 0 || p.leaves > 0;

// ── The motion setting under ? (per browser) ────────────────────────────────

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const MOTION_KEY = 'artificer.backdrop.still';
const storage = (): Store | null => { try { return localStorage; } catch { return null; } };

/** Whether the player has turned the backdrop's animation off ("keep it still"), for slow tablets. */
export function loadStill(store: Store | null = storage()): boolean {
  try { return store?.getItem(MOTION_KEY) === '1'; } catch { return false; }
}
export function saveStill(still: boolean, store: Store | null = storage()): void {
  try { if (still) store?.setItem(MOTION_KEY, '1'); else store?.removeItem(MOTION_KEY); } catch { /* this visit only */ }
}
