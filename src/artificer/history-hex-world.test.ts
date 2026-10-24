/**
 * #1905 (review of PR #1970) — a hex-world run's told history in play.
 *
 * With `hex-world` on, the three road villages sit out on the hex map, not in the Reach, so the
 * run's history is told `roadAnchors: 'hexes'` (world/provinces.ts) and has no province for any of
 * them: telling their own history is #1906's. These pin that such a history is read as what it is,
 * wherever it comes from, and that one seed's two histories (switch on, switch off) never stand in
 * for each other:
 * - kept for play (as the page's worker hands it in), it gives the run its facts without throwing,
 *   and none of them tells of a road village (there's no province of theirs in it to tell of);
 * - kept histories are told apart by seed and setting, so a run never reads the other setting's;
 * - the server's teller (`tellHistoriesWith(runHistory)`, as artificer-play/api.ts and
 *   artificer-ai/runner.ts set it) tells a hex-world run's history the 'hexes' way, as the page does.
 *
 * Telling a history runs the engine's 150 years (a quarter to half a second, more on a busy CI
 * runner), so the two are told once in `beforeAll`, with room to spare.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { factsFor } from './facts';
import { ruleFeatures, type FeatureSwitches } from './features';
import { forgetHistories, historyFor, keepHistory, playFacts, tellHistoriesWith } from './history-in-play';
import type { Fact } from './knowledge';
import { seedOf } from './rng';
import { runRumours } from './run-rumours';
import { HISTORY_YEARS, runHistory } from './world/history';
import type { ReachHistory } from './world/history-format';

const WARDEN = 'w-vega';
const SEED = seedOf(WARDEN);
// A new game's switches: every reader of the history on (in play, retold, run rumours, old history
// bending), with hex-world off and on.
const REACH = ruleFeatures({ 'hex-world': false });
const HEXES = ruleFeatures({ 'hex-world': true });
const run = (features: FeatureSwitches) => ({ features, character: { id: WARDEN } });

/** The facts a told history adds: the villages' own (`history:`), their countries' and the caravan's (`region:`), and the rumours made of it. */
const fromHistory = (facts: readonly Fact[]) => facts.filter(f => /^(history|region):/.test(f.id) || /^rumour:run-(news|lore)-/.test(f.id));

let reach: ReachHistory;
let hexes: ReachHistory;
beforeAll(() => {
  reach = runHistory(SEED);
  hexes = runHistory(SEED, HISTORY_YEARS, { roadAnchors: 'hexes' });
}, 60_000);
afterEach(() => { forgetHistories(); tellHistoriesWith(null); });

describe("a hex-world run's history in play (#1905)", () => {
  it("a 'hexes' history kept for play gives a hex-world run its facts, without throwing: none of them of a road village", () => {
    keepHistory(hexes);
    // The review's reproduction: only the two switches saved.
    const two = { 'history-in-play': true, 'hex-world': true };
    expect(() => playFacts(run(two))).not.toThrow();
    expect(fromHistory(playFacts(run(two)))).toEqual([]);
    // Every reader of the history on, as a new game has them: today's facts first, nothing from the history.
    const facts = playFacts(run(HEXES));
    expect(facts.slice(0, factsFor(HEXES).length)).toEqual(factsFor(HEXES));
    expect(fromHistory(facts)).toEqual([]);
    // The run's rumours (run-rumours.ts `historyRumours`): none of news or lore, with no village in it to have any.
    expect(runRumours(hexes, HEXES).filter(r => r.kind === 'news' || r.kind === 'lore')).toEqual([]);
  });

  it('kept histories are told apart by setting as well as seed: a run reads only the history told its own way', () => {
    // Only the switch-off history kept: a hex-world run has none to hand, so it plays without one,
    // as a page whose worker hasn't finished does.
    keepHistory(reach);
    expect(historyFor(SEED, 'hexes')).toBeNull();
    expect(playFacts(run(HEXES))).toBe(factsFor(HEXES));
    // Only the hex-world history kept: the same for a switch-off run.
    forgetHistories();
    keepHistory(hexes);
    expect(historyFor(SEED)).toBeNull();
    expect(playFacts(run(REACH))).toBe(factsFor(REACH));
    // Both kept, side by side: each run reads its own.
    keepHistory(reach);
    expect(historyFor(SEED)).toBe(reach);
    expect(historyFor(SEED, 'reach')).toBe(reach);
    expect(historyFor(SEED, 'hexes')).toBe(hexes);
    expect(fromHistory(playFacts(run(REACH))).map(f => f.id)).toContain('history:hollowford:holder');
    expect(fromHistory(playFacts(run(HEXES)))).toEqual([]);
  });

  it("the server's teller tells a hex-world run's history the 'hexes' way, as the page's worker does", () => {
    tellHistoriesWith(runHistory);
    expect(historyFor(SEED, 'hexes')).toEqual(hexes);
    expect(historyFor(SEED)).toEqual(reach);
    // Through play, as a road question over the API asks: told the run's way, and kept.
    forgetHistories();
    expect(fromHistory(playFacts(run(HEXES)))).toEqual([]);
    expect(fromHistory(playFacts(run(REACH))).map(f => f.id)).toContain('history:hollowford:holder');
    tellHistoriesWith(null);
    expect(historyFor(SEED, 'hexes')).toEqual(hexes);
    expect(historyFor(SEED, 'reach')).toEqual(reach);
  }, 60_000);
});
