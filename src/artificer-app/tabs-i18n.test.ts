/**
 * Acceptance test for #1711 — the remaining tabs (WARDEN, LAND with its pins, PROGRESS) have no
 * hard-coded English, and numbers are written the viewer's way (phase 4 of #1685).
 *
 * As camp-i18n.test.ts does for a day at camp: the tabs are pure functions of the game state and
 * `t` (warden-view.ts, land-view.ts, pins-view.ts, progress-view.ts), so this draws each in Swedish
 * over a spread of states (a fresh Warden, a rich one with talents, quirks and fears, old wounds,
 * a full pack, strain, pins of every kind, finds; a played-out year; every way a run can
 * end) and looks for English words in what a player sees. The same tabs in English say what the
 * page said before they were drawn through the catalog (pins-ui.test.ts pins some of it).
 */

import { describe, expect, it } from 'vitest';
import { makeT, numText, localNum } from '../artificer/i18n';
import { createRegion1, endDay, runAction, blockedReason, ACTIONS, type ActionId, type QueueItem, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { ruleFeatures } from '../artificer/features';
import { createExploration, scout, survey } from '../artificer/exploration';
import { SUGGESTED_PACK } from '../artificer/kit';
import { LEVEL_HOURS, SKILL_IDS } from '../artificer/skills';
import { TECHNIQUES } from '../artificer/techniques';
import { pinId, type Pin } from '../artificer/pins';
import type { RunRecord } from '../artificer/legacy';
import { wardenTab } from './warden-view';
import { landTab } from './land-view';
import { progressTab } from './progress-view';
import { hrs } from './html';

const sv = makeT('sv');
const en = makeT('en');

function shown(html: string): string {
  const attrs = [...html.matchAll(/\b(title|aria-label|placeholder|alt)="([^"]*)"/g)].map(m => m[2]);
  return [html.replace(/<[^>]*>/g, ' '), ...attrs].join(' ').replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

/** English words that would give away an untranslated line on these tabs. None is a Swedish word too (so not "ring"). */
const ENGLISH = [
  'the', 'you', 'your', 'and', 'with', 'of', 'not', 'yet', 'nothing', 'about', 'what', 'will', 'more', 'less',
  'food', 'water', 'fuel', 'stone', 'timber', 'forage', 'routes', 'firewood', 'warmth', 'nights', 'night', 'day', 'days',
  'autumn', 'winter', 'thaw', 'run', 'runs', 'best', 'recipes', 'died', 'survived', 'reached', 'collapsed', 'frostbite',
  'unknown', 'suspected', 'observed', 'detailed', 'worked', 'plenty', 'thinning', 'scarce', 'bare',
  'places', 'place', 'memory', 'interest', 'found', 'let', 'calmer', 'worse', 'shelter', 'eerie', 'peaceful',
  'strain', 'aching', 'exhausted', 'carrying', 'gear', 'stones', 'comfortable', 'talents', 'hidden', 'gift', 'fear',
  'insight', 'rank', 'concept', 'skills', 'self', 'assessed', 'typical', 'taught', 'easy', 'hard', 'manuals',
  'marks', 'contacts', 'dressing', 'dressings', 'matches', 'headlamp', 'thermos', 'sweets', 'comic', 'grows',
  'focus', 'clarity', 'goal', 'learns', 'practice', 'something', 'ask', 'people', 'wagon', 'survival', 'learning',
];
const ENGLISH_RE = new RegExp(`(?<![\\p{L}])(${ENGLISH.join('|')})(?![\\p{L}])`, 'giu');
const englishIn = (html: string): string[] => { const text = shown(html); return [...text.matchAll(ENGLISH_RE)].map(m => text.slice(Math.max(0, m.index! - 40), m.index! + 40).replace(/\s+/g, ' ').trim()); };

const FEATURES = ruleFeatures();
const pin = (place: string, kind: Pin['kind'], ring: 1 | 2 | 3, extra: Partial<Pin> = {}): Pin => ({ id: pinId(place, ring), place, kind, ring, day: 4, ...extra });

/** A Warden with everything on show: talents known and hidden, quirks and fears, old wounds, a full pack, strain, pins, finds. */
function rich(): Region1State {
  const s = createRegion1({ world: { ...FULL_WORLD, encounters: false, features: FEATURES } }, undefined, { id: 'w-tabs-sv', name: 'Vega', portrait: 'tinkerer', chosen: ['hardy', 'tough'], pack: [...SUGGESTED_PACK] });
  let explore = createExploration();
  explore = survey(survey(scout(scout(scout(explore, 1), 2), 3), 1), 2);
  return {
    ...s, day: 30, strain: 1.5, marks: 12, contacts: ['hf-maren'],
    explore,
    skills: Object.fromEntries(SKILL_IDS.map((id, i) => [id, LEVEL_HOURS[Math.min(4, i % 5)]])),
    techniques: TECHNIQUES.slice(0, 4).map(x => x.id),
    manuals: ['tally-book'],
    concepts: { ...s.concepts, joinery: { rank: 2, insight: 1.5 }, weaving: { rank: 0, insight: 0.3 }, friction: { rank: 1, insight: 2.25 } },
    pins: [pin('deep-pool', 'fishing', 2, { interest: 3 }), pin('sunlit-glade', 'peaceful', 1, { feeling: 'peaceful' }), pin('strange-carving', 'wonder', 3, { feeling: 'eerie', interest: 2 }),
      pin('sheltered-hollow', 'shelter', 1, { feeling: 'awed' }), pin('berry-thicket', 'forage', 2), pin('stone-outcrop', 'stone', 3)],
    character: {
      ...s.character, age: 13, adult: { ...s.character.stats, str: s.character.stats.str + 2 }, lastStandUsed: true,
      talents: [...s.character.talents.map(x => ({ ...x, known: true, signs: 2 })), { id: 'keenEye', tier: 1, known: false }] as Region1State['character']['talents'],
      quirks: [{ id: 'runner', known: true }, { id: 'stoic', known: true }, { id: 'fear:dark', known: true, faced: 1 }, { id: 'fear:heights', known: true, faced: 0 }, { id: 'jumpy', known: false }],
      harms: ['stiff-knee', 'weak-grip', 'scar'],
    },
  };
}

/** A year played with random open actions, as road-i18n.test.ts plays one. */
function played(seed: number): Region1State {
  let x = seed >>> 0 || 1;
  const rnd = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; };
  const pick = <X>(xs: readonly X[]): X => xs[Math.floor(rnd() * xs.length)];
  const IDS = Object.keys(ACTIONS) as ActionId[];
  let s = createRegion1({ world: { ...FULL_WORLD, encounters: false, features: FEATURES } }, undefined, { id: `w-tabs-play-${seed}`, name: 'Vega', pack: [...SUGGESTED_PACK] });
  for (let guard = 0; guard < 1200 && !s.outcome; guard++) {
    const open: QueueItem[] = [];
    for (const id of IDS) for (const ring of (ACTIONS[id].ringed ? [1, 2, 3] : [1]) as (1 | 2 | 3)[]) if (!blockedReason(s, id, ring)) open.push((ring === 1 ? id : `${id}@${ring}`) as QueueItem);
    s = s.hoursToday >= 12 || !open.length || rnd() < 0.08 ? endDay(s) : runAction(s, pick(open));
    if (s.pending) s = { ...s, pending: null };
  }
  return s;
}

const KINDS: RunRecord['kind'][] = ['arrived', 'survived', 'thrive', 'ragged', 'crossed', 'turnedBack', 'wintered', 'grim', 'collapsed', 'died'];
const records = (): RunRecord[] => KINDS.map((kind, i) => ({
  run: i + 1, characterName: i % 2 ? 'Vega' : undefined, day: 40 + i, choice: 'thaw', kind, grade: i % 3 === 0 ? 'hale' : i % 3 === 1 ? 'worn' : undefined, injury: i === 4 ? 'frostbite' : null,
  readyDay: i % 2 ? 20 + i : null, site: null, tier: 1, shelterGrade: null, shelterType: null, walls: null, tools: [], recipes: 3 + i,
} as unknown as RunRecord));

describe('The remaining tabs, in Swedish (#1711)', () => {
  it('draws the WARDEN tab with no English: fresh, rich, exhausted, played', () => {
    const fresh = createRegion1({ world: { ...FULL_WORLD, features: FEATURES } }, undefined, { id: 'w-tabs-fresh' });
    for (const s of [fresh, rich(), played(3), played(17), { ...rich(), today: { ...rich().today, exhausted: true } }]) {
      expect(englishIn(wardenTab({ sim: s }, sv))).toEqual([]);
      // (Dev mode's `?dev=truths` adds each pack item's rule in English, for the developer, as phase 2 left it.)
    }
    const html = shown(wardenTab({ sim: rich() }, sv));
    expect(html).toContain('Rädsla för mörkret');
    expect(html).toContain('Värk i ryggen — belastning 1,5');
    expect(html).toContain('1,5 insikt');
  });

  it('draws the LAND tab and every pin with no English', () => {
    for (const s of [createRegion1({ world: { ...FULL_WORLD, features: FEATURES } }, undefined, { id: 'w-tabs-land' }), rich(), played(5)]) {
      for (const ring of [null, 1, 2, 3] as const) expect(englishIn(landTab(s, sv, ring))).toEqual([]);
    }
    const html = shown(landTab(rich(), sv, 2));
    expect(html).toContain('+2 vatten och fisk i den här ringen');
    expect(html).toContain('NÅLAR');
  });

  it('draws the PROGRESS tab with no English: a fresh run, a played year, every way a run can end', () => {
    for (const s of [createRegion1({ world: { ...FULL_WORLD, features: FEATURES } }, undefined, { id: 'w-tabs-prog' }), rich(), played(9), { ...rich(), day: 50 }]) {
      expect(englishIn(progressTab(s, [], '', sv))).toEqual([]);
      expect(englishIn(progressTab(s, records(), '', sv))).toEqual([]);
    }
    expect(shown(progressTab(rich(), records(), '', sv))).toContain('RUNDA 1');
  });

  it('keeps the English tabs saying what they said', () => {
    const s = rich();
    expect(shown(wardenTab({ sim: s }, en))).toContain("Aching back — strain 1.5. Tonight's recovery");
    expect(shown(landTab(s, en, null))).toContain('Scout for the overview, survey to firm it up');
    expect(shown(progressTab(s, records(), '', en))).toContain('Survived the winter');
    expect(englishIn(wardenTab({ sim: s }, en)).length).toBeGreaterThan(5);
  });
});

describe('Numbers the viewer\'s way (#1711)', () => {
  it('writes decimals with a comma and groups thousands with a space in Swedish, and leaves English alone', () => {
    expect(numText(1.5, sv)).toBe('1,5');
    expect(numText(2.25, sv, 1)).toBe('2,3');
    expect(numText(3, sv)).toBe('3');
    expect(localNum('1,200', sv)).toBe('1 200');
    expect(localNum('killing 1,234 in 4.5 days', sv)).toBe('killing 1 234 in 4,5 days');
    expect(numText(1.5, en)).toBe('1.5');
    expect(localNum('1,200', en)).toBe('1,200');
    expect(hrs(4.5, sv)).toBe('4,5');
    expect(hrs(4.5)).toBe('4.5');
  });
});
