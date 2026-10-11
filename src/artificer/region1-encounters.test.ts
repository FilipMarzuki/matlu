/**
 * Acceptance tests for #1343 — the encounters engine: a seeded trigger, the
 * paused day, options and their requirements, outcomes, and death.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, chooseOption, type Region1State, type QueueItem } from './region1';
import { FULL_WORLD, FLAT_WORLD, type WorldConfig } from './world';
import { createExploration, scout } from './exploration';
import { encounterById, optionsFor, chanceOf, ENCOUNTERS } from './encounters';

const ON: WorldConfig = { ...FULL_WORLD, encounters: true };
const PLAN: QueueItem[] = ['wood@2', 'water', 'gather'];

/** A Warden with the near and far rings scouted, in a world with encounters on. */
function warden(id: string, world = ON): Region1State {
  const s = createRegion1({ world }, undefined, { id });
  return { ...s, explore: scout(scout(createExploration(), 1), 2), stores: { ...s.stores, rawFood: 6, water: 6 } };
}
/** The first character id whose plan meets an encounter on its first trip. */
function meeting(): Region1State {
  for (let i = 0; i < 2000; i++) {
    const s = warden(`w-enc-${i}`);
    if (runDay(s, PLAN).state.pending) return s;
  }
  throw new Error('no seed met an encounter');
}
/** A state paused on a given encounter. */
const pausedOn = (s: Region1State, id: string): Region1State => ({ ...s, pending: { id, day: s.day, hour: 10, ring: 2, action: 'wood' }, encounterDay: s.day });
const lastLine = (s: Region1State): string => s.log.at(-1)?.text ?? '';

describe('Encounters: the engine (#1343)', () => {
  // 1. A roll that triggers during wood@2: runDay stops there, the rest of the queue waits, no night.
  it('pauses the day at an encounter', () => {
    const s = meeting();
    const r = runDay(s, PLAN);
    expect(r.state.pending?.action).toBe('wood');
    expect(r.remaining).toEqual(['water', 'gather']);
    expect(r.state.day).toBe(s.day);
    expect(encounterById(r.state.pending!.id)).toBeDefined();
  });

  // 2. While it waits, nothing runs.
  it('runs nothing until a choice is made', () => {
    const paused = runDay(meeting(), PLAN).state;
    expect(runAction(paused, 'water')).toBe(paused);
    const r = runDay(paused, ['water']);
    expect(r.state).toBe(paused);
    expect(r.remaining).toEqual(['water']);
  });

  // 3. A valid choice: cost and outcome applied, the encounter cleared, the journal records it — and the day goes on.
  it('applies a choice and frees the day', () => {
    const s = pausedOn(warden('w-choose'), 'crumbling-ledge');
    const after = chooseOption(s, 'go-around');
    expect(after.pending).toBeNull();
    expect(after.hoursToday).toBe(s.hoursToday + 2);
    expect(lastLine(after)).toMatch(/^Go the long way round to it: /);
    const rest = runDay(after, ['water']);
    expect(rest.state.day).toBe(s.day + 1);
  });

  // 4. An option whose requirement isn't met is listed with the reason, and choosing it is refused.
  it('refuses an option you can’t take', () => {
    const s = pausedOn(warden('w-gate'), 'fox-at-the-treeline');
    const stalk = optionsFor(s, encounterById('fox-at-the-treeline')!).find(o => o.option.id === 'stalk')!;
    expect(stalk.unmet).toBe('needs hunting 3');
    const after = chooseOption(s, 'stalk');
    expect(after.pending).toEqual(s.pending);
    expect(lastLine(after)).toMatch(/skipped — needs hunting 3/);
    // With Hunting 3 (60 practice hours) it opens up.
    expect(optionsFor({ ...s, skills: { hunting: 60 } }, encounterById('fox-at-the-treeline')!).find(o => o.option.id === 'stalk')!.unmet).toBeNull();
  });

  // 5. Same seed and plan: the same encounter at the same hour, and the same choice turns out the same.
  it('is seeded and fair', () => {
    const s = meeting();
    const a = runDay(s, PLAN).state, b = runDay(s, PLAN).state;
    expect(a.pending).toEqual(b.pending);
    const opt = encounterById(a.pending!.id)!.options.find(o => o.odds < 1) ?? encounterById(a.pending!.id)!.options[0];
    expect(chooseOption(a, opt.id).log.at(-1)).toEqual(chooseOption(b, opt.id).log.at(-1));
  });

  // 6. An outcome that takes Condition to 0: the run ends `died`, and the journal names the cause.
  it('can kill, and names what killed you', () => {
    let dead: Region1State | null = null;
    for (let i = 0; i < 500 && !dead; i++) {
      const s = pausedOn({ ...warden(`w-fall-${i}`), vitals: { ...warden('x').vitals, condition: 30 } }, 'crumbling-ledge');
      const after = chooseOption(s, 'climb-down');
      if (after.outcome) dead = after;
    }
    expect(dead?.outcome?.kind).toBe('died');
    expect(lastLine(dead!)).toBe('Killed by a fall from a crumbling ledge.');
  });

  // 7. No encounters in the flat world, with encounters off, or on a day that already had one.
  it('stays quiet when it should', () => {
    for (let i = 0; i < 300; i++) {
      expect(runDay(warden(`w-quiet-${i}`, FLAT_WORLD), PLAN).state.pending ?? null).toBeNull();
      expect(runDay(warden(`w-quiet-${i}`, FULL_WORLD), PLAN).state.pending ?? null).toBeNull();
    }
    const s = meeting();
    expect(runDay({ ...s, encounterDay: s.day }, PLAN).state.pending ?? null).toBeNull();
  });

  it('shows odds in words, and moves them with stats', () => {
    const s = warden('w-odds');
    const chase = encounterById('fox-at-the-treeline')!.options.find(o => o.id === 'chase')!;
    const quick = { ...s, character: { ...s.character, stats: { ...s.character.stats, agi: 16 } } };
    expect(chanceOf(quick, chase)).toBeGreaterThan(chanceOf(s, chase));
    expect(optionsFor(s, ENCOUNTERS[0]).find(o => o.option.id === 'watch')!.odds).toBe('safe');
  });
});
