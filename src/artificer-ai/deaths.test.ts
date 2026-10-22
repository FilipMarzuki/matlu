/**
 * Balance of the baselines (#1852): with today's default rules the scripted baseline survives to the
 * thaw on most seeds (it plays by needs: camp, water, wood, a roof, then food), and the dangers rank
 * as the owner wants them: thirst kills fastest, a winter without shelter or fire next, hunger last.
 * The full 20-seed table is `npx tsx scripts/ai-deaths.ts`; here a smaller batch keeps it quick.
 *
 * Measured on seeds 1–20 (thaw / median death day / deaths by cause):
 *
 * - scripted, before #1852, default rules: 0/20, day 13, thirst 20 (it never made camp, so it
 *   never built or fetched water). With camp-as-action off: 20/20. Every other recent switch off
 *   alone: still 0/20 (thermal-model off: day 10, thirst 10, starvation 8, collapse 2).
 * - scripted, after (plays by needs): 20/20 with default rules and with each recent switch off.
 * - random (legal), unchanged: 0/20, day 6, cold 12, injury 4, thirst 2, collapse 2.
 * - one need unmet, resting, seeds need-a…e: no food 13–15 nights (8–9 working), no water 4,
 *   a winter without shelter or fire 8–10 (4–7 working).
 */

import { describe, it, expect } from 'vitest';
import { ruleFeatures } from '../artificer/features';
import { createRegion1, runDay, type QueueItem, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { SUGGESTED_PACK } from '../artificer/kit';
import { deathRows, summarize } from './deaths';

describe('the scripted baseline with default rules (#1852)', () => {
  it('survives to the thaw on at least 70% of seeds', async () => {
    const rows = await deathRows('scripted', 8);
    const s = summarize(rows);
    // Measured: 20 of 20 seeds reach the thaw (the PR's table). Pinned with room to spare.
    expect(s.thaw / s.runs).toBeGreaterThanOrEqual(0.7);
    // And it never goes thirsty: water comes before anything else once camp is made.
    expect(rows.every(r => r.thirsty === 0)).toBe(true);
  }, 120_000);
});

type Lack = 'food' | 'water' | 'shelter';

/**
 * Nights a resting Warden lasts with one need unmet and the others kept topped up each morning:
 * no food (water, a roof and wood in hand), no water, or, from the first night of winter, no
 * shelter and no fire. Each Warden is its own string-keyed seed.
 */
function nightsWithout(lack: Lack, id: string): number {
  let s: Region1State = createRegion1({ world: { ...FULL_WORLD, encounters: false, features: ruleFeatures() } }, undefined, { id, pack: [...SUGGESTED_PACK] });
  s = runDay(s, ['camp']).state;
  if (lack === 'shelter') s = { ...s, day: s.config.calendar.winterDay };
  const start = s.day;
  const rest: QueueItem[] = ['rest', 'rest', 'rest'];
  while (!s.outcome) {
    s = {
      ...s,
      tier: (lack === 'shelter' ? 0 : Math.max(s.tier, 2)) as Region1State['tier'],
      stores: { ...s.stores, rawFood: lack === 'food' ? 0 : 5, rations: lack === 'food' ? 0 : 5, water: lack === 'water' ? 0 : 5, firewood: lack === 'shelter' ? 0 : 20 },
    };
    s = runDay(s, rest).state;
  }
  expect(s.outcome.kind).not.toBe('survived');
  return s.day - start + 1;
}

describe('which danger kills fastest (#1852)', () => {
  const ids = ['need-a', 'need-b', 'need-c'];
  it('hunger is the slowest: over 10 nights with water and shelter, while thirst and a winter in the open kill sooner', () => {
    for (const id of ids) {
      const hunger = nightsWithout('food', id), thirst = nightsWithout('water', id), cold = nightsWithout('shelter', id);
      // Measured (seeds a–e): hunger 13–15 nights, thirst 4, winter without shelter or fire 8–10.
      expect(hunger).toBeGreaterThanOrEqual(10);
      expect(thirst).toBeLessThanOrEqual(5);
      expect(cold).toBeLessThan(hunger);
      expect(thirst).toBeLessThan(cold);
    }
  });
});
