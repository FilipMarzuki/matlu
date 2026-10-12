/**
 * Acceptance tests for what a caught lie costs (#1660, a follow-up to rumours and lies, #1580).
 * Behind the `caught-lies` rule switch. The issue's Given/When/Then, one test each:
 *
 * - **Protective lie** → "Given a protective lie, When the player confronts the liar with the
 *   truth, Then the liar tells the truth and why they lied" (Sabine covering for Orrin; Tobin's
 *   loyal lie for the Compact goes the same way, pinned beside it).
 * - **Greedy lie, trust** → "Given a greedy lie caught, Then the liar's trust drops and a guarded
 *   topic is no longer told at the trust level that used to unlock it" (Hedda on salt; her
 *   guarded topic is the Compact, at trust 25).
 * - **Greedy lie, friends** → "Given a greedy lie caught, Then a friend of the liar reacts" (the
 *   pinned reaction: each friend who thinks well of her trusts the Warden less, CAUGHT_WORD scaled
 *   by their opinion of her, and the log says word will reach them: Tobin −6, Bodil −5).
 * - **Switch off** → "Given the switch off, Then play equals today's" (a liar asked again sticks
 *   to their story; off and a run from before the switch play identically).
 *
 * Then what holds them up: the data's reason kinds, and the record #1663 will read.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ruleFeatures } from './features';
import { ASK_TRUST } from './asks';
import { FACTS } from './facts';
import { claimEntries, liesFor } from './claims';
import { CAUGHT_TRUST, CAUGHT_WORD, GUARDED, caughtIn, caughtWord, friendsWhoHear, guardOf } from './caught-lies';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, villageOf, type RoadState } from './road';
import { TIE_FACTS } from './ties';

const ON = ruleFeatures();
const OFF = { ...ON, 'caught-lies': false };
const BEFORE: Record<string, boolean> = Object.fromEntries(Object.entries(ON).filter(([k]) => k !== 'caught-lies'));
const LIES = liesFor(ON);

/** A Warden out of the Reach, in a world with `features`, riding on until `until` says stop. */
function ride(features: Record<string, boolean>, until: (r: RoadState) => boolean, from?: RoadState): RoadState {
  let r = from;
  if (!r) {
    const s = createRegion1({}, undefined, { id: 'w-caught', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
    const vitals = createVitals({ vigor: 80, clarity: 80, condition: 90 });
    const r1: Region1State = {
      ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 80, water: 80, rations: 12 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals },
      config: { ...s.config, world: { ...s.config.world, features } },
    };
    r = createRoad(r1);
  }
  for (let i = 0; i < 30 && !until(r); i++) r = endRoadDay(r);
  return r;
}

/** Ask `pid` about `topic` on the road with `trust`: the state after. */
function askOnRoad(r: RoadState, pid: string, topic: string, trust: number): RoadState {
  const [kind, id] = topic.split(':');
  return runRoadAction({ ...r, hoursToday: 0, focus: { kind, id } as RoadState['focus'], trust: { ...r.trust, [pid]: trust } }, `ask:${pid}`);
}

const lieOf = (id: string) => claimEntries().lies.find(l => l.id === id)!;
const textOf = (factId: string) => [...FACTS, ...TIE_FACTS].find(f => f.id === factId)!.text;

/** At Saltmere: Hedda lies about salt at trust 40, then Liv tells the truth of it. */
function heddaLiedAndLivSaidOtherwise(features: Record<string, boolean>): RoadState {
  let r = ride(features, x => villageOf(x) === 'saltmere');
  r = askOnRoad(r, 'sm-hedda', 'material:salt', 40);
  return askOnRoad(r, 'sm-liv', 'material:salt', 30);
}

describe('#1660 acceptance', () => {
  describe('Protective lie: caught, the liar comes clean and says why', () => {
    it('Given Sabine covered for Orrin and Isa at Hollowford said otherwise, When the Warden asks Sabine again, Then she tells the truth and why she lied', () => {
      let r = ride(ON, x => villageOf(x) === 'hollowford');
      r = askOnRoad(r, 'hf-isa', 'role:smith', 30);
      r = ride(ON, x => villageOf(x) === 'kestrel-gate', r);
      r = askOnRoad(r, 'kg-sabine', 'person:hf-orrin', 10);
      const sabine = lieOf('sabine-orrin');
      expect(sabine.reason).toBe('protective');
      expect(r.log.some(l => l.text.includes(sabine.text))).toBe(true);
      const caught = askOnRoad(r, 'kg-sabine', 'person:hf-orrin', 10);
      const line = caught.log.at(-1)!.text;
      // Why, in her own words, and then the truth she'd kept, whatever the gate (her view of Orrin is guarded at 25).
      expect(line).toContain(`Sabine: "${sabine.caught}"`);
      expect(line).toContain(textOf('tie:orrin-sabine:kg-sabine'));
      expect(caught.asked?.['kg-sabine']).toEqual(['claimed:person:hf-orrin', 'caught:person:hf-orrin', 'person:hf-orrin']);
      // Catching it costs her nothing with you: trust only for the talk.
      expect(caught.trust['kg-sabine']).toBe(10 + ASK_TRUST);
      expect(guardOf(caught.asked, caught.features, 'kg-sabine')).toBe(0);
    }, 60_000);

    it('Given Tobin kept the Compact’s business (a loyal lie) and Maren said otherwise, When asked again, Then he comes clean the same way', () => {
      let r = ride(ON, x => villageOf(x) === 'hollowford');
      r = askOnRoad(r, 'hf-tobin', 'group:compact', 20);
      // Asked again with nothing heard otherwise, he sticks to it, and no time passes.
      const stuck = runRoadAction(r, 'ask:hf-tobin');
      expect(stuck.hoursToday).toBe(r.hoursToday);
      expect(stuck.asked?.['hf-tobin']).toEqual(['claimed:group:compact']);
      r = askOnRoad(r, 'hf-maren', 'group:compact', 30);
      const caught = askOnRoad(r, 'hf-tobin', 'group:compact', 20);
      expect(lieOf('tobin-compact').reason).toBe('loyal');
      expect(caught.log.at(-1)!.text).toContain(`Tobin: "${lieOf('tobin-compact').caught}" Then: "${textOf('answer:hf-tobin:group:compact')}"`);
      expect(caught.asked?.['hf-tobin']).toEqual(['claimed:group:compact', 'caught:group:compact', 'group:compact']);
    }, 60_000);
  });

  describe('Greedy lie: caught, trust drops, secrets are guarded, and friends hear of it', () => {
    let lied: RoadState, caught: RoadState;
    beforeAll(() => {
      lied = heddaLiedAndLivSaidOtherwise(ON);
      caught = askOnRoad(lied, 'sm-hedda', 'material:salt', 40);
    }, 60_000);

    it('Given Hedda’s greedy lie caught, Then her trust drops and her guarded topic (the Compact, at 25) is no longer told at the trust that used to open it', () => {
      expect(lieOf('hedda-salt').reason).toBe('greedy');
      expect(caught.log.some(l => l.text.includes(`Hedda: "${lieOf('hedda-salt').caught}"`))).toBe(true);
      expect(caught.trust['sm-hedda']).toBe(40 - CAUGHT_TRUST);
      expect(caught.asked?.['sm-hedda']).toEqual(['claimed:material:salt', 'caught:material:salt']);
      // Before: at trust 30 she tells you about the Compact.
      const toldBefore = askOnRoad(lied, 'sm-hedda', 'group:compact', 30);
      expect(toldBefore.log.at(-1)!.text).toContain(textOf('answer:sm-hedda:group:compact'));
      // After: the same trust no longer opens it (she guards it by GUARDED), and nor does what she has left.
      expect(GUARDED).toBeGreaterThan(30 - 25);
      for (const trust of [30, caught.trust['sm-hedda']]) {
        const after = askOnRoad(caught, 'sm-hedda', 'group:compact', trust);
        expect(after.log.at(-1)!.text).toMatch(/Ask me again when I know you better/);
      }
      // She tells no more for being caught: no truth comes of it.
      expect(caught.asked?.['sm-hedda']).not.toContain('material:salt');
    });

    it('Given Hedda’s greedy lie caught, Then her friends react: each who thinks well of her (Tobin, Bodil) trusts the Warden less, and the log says word will reach them', () => {
      expect(friendsWhoHear('sm-hedda')).toEqual([{ person: 'hf-tobin', cools: 6 }, { person: 'cv-bodil', cools: 5 }]);
      expect(CAUGHT_WORD).toBe(10);
      expect(caught.trust['hf-tobin']).toBe(lied.trust['hf-tobin'] - 6);
      expect(caught.trust['cv-bodil']).toBe(lied.trust['cv-bodil'] - 5);
      expect(caught.log.some(l => l.text === 'Word of it will reach Tobin and Bodil, who think well of Hedda.')).toBe(true);
      // Someone not yet met hears it too, and starts that much cooler (read off what's kept).
      expect(caughtWord(caught.asked, ON, 'hf-tobin')).toBe(6);
      expect(caughtWord(caught.asked, ON, 'sm-liv')).toBe(0);
    });
  });

  describe('Switch off: play is today’s', () => {
    it('Given the switch off, When Hedda is asked again after Liv said otherwise, Then she sticks to her story, nothing changes, and play equals a run from before the switch', () => {
      const off = heddaLiedAndLivSaidOtherwise(OFF);
      const before = heddaLiedAndLivSaidOtherwise(BEFORE);
      const offAgain = askOnRoad(off, 'sm-hedda', 'material:salt', 40);
      const beforeAgain = askOnRoad(before, 'sm-hedda', 'material:salt', 40);
      expect(offAgain.log.at(-1)!.text).toBe('Hedda has already told you what they know about salt.');
      expect(offAgain.hoursToday).toBe(0);
      expect(offAgain.trust['sm-hedda']).toBe(40);
      expect(offAgain.asked?.['sm-hedda']).toEqual(['claimed:material:salt']);
      // The same game, move for move, as a run that never had the switch.
      const { features: _a, ...offRest } = offAgain;
      const { features: _b, ...beforeRest } = beforeAgain;
      expect(offRest).toEqual(beforeRest);
      // And nothing read off a caught lie counts with it off.
      const kept = { 'sm-hedda': ['claimed:material:salt', 'caught:material:salt'] };
      expect(guardOf(kept, OFF, 'sm-hedda')).toBe(0);
      expect(caughtWord(kept, OFF, 'hf-tobin')).toBe(0);
      expect(guardOf(kept, BEFORE, 'sm-hedda')).toBe(0);
    }, 60_000);
  });
});

describe('#1660 data and record', () => {
  it('every lie has a reason kind from the vocabulary, and words for when it is caught', () => {
    for (const l of claimEntries().lies) {
      expect(['protective', 'loyal', 'greedy'], l.id).toContain(l.reason);
      expect(l.caught.trim().length, l.id).toBeGreaterThan(0);
    }
    // The owner's examples, as the issue names them.
    expect(Object.fromEntries(claimEntries().lies.map(l => [l.id, l.reason]))).toEqual({ 'tobin-compact': 'loyal', 'hedda-salt': 'greedy', 'sabine-orrin': 'protective' });
    expect(LIES['sm-hedda']?.length).toBe(1);
  });

  it('a caught lie is kept in order in `asked`, so a reader of the deed history sees lied, caught, told', () => {
    const asked = { 'hf-tobin': ['claimed:group:compact', 'caught:group:compact', 'group:compact'], 'sm-hedda': ['material:hides'] };
    expect(caughtIn(asked, ON, 'hf-tobin').map(l => l.id)).toEqual(['tobin-compact']);
    expect(caughtIn(asked, ON, 'sm-hedda')).toEqual([]);
    // A caught marker for a topic they never lied about is no lie caught.
    expect(caughtIn({ 'sm-liv': ['caught:material:salt'] }, ON, 'sm-liv')).toEqual([]);
  });
});
