/**
 * Acceptance tests for #1756 — the Make camp action shows how many great and good places to camp
 * you know, each rated from what the Warden *believes* about it (switch `camp-site-ratings`, on top
 * of #1732's `camp-as-action`). One test per Given/When/Then, in the issue's order:
 *
 *   1. New run            — knowing only its start, a Hilltop, the action shows no badges.
 *   2. Fair riverbank     — read as fair, sheltered and near water, it counts as good: ✓ 1.
 *   3. Sharp cave         — read as sharp, out of the wind and dry, it counts as great.
 *   4. Vague overrating   — the badges follow the belief, and correct after camping there.
 *   5. The AI and the API — the same counts and ratings as the page.
 *   6. Switch off/absent  — nothing changes.
 *   7. Same game          — pure: the same Warden and site rate the same, after a reload too, and no
 *                           new random draws (the run plays the same with the ratings on or off).
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, ACTIONS, type Region1State, type QueueItem } from './region1';
import { createExploration, survey, type Domain, type Exploration } from './exploration';
import { FULL_WORLD, type WorldConfig } from './world';
import { makeT } from './i18n';
import { en as EN } from './i18n/en';
import {
  CAMP_AS_ACTION, CAMP_SITE_RATINGS, RATING_TEXT, knownSpots, siteKnowledge, siteRating, siteRatingCounts, siteRatingsOn,
  ratingBadges, ratingCountsText, ratingOfFacts, spotTraits, type CampSpot,
} from './camp-sites';
import { observe } from '../artificer-ai/observe';
import { startGame, view, type Game } from '../artificer-play/session';
import { serialize, deserialize, makeWarden, previewQueue, type AppState } from '../artificer-app/controller';
import { paletteBlock, sitesBlock, campBadges } from '../artificer-app/camp-blocks';
import { choiceNote } from '../artificer-app/sim-words';

const en = makeT('en');
const sv = makeT('sv');

type Ratings = boolean | 'absent';
/** Daylight, clear weather, no luck, accidents or encounters; camp is an action; the ratings as asked. */
const world = (ratings: Ratings): WorldConfig => ({
  ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear', encounters: false,
  features: { [CAMP_AS_ACTION]: true, ...(ratings === 'absent' ? {} : { [CAMP_SITE_RATINGS]: ratings }) },
});
const stats = (int: number) => ({ str: 10, con: 10, agi: 10, int, wil: 10, cha: 10 });
function warden(id: string, int: number, ratings: Ratings = true): Region1State {
  return createRegion1({ world: world(ratings) }, undefined, { id, stats: stats(int) });
}
/** Every ring surveyed: each domain observed. */
const surveyed = (): Exploration => survey(survey(survey(createExploration(), 1), 2), 3);
/** Only these domains observed, in every ring: so only those kinds of site are known. */
function observedOnly(...domains: Domain[]): Exploration {
  const e = createExploration();
  for (const r of [1, 2, 3] as const) for (const d of domains) e.known[r][d] = 2;
  return e;
}
const camp = (spot: string): QueueItem => ({ q: 'camp', opts: { spot } });
const app = (sim: Region1State): AppState => ({ ...makeWarden({ id: sim.character.id }), sim, queue: [] });
const palette = (sim: Region1State, t = en): string => { const a = app(sim); return paletteBlock(a, previewQueue(a), { dev: false, t }); };
/** The Make camp card alone, from the palette. */
const campCard = (html: string): string => /<button class="act[^"]*" data-q="camp"[\s\S]*?<\/button>/.exec(html)?.[0] ?? '';
const only = (s: Region1State, kind: CampSpot['kind']): CampSpot => {
  const p = knownSpots(s).find(x => x.kind === kind);
  if (!p) throw new Error(`no ${kind} known in this Reach`);
  return p;
};

describe('The Make camp action counts the great and good places to camp you know (#1756)', () => {
  it('1. a new run that knows only its start, a Hilltop, shows no badges', () => {
    const s = warden('w-astrid', 10);
    const spots = knownSpots(s);
    expect(spots.map(p => [p.kind, p.start])).toEqual([['hill', true]]);
    expect(siteRating(s, spots[0])).toBe('poor');
    expect(siteRatingCounts(s)).toEqual({ great: 0, good: 0 });
    expect(ratingBadges(siteRatingCounts(s))).toBe('');
    const card = campCard(palette(s));
    expect(card).toContain('data-q="camp"');
    expect(card).not.toContain('cbadges');
    expect(card).not.toMatch(/[★✓]/);
    expect(observe(s)).not.toMatch(/PLACES TO CAMP YOU KNOW/);
  });

  it('2. an explored riverbank read as fair, sheltered and near water counts as good: the action shows ✓ 1', () => {
    // Intelligence 13 reads fairly (camp-sites.ts readingScore); only the water is known, so the riverbank is the one site found.
    const s = { ...warden('w-astrid', 13), explore: observedOnly('water') };
    const river = only(s, 'river');
    expect(knownSpots(s).map(p => p.kind).sort()).toEqual(['hill', 'river']);
    const k = siteKnowledge(s, river);
    expect(k.band).toBe('fair');
    expect(k.facts.map(f => f.key)).toEqual(expect.arrayContaining(['someWind', 'waterHere']));
    expect(siteRating(s, river)).toBe('good');
    expect(siteRatingCounts(s)).toEqual({ great: 0, good: 1 });
    expect(ratingBadges(siteRatingCounts(s))).toBe('✓ 1');
    // The badge as shown: ✓ 1 alone (no "★ 0").
    expect(campCard(palette(s))).toContain('<span class="cbadges" title="Places to camp you know, as you read them: 0 great (★), 1 good (✓)">✓ 1</span>');
  });

  it('3. a cave read as sharp, out of the wind and dry counts as great', () => {
    const s = { ...warden('w-fen', 17), explore: observedOnly('stone') };
    const cave = only(s, 'cave');
    const k = siteKnowledge(s, cave);
    expect(k.band).toBe('sharp');
    expect(k.facts.map(f => f.key)).toEqual(expect.arrayContaining(['outOfWind', 'groundDry', 'noRisk']));
    expect(siteRating(s, cave)).toBe('great');
    expect(siteRatingCounts(s).great).toBe(1);
    expect(campCard(palette(s))).toContain('★ 1');
    // The rule itself: any cave read sharp as out of the wind and dry, with no danger seen, is great, however far the water and wood.
    const far = [{ trait: 'wind', key: 'outOfWind' }, { trait: 'water', key: 'waterAt', n: 240 }, { trait: 'fuel', key: 'woodAt', n: 120 }, { trait: 'ground', key: 'groundDry' }, { trait: 'risk', key: 'noRisk' }] as const;
    expect(ratingOfFacts('cave', far)).toBe('great');
    // …but not with loose rock seen above, and never a riverbank (damp) or a hilltop (open).
    expect(ratingOfFacts('cave', far.map(f => (f.trait === 'risk' ? { ...f, key: 'rockfall' } : f)))).not.toBe('great');
    expect(ratingOfFacts('river', [{ trait: 'wind', key: 'outOfWind' }, { trait: 'water', key: 'waterHere' }, { trait: 'fuel', key: 'woodHere' }, { trait: 'ground', key: 'groundDamp' }, { trait: 'risk', key: 'noRisk' }])).toBe('good');
    expect(ratingOfFacts('hill', [{ trait: 'wind', key: 'openWind' }, { trait: 'water', key: 'waterHere' }, { trait: 'fuel', key: 'woodHere' }, { trait: 'ground', key: 'groundDry' }, { trait: 'risk', key: 'noRisk' }])).toBe('poor');
  });

  it('4. a vague reading that overrates a site: the badges follow the belief, and correct after camping there', () => {
    // Intelligence 7 reads at a glance: the cave looks sheltered and dry; it has loose rock above, which a glance can't see.
    const s = { ...warden('w-astrid', 7), explore: surveyed() };
    const cave = only(s, 'cave');
    expect(siteKnowledge(s, cave).band).toBe('vague');
    expect(spotTraits(s, cave).risk).toBe('rockfall');
    expect(siteRating(s, cave)).toBe('great');
    const before = siteRatingCounts(s);
    expect(before.great).toBe(1);
    expect(campCard(palette(s))).toContain(ratingBadges(before));
    // The truth, as a sharp eye would read it, is lower: the belief is what's counted.
    const sharp = { ...s, character: { ...s.character, stats: stats(17) } };
    expect(siteRating(sharp, cave)).not.toBe('great');
    // Camped there, the Warden knows it as it is, and the counts follow.
    const after = runAction(s, camp(cave.id));
    const there = knownSpots(after).find(p => p.id === cave.id)!;
    expect(siteKnowledge(after, there).band).toBe('known');
    expect(siteRating(after, there)).toBe(siteRating(sharp, cave));
    const counts = siteRatingCounts(after);
    expect(counts.great).toBe(before.great - 1);
    expect(campCard(palette(after))).toContain(ratingBadges(counts) || 'data-q="camp"');
  });

  it('5. the AI and the API get the same counts and ratings as the page', () => {
    const s = { ...warden('w-astrid', 7), explore: surveyed() };
    const counts = siteRatingCounts(s);
    expect(counts.great + counts.good).toBeGreaterThan(1);
    // The AI's observation: the counts on the action's line, each site's rating in its option.
    const text = observe(s);
    expect(text).toMatch(new RegExp(`^- camp · .* · PLACES TO CAMP YOU KNOW, as you read them: ${ratingCountsText(counts)}$`, 'm'));
    const [g] = ACTIONS.camp.options!(s, {});
    for (const p of knownSpots(s)) {
      const r = siteRating(s, p);
      const c = g.choices.find(x => x.value === p.id)!;
      if (r === 'poor') expect(c.note).not.toMatch(/place to camp/);
      else expect(c.note.endsWith(` · ${RATING_TEXT[r]}`)).toBe(true);
      // The page's option note is the same English, and its card marks the same rating.
      if (!c.blocked) expect(choiceNote(s, g, c, en)).toBe(c.note);
    }
    const cards = sitesBlock(s, en);
    expect((cards.match(/class="rate great"/g) ?? []).length).toBe(counts.great);
    expect((cards.match(/class="rate good"/g) ?? []).length).toBe(counts.good);
    expect(campCard(palette(s))).toContain(`>${ratingBadges(counts)}</span>`);
    // In Swedish: the same glyphs and counts, the words from the catalog.
    expect(campCard(palette(s, sv))).toContain(`>${ratingBadges(counts)}</span>`);
    expect(sitesBlock(s, sv)).toContain(sv('campsite.rate.great'));
    for (const c of g.choices) if (!c.blocked && siteRating(s, knownSpots(s).find(p => p.id === c.value)!) === 'good') expect(choiceNote(s, g, c, sv)).toContain(sv('campsite.rated.good'));
    // The API: an English game's view is the observation; a Swedish one says the same counts in Swedish.
    const game = startGame({ seed: 'ratings-1' });
    const g1: Game = { ...game, app: { ...game.app, sim: { ...game.app.sim, explore: surveyed() } } };
    const c1 = siteRatingCounts(g1.app.sim);
    expect(view(g1).text).toBe(observe(g1.app.sim));
    if (c1.great + c1.good) expect(view(g1).text).toContain(ratingCountsText(c1));
    const svText = view({ ...g1, lang: 'sv' }).text;
    expect(svText).toContain(sv('campsite.badgesTip', { great: c1.great, good: c1.good }));
    expect(campCard(palette(g1.app.sim))).toContain(ratingBadges(c1));
    // The catalog's English is the AI's, word for word.
    for (const [k, v] of Object.entries(RATING_TEXT)) expect(EN[`campsite.rated.${k}` as keyof typeof EN]).toBe(v);
  });

  it('6. with the switch off or absent, nothing changes', () => {
    const states = (r: Ratings) => [warden('w-astrid', 7, r), { ...warden('w-astrid', 7, r), explore: surveyed() }, { ...warden('w-fen', 17, r), explore: surveyed() }];
    for (const r of [false, 'absent'] as const) {
      for (const s of states(r)) {
        expect(siteRatingsOn(s)).toBe(false);
        expect(siteRatingCounts(s)).toEqual({ great: 0, good: 0 });
        expect(campBadges(s, en)).toBe('');
        expect(campCard(palette(s))).not.toMatch(/cbadges|[★✓]/);
        expect(sitesBlock(s, en)).not.toMatch(/class="rate|[★✓]/);
        expect(observe(s)).not.toMatch(/PLACES TO CAMP YOU KNOW|place to camp/);
        for (const c of ACTIONS.camp.options!(s, {})[0].choices) expect(c.note).not.toMatch(/place to camp/);
      }
    }
    // Off and absent are the same page, line for line, and the same observation.
    const [offS, absS] = [states(false)[1], states('absent')[1]];
    expect(palette(offS)).toBe(palette(absS));
    expect(sitesBlock(offS, sv)).toBe(sitesBlock(absS, sv));
    expect(observe(offS)).toBe(observe(absS));
  });

  it('7. pure and deterministic: the same ratings every time and after a reload, and no new random draws', () => {
    const s = { ...warden('w-astrid', 7), explore: surveyed() };
    const ratings = (x: Region1State) => knownSpots(x).map(p => [p.id, siteRating(x, p)]);
    expect(ratings(s)).toEqual(ratings(s));
    const a = { ...makeWarden({ id: 'w-astrid' }), sim: s };
    const back = deserialize(serialize(a))!;
    expect(ratings(back.sim)).toEqual(ratings(s));
    expect(siteRatingCounts(back.sim)).toEqual(siteRatingCounts(s));
    // A day of play is the same run with the ratings on or off: only what you're told differs.
    const play = (r: Ratings): string => {
      let x = { ...warden('w-astrid', 7, r), explore: surveyed() };
      x = runDay(x, [camp(knownSpots(x)[0].id), 'water', 'wood']).state;
      x = runDay(x, [camp(only(x, 'cave').id), 'gather']).state;
      return JSON.stringify({ ...x, config: null });
    };
    expect(play(true)).toBe(play(false));
    expect(play(true)).toBe(play('absent'));
  });
});
