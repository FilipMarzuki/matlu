/**
 * Acceptance tests for #1361 — fight, flight, freeze or fawn: when panic takes over, fine
 * judgement goes, instinct can override your choice, adrenaline surges, and then the crash.
 * One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, chooseOption, runAction, endDay, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FULL_WORLD } from './world';
import { encounterById, optionsFor, chanceOf, unmet, type PendingEncounter } from './encounters';
import { overrideChance, FREEZE_HOURS, CRASH_VIGOR, CRASH_CLARITY } from './panic';
import { createExploration, scout } from './exploration';
import { seedOf, streamFor } from './rng';
import { GRADES } from './crafting';

const fox = encounterById('fox-at-the-treeline')!;
const ledge = encounterById('crumbling-ledge')!;
type State = NonNullable<PendingEncounter['state']>;

/** A Warden facing `id`, in `state`, `margin` past holding. */
function facing(id: string, state: State, margin = state === 'panicked' ? 2 : state === 'shaken' ? 1 : 0, who = 'w-panic', extra: Partial<Region1State> = {}): Region1State {
  const s = createRegion1({ world: { ...FULL_WORLD, encounters: true } }, undefined, { id: who });
  return { ...s, skills: { scouting: 20 }, hoursToday: 4, pending: { id, day: 1, hour: 10, ring: 2, action: 'scout', state, margin }, encounterDay: 1, ...extra };
}
/** Whether instinct takes over for this Warden at this margin (the seeded roll). */
const overrides = (who: string, id: string, margin: number): boolean => streamFor(seedOf(who), 1, `panic:${id}`)() < overrideChance(margin);
/** A Warden whose roll does (or doesn't) override at this margin. */
const whoseRoll = (id: string, margin: number, takes: boolean): string => {
  for (let i = 0; i < 200; i++) if (overrides(`w-roll-${i}`, id, margin) === takes) return `w-roll-${i}`;
  throw new Error('no such Warden');
};
const withQuirk = (s: Region1State, quirk: string): Region1State => ({ ...s, character: { ...s.character, quirks: [{ id: quirk, known: false }] } });

describe('Fight, flight, freeze or fawn (#1361)', () => {
  // 1. Panicked: careful options unavailable, "you can't think straight".
  it('closes the careful options when panicked', () => {
    const goAround = (s: Region1State) => optionsFor(s, ledge).find(o => o.option.id === 'go-around')!;
    expect(goAround(facing(ledge.id, 'panicked')).unmet).toBe("you can't think straight");
    expect(goAround(facing(ledge.id, 'shaken')).unmet).toBeNull();
    // Choosing it anyway is refused.
    const tried = chooseOption(facing(ledge.id, 'panicked'), 'go-around');
    expect(tried.pending).not.toBeNull();
    expect(tried.log.at(-1)!.text).toBe("Go the long way round to it: skipped — you can't think straight.");
  });

  // 2. Panicked, margin 2, the roll under 0.35, a runner: choosing chase takes the flight option.
  it('lets instinct override the choice — a runner runs', () => {
    expect(overrideChance(2)).toBeCloseTo(0.35);
    expect(overrideChance(3)).toBeCloseTo(0.7);
    const who = whoseRoll(fox.id, 2, true);
    const after = chooseOption(facing(fox.id, 'panicked', 2, who), 'chase');
    const lines = after.log.map(l => l.text);
    expect(lines).toContain('You meant to chase it for the hare. Your legs ran.');
    expect(lines.some(l => l.startsWith('Back away slowly: '))).toBe(true);
    expect(lines.some(l => l.startsWith('Chase it for the hare: '))).toBe(false);
    expect(after.pending).toBeNull();
    // A roll that doesn't take over lets the choice stand.
    const steady = chooseOption(facing(fox.id, 'panicked', 2, whoseRoll(fox.id, 2, false)), 'chase');
    expect(steady.log.some(l => l.text.startsWith('Chase it for the hare: '))).toBe(true);
    // Instinct reaching for what you chose anyway is no override at all.
    const ran = chooseOption(facing(fox.id, 'panicked', 2, who), 'back-away');
    expect(ran.log.some(l => l.text.startsWith('You meant to'))).toBe(false);
  });

  // 3. An override to freeze: 2 hours pass, and the template's freeze outcome applies.
  it('freezes a freezer: hours lost, and the danger decides', () => {
    const who = whoseRoll(ledge.id, 3, true);
    const s = withQuirk(facing(ledge.id, 'panicked', 3, who), 'freezer');
    const after = chooseOption(s, 'climb-down');
    expect(after.log.map(l => l.text)).toContain('You meant to climb straight down. You couldn\'t move.');
    expect(after.log.some(l => l.text === ledge.freeze.text)).toBe(true);
    expect(after.hoursToday).toBe(s.hoursToday + FREEZE_HOURS);
    // Nothing of the climb happened: no pack, no fall.
    expect(after.stores.materials).toBe(s.stores.materials);
    // A fawner with nothing to placate freezes too.
    const fawn = chooseOption(withQuirk(facing(ledge.id, 'panicked', 3, who), 'appeaser'), 'climb-down');
    expect(fawn.log.some(l => l.text === ledge.freeze.text)).toBe(true);
  });

  // 4. Shaken, an AGI option: odds computed with AGI +2.
  it('gives a shaken body adrenaline: AGI and STR count 2 higher', () => {
    const chase = fox.options.find(o => o.id === 'chase')!;
    const shaken = facing(fox.id, 'shaken');
    const calmFaster = facing(fox.id, 'calm', 0, 'w-panic', { character: { ...shaken.character, stats: { ...shaken.character.stats, agi: shaken.character.stats.agi + 2 } } });
    expect(chanceOf(shaken, chase)).toBeCloseTo(chanceOf(calmFaster, chase));
    expect(chanceOf(shaken, chase)).toBeGreaterThan(chanceOf(facing(fox.id, 'calm'), chase));
  });

  // 5. Any panic: Vigor −10, Clarity −10; crafts a grade worse for the day; a poorer night.
  it('crashes after a panic: wrung out, shaking hands, a poor night', () => {
    const plain = facing(fox.id, 'panicked');
    const s = { ...plain, character: { ...plain.character, quirks: [{ id: 'runner', known: false }] } }; // no stoic temperament to soften it
    const after = chooseOption(s, 'back-away'); // a sure option with no costs of its own
    expect(after.vitals.vigor.current).toBe(s.vitals.vigor.current - CRASH_VIGOR);
    expect(after.vitals.clarity.current).toBe(s.vitals.clarity.current - CRASH_CLARITY);
    expect(after.today.shaking).toBe(true);
    expect(after.log.at(-1)!.text).toMatch(/hands won't stop shaking/);
    // Shaking hands: the same craft comes out a grade worse.
    const bench = (shaking: boolean): Region1State => ({
      ...createRegion1({}, undefined, { id: 'w-hands' }), explore: scout(createExploration(), 1), weatherToday: 'clear',
      stores: { ...createRegion1().stores, materials: 6 }, today: { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false, shaking },
    });
    const grade = (s2: Region1State) => runAction(s2, 'coldGear').tools.find(t => t.item === 'cold-gear')?.grade;
    const steady = grade(bench(false))!, shaky = grade(bench(true));
    expect(steady).toBeDefined();
    // One grade worse, never below crude.
    expect(GRADES.indexOf(shaky!)).toBe(Math.max(0, GRADES.indexOf(steady) - 1));
    // A poorer night: less Vigor comes back.
    const tired = (shaking: boolean) => endDay({ ...bench(shaking), vitals: createVitals({ vigor: 30 }) }).vitals.vigor.current;
    expect(tired(true)).toBeLessThan(tired(false));
  });

  // 6. Calm: no override, no tunnel vision, no crash.
  it('leaves a calm Warden alone', () => {
    const who = whoseRoll(fox.id, 3, true); // a roll that would override if it counted
    const s = facing(fox.id, 'calm', 0, who);
    const after = chooseOption(s, 'chase');
    expect(after.log.some(l => l.text.startsWith('You meant to'))).toBe(false);
    expect(after.log.some(l => l.text.startsWith('Chase it for the hare: '))).toBe(true);
    expect(after.today.shaking).toBeUndefined();
    expect(after.log.some(l => /won't stop shaking/.test(l.text))).toBe(false);
    expect(unmet(facing(ledge.id, 'calm'), ledge.options.find(o => o.id === 'go-around')!)).toBeNull();
    const chase = fox.options.find(o => o.id === 'chase')!;
    expect(chanceOf(s, chase)).toBe(chanceOf({ ...s, pending: null }, chase));
  });
});
