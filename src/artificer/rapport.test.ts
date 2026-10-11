/**
 * Acceptance tests for #1578 — rapport, not a number: the trust score stays hidden, each person on
 * the road shows a felt word instead, the word can misread them, and moments of truth correct it.
 * One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { DEFAULT_STATS, type Stats } from './stats';
import { createRoad, endRoadDay, runRoadAction, ROUTE, type RoadState } from './road';
import { VILLAGES, TRAVELLERS, BASE_TRUST, FRIEND_LESSON, CONTACT_TRUST, peopleOf } from './villages';
import { OFFER_TRUST } from './quests';
import { FRIEND_HEAL, SET_BONE_TRUST } from './injuries';
import { FRIEND_TRUST, TRADER_STOCK, buyPrice } from './trade';
import {
  RAPPORT_BANDS, RAPPORT_WORDS, CLEAR_READ, feltOf, feltWord, misreadDraw, misreading, momentOfTruth, rapportWord, readerOf, trueWord,
  type Reader,
} from './rapport';
import { observeRoad, ROAD_RULES } from '../artificer-ai/observe';
import { roadView, questLog } from '../artificer-app/road-view';
import { deserialize, serialize, type AppState } from '../artificer-app/controller';

const EVERYONE = [...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS];

/** A Region 1 run that survived to the thaw: hale (or ragged), with this Charisma. */
function survived(id = 'w-rapport', opts: { cha?: number; grade?: 'hale' | 'worn' } = {}): Region1State {
  const s = createRegion1({}, undefined, { id, name: 'Vega', stats: { ...DEFAULT_STATS, cha: opts.cha ?? 10 } });
  const vitals = createVitals({ condition: 90 });
  return { ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 10, water: 10 }, outcome: { choice: 'thaw', kind: 'survived', grade: opts.grade ?? 'hale', vitals } };
}
/** Ride the road into Hollowford, the first village, clear-headed for the morning. */
function inHollowford(id?: string): RoadState {
  let r = createRoad(survived(id));
  const leg = ROUTE.findIndex(l => l.kind === 'village');
  while (r.leg < leg && !r.outcome) r = endRoadDay(r);
  return { ...r, vitals: { ...r.vitals, clarity: { ...r.vitals.clarity, current: r.vitals.clarity.cap } } };
}
/** A Warden id whose seeded read of `pid` runs colder than `below` (a pure search over ids: no RNG stream). */
const coldReaderOf = (pid: string, below: number): string =>
  Array.from({ length: 1000 }, (_, i) => `w-rapport-${i}`).find(id => misreadDraw(id, pid) < below)!;
const newLines = (before: RoadState, after: RoadState): string[] => after.log.slice(before.log.length).map(l => l.text);
const readLines = (before: RoadState, after: RoadState): string[] => newLines(before, after).filter(t => /than you thought\.$/.test(t));
const reader = (o: Partial<Reader> = {}): Reader => ({ id: 'w-vega', stats: { ...DEFAULT_STATS }, clarity: 80, ragged: false, ...o });
const withCha = (cha: number): Stats => ({ ...DEFAULT_STATS, cha });

describe('Rapport, not a number (#1578)', () => {
  // 1. Given no misreading left, when a person's true trust is anywhere on 0–100, then the felt word follows the bands — cut at the gates.
  it('names the bands, cut at the gates, and reads true with no misreading left', () => {
    const cases: [number, string][] = [
      [0, 'wary'], [9, 'wary'], [10, 'stranger'], [14, 'stranger'], [15, 'civil'], [24, 'civil'], [25, 'cordial'], [39, 'cordial'],
      [40, 'friendly'], [49, 'friendly'], [50, 'warm'], [59, 'warm'], [60, 'trusted'], [74, 'trusted'], [75, 'close'], [100, 'close'],
    ];
    for (const [n, word] of cases) expect(rapportWord(n), `score ${n}`).toBe(word);
    // Every gate starts a word, so a word changing lines up with something opening.
    for (const gate of [BASE_TRUST.ragged, OFFER_TRUST, FRIEND_LESSON, FRIEND_HEAL, FRIEND_TRUST, CONTACT_TRUST, SET_BONE_TRUST]) {
      expect(RAPPORT_BANDS.some(b => b.from === gate), `gate ${gate}`).toBe(true);
    }
    expect(RAPPORT_BANDS.map(b => b.from)).toEqual([...RAPPORT_BANDS.map(b => b.from)].sort((a, b) => a - b));
    expect(new Set(RAPPORT_WORDS).size).toBe(8);
    // On the road, with every misreading spent, each person seems exactly what they are.
    const r = inHollowford();
    const people = peopleOf('hollowford');
    const exact: RoadState = { ...r, trust: Object.fromEntries(people.map((p, i) => [p.id, 5 + i * 22])), readings: Object.fromEntries(people.map(p => [p.id, 0])) };
    for (const p of people) expect(feltWord(exact, p.id)).toBe(rapportWord(exact.trust[p.id]));
  });

  // 2. Given the same Warden and person, when the misreading is worked out twice, then it's the same; another person (or Warden) gets another.
  it('misreads deterministically per Warden and person, and differently between people', () => {
    const maren = EVERYONE.find(p => p.id === 'hf-maren')!;
    expect(misreading(reader(), maren)).toBe(misreading(reader(), maren));
    const draws = EVERYONE.map(p => misreadDraw('w-vega', p.id));
    expect(new Set(draws).size).toBe(draws.length);
    for (const d of draws) expect(Math.abs(d)).toBeLessThan(1);
    expect(misreadDraw('w-other', 'hf-maren')).not.toBe(misreadDraw('w-vega', 'hf-maren'));
    // On the road it's read off the Warden's own id.
    const r = inHollowford();
    expect(readerOf(r).id).toBe(r.character.id);
  });

  // 3. Given the same Warden and person, when Charisma is higher, the read is truer; when Clarity is low, it's further off.
  it('reads truer with Charisma, and worse with a tired mind', () => {
    const tobin = { id: 'hf-tobin' };
    const off = (o: Partial<Reader>): number => Math.abs(misreading(reader(o), tobin));
    expect(off({ stats: withCha(15) })).toBeLessThan(off({}));
    expect(off({})).toBeLessThan(off({ stats: withCha(7) }));
    expect(off({ clarity: 10 })).toBeGreaterThan(off({ clarity: 80 }));
    // A clear head reads as well as it can: tiredness only counts below CLEAR_READ.
    expect(off({ clarity: CLEAR_READ })).toBeCloseTo(off({ clarity: 100 }), 10);
  });

  // 4. Given a reserved person, or a Warden who came through the winter ragged, then the read leans colder.
  it('reads reserved people, and everyone after a ragged winter, colder', () => {
    const plain = misreading(reader(), { id: 'hf-maren' });
    expect(misreading(reader(), { id: 'hf-maren', reserved: true })).toBeLessThan(plain);
    expect(misreading(reader({ ragged: true }), { id: 'hf-maren' })).toBeLessThan(plain);
    // The guarded ones, from their personality lines: Maren (dry), Yrsa (few words), Veit (formal), Runa at the Gate (severe).
    const reserved = EVERYONE.filter(p => p.reserved).map(p => p.id);
    expect(reserved).toEqual(expect.arrayContaining(['hf-maren', 'sm-yrsa', 'kg-veit', 'kg-runa']));
    expect(reserved.length).toBeGreaterThanOrEqual(3);
    expect(reserved.length).toBeLessThanOrEqual(5);
    // On the road: the same Warden and trust, a ragged arrival seems colder than a thriving one.
    const r = inHollowford();
    expect(feltOf({ ...r, arrival: 'ragged' }, 'hf-tobin').score).toBeLessThan(feltOf({ ...r, arrival: 'thrive' }, 'hf-tobin').score);
  });

  // 5+6. Given a trader whose felt word reads below "warm" while their true trust is 50+, when you buy,
  // then you get the friend's rate (the gate reads the truth), your read of them halves and the journal
  // says once that they're warmer than you thought; the next friend's-rate trade, with the word now true, writes nothing.
  it('gives a friend’s rate on true trust, and the trade is a moment of truth', () => {
    const id = coldReaderOf('hf-tobin', -0.5);
    const base = inHollowford(id);
    const m = misreading(readerOf(base), { id: 'hf-tobin' });
    expect(m).toBeLessThan(-2);
    // True trust just high enough that half the misreading still reads warm, all of it doesn't.
    const truth = Math.ceil(CONTACT_TRUST - m / 2);
    expect(truth).toBeGreaterThanOrEqual(FRIEND_TRUST);
    const s: RoadState = { ...base, marks: 50, trust: { ...base.trust, 'hf-tobin': truth } };
    expect(RAPPORT_WORDS.indexOf(feltWord(s, 'hf-tobin'))).toBeLessThan(RAPPORT_WORDS.indexOf('warm'));
    expect(trueWord(s, 'hf-tobin')).toBe('warm');

    const after = runRoadAction(s, 'buy:rawFood:10');
    const terms = { wants: TRADER_STOCK['hf-tobin'].wants, priceFactor: 1 };
    expect(s.marks - after.marks).toBe(buyPrice('rawFood', 10, { ...terms, trust: truth }));
    expect(buyPrice('rawFood', 10, { ...terms, trust: truth })).toBeLessThan(buyPrice('rawFood', 10, { ...terms, trust: 0 }));
    expect(after.readings?.['hf-tobin']).toBe(0.5);
    expect(readLines(s, after)).toEqual(['Tobin is warmer to you than you thought.']);
    expect(feltWord(after, 'hf-tobin')).toBe('warm');

    const again = runRoadAction(after, 'buy:rawFood:1');
    expect(again.readings?.['hf-tobin']).toBe(0.25);
    expect(readLines(after, again)).toEqual([]);
  });

  // 7. Given a misreading, when someone shows where you stand some other way — a free lesson, a favour asked,
  // a secret told, becoming a contact — then your read of them moves halfway to the truth (one line at most).
  it('makes free lessons, favours, secrets and new contacts moments of truth', () => {
    const r = { ...inHollowford(), marks: 0 };
    const lesson = runRoadAction({ ...r, trust: { ...r.trust, 'hf-isa': FRIEND_LESSON } }, 'learn:hf-isa:greens');
    expect(lesson.techniques).toContain('greens');
    expect(lesson.readings?.['hf-isa']).toBe(0.5);
    expect(readLines(r, lesson).length).toBeLessThanOrEqual(1);

    const favour = runRoadAction({ ...r, trust: { ...r.trust, 'hf-orrin': OFFER_TRUST } }, 'accept:hf-forge-wood');
    expect(favour.quests['hf-forge-wood']).toBe('active');
    expect(favour.readings?.['hf-orrin']).toBe(0.5);

    // Maren's third line is gated at 50: told, it's a secret.
    const secret = runRoadAction({ ...r, trust: { ...r.trust, 'hf-maren': 50 }, told: { ...r.told, 'hf-maren': 2 } }, 'talk:hf-maren');
    expect(secret.told['hf-maren']).toBe(3);
    expect(secret.readings?.['hf-maren']).toBe(0.5);

    // Not yet ready for that line, but the talk brings her to 50: she'll remember you now.
    const contact = runRoadAction({ ...r, trust: { ...r.trust, 'hf-maren': 48 }, told: { ...r.told, 'hf-maren': 2 } }, 'talk:hf-maren');
    expect(contact.told['hf-maren']).toBe(2);
    expect(contact.trust['hf-maren']).toBeGreaterThanOrEqual(CONTACT_TRUST);
    expect(contact.readings?.['hf-maren']).toBe(0.5);

    // An ordinary talk shows nothing: the read stays as it was.
    const chat = runRoadAction(r, 'talk:hf-tobin');
    expect(chat.readings?.['hf-tobin']).toBeUndefined();
  });

  // 8. Given repeated moments of truth, the line comes only while the word changes, and each one names the right direction.
  it('says warmer or cooler, and only when the word changes', () => {
    const r = inHollowford(coldReaderOf('hf-tobin', -0.5));
    const cold = { ...r, trust: { ...r.trust, 'hf-tobin': 52 } };
    const m = momentOfTruth(cold, 'hf-tobin');
    expect(m.readings['hf-tobin']).toBe(0.5);
    if (m.line) expect(m.line).toBe('Tobin is warmer to you than you thought.');
    // Read past the truth instead (a Warden whose read of Tobin runs warm): the correction is cooler.
    const warmId = Array.from({ length: 1000 }, (_, i) => `w-rapport-${i}`).find(id => misreadDraw(id, 'hf-tobin') > 0.6)!;
    const w = inHollowford(warmId);
    const mw = misreading(readerOf(w), { id: 'hf-tobin' });
    const over = { ...w, trust: { ...w.trust, 'hf-tobin': Math.floor(CONTACT_TRUST - mw / 2) - 1 } };
    expect(feltWord(over, 'hf-tobin')).toBe('warm');
    expect(momentOfTruth(over, 'hf-tobin').line).toBe('Tobin is cooler to you than you thought.');
    // Once the word is the truth, further moments say nothing.
    let s: RoadState = cold;
    for (let i = 0; i < 6; i++) s = { ...s, readings: momentOfTruth(s, 'hf-tobin').readings };
    expect(feltWord(s, 'hf-tobin')).toBe(trueWord(s, 'hf-tobin'));
    expect(momentOfTruth(s, 'hf-tobin').line).toBeNull();
  });

  // 9. Given any road state, the views a player reads — the AI's text and the page — show no trust number, bar or gate.
  it('shows no trust number anywhere a player looks', () => {
    const r = { ...inHollowford(), marks: 3 };
    const wagon = createRoad(survived());
    const noNumbers = (text: string): void => {
      expect(text).not.toMatch(/\btrust\s*\(?\d/i);
      expect(text).not.toMatch(/\(\d+\+\)/);
      expect(text).not.toMatch(/\d+\+ (gets|makes)/);
      expect(text).not.toMatch(/at trust/i);
    };
    for (const text of [observeRoad(r), observeRoad(wagon), ROAD_RULES]) noNumbers(text);
    expect(ROAD_RULES).not.toMatch(/0–100/);
    expect(observeRoad(r)).toContain(`hf-maren · Maren, elder · ${feltWord(r, 'hf-maren')} · `);
    for (const p of [...peopleOf('hollowford'), ...TRAVELLERS]) {
      const html = roadView(peopleOf('hollowford').includes(p) ? r : wagon, { person: p.id });
      noNumbers(html);
      expect(html).not.toContain('tbar');
      expect(html).not.toMatch(/\d+\/100/);
      expect(html).not.toContain('devtruth');
    }
    noNumbers(questLog(r));
  });

  // 10. Given dev mode, the cards and sheets show the truth beside the felt word; nowhere else changes.
  it('shows the true trust beside the word in dev mode', () => {
    const r = { ...inHollowford(), trust: { ...inHollowford().trust, 'hf-maren': 33 } };
    const html = roadView(r, { person: 'hf-maren', dev: true });
    expect(html).toContain('devtruth');
    expect(html).toContain('true: cordial (33)');
    expect(html).toContain(`>${feltWord(r, 'hf-maren')}</span>`);
  });

  // 11. Given a road saved before rapport (no readings), it loads and plays; a save round-trip keeps the readings, checked.
  it('loads old road saves, and keeps the readings through a save', () => {
    const sim = createRegion1({}, undefined, { id: 'w-rapport' });
    const road = inHollowford();
    expect(road.readings).toBeUndefined();
    const app = (rd: RoadState): AppState => ({ sim, queue: [], stage: 'road', road: rd });
    const old = deserialize(serialize(app(road)))!.road!;
    expect(old.readings).toBeUndefined();
    const played = runRoadAction({ ...old, trust: { ...old.trust, 'hf-orrin': OFFER_TRUST } }, 'accept:hf-forge-wood');
    expect(played.readings).toEqual({ 'hf-orrin': 0.5 });
    expect(deserialize(serialize(app(played)))!.road!.readings).toEqual({ 'hf-orrin': 0.5 });
    // A malformed share is dropped; the rest load.
    const odd = { ...road, readings: { 'hf-maren': 0.25, 'hf-tobin': 2, 'hf-isa': 'half' } } as unknown as RoadState;
    expect(deserialize(serialize(app(odd)))!.road!.readings).toEqual({ 'hf-maren': 0.25 });
  });
});
