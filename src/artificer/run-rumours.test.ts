/**
 * #1662 — rumours and lies vary from run to run, made from that run's history and people.
 *
 * Two Wardens, `w-rum-a` and `w-rum-b`: two seeds, two told histories. Telling a history runs the
 * engine's 150 years, so each is told once in `beforeAll` and kept, as the page's worker hands
 * its history in (history-in-play.ts `keepHistory`).
 *
 * The issue's Given/When/Then, one test each:
 * 1. Different seeds → the rumour sets differ → "1. different seeds…".
 * 2. The same seed twice, or a save reloaded from JSON → the same rumours → "2. the same seed…".
 * 3. A generated rumour → the game knows its truth, and catching it works like a hand-written one
 *    (and so does a lie picked from the pool) → "3. a generated rumour…".
 * 4. Any seed → the number of liars stays within the agreed range (LIARS: 3–4 of the road's 17)
 *    → "4. any seed…".
 * 5. The switch off → play equals today's → "5. with the switch off…".
 * The switch's place in the registry is pinned in features.test.ts and artificer-play/features.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { claimEntries, driftOf, liesFor, lieById, motiveProblem, pathProblem, rumourHopOf, LIARS, PROPOSITIONS } from './claims';
import { caughtOut } from './caught-lies';
import { factsFor } from './facts';
import { featureOn, ruleFeatures } from './features';
import { forgetHistories, historyFacts, keepHistory, playFacts } from './history-in-play';
import { claimsHeard, journalOf, type HeardClaim } from './journal';
import { resolve } from './facts';
import { seedOf } from './rng';
import { RUN_RUMOURS, roadRumours, runRumours, type RunRumour } from './run-rumours';
import { runHistory } from './world/history';
import type { ReachHistory } from './world/history-format';
import type { Fact } from './knowledge';

const A = 'w-rum-a';
const B = 'w-rum-b';
const ON = ruleFeatures();
const OFF = { ...ON, [RUN_RUMOURS]: false };

let ha: ReachHistory;
let hb: ReachHistory;
beforeAll(() => {
  ha = runHistory(seedOf(A));
  hb = runHistory(seedOf(B));
  keepHistory(ha);
  keepHistory(hb);
}, 60_000);
afterAll(() => forgetHistories());

/** What a rumour says, for comparing sets: its words, its truth and who carried it. */
const said = (rs: readonly RunRumour[]) => rs.map(r => `${r.id}|${r.core}|${r.truth.n}|${r.truth.where}|${r.truth.who ?? ''}|${r.path.join('>')}`);
const run = (id: string, features = ON) => ({ features, character: { id } });
const generatedFacts = (facts: readonly Fact[]) => facts.filter(f => f.id.startsWith('rumour:run-'));

describe('#1662 rumours and lies made from the run', () => {
  it('1. different seeds: the rumour sets differ', () => {
    const a = runRumours(ha, ON);
    const b = runRumours(hb, ON);
    expect(a.length).toBeGreaterThanOrEqual(3);
    expect(b.length).toBeGreaterThanOrEqual(3);
    expect(said(a)).not.toEqual(said(b));
    // Not a fluke of two seeds: across twenty, the road's rumours (ties and organisations) come out many ways.
    const sets = new Set(Array.from({ length: 20 }, (_, i) => said(roadRumours(seedOf(`w-rum-${i}`), ON)).join('\n')));
    expect(sets.size).toBeGreaterThanOrEqual(15);
    // And what reaches play differs too: the facts people hold.
    expect(generatedFacts(playFacts(run(A))).map(f => f.text)).not.toEqual(generatedFacts(playFacts(run(B))).map(f => f.text));
  });

  it('2. the same seed twice, or a save reloaded from JSON: the same rumours', () => {
    const once = runRumours(ha, ON);
    // The same seed's history told again from scratch, and the history read back as the page keeps it.
    expect(said(runRumours(runHistory(seedOf(A)), ON))).toEqual(said(once));
    expect(said(runRumours(JSON.parse(JSON.stringify(ha)) as ReachHistory, ON))).toEqual(said(once));
    // A save reloaded: its features and Warden read back from JSON, the history from storage.
    const texts = generatedFacts(playFacts(run(A))).map(f => `${f.id}|${f.scope.id}|${f.text}`);
    forgetHistories();
    keepHistory(JSON.parse(JSON.stringify(ha)) as ReachHistory);
    keepHistory(hb);
    const back = JSON.parse(JSON.stringify(run(A))) as ReturnType<typeof run>;
    expect(generatedFacts(playFacts(back)).map(f => `${f.id}|${f.scope.id}|${f.text}`)).toEqual(texts);
    // The run's liars, too: a pure function of the seed.
    expect(liesFor(back.features, seedOf(back.character.id))).toEqual(liesFor(ON, seedOf(A)));
  });

  it('3. a generated rumour: the game knows its truth, and catching it works like a hand-written one', () => {
    const facts = playFacts(run(A));
    const all = [...runRumours(ha, ON), ...runRumours(hb, ON)];
    for (const r of all) {
      // Each has a teller (who saw it) and a source (what in the run it was made from), and a path the road can carry.
      expect(r.teller, r.id).toBe(r.path[0]);
      expect(r.source, r.id).toMatch(/›/);
      expect(pathProblem(r), r.id).toBeNull();
      // The one who saw it tells it as it was; the game knows every later telling against the truth.
      const hops = driftOf(r, ON);
      expect(hops[0].truth, r.id).toBe('true');
      for (const h of hops) expect(h.truth).toBe(h.n === r.truth.n && h.where === r.truth.where && h.who === r.truth.who ? 'true' : 'rumour');
    }
    // In play: every generated fact is found again as its rumour's hop, with the truth the game knows.
    const gen = generatedFacts(facts);
    expect(gen.length).toBeGreaterThan(0);
    for (const f of gen) expect(rumourHopOf(f)?.rumour.id, f.id).toMatch(/^run-/);

    // The journal: ask every holder about each generated rumour's topics; two tellings that don't
    // agree are flagged, as for a hand-written rumour, under the rumour's own name.
    const contradicted = [ha, hb].flatMap(h => {
      const id = h === ha ? A : B;
      const fs = playFacts(run(id));
      return runRumours(h, ON).flatMap(r => {
        const asked: Record<string, string[]> = {};
        for (const f of generatedFacts(fs).filter(x => rumourHopOf(x)?.rumour.id === r.id)) {
          const topic = r.about.find(t => resolve(f.scope.id!, t, Infinity, { facts: fs, others: [] })?.kind === 'told');
          if (topic) (asked[f.scope.id!] ??= []).push(topic);
        }
        const heard: HeardClaim[] = claimsHeard(asked, fs, liesFor(ON, seedOf(id))).filter(c => c.proposition === r.id);
        const entry = journalOf(heard, []).find(e => e.proposition === r.id);
        return entry?.status === 'contradicted' ? [{ r, entry }] : [];
      });
    });
    expect(contradicted.length).toBeGreaterThan(0);
    for (const { r, entry } of contradicted) {
      expect(entry.label).toBe(r.label);
      // The player never reads which is so, but the game does: some claims are the truth, some bent.
      expect(entry.claims.some(c => c.truth === 'rumour')).toBe(true);
    }

    // A lie picked from the pool is caught like a written one: someone else says otherwise.
    const seed = Array.from({ length: 200 }, (_, i) => seedOf(`w-liar-${i}`)).find(s => liesFor(ON, s)['kg-arvid'])!;
    expect(seed).toBeDefined();
    const lie = lieById('arvid-compact')!;
    expect(lie).toBeDefined();
    const lies = liesFor(ON, seed);
    const heard = claimsHeard({ 'kg-arvid': ['claimed:group:compact'], 'hf-maren': ['group:compact'] }, factsFor(ON), lies);
    expect(heard.map(c => c.proposition)).toEqual(['compact-is-real', 'compact-is-real']);
    expect(heard[0].truth).toBe('lie');
    expect(caughtOut(lie, heard, [])).toBe(true);
    expect(caughtOut(lie, heard.slice(0, 1), [])).toBe(false);
    expect(journalOf(heard, [])[0].status).toBe('contradicted');
  });

  it('4. any seed: the number of liars stays within the agreed range, the written ones always among them', () => {
    expect(LIARS).toEqual({ min: 3, max: 4 });
    const counts = new Set<number>();
    const extra = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const lies = liesFor(ON, seedOf(`w-count-${i}`));
      const liars = Object.keys(lies);
      expect(liars.length).toBeGreaterThanOrEqual(LIARS.min);
      expect(liars.length).toBeLessThanOrEqual(LIARS.max);
      for (const base of ['hf-tobin', 'sm-hedda', 'kg-sabine']) expect(liars).toContain(base);
      counts.add(liars.length);
      for (const l of liars) if (!['hf-tobin', 'sm-hedda', 'kg-sabine'].includes(l)) extra.add(l);
    }
    expect([...counts].sort()).toEqual([3, 4]);
    // Every pooled liar turns up in some run, and every pooled lie stands on the data: a motive it holds up, a claim it's about.
    const pool = claimEntries().poolLies;
    expect(new Set(pool.map(l => l.person))).toEqual(extra);
    for (const l of pool) {
      expect(motiveProblem(l), l.id).toBeNull();
      expect(PROPOSITIONS[l.proposition], l.id).toBeDefined();
    }
  });

  it('5. with the switch off, play equals today\'s', () => {
    expect(featureOn(undefined, RUN_RUMOURS)).toBe(false);
    for (const features of [OFF, undefined]) {
      // The facts: today's, exactly (factsFor's, then the history's), and no generated rumour among them.
      const facts = playFacts({ features, character: { id: A } });
      expect(generatedFacts(facts)).toEqual([]);
      if (features) expect(facts).toEqual([...factsFor(OFF), ...historyFacts(ha, OFF)]);
      // The lies: the written ones, the very same object whatever the seed.
      expect(liesFor(features, seedOf(A))).toBe(liesFor(features));
      expect(liesFor(features, seedOf(B))).toBe(liesFor(features));
    }
    expect(runRumours(ha, OFF)).toEqual([]);
    expect(roadRumours(seedOf(A), OFF)).toEqual([]);
  });
});
