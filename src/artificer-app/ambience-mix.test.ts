/**
 * The ambient sound's mix (#1828): `mixFor` turns what the page shows (the weather, the time of
 * day, the place, the fire, Clarity, out on the land or at camp) into layer levels. No audio here:
 * the engine (ambience.ts) only plays what this says.
 */

import { describe, expect, it } from 'vitest';
import { FEATURES, featureById, ruleFeatures, uiFeatureOn } from '../artificer/features';
import type { Region1State } from '../artificer/region1';
import type { WeatherId } from '../artificer/world';
import { makeWarden, serialize, type AppState } from './controller';
import { AMBIENCE_FEATURE, fireLit, inputFor, isOut, mixFor, mixKey, type AmbienceInput } from './ambience-mix';
import type { DayPlay, Moment, PlayStep } from './playback';

/** A calm early-autumn night at a tree-line camp, the fire out, a clear mind, at camp, full volume. */
const calm: AmbienceInput = {
  weather: 'clear', blizzard: false, season: 'early-autumn', time: 'midday', place: 'tree',
  fire: false, clarity: 1, out: false, volume: 1,
};
const at = (more: Partial<AmbienceInput>) => mixFor({ ...calm, ...more });

describe('the ambience ui feature (#1828)', () => {
  it('is a ui feature, experimental, on by default, registered last, and no run saves it', () => {
    expect(featureById(AMBIENCE_FEATURE)).toMatchObject({ kind: 'ui', stage: 'experimental', default: true, absent: false, issue: 1828 });
    expect(uiFeatureOn({}, AMBIENCE_FEATURE)).toBe(true);
    expect(Object.keys(ruleFeatures())).not.toContain(AMBIENCE_FEATURE);
    expect(FEATURES.at(-1)?.id).toBe(AMBIENCE_FEATURE);
  });
});

describe('the weather (#1828)', () => {
  it('rain brings the rain layer up (and drips off the branches); a clear day has none', () => {
    expect(at({}).rain).toBe(0);
    const wet = at({ weather: 'rain' });
    expect(wet.rain).toBeGreaterThan(0.4);
    expect(wet.drips).toBeGreaterThan(0);
    expect(wet.stream).toBeGreaterThan(at({}).stream);
  });

  it('a storm adds thunder and harder wind; a winter storm is a blizzard: wind and snow, no rain or thunder', () => {
    const storm = at({ weather: 'storm' });
    expect(storm.thunderRate).toBeGreaterThan(0);
    expect(storm.wind).toBeGreaterThan(at({ weather: 'clear' }).wind);
    expect(storm.rain).toBeGreaterThan(at({ weather: 'rain' }).rain);
    const blizzard = at({ weather: 'storm', blizzard: true, season: 'deep-winter' });
    expect(blizzard).toMatchObject({ rain: 0, thunderRate: 0 });
    expect(blizzard.snow).toBeGreaterThan(0);
    expect(blizzard.wind).toBeGreaterThan(storm.wind);
    for (const w of ['clear', 'overcast', 'rain', 'fog', 'wind', 'snow'] as const) expect(at({ weather: w }).thunderRate, w).toBe(0);
  });

  it('snow hushes; fog drips with almost no wind; a windy day blows', () => {
    expect(at({ weather: 'snow' }).snow).toBeGreaterThan(0.5);
    expect(at({ weather: 'rain' }).snow).toBe(0);
    const fog = at({ weather: 'fog' });
    expect(fog.drips).toBeGreaterThan(0.3);
    expect(fog.wind).toBeLessThan(at({}).wind);
    expect(at({ weather: 'wind' }).wind).toBeGreaterThan(at({ weather: 'overcast' }).wind);
  });

  it('the thaw runs with meltwater; deep winter\'s stream is under ice', () => {
    expect(at({ season: 'thaw' }).stream).toBeGreaterThan(at({}).stream);
    expect(at({ season: 'thaw' }).drips).toBeGreaterThan(0);
    expect(at({ season: 'deep-winter' }).stream).toBeLessThan(at({}).stream);
  });
});

describe('the time of day (#1828)', () => {
  it('night is quieter and sparser: a lower master, less wind, fewer drips and gusts', () => {
    const day = at({ weather: 'rain' }), night = at({ weather: 'rain', time: 'night' });
    expect(night.master).toBeLessThan(day.master);
    expect(night.wind).toBeLessThan(day.wind);
    expect(night.drips).toBeLessThan(day.drips);
    expect(night.gusts).toBeLessThan(day.gusts);
  });

  it('the wind settles at dusk', () => {
    expect(at({ weather: 'wind', time: 'dusk' }).wind).toBeLessThan(at({ weather: 'wind', time: 'afternoon' }).wind);
  });
});

describe('the place (#1828)', () => {
  it('a river site has the stream right there', () => {
    expect(at({ place: 'river' }).stream).toBeGreaterThan(at({ place: 'tree' }).stream * 2);
    expect(at({ place: 'river' }).stream).toBeGreaterThan(0.4);
  });

  it('a cave drips and echoes, and keeps the wind and rain outside', () => {
    const cave = at({ place: 'cave', weather: 'rain' });
    expect(cave.drips).toBeGreaterThan(at({ place: 'tree', weather: 'rain' }).drips);
    expect(at({ place: 'cave' }).drips).toBeGreaterThan(0);
    expect(cave.echo).toBeGreaterThan(0);
    expect(at({ place: 'tree' }).echo).toBe(0);
    expect(cave.wind).toBeLessThan(at({ place: 'tree', weather: 'rain' }).wind);
    expect(cave.rain).toBeLessThan(at({ place: 'tree', weather: 'rain' }).rain);
  });

  it('a hilltop is open to every gust', () => {
    expect(at({ place: 'hill', weather: 'wind' }).wind).toBeGreaterThan(at({ place: 'tree', weather: 'wind' }).wind);
    expect(at({ place: 'hill' }).gusts).toBeGreaterThan(at({ place: 'tree' }).gusts);
  });
});

describe('the fire and the mind (#1828)', () => {
  it('a lit fire crackles; rain beats it down; none without one', () => {
    expect(at({}).fire).toBe(0);
    const fire = at({ fire: true });
    expect(fire.fire).toBeGreaterThan(0.3);
    expect(at({ fire: true, weather: 'rain' }).fire).toBeLessThan(fire.fire);
  });

  it('low Clarity brings the unease in, subtly: none in the warning band\'s top, full near empty', () => {
    expect(at({ clarity: 1 }).unease).toBe(0);
    expect(at({ clarity: 0.5 }).unease).toBe(0);
    const low = at({ clarity: 0.3 }).unease;
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(1);
    expect(at({ clarity: 0.05 }).unease).toBe(1);
  });
});

describe('out on the land vs at camp (#1828)', () => {
  it('out on the land: no fire, no cave echo, and the open woods\' wind rather than the camp\'s shelter', () => {
    const camp = at({ place: 'cave', fire: true, weather: 'wind' });
    const out = at({ place: 'cave', fire: true, weather: 'wind', out: true });
    expect(camp.fire).toBeGreaterThan(0);
    expect(out.fire).toBe(0);
    expect(out.echo).toBe(0);
    expect(out.wind).toBeGreaterThan(camp.wind);
    // The river is behind you too.
    expect(at({ place: 'river', out: true }).stream).toBeLessThan(at({ place: 'river' }).stream);
  });

  it('isOut: a trip\'s leg, or a ringed action, is out; an action at camp and the night\'s lines are not', () => {
    const step = (item: string, phases: PlayStep['phases'] = null) => ({ item, phases }) as unknown as PlayStep;
    const play = { steps: [step('study'), step('gather'), step('wood', [{ kind: 'out', trip: 1, trips: 1, hours: 1 }])] } as unknown as DayPlay;
    const m = (index: number, phase: Moment['phase'] = null) => ({ index, phase }) as Moment;
    expect(isOut(play, m(0))).toBe(false);
    expect(isOut(play, m(1))).toBe(true);
    expect(isOut(play, m(2, { kind: 'back', trip: 1, trips: 1, hours: 1 }))).toBe(true);
    expect(isOut(play, m(3))).toBe(false);
    expect(isOut(play, m(-1))).toBe(false);
  });
});

describe('the volume, and the mix as a key (#1828)', () => {
  it('master follows the volume, clamped', () => {
    expect(at({ volume: 0.5 }).master).toBe(0.5);
    expect(at({ volume: 0 }).master).toBe(0);
    expect(at({ volume: 3 }).master).toBe(1);
  });

  it('the same input gives the same mix and key; a change changes the key', () => {
    expect(mixFor(calm)).toEqual(mixFor({ ...calm }));
    expect(mixKey(mixFor(calm))).toBe(mixKey(mixFor(calm)));
    expect(mixKey(at({ weather: 'rain' }))).not.toBe(mixKey(mixFor(calm)));
  });

  it('every level stays within 0–1 across the whole space', () => {
    for (const weather of ['clear', 'overcast', 'rain', 'fog', 'wind', 'storm', 'snow'] as const)
      for (const place of ['woods', 'cave', 'tree', 'river', 'hill', 'road', 'village'] as const)
        for (const time of ['night', 'dawn', 'midday', 'dusk'] as const)
          for (const out of [false, true]) {
            const mx = mixFor({ ...calm, weather, place, time, out, fire: true, clarity: 0, season: 'thaw' });
            for (const [k, v] of Object.entries(mx)) { expect(v, `${weather}/${place}/${time}/${k}`).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
          }
  });
});

describe('from the state the page draws (#1828)', () => {
  const base = makeWarden({ id: 'w-1828', name: 'Astrid' });
  const state = (weatherToday: WeatherId, more: Partial<Region1State> = {}): AppState =>
    ({ ...base, sim: { ...structuredClone(base.sim), day: 5, weatherToday, canPlan: true, ...more } });

  it('reads the weather, the site and the night from the state, without changing it', () => {
    const a = state('rain', { site: 'river', stores: { ...base.sim.stores, firewood: 3 } });
    const before = serialize(a);
    const i = inputFor(a, { volume: 0.6 });
    expect(serialize(a)).toBe(before);
    expect(i).toMatchObject({ weather: 'rain', place: 'river', time: 'night', fire: true, out: false, volume: 0.6 });
    const mx = mixFor(i);
    expect(mx.rain).toBeGreaterThan(0);
    expect(mx.stream).toBeGreaterThan(0.4);
  });

  it('no fire before camp, without wood, or out on the land', () => {
    expect(inputFor(state('clear'), { volume: 1 }).fire).toBe(false);
    expect(inputFor(state('clear', { site: 'tree', stores: { ...base.sim.stores, firewood: 0 } }), { volume: 1 }).fire).toBe(false);
    expect(inputFor(state('clear', { site: 'tree', stores: { ...base.sim.stores, firewood: 2 } }), { volume: 1, out: true }).fire).toBe(false);
  });

  it('fireLit: at camp, in the dark hours, with wood', () => {
    const f = { site: 'tree', firewood: 1, out: false } as const;
    expect(fireLit({ ...f, time: 'night' })).toBe(true);
    expect(fireLit({ ...f, time: 'dusk' })).toBe(true);
    expect(fireLit({ ...f, time: 'midday' })).toBe(false);
    expect(fireLit({ ...f, site: null, time: 'night' } as never)).toBe(false);
  });

  it('low Clarity in the state is the unease', () => {
    const a = state('clear', { vitals: { ...base.sim.vitals, clarity: { ...base.sim.vitals.clarity, current: base.sim.vitals.clarity.cap * 0.1 } } });
    expect(mixFor(inputFor(a, { volume: 1 })).unease).toBe(1);
  });
});
