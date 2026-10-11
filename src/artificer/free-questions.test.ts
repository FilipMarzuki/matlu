/**
 * Acceptance tests for #1575 (plan #1574): free questions v0. Once per person per stay the Warden
 * can ask anything in their own words; it's matched against what that person knows, answered with
 * the authored answer (gates passed) or deflected. No AI: the same words always match the same way.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, ROUTE, type RoadState } from './road';
import { ASK_HOURS, answerFor, topicsKnownBy } from './asks';
import { matchQuestion, deflectionOf } from './free-questions';
import { serialize, deserialize, type AppState } from '../artificer-app/controller';

/** A Warden on the caravan road at Hollowford (the first village), with no focus. */
function atHollowford(trust: Record<string, number> = {}): RoadState {
  const s = createRegion1({}, undefined, { id: 'w-free-q', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
  const from: Region1State = { ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 10, water: 10, rations: 6 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
  const village = ROUTE.findIndex(l => l.kind === 'village');
  let r = createRoad(from);
  for (let i = 0; i < 10 && r.leg < village; i++) r = endRoadDay(r);
  return { ...r, focus: null, trust: { ...r.trust, ...trust } };
}

const written = (before: RoadState, after: RoadState): string => after.log.slice(before.log.length).map(l => l.text).join(' ');

describe('Matching a free question to what someone knows (#1575)', () => {
  it('matches a topic named in the question, in any case', () => {
    expect(matchQuestion('hf-orrin', 'Where can I find iron around here?')).toBe('material:iron');
    expect(matchQuestion('hf-tobin', 'what is the compact??')).toBe('group:compact');
    expect(matchQuestion('hf-orrin', 'What is KESTREL GATE like?')).toBe('place:kestrel-gate');
  });

  it('matches a topic the question names indirectly: a word that points at it', () => {
    // No "iron" in it: ore is what iron comes from.
    expect(matchQuestion('hf-orrin', 'Where do people get ore?')).toBe('material:iron');
    // Mushrooms are foraging, which Isa teaches.
    expect(matchQuestion('hf-isa', 'Which mushrooms are safe to eat?')).toBe('skill:foraging');
    // Goblins point at the Compact.
    expect(matchQuestion('hf-maren', 'Are there goblins near the ford?')).toBe('group:compact');
  });

  it('matches through what the answer talks about: asking Orrin who Sabine is gets his answer that sends you to her', () => {
    const key = matchQuestion('hf-orrin', 'Who is Sabine?');
    expect(key).not.toBeNull();
    expect(answerFor('hf-orrin', key!)?.text).toContain('Sabine');
    // Told that one already, the next answer about her comes up instead.
    const next = matchQuestion('hf-orrin', 'Who is Sabine?', [key!]);
    expect(next).not.toBe(key);
    expect(answerFor('hf-orrin', next!)?.text).toContain('Sabine');
  });

  it('matches a teacher’s own skill, though nothing about it is written for them', () => {
    expect(topicsKnownBy('sm-yrsa')).toContain('skill:hunting');
    expect(matchQuestion('sm-yrsa', 'How do I hunt deer without scaring them?')).toBe('skill:hunting');
  });

  it('matches nothing when nothing they know is in it, or only their own name is', () => {
    expect(matchQuestion('hf-orrin', 'What is your favourite colour?')).toBeNull();
    expect(matchQuestion('hf-orrin', 'Orrin, how are you today?')).toBeNull();
    expect(matchQuestion('hf-orrin', '   ')).toBeNull();
    // Hedda knows nothing about iron, however it's asked.
    expect(matchQuestion('sm-hedda', 'Where do I get iron ore?')).toBeNull();
  });

  it('is the same every time: no randomness, nothing but the words', () => {
    const q = 'Tell me about the goblins and their maps';
    expect(matchQuestion('kg-arvid', q)).toBe(matchQuestion('kg-arvid', q));
    expect(deflectionOf('kg-arvid', 'Arvid')).toBe(deflectionOf('kg-arvid', 'Arvid'));
  });
});

describe('Asking a free question on the road (#1575)', () => {
  it('answers a matched question even past the gates: no focus, and trust below the answer’s', () => {
    const iron = answerFor('hf-orrin', 'material:iron')!;
    const before = atHollowford({ 'hf-orrin': 0 });
    expect(iron.at).toBeGreaterThan(0);
    const after = runRoadAction(before, 'question:hf-orrin:material:iron');
    expect(written(before, after)).toContain(iron.text);
    expect(after.asked?.['hf-orrin']).toContain('material:iron');
    // Its lead comes with it, as from an ask: Sabine at Kestrel Gate.
    expect(after.leads?.map(l => l.who)).toContain('kg-sabine');
    expect(after.hoursToday - before.hoursToday).toBe(ASK_HOURS);
  });

  it('deflects a question that matched nothing, and it still takes the hour and the question', () => {
    const before = atHollowford();
    const after = runRoadAction(before, 'question:hf-orrin');
    expect(after.log.at(-1)?.text).toBe(deflectionOf('hf-orrin', 'Orrin'));
    expect(after.hoursToday - before.hoursToday).toBe(ASK_HOURS);
    expect(after.questioned).toEqual(['hf-orrin']);
  });

  it('deflects a topic the person doesn’t know, however it was sent', () => {
    expect(answerFor('hf-maren', 'material:iron')).toBeUndefined();
    const before = atHollowford();
    const after = runRoadAction(before, 'question:hf-maren:material:iron');
    expect(after.log.at(-1)?.text).toBe(deflectionOf('hf-maren', 'Maren'));
    expect(after.asked?.['hf-maren'] ?? []).not.toContain('material:iron');
  });

  it('allows one question per person per stay, and a new one after the caravan moves on', () => {
    const first = runRoadAction(atHollowford(), 'question:hf-orrin:material:iron');
    const second = runRoadAction(first, 'question:hf-orrin:role:smith');
    expect(second.log.at(-1)?.text).toMatch(/skipped/);
    expect(second.hoursToday).toBe(first.hoursToday);
    expect(second.asked?.['hf-orrin']).not.toContain('role:smith');
    // Someone else here can still be asked.
    const other = runRoadAction(first, 'question:hf-tobin');
    expect(other.questioned).toEqual(['hf-orrin', 'hf-tobin']);
    // Once the caravan leaves Hollowford, it's a new stay.
    let r = first;
    for (let i = 0; i < 10 && r.leg === first.leg; i++) r = endRoadDay(r);
    expect(r.leg).toBeGreaterThan(first.leg);
    expect(r.questioned ?? []).toEqual([]);
  });

  it('tells again what they’ve told already, and nothing more comes of it', () => {
    const before = { ...atHollowford({ 'hf-orrin': 50 }), asked: { 'hf-orrin': ['material:iron'] } };
    const after = runRoadAction(before, 'question:hf-orrin:material:iron');
    expect(written(before, after)).toContain(answerFor('hf-orrin', 'material:iron')!.text);
    expect(after.trust['hf-orrin']).toBe(before.trust['hf-orrin']);
    expect(after.asked?.['hf-orrin']).toEqual(['material:iron']);
    expect(after.leads ?? []).toEqual([]);
  });

  it('keeps who was asked this stay through a save', () => {
    const road = runRoadAction(atHollowford(), 'question:hf-orrin');
    const app = { stage: 'road', road, sim: createRegion1({}, undefined, { id: 'w-free-q', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] }), queue: [] } as unknown as AppState;
    const back = deserialize(serialize(app));
    expect(back?.road?.questioned).toEqual(['hf-orrin']);
  });
});
