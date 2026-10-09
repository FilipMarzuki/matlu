/**
 * Tests for #1457 — one rank ladder, shared by name with the crafter's guild
 * ranks, that rewards depth of concept mastery as well as volume.
 */

import { describe, it, expect } from 'vitest';
import { artificerRank, conceptRanks, RANKS, type RankName } from './rank';
import { GUILD_RANKS } from '../crafting/planner';
import { aggregate, type Transcript } from '../artificer-ai/report';
import { CRAFT_WORLD } from './region1';

/** A single concept at the given rank — enough to drive {@link conceptRanks} and depth checks. */
const withConcepts = (ranks: readonly number[]) => ({
  concepts: Object.fromEntries(ranks.map((rank, i) => [`concept-${i}`, { rank, insight: 0 }])),
});

describe('artificerRank', () => {
  it('given concept ranks totalling 0, 3, 8 and 15 with no concept at its full rank, climbs Apprentice, Journeyman, Journeyman, Journeyman', () => {
    const noDepth = (total: number) => {
      // Spread the total over concepts that each stay below the full rank (3), so volume alone is being tested.
      const ranks: number[] = [];
      let left = total;
      while (left > 0) { const r = Math.min(2, left); ranks.push(r); left -= r; }
      return ranks;
    };
    expect(conceptRanks(withConcepts(noDepth(0)))).toBe(0);
    expect(artificerRank(withConcepts(noDepth(0)))).toBe('Apprentice');
    expect(artificerRank(withConcepts(noDepth(3)))).toBe('Journeyman');
    expect(artificerRank(withConcepts(noDepth(8)))).toBe('Journeyman');
    expect(artificerRank(withConcepts(noDepth(15)))).toBe('Journeyman');
  });

  it('given a total of 8 with one concept at its full rank, is Master; a total of 15 with two at full rank, is Artificer', () => {
    // One concept at its full rank (3), the rest short of it.
    expect(artificerRank(withConcepts([3, 2, 2, 1]))).toBe('Master');
    // Two concepts at their full rank, the rest short of it.
    expect(artificerRank(withConcepts([3, 3, 2, 2, 2, 1, 2]))).toBe('Artificer');
  });

  // #1469, 5. With the concept web loaded, a concept at its own full rank counts as full: sealing and leverage stop at 2.
  it('given the loaded definitions, counts a 2-rank concept at rank 2 as full', () => {
    const twos = { concepts: { sealing: { rank: 2, insight: 0 }, leverage: { rank: 2, insight: 0 }, tension: { rank: 2, insight: 0 }, weaving: { rank: 2, insight: 0 } } };
    expect(artificerRank(twos)).toBe('Journeyman'); // 8 ranks, none at 3
    expect(artificerRank(twos, CRAFT_WORLD.concepts)).toBe('Master'); // 8 ranks, sealing and leverage full
  });

  it('given RANKS and GUILD_RANKS, their names are the same four strings in order', () => {
    expect(RANKS.map(r => r.name)).toEqual(GUILD_RANKS.map(r => r.label));
    expect(RANKS.map(r => r.name)).toEqual(['Apprentice', 'Journeyman', 'Master', 'Artificer']);
  });
});

describe('AI report reading an older transcript', () => {
  it('given a transcript whose progress recorded rank: "Adept", builds without throwing and keeps the rank as recorded', () => {
    const legacyProgress = {
      day: 0, rank: 'Adept' as unknown as RankName, concepts: {}, conceptRanks: 0, insight: 0, recipesKnown: 0,
      skills: {}, skillLevels: 0, perceivedSkillLevels: 0, discoveries: 0, crafts: 0, failedCrafts: 0, tools: [],
      stores: { rawFood: 0, water: 0, firewood: 0, materials: 0, rations: 0, stone: 0, hides: 0 },
      exploration: 0, explorationByRing: { 1: 0, 2: 0, 3: 0 }, finds: 0,
      shelter: { site: null, tier: 0, warmth: 0 },
      vitals: { vigor: 0, vigorCap: 0, clarity: 0, clarityCap: 0, condition: 0 },
      pillars: { larder: 0, shelter: 0, fuel: 0, body: 0 },
      readiness: 0, winterReady: false, milestones: 0, focus: 'none', locked: null, overexertions: 0,
    };
    const transcript: Transcript = {
      player: 'legacy-model',
      start: legacyProgress,
      turns: [],
      record: { kind: 'survived', choice: 'stayed', day: 30, readyDay: 20 },
      usage: { input: 0, output: 0, cacheRead: 0 },
    };

    expect(() => aggregate([transcript])).not.toThrow();
    expect(transcript.start.rank).toBe('Adept');
  });
});
