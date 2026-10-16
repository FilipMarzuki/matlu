/**
 * The weather box minimized to a row of icon chips (#1788), and its first-time card.
 *
 * The chips (weatherChips) must never say more than the full box (weather-words.ts, #1729): words at
 * the start, a rough count once the days are tallied, degrees only in the numbers view or dev mode.
 * The fold's state machine (weather-fold.ts) is pure, so it's tested here without a browser.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from '../artificer/region1';
import { FULL_WORLD, type WorldConfig } from '../artificer/world';
import { SUGGESTED_PACK, type KitId } from '../artificer/kit';
import { makeT } from '../artificer/i18n';
import { DEFAULT_CALENDAR } from '../artificer/winter';
import { isBlizzard } from '../artificer/weather';
import { weatherReport, WEATHER_WORDS } from '../artificer/weather-words';
import { weatherBox, weatherChips } from './camp-blocks';
import { weatherLines } from './sim-words';
import { ackWeather, FIRST_VISIT, loadWeatherFold, NO_STORAGE, readWeatherFold, saveWeatherFold, toggleWeather, weatherFoldState, WEATHER_FOLD_KEY, type WeatherFoldStore } from './weather-fold';

const en = makeT('en');
const sv = makeT('sv');

const world = (on: boolean): WorldConfig => ({ ...FULL_WORLD, encounters: false, features: { [WEATHER_WORDS]: on } });
const WITH_NOTEBOOK: KitId[] = [...SUGGESTED_PACK.filter(k => k !== 'weekend-food'), 'notebook'];
function warden(over: Partial<Region1State> = {}, on = true, pack: KitId[] = [...SUGGESTED_PACK]): Region1State {
  return { ...createRegion1({ world: world(on) }, undefined, { id: 'w-astrid', pack }), ...over };
}

/** Everything a chip shows or says: its word and its full sentence. */
const said = (s: Region1State, t = en, dev = false): string => weatherChips(s, t, { dev }).map(c => `${c.text} ${c.full}`).join(' ');
const DEGREES = /°|%|(?<!\p{L})h(?!\p{L})/u;

describe('weatherChips: the condensed weather box (#1788)', () => {
  it('day 1, words only: sky, cold and season in short words, no numbers at all', () => {
    const s = warden();
    const chips = weatherChips(s, en);
    expect(chips.map(c => c.id)).toEqual(['sky', 'felt', 'season']);
    expect(chips.map(c => `${c.icon} ${c.text}`)).toEqual(['☀ Clear', '🌡 Mild', '🍂 Early autumn']);
    expect(said(s)).not.toMatch(/\d|°/);
    // Each chip's full sentence is a line of the full box.
    const lines = weatherLines(s, en);
    for (const c of chips) expect(lines).toContain(c.full);
    expect(weatherChips(s, sv).map(c => c.text)).toEqual(['Klart', 'Milt', 'Tidig höst']);
  });

  it('with a tally: the season carries the rough count to the snow, as the box does', () => {
    const s = warden({ day: 5 }, true, WITH_NOTEBOOK);
    const r = weatherReport(s);
    expect(r.toSnow).not.toBeNull();
    const season = weatherChips(s, en).find(c => c.id === 'season')!;
    expect(season.text).toMatch(new RegExp(`· ≈${r.toSnow} d$`));
    expect(season.full).toContain(`About ${r.toSnow} days to the first snow.`);
    expect(weatherChips(s, sv).find(c => c.id === 'season')!.full).toContain(`Ungefär ${r.toSnow} dagar till den första snön.`);
    expect(said(s)).not.toMatch(DEGREES);
  });

  it('with snow on the ground: a snow chip, and only then', () => {
    const bare = warden({ day: 33, weatherToday: 'snow', snowDepth: 0 });
    expect(weatherChips(bare, en).some(c => c.id === 'ground')).toBe(false);
    const snowy = warden({ day: 33, weatherToday: 'snow', snowDepth: 0.3 });
    const ground = weatherChips(snowy, en).find(c => c.id === 'ground')!;
    expect(`${ground.icon} ${ground.text}`).toBe('❄ Ankle-deep');
    expect(ground.full).toBe('The snow is ankle-deep.');
    expect(weatherChips(snowy, sv).find(c => c.id === 'ground')!.text).toBe('Ankeldjupt');
    expect(said(snowy)).not.toMatch(DEGREES);
  });

  it('never shows degrees, snow cover or hours of light before the numbers view or dev mode', () => {
    for (const pack of [[...SUGGESTED_PACK], WITH_NOTEBOOK]) {
      for (let day = 1; day < DEFAULT_CALENDAR.thawDay + 3; day++) {
        for (const weatherToday of ['clear', 'snow', 'storm'] as const) {
          const s = warden({ day, weatherToday, snowDepth: day > DEFAULT_CALENDAR.winterDay ? 0.5 : 0 }, true, pack);
          for (const t of [en, sv]) expect(said(s, t)).not.toMatch(DEGREES);
        }
      }
    }
    // The numbers view (the switch off) and dev mode show the degrees, as their full box does.
    expect(said(warden({}, false))).toMatch(/°C/);
    expect(said(warden(), en, true)).toMatch(/°C/);
  });

  it('the condensed box: chips with their sentence for screen readers, the toggle a real button, the hint on its first showing', () => {
    const s = warden();
    const box = weatherBox(s, en, { fold: { mode: 'condensed', hint: true } });
    expect(box).toContain('aria-label="Clear skies, hardly a breath of wind."');
    expect(box).toMatch(/<button type="button" class="eyebrow foldhead wxtoggle" data-wxfold aria-expanded="false">/);
    expect(box).toContain('Tap here for the details');
    expect(box).not.toContain('wxwords');
    expect(weatherBox(s, sv, { fold: { mode: 'condensed', hint: true } })).toContain('Tryck här för detaljerna');
    expect(weatherBox(s, en, { fold: { mode: 'condensed', hint: false } })).not.toContain('Tap here');
    expect(weatherBox(s, en, { fold: { mode: 'open', hint: false } })).toContain('aria-expanded="true"');
    // The first time's card: the full box, and "Got it".
    const intro = weatherBox(s, sv, { fold: { mode: 'intro', hint: false } });
    expect(intro).toContain('wxwords');
    expect(intro).toContain('data-wxack');
    expect(intro).toContain('Uppfattat');
  });

  it('a blizzard warning shows in every state', () => {
    const s = warden({ day: 45, weatherToday: 'storm', snowDepth: 0.9 });
    expect(isBlizzard(s.weatherToday, s.day, s.config.calendar)).toBe(true);
    for (const mode of ['intro', 'open', 'condensed'] as const) {
      expect(weatherBox(s, en, { fold: { mode, hint: false } })).toContain('lockbanner');
      expect(weatherBox(s, en, { dev: true, fold: { mode, hint: false } })).toContain('lockbanner');
      expect(weatherBox(warden({ day: 45, weatherToday: 'storm' }, false), en, { fold: { mode, hint: false } })).toContain('lockbanner');
    }
  });
});

describe('weatherFoldState: first time, then condensed by default (#1788)', () => {
  it('a first visit shows the intro card; "Got it" condenses it with the hint', () => {
    expect(weatherFoldState(FIRST_VISIT)).toEqual({ mode: 'intro', hint: false });
    const acked = ackWeather(FIRST_VISIT);
    expect(weatherFoldState(acked)).toEqual({ mode: 'condensed', hint: true });
  });

  it('opening the box once retires the hint; the open or condensed choice is kept', () => {
    const opened = toggleWeather(ackWeather(FIRST_VISIT));
    expect(weatherFoldState(opened)).toEqual({ mode: 'open', hint: false });
    const shut = toggleWeather(opened);
    expect(weatherFoldState(shut)).toEqual({ mode: 'condensed', hint: false });
  });

  it('remembered per device; junk reads as a first visit, failing storage as condensed with the hint', () => {
    const data: Record<string, string> = {};
    const store: WeatherFoldStore = { getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
    expect(loadWeatherFold(store)).toEqual(FIRST_VISIT);
    const opened = toggleWeather(ackWeather(FIRST_VISIT));
    saveWeatherFold(opened, store);
    expect(JSON.parse(data[WEATHER_FOLD_KEY])).toEqual(opened);
    expect(loadWeatherFold(store)).toEqual(opened);
    expect(readWeatherFold('not json')).toEqual(FIRST_VISIT);
    expect(readWeatherFold('[1]')).toEqual(FIRST_VISIT);
    // No storage, or one that throws: never the big card on every visit.
    const broken: WeatherFoldStore = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadWeatherFold(broken)).toEqual(NO_STORAGE);
    expect(loadWeatherFold(null)).toEqual(NO_STORAGE);
    expect(weatherFoldState(NO_STORAGE)).toEqual({ mode: 'condensed', hint: true });
    expect(() => saveWeatherFold(opened, broken)).not.toThrow();
  });
});
