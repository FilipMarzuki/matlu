/**
 * Acceptance test for #1707 — the opening and a day at camp have no hard-coded English.
 *
 * How it checks: the views that draw the opening and camp (opening-view.ts, camp-blocks.ts,
 * intro.ts) are pure functions of the game state and `t`, so this draws each of them in Swedish,
 * over a spread of states (a fresh run, a camp in winter, a blizzard, every ending, the timer),
 * and reads what a player would see or hear: the text, and the tooltips, labels and placeholders.
 * Then it looks for English words that have no business in Swedish. A word list can miss things,
 * but it catches the usual slip: a new line written straight into a template instead of the
 * catalog. The words are chosen to be English only (no "is", "far" or "region", which are Swedish
 * too; nor "mat", "scout" and "ring", which Swedish uses for food, scouts and rings). What stays English on purpose isn't drawn here: the journal's own lines (phase 3).
 *
 * The same views drawn in English must keep saying exactly what they did (sim-words.test.ts checks
 * the sim's sentences; the intro test checks the intro).
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { createRegion1, chooseSite, type Region1State } from '../artificer/region1';
import { FULL_WORLD, type WorldConfig } from '../artificer/world';
import { createExploration, scout, survey } from '../artificer/exploration';
import { SUGGESTED_PACK, KIT_IDS } from '../artificer/kit';
import { DEFAULT_STATS } from '../artificer/stats';
import type { OutcomeKind } from '../artificer/winter';
import type { RunRecord } from '../artificer/legacy';
import { previewQueue, type AppState } from './controller';
import { introBeats, fillName } from './intro';
import { packForm, createForm } from './opening-view';
import { paletteBlock, seasonStrip, weatherBox, seasonChip, storesRow, coldBlock, vitalsBlock, sitesBlock, toolsBlock, firstJournalLine, stepName, phaseText, outcomeCard, describedMap } from './camp-blocks';
import type { DayPlay, Moment } from './playback';

const sv = makeT('sv');
const en = makeT('en');

/** What a player sees and hears of some HTML: its text, and the words in tooltips, labels and placeholders. */
function shown(html: string): string {
  const attrs = [...html.matchAll(/\b(title|aria-label|placeholder|alt)="([^"]*)"/g)].map(m => m[2]);
  const text = html.replace(/<[^>]*>/g, ' ');
  return [text, ...attrs].join(' ').replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))).replace(/&nbsp;/g, ' ');
}

/** English words that would give away a line nobody translated. Whole words, any case. */
const ENGLISH = [
  'the', 'you', 'your', 'and', 'with', 'of', 'not', 'yet', 'first', 'already', 'nothing', 'never', 'about',
  'food', 'water', 'fuel', 'stone', 'hides', 'rations', 'rings', 'near', 'distant', 'survey', 'explore', 'scouting',
  'camp', 'day', 'days', 'night', 'nights', 'hours', 'light', 'snow', 'winter', 'thaw', 'tools', 'known', 'recipes',
  'needs', 'tier', 'warm', 'cold', 'kept', 'exposed', 'deer', 'game', 'build', 'craft', 'gather', 'hunt', 'study',
  'sharp', 'steady', 'minutes', 'north', 'south', 'east', 'west', 'pack', 'empty', 'leader', 'choose', 'talents',
  'age', 'stats', 'points', 'left', 'costs', 'average', 'heavy', 'work', 'trip', 'walking', 'run', 'complete',
  'ended', 'reached', 'shelter', 'what', 'will', 'cave', 'treeline', 'hilltop', 'riverbank', 'vigor', 'clarity',
];
const ENGLISH_RE = new RegExp(`(?<![\\p{L}])(${ENGLISH.join('|')})(?![\\p{L}])`, 'giu');

/** The English words found in what's shown (with a little context, so a failure says where). */
function englishIn(html: string): string[] {
  const text = shown(html);
  return [...text.matchAll(ENGLISH_RE)].map(m => text.slice(Math.max(0, m.index! - 30), m.index! + 30).replace(/\s+/g, ' ').trim());
}

const world = (over: Partial<WorldConfig> = {}): WorldConfig => ({ ...FULL_WORLD, encounters: false, ...over });

/** A fresh run: nothing known, nothing made. */
const fresh = (over: Partial<WorldConfig> = {}): Region1State => createRegion1({ world: world(over) }, undefined, { id: 'w-sv-test', pack: [...SUGGESTED_PACK] });

/** A camp a few weeks in: the near ring known, settled in the cave, some stores and a tool, in the snow. */
function camped(): Region1State {
  const s0 = fresh();
  const s = chooseSite({ ...s0, explore: survey(scout(scout(createExploration(), 1), 2), 1) }, 'cave');
  return {
    ...s, day: 33, weatherToday: 'snow', snowDepth: 0.4, tier: 1, coldPitAt: 'cave',
    stores: { rawFood: 6, water: 3, firewood: 9, materials: 1, rations: 4, stone: 2, hides: 1 },
    deprivation: { hungry: 1, thirsty: 0 }, concepts: { ...s.concepts, joinery: { rank: 1, insight: 0.5 } },
    known: [...s.known, 'trap-snare'],
  };
}

const app = (sim: Region1State, queue: AppState['queue'] = []): AppState => ({ sim, queue } as AppState);

describe('The opening and a day at camp, in Swedish (#1707)', () => {
  it('draws the opening with no English: the hike, the voice, the pack and creation', () => {
    const s = fresh();
    const beats = introBeats({ ...s, tools: [...s.tools, { item: 'stone-knife', grade: 'fine', heirloom: true }] }, sv);
    const words = beats.flatMap(b => b.lines.map(l => fillName(l, '', sv))).join('\n');
    expect(englishIn(words)).toEqual([]);
    expect(words).toContain('Fredag eftermiddag');
    expect(words).toContain('Registrerad: Artificer.');
    expect(words).toContain('De lämnade efter sig: stenkniv (fin).');
    // The pack screen: every item, the full list packed and the empty pack (so nothing fits and everything does).
    for (const pack of [[...SUGGESTED_PACK], [], KIT_IDS.slice(0, 6)]) expect(englishIn(packForm(pack, sv))).toEqual([]);
    expect(shown(packForm([], sv))).toContain('Morakniv');
    expect(shown(packForm([], sv))).toContain('LEDARENS PACKLISTA');
    // Creation: a fresh draft, and one mid-way (talents picked, a stat raised high, a young age).
    const draft = { id: 'w-sv-test', name: '', portrait: 'loke', talents: [], stats: { ...DEFAULT_STATS }, age: 12 };
    expect(englishIn(createForm(draft, sv))).toEqual([]);
    expect(englishIn(createForm({ ...draft, name: 'Vega', stats: { ...DEFAULT_STATS, str: 14, int: 13, cha: 8 }, age: 16 }, sv))).toEqual([]);
  });

  it('draws a day at camp with no English: the season, the actions, the stores, the camp', () => {
    for (const s of [fresh(), fresh({ features: { 'action-visibility': false } }), camped()]) {
      const a = app(s);
      const preview = previewQueue(a);
      for (const ring of [1, 2, 3] as const) expect(englishIn(paletteBlock(a, preview, { ring, dev: false, t: sv }))).toEqual([]);
      expect(englishIn(seasonStrip(s, sv))).toEqual([]);
      expect(englishIn(storesRow(s, sv))).toEqual([]);
      expect(englishIn(coldBlock(s, sv))).toEqual([]);
      expect(englishIn(vitalsBlock(s, sv))).toEqual([]);
      expect(englishIn(sitesBlock(s, sv))).toEqual([]);
      expect(englishIn(toolsBlock(s, sv))).toEqual([]);
      expect(englishIn(firstJournalLine(s, sv))).toEqual([]);
      expect(englishIn(describedMap(s, sv))).toEqual([]);
    }
    // The weather in words (#1729): at the start, with a tally, and once the strip is earned; in every weather.
    const words = fresh({ features: { 'weather-words': true } });
    for (const over of [{}, { day: 12 }, { day: 27, weatherToday: 'fog' as const }, { day: 33, weatherToday: 'snow' as const, snowDepth: 0.5 }, { day: 45, weatherToday: 'storm' as const, snowDepth: 0.9 }, { day: 58, weatherToday: 'wind' as const, snowDepth: 0.1 }, { day: 61 }]) {
      const at = { ...words, ...over };
      expect(englishIn(weatherBox(at, sv))).toEqual([]);
      expect(englishIn(seasonChip(at, sv))).toEqual([]);
    }
    // A blizzard in midwinter: the banner and the weather's winter name.
    const storm = { ...camped(), day: 45, weatherToday: 'storm' as const };
    expect(englishIn(seasonStrip(storm, sv))).toEqual([]);
    expect(shown(seasonStrip(storm, sv))).toContain('Snöstorm');
    // And in English the same blocks still read as before.
    const english = paletteBlock(app(fresh()), previewQueue(app(fresh())), { ring: 1, dev: false, t: en });
    expect(shown(english)).toContain('SCOUT');
    // (And the check would see it: the English page is full of the words it looks for.)
    expect(englishIn(english).length).toBeGreaterThan(5);
    expect(englishIn(packForm([], en)).length).toBeGreaterThan(5);
  });

  it('draws the timer and every ending with no English', () => {
    const s = camped();
    const play = { before: app(s), after: app(s), steps: [{ item: 'wood@2', hours: 4 }, { item: 'rest', hours: 0 }], night: true, fromQueue: true } as unknown as DayPlay;
    const at = (index: number, phase: Moment['phase'] = null): Moment => ({ index, frac: 0.5, done: index, clock: 10, phase, over: false });
    const timer = [
      stepName(play, at(0), sv), phaseText(play, at(0), sv), phaseText(play, at(0, { kind: 'out', trip: 1, trips: 2 } as Moment['phase']), sv),
      phaseText(play, at(1), sv), stepName(play, at(2), sv), phaseText(play, at(2), sv),
    ].join(' | ');
    expect(englishIn(timer)).toEqual([]);
    const kinds: OutcomeKind[] = ['survived', 'thrive', 'ragged', 'crossed', 'turnedBack', 'wintered', 'collapsed', 'died', 'grim'];
    for (const kind of kinds) {
      const choice = kind === 'collapsed' || kind === 'died' ? 'collapse' : kind === 'survived' ? 'thaw' : 'caravan';
      const sim = { ...s, log: [], outcome: { choice, kind, grade: 'worn', vitals: s.vitals } } as unknown as Region1State;
      const run = { run: 1, day: 61, choice, kind, grade: kind === 'survived' ? 'hale' : undefined, injury: null, readyDay: kind === 'grim' ? null : 30, site: 'cave', tier: 2, shelterGrade: 'sound', shelterType: 'leanto', walls: 'timber', tools: ['stone-knife:fine'], recipes: 6, milestones: 9 } as unknown as RunRecord;
      expect(englishIn(outcomeCard({ ...app(sim), stayed: false } as AppState, run, sv))).toEqual([]);
      expect(englishIn(outcomeCard({ ...app(sim), stayed: true } as AppState, { ...run, site: null, tools: [] }, sv))).toEqual([]);
    }
  });
});
