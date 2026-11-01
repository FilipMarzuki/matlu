/**
 * Acceptance tests for #2018: one exploring action that grows (switch `explore-grows`). Scout did
 * what Explore's first trip into a distance did, so with the switch on it isn't an action of its own:
 * Explore is, and what it's called and what it can do grow with the Scouting skill — Look around
 * (close by, no heading out), Explore (Apprentice: the farther land and the eight ways), Scout (Adept:
 * one look round a distance makes it observed, Survey's work). Keen Eye counts a level up. One test
 * per scenario of the issue, then the names and what the AI is told.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, ACTIONS, blockedReason, skillLockOf, exploreTierOf, bonusOf, queueHours, type QueueItem, type Region1State } from './region1';
import { MAP_TIME } from './kit';
import { talentDrain } from './talents';
import { tripRing } from '../artificer-app/land-news';
import { exploreRing } from '../artificer-app/land-view';
import { shown } from './action-visibility';
import { EXPLORE_GROWS, EXPLORE_UNLOCKS, LOOK_LOCK, TIER_LEVELS, TIER_LINE, exploreTier } from './action-unlocks';
import { DOMAINS, domainsOf, level, scout, createExploration, type Domain } from './exploration';
import { skillLevel, type SkillPractice } from './skills';
import { FULL_WORLD, type WorldConfig } from './world';
import { ruleFeatures } from './features';
import type { TalentId } from './talents';
import { observe } from '../artificer-ai/observe';
import { actionName, actionShort, simLine } from '../artificer-app/sim-words';
import { compassBlock } from '../artificer-app/camp-blocks';
import { makeT } from './i18n';

const en = makeT('en');
const sv = makeT('sv');

/** The game's default rules (the switch on unless `on` says otherwise; 'absent' for a run from before it), with no luck, accidents, dark or encounters. */
const world = (on: boolean | 'absent' = true): WorldConfig => {
  const features: Record<string, boolean> = { ...ruleFeatures() };
  if (on === 'absent') delete features[EXPLORE_GROWS]; else features[EXPLORE_GROWS] = on;
  return { ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear', encounters: false, features };
};

/** A Warden with this much Scouting practice (hours; a new Warden has 5, Novice), and these talents chosen. */
function warden(o: { on?: boolean | 'absent'; scouting?: number; chosen?: TalentId[] } = {}): Region1State {
  const s = createRegion1({ world: world(o.on ?? true) }, undefined, { id: 'w-grows', chosen: o.chosen ?? [] });
  const skills: SkillPractice = o.scouting === undefined ? s.skills : { ...s.skills, scouting: o.scouting };
  return { ...s, skills };
}

/** The same Warden with home ground scouted, so the far ring is in reach. */
const nearKnown = (s: Region1State): Region1State => ({ ...s, explore: scout(createExploration(), 1) });

const wayChoices = (s: Region1State) => (ACTIONS.explore.options?.(s, {}) ?? []).find(g => g.key === 'way')?.choices ?? [];

describe('One exploring action that grows (#2018)', () => {
  it('1. Given a new Warden, Then it is Look around: close by is allowed, the farther distances and the eight ways are refused', () => {
    const s = nearKnown(warden());
    expect(skillLevel(s.skills, 'scouting')).toBeLessThan(TIER_LEVELS.explore);
    expect(exploreTierOf(s)).toBe('look');
    expect(blockedReason(s, 'explore', 1)).toBeNull();
    expect(blockedReason(s, 'explore', 2)).toBe(LOOK_LOCK);
    expect(blockedReason(s, 'explore', 1, { way: 'n' })).toBe(LOOK_LOCK);
    const ways = wayChoices(s);
    expect(ways.find(c => c.value === 'here')?.blocked).toBeNull();
    expect(ways.filter(c => c.value !== 'here' && c.value !== 'camp').every(c => c.blocked === LOOK_LOCK)).toBe(true);
    // Asked for anyway, the far trip is refused at no cost.
    const tried = runAction(s, 'explore@2');
    expect(tried.hoursToday).toBe(0);
  });

  it('2. Given Scouting at Apprentice, or Novice with Keen Eye, Then it is Explore: the farther distances and the ways are open', () => {
    for (const s of [nearKnown(warden({ scouting: 20 })), nearKnown(warden({ chosen: ['keenEye', 'tough'] }))]) {
      expect(exploreTierOf(s)).toBe('explore');
      expect(blockedReason(s, 'explore', 2)).toBeNull();
      expect(blockedReason(s, 'explore', 1, { way: 'n' })).not.toBe(LOOK_LOCK);
      expect(wayChoices(s).some(c => c.blocked === LOOK_LOCK)).toBe(false);
    }
  });

  it('3. Given Scouting at Adept, or Apprentice with Keen Eye, When it looks around a distance not yet known, Then everything there is observed after one 4-hour trip', () => {
    const atLevel = (s: Region1State, d: Domain): number => level(s.explore, 1, d);
    for (const s of [warden({ scouting: 60 }), warden({ scouting: 20, chosen: ['keenEye', 'tough'] })]) {
      expect(exploreTierOf(s)).toBe('scout');
      expect(domainsOf(1).every(d => atLevel(s, d) === 0)).toBe(true);
      const n = runAction(s, 'explore');
      expect(domainsOf(1).every(d => atLevel(n, d) >= 2)).toBe(true);
      expect(n.hoursToday).toBeCloseTo(queueHours('explore', s));
      expect(n.hoursToday).toBeLessThanOrEqual(ACTIONS.explore.hours);
      expect(n.log.some(l => /^Scouted the land — you know now what's there, all of it\.$/.test(l.text))).toBe(true);
    }
    // At Explore the same trip only suspects what's there.
    const explored = runAction(warden({ scouting: 20 }), 'explore');
    expect(domainsOf(1).every(d => level(explored.explore, 1, d) === 1)).toBe(true);
  });

  it('4. Given the switch on, Then Scout and Survey are refused as not part of the rules; Climb & look out and Track unlock as before', () => {
    const s = nearKnown(warden({ scouting: 60, chosen: ['hunter', 'tough'] }));
    for (const id of ['scout', 'survey'] as const) {
      expect(skillLockOf(s, id)).toBe(`${id} isn't part of this game's rules`);
      expect(shown(s, id)).toBe(false);
      expect(runAction(s, id).hoursToday).toBe(0);
    }
    expect(shown(s, 'lookout')).toBe(true);
    expect(shown(s, 'track')).toBe(true);
    // Below Apprentice, Climb & look out waits as it did.
    expect(shown(warden(), 'lookout')).toBe(false);
  });

  it('5. Given a trip that takes Scouting to the next tier, Then the journal says so once, and Scout and Survey\'s own unlock lines never come', () => {
    const s = warden({ scouting: 19 });
    expect(exploreTier(s)).toBe('look');
    const once = runAction(s, 'explore');
    expect(exploreTierOf(once)).toBe('explore');
    expect(once.log.filter(l => l.text === TIER_LINE.explore)).toHaveLength(1);
    const again = runAction({ ...once, hoursToday: 0 }, 'explore');
    expect(again.log.filter(l => l.text === TIER_LINE.explore)).toHaveLength(1);
    const folded = EXPLORE_UNLOCKS.filter(u => u.action === 'scout' || u.action === 'survey').map(u => u.line);
    expect(once.log.some(l => folded.includes(l.text))).toBe(false);
    // And on to Scout.
    const up = runAction({ ...warden({ scouting: 59 }), explore: scout(createExploration(), 1) }, 'explore');
    expect(up.log.filter(l => l.text === TIER_LINE.scout)).toHaveLength(1);
  });

  it('6. Given the switch off, or a run from before it, Then Explore, Scout and Survey are as before', () => {
    for (const on of [false, 'absent'] as const) {
      const s = nearKnown(warden({ on, scouting: 60 }));
      expect(exploreTierOf(s)).toBe('explore');
      expect(shown(s, 'scout')).toBe(true);
      expect(shown(s, 'survey')).toBe(true);
      const fresh = nearKnown(warden({ on }));
      expect(blockedReason(fresh, 'explore', 2)).toBeNull();
      expect(wayChoices(fresh).some(c => c.blocked === LOOK_LOCK)).toBe(false);
      // Explore into a ring you don't know is still only a scout's look, however practised.
      const n = runAction(warden({ on, scouting: 60 }), 'explore');
      expect(DOMAINS.filter(d => domainsOf(1).includes(d)).every(d => level(n.explore, 1, d) === 1)).toBe(true);
    }
  });

  it('is the same run for the same seed and moves', () => {
    const play = (): Region1State => (['explore', 'explore', 'explore', 'explore', 'explore'] as QueueItem[]).reduce((s, q) => runAction({ ...s, hoursToday: 0 }, q), warden({ scouting: 10 }));
    expect(play()).toEqual(play());
  });
});

describe('What helped Scout and Survey helps it (#2018)', () => {
  it('takes Scout\'s bonuses with the switch on: the map & compass\'s quicker trip, and Keen Eye\'s lighter one; not with it off', () => {
    expect(bonusOf(warden(), 'explore')).toBe('scout');
    expect(bonusOf(warden({ on: false }), 'explore')).toBe('explore');
    expect(bonusOf(warden(), 'wood')).toBe('wood');
    const packed = (on: boolean) => createRegion1({ world: world(on) }, undefined, { id: 'w-grows', chosen: [], pack: ['map-compass'] });
    expect(queueHours('explore', packed(true))).toBeCloseTo(ACTIONS.explore.hours * MAP_TIME);
    expect(queueHours('explore', packed(false))).toBeCloseTo(ACTIONS.explore.hours);
    const keen = warden({ chosen: ['keenEye', 'tough'] });
    expect(talentDrain(keen.character.talents, bonusOf(keen, 'explore')).vigor).toBeLessThan(talentDrain(keen.character.talents, 'explore').vigor);
  });
});

describe('The page and the LAND tab (#2018)', () => {
  it('a Scout-tier trip is a land trip, so LAND marks what it found', () => {
    expect(tripRing("Scouted the land — you know now what's there, all of it.")).toBe(1);
    expect(tripRing("Scouted the land half a day out — you know now what's there, all of it.")).toBe(2);
  });

  it('LAND\'s button stays close by while it\'s Look around, even with close by fully known', () => {
    const known = { ...warden(), explore: scout(scout(createExploration(), 1), 1) };
    const sharp = { ...known, explore: { ...known.explore, known: { ...known.explore.known, 1: Object.fromEntries(domainsOf(1).map(d => [d, 2])) as typeof known.explore.known[1] } } };
    expect(exploreRing(sharp)).toBe(1);
    expect(exploreRing({ ...sharp, skills: { ...sharp.skills, scouting: 20 } })).toBe(2);
  });
});

describe('Its names, and what an AI player is told (#2018)', () => {
  it('the page says each tier\'s name, en and sv, full and short; without the run, Explore', () => {
    const names = (s: Region1State) => [actionName('explore', en, s), actionName('explore', sv, s), actionShort('explore', en, s), actionShort('explore', sv, s)];
    expect(names(warden())).toEqual(['Look around', 'Se dig omkring', 'Look', 'Se dig om']);
    expect(names(warden({ scouting: 20 }))).toEqual(['Explore', 'Utforska', 'Explore', 'Utforska']);
    expect(names(warden({ scouting: 60 }))).toEqual(['Scout', 'Spana', 'Scout', 'Spana']);
    expect(names(warden({ on: false }))).toEqual(['Explore', 'Utforska', 'Explore', 'Utforska']);
    expect(actionName('explore', en)).toBe('Explore');
  });

  it('the chooser\'s compass greys the eight ways while it\'s Look around, saying why, en and sv; open at Explore', () => {
    const look = compassBlock(warden(), 'here', en);
    expect(look.match(/class="cpb locked"/g)).toHaveLength(8);
    expect(look).toContain('<b>Only Look around for now</b> you look around close by for now');
    expect(compassBlock(warden(), 'here', sv)).toContain('<b>Bara Se dig omkring än så länge</b> du ser dig omkring i närheten än så länge');
    // A clear day keeps a heading by the sun (#1868), so at Explore nothing is greyed.
    expect(compassBlock(warden({ scouting: 20 }), 'here', en)).not.toContain('locked');
  });

  it('the journal\'s new lines read back in Swedish', () => {
    expect(simLine(TIER_LINE.explore, sv)).toMatch(/^Du har sett dig omkring så mycket/);
    expect(simLine(TIER_LINE.scout, sv)).toMatch(/^Du läser landet väl nu/);
    expect(simLine("Scouted the land — you know now what's there, all of it.", sv)).toBe('Spanade över marken — nu vet du vad som finns där, allt.');
    expect(simLine(`Explore in the far ring: skipped — ${LOOK_LOCK}.`, sv)).not.toMatch(/close by/);
  });

  it('an AI player is told what the one exploring action is now, and nothing of it with the switch off', () => {
    expect(observe(warden())).toMatch(/GROWING: "explore" is the one exploring action .* Now: Look around: close by only/);
    expect(observe(warden({ scouting: 60 }))).toMatch(/Now: Scout:/);
    expect(observe(warden({ on: false }))).not.toMatch(/GROWING:/);
  });
});
