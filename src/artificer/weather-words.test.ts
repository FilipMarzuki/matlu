/**
 * Acceptance tests for #1729 — the weather and the season in words at the start; the calendar
 * strip is earned later (switch `weather-words`). One test per Given/When/Then, in the issue's order:
 *
 *   1. New run     — given a new run, the weather box describes sky, wind, temperature and season in
 *                     words, with no numbers, hours or day counts, in both languages (and the AI and
 *                     the API get the same words).
 *   2. Season words — given the days nearing first snow, the season line says winter is close, with no count.
 *   3. Tally       — given a day tally kept, the day count and "about N days to first snow" appear.
 *   4. Full strip  — given the precise view earned, the strip shows as today.
 *   5. Switch off  — given the switch off, the strip and numbers show as today.
 *   6. Same game   — given the same seed, the same weather and outcomes as before.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegion1, type Region1State } from './region1';
import { FULL_WORLD, type WorldConfig } from './world';
import { SUGGESTED_PACK, type KitId } from './kit';
import { makeT } from './i18n';
import { DEFAULT_CALENDAR } from './winter';
import { weatherReport, seasonView, aboutDays, WEATHER_WORDS, TALLY_FROM } from './weather-words';
import { weatherBox, seasonChip, seasonStrip } from '../artificer-app/camp-blocks';
import { timeline } from '../artificer-app/progress-view';
import { weatherLines } from '../artificer-app/sim-words';
import { observe } from '../artificer-ai/observe';
import { playRun } from '../artificer-ai/runner';
import { scriptedPlayer } from '../artificer-ai/players/scripted';
import { startGame, view } from '../artificer-play/session';

const en = makeT('en');
const sv = makeT('sv');

const world = (on: boolean | 'absent'): WorldConfig => ({ ...FULL_WORLD, encounters: false, ...(on === 'absent' ? {} : { features: { [WEATHER_WORDS]: on } }) });
const WITH_NOTEBOOK: KitId[] = [...SUGGESTED_PACK.filter(k => k !== 'weekend-food'), 'notebook'];

/** A Warden on a given day, in given weather: the box only reads the state, so this is all it needs. */
function warden(over: Partial<Region1State> = {}, on: boolean | 'absent' = true, pack: KitId[] = [...SUGGESTED_PACK]): Region1State {
  return { ...createRegion1({ world: world(on) }, undefined, { id: 'w-astrid', pack }), ...over };
}

/** What a player sees of some HTML: its text and its tooltips. */
const shown = (html: string): string => [html.replace(/<[^>]*>/g, ' '), ...[...html.matchAll(/\btitle="([^"]*)"/g)].map(m => m[1])].join(' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
const NUMBERS = /\d|°|(?<!\p{L})h(?!\p{L})/u;

describe('The weather and the season in words; the calendar is earned (#1729)', () => {
  it('1. a new run: the weather box describes sky, wind, temperature and season in words, with no numbers', () => {
    const s = warden();
    expect(seasonView(s)).toBe('words');
    const r = weatherReport(s);
    expect(r.sky).toBe('clear');
    expect(r.felt).toBe('mild');
    expect(r.season).toBe('early');
    expect(r.toSnow).toBeNull();
    // Sky and wind, the cold as felt, the season as sensed, and that you've lost count of the days.
    expect(r.lines).toEqual([
      'Clear skies, hardly a breath of wind.',
      'Cool and fresh in the morning, mild by midday.',
      'The birches are just starting to turn; it feels like early autumn.',
      "You've lost track of the date. You cut a notch in a stick each morning; give it a week and you'll trust the count.",
    ]);
    // In both languages, the box has no numbers, no hours, no degrees and no strip.
    for (const t of [en, sv]) {
      const box = weatherBox(s, t);
      expect(box).not.toContain('seasonstrip');
      expect(shown(box)).not.toMatch(NUMBERS);
      expect(shown(seasonChip(s, t))).not.toMatch(NUMBERS);
    }
    expect(shown(weatherBox(s, en))).toContain('Clear skies, hardly a breath of wind.');
    expect(shown(weatherBox(s, sv))).toContain('Klar himmel och nästan vindstilla.');
    expect(shown(seasonChip(s, en))).toContain('EARLY AUTUMN');
    expect(shown(seasonChip(s, sv))).toContain('TIDIG HÖST');
    // Other weather reads differently: cloud and wind, a cooler day later on.
    expect(weatherReport({ ...s, day: 6, weatherToday: 'wind' }).lines.slice(0, 2)).toEqual(['Cloudy and windy.', 'Cool; you can see your breath in the morning.']);
    // The page's English (the catalog) says exactly what the sim writes for the AI.
    for (const day of [1, 6, 12, 20, 27, 33, 45, 52, 58, 61]) {
      for (const w of ['clear', 'overcast', 'rain', 'fog', 'wind', 'storm', 'snow'] as const) {
        const at = { ...s, day, weatherToday: w, snowDepth: day > 31 ? 0.5 : 0 };
        expect(weatherLines(at, en)).toEqual(weatherReport(at).lines);
      }
    }
    // The AI's view gets the same words and no calendar; so does the API, in English and Swedish.
    const text = observe(s);
    expect(text).toMatch(/^DAY 1 — early autumn\./);
    expect(text).not.toMatch(/snow on day/);
    for (const line of weatherReport(s).lines) expect(text).toContain(line);
    const api = view(startGame({ seed: 'wx-1' }));
    expect(api.text).toContain('WEATHER');
    expect(api.text).not.toMatch(/snow on day/);
    const apiSv = view(startGame({ seed: 'wx-1', lang: 'sv' }));
    expect(apiSv.text).toContain('VÄDER');
    expect(apiSv.text).toContain('Björkarna');
  });

  it('2. as the first snow nears, the season line says winter is close, with no count', () => {
    for (const day of [DEFAULT_CALENDAR.winterDay - 5, DEFAULT_CALENDAR.winterDay - 1]) {
      const s = warden({ day, weatherToday: 'overcast' });
      const r = weatherReport(s);
      expect(r.season).toBe('snowSoon');
      expect(r.lines).toContain("The leaves are down and the ground is hard in the mornings. The first snow can't be far off.");
      expect(shown(weatherBox(s, sv))).toContain('Den första snön kan inte vara långt borta.');
    }
    // Earlier, late autumn: closing in on winter, in words.
    const late = warden({ day: 18, weatherToday: 'wind' });
    expect(weatherReport(late).lines).toContain('The birches are nearly bare; it feels like autumn closing in on winter.');
    // With no tally kept, nothing near the snow carries a count.
    const untallied = { ...warden({ day: 7, weatherToday: 'overcast' }), config: { ...warden().config, calendar: { winterDay: 10, thawDay: 40 } } };
    expect(weatherReport(untallied).season).toBe('snowSoon');
    expect(seasonView(untallied)).toBe('words');
    for (const t of [en, sv]) {
      expect(shown(weatherBox(untallied, t))).not.toMatch(NUMBERS);
      expect(shown(seasonChip(untallied, t))).not.toMatch(NUMBERS);
    }
    expect(shown(seasonChip(untallied, en))).toContain('SNOW SOON');
  });

  it('3. with a day tally kept, the day count and "about N days to first snow" appear', () => {
    // The notebook keeps the date from the first night.
    const book = warden({ day: 5 }, true, WITH_NOTEBOOK);
    expect(seasonView(book)).toBe('tally');
    expect(weatherReport(book).lines).toEqual(expect.arrayContaining(['Day 5, by the notebook.', 'About 25 days to the first snow.']));
    expect(shown(weatherBox(book, en))).toContain('About 25 days to the first snow.');
    expect(shown(weatherBox(book, sv))).toContain('Ungefär 25 dagar till den första snön.');
    expect(shown(seasonChip(book, en))).toContain('SNOW IN ABOUT 25 DAYS');
    // Without it, a week of notches.
    expect(seasonView(warden({ day: TALLY_FROM - 1 }))).toBe('words');
    const notches = warden({ day: TALLY_FROM + 19 });
    expect(seasonView(notches)).toBe('tally');
    expect(weatherReport(notches).lines).toEqual(expect.arrayContaining([`Day ${TALLY_FROM + 19}, by the notches on your stick.`, 'About 4 days to the first snow.']));
    expect(shown(weatherBox(notches, sv))).toContain(`Dag ${TALLY_FROM + 19}, enligt skårorna i pinnen.`);
    // About: exact within a week, to the nearest five beyond.
    expect([1, 4, 7, 9, 12, 23, 30].map(aboutDays)).toEqual([1, 4, 7, 10, 10, 25, 30]);
    // The AI hears the count too.
    expect(observe(book)).toContain('About 25 days to the first snow.');
    // Still no hours of light and no degrees, and no strip yet.
    expect(shown(weatherBox(book, en))).not.toMatch(/°|\bh\b|light/);
    expect(weatherBox(book, en)).not.toContain('seasonstrip');
  });

  it('4. once the precise view is earned (a season seen to turn, or dev mode), the strip shows as today', () => {
    const winter = warden({ day: DEFAULT_CALENDAR.winterDay + 3, weatherToday: 'snow', snowDepth: 0.3 });
    expect(seasonView(winter)).toBe('strip');
    const box = weatherBox(winter, en);
    // The strip as today: a bar for every day, first snow, midwinter and the thaw marked.
    const today = seasonStrip(winter, en);
    const bars = (html: string): string => (html.match(/<div class="bars">.*?<\/div>/)?.[0] ?? '').replace(/ title="[^"]*"/g, '');
    expect(bars(box)).toBe(bars(today));
    expect(bars(box).match(/<i /g)).toHaveLength(DEFAULT_CALENDAR.thawDay - 1);
    for (const mark of ['FIRST SNOW', 'MIDWINTER', 'THAW']) expect(shown(box)).toContain(mark);
    // The words are still there, with the count to the thaw; never hours or degrees in Region 1.
    expect(shown(box)).toContain('Snow is falling, soft and steady.');
    expect(shown(box)).toContain('About 25 days to the thaw.');
    expect(shown(box)).not.toMatch(/°|\bh\b|light/);
    // The header chip and the progress tab's timeline are back as today.
    expect(seasonChip(winter, en)).toContain('WINTER · THAW IN 27 DAYS');
    expect(timeline(winter, en)).toContain('tl-legend');
    // Dev mode shows the strip with its numbers from day 1.
    const start = warden();
    expect(weatherBox(start, en, { dev: true })).toContain(seasonStrip(start, en));
  });

  it('5. with the switch off, the strip and numbers show as today', () => {
    for (const on of [false, 'absent'] as const) {
      const s = warden({ day: 12, weatherToday: 'overcast' }, on);
      expect(seasonView(s)).toBe('numbers');
      expect(weatherReport(s).lines).toEqual([]);
      expect(weatherBox(s, en)).toBe(seasonStrip(s, en));
      expect(shown(weatherBox(s, en))).toMatch(/°C/);
      expect(seasonChip(s, en)).toContain('AUTUMN · SNOW IN 19 DAYS');
      expect(timeline(s, en)).toContain('tl-legend');
      expect(observe(s)).toMatch(/^DAY 12 — autumn, snow on day 31 \(19 days\)\./);
      expect(observe(s)).not.toContain('WEATHER (as you sense it');
    }
    expect(view(startGame({ seed: 'wx-5', features: { [WEATHER_WORDS]: false } })).text).toMatch(/snow on day 31/);
  });

  it('6. the same seed plays the same game, the weather and the outcomes, switch on or off', async () => {
    // The scripted baseline plays a whole year from state, not from the text, so it plays the same moves either way.
    const told: string[] = [];
    const year = (on: boolean) => {
      const p = scriptedPlayer();
      return playRun(on ? { ...p, decide: (m, st) => { told.push(m); return p.decide(m, st); } } : p, { characterId: 'ai-scripted-s3-r1', encounters: false, features: { [WEATHER_WORDS]: on } });
    };
    const [a, b] = await Promise.all([year(true), year(false)]);
    const strip = (x: Region1State): unknown => ({ ...x, config: { ...x.config, world: { ...x.config.world, features: {} } } });
    // Through the winter, past the strip being earned: the same days, weather, stores, journal and end.
    expect(a.final.day).toBeGreaterThan(DEFAULT_CALENDAR.winterDay);
    expect(a.turns.map(t => t.day)).toEqual(b.turns.map(t => t.day));
    expect(strip(a.final)).toEqual(strip(b.final));
    expect(a.record.kind).toBe(b.record.kind);
    // The AI was told in words while the calendar was locked, and with numbers once it was earned.
    expect(told[0]).toMatch(/^DAY 1 — early autumn\./m);
    expect(told.find(m => /^DAY 40 — /m.test(m))).toMatch(/^DAY 40 — winter, thaw on day 61 \(21 days\)\./m);
    // Nothing that plays the game reads the words: only the views (the app, the AI's and the API's text) do.
    const here = dirname(fileURLToPath(import.meta.url));
    const sim = readdirSync(here).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'weather-words.ts');
    expect(sim.filter(f => /from '\.\/weather-words'/.test(readFileSync(join(here, f), 'utf8')))).toEqual([]);
  }, 60_000);
});
