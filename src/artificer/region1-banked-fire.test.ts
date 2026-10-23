/**
 * Acceptance tests for #1865: a banked fire guards the meat at camp while you're away on a day trip
 * (switch `banked-fire`, on top of #1823's `camp-scavengers`). One test per Given/When/Then:
 *
 *   1. Guarded  — meat lying out and a banked fire, away 4h or more: a small thief's risk is the
 *                  fire's share of the away risk (0.1×).
 *   2. Firewood — banking uses the firewood it costs; with too little it can't be banked, and says why.
 *   3. Rain     — in heavy rain, on some seeded trips the fire goes out and the guard doesn't count.
 *   4. Same seed — the same results; with the switch off or absent nothing changes (the journal is the
 *                  one main played before #1865).
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, endDay, ACTIONS, meatOf, bankedNow, type Region1State, type QueueItem } from './region1';
import { shown, visibilityOf } from './action-visibility';
import { scout, survey, createExploration } from './exploration';
import { FULL_WORLD, type WorldConfig, type WeatherId } from './world';
import { ruleFeatures } from './features';
import { seedOf } from './rng';
import { DAY_BASE, GUARDS, LONG_AWAY_HOURS, BANK_FIREWOOD, BANK_HOURS, FIRE_OUT, leftover, awayScavengers, bankedFireDraw, bankLine, fireOutLine, burntDownLine } from './camp-scavengers';
import { observe } from '../artificer-ai/observe';
import { meatBlock } from '../artificer-app/camp-blocks';
import { simLine } from '../artificer-app/sim-words';
import { makeT } from './i18n';

const svT = makeT('sv'), enT = makeT('en');

/** Daylight, a fixed weather, no accidents or encounters, luck on. `on`: the `banked-fire` switch (`absent`: a run from before it). */
const world = (weather: WeatherId, on: boolean | 'absent' = true): WorldConfig => ({
  ...FULL_WORLD, luck: true, accidents: false, darkness: false, weather, encounters: false,
  features: { 'action-visibility': true, 'camp-scavengers': true, ...(on === 'absent' ? {} : { 'banked-fire': on }) },
});

/** A Warden camped at the treeline who knows the near and far ground, with 8 raw meat lying out and `firewood`. */
function warden(id: string, { firewood = 6, weather = 'clear' as WeatherId, on = true as boolean | 'absent' } = {}): Region1State {
  const s = createRegion1({ world: world(weather, on) }, undefined, { id });
  return {
    ...s, site: s.site ?? 'tree', explore: scout(scout(createExploration(), 1), 2),
    stores: { ...s.stores, rawFood: 8, materials: 0, stone: 0, water: 5, firewood, rations: 2 },
    meat: 8,
  };
}

const ids = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
/** Whether a fox or ravens got at the meat on the trip (the journal says so). */
const robbed = (s: Region1State): boolean => s.log.some(e => /got at the meat/.test(e.text));
/** The long trip each test takes: wood a half-day out, well over 4h there and back. */
const TRIP: QueueItem = 'wood@2';

describe('A banked fire guards the meat at camp while you are away (#1865)', () => {
  it('1. meat lying out and a banked fire, away 4h or more: a small thief comes at the fire\'s share of the away risk (0.1×)', () => {
    // The rating: the fire guard by day leaves a tenth of the small threat, and nothing big by day.
    expect(leftover(['fire'], DAY_BASE).small).toBeCloseTo(GUARDS.fire.small * DAY_BASE.small, 12);
    expect(GUARDS.fire.small).toBe(0.1);
    expect(leftover(['fire'], DAY_BASE).big).toBe(0);
    let guarded = 0, open = 0;
    for (const id of ids('w-bank', 400)) {
      const s = runAction(warden(id), 'bankfire');
      expect(bankedNow(s)).toBe(true);
      const back = runAction(s, TRIP);
      expect(back.hoursToday - s.hoursToday).toBeGreaterThanOrEqual(LONG_AWAY_HOURS);
      // The banked fire lasted the trip (clear weather, back within its hours), so it still smoulders.
      expect(bankedNow(back)).toBe(true);
      // The away roll is the same stream as ever: a theft exactly when its first draw falls under the
      // guarded risk (0.025), where the unguarded trip's would fall under 0.25.
      const u = awayScavengers(seedOf(id), s.day, s.hoursToday)();
      expect(robbed(back)).toBe(u < leftover(['fire'], DAY_BASE).small);
      if (robbed(back)) guarded++;
      if (u < DAY_BASE.small) open++;
    }
    // In play: about a tenth as many thefts as the same trips would see unguarded.
    expect(open).toBeGreaterThan(60);
    expect(guarded).toBeLessThan(open / 4);
    // The camp view and the AI's observation say the fire is banked, and the meat well protected while away.
    const s = runAction(warden('w-bank-view'), 'bankfire');
    expect(observe(s)).toMatch(/CAMP FIRE: a banked fire smoulders in camp/);
    expect(observe(s)).toMatch(/while you're away \(a banked fire\): well protected/);
    expect(observe(s)).toMatch(/BANKED FIRE: "bankfire"/);
    expect(meatBlock(s, enT)).toContain('A banked fire smoulders in camp.');
    expect(meatBlock(s, svT)).toContain('En inbäddad eld pyr i lägret.');
    expect(meatBlock(s, enT)).toContain(`away: ${enT('meat.prot.well')} ·`);
    // Gone by morning: the night has its own fire.
    expect(bankedNow(endDay(s))).toBe(false);
  });

  it('2. a banked fire uses the firewood it costs; with too little firewood it can\'t be banked, and says why', () => {
    expect(ACTIONS.bankfire.name).toBe('Bank the fire');
    expect(enT('act.bankfire')).toBe('Bank the fire');
    expect(svT('act.bankfire')).toBe('Lägg på elden');
    // About 1 firewood for every 4 hours away.
    expect(BANK_HOURS / BANK_FIREWOOD).toBe(4);
    const s = warden('w-wood', { firewood: 5 });
    const banked = runAction(s, 'bankfire');
    expect(banked.stores.firewood).toBe(5 - BANK_FIREWOOD);
    const line = banked.log.find(e => /^Banked the fire/.test(e.text))!.text;
    expect(line).toBe(bankLine());
    expect(simLine(line, svT)).toBe(`Lade på elden med ${BANK_FIREWOOD} ved och bäddade in den: den pyr i runt ${BANK_HOURS} timmar och håller djuren borta från köttet.`);
    // Already banked: not again.
    expect(visibilityOf(banked, 'bankfire').status).toBe('greyed');
    // Too little firewood: greyed, saying why (in both languages), and refused if tried: nothing used.
    const short = warden('w-wood', { firewood: BANK_FIREWOOD - 1 });
    const v = visibilityOf(short, 'bankfire');
    expect(v.status).toBe('greyed');
    expect(v.reason).toBe(`needs ${BANK_FIREWOOD} firewood to bank the fire (have ${BANK_FIREWOOD - 1})`);
    expect(simLine(v.reason!, svT)).toBe(`behöver ${BANK_FIREWOOD} ved för att bädda in elden (har ${BANK_FIREWOOD - 1})`);
    const tried = runAction(short, 'bankfire');
    expect(tried.stores.firewood).toBe(BANK_FIREWOOD - 1);
    expect(bankedNow(tried)).toBe(false);
    // Nothing lying out to guard: nothing to bank it for.
    expect(visibilityOf({ ...s, meat: 0 }, 'bankfire').reason).toBe('no raw meat lying out to guard');
  });

  it('3. heavy rain: on some seeded trips the fire goes out, the journal says so, and the guard doesn\'t count', () => {
    expect(FIRE_OUT.rain).toBeGreaterThan(0);
    let out = 0, lasted = 0;
    for (const id of ids('w-rain', 300)) {
      const s = runAction(warden(id, { weather: 'rain' }), 'bankfire');
      const back = runAction(s, TRIP);
      const wentOut = bankedFireDraw(seedOf(id), s.day, s.hoursToday)() < FIRE_OUT.rain!;
      expect(back.log.some(e => e.text === fireOutLine('rain'))).toBe(wentOut);
      expect(bankedNow(back)).toBe(!wentOut);
      // Out: the meat lay open (the full away risk); still smouldering: the fire's share.
      const u = awayScavengers(seedOf(id), s.day, s.hoursToday)();
      expect(robbed(back)).toBe(u < (wentOut ? DAY_BASE.small : leftover(['fire'], DAY_BASE).small));
      if (wentOut) out++; else lasted++;
    }
    expect(out).toBeGreaterThan(0);
    expect(lasted).toBeGreaterThan(0);
    // About its chance, give or take the sample.
    expect(out / 300).toBeGreaterThan(FIRE_OUT.rain! / 2);
    expect(out / 300).toBeLessThan(Math.min(1, FIRE_OUT.rain! * 1.6));
    // The journal's lines read back in Swedish.
    expect(simLine(fireOutLine('rain'), svT)).toBe('Medan du var borta släckte regnet den inbäddade elden, och ingenting höll djuren borta från köttet.');
    expect(simLine(fireOutLine('snow'), svT)).toMatch(/snön/);
    expect(simLine(fireOutLine('storm'), svT)).toMatch(/stormen/);
    expect(simLine(burntDownLine(), svT)).toMatch(/^Den inbäddade elden hade brunnit ut/);
    // Clear weather never puts it out.
    expect(FIRE_OUT.clear).toBeUndefined();
  });

  it('4. the same seed and moves bring the same results; with the switch off or absent nothing changes', () => {
    const days: QueueItem[][] = [[{ q: 'hunt', opts: { target: 'small' } }, 'wood@2', 'rest'], ['wood@2', 'water', 'rest'], ['traps', 'gather@2', 'rest'], [{ q: 'hunt', opts: { target: 'small' } }, 'wood@2'], ['wood@2', 'gather']];
    const play = (on: boolean | 'absent', moves: QueueItem[][] = days): Region1State => {
      const f: Record<string, boolean> = { ...ruleFeatures() };
      if (on === 'absent') delete f['banked-fire']; else f['banked-fire'] = on;
      let s = createRegion1({ world: { ...FULL_WORLD, features: f } }, undefined, { id: 'w-bank-same' });
      s = { ...s, site: s.site ?? 'tree', explore: survey(scout(createExploration(), 1), 1), tools: [...s.tools, { item: 'sling', grade: 'sound' }], stores: { ...s.stores, materials: 0, rawFood: 5, water: 5, firewood: 12 } };
      for (const q of moves) s = runDay(s, q).state;
      return s;
    };
    // Banking before each long trip once there's meat.
    const banking = days.map((d, i) => (i === 0 ? d : ['bankfire' as QueueItem, ...d]));
    expect(play(true, banking)).toEqual(play(true, banking));
    expect(play(true, banking).log.some(e => e.text === bankLine())).toBe(true);
    for (const on of [false, 'absent'] as const) {
      const s = play(on);
      expect(shown(s, 'bankfire')).toBe(false);
      expect(s.banked).toBeUndefined();
      expect(observe(s)).not.toMatch(/BANKED FIRE|CAMP FIRE/);
      // The journal's hash was taken on main before this change (the same moves, the switch not there yet).
      expect(seedOf(JSON.stringify(s.log))).toBe(2303865145);
    }
    // Absent, the whole state is main's too. With the lid, the walled larder and the hex world
    // (#1857, #1858, #1899) stripped out below, it is the very state #1865 pinned; at their
    // defaults the only difference is those keys in the run's features record, so the play is the same.
    expect(seedOf(JSON.stringify(play('absent')))).toBe(2803118298);
    const strip = (x: Region1State): Region1State => {
      const features = { ...x.config.world.features };
      delete features['cold-pit-lid']; delete features['walled-larder']; delete features['hex-world'];
      return { ...x, config: { ...x.config, world: { ...x.config.world, features } } };
    };
    expect(seedOf(JSON.stringify(strip(play('absent'))))).toBe(2518478687);
    // Off, Bank the fire in the moves is refused and nothing else moves: the stores and the meat are the same.
    const tried = play(false, banking);
    expect(tried.stores).toEqual(play(false).stores);
    expect(meatOf(tried)).toBe(meatOf(play(false)));
  });
});
