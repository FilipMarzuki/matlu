/**
 * Acceptance tests for #1495 (epic #1493, docs/focus-and-dialogue-design.md §2): talking to someone
 * on the road is a short conversation — Chat, and Ask about what you're focused on. The person
 * knows (an answer), won't say yet (trust), or doesn't know.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, ROUTE, type RoadState } from './road';
import { ASK_HOURS, answerFor } from './asks';
import { topicsOpen } from './topics';
import type { Focus } from './focus';
import { observeRoad } from '../artificer-ai/observe';
import { serialize, deserialize } from '../artificer-app/controller';

/** A Warden on the caravan road, at Hollowford (the first village), focused on `focus`. */
function atHollowford(focus: Focus | null, trust: Record<string, number> = {}): RoadState {
  const s = createRegion1({}, undefined, { id: 'w-asks', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
  const from: Region1State = { ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 10, water: 10, rations: 6 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
  const village = ROUTE.findIndex(l => l.kind === 'village');
  let r = createRoad(from);
  for (let i = 0; i < 10 && r.leg < village; i++) r = endRoadDay(r);
  return { ...r, focus, trust: { ...r.trust, ...trust } };
}

const IRON: Focus = { kind: 'material', id: 'iron' };
const hours = (before: RoadState, after: RoadState) => after.hoursToday - before.hoursToday;

describe('Village conversations: Ask about your focus (#1495)', () => {
  // 1. Orrin knows about iron, and trusts you enough: he tells you, and it costs an hour.
  it('tells you what they know once they trust you', () => {
    const at = answerFor('hf-orrin', 'material:iron');
    expect(at).toBeDefined();
    const before = atHollowford(IRON, { 'hf-orrin': at!.at + 5 });
    const after = runRoadAction(before, 'ask:hf-orrin');
    expect(after.log.at(-1)?.text).toContain(at!.text);
    expect(hours(before, after)).toBe(ASK_HOURS);
    expect(after.asked?.['hf-orrin']).toContain('material:iron');
    // What he names, you've come across: he points you to Sabine at Kestrel Gate.
    expect(topicsOpen(after)).toEqual(expect.arrayContaining(['person:kg-sabine', 'place:kestrel-gate']));
  });

  // 2. The same, from a stranger: he knows, and won't say yet.
  it('says not yet when they know but don’t trust you enough', () => {
    const at = answerFor('hf-orrin', 'material:iron')!;
    const before = atHollowford(IRON, { 'hf-orrin': Math.max(0, at.at - 15) });
    const after = runRoadAction(before, 'ask:hf-orrin');
    expect(after.log.at(-1)?.text).toMatch(/not yet|know you better|stranger/i);
    expect(after.log.at(-1)?.text).not.toContain(at.text);
    expect(after.asked?.['hf-orrin'] ?? []).not.toContain('material:iron');
    expect(hours(before, after)).toBe(ASK_HOURS);
  });

  // 3. Someone with nothing on it says so; that's still worth knowing.
  it('says so when they don’t know', () => {
    expect(answerFor('hf-maren', 'material:iron')).toBeUndefined();
    const before = atHollowford(IRON, { 'hf-maren': 90 });
    const after = runRoadAction(before, 'ask:hf-maren');
    expect(after.log.at(-1)?.text).toMatch(/Maren/);
    expect(after.log.at(-1)?.text).toMatch(/iron/);
    expect(hours(before, after)).toBe(ASK_HOURS);
  });

  // 4. Nothing to ask about with no focus, or a goal: the ask doesn't happen and costs nothing.
  it('has nothing to ask with no focus, or a goal', () => {
    for (const focus of [null, { kind: 'goal', id: 'larder' } as Focus]) {
      const before = atHollowford(focus, { 'hf-orrin': 90 });
      const after = runRoadAction(before, 'ask:hf-orrin');
      expect([focus, hours(before, after)]).toEqual([focus, 0]);
      expect(after.log.at(-1)?.text).toMatch(/nothing to ask|set a focus/i);
    }
  });

  // A teacher always knows their own skill.
  it('lets a teacher speak to their own skill', () => {
    const before = atHollowford({ kind: 'skill', id: 'foraging' }, { 'hf-isa': 0 });
    const after = runRoadAction(before, 'ask:hf-isa');
    expect(after.log.at(-1)?.text).toMatch(/Isa/);
    expect(after.log.at(-1)?.text).toMatch(/teach/i);
    expect(after.asked?.['hf-isa']).toContain('skill:foraging');
  });

  // Asked and answered: asking again costs nothing and changes nothing.
  it('remembers an answer: asking again is free and changes nothing', () => {
    const at = answerFor('hf-orrin', 'material:iron')!;
    const once = runRoadAction(atHollowford(IRON, { 'hf-orrin': at.at + 5 }), 'ask:hf-orrin');
    const twice = runRoadAction(once, 'ask:hf-orrin');
    expect(hours(once, twice)).toBe(0);
    expect(twice.trust['hf-orrin']).toBe(once.trust['hf-orrin']);
    expect(twice.concepts).toEqual(once.concepts);
    expect(twice.log.at(-1)?.text).toMatch(/already/i);
  });

  // What they've told you keeps through a save; a road saved before asks loads without any.
  it('keeps what people have answered through a save', () => {
    const at = answerFor('hf-orrin', 'material:iron')!;
    const road = runRoadAction(atHollowford(IRON, { 'hf-orrin': at.at + 5 }), 'ask:hf-orrin');
    const app = { sim: createRegion1({}, undefined, { id: 'w-asks' }), queue: [], stage: 'road' as const, road };
    expect(deserialize(serialize(app))?.road?.asked).toEqual({ 'hf-orrin': ['material:iron'] });
    const { asked: _gone, ...before } = road;
    expect(deserialize(serialize({ ...app, road: before }))?.road?.asked).toBeUndefined();
  });

  // 5. The AI sees who it can ask, and what about.
  it('shows the AI who it can ask about its focus', () => {
    const text = observeRoad(atHollowford(IRON, { 'hf-orrin': 40 }));
    expect(text).toMatch(/ask:hf-orrin/);
    expect(text).toMatch(/Iron/);
  });
});
