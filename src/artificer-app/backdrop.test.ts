/**
 * The living backdrop (#1802): `sceneFor` reads the state the page draws (and the timer's clock)
 * into a scene, and `paletteFor` turns it into what the canvas draws with. Over the five inputs:
 * season × weather, the places, the time of day and the three moods, and that it never says more
 * than the weather box does.
 */

import { describe, expect, it } from 'vitest';
import { FEATURES, featureById, ruleFeatures, uiFeatureOn } from '../artificer/features';
import { tonightsFright, type Region1State, type SiteId } from '../artificer/region1';
import { createRoad, ROUTE } from '../artificer/road';
import { weatherReport } from '../artificer/weather-words';
import type { WeatherId } from '../artificer/world';
import { en as EN } from '../artificer/i18n/en';
import { sv as SV } from '../artificer/i18n/sv';
import { makeWarden, serialize, type AppState } from './controller';
import { BACKDROP_FEATURE, NO_UI, loadStill, lowness, mix, moves, paletteFor, saveStill, sceneFor, sceneKey, timeAt, type BdSeason, type BdWeather } from './backdrop';

const base = makeWarden({ id: 'w-1802', name: 'Astrid' });
/** The Warden on a day, under a weather, with whatever else the case needs. */
function at(day: number, weatherToday: WeatherId, more: Partial<Region1State> = {}): AppState {
  return { ...base, sim: { ...structuredClone(base.sim), day, weatherToday, canPlan: true, ...more } };
}
/** One day in each season, as the eye tells it (DEFAULT_CALENDAR: snow on day 31, thaw on 61). */
const SEASON_DAYS: Readonly<Record<BdSeason, number>> = { 'early-autumn': 3, 'late-autumn': 22, 'first-snow': 33, 'deep-winter': 45, thaw: 58 };
const WEATHERS: readonly WeatherId[] = ['clear', 'overcast', 'rain', 'fog', 'wind', 'storm', 'snow'];

describe('A new run opens on the dark autumn night (#1802)', () => {
  it('Given a new Warden on the Plan screen, the scene is early autumn, at night, in the woods, and calm', () => {
    const sc = sceneFor(base);
    expect(sc).toMatchObject({ season: 'early-autumn', time: 'night', place: 'woods', snow: 0, blizzard: false });
    expect(sc.mood).toEqual({ vignette: 0, fear: 0, frost: 0 });
    // Dark: most of the light gone, the birches still in leaf.
    const p = paletteFor(sc);
    expect(p.dark).toBeGreaterThanOrEqual(0.8);
    expect(p.leafAmt).toBe(1);
  });

  it('reads the state without changing it', () => {
    const a = at(20, 'storm');
    const before = serialize(a);
    sceneFor(a, { clock: 12 });
    expect(serialize(a)).toBe(before);
  });
});

describe('Season × weather', () => {
  for (const [season, day] of Object.entries(SEASON_DAYS) as [BdSeason, number][]) {
    for (const w of WEATHERS) {
      it(`${season}, ${w}: the season, the sky, and what moves`, () => {
        const sc = sceneFor(at(day, w));
        expect(sc.season).toBe(season);
        expect(sc.weather).toBe(w);
        const winter = season === 'first-snow' || season === 'deep-winter' || season === 'thaw';
        // A storm once the snow has come is a blizzard, as the weather box names it.
        expect(sc.blizzard).toBe(w === 'storm' && winter);
        const p = paletteFor(sc);
        expect(p.rain > 0).toBe(w === 'rain' || (w === 'storm' && !winter));
        expect(p.flakes > 0).toBe(w === 'snow' || (w === 'storm' && winter));
        expect(p.fog > 0).toBe(w === 'fog' || w === 'rain' || (w === 'storm' && winter));
        // Blown leaves only while there are leaves to blow.
        expect(p.leaves > 0).toBe(w === 'wind' && p.leafAmt > 0);
        expect(moves(p)).toBe(w !== 'clear' && w !== 'overcast' && !(w === 'wind' && p.leafAmt === 0));
        // Stars and the moon only under a clear night sky.
        expect(p.stars > 0).toBe(w === 'clear');
        expect(p.glow !== null).toBe(w === 'clear');
      });
    }
  }

  it('the birches lose their leaves through the autumn and green again at the thaw', () => {
    const leaf = (s: BdSeason): number => paletteFor(sceneFor(at(SEASON_DAYS[s], 'clear'))).leafAmt;
    expect(leaf('early-autumn')).toBeGreaterThan(leaf('late-autumn'));
    expect(leaf('late-autumn')).toBeGreaterThan(0);
    expect(leaf('first-snow')).toBe(0);
    expect(leaf('deep-winter')).toBe(0);
    expect(leaf('thaw')).toBeGreaterThan(0);
  });

  it('a storm and a blizzard are darker than a clear night', () => {
    const dark = (day: number, w: WeatherId): number => paletteFor(sceneFor(at(day, w))).dark;
    expect(dark(20, 'storm')).toBeGreaterThan(dark(20, 'clear'));
    expect(dark(45, 'storm')).toBeGreaterThan(dark(45, 'snow'));
  });
});

describe('It says no more than the weather box', () => {
  it('the snow on the ground is the box\'s band, never the depth', () => {
    const scene = (snowDepth: number) => sceneFor(at(45, 'clear', { snowDepth }));
    // 0.25 and 0.4 are both "ankle-deep" in the box: the same scene.
    expect(sceneKey(scene(0.25))).toBe(sceneKey(scene(0.4)));
    expect(scene(0.25).snow).toBe(0.5);
    expect(scene(0).snow).toBe(0);
    expect(scene(0.1).snow).toBe(0.25);
    expect(scene(0.6).snow).toBe(0.75);
    expect(scene(0.9).snow).toBe(1);
    // And it follows the report the box is written from.
    for (const d of [0, 0.1, 0.3, 0.6, 0.9]) expect(scene(d).snow > 0).toBe(weatherReport(at(45, 'clear', { snowDepth: d }).sim).ground !== null);
  });

  it('the season is the box\'s season word, never the day count: two days in the same part of autumn look the same', () => {
    expect(sceneKey(sceneFor(at(3, 'overcast')))).toBe(sceneKey(sceneFor(at(5, 'overcast'))));
    expect(sceneKey(sceneFor(at(46, 'snow', { snowDepth: 0.5 })))).toBe(sceneKey(sceneFor(at(48, 'snow', { snowDepth: 0.5 }))));
  });

  it('in a world without weather (no sky in the box) there is no weather to show, and no snow', () => {
    const flat = at(45, 'storm', { snowDepth: 0.9, config: { ...base.sim.config, world: { ...base.sim.config.world, weather: 'clear' } } });
    expect(weatherReport(flat.sim).sky).toBeNull();
    const sc = sceneFor(flat);
    expect(sc).toMatchObject({ weather: 'overcast', blizzard: false, snow: 0 });
    expect(sc.mood.frost).toBe(0);
  });
});

describe('The place', () => {
  const sites: [SiteId, string][] = [['cave', 'cave'], ['tree', 'tree'], ['river', 'river'], ['hill', 'hill']];
  for (const [site, place] of sites) {
    it(`camp at the ${site}: the ${place} foreground`, () => {
      expect(sceneFor(at(10, 'clear', { site })).place).toBe(place);
    });
  }

  it('before camp is made, the woods where you came to', () => {
    expect(sceneFor(at(10, 'clear', { site: null })).place).toBe('woods');
  });

  it('on the road: the track between villages, the roofs in one, on a clear thaw night without cold', () => {
    const a = at(61, 'clear', { site: 'tree' });
    a.sim.outcome = { choice: 'thaw', kind: 'survived', grade: 'hale', vitals: a.sim.vitals };
    const road = createRoad(a.sim);
    const travel = ROUTE.findIndex(l => l.kind === 'travel');
    const village = ROUTE.findIndex(l => l.kind === 'village');
    const on = (leg: number): AppState => ({ ...a, stage: 'road', road: { ...road, leg } });
    expect(sceneFor(on(travel))).toMatchObject({ place: 'road', season: 'thaw', weather: 'clear', time: 'night', snow: 0 });
    expect(sceneFor(on(village)).place).toBe('village');
    expect(sceneFor(on(village)).mood).toMatchObject({ fear: 0, frost: 0 });
  });

  it('the place changes the scene, so the canvas redraws', () => {
    expect(sceneKey(sceneFor(at(10, 'clear', { site: 'cave' })))).not.toBe(sceneKey(sceneFor(at(10, 'clear', { site: 'river' }))));
  });
});

describe('The time of day', () => {
  it('Given the Plan screen, before the day runs, it is night', () => {
    expect(sceneFor(at(10, 'clear'), NO_UI).time).toBe('night');
  });

  it('While the day plays out it lightens with the timer\'s clock, by the parts of the day the time words tell', () => {
    const cal = base.sim.config.calendar;
    // Day 1: sunrise 7:00, sunset 18:30, twilight an hour either side.
    expect(timeAt(1, 6.5, cal)).toBe('dawn');
    expect(timeAt(1, 9, cal)).toBe('morning');
    expect(timeAt(1, 12.75, cal)).toBe('midday');
    expect(timeAt(1, 15.5, cal)).toBe('afternoon');
    expect(timeAt(1, 18, cal)).toBe('evening');
    expect(timeAt(1, 19, cal)).toBe('dusk');
    expect(timeAt(1, 20, cal)).toBe('night');
    // Deep winter: still dark at six.
    expect(timeAt(45, 6, cal)).toBe('night');
    const dark = (clock: number): number => paletteFor(sceneFor(at(1, 'clear'), { clock })).dark;
    expect(dark(6.5)).toBeGreaterThan(dark(9));
    expect(dark(9)).toBeGreaterThan(dark(12.75));
    expect(paletteFor(sceneFor(at(1, 'clear'))).dark).toBeGreaterThan(dark(6.5));
  });

  it('once the day\'s work is done and the night\'s lines come, dusk', () => {
    expect(sceneFor(at(10, 'clear'), { clock: 14, night: true }).time).toBe('dusk');
  });
});

describe('The mood', () => {
  it('low Vigor or Clarity darkens the edges, more the lower they are; both out of the warning band, none', () => {
    const v = (vig: number, cla: number) => ({ vigor: { current: vig, cap: 100 }, clarity: { current: cla, cap: 100 } });
    expect(lowness(v(100, 100))).toBe(0);
    expect(lowness(v(50, 46))).toBe(0);
    expect(lowness(v(100, 30))).toBeGreaterThan(0);
    expect(lowness(v(20, 100))).toBeGreaterThan(lowness(v(30, 100)));
    expect(lowness(v(5, 100))).toBe(1);
    const worn = at(5, 'overcast');
    worn.sim.vitals.vigor.current = worn.sim.vitals.vigor.cap * 0.15;
    expect(sceneFor(worn).mood.vignette).toBeGreaterThan(0.7);
    expect(sceneFor(at(5, 'overcast')).mood.vignette).toBe(0);
  });

  it('a frightening night ahead turns the edges red-dark, as the status bar\'s 🌑 chip shows it; a calm night, none', () => {
    const scary = at(7, 'fog');
    const f = tonightsFright(scary.sim);
    expect(f?.state).not.toBe('calm');
    expect(sceneFor(scary).mood.fear).toBe(f?.state === 'panicked' ? 1 : 0.6);
    expect(tonightsFright(base.sim)?.state).toBe('calm');
    expect(sceneFor(base).mood.fear).toBe(0);
    // A run that's over has no night ahead.
    const over: AppState = { ...scary, sim: { ...scary.sim, outcome: { choice: 'collapse', kind: 'collapsed', grade: 'broken', vitals: scary.sim.vitals } } };
    expect(sceneFor(over).mood.fear).toBe(0);
  });

  it('frost creeps in from the corners with the cold as the box says it: none when mild, all of it when bitter', () => {
    const frost = (day: number) => sceneFor(at(day, 'clear')).mood.frost;
    const felt = (day: number) => weatherReport(at(day, 'clear').sim).felt;
    expect(felt(3)).toBe('mild');
    expect(frost(3)).toBe(0);
    expect(felt(45)).toBe('bitter');
    expect(frost(45)).toBe(1);
    // In between, more the colder.
    const days = [3, 15, 25, 33, 40, 45];
    const f = days.map(frost);
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeGreaterThanOrEqual(f[i - 1]);
  });

  it('the mood never changes the still scene (only its own layers), so the canvas doesn\'t redraw for it', () => {
    const worn = at(5, 'overcast');
    worn.sim.vitals.vigor.current = 1;
    expect(sceneKey(sceneFor(worn))).toBe(sceneKey(sceneFor(at(5, 'overcast'))));
  });
});

describe('The palette', () => {
  it('mixes colours as #rrggbb', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#102030', '#102030', 0.7)).toBe('#102030');
    expect(mix('#000000', '#ffffff', 2)).toBe('#ffffff');
  });

  it('every scene\'s colours are #rrggbb, and the dark stays in 0–1', () => {
    for (const day of Object.values(SEASON_DAYS)) for (const w of WEATHERS) for (const site of [null, 'cave', 'river'] as const) {
      const p = paletteFor(sceneFor(at(day, w, { site }), { clock: 12 }));
      for (const c of [...p.sky, p.spruce, p.birch, p.leaf, p.ground, p.rock, p.water]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      expect(p.dark).toBeGreaterThan(0);
      expect(p.dark).toBeLessThanOrEqual(0.92);
    }
  });
});

describe('The backdrop ui feature (#1802)', () => {
  it('is a ui feature, experimental, on by default, that a player can switch off and no run saves', () => {
    const f = featureById(BACKDROP_FEATURE);
    expect(f).toMatchObject({ kind: 'ui', stage: 'experimental', default: true, absent: false, issue: 1802 });
    expect(f?.note).toBeTruthy();
    expect(uiFeatureOn({}, BACKDROP_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [BACKDROP_FEATURE]: false }, BACKDROP_FEATURE)).toBe(false);
    expect(Object.keys(ruleFeatures())).not.toContain(BACKDROP_FEATURE);
    // Registered after the guide, the last before it.
    const ids = FEATURES.map(x => x.id);
    expect(ids.indexOf(BACKDROP_FEATURE)).toBe(ids.indexOf('guide') + 1);
  });

  it('nothing of it is in the save', () => {
    const s = serialize(base);
    expect(s).not.toContain('backdrop');
  });

  it('keeps "Keep it still" in the browser, and a store that refuses is no harm', () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    expect(loadStill(store)).toBe(false);
    saveStill(true, store);
    expect(loadStill(store)).toBe(true);
    saveStill(false, store);
    expect(loadStill(store)).toBe(false);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(loadStill(broken)).toBe(false);
    expect(() => saveStill(true, broken)).not.toThrow();
    expect(loadStill(null)).toBe(false);
  });

  it('has its control\'s words in English and Swedish', () => {
    const keys = Object.keys(EN).filter(k => k.startsWith('backdrop.'));
    expect(keys.length).toBe(3);
    for (const k of keys) expect((SV as Record<string, string>)[k], k).toBeTruthy();
  });
});

// The scene's weather is one of these, whatever the state.
const _check: BdWeather[] = ['clear', 'overcast', 'rain', 'fog', 'wind', 'storm', 'snow'];
void _check;
