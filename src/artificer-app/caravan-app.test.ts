/**
 * The caravan meeting's controller (#1356): meet the caravan at the thaw, answer, then climb
 * aboard (the road starts from what was agreed) or watch them go; and a meeting survives a reload.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from '../artificer/region1';
import { createVitals } from '../artificer/vitality';
import { meetCaravan, meetingChoose, rideCaravan, stayBehind, serialize, deserialize, type AppState } from './controller';
import { meetingModal } from './caravan-view';

function thaw(): AppState {
  const s = createRegion1({}, undefined, { id: 'w-app-meet', name: 'Vega' });
  const vitals = createVitals({ condition: 90 });
  const sim: Region1State = { ...s, day: 61, vitals, tools: [], stores: { ...s.stores, hides: 3 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
  return { sim, queue: [], stage: 'reach' };
}

describe('Meeting the caravan in the app (#1356)', () => {
  it('opens the meeting at the thaw, and boards with what was agreed', () => {
    const a = meetCaravan(thaw());
    expect(a.meeting?.step).toBe('greet');
    // While the meeting is open, there's no climbing aboard.
    expect(rideCaravan(a)).toBe(a);
    const paid = meetingChoose(meetingChoose(a, 'hail'), 'hides');
    expect(paid.meeting?.ended).toBe('board');
    const road = rideCaravan(paid);
    expect(road.stage).toBe('road');
    expect(road.meeting).toBeUndefined();
    expect(road.road!.stores.hides).toBe(1);
    expect(road.road!.fare).toBe('goods');
  });

  it('lets you watch them go, and then there is no ride', () => {
    const a = meetingChoose(meetCaravan(thaw()), 'pass');
    expect(a.meeting?.ended).toBe('stay');
    const stayed = stayBehind(a);
    expect(stayed).toMatchObject({ stayed: true, stage: 'reach' });
    expect(stayed.meeting).toBeUndefined();
    expect(rideCaravan(stayed)).toBe(stayed);
    expect(meetCaravan(stayed)).toBe(stayed);
  });

  it('only meets a Warden who survived', () => {
    const dead = { ...thaw(), sim: { ...thaw().sim, outcome: { choice: 'collapse' as const, kind: 'died' as const, vitals: createVitals() } } };
    expect(meetCaravan(dead)).toBe(dead);
  });

  it('keeps the meeting (and a stay) across a reload', () => {
    const a = meetingChoose(meetCaravan(thaw()), 'merchant');
    const back = deserialize(serialize(a))!;
    expect(back.meeting).toEqual(a.meeting);
    const stayed = stayBehind(meetingChoose(meetCaravan(thaw()), 'pass'));
    expect(deserialize(serialize(stayed))!.stayed).toBe(true);
    // A broken meeting is dropped rather than breaking the save.
    const raw = JSON.parse(serialize(a));
    raw.meeting = { step: 'nowhere' };
    expect(deserialize(JSON.stringify(raw))!.meeting).toBeUndefined();
  });

  it('draws the speaker, the options and the way aboard', () => {
    const a = meetCaravan(thaw());
    const html = meetingModal(a.sim, a.meeting);
    expect(html).toContain('Bodil');
    expect(html).toContain('data-meet="hail"');
    const fare = meetingChoose(a, 'hail');
    expect(meetingModal(fare.sim, fare.meeting)).toMatch(/data-meet="marks" disabled title="needs 8 marks"/);
    expect(meetingModal(fare.sim, meetingChoose(fare, 'work').meeting)).toContain("CLIMB ABOARD — YOU OWE 2 DAYS' HELP");
    expect(meetingModal(a.sim, undefined)).toBe('');
  });
});
