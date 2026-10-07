/**
 * Acceptance tests for #1398 — Scout 1: the First aid skill, and the training a scout brings to
 * the Reach. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1 } from './region1';
import { legacyOf } from './legacy';
import { SKILL_IDS, SKILLS, skillLevel, LEVEL_HOURS } from './skills';
import { SCOUT_TRAINING, trainingOf } from './scout';
import { newGame, newRun, serialize, deserialize } from '../artificer-app/controller';
import { observe } from '../artificer-ai/observe';

describe('Scout training (#1398)', () => {
  // 1. A new scout with no legacy: First aid at true level 2 (Apprentice), Fieldcraft and Scouting at 1 (Novice).
  it('starts a scout trained in first aid, camp chores and map and compass', () => {
    const s = createRegion1({}, undefined, { id: 'w-scout', background: 'scout' });
    expect(skillLevel(s.skills, 'firstaid')).toBe(2);
    expect(skillLevel(s.skills, 'fieldcraft')).toBe(1);
    expect(skillLevel(s.skills, 'scouting')).toBe(1);
    expect(s.character.background).toBe('scout');
    expect(SCOUT_TRAINING.firstaid).toBe(LEVEL_HOURS[2]);
    // Without the background (tests, the flat world, old saves) nothing changes.
    const plain = createRegion1({}, undefined, { id: 'w-plain' });
    expect(plain.skills).toEqual({});
    expect(plain.character.background).toBeUndefined();
    expect(trainingOf(undefined)).toEqual({});
    // Every new Warden in the game, and every AI player, is a scout — and still learns to plan (#1350).
    const game = newGame().sim;
    expect(game.character.background).toBe('scout');
    expect(skillLevel(game.skills, 'firstaid')).toBe(2);
    expect(game.canPlan).toBe(false);
    expect(observe(game)).toMatch(/BACKGROUND: a young scout/);
    expect(observe(game)).toMatch(/SKILLS \(self-assessed.*firstaid/);
  });

  // 2. A legacy with more First aid than the training: the larger is kept. The background carries.
  it('keeps the larger of what a past run taught and the training', () => {
    const veteran = createRegion1({}, undefined, { id: 'w-vet', background: 'scout' });
    const legacy = legacyOf({ ...veteran, skills: { ...veteran.skills, firstaid: 70, fieldcraft: 2 } });
    expect(legacy.background).toBe('scout');
    const next = createRegion1({}, legacy, { id: 'w-vet' });
    expect(next.skills.firstaid).toBe(70);
    expect(next.skills.fieldcraft).toBe(SCOUT_TRAINING.fieldcraft);
    expect(next.character.background).toBe('scout');
    // Carrying on in the app, and through a save.
    const carried = newRun(veteran).sim;
    expect(carried.character.background).toBe('scout');
    expect(deserialize(serialize(newGame()))?.sim.character.background).toBe('scout');
  });

  // 3. First aid is a skill like the others: listed, named, levelled by practice.
  it('adds First aid to the skills', () => {
    expect(SKILL_IDS).toContain('firstaid');
    expect(SKILLS.firstaid.name).toBe('First aid');
    expect(skillLevel({ firstaid: LEVEL_HOURS[3] }, 'firstaid')).toBe(3);
  });
});
