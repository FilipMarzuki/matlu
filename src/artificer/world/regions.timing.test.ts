/**
 * #1598 — what the regional level costs. Printed, not asserted (machines differ): the regional
 * pass runs inside every engine year, so this wraps it to time just that share of `runHistory`.
 */

import { it, vi, expect } from 'vitest';
import { seedOf } from '../rng';

let regionalMs = 0;
vi.mock('../../../storytelling/regions', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../storytelling/regions')>();
  return {
    ...real,
    runRegions: (...args: Parameters<typeof real.runRegions>) => {
      const t0 = performance.now();
      real.runRegions(...args);
      regionalMs += performance.now() - t0;
    },
  };
});

it('times the regional pass within runHistory', async () => {
  const { runHistory } = await import('./history');
  const { regionalFacts } = await import('./regional-facts');
  runHistory(seedOf('w-warmup')); // let the JIT warm up first
  const seeds = ['w-vega', 'w-astrid', 'w-test-3'].map(s => seedOf(s));
  regionalMs = 0;
  let total = 0, facts = 0, factCount = 0;
  for (const seed of seeds) {
    const t0 = performance.now();
    const h = runHistory(seed);
    total += performance.now() - t0;
    const t1 = performance.now();
    factCount += regionalFacts(h).length;
    facts += performance.now() - t1;
  }
  const n = seeds.length;
  console.log(`runHistory: ${(total / n).toFixed(0)} ms a seed, of which the regional pass ${(regionalMs / n).toFixed(1)} ms (${((100 * regionalMs) / total).toFixed(1)}%); regionalFacts: ${(facts / n).toFixed(2)} ms for ${Math.round(factCount / n)} facts`);
  expect(regionalMs).toBeGreaterThan(0);
});
