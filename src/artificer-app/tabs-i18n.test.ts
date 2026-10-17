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

import { beforeEach, describe, expect, it } from 'vitest';
import { makeT, numText, localNum } from '../artificer/i18n';
import { isKey } from './sim-words';
import { describeLand, mapMode } from '../artificer/descriptive-map';
import { APP_TABS, keptTab, tabToOpen } from './feature-choices';
import { foldOpen, resetFolds, setFold } from './fold';
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
import { landRings, landTab, tripNews } from './land-view';
import { landNews, landSeen } from './land-news';
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
  'new', 'see', 'key', 'chips', 'mean', 'map',
];
const ENGLISH_RE = new RegExp(`(?<![\\p{L}])(${ENGLISH.join('|')})(?![\\p{L}])`, 'giu');
const englishIn = (html: string): string[] => { const text = shown(html); return [...text.matchAll(ENGLISH_RE)].map(m => text.slice(Math.max(0, m.index! - 40), m.index! + 40).replace(/\s+/g, ' ').trim()); };

// The rings as they were (#1752's `distance-not-rings` off): these tests pin the LAND tab's ring words; distance.test.ts has them as distances.
const FEATURES = { ...ruleFeatures(), 'distance-not-rings': false };
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
    expect(shown(progressTab(rich(), records(), '', sv))).toContain('VÄKTARE 1');
  });

  it('keeps the English tabs saying what they said', () => {
    const s = rich();
    expect(shown(wardenTab({ sim: s }, en))).toContain("Aching back — strain 1.5. Tonight's recovery");
    expect(shown(landTab(switchOff(s), en, null))).toContain('Scout for the overview, survey to firm it up');
    expect(shown(landTab(s, en, null))).toContain('Scout for the overview and places further out');
    expect(shown(progressTab(s, records(), '', en))).toContain('Survived the winter');
    expect(englishIn(wardenTab({ sim: s }, en)).length).toBeGreaterThan(5);
  });
});

/** The same rich Warden before a map (no surface to draw on), with one drawn (birch bark), and with the descriptive-map switch off. */
const described = (): Region1State => ({ ...rich(), kit: { ...rich().kit!, items: rich().kit!.items.filter(k => k !== 'notebook') }, flags: { ...rich().flags, everWood: false, everHide: false } });
// With learning the map (#1754, on in a new game) the map is drawn once its session is done: `mapLearned`.
const drawn = (): Region1State => ({ ...described(), flags: { ...described().flags, everWood: true }, mapLearned: true });
const switchOff = (s: Region1State): Region1State => ({ ...s, config: { ...s.config, world: { ...s.config.world, features: { ...s.config.world.features, 'descriptive-map': false } } } });
/** A fresh Warden: home ground unknown, the far rings out of reach. */
const fresh = (): Region1State => createRegion1({ world: { ...FULL_WORLD, features: FEATURES } }, undefined, { id: 'w-tabs-land' });

describe('One LAND tab, organised by ring (#1730)', () => {
  beforeEach(() => resetFolds());

  it('has no MAP tab: the other tabs keep their order, and a kept MAP tab opens LAND', () => {
    expect(APP_TABS.map(x => x.id)).toEqual(['plan', 'camp', 'land', 'history', 'progress']); // the Warden is the header's (#1807)
    expect(keptTab('map')).toBe('land');
    expect(keptTab('warden')).toBe('warden');
    expect(tabToOpen(keptTab('map'), APP_TABS, { dev: false, camp: true })).toBe('land');
    expect(isKey('tab.map')).toBe(false);
  });

  it('draws the merged tab in Swedish with no English: fresh, described, drawn, played, every ring folded open or shut', () => {
    expect(mapMode(described())).toBe('described');
    expect(mapMode(drawn())).toBe('drawn');
    for (const s of [fresh(), described(), drawn(), played(5), played(11)]) {
      resetFolds();
      expect(englishIn(landTab(s, sv))).toEqual([]);
      for (const r of [1, 2, 3]) setFold(`land.ring.${r}`, true, null);
      setFold('land.chipKey', true, null); setFold('land.mapKey', true, null);
      expect(englishIn(landTab(s, sv))).toEqual([]);
      // …with everything marked new (a viewer who last looked at a fresh Warden's land), and the trip card.
      const news = landNews(s, landSeen(fresh()));
      expect(englishIn(landTab(s, sv, null, { news }))).toEqual([]);
      for (const r of [1, 2, 3] as const) expect(englishIn(tripNews(s, r, news, sv))).toEqual([]);
    }
    const html = shown(landTab(drawn(), sv));
    expect(html).toContain('DIN KARTA');
    expect(html).toContain('Teckenförklaring');
    expect(html).toContain('Vad märkena betyder');
  });

  it('shows everything the old LAND tab showed: chips and supply, finds, the pass, every pin with its controls, the key', () => {
    const base = described();
    const s = { ...base, explore: { ...base.explore, finds: ['1:water', '2:timber'], known: { ...base.explore.known, 3: { ...base.explore.known[3], routes: 1 } } } } as Region1State;
    const html = landTab(s, en);
    const text = shown(html);
    // Chips: knowledge levels with their tooltips, per ring.
    expect(html).toMatch(/class="chip l2" title="Water: observed/);
    expect(html).toContain('class="chip l1"');
    // Finds and the pass.
    expect(text).toContain('★ Clear spring');
    expect(text).toContain('★ Deadfall');
    expect(text).toContain('★ The pass');
    // Every remembered place, under its ring, with forget controls and what it does.
    for (const p of s.pins!) expect(html).toContain(`data-forget="${p.id}"`);
    expect(text).toContain('+2 water and fish in this ring');
    expect(text).toContain('You can hold');
    expect(text).toContain('PINS — places you remember');
    // The chips' key and how to learn more.
    expect(html).toContain('<span class="chip l0">???</span> unknown');
    expect(text).toContain('Scout for the overview and places further out');
    expect(text).toContain('THE LAND — what you know, ring by ring');
    // Each ring's heading, near ring open, the others shut.
    for (const name of ['NEAR', 'FAR', 'DISTANT']) expect(text).toContain(name);
    expect(html).toMatch(/data-fold="land\.ring\.1" open/);
    expect(html).toMatch(/data-fold="land\.ring\.2">/);
    // A pin in a shut ring still says it's there.
    expect(html).toMatch(/data-fold="land\.ring\.2"><summary>.*📌 2/);
  });

  it('shows everything the old MAP tab showed: the camp line, every place in words, the intro, what a map still needs', () => {
    const s = described();
    const text = shown(landTab(s, en));
    // No camp has been made in this state (camp as an action, #1732), so it's told from where you stand (#1834).
    expect(text).toContain('THE LAND — what you know of it, from here');
    // Every line the description had (and the AI reads), each once: camp at the top, the places under their rings.
    const lines = describeLand(s);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(text.split(l).length - 1).toBe(1);
    expect(text).toContain('the compass still points north');
    expect(text).toContain('To draw a map of your own you need something to draw on');
    // The camp line is at the top, above the rings.
    expect(text.indexOf(lines[0])).toBeLessThan(text.indexOf('NEAR'));
    // Without the compass, the other intro.
    expect(shown(landTab({ ...s, kit: { ...s.kit!, items: s.kit!.items.filter(k => k !== 'map-compass') } }, en))).toContain('no compass to take a bearing by');
  });

  it('puts your drawn map at the top once drawn, its legend in a Key, and no "needs" line', () => {
    const s = drawn();
    const html = landTab(s, en);
    const text = shown(html);
    expect(text).toContain("YOUR MAP — drawn from what you've seen");
    expect(html).toContain('<pre class="reachmap" aria-label="Your map:');
    expect(html).toMatch(/data-cell="\d+,\d+"/);
    expect(text).toContain('Tap a square to see what it is.');
    expect(html).toMatch(/data-fold="land\.mapKey"><summary>Key<\/summary><div class="legend maplegend">/);
    expect(text).toContain('settlement');
    expect(text).toContain('Drawn true to the compass');
    expect(text).not.toContain('To draw a map of your own');
    expect(text.indexOf('YOUR MAP')).toBeLessThan(text.indexOf('THE LAND — what you know, ring by ring'));
    for (const l of describeLand(s)) expect(text).toContain(l);
  });

  it('remembers a fold the viewer opened or shut, and starts from defaults when storage refuses', () => {
    const kept: Record<string, string> = {};
    const store = { getItem: (k: string) => kept[k] ?? null, setItem: (k: string, v: string) => { kept[k] = v; } };
    setFold('land.ring.1', false, store);
    setFold('land.ring.3', true, store);
    resetFolds();
    expect(foldOpen('land.ring.1', true, store)).toBe(false);
    expect(foldOpen('land.ring.3', false, store)).toBe(true);
    expect(foldOpen('land.ring.2', false, store)).toBe(false);
    resetFolds();
    const refusing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(foldOpen('land.ring.1', true, refusing)).toBe(true);
    expect(() => setFold('land.ring.1', false, refusing)).not.toThrow();
    expect(foldOpen('land.ring.1', true, refusing)).toBe(false);
  });

  it('shows a ring out of reach as one line, shut', () => {
    // With distance, not rings (#1752, the default): named by how far it is, from where you are before camp.
    const near = createRegion1({ world: { ...FULL_WORLD, features: { ...FEATURES, 'distance-not-rings': true } } }, undefined, { id: 'w-tabs-land' });
    expect(landTab(near, en)).toMatch(/<div class="fold ringfold shut"><span class="ringhead" id="land-ring-2">HALF A DAY OUT <span>from where you are<\/span><\/span> <span class="foldnote">Out of reach — know the land nearer in first/);
    // With that switch off, as before.
    expect(landTab(fresh(), en)).toMatch(/<div class="fold ringfold shut"><span class="ringhead" id="land-ring-2">FAR <span>\+3h<\/span><\/span> <span class="foldnote">Out of reach/);
  });

  it('with the descriptive-map switch off, shows the old LAND tab and then the Reach map, as the two tabs did', () => {
    for (const base of [rich(), fresh()]) {
      const s = switchOff(base);
      expect(mapMode(s)).toBe('reach');
      const html = landTab(s, en, 2);
      const text = shown(html);
      // The old LAND tab, unchanged, first.
      expect(html.startsWith(`<section class="box"><p class="eyebrow">THE LAND — what you know, ring by ring</p>${landRings(s, en, 2)}`)).toBe(true);
      expect(text).toContain('Scout for the overview, survey to firm it up');
      expect(html).not.toContain('data-fold');
      // Then the old grid.
      expect(text.indexOf('THE REACH — a map of what you know')).toBeGreaterThan(text.indexOf('PINS — places you remember'));
      expect(html).toContain('<pre class="reachmap" aria-label="Map of the Reach:');
      expect(html).toContain('class="m-camp');
      expect(text).toContain("You see what's within two hours of camp");
      expect(englishIn(landTab(s, sv, 2))).toEqual([]);
    }
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
