/**
 * Acceptance tests for #1153 — WorldFeed: sim ticks → storytelling-engine
 * years, seasons, harvest multiplier and an event feed.
 * Criteria 1–5, 9 and 10 of the issue live here; 6–8 are in
 * actions.test.ts / ActionQueue.test.ts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { WorldFeed } from './WorldFeed';
import { loadWorld } from '../../storytelling/seed.js';
import { DEFAULT_SPEC } from '../../storytelling/world-spec.js';
import { climateHarvestMultiplier } from '../../storytelling/climate.js';

const TPY = 365;
const fresh = (seed = 42) => {
  const world = loadWorld(DEFAULT_SPEC, seed);
  return { world, feed: new WorldFeed({ world, ticksPerYear: TPY }) };
};

describe('WorldFeed (#1153 acceptance)', () => {
  it('1. given ticksPerYear 365 on a fresh world at year Y, advance(364) keeps year Y and season is winter', () => {
    const { world, feed } = fresh();
    const y = world.year;
    feed.advance(364);
    expect(world.year).toBe(y);
    expect(feed.year).toBe(y);
    expect(feed.season).toBe('winter');
  });

  it('2. given the same feed, advance(1) more ticks the engine exactly once and season is spring', () => {
    const { world, feed } = fresh();
    const y = world.year;
    feed.advance(364);
    feed.advance(1);
    expect(world.year).toBe(y + 1);
    expect(feed.season).toBe('spring');
  });

  it('3. given a fresh feed, advance(365 * 3) in one call ticks the engine exactly 3 times', () => {
    const { world, feed } = fresh();
    const y = world.year;
    feed.advance(TPY * 3);
    expect(world.year).toBe(y + 3);
  });

  it('4. given a feed on a world with climateHarvestMultiplier m, feed.yieldMultiplier === m', () => {
    const { world, feed } = fresh();
    feed.advance(TPY * 5);
    expect(feed.yieldMultiplier).toBe(climateHarvestMultiplier(world));
    expect(typeof feed.yieldMultiplier).toBe('number');
  });

  it('5. given a feed that just crossed a year producing ≥1 event, drainEvents returns 1–5 non-empty strings, then []', () => {
    const { world, feed } = fresh();
    feed.advance(TPY);
    expect(world.events.length).toBeGreaterThanOrEqual(1);
    const first = feed.drainEvents();
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(first.length).toBeLessThanOrEqual(5);
    for (const line of first) expect(line.trim().length).toBeGreaterThan(0);
    expect(feed.drainEvents()).toEqual([]);
  });

  it('9. given two feeds from the same spec and seed advanced identically, their drained events are deeply equal', () => {
    const a = fresh(7);
    const b = fresh(7);
    for (const f of [a.feed, b.feed]) { f.advance(200); f.advance(TPY * 2); f.advance(100); }
    expect(a.feed.drainEvents()).toEqual(b.feed.drainEvents());
    expect(a.feed.season).toBe(b.feed.season);
  });

  it('10. src/crafting/WorldFeed.ts does not import phaser', () => {
    const src = readFileSync(join(__dirname, 'WorldFeed.ts'), 'utf8');
    expect(src).not.toMatch(/from\s+['"]phaser['"]/);
  });
});
