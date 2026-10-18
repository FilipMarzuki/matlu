/**
 * Acceptance for #1869 (ui feature `explore-finds`): what a land trip turned up appears as finds,
 * one per line, in the day's log as it plays; each is worded from what was actually learned, thin
 * and rich read differently and never with a number, the journal keeps one line per trip, and with
 * the switch off the explore is as before. Pure: explore-finds.ts over playback.ts's steps.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeT, type Key } from '../artificer/i18n';
import { en as EN_CATALOG } from '../artificer/i18n/en';
import { runAction, type QueueItem } from '../artificer/region1';
import { DOMAINS, domainsOf, level, RINGS } from '../artificer/exploration';
import { FEATURES, featureById, ruleFeatures, uiFeatureOn } from '../artificer/features';
import { DIRECTED_EXPLORE } from '../artificer/directed-explore';
import { observe } from '../artificer-ai/observe';
import { makeWarden, runQueuedDay, type AppState } from './controller';
import { linesAt, playAct, playDay, type DayPlay } from './playback';
import { landNews, landSeen } from './land-news';
import { journalItems } from './journal-view';
import {
  FINDS_FEATURE, TIERS, findLine, findLines, findShort, findsBetween, findsShown, findCount, foundLine, playFinds, resetTrips, storeTrips,
  storedTrips, timerLines, tierOf, tripSummary, withTripLines, FIND_MS, type Find,
} from './explore-finds';

const en = makeT('en');
const sv = makeT('sv');

/** A new Warden as the page makes one, with no chance in the day (no encounters, luck or weather), so the trips are the same every time. */
function warden(id = 'w-b', features: Record<string, boolean> = {}): AppState {
  const a = makeWarden({ id }, undefined, features);
  const world = { ...a.sim.config.world, encounters: false, luck: false, accidents: false, darkness: false, weather: 'clear' as const };
  return { ...a, sim: { ...a.sim, config: { ...a.sim.config, world } } };
}

/** One thing done by hand, as the page plays it (playback.ts `playAct`), dropping an encounter it raised. */
function step(a: AppState, item: QueueItem): { play: DayPlay; next: AppState } {
  const play = playAct(a, item);
  const sim = play.after.sim.pending ? { ...play.after.sim, pending: null } : play.after.sim;
  return { play, next: { ...play.after, sim } };
}

/** The timer's log once everything has shown, as plain text. */
const shownAll = (p: DayPlay, on = true, t = en): string[] => {
  const f = playFinds(p, on);
  return timerLines(p, p.steps.length, true, f, () => Infinity, t).map(l => ('log' in l ? l.log.text : l.find));
};

const DIGIT = /\d/;

describe('#1869 finds as you explore', () => {
  beforeEach(() => resetTrips());

  it('a seeded explore that raised knowledge gives the expected find lines, in English and Swedish', () => {
    const { play } = step(warden(), 'explore');
    const [f] = playFinds(play, true);
    expect(f?.trip).toEqual({ act: 'explore', ring: 1 });
    // The first look: a stream, then each domain close by, all suspected (one step less sure than plenty).
    expect(findLines(f!.finds, en)).toEqual([
      'Found a clear stream', 'Found berries', 'Found firewood', 'Found smooth rocks', 'Found water', 'Found game trails',
    ]);
    expect(findLines(f!.finds, sv)).toEqual([
      'Hittade en klar bäck', 'Hittade bär', 'Hittade ved', 'Hittade släta stenar', 'Hittade vatten', 'Hittade viltstigar',
    ]);
    // They follow the trip's own lines in the timer's log, one at a time.
    const lines = shownAll(play);
    const at = lines.indexOf('Found a clear stream');
    expect(at).toBeGreaterThan(0);
    expect(lines.slice(0, at)).toEqual(play.after.sim.log.slice(play.steps[0].logFrom).map(l => l.text));
    expect(findsShown(6, 0)).toBe(1);
    expect(findsShown(6, FIND_MS * 2.5)).toBe(3);
    expect(findsShown(6, FIND_MS * 100)).toBe(6);
    expect(timerLines(play, 1, false, [f], () => 2, en).filter(l => 'find' in l)).toEqual([{ find: 'Found a clear stream' }, { find: 'Found berries' }]);
    // A closer look, once the ground is observed: the same land, now a good source.
    const a = step(warden(), 'explore').next;
    const half = { ...a.sim.explore, known: { ...a.sim.explore.known, 1: { ...a.sim.explore.known[1], forage: 1.5, timber: 1.5, stone: 1.5, water: 1.5, game: 1.5 } } };
    const closer = step({ ...a, sim: { ...a.sim, explore: half } }, 'explore');
    const g = playFinds(closer.play, true)[0]!;
    expect(g.finds.length).toBeGreaterThan(0);
    // …and observed ground shows where to camp (camp-sites.ts: a site's area observed or better).
    expect(findLines(g.finds, en)).toEqual(['A good source of berries', 'Found a good source of firewood', 'Found a good camp site up on a rise', 'Found a good camp site in the shelter of the trees']);
    expect(findLines(g.finds, sv)).toEqual(['Bra tillgång på bär', 'Hittade en bra vedkälla', 'Hittade en bra lägerplats uppe på en höjd', 'Hittade en bra lägerplats i lä under träden']);
  });

  it('gives no find without a knowledge change, and a line for every new chip and place', () => {
    // A look round that firms nothing up a whole level: one line, nothing new.
    const first = step(warden(), 'explore').next;
    const again = step(first, 'explore');
    expect(findsBetween(first.sim, again.next.sim)).toEqual([]);
    expect(shownAll(again.play).filter(l => !again.play.after.sim.log.some(x => x.text === l))).toEqual(['Nothing new out that way.']);
    expect(findLines([], sv)).toEqual(['Inget nytt åt det hållet.']);
    // Anything that isn't a land trip turns up no finds at all.
    expect(playFinds(step(first, 'rest').play, true)).toEqual([null]);
    // Across Wardens and trips (out to half a day, and heading out one way): every chip that went up
    // and every new place has its line, and nothing else does.
    for (const id of ['w-a', 'w-b', 'w-c', 'w-d']) {
      let a = warden(id);
      for (const q of ['explore', 'explore', 'explore', 'explore@2', 'explore@2', { q: 'explore@2', opts: { way: 'n' } }] as QueueItem[]) {
        const { play, next } = step(a, q);
        const before = a.sim, after = play.steps[0]?.sim ?? before;
        const f = playFinds(play, true)[0];
        if (f) {
          const chips = f.finds.filter((x): x is Extract<Find, { kind: 'chip' }> => x.kind === 'chip').map(x => `${x.ring}:${x.domain}`);
          const up = RINGS.flatMap(r => domainsOf(r).filter(d => level(after.explore, r, d) > level(before.explore, r, d)).map(d => `${r}:${d}`));
          expect(chips).toEqual(up);
          const news = landNews(after, landSeen(before));
          const moved = JSON.stringify(before.afield) !== JSON.stringify(after.afield);
          // Standing still, each new place is a kind of land found (heading out re-measures them all from the new spot).
          if (!moved) expect(f.finds.filter(x => x.kind === 'land').length).toBe(news.places.size);
          if (!up.length && !news.places.size && !(after.seenOut ?? []).length) expect(f.finds.filter(x => x.kind !== 'spot')).toEqual([]);
        }
        a = next;
      }
    }
  });

  it('says thin and rich finds differently, and never with a number', () => {
    let s = warden().sim;
    s = { ...s, explore: { ...s.explore, known: { ...s.explore.known, 1: { ...s.explore.known[1], forage: 2, timber: 2, stone: 1 } } } };
    const rich = { ...s, explore: { ...s.explore, supply: { ...s.explore.supply, 1: { ...s.explore.supply[1], forage: 1 } } } };
    const thin = { ...s, explore: { ...s.explore, supply: { ...s.explore.supply, 1: { ...s.explore.supply[1], forage: 0.3 } } } };
    expect(tierOf(rich, 1, 'forage')).toBe('rich');
    expect(tierOf(thin, 1, 'forage')).toBe('thin');
    // Only suspected, the same plenty is one step less sure.
    expect(tierOf(rich, 1, 'stone')).toBe('some');
    const say = (tier: 'thin' | 'rich', t = en): string => findLine({ kind: 'chip', ring: 1, domain: 'forage', tier }, t);
    expect(say('rich')).toBe('A good source of berries');
    expect(say('thin')).toBe('Saw a few berries');
    expect(findLine({ kind: 'chip', ring: 1, domain: 'game', tier: 'thin' }, en)).toBe('Saw signs of game');
    expect(findLine({ kind: 'chip', ring: 1, domain: 'timber', tier: 'rich' }, en)).toBe('Found a good source of firewood');
    expect(findLine({ kind: 'chip', ring: 1, domain: 'stone', tier: 'rich' }, sv)).toBe('Bra tillgång på släta stenar');
    // Every find, in both languages, long and short: thin, some and rich all differ, and none has a digit.
    for (const t of [en, sv]) {
      for (const d of DOMAINS) {
        const said = TIERS.map(tier => findLine({ kind: 'chip', ring: 2, domain: d, tier }, t));
        expect(new Set(said).size).toBe(3);
        expect(new Set(TIERS.map(tier => findShort({ kind: 'chip', ring: 2, domain: d, tier }, t))).size).toBe(3);
      }
      const all = (Object.keys(EN_CATALOG) as Key[]).filter(k => k.startsWith('find.')).map(k => t(k));
      for (const line of all) expect(line, line).not.toMatch(DIGIT);
    }
    // …and the lines a seeded run turns up.
    let a = warden('w-a', { [DIRECTED_EXPLORE]: true });
    for (const q of ['explore', 'explore@2', { q: 'explore@2', opts: { way: 'e' } }] as QueueItem[]) {
      const { play, next } = step(a, q);
      const f = playFinds(play, true)[0];
      if (f) for (const t of [en, sv]) { for (const l of findLines(f.finds, t)) expect(l).not.toMatch(DIGIT); expect(tripSummary(f, t)).not.toMatch(DIGIT); }
      a = next;
    }
  });

  it('keeps one journal line per trip', () => {
    // A planned day of three land trips and a rest.
    const start = warden();
    const a: AppState = { ...start, sim: { ...start.sim, canPlan: true }, queue: ['explore', 'explore', 'rest', 'explore'] };
    const play = playDay(a);
    const finds = playFinds(play, true);
    expect(finds.map(f => !!f)).toEqual(play.steps.map(st => st.item !== 'rest'));
    storeTrips(a.sim.character.id, play, finds, null);
    // Playing the same day again (a stop, #1815, or a reload) doesn't add a second line for a trip.
    storeTrips(a.sim.character.id, play, finds, null);
    const kept = storedTrips(a.sim.character.id, null);
    expect(kept.length).toBe(finds.filter(Boolean).length);
    const log = play.after.sim.log;
    const withLines = withTripLines(log, kept, en);
    expect(withLines.length).toBe(log.length + kept.length);
    // Each trip's line comes straight after the trip's own lines.
    for (const k of kept) expect(withLines[withLines.indexOf(log[k.at]) + 1].text).toBe(tripSummary(k, en));
    expect(tripSummary(kept[0], en)).toBe('Explored close by: a clear stream, berries, firewood, smooth rocks, water, game trails');
    expect(tripSummary(kept[0], sv)).toBe('Utforskade i närheten: en klar bäck, bär, ved, släta stenar, vatten, viltstigar');
    expect(tripSummary(kept[1], en)).toBe('Explored close by: nothing new');
    const html = journalItems(withLines, 50, 'D', en);
    expect(html.match(/Explored close by/g)?.length).toBe(kept.length);
    // Another Warden's journal shows none of them.
    expect(storedTrips('someone-else', null)).toEqual([]);
  });

  it('with the switch off or absent, the explore looks as today and the run is the same', () => {
    expect(featureById(FINDS_FEATURE)).toMatchObject({ kind: 'ui', default: true, absent: false, issue: 1869 });
    expect(uiFeatureOn({}, FINDS_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [FINDS_FEATURE]: false }, FINDS_FEATURE)).toBe(false);
    expect(FEATURES.findIndex(f => f.id === FINDS_FEATURE)).toBeGreaterThan(FEATURES.findIndex(f => f.id === 'start-on-land'));
    // A ui feature: no run carries it, so a run's rules (and the storytelling's hashes) can't depend on it.
    expect(ruleFeatures({ [FINDS_FEATURE]: false })).toEqual(ruleFeatures());
    expect(FINDS_FEATURE in ruleFeatures()).toBe(false);
    const start = warden();
    const a: AppState = { ...start, sim: { ...start.sim, canPlan: true }, queue: ['explore', 'explore', 'explore@2'] };
    const play = playDay(a);
    // Off: no finds, and the timer's log is exactly the day's journal lines, as before.
    expect(playFinds(play, false).every(f => f === null)).toBe(true);
    const off = timerLines(play, play.steps.length, true, playFinds(play, false), () => Infinity, en).map(l => ('log' in l ? l.log : null));
    expect(off).toEqual(linesAt(play, play.steps.length, true));
    // The finds only read the run: the day is the same either way.
    expect(JSON.stringify(play.after.sim)).toBe(JSON.stringify(runQueuedDay(a).sim));
    expect(findCount(null)).toBe(0);
  });

  it('gives the AI a FOUND line after an explore', () => {
    const a = warden();
    const after = runAction(a.sim, 'explore');
    const line = foundLine(a.sim, after);
    expect(line).toBe('FOUND (what your trips out turned up): Found a clear stream; Found berries; Found firewood; Found smooth rocks; Found water; Found game trails.');
    expect(observe(after, [], [line!])).toContain(`\n${line}\n`);
    expect(foundLine(after, runAction(after, 'explore'))).toBe('FOUND (what your trips out turned up): nothing new.');
    expect(foundLine(after, runAction(after, 'rest'))).toBeNull();
    // No FOUND line in an observation not given one: as before.
    expect(observe(after)).not.toContain('FOUND');
  });
});
