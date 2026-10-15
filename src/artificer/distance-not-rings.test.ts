/**
 * Acceptance tests for #1752 — the player sees distance instead of "rings" (switch
 * `distance-not-rings`, distance-words.ts). One test per Given/When/Then:
 *
 *   1. The switch        — a rules feature, on in a new game, off for a run saved before it.
 *   2. No "ring", English — with the switch on, nothing the Warden, the AI or the API reads in English
 *                           says "ring": the journal, the reasons, the AI's per-turn observation,
 *                           the API's moves and refusals, the LAND tab and the action palette.
 *   3. No "ring", Swedish — the same on the page and in a Swedish API game: no "ring"/"ringen"/"ringarna".
 *   4. Before camp       — distances are measured from where you are: the run's start.
 *   5. After moving camp — they're measured from the new camp (#1748's camp action), and follow it.
 *   6. Off and absent    — a run with the switch off, and one saved before it, play and read exactly the same.
 *   7. Rules untouched   — on or off, a scripted run gets the same stores, vitals and knowledge: only the words differ.
 *   8. Deterministic     — the same seed and moves give the same run, twice.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runDay, runAction, forgetPin, type Region1State, type QueueItem } from './region1';
import { FULL_WORLD, type WorldConfig } from './world';
import { createExploration, survey } from './exploration';
import { ruleFeatures, featureById, featureOn } from './features';
import { DISTANCE_NOT_RINGS, DISTANCE_AT, unring } from './distance-words';
import { knownPlaces, landOrigin, reachOfRun } from './descriptive-map';
import { knownSpots } from './camp-sites';
import { COST, walkFrom } from './world/reach';
import { pinId, type Pin } from './pins';
import { makeT, varsOf } from './i18n';
import { en as EN } from './i18n/en';
import { observe, RULES } from '../artificer-ai/observe';
import { startGame, view, apply as applyMove } from '../artificer-play/session';
import { landTab } from '../artificer-app/land-view';
import { paletteBlock } from '../artificer-app/camp-blocks';
import { pinsList } from '../artificer-app/pins-view';
import { logText } from '../artificer-app/journal-view';
import { makeWarden, previewQueue, type AppState } from '../artificer-app/controller';

const en = makeT('en');
const sv = makeT('sv');

/** The word "ring" as the game used it, in English; what's left once the real rings (a ring of stones, an alarm that rings) and the AI's reply field are taken out. */
const RING_EN = /\brings?\b/i;
const RING_SV = /\bring(en|ar|arna|ens)?\b/i;
const LITERAL = [/A ring of blackened stones/g, /En ring av svärtade stenar/g, /rings (at dawn|under your feet|with lowland coin|on it)/g, /seal ring/g, /"ring"/g];
const plain = (html: string): string => LITERAL.reduce((t, re) => t.replace(re, ''), html.replace(/\bdata-[\w-]+="[^"]*"/g, '').replace(/<[^>]*>/g, ' '));
const ringsIn = (text: string, re: RegExp): string[] => plain(text).split('\n').filter(l => re.test(l));

/** Clear daylight, no luck or encounters: what happens is the rules'. Every rule feature at its default, this one as asked. */
function world(on: boolean | 'absent'): WorldConfig {
  const features: Record<string, boolean> = { ...ruleFeatures() };
  if (on === 'absent') delete features[DISTANCE_NOT_RINGS];
  else features[DISTANCE_NOT_RINGS] = on;
  return { ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear', encounters: false, features };
}
const warden = (on: boolean | 'absent' = true): Region1State => createRegion1({ world: world(on) }, undefined, { id: 'w-astrid' });

/** Three days that go to every distance, are refused on the way (out of reach, no game), and let a remembered place go. */
const DAYS: readonly (readonly QueueItem[])[] = [
  ['explore', 'gather@3', 'explore@2'],
  ['water@2', 'hunt@2', 'explore@3'],
  ['wood@3', 'explore@2', 'gather@2'],
];
const pin = (place: string, kind: Pin['kind'], ring: 1 | 2 | 3, extra: Partial<Pin> = {}): Pin => ({ id: pinId(place, ring), place, kind, ring, day: 1, ...extra });

function scripted(on: boolean | 'absent' = true): Region1State {
  let s = warden(on);
  s = { ...s, pins: [pin('deep-pool', 'fishing', 2), pin('strange-carving', 'wonder', 3, { feeling: 'eerie' }), pin('sunlit-glade', 'peaceful', 1, { feeling: 'peaceful' })] };
  for (const day of DAYS) s = runDay(s, day).state;
  s = forgetPin(s, s.pins![0].id);
  // An old wound that names the walk out: the AI reads it every turn.
  return { ...s, character: { ...s.character, harms: ['stiff-knee'] } };
}
const app = (sim: Region1State): AppState => ({ ...makeWarden({ id: 'w-astrid' }), sim, queue: [] });

/** What the AI reads each turn: the observation, without the cached rules (a constant, kept as it was). */
const perTurn = (s: Region1State): string => observe(s);

describe('Distance instead of rings (#1752)', () => {
  it('1. the switch: a rules feature, on in a new game, off for a run from before it', () => {
    const f = featureById(DISTANCE_NOT_RINGS)!;
    expect(f).toMatchObject({ kind: 'rules', default: true, absent: false, issue: 1752 });
    expect(ruleFeatures()[DISTANCE_NOT_RINGS]).toBe(true);
    expect(featureOn({}, DISTANCE_NOT_RINGS)).toBe(false);
  });

  it('2. Given the switch on, When the Warden, the AI and the API read the game in English, Then no text says "ring"', () => {
    const s = scripted();
    // The run went everywhere it says it did, so the words below are the ones that used to name rings.
    const journal = s.log.map(l => l.text).join('\n');
    expect(journal).toContain('half a day out');
    expect(journal).toContain('skipped');
    expect(journal).toContain('You let it go');
    expect(ringsIn(journal, RING_EN)).toEqual([]);
    expect(ringsIn(perTurn(s), RING_EN)).toEqual([]);
    expect(perTurn(s)).toContain('@2 half a day out');
    // The page in English: the LAND tab, the palette at each distance, the pins.
    const a = app(s);
    const pages = [landTab(s, en), pinsList(s, en), ...[1, 2, 3].map(r => paletteBlock(a, previewQueue(a), { ring: r as 1 | 2 | 3, dev: false, t: en }))];
    for (const html of pages) expect(ringsIn(html, RING_EN)).toEqual([]);
    // The API: its view, its moves' labels, and a refusal at a distance you can't reach yet.
    const g = startGame({ seed: 'dist-api' });
    const v = view(g);
    expect(ringsIn(v.text, RING_EN)).toEqual([]);
    expect(ringsIn(v.moves.map(m => m.label).join('\n'), RING_EN)).toEqual([]);
    const refused = applyMove(g, { do: 'explore@3' });
    expect(refused.ok).toBe(false);
    expect(ringsIn(refused.ok ? '' : refused.error, RING_EN)).toEqual([]);
    expect(refused.ok ? '' : refused.error).toContain('@3');
  });

  it('3. Given the switch on, When the page and a Swedish API game are read in Swedish, Then nothing says "ring" either', () => {
    const s = scripted();
    expect(ringsIn(s.log.map(l => logText(l, sv)).join('\n'), RING_SV)).toEqual([]);
    expect(s.log.map(l => logText(l, sv)).join('\n')).toContain('en halv dag bort');
    const a = app(s);
    const pages = [landTab(s, sv), pinsList(s, sv), ...[1, 2, 3].map(r => paletteBlock(a, previewQueue(a), { ring: r as 1 | 2 | 3, dev: false, t: sv }))];
    for (const html of pages) expect(ringsIn(html, RING_SV)).toEqual([]);
    expect(landTab(s, sv)).toContain('EN HALV DAG BORT');
    // And no English left where a distance replaced a ring: every new line has its Swedish.
    const ENGLISH = /(?<![\p{L}])(the|you|yet|first|known|half a day|a day out|close by|there and back|from camp|where you are)(?![\p{L}])/giu;
    for (const html of [...pages, s.log.map(l => logText(l, sv)).join('\n')]) expect(plain(html).match(ENGLISH) ?? []).toEqual([]);
    let g = startGame({ seed: 'dist-api-sv', lang: 'sv' });
    expect(ringsIn(view(g).text, RING_SV)).toEqual([]);
    const refused = applyMove(g, { do: 'explore@3' });
    expect(ringsIn(refused.ok ? '' : refused.error, RING_SV)).toEqual([]);
    for (const move of ['explore', 'explore@2', 'water@2']) { const r = applyMove(g, { do: move }); if (r.ok) { g = r.game; expect(ringsIn(r.changed.join('\n'), RING_SV)).toEqual([]); } }
    expect(ringsIn(view(g).text, RING_SV)).toEqual([]);
  });

  it('4. Given no camp yet, When the land is told, Then distances are measured from where you are (the start)', () => {
    const s = { ...warden(), explore: survey(survey(createExploration(), 1), 2) };
    const r = reachOfRun(s);
    expect(s.campSpot).toBeUndefined();
    expect(landOrigin(s, r)).toEqual(r.camp);
    // The same places, at the same walking times, as the land in words had them before the switch.
    expect(knownPlaces(s)).toEqual(knownPlaces({ ...s, config: { ...s.config, world: { ...s.config.world, features: { ...s.config.world.features, [DISTANCE_NOT_RINGS]: false } } } }));
    expect(landTab(s, en)).toContain('from where you are');
    expect(perTurn(s)).toContain('from where you are');
  });

  it('5. Given camp moved (the camp action), When the land is told, Then distances are measured from the new camp', () => {
    let s = warden();
    s = runAction(s, { q: 'camp', opts: { spot: knownSpots(s)[0].id } });
    s = { ...s, explore: survey(survey(survey(createExploration(), 1), 2), 3) };
    const to = knownSpots(s).find(p => !p.here && p.hours > 1)!;
    expect(to).toBeDefined();
    s = runAction(s, { q: 'camp', opts: { spot: to.id } });
    expect(s.campSpot?.at).toBe(to.id);
    const r = reachOfRun(s);
    expect(landOrigin(s, r)).toEqual({ x: to.x, y: to.y });
    // Each place's walking time is the walk from the new camp to its edge.
    const walk = walkFrom(r, to.x, to.y);
    const places = knownPlaces(s).filter(p => !p.horizon);
    expect(places.length).toBeGreaterThan(0);
    for (const p of places) {
      const edge = Math.min(...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [p.at.x + dx, p.at.y + dy])
        .filter(([x, y]) => x >= 0 && y >= 0 && x < r.w && y < r.h).map(([x, y]) => walk[y * r.w + x]));
      expect(p.hours).toBeCloseTo(COST[r.cells[to.y * r.w + to.x].biome] / 2 + edge, 9);
    }
    // Not the times from the start, which is where the switch off still tells them from.
    const off = { ...s, config: { ...s.config, world: { ...s.config.world, features: { ...s.config.world.features, [DISTANCE_NOT_RINGS]: false } } } };
    expect(knownPlaces(s).map(p => p.hours)).not.toEqual(knownPlaces(off).map(p => p.hours));
    expect(landTab(s, en)).toContain('from camp');
    expect(perTurn(s)).toContain('by how far it is from camp');
    // And they follow camp when it moves again.
    const back = knownSpots(s).find(p => p.start)!;
    const again = runAction(s, { q: 'camp', opts: { spot: back.id } });
    expect(landOrigin(again, r)).toEqual({ x: back.x, y: back.y });
  });

  it('6. Given the switch off, or a run from before it, When the same run is played, Then it plays and reads exactly as today', () => {
    const off = scripted(false), absent = scripted('absent');
    expect(off.log).toEqual(absent.log);
    expect({ ...off, config: null }).toEqual({ ...absent, config: null });
    expect(perTurn(off)).toEqual(perTurn(absent));
    expect(landTab(off, en)).toEqual(landTab(absent, en));
    expect(landTab(off, sv)).toEqual(landTab(absent, sv));
    // The rings, as they were.
    expect(off.log.map(l => l.text).join('\n')).toContain('in the far ring');
    expect(perTurn(off)).toContain('- ring 2 far (+3h travel)');
    expect(landTab(off, en)).toContain('FAR');
  });

  it('7. Given the switch on or off, When the same run is played, Then the rules are untouched: only the words differ', () => {
    const on = scripted(true), off = scripted(false);
    const rules = (s: Region1State) => ({ ...s, config: null, log: s.log.length });
    expect(rules(on)).toEqual(rules(off));
    // Line for line, the words on are the words off said as distances.
    expect(on.log.map(l => l.text)).toEqual(off.log.map(l => unring(l.text)));
    expect(Object.values(DISTANCE_AT)).toEqual(['close by', 'half a day out', 'a day out']);
  });

  it('8. Given the same seed and moves, When the run is played twice with the switch on, Then it is the same run', () => {
    expect(scripted(true)).toEqual(scripted(true));
    expect(perTurn(scripted(true))).toEqual(perTurn(scripted(true)));
  });

  it('the catalog: every string that names a ring has its distance version, with the same {vars}, in both languages', () => {
    const keys = Object.keys(EN) as (keyof typeof EN)[];
    // Strings drawn only with the switch off, or only by the sim's English when it's off (the `.dist` template takes over).
    const OFF_ONLY = new Set(['ring.in', 'log.scout.2', 'log.explore.2', 'log.lookout.over', 'log.letGo', 'reason.noGameIn', 'reason.untrackedIn', 'w.unease.distant', 'say.unlock.scout', 'say.manual.tally-book', 'w.unlock.scout.verb', 'w.harm.stiff-knee.does']);
    const ringed = keys.filter(k => !k.endsWith('.dist') && !OFF_ONLY.has(k) && RING_EN.test(plain(EN[k]).replace(/\{\w+\}/g, '')));
    for (const k of ringed) expect(keys, k).toContain(`${k}.dist`);
    for (const k of keys.filter(x => x.endsWith('.dist'))) {
      const base = k.slice(0, -'.dist'.length) as keyof typeof EN;
      if (base in EN && !OFF_ONLY.has(base)) expect(varsOf(EN[k]), k).toEqual(varsOf(EN[base]));
      const bare = (text: string): string => plain(text).replace(/\{\w+\}/g, '');
      expect(RING_EN.test(bare(EN[k])), k).toBe(false);
      expect(RING_SV.test(bare(sv(k))), k).toBe(false);
    }
  });

  it('keeps the AI\'s cached rules prompt as it was', () => {
    // The rules are static and cached: the per-turn observation carries the distances instead.
    expect(RULES).toContain('"ring": 1 | 2 | 3');
  });
});
