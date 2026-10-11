/**
 * Web-game runs (#1559): the page writes down what it does, and the log replays to the same game.
 * `pagePlay` (fixtures.ts) plays the way the page does, through the same controller calls, so these
 * check that what the page records is enough to rebuild its run exactly, and that a log the page
 * couldn't have written doesn't replay.
 */

import { describe, it, expect } from 'vitest';
import { serialize as serializeApp, deserialize as deserializeApp, type AppState } from '../artificer-app/controller';
import { ruleFeatures } from '../artificer/features';
import { talentOffer, seedOf, TALENT_IDS } from '../artificer/talents';
import { SUGGESTED_PACK } from '../artificer/kit';
import { DEFAULT_STATS } from '../artificer/stats';
import { pagePlay, thawApp } from './fixtures';
import { runOf, type RunMeta } from './record-of';
import { GAME_VERSION } from './session';
import { startOf, replayWeb, replayFrom, startProblem, logProblem, heirloomsAllowed } from './web-run';
import { newLog, runOver, claimOf, claimMismatch, recordMove, type WebStart, type WebMove, type Recorder } from './web-log';

const ID = 'w-test-web1';
const start = (o: Partial<WebStart> = {}): WebStart => ({
  id: ID, name: 'Vega', portrait: 'loke', chosen: talentOffer(seedOf(ID)).slice(0, 2), stats: { ...DEFAULT_STATS }, age: 12,
  pack: [...SUGGESTED_PACK], features: ruleFeatures(), heirlooms: null, ...o,
});
const recorder = (s: WebStart): Recorder => ({ log: newLog(s), measures: {} });
const meta: RunMeta = { playerKind: 'person', model: null, client: 'artificer-web', surface: 'web', gameVersion: GAME_VERSION, name: 'Vega', moves: 0 };
/** A game as a save holds it once loaded: saved, loaded and saved again, with its keys in order. */
const asSaved = (a: AppState): string => JSON.stringify(JSON.parse(serializeApp(deserializeApp(serializeApp(a))!)), (_k, v: unknown) =>
  (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, (v as Record<string, unknown>)[k]])) : v));
const kindsOf = (moves: WebMove[]): Set<string> => new Set(moves.map(m => ('set' in m ? `set:${Object.keys(m.set).join(',')}` : Object.keys(m)[0])));

describe('Web-game runs (#1559)', () => {
  it('Given a whole run played as the page plays it, When its log is replayed, Then it ends in exactly the same game, with the same record', () => {
    const s = start();
    const played = pagePlay(startOf(s), recorder(s));
    expect(runOver(played.app)).toBe(true);
    const kinds = kindsOf(played.rec.log.moves);
    for (const k of ['do', 'endDay', 'plan', 'choose', 'set:site', 'set:focus', 'set:eating']) expect(kinds).toContain(k);

    const t0 = performance.now();
    const r = replayWeb(played.rec.log);
    const ms = performance.now() - t0;
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(serializeApp(r.app)).toBe(serializeApp(played.app));
    expect(r.measures).toEqual(played.rec.measures);
    const mine = runOf(played.app, played.rec.measures, meta);
    expect(claimMismatch(claimOf(mine), runOf(r.app, r.measures, meta))).toEqual([]);
    // A whole run replays in well under the function's 10 seconds.
    expect(ms).toBeLessThan(3000);
  });

  it('Given the page reloaded after every tap, Then the log still replays to the same game', () => {
    // Loading a save tidies a few things without changing the game (an empty injury list is left
    // out, keys come back in another order), so the two are compared as a save would hold them.
    const s = start({ id: 'w-test-web2', chosen: talentOffer(seedOf('w-test-web2')).slice(1, 3) });
    const played = pagePlay(startOf(s), recorder(s), { reload: true });
    const r = replayWeb(played.rec.log);
    expect(r.ok && asSaved(r.app)).toBe(asSaved(played.app));
    expect(r.ok && claimMismatch(claimOf(runOf(played.app, played.rec.measures, meta)), runOf(r.app, r.measures, meta))).toEqual([]);
  });

  it('Given a planned day, encounters answered and carried on, and the road, Then those replay the same too', () => {
    // From the thaw: the caravan meeting (met and boarded on the page's buttons, which aren't
    // logged), the road with talks, free questions, rest and road encounters, to the road's end.
    const thaw = thawApp();
    const rec: Recorder = { log: newLog({ ...start(), id: thaw.sim.character.id }), measures: {} };
    const played = pagePlay(thaw, rec);
    expect(played.app.stage).toBe('road');
    expect(runOver(played.app)).toBe(true);
    const kinds = kindsOf(played.rec.log.moves);
    for (const k of ['choose', 'do', 'endDay']) expect(kinds).toContain(k);
    expect(played.rec.log.moves.some(m => 'do' in m && String(m.do).startsWith('question:'))).toBe(true);
    const r = replayFrom(thaw, played.rec.log.moves);
    expect(r.ok && serializeApp(r.app)).toBe(serializeApp(played.app));
  });

  it('Given a Warden who watches the caravan go, Then staying behind replays the same', () => {
    const thaw = thawApp();
    const played = pagePlay(thaw, { log: newLog({ ...start(), id: thaw.sim.character.id }), measures: {} }, { stay: true });
    expect(played.app.stayed).toBe(true);
    const r = replayFrom(thaw, played.rec.log.moves);
    expect(r.ok && serializeApp(r.app)).toBe(serializeApp(played.app));
  });

  it('Given a log the page could not have written, Then it does not replay', () => {
    const s = start({ id: 'w-test-web3', chosen: talentOffer(seedOf('w-test-web3')).slice(0, 2) });
    const { rec } = pagePlay(startOf(s), recorder(s));
    const moves = rec.log.moves;
    // Cut short: the run doesn't end.
    expect(replayWeb({ start: s, moves: moves.slice(0, -1) })).toMatchObject({ ok: false, error: expect.stringMatching(/stop before/) });
    // A move after the end.
    expect(replayWeb({ start: s, moves: [...moves, { endDay: true }] })).toMatchObject({ ok: false, at: moves.length });
    // An answer that was never open, and an action that doesn't exist.
    expect(replayWeb({ start: s, moves: [{ choose: 'win' }, ...moves] })).toMatchObject({ ok: false, at: 0 });
    expect(replayWeb({ start: s, moves: [{ do: 'teleport' }, ...moves] })).toMatchObject({ ok: false, at: 0 });
    // A plan before planning is learned.
    expect(replayWeb({ start: s, moves: [{ plan: ['water'] }, ...moves] })).toMatchObject({ ok: false, error: expect.stringMatching(/plan/) });
  });

  it('Given a claim that differs from the replay, Then the differing fields are named', () => {
    const s = start({ id: 'w-test-web4', chosen: talentOffer(seedOf('w-test-web4')).slice(0, 2) });
    const played = pagePlay(startOf(s), recorder(s));
    const r = replayWeb(played.rec.log);
    if (!r.ok) throw new Error(r.error);
    const truth = runOf(r.app, r.measures, meta);
    expect(claimMismatch({ ...claimOf(truth), outcome: truth.outcome === 'died' ? 'arrived' : 'died', endDay: truth.endDay + 1 }, truth)).toEqual(['outcome', 'endDay']);
    expect(claimMismatch({ ...claimOf(truth), skillLevels: truth.skillLevels + 1 }, truth)).toEqual(['skillLevels']);
    expect(claimMismatch(null, truth).length).toBeGreaterThan(5);
  });

  it('refuses a start the creation screen could not make', () => {
    expect(startProblem(start())).toBeNull();
    expect(startProblem({ id: 'w-x-skipped', features: ruleFeatures(), heirlooms: null })).toBeNull(); // the creation screen skipped
    const offer = talentOffer(seedOf(ID));
    const notOffered = TALENT_IDS.find(t => !offer.includes(t));
    expect(startProblem(start({ chosen: [offer[0], notOffered!] }))).toMatch(/talents/);
    expect(startProblem(start({ stats: { ...DEFAULT_STATS, str: 18, con: 18 } }))).toMatch(/stats/);
    expect(startProblem(start({ age: 9 }))).toMatch(/age/);
    expect(startProblem(start({ pack: ['anvil' as never] }))).toMatch(/pack/);
    expect(startProblem(start({ features: { 'no-such-feature': true } }))).toMatch(/features/);
    expect(startProblem(start({ heirlooms: [{ item: 'knife', grade: 'legendary' as never }] }))).toMatch(/heirlooms/);
    expect(startProblem(start({ id: '../../etc' }))).toMatch(/id/);
    expect(logProblem({ v: 1, version: GAME_VERSION, start: start(), moves: new Array(11).fill({ endDay: true }) }, 10)).toMatch(/more than 10/);
    expect(logProblem({ v: 99, version: GAME_VERSION, start: start(), moves: [] }, 10)).toMatch(/format/);
  });

  it('believes heirlooms only among what the checked run left', () => {
    const left = [{ item: 'knife', grade: 'sound' as const, heirloom: true }, { item: 'snare', grade: 'crude' as const, heirloom: true }];
    expect(heirloomsAllowed([left[0]], left)).toBe(true);
    expect(heirloomsAllowed([], left)).toBe(true);
    expect(heirloomsAllowed([{ item: 'knife', grade: 'fine', heirloom: true }], left)).toBe(false);
    expect(heirloomsAllowed([{ item: 'bow', grade: 'crude', heirloom: true }], left)).toBe(false);
  });

  it("records only moves that change the game, and only for this log's Warden", () => {
    const s = start();
    const a = startOf(s);
    const rec = recorder(s);
    expect(recordMove(rec, a, a, { endDay: true })).toBe(rec); // nothing changed
    expect(recordMove(rec, a, { ...a, queue: ['water'] }, { plan: ['water'] })).toBe(rec); // only the plan changed
    const other = startOf(start({ id: 'w-someone-else', chosen: undefined }));
    expect(recordMove(rec, other, { ...other, sim: { ...other.sim } }, { endDay: true })).toBe(rec);
    expect(recordMove(null, a, { ...a, sim: { ...a.sim } }, { endDay: true })).toBeNull();
    expect(recordMove(rec, a, { ...a, sim: { ...a.sim } }, { endDay: true })!.log.moves).toEqual([{ endDay: true }]);
    // After the end, a focus picked on the page isn't part of the run.
    const over = { ...a, sim: { ...a.sim, outcome: { choice: 'collapse' as const, kind: 'died' as const, vitals: a.sim.vitals } } };
    expect(recordMove(rec, over, { ...over, sim: { ...over.sim, focus: null } }, { set: { focus: 'none' } })).toBe(rec);
  });
});
