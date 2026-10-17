/**
 * Acceptance tests for #1821 — traps first; active hunting needs a sling or a bow, fishing a hook
 * and line; a kill ends the hunt (switch `hunting-gear`). One test per Given/When/Then, in the
 * issue's order:
 *
 *   1. New run        — with the switch on and no sling or bow, Hunt is hidden with a reason naming
 *                        the sling, and Set traps is available once game has been seen.
 *   2. Overnight      — traps set where there's game bring a seeded small-game catch by morning
 *                        (sometimes none), the same for the same seed, and the game there thins.
 *   3. Sling, bow     — a sling opens Hunt (small game only); a bow opens deer too, with better odds
 *                        words than the sling.
 *   4. Hook and line  — without one, Fish is hidden with a reason naming it; with one, it works as today.
 *   5. Kill ends it   — a deer hunt whose kill comes 40% into the work ends there; the day has the
 *                        leftover hours back.
 *   6. Stowed catch   — small game killed early, with room in a comfortable load: the hunt goes on
 *                        to its planned hours, and the stowed catch is kept.
 *   7. Odds in words  — they rise with the game known there, the tool and Hunting skill, and never
 *                        show a number (en and sv).
 *   8. Switch off     — off or absent, hunting and fishing are as before and the same seed plays
 *                        the same run.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, endDay, ACTIONS, huntOddsOf, type Region1State, type QueueItem } from './region1';
import { visibilityOf, shown } from './action-visibility';
import { scout, survey, createExploration } from './exploration';
import { FULL_WORLD, type WorldConfig } from './world';
import { killMoment } from './stop-action';
import { huntScore, huntOdds, HUNT_ODDS, HUNT_ODDS_WORDS } from './hunting-gear';
import { seedOf } from './rng';
import { makeWarden } from '../artificer-app/controller';
import { yieldText } from '../artificer-app/camp-blocks';
import { observe } from '../artificer-ai/observe';
import { simLine } from '../artificer-app/sim-words';
import { makeT } from './i18n';

const svT = makeT('sv'), enT = makeT('en');

/** Daylight, clear weather, no accidents or encounters; luck as asked. `absent`: a run from before the switch. */
const world = (on: boolean | 'absent', luck = false): WorldConfig => ({
  ...FULL_WORLD, luck, accidents: false, darkness: false, weather: 'clear', encounters: false,
  features: { 'action-visibility': true, 'stop-action': true, ...(on === 'absent' ? {} : { 'hunting-gear': on }) },
});

/**
 * A Warden camped at the treeline who has seen the near ground: `seen` 'none' (nothing known),
 * 'suspected' (scouted: game about) or 'observed' (surveyed: game tracked, deer can be hunted).
 */
function warden(on: boolean | 'absent' = true, seen: 'none' | 'suspected' | 'observed' = 'suspected', id = 'w-hunt', luck = false): Region1State {
  const s = createRegion1({ world: world(on, luck) }, undefined, { id });
  const explore = seen === 'none' ? createExploration() : seen === 'suspected' ? scout(createExploration(), 1) : survey(scout(createExploration(), 1), 1);
  return { ...s, site: s.site ?? 'tree', explore, stores: { ...s.stores, materials: 10, rawFood: 5, water: 5, firewood: 5 } };
}

const withTool = (s: Region1State, item: string): Region1State => ({ ...s, tools: [...s.tools, { item, grade: 'sound' }] });

describe('Traps first; hunting and fishing need gear; a kill ends the hunt (#1821)', () => {
  it('1. with no sling or bow, Hunt is hidden (naming the sling) and Set traps is available once game has been seen', () => {
    const s = warden();
    expect(ACTIONS.traps.name).toBe('Set traps');
    const hunt = visibilityOf(s, 'hunt');
    expect(hunt.status).toBe('hidden');
    expect(hunt.reason).toMatch(/sling/);
    // Asked for anyway, hunting is refused as something you don't know how to do yet.
    const tried = runAction(s, 'hunt');
    expect(tried.stores.rawFood).toBe(s.stores.rawFood);
    expect(tried.log.at(-1)?.kind).toBe('skip');
    // Traps: open once game has been seen there; before that, greyed with why.
    expect(visibilityOf(s, 'traps').status).toBe('available');
    const blind = warden(true, 'none');
    expect(visibilityOf(blind, 'traps').status).toBe('greyed');
    expect(visibilityOf(blind, 'traps').reason).toMatch(/game/);
    // The game's own start: traps shown, hunting not; the reason reads in Swedish too.
    const game = makeWarden({ id: 'w-hunt-game' }).sim;
    expect(shown(game, 'traps')).toBe(true);
    expect(shown(game, 'hunt')).toBe(false);
    expect(simLine(hunt.reason!, svT)).toMatch(/slunga/i);
    expect(svT('act.traps')).toBe('Gillra fällor');
  });

  it('2. traps set where there is game catch small game overnight by a seeded chance, and thin the game', () => {
    const catches: number[] = [];
    for (let i = 0; i < 24; i++) {
      const s = warden(true, 'suspected', `w-trap-${i}`, true);
      const set = runAction(s, 'traps');
      expect(set.stores.materials).toBe(s.stores.materials - 1);
      expect(set.traps).toEqual([1]);
      expect(set.explore.supply[1].game).toBeLessThan(s.explore.supply[1].game);
      // The night with the traps against the same night without them: the difference is the catch.
      const morning = endDay(set);
      const without = endDay({ ...set, traps: undefined });
      const caught = morning.stores.rawFood - without.stores.rawFood;
      catches.push(caught);
      // The journal says it, and in Swedish too.
      for (const line of [set.log.at(-1)!.text, morning.log.find(e => /By morning your traps/.test(e.text))!.text]) expect(simLine(line, svT)).not.toBe(line);
      expect(morning.traps).toBeUndefined();
      // The game patch there is thinner by morning than before the traps were set.
      expect(morning.explore.supply[1].game).toBeLessThan(endDay(s).explore.supply[1].game);
      // The same seed, the same night.
      expect(endDay(runAction(s, 'traps')).stores.rawFood).toBe(morning.stores.rawFood);
    }
    expect(catches.some(n => n > 0)).toBe(true);
    expect(catches.some(n => n === 0)).toBe(true);
    // A catch is small game: a couple of raw food near camp.
    expect(Math.max(...catches)).toBeLessThanOrEqual(3);
  });

  it('3. a sling opens small-game hunting; a bow opens deer too, with better odds words', () => {
    const sling = withTool(warden(true, 'observed'), 'sling');
    expect(visibilityOf(sling, 'hunt').status).toBe('available');
    // Small game by default; deer refused without a bow.
    const small = runAction(sling, 'hunt');
    expect(small.stores.rawFood).toBeGreaterThan(sling.stores.rawFood);
    expect(small.stores.hides).toBe(sling.stores.hides);
    expect(visibilityOf(sling, 'hunt', 1, { target: 'deer' }).status).toBe('greyed');
    expect(visibilityOf(sling, 'hunt', 1, { target: 'deer' }).reason).toMatch(/bow/);
    const deerOpt = ACTIONS.hunt.options!(sling, {})[0].choices.find(c => c.value === 'deer')!;
    expect(deerOpt.blocked).toMatch(/bow/);
    // The bow itself is hidden until the Warden knows hunting well enough.
    expect(visibilityOf(sling, 'bow').status).toBe('hidden');
    expect(visibilityOf({ ...sling, skills: { ...sling.skills, hunting: 25 } }, 'bow').status).toBe('available');
    // With a bow: deer, and better odds than the sling has on the same ground.
    const bow = withTool(warden(true, 'observed'), 'bow');
    const deer = runAction(bow, { q: 'hunt', opts: { target: 'deer' } });
    expect(deer.stores.hides).toBe(bow.stores.hides + 1);
    expect(HUNT_ODDS.indexOf(huntOddsOf(bow, 'hunt', 1)!)).toBeGreaterThan(HUNT_ODDS.indexOf(huntOddsOf(sling, 'hunt', 1)!));
  });

  it('4. without a hook and line Fish is hidden, naming it; once made, fishing works as today', () => {
    const s = warden(true, 'observed');
    const fish = visibilityOf(s, 'fish');
    expect(fish.status).toBe('hidden');
    expect(fish.reason).toMatch(/hook and line/);
    expect(simLine(fish.reason!, svT)).toMatch(/krok och lina/i);
    expect(visibilityOf(s, 'hookline').status).toBe('available');
    const hooked = withTool(s, 'hook-line');
    expect(visibilityOf(hooked, 'fish').status).toBe('available');
    // As today: the same catch as a run from before the switch.
    const today = runAction(warden('absent', 'observed'), 'fish');
    const now = runAction(hooked, 'fish');
    expect(now.stores.rawFood - hooked.stores.rawFood).toBe(today.stores.rawFood - warden('absent', 'observed').stores.rawFood);
    expect(now.stores.rawFood).toBeGreaterThan(hooked.stores.rawFood);
  });

  it('5. a deer hunt whose kill comes 40% into the work ends there; the day has the leftover hours back', () => {
    // Find a Warden whose first hunt of day 1 has its kill about 40% of the way into the work.
    let id = '';
    for (let i = 0; i < 500 && !id; i++) {
      const k = killMoment(seedOf(`w-kill-${i}`), 1, 0);
      if (k > 0.35 && k < 0.45) id = `w-kill-${i}`;
    }
    expect(id).not.toBe('');
    const s = withTool(warden(true, 'observed', id), 'bow');
    const at = killMoment(seedOf(id), s.day, s.hoursToday);
    const after = runAction(s, { q: 'hunt', opts: { target: 'deer' } });
    // The whole deer, and the hide…
    expect(after.stores.rawFood).toBeGreaterThan(s.stores.rawFood);
    expect(after.stores.hides).toBe(s.stores.hides + 1);
    // …in 40% of the hunt's five hours: the rest of the day is free.
    expect(after.hoursToday).toBeCloseTo(s.hoursToday + 5 * at, 5);
    expect(after.hoursToday).toBeLessThan(s.hoursToday + 5);
    const ended = after.log.find(e => /headed home with it/.test(e.text))!.text;
    expect(simLine(ended, svT)).not.toBe(ended);
    // And the day goes on: what comes after the hunt starts in those hours.
    const day = runDay(s, [{ q: 'hunt', opts: { target: 'deer' } }, 'water']);
    expect(day.state.log.some(e => /Fetched/.test(e.text))).toBe(true);
  });

  it('6. small game killed early with room in a comfortable load: the hunt goes on to its planned hours, the catch kept', () => {
    let id = '';
    for (let i = 0; i < 500 && !id; i++) if (killMoment(seedOf(`w-stow-${i}`), 1, 0) < 0.3) id = `w-stow-${i}`;
    const s = withTool(withTool(warden(true, 'observed', id), 'sling'), 'backpack');
    const after = runAction(s, { q: 'hunt', opts: { target: 'small' } });
    // The planned three hours of small-game hunting, all of them.
    expect(after.hoursToday).toBeCloseTo(s.hoursToday + 3, 5);
    // The catch was stowed and kept, and the journal says the hunt went on.
    const first = Number(after.log.find(e => /Took small game/.test(e.text))!.text.match(/(\d+) raw food/)![1]);
    expect(first).toBeGreaterThan(0);
    expect(after.stores.rawFood - s.stores.rawFood).toBeGreaterThanOrEqual(first);
    const on = after.log.find(e => /hunted on/.test(e.text))!.text;
    expect(simLine(on, svT)).not.toBe(on);
  });

  it('7. the odds words rise with the game known, the tool and Hunting skill, and never show a number', () => {
    const rank = (lv: number, tool: 'traps' | 'sling' | 'bow', skill: number): number => HUNT_ODDS.indexOf(huntOdds(huntScore(lv, tool, skill)));
    expect(rank(1, 'sling', 0)).toBeLessThanOrEqual(rank(2, 'sling', 0));
    expect(rank(0, 'sling', 0)).toBeLessThan(rank(3, 'sling', 0));
    expect(rank(1, 'sling', 0)).toBeLessThan(rank(1, 'bow', 0));
    expect(rank(1, 'traps', 0)).toBeLessThan(rank(1, 'traps', 4));
    expect(huntOdds(huntScore(0, 'traps', 0))).toBe('long');
    expect(huntOdds(huntScore(3, 'bow', 4))).toBe('good');
    // The cards and the AI's observation carry them in words.
    const s = withTool(warden(true, 'observed'), 'sling');
    for (const t of [enT, svT]) {
      for (const id of ['hunt', 'traps'] as const) {
        const card = yieldText(id, s, 1, t);
        const word = t(`odds.hunt.${huntOddsOf(s, id, 1)!}`);
        expect(card).toContain(word);
        expect(word).not.toMatch(/\d/);
      }
    }
    expect(svT('odds.hunt.good')).toBe('goda chanser');
    expect(svT('odds.hunt.fair')).toBe('rimliga chanser');
    expect(svT('odds.hunt.long')).toBe('ett långskott');
    const text = observe(s);
    expect(text).toMatch(new RegExp(`^- hunt .*${HUNT_ODDS_WORDS[huntOddsOf(s, 'hunt', 1)!]}`, 'm'));
    expect(text).toMatch(new RegExp(`^- traps .*${HUNT_ODDS_WORDS[huntOddsOf(s, 'traps', 1)!]}`, 'm'));
  });

  it('8. off or absent, hunting and fishing are as before, and the same seed plays the same run', () => {
    for (const on of [false, 'absent'] as const) {
      const s = warden(on, 'observed', 'w-kill-0');
      expect(shown(s, 'hunt')).toBe(true);
      expect(shown(s, 'fish')).toBe(true);
      for (const id of ['traps', 'sling', 'bow', 'hookline'] as const) expect(shown(s, id)).toBe(false);
      // A deer hunt with bare hands takes its full five hours, kill or no kill.
      const hunted = runAction(s, 'hunt');
      expect(hunted.hoursToday).toBe(s.hoursToday + 5);
      expect(hunted.stores.hides).toBe(s.stores.hides + 1);
      // Hunt cards show no odds words.
      expect(yieldText('hunt', s, 1, enT)).not.toMatch(/odds|long shot/);
    }
    // Off and absent play three seeded days (weather, luck) exactly as the sim did before #1821:
    // the journal's hash was taken on main before this change.
    const days: QueueItem[][] = [['hunt', 'water', 'gather'], ['fish', { q: 'hunt', opts: { target: 'small' } }, 'wood'], ['gather', 'hunt']];
    const play = (on: false | 'absent'): number => {
      let s = createRegion1({ world: { ...world(on, true), weather: 'seeded' } }, undefined, { id: 'w-same' });
      s = { ...s, site: s.site ?? 'tree', explore: survey(scout(createExploration(), 1), 1), stores: { ...s.stores, materials: 10, rawFood: 5, water: 5, firewood: 5 } };
      for (const q of days) s = runDay(s, q).state;
      return seedOf(JSON.stringify(s.log));
    };
    expect(play(false)).toBe(1186264256);
    expect(play('absent')).toBe(1186264256);
  });
});
