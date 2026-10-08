/**
 * Acceptance tests for #943 — condition DSL + DialogRunner traversal.
 */

import { describe, it, expect, vi } from 'vitest';
import { evalCondition, validateDialogTree, type Condition, type DialogTree, type WorldContext } from './dialogTree';
import { DialogRunner } from './DialogRunner';
import elderVaskJson from '../../public/data/dialog/elder_vask.json';

function ctx(overrides: Partial<WorldContext> = {}): WorldContext {
  return {
    flags: new Set(),
    inventory: new Map(),
    worldEvents: new Set(),
    timeOfDay: 'day',
    location: 'mistheim',
    visitCounts: new Map(),
    ...overrides,
  };
}

describe('evalCondition (#943 acceptance)', () => {
  it('given a flag condition, when the flag is present, then it evaluates true; when absent, false', () => {
    const cond: Condition = { flag: 'quest:corruption_started' };
    expect(evalCondition(cond, ctx({ flags: new Set(['quest:corruption_started']) }))).toBe(true);
    expect(evalCondition(cond, ctx())).toBe(false);
  });

  it('given an item condition with gte, when inventory quantity meets/misses it, then it evaluates accordingly', () => {
    const cond: Condition = { item: 'iron_ore', gte: 3 };
    expect(evalCondition(cond, ctx({ inventory: new Map([['iron_ore', 3]]) }))).toBe(true);
    expect(evalCondition(cond, ctx({ inventory: new Map([['iron_ore', 2]]) }))).toBe(false);
    expect(evalCondition(cond, ctx())).toBe(false);
  });

  it('given an item condition with lt, when inventory quantity is under/over it, then it evaluates accordingly', () => {
    const cond: Condition = { item: 'iron_ore', lt: 3 };
    expect(evalCondition(cond, ctx({ inventory: new Map([['iron_ore', 2]]) }))).toBe(true);
    expect(evalCondition(cond, ctx({ inventory: new Map([['iron_ore', 3]]) }))).toBe(false);
  });

  it('given a worldEvent condition, when the event is active, then it evaluates true', () => {
    const cond: Condition = { worldEvent: 'siege_of_ironhold:active' };
    expect(evalCondition(cond, ctx({ worldEvents: new Set(['siege_of_ironhold:active']) }))).toBe(true);
    expect(evalCondition(cond, ctx())).toBe(false);
  });

  it('given a timeOfDay condition, when it matches the context, then it evaluates true', () => {
    const cond: Condition = { timeOfDay: 'dusk' };
    expect(evalCondition(cond, ctx({ timeOfDay: 'dusk' }))).toBe(true);
    expect(evalCondition(cond, ctx({ timeOfDay: 'dawn' }))).toBe(false);
  });

  it('given a location condition, when it matches the context, then it evaluates true', () => {
    const cond: Condition = { location: 'ironhold' };
    expect(evalCondition(cond, ctx({ location: 'ironhold' }))).toBe(true);
    expect(evalCondition(cond, ctx({ location: 'mistheim' }))).toBe(false);
  });

  it('given a visitCount condition, when the count meets/misses the threshold, then it evaluates accordingly', () => {
    const cond: Condition = { visitCount: 'elder_vask', gte: 2 };
    expect(evalCondition(cond, ctx({ visitCounts: new Map([['elder_vask', 2]]) }))).toBe(true);
    expect(evalCondition(cond, ctx({ visitCounts: new Map([['elder_vask', 1]]) }))).toBe(false);
  });

  it('given an "all" composition, when every sub-condition is true, then it evaluates true; else false', () => {
    const cond: Condition = { all: [{ flag: 'a' }, { flag: 'b' }] };
    expect(evalCondition(cond, ctx({ flags: new Set(['a', 'b']) }))).toBe(true);
    expect(evalCondition(cond, ctx({ flags: new Set(['a']) }))).toBe(false);
  });

  it('given an "any" composition, when at least one sub-condition is true, then it evaluates true; else false', () => {
    const cond: Condition = { any: [{ timeOfDay: 'dawn' }, { timeOfDay: 'dusk' }] };
    expect(evalCondition(cond, ctx({ timeOfDay: 'dusk' }))).toBe(true);
    expect(evalCondition(cond, ctx({ timeOfDay: 'day' }))).toBe(false);
  });

  it('given a "not" composition, when the inner condition is true, then it evaluates false; and vice versa', () => {
    const cond: Condition = { not: { flag: 'npc:elder_vask:warned' } };
    expect(evalCondition(cond, ctx({ flags: new Set(['npc:elder_vask:warned']) }))).toBe(false);
    expect(evalCondition(cond, ctx())).toBe(true);
  });
});

// The sample dialog JSON shipped for #943 (public/data/dialog/elder_vask.json)
// doubles as the runner's test fixture, so the file under test is the same
// one players actually load.
const ELDER_VASK = elderVaskJson as unknown as DialogTree;

describe('elder_vask.json sample dialog tree (#943 acceptance)', () => {
  it('given the sample dialog tree JSON, when validated, then it has no errors', () => {
    expect(validateDialogTree(ELDER_VASK)).toEqual([]);
  });
});

describe('DialogRunner (#943 acceptance)', () => {
  it('given a choice with no condition, when visibleChoices is read, then it is always included', () => {
    const runner = new DialogRunner(ELDER_VASK, ctx());
    expect(runner.visibleChoices.map(c => c.label)).toContain('I need supplies');
  });

  it('given a tree with a gated choice, when the flag is unset, then the gated choice is hidden from visibleChoices', () => {
    const runner = new DialogRunner(ELDER_VASK, ctx());
    expect(runner.visibleChoices.map(c => c.label)).toEqual(['I need supplies', 'Nothing, just passing through']);
  });

  it('given a tree with a gated choice, when the flag is set, then the gated choice is shown', () => {
    const runner = new DialogRunner(ELDER_VASK, ctx({ flags: new Set(['quest:corruption_started']) }));
    expect(runner.visibleChoices.map(c => c.label)).toEqual([
      'I need supplies',
      'Tell me about the corruption',
      'Nothing, just passing through',
    ]);
  });

  it('given a choice selection, when choose() is called, then currentNode walks to that choice\'s next node', () => {
    const runner = new DialogRunner(ELDER_VASK, ctx());
    runner.choose(0);
    expect(runner.currentNode?.text).toBe('The merchant is two doors down, warden.');
  });

  it('given a node with onEnter effects, when it is entered via choose(), then the matching listener fires', () => {
    const runner = new DialogRunner(ELDER_VASK, ctx({ flags: new Set(['quest:corruption_started']) }));
    const onSetFlag = vi.fn();
    runner.on('setFlag', onSetFlag);
    runner.choose(1);
    expect(onSetFlag).toHaveBeenCalledWith('npc:elder_vask:heard_corruption_lore');
  });

  it('given a choice leading to "END", when chosen, then currentNode becomes null', () => {
    const runner = new DialogRunner(ELDER_VASK, ctx({ flags: new Set(['quest:corruption_started']) }));
    runner.choose(1);
    runner.choose(0);
    expect(runner.currentNode).toBeNull();
  });

  it('given a no-choice node with a "next" field, when advance() is called, then it auto-walks to "next"', () => {
    const runner = new DialogRunner(ELDER_VASK, ctx());
    runner.choose(1); // -> farewell (gated choice hidden without the flag), which has no choices and next: 'END'
    expect(runner.currentNode?.text).toBe('Safe travels, warden.');
    runner.advance();
    expect(runner.currentNode).toBeNull();
  });
});
