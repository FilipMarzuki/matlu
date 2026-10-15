/**
 * Acceptance tests for #1732 — making camp is an action like any other, camp sites are real places
 * on the run's land map that you've explored, and what you know about each one comes from your
 * Intelligence, skills and talents (switch `camp-as-action`). One test per Given/When/Then, in the
 * issue's order, then the owner's added ones (the comment of 2026-10-15):
 *
 *   1. A queueable action — "Make camp" is in the action list, with hours, and queues like the others.
 *   2. New run             — the only known site is where the run starts; once camp is made there,
 *                            the action is greyed with its reason ("explore first").
 *   3. Exploring finds     — a ring explored until a cave or riverbank square is observed offers it,
 *                            with its real bearing and walking time.
 *   4. Real places         — every offered site is a square on the run's land map, of the right kind.
 *   5. Site rules          — the riverbank has water at hand; the hilltop is the most exposed.
 *   6. Moving camp         — the walk and the setting up are spent, and camp is there.
 *   7. Low reading         — low Intelligence, no camp skill: vague, no exact numbers, no hidden risk.
 *   8. High reading        — high Intelligence and skill, or the matching talent: sharp, risk included.
 *   9. Same reading        — the same Warden and site read the same twice, and after a reload.
 *  10. Camped there        — a night camped there shows its true traits from then on.
 *  11. Skill grows         — a skill rising past a band improves the reading.
 *  12. The AI and the API  — the same action and the same sites, in English.
 *  13. Switch off / absent — sites work exactly as today.
 *  14. Same game           — the same seed and moves give the same run.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, chooseSite, blockedReason, skillLockOf, queueHours, ACTIONS, SITES, type Region1State, type QueueItem } from './region1';
import { createExploration, survey, type Exploration } from './exploration';
import { FULL_WORLD, type WorldConfig } from './world';
import { reachOfRun } from './descriptive-map';
import { shown } from './action-visibility';
import { LEVEL_HOURS } from './skills';
import {
  CAMP_AS_ACTION, CAMP_SETUP_HOURS, SPOT_BIOMES, knownSpots, spotTraits, siteKnowledge, readingBand, campSpotOf,
  type CampSpot,
} from './camp-sites';
import { observe } from '../artificer-ai/observe';
import { startGame, view, apply as applyMove } from '../artificer-play/session';
import { serialize, deserialize, makeWarden } from '../artificer-app/controller';

/** Daylight, clear weather, no luck, accidents or encounters: what happens is the rules'. */
const world = (on: boolean | 'absent'): WorldConfig => ({ ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear', encounters: false, ...(on === 'absent' ? {} : { features: { [CAMP_AS_ACTION]: on } }) });

function warden(on: boolean | 'absent' = true, who: Parameters<typeof createRegion1>[2] = {}): Region1State {
  return createRegion1({ world: world(on) }, undefined, { id: 'w-astrid', ...who });
}
/** Every ring surveyed: each domain observed. */
const surveyed = (): Exploration => survey(survey(survey(createExploration(), 1), 2), 3);
const explored = (s: Region1State): Region1State => ({ ...s, explore: surveyed() });
const camp = (spot: string): QueueItem => ({ q: 'camp', opts: { spot } });
/** Practice hours for a skill level. */
const atLevel = (n: number): number => LEVEL_HOURS[n];

/** A camped Warden (at the start) with every ring surveyed. */
function campedAndExplored(on: boolean | 'absent' = true, who: Parameters<typeof createRegion1>[2] = {}): Region1State {
  const s = warden(on, who);
  return explored(runAction(s, camp(knownSpots(s)[0].id)));
}

/** A known spot with a hidden risk, from a Warden with every ring surveyed. */
function riskySpot(s: Region1State): CampSpot {
  const spot = knownSpots(s).find(p => !p.start && spotTraits(s, p).risk !== null);
  if (!spot) throw new Error('no risky spot in this Reach — pick another Warden id');
  return spot;
}

describe('Make camp is an action, and camp sites are real places you have explored (#1732)', () => {
  it('1. "Make camp" is a queueable action with its hours, like the others', () => {
    const s = warden();
    expect(ACTIONS.camp.name).toBe('Make camp');
    expect(shown(s, 'camp')).toBe(true);
    expect(blockedReason(s, 'camp', 1)).toBeNull();
    // Its decision is where: the sites you know, as an ordinary option group.
    const groups = ACTIONS.camp.options!(s, {});
    expect(groups.map(g => g.key)).toEqual(['spot']);
    const spot = groups[0].choices[0].value;
    expect(queueHours(camp(spot), s)).toBe(CAMP_SETUP_HOURS);
    // Queued in a day like any other action, it makes camp.
    const after = runDay(s, [camp(spot), 'water']).state;
    expect(after.site).not.toBeNull();
    expect(campSpotOf(after)?.at).toBe(spot);
    expect(after.log.some(l => /^Chose the .+ as your ground/.test(l.text))).toBe(true);
  });

  it('2. a new run knows only where it starts, and once camp is made there, the action is greyed with why', () => {
    const s = warden();
    const spots = knownSpots(s);
    expect(spots).toHaveLength(1);
    expect(spots[0].start).toBe(true);
    const r = reachOfRun(s);
    expect([spots[0].x, spots[0].y]).toEqual([r.camp.x, r.camp.y]);
    const after = runAction(s, camp(spots[0].id));
    expect(knownSpots(after)).toHaveLength(1);
    expect(blockedReason(after, 'camp', 1)).toMatch(/explore first/);
  });

  it('3. exploring until a cave or a riverbank is observed offers it, with its real bearing and walking time', () => {
    const s = runAction(warden(), camp(knownSpots(warden())[0].id));
    const before = knownSpots(s).map(p => p.kind);
    expect(before).not.toContain('river');
    const later = explored(s);
    const spots = knownSpots(later);
    const found = spots.filter(p => p.kind === 'river' || p.kind === 'cave');
    expect(found.length).toBeGreaterThan(0);
    const r = reachOfRun(later);
    for (const p of found) {
      // The walk from camp is the land's own walking time, and the bearing the real one.
      const fromHere = r.hours[p.y * r.w + p.x];
      expect(p.hours).toBeCloseTo(fromHere, 6);
      expect(p.bearing).toBeCloseTo((Math.atan2(p.x - r.camp.x, r.camp.y - p.y) * 180 / Math.PI + 360) % 360, 6);
      expect(p.text).toMatch(/(north|east|south|west)/);
      // It's offered by the action, by name and direction.
      const choice = ACTIONS.camp.options!(later, {})[0].choices.find(c => c.value === p.id);
      expect(choice?.note).toContain(p.text);
      expect(choice?.blocked).toBeNull();
    }
  });

  it('4. every offered site is a square on the run\'s land map, of the right kind', () => {
    for (const id of ['w-astrid', 'w-bo', 'w-cy', 'w-dag']) {
      const s = explored(createRegion1({ world: world(true) }, undefined, { id }));
      const r = reachOfRun(s);
      for (const p of knownSpots(s)) {
        expect(p.id).toBe(`${p.kind}@${p.x},${p.y}`);
        const biome = r.cells[p.y * r.w + p.x].biome;
        if (p.start) expect([r.camp.x, r.camp.y]).toEqual([p.x, p.y]);
        else expect(SPOT_BIOMES[p.kind]).toContain(biome);
      }
    }
  });

  it('5. the site\'s rules follow the place: the riverbank is by water, the hilltop is exposed', () => {
    const s = campedAndExplored();
    const river = knownSpots(s).find(p => p.kind === 'river')!;
    expect(spotTraits(s, river).waterHours).toBe(0);
    const at = runAction(s, camp(river.id));
    expect(at.site).toBe('river');
    // Today's riverbank rule: +2 water a near trip.
    const fetched = runAction(at, 'water');
    const elsewhere = runAction({ ...at, site: 'cave' }, 'water');
    expect(fetched.stores.water - elsewhere.stores.water).toBe(2);
    for (const id of ['w-astrid', 'w-bo', 'w-cy', 'w-dag', 'w-eir']) {
      const e = explored(createRegion1({ world: world(true) }, undefined, { id }));
      for (const p of knownSpots(e)) {
        if (p.kind === 'hill') expect(spotTraits(e, p).wind).toBe('open');
        if (p.kind === 'cave') expect(spotTraits(e, p).wind).toBe('still');
      }
    }
    expect(SITES.hill.warmth).toBeLessThan(SITES.river.warmth);
  });

  it('6. moving camp spends the walk and the setting up, and camp is there', () => {
    const s = campedAndExplored();
    const to = knownSpots(s).find(p => !p.here)!;
    const after = runAction(s, camp(to.id));
    expect(after.hoursToday - s.hoursToday).toBeCloseTo(to.hours + CAMP_SETUP_HOURS, 6);
    expect(campSpotOf(after)?.at).toBe(to.id);
    expect(after.site).toBe(to.kind);
    expect(after.tier === 0 || after.shelter.type === 'leanto').toBe(true);
    // Where you are now is the start of the next walk: the old camp is a walk away.
    expect(knownSpots(after).find(p => p.here)?.id).toBe(to.id);
    expect(knownSpots(after).find(p => p.start)!.hours).toBeGreaterThan(0);
  });

  it('7. low Intelligence and no camp skill read a site vaguely: no exact numbers, no hidden risk', () => {
    const s = campedAndExplored(true, { id: 'w-astrid', stats: { str: 10, con: 10, agi: 10, int: 7, wil: 10, cha: 10 } });
    for (const p of knownSpots(s).filter(x => !x.here)) {
      const k = siteKnowledge(s, p);
      expect(k.band).toBe('vague');
      expect(k.text).not.toMatch(/\d/);
      expect(k.facts.some(f => f.trait === 'risk')).toBe(false);
    }
  });

  it('8. high Intelligence and skill, or the matching talent, read the same site sharply, risk included', () => {
    const low = campedAndExplored(true, { id: 'w-astrid', stats: { str: 10, con: 10, agi: 10, int: 7, wil: 10, cha: 10 } });
    const spot = riskySpot(low);
    expect(siteKnowledge(low, spot).band).toBe('vague');
    const sharp = { ...low, character: { ...low.character, stats: { ...low.character.stats, int: 15 } }, skills: { scouting: atLevel(2) } };
    const k = siteKnowledge(sharp, spot);
    expect(k.band).toBe('sharp');
    expect(k.facts.some(f => f.trait === 'risk')).toBe(true);
    // A born scout's eye does it too.
    const keen = { ...low, character: { ...low.character, stats: { ...low.character.stats, int: 12 }, talents: [{ id: 'keenEye' as const, tier: 3, known: true }] } };
    expect(readingBand(keen, spot)).toBe('sharp');
  });

  it('9. the same Warden and site read the same every time, misjudgements included, and after a reload', () => {
    const a = makeWarden({ id: 'w-astrid' });
    const s = explored(runAction(a.sim, camp(knownSpots(a.sim)[0].id)));
    const spots = knownSpots(s);
    const twice = spots.map(p => siteKnowledge(s, p).text);
    expect(spots.map(p => siteKnowledge(s, p).text)).toEqual(twice);
    const back = deserialize(serialize({ ...a, sim: s }))!;
    expect(knownSpots(back.sim).map(p => siteKnowledge(back.sim, p).text)).toEqual(twice);
    // Some vague reading somewhere misjudges a trait: over many sites, at least one reads wrong.
    const many = ['w-astrid', 'w-bo', 'w-cy', 'w-dag', 'w-eir', 'w-fen'].flatMap(id => {
      const e = explored(createRegion1({ world: world(true) }, undefined, { id }));
      return knownSpots(e).filter(p => !p.here).map(p => siteKnowledge(e, p));
    });
    expect(many.some(k => k.facts.some(f => f.misjudged))).toBe(true);
  });

  it('10. a night camped at a site shows its true traits from then on', () => {
    const low = campedAndExplored(true, { id: 'w-astrid', stats: { str: 10, con: 10, agi: 10, int: 7, wil: 10, cha: 10 } });
    const spot = riskySpot(low);
    const moved = runDay(low, [camp(spot.id)]).state;
    // …and moved on again, the reading of the old site stays true.
    const away = knownSpots(moved).find(p => p.id !== spot.id)!;
    const later = runAction(moved, camp(away.id));
    const k = siteKnowledge(later, knownSpots(later).find(p => p.id === spot.id)!);
    expect(k.band).toBe('known');
    expect(k.facts.some(f => f.trait === 'risk')).toBe(true);
    expect(k.facts.some(f => f.misjudged)).toBe(false);
  });

  it('11. a skill rising past a band improves the reading', () => {
    const s = campedAndExplored();
    const spot = knownSpots(s).find(p => !p.here)!;
    expect(readingBand(s, spot)).toBe('vague');
    expect(readingBand({ ...s, skills: { fieldcraft: atLevel(3) } }, spot)).toBe('fair');
    expect(readingBand({ ...s, skills: { fieldcraft: atLevel(4), scouting: atLevel(4) } }, spot)).toBe('sharp');
  });

  it('12. the AI and the API get the same action and the same sites, in English', () => {
    const s = campedAndExplored();
    const text = observe(s);
    expect(text).toMatch(/^- camp · /m);
    for (const p of knownSpots(s)) expect(text).toContain(p.id);
    expect(text).toMatch(/Make camp is an action here/);
    const g = startGame({ seed: 'camp-1' });
    const v = view(g);
    expect(v.features[CAMP_AS_ACTION]).toBe(true);
    expect(v.text).toMatch(/options "spot": /);
    // The old free "site" setting is refused, with what to do instead.
    const r = applyMove(g, { set: { site: 'cave' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/"camp"/);
    // …and the action itself plays.
    const spot = knownSpots(g.app.sim)[0].id;
    const played = applyMove(g, { do: { q: 'camp', opts: { spot } } });
    expect(played.ok).toBe(true);
    if (played.ok) expect(played.game.app.sim.site).not.toBeNull();
  });

  it('13. with the switch off or absent, sites work exactly as today', () => {
    for (const on of [false, 'absent'] as const) {
      const s = warden(on);
      expect(skillLockOf(s, 'camp')).toMatch(/isn't part of this game's rules/);
      expect(shown(s, 'camp')).toBe(false);
      expect(knownSpots(s)).toEqual([]);
      // Build still offers the four sites, and the Camp tab's choice still settles.
      const scouted = runAction(s, 'scout');
      expect(ACTIONS.build.options!(scouted, {}).map(g => g.key)).toContain('site');
      const settled = chooseSite(scouted, 'cave');
      expect(settled.site).toBe('cave');
      expect(campSpotOf(settled)).toBeNull();
      expect('campSpot' in settled).toBe(false);
      expect(observe(settled)).not.toMatch(/^- camp · /m);
    }
    // Off and absent are the same game, line for line.
    const play = (on: false | 'absent'): string => {
      let s = runAction(warden(on), 'scout');
      s = chooseSite(s, 'river');
      s = runDay(s, ['water', 'wood', { q: 'build', opts: { site: 'tree' } }]).state;
      return JSON.stringify({ ...s, config: null });
    };
    expect(play(false)).toBe(play('absent'));
  });

  it('14. the same seed and moves give the same run', () => {
    const script = (): string => {
      let s = warden();
      s = runDay(s, [camp(knownSpots(s)[0].id), 'explore', 'water']).state;
      s = explored(s);
      const to = knownSpots(s).find(p => !p.here)!;
      s = runDay(s, [camp(to.id), 'wood', 'gather']).state;
      return JSON.stringify({ s, spots: knownSpots(s).map(p => [p.id, siteKnowledge(s, p).text]) });
    };
    expect(script()).toBe(script());
  });
});
