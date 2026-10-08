/**
 * Acceptance tests for #1259 — stats in the AI harness: the STATS line, `--stats` spreads and
 * presets, seeded random spreads for the random baseline, stats in the snapshots and the
 * report, and the 3–18 invariant. One test per Given/When/Then.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1 } from '../artificer/region1';
import { FLAT_WORLD } from '../artificer/world';
import { validStats, CREATION_MAX, DEFAULT_STATS, STAT_PEAK, type Stats } from '../artificer/stats';
import { observe } from './observe';
import { parseStatSpread, randomSpread, STAT_PRESETS, spreadText } from './spreads';
import { playRun } from './runner';
import { randomPlayer } from './players/random';
import { statSummaryOf, type Transcript } from './report';
import { invariantViolations } from './invariants';

/** A short year, so fifty runs stay quick. */
const QUICK = { calendar: { winterDay: 6, thawDay: 12 } };

describe('Stats in the AI harness (#1259)', () => {
  // 1. The STATS line shows exact values.
  it('shows the stats in the observation', () => {
    const s = createRegion1({ world: FLAT_WORLD }, undefined, { stats: { ...DEFAULT_STATS, str: 13 } });
    expect(observe(s)).toContain('STATS: STR 13 · CON 10 · AGI 10 · INT 10 · WIL 10 · CHA 10');
  });

  // 2. --stats past the creation max is an error that names the max; presets and partial spreads work.
  it('rejects a spread past the creation max, and reads presets and partial spreads', () => {
    const bad = parseStatSpread('str=16');
    expect('error' in bad && bad.error).toContain(`creation max of ${CREATION_MAX}`);
    expect(parseStatSpread('str=13,int=13')).toEqual({ stats: { ...DEFAULT_STATS, str: 13, int: 13 } });
    expect(parseStatSpread('strong')).toEqual({ stats: STAT_PRESETS.strong });
    for (const p of Object.values(STAT_PRESETS)) expect(validStats(p)).toBe(true);
    // Over the point budget, an unknown stat, or nonsense: errors too.
    expect('error' in parseStatSpread('str=15,con=15')).toBe(true);
    expect('error' in parseStatSpread('luck=12')).toBe(true);
    expect('error' in parseStatSpread('str=high')).toBe(true);
    // Not a preset just because it's on Object's prototype; presets ignore case; a stat given twice is an error.
    expect('error' in parseStatSpread('constructor')).toBe(true);
    expect(parseStatSpread('Strong')).toEqual({ stats: STAT_PRESETS.strong });
    expect('error' in parseStatSpread('str=13,str=11')).toBe(true);
  });

  // 3. A seeded random spread: always valid, varied across runs, and the same for the same seed.
  it('gives the random baseline varied, valid, repeatable spreads', () => {
    const spreads = Array.from({ length: 20 }, (_, n) => randomSpread(1 + n));
    for (const s of spreads) expect(validStats(s)).toBe(true);
    expect(new Set(spreads.map(spreadText)).size).toBeGreaterThanOrEqual(2);
    expect(Array.from({ length: 20 }, (_, n) => randomSpread(1 + n))).toEqual(spreads);
  });

  // 4. Snapshots carry the stats, and the report shows them per run.
  it('records stats in the snapshots and the report', async () => {
    const spread: Stats = { ...DEFAULT_STATS, str: 13, con: 13 };
    const r = await playRun(randomPlayer({ seed: 3 }), { ...QUICK, stats: spread, characterId: 'ai-stats-test' });
    expect(r.spread).toEqual(spread);
    expect(r.start.stats).toBeDefined();
    for (const t of r.turns) expect(Object.keys(t.progress.stats ?? {})).toHaveLength(6);
    const summary = statSummaryOf([r as unknown as Transcript]);
    expect(summary?.perRun).toHaveLength(1);
    expect(summary?.perRun[0].spread).toBe(spreadText(spread));
    // A run that rode on ends with the road's stats (the road builds CHA by talking).
    const onRoad = { ...r, road: { start: {}, turns: [{ progress: { stats: { ...spread, cha: 11 } } }], record: { kind: 'arrived' } } } as unknown as Transcript;
    expect(statSummaryOf([onRoad])?.perRun[0].end).toContain('CHA 11');
  }, 60_000);

  // 5. Fifty random runs: no stat leaves 3–18, nor any other invariant.
  it('keeps every invariant over 50 random runs', async () => {
    for (let n = 1; n <= 50; n++) {
      const r = await playRun(randomPlayer({ seed: n }), { ...QUICK, stats: randomSpread(n), characterId: `ai-inv-${n}` });
      for (const t of r.turns) expect(t.violations ?? []).toEqual([]);
      expect(invariantViolations(r.final)).toEqual([]);
    }
    // The invariant itself catches a stat out of range.
    const s = createRegion1({ world: FLAT_WORLD });
    const broken = { ...s, character: { ...s.character, stats: { ...s.character.stats, str: STAT_PEAK + 1 } } };
    expect(invariantViolations(broken).some(v => v.includes('str'))).toBe(true);
  }, 60_000);
});
