/**
 * Acceptance tests for #1689 and #1690 — actions you learn as you go (switch `action-visibility`).
 * One test per Given/When/Then, in the issues' order and then the owner's comment's:
 *
 * #1689 (one Explore action at the start; its sub-actions unlock as you level):
 *   1. New run            — given a new run with no matching talent, only Explore is offered among
 *                            the exploring actions (and Explore's default trip learns the land).
 *   2. Unlock by level    — given the Warden reaches the unlock level, the sub-action appears, with a journal line.
 *   3. Starting talent    — given a starting talent that covers a sub-action, it's offered from day one.
 *   4. API refuses        — given a locked sub-action asked for through the API, it's refused with a reason.
 *   5. Switch off         — given the switch off, the actions are as today.
 * #1690 (hide what you don't know; grey out what you can't do now):
 *   6. Skill not learned  — given an action whose skill isn't learned, it's not in the actions list
 *                            (the app's, the API's moves, or the AI's observation).
 *   7. Missing tool       — given a learned action with a missing tool, it's listed as unavailable with the reason "Needs …".
 *   8. Tool gained        — given the tool is gained, it becomes available.
 * #1690, the owner's comment (2026-10-12):
 *   9. Experiment         — given a hidden action and the right materials, experimenting long enough
 *                            reveals and teaches it, deterministically.
 *  10. Focus             — …or focusing on them steers experimenting towards it and gets there sooner.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, blockedReason, type Region1State } from './region1';
import { actionVisibility, visibilityOf, shown } from './action-visibility';
import { EXPLORE_UNLOCKS } from './action-unlocks';
import { EXPERIMENT_LEARN } from './experiment';
import { scouted } from './exploration';
import { FEATURES } from './features';
import { FULL_WORLD, type WorldConfig } from './world';
import { makeWarden } from '../artificer-app/controller';
import { startGame, apply, view } from '../artificer-play/session';
import { observe } from '../artificer-ai/observe';

/** Daylight, clear weather, no luck, accidents or encounters: what happens is the rules'. `absent`: a run from before the switch. */
const world = (on: boolean | 'absent'): WorldConfig => ({ ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear', encounters: false, ...(on === 'absent' ? {} : { features: { 'action-visibility': on } }) });

const EXPLORING = ['explore', 'scout', 'survey', 'lookout', 'track'] as const;
/** The exploring actions offered, in the order of the app's EXPLORE group. */
const offered = (s: Region1State, ids: readonly string[] = EXPLORING): string[] =>
  ids.filter(id => actionVisibility(s).some(v => v.id === id && v.status !== 'hidden'));

function warden(on: boolean | 'absent' = true, who: Parameters<typeof createRegion1>[2] = {}): Region1State {
  return createRegion1({ world: world(on) }, undefined, { id: 'w-visible', ...who });
}

describe('One Explore action at the start; its sub-actions unlock as you level (#1689)', () => {
  it('1. a new run with no matching talent offers only Explore among the exploring actions', () => {
    const s = warden();
    expect(offered(s)).toEqual(['explore']);
    for (const id of ['scout', 'survey', 'lookout', 'track'] as const) expect(visibilityOf(s, id).status).toBe('hidden');
    // The game's own start (a scout, #1398, Scouting at Novice) is a new run with no matching talent too.
    expect(offered(makeWarden({ id: 'w-visible-game' }).sim)).toEqual(['explore']);
    // Explore's default trip: walk out, look around, and come back knowing the near ring.
    const out = runAction(s, 'explore');
    expect(scouted(out.explore, 1)).toBe(true);
    expect(out.log.slice(s.log.length).map(l => l.text)).toContainEqual(expect.stringMatching(/Walked out and looked around/));
    // …and again, a known ring gets a little clearer, never past observed.
    const again = runAction({ ...out, hoursToday: 0 }, 'explore');
    expect(Object.values(again.explore.known[1]).reduce((a, b) => a + b, 0)).toBeGreaterThan(Object.values(out.explore.known[1]).reduce((a, b) => a + b, 0));
    expect(Math.max(...Object.values(again.explore.known[1]))).toBeLessThanOrEqual(2);
  });

  it('2. reaching the unlock level opens the sub-action, with a journal line', () => {
    // An hour short of Apprentice Scouting (20h): one Explore trip (4h) takes them there.
    const s = { ...warden(), skills: { scouting: 19 } };
    expect(visibilityOf(s, 'scout').status).toBe('hidden');
    const after = runAction(s, 'explore');
    expect(visibilityOf(after, 'scout').status).toBe('available');
    expect(visibilityOf(after, 'lookout').status).not.toBe('hidden');
    // Survey waits for Adept (60h).
    expect(visibilityOf(after, 'survey').status).toBe('hidden');
    const lines = after.log.slice(s.log.length).map(l => l.text);
    expect(lines).toContain(EXPLORE_UNLOCKS.find(u => u.action === 'scout')!.line);
    expect(lines).toContain(EXPLORE_UNLOCKS.find(u => u.action === 'lookout')!.line);
    // Once: the next trip doesn't say it again.
    const next = runAction({ ...after, hoursToday: 0 }, 'explore');
    expect(next.log.slice(after.log.length).map(l => l.text)).not.toContain(EXPLORE_UNLOCKS.find(u => u.action === 'scout')!.line);
  });

  it('3. a starting talent that covers a sub-action offers it from day one', () => {
    expect(offered(warden(true, { chosen: ['keenEye', 'hardy'] }))).toEqual(['explore', 'scout', 'survey', 'lookout']);
    expect(offered(warden(true, { chosen: ['hunter', 'hardy'] }))).toEqual(['explore', 'track']);
    // Through the game's own creation (makeWarden) too.
    expect(offered(makeWarden({ id: 'w-visible-keen', chosen: ['keenEye', 'tough'] }).sim)).toEqual(['explore', 'scout', 'survey', 'lookout']);
  });

  it('4. a locked sub-action asked for through the API is refused with a reason', () => {
    const g = startGame({ seed: 'visible-api' });
    const r = apply(g, { do: 'survey' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/don't know how to survey the land yet/);
    // In a plan as well, before anything runs.
    const open = { ...g, app: { ...g.app, sim: { ...g.app.sim, canPlan: true } } };
    const plan = apply(open, { plan: ['explore', 'track'] });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/don't know how to follow game/);
    // The sim refuses it too, if a queue holds it anyway: skipped, at no cost.
    const s = warden();
    const skipped = runAction(s, 'scout');
    expect(skipped.hoursToday).toBe(0);
    expect(skipped.log.at(-1)?.text).toMatch(/skipped — you don't know how to scout a whole ring yet/);
  });

  it('5. with the switch off (or a run from before it) the actions are as today', () => {
    for (const on of [false, 'absent'] as const) {
      const s = warden(on);
      // Explore and Experiment don't exist; every other action reads as blockedReason does, nothing hidden.
      for (const v of actionVisibility(s)) {
        // Make camp (#1732), Draw your map (#1754), Gather stones (#1816), the traps and hunting gear (#1821), Store the meat (#1823), Lid the cold pit (#1857) and Make a needle compass (#1868) have their own switches, off here too (a run from before them).
        if (v.id === 'explore' || v.id === 'experiment' || v.id === 'camp' || v.id === 'drawmap' || v.id === 'gatherstone' || v.id === 'traps' || v.id === 'sling' || v.id === 'bow' || v.id === 'hookline' || v.id === 'storemeat' || v.id === 'lidpit' || v.id === 'needlecompass') { expect(v.status).toBe('hidden'); continue; }
        expect(v.status).not.toBe('hidden');
        expect(v.reason).toBe(blockedReason(s, v.id, 1));
      }
      expect(offered(s)).toEqual(['scout', 'survey', 'lookout', 'track']);
      // Scouting plays exactly as it does without the switch at all, and Explore is refused.
      const scoutedHere = runAction(s, 'scout');
      const before = runAction({ ...s, config: { ...s.config, world: { ...s.config.world, features: undefined } } }, 'scout');
      expect({ ...scoutedHere, config: before.config }).toEqual(before);
      expect(runAction(s, 'explore').log.at(-1)?.text).toMatch(/skipped — explore isn't part of this game's rules/);
    }
    // The switch: a rules feature, on in a new game, off for a run from before it.
    expect(FEATURES.find(f => f.id === 'action-visibility')).toMatchObject({ kind: 'rules', default: true, absent: false, issue: 1690 });
  });
});

describe('Hide what you don\'t know; grey out what you can\'t do now (#1690)', () => {
  it('6. an action whose skill isn\'t learned is not in the actions list — the app\'s, the API\'s or the AI\'s', () => {
    const s = runAction(warden(), 'explore');
    // A snare isn't worked out yet: hidden, not greyed.
    expect(s.known).not.toContain('trap-snare');
    expect(visibilityOf(s, 'snare').status).toBe('hidden');
    expect(shown(s, 'snare')).toBe(false);
    // The AI's observation (and the API's view, which is it) doesn't list it; a known craft it lists.
    const text = observe(s);
    expect(text).not.toMatch(/^- snare /m);
    expect(text).not.toMatch(/^- survey /m);
    expect(text).toMatch(/^- knife /m);
    expect(text).not.toMatch(/Snare \(tension\)/);
    // The API's moves leave it out too.
    const g = startGame({ seed: 'visible-moves' });
    const moves = view(g).moves.map(m => JSON.stringify(m.move));
    expect(moves).toContain(JSON.stringify({ do: 'explore' }));
    expect(moves).not.toContain(JSON.stringify({ do: 'scout' }));
    expect(moves).not.toContain(JSON.stringify({ do: 'snare' }));
  });

  it('7. a learned action with a missing tool is listed as unavailable, with the reason "Needs …"', () => {
    // The crude shovel worked out, but there's no workbench to make it on: a roof is the first bench.
    const s: Region1State = { ...runAction(warden(), 'explore'), known: [...warden().known, 'crude-shovel'], stores: { ...warden().stores, materials: 4 } };
    const v = visibilityOf(s, 'shovel');
    expect(v.status).toBe('greyed');
    expect(v.reason).toMatch(/^needs a tier-1 bench/);
    // …and the AI sees it listed, BLOCKED with that reason.
    expect(observe(s)).toMatch(/^- shovel .*BLOCKED: needs a tier-1 bench/m);
    // Missing materials grey a known craft the same way.
    expect(visibilityOf({ ...s, stores: { ...s.stores, materials: 1 } }, 'knife')).toMatchObject({ status: 'greyed', reason: 'needs 2 materials (have 1)' });
  });

  it('8. once the tool is gained, the action becomes available', () => {
    const s: Region1State = { ...runAction(warden(), 'explore'), known: [...warden().known, 'crude-shovel'], stores: { ...warden().stores, materials: 4 } };
    expect(visibilityOf(s, 'shovel').status).toBe('greyed');
    // The roof up: the shelter is a tier-1 bench now.
    expect(visibilityOf({ ...s, site: 'cave', tier: 1 }, 'shovel')).toEqual({ id: 'shovel', status: 'available', reason: null });
  });
});

describe('Hidden actions stay discoverable through play (#1690, the owner\'s comment)', () => {
  it('9. with the right materials, experimenting long enough reveals and teaches a hidden action, deterministically', () => {
    // Cord and sticks to hand (materials), nothing else: the snare is the first thing they lead to.
    const start: Region1State = { ...runAction(warden(), 'explore'), hoursToday: 0, stores: { ...warden().stores, materials: 3 } };
    expect(visibilityOf(start, 'experiment').status).toBe('available');
    expect(visibilityOf(start, 'snare').status).toBe('hidden');
    let s = runAction(start, 'experiment');
    // A hint that names nothing; nothing spent but time.
    expect(s.log.at(-1)?.text).toMatch(/You think there's a way to make something of it, if you keep at it/);
    expect(s.log.at(-1)?.text).not.toMatch(/snare/i);
    expect(s.stores.materials).toBe(3);
    expect(s.experiments?.['trap-snare']).toBe(3);
    s = runAction({ ...s, hoursToday: 0 }, 'experiment');
    expect(visibilityOf(s, 'snare').status).toBe('hidden');
    s = runAction({ ...s, hoursToday: 0 }, 'experiment');
    // Three sessions (9h, EXPERIMENT_LEARN): worked out, and the snare is in the actions now.
    expect(EXPERIMENT_LEARN).toBe(9);
    expect(s.known).toContain('trap-snare');
    expect(s.log.map(l => l.text)).toContain('Worked out: Snare — trying things with cord and sticks, you found how it goes together.');
    expect(visibilityOf(s, 'snare').status).toBe('available');
    expect(s.experiments?.['trap-snare']).toBeUndefined();
    // The same sessions give the same state: no dice.
    const replay = [1, 2, 3].reduce(st => runAction({ ...st, hoursToday: 0 }, 'experiment'), start);
    expect(replay).toEqual({ ...s, hoursToday: replay.hoursToday });
    // With nothing to try anything with, an hour's turning over teaches nothing.
    const bare = runAction({ ...start, stores: { ...start.stores, materials: 0, hides: 0, stone: 0 } }, 'experiment');
    expect(bare.experiments).toBeUndefined();
    expect(bare.log.at(-1)?.text).toMatch(/nothing in it you don't already know how to use/);
  });

  it('10. focusing on a concept steers experimenting towards what it opens, and gets there sooner', () => {
    const start: Region1State = { ...runAction(warden(), 'explore'), hoursToday: 0, stores: { ...warden().stores, materials: 3 }, focus: { kind: 'concept', id: 'weaving' } };
    // Weaving opens the basket: two sessions with the mind on it, where the snare took three.
    let s = runAction(start, 'experiment');
    expect(s.experiments).toEqual({ basket: 6 });
    expect(s.log.at(-1)?.text).toMatch(/your mind on it|keep at it/);
    s = runAction({ ...s, hoursToday: 0 }, 'experiment');
    expect(s.known).toContain('basket');
    expect(s.known).not.toContain('trap-snare');
    expect(visibilityOf(s, 'basket').status).toBe('available');
    // Choosing a material to try with steers it the same way: a hide (with cord) leads to the hide parka first.
    const hide: Region1State = { ...start, focus: null, stores: { ...start.stores, hides: 2 } };
    expect(runAction(hide, { q: 'experiment', opts: { with: 'hides' } }).experiments).toEqual({ 'hide-parka': 6 });
    // And a focus on a skill speeds what levels open: deliberate practice at Scouting (#1238) opens scouting sooner.
    const plain = runAction({ ...warden(), skills: { scouting: 14 } }, 'explore');
    const focused = runAction({ ...warden(), skills: { scouting: 14 }, focus: { kind: 'skill', id: 'scouting' } }, 'explore');
    expect(visibilityOf(plain, 'scout').status).toBe('hidden');
    expect(visibilityOf(focused, 'scout').status).toBe('available');
  });
});
