/**
 * Acceptance tests for #1355 — meeting the caravan at the thaw: a short dialogue with Bodil,
 * the fare, and Runa the merchant on the wagon. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, villageOf, tradeTerms, type RoadState } from './road';
import { openMeeting, meetingOptions, meetingStep, meetingChance, chooseInMeeting, boardingOf, safestMeetingOption, MEETING_STEPS, OWED_HELP, UNPAID_HELP_TRUST, type Meeting } from './caravan-meeting';
import { TRADER_STOCK, sellPrice } from './trade';

/** A hale Warden at the thaw: no hides, no marks, nothing fine. */
function survived(id = 'w-meet', extra: Partial<Region1State> = {}): Region1State {
  const s = createRegion1({}, undefined, { id, name: 'Vega' });
  const vitals = createVitals({ condition: 90 });
  return { ...s, day: 61, vitals, tools: [], stores: { ...s.stores, rawFood: 10, water: 10, materials: 6, hides: 0, rations: 0 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals }, ...extra };
}
const at = (reach: Region1State, m: Meeting, id: string) => meetingOptions(reach, m).find(o => o.option.id === id)!;
const toFare = (reach: Region1State): Meeting => chooseInMeeting(reach, openMeeting(reach), 'hail');
const withTalent = (s: Region1State): Region1State => ({ ...s, character: { ...s.character, talents: [{ id: 'silverTongue', tier: 2, known: true }] } });
/** Ride the wagon to the first village, doing `today` each day. */
function rideToHollowford(r: RoadState, today: (r: RoadState) => RoadState = x => x): RoadState {
  while (!villageOf(r) && !r.outcome) r = endRoadDay(today(r));
  return r;
}

describe('Meeting the caravan (#1355)', () => {
  // 1. Survived to the thaw: Bodil greets you, with options to greet, ask about the merchant, or let them pass.
  it('opens with Bodil greeting you, and three ways to answer', () => {
    const reach = survived();
    const m = openMeeting(reach);
    expect(meetingStep(m)).toMatchObject({ id: 'greet', speaker: 'cv-bodil' });
    expect(m.lines).toEqual([{ speaker: 'cv-bodil', text: MEETING_STEPS.greet.text }]);
    expect(meetingOptions(reach, m).map(o => [o.option.id, o.unmet, o.odds])).toEqual([['hail', null, 'safe'], ['merchant', null, 'safe'], ['pass', null, 'safe']]);
    // The dead meet no one.
    expect(() => openMeeting({ ...reach, outcome: { choice: 'collapse', kind: 'died', vitals: reach.vitals } })).toThrow();
  });

  // 2. The fare, with no hides and no marks: paying is unavailable with the reason; working is open.
  it('shuts the fares you cannot pay, and always lets you work your passage', () => {
    const reach = survived();
    const m = toFare(reach);
    expect(m.step).toBe('fare');
    expect(at(reach, m, 'hides').unmet).toBe('needs 2 hides');
    expect(at(reach, m, 'rations').unmet).toBe('needs 4 rations');
    expect(at(reach, m, 'marks').unmet).toBe('needs 8 marks');
    expect(at(reach, m, 'show').unmet).toMatch(/needs a fine or better thing you made/);
    expect(at(reach, m, 'work')).toMatchObject({ unmet: null, odds: 'safe' });
    // Choosing one you can't take changes nothing but says why.
    const tried = chooseInMeeting(reach, m, 'marks');
    expect(tried).toMatchObject({ step: 'fare', ended: null, paid: m.paid, last: { success: false, text: 'Not possible — needs 8 marks.' } });
    // With the hides, marks or a fine tool, they open.
    const rich = survived('w-meet', { stores: { ...reach.stores, hides: 2, rations: 4 }, marks: 8, tools: [{ item: 'stone-knife', grade: 'fine' }] });
    for (const id of ['hides', 'rations', 'marks', 'show']) expect(at(rich, toFare(rich), id).unmet).toBeNull();
    // And the safest choice for someone with nothing is to work.
    expect(safestMeetingOption(reach, m).id).toBe('work');
  });

  // 3. Silver Tongue: talking your way on has better odds than without it.
  it('gives a silver tongue better odds of talking its way on', () => {
    const plain = survived(), silver = withTalent(survived());
    const talk = MEETING_STEPS.fare.options.find(o => o.id === 'talk')!;
    expect(meetingChance(silver, talk)).toBeGreaterThan(meetingChance(plain, talk));
    expect(at(plain, toFare(plain), 'talk').odds).toBe('desperate');
    expect(at(silver, toFare(silver), 'talk').odds).toBe('risky');
  });

  // 4. Talking your way on fails: only paying or working remains.
  it('leaves only paying or working after a failed talk', () => {
    // Find a Warden whose talk fails (it is seeded: the same Warden always gets the same answer).
    let reach: Region1State | null = null, after: Meeting | null = null;
    for (let i = 0; i < 40 && !after; i++) {
      const r = survived(`w-talk-${i}`);
      const m = chooseInMeeting(r, toFare(r), 'talk');
      if (!m.last!.success) { reach = r; after = m; }
    }
    expect(after).not.toBeNull();
    expect(after!).toMatchObject({ step: 'fare-again', ended: null, fare: null, trust: { 'cv-bodil': 0 } });
    expect(meetingOptions(reach!, after!).map(o => o.option.id)).toEqual(['hides', 'rations', 'marks', 'work']);
    expect(after!.lines.at(-1)).toEqual({ speaker: 'cv-bodil', text: MEETING_STEPS['fare-again'].text });
    // A talk that works gets you on for nothing.
    let won: Meeting | null = null;
    for (let i = 0; i < 40 && !won; i++) {
      const r = withTalent(survived(`w-talk-${i}`));
      const m = chooseInMeeting(r, toFare(r), 'talk');
      if (m.last!.success) won = m;
    }
    expect(won).toMatchObject({ ended: 'board', fare: 'word', paid: { stores: {}, marks: 0 } });
  });

  // 5. Working your passage: 2 help owed on the road; unpaid at Hollowford, Bodil's trust drops.
  it('owes help for a worked passage, and Bodil remembers if it is never given', () => {
    const reach = survived();
    const m = chooseInMeeting(reach, toFare(reach), 'work');
    expect(m).toMatchObject({ ended: 'board', fare: 'work', owesHelp: OWED_HELP });
    const road = createRoad(reach, boardingOf(m)!);
    expect(road.owesHelp).toBe(OWED_HELP);
    const bodil = road.trust['cv-bodil'];
    // Never helping: at Hollowford the debt costs trust, and is cleared.
    const idle = rideToHollowford(road);
    expect(idle.trust['cv-bodil']).toBe(bodil - UNPAID_HELP_TRUST);
    expect(idle.owesHelp).toBe(0);
    expect(idle.log.some(l => /Bodil hasn't forgotten the 2 days of help/.test(l.text))).toBe(true);
    // Helping each wagon day pays it off, and her trust holds.
    const paid = rideToHollowford(road, r => runRoadAction(r, 'help'));
    expect(paid.owesHelp).toBe(0);
    expect(paid.trust['cv-bodil']).toBe(bodil);
    expect(paid.log.some(l => /Your passage is worked off/.test(l.text))).toBe(true);
  });

  // 6. A fare paid in goods: gone from stores when the road starts, and the meeting's trust applied.
  it('takes the fare from your stores and applies the trust the meeting won', () => {
    const reach = survived('w-meet', { stores: { ...survived().stores, hides: 3 } });
    let m = chooseInMeeting(reach, openMeeting(reach), 'merchant');
    expect(m.step).toBe('fare');
    m = chooseInMeeting(reach, m, 'hides');
    expect(m).toMatchObject({ ended: 'board', fare: 'goods', paid: { stores: { hides: 2 }, marks: 0 }, trust: { 'cv-runa': 5, 'cv-bodil': 5 } });
    const plain = createRoad(reach);
    const road = createRoad(reach, boardingOf(m)!);
    expect(road.stores.hides).toBe(plain.stores.hides - 2);
    expect(road.trust['cv-runa']).toBe(plain.trust['cv-runa'] + 5);
    expect(road.trust['cv-bodil']).toBe(plain.trust['cv-bodil'] + 5);
    expect(road.fare).toBe('goods');
    // The meeting is in the journal, before the wagon rolls.
    expect(road.log[0].text).toBe(`Bodil: ${MEETING_STEPS.greet.text}`);
    expect(road.log.some(l => l.text === 'You: Pay in hides')).toBe(true);
  });

  // 7. Let them pass: no road, and the run stays survived.
  it('lets you stay behind: no boarding, the run still survived', () => {
    const reach = survived();
    const m = chooseInMeeting(reach, openMeeting(reach), 'pass');
    expect(m.ended).toBe('stay');
    expect(boardingOf(m)).toBeNull();
    expect(reach.outcome?.kind).toBe('survived');
    // A finished meeting takes no more choices.
    expect(chooseInMeeting(reach, m, 'hail')).toBe(m);
  });

  // 8. Selling to Runa: on travel days, at her terms; in a village the village trader trades.
  it('lets you trade with Runa on the wagon, and not in a village', () => {
    const reach = survived();
    const road = createRoad(reach, boardingOf(chooseInMeeting(reach, toFare(reach), 'work'))!);
    expect(villageOf(road)).toBeNull();
    const terms = tradeTerms(road)!;
    expect(terms).toMatchObject({ trader: 'cv-runa', name: 'Runa', wants: TRADER_STOCK['cv-runa'].wants });
    const sold = runRoadAction(road, 'sell:materials:3');
    expect(sold.stores.materials).toBe(road.stores.materials - 3);
    expect(sold.marks).toBe(road.marks + sellPrice('materials', 'sound', 3, terms)); // materials are what she wants: ×1.5
    expect(sold.log.at(-1)!.text).toMatch(/Sold 3 materials to Runa for \d+ marks/);
    // In Hollowford, Tobin trades, not Runa.
    const village = rideToHollowford(road);
    expect(tradeTerms(village)?.trader).toBe('hf-tobin');
  });

  // 9. The same Warden and choices: the same meeting.
  it('turns out the same for the same Warden and choices', () => {
    const play = (id: string): Meeting => {
      const r = survived(id);
      return chooseInMeeting(r, chooseInMeeting(r, toFare(r), 'talk'), 'work');
    };
    expect(play('w-same')).toEqual(play('w-same'));
    // And the outcome follows the Warden: across many, some talks work and some don't.
    const wins = Array.from({ length: 40 }, (_, i) => chooseInMeeting(survived(`w-many-${i}`), toFare(survived(`w-many-${i}`)), 'talk').last!.success);
    expect(wins).toContain(true);
    expect(wins).toContain(false);
  });
});
