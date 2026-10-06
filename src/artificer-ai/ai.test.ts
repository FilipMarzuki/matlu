/**
 * Acceptance tests for #1226 — the AI player harness. No network: players
 * here are the scripted baseline or scripted test doubles.
 */

import { FLAT_WORLD } from '../artificer/world';
import { describe, it, expect } from 'vitest';
import { fastForward, SHORT_YEAR } from '../artificer/test-helpers';
import { createRegion1, runAction, setFocus } from '../artificer/region1';
import { DEFAULT_CALENDAR } from '../artificer/winter';
import { observe, RULES } from './observe';
import { parseDecision } from './decision';
import { playRun, type Player } from './runner';
import { scriptedPlayer } from './players/scripted';
import { aggregate, type Transcript } from './report';
import { randomPlayer } from './players/random';
import { ROSTER, DROPPED, DEFAULT_OPENROUTER_MODEL } from './roster';

/** A player that replies with the given texts in order (then repeats the last). */
const replay = (texts: string[]): Player & { seen: string[] } => {
  const seen: string[] = [];
  let i = 0;
  return { name: 'replay', seen, async decide(message) { seen.push(message); return { text: texts[Math.min(i++, texts.length - 1)] }; } };
};
const json = (o: unknown): string => JSON.stringify(o);

/** A day doing nothing: the run then ends quickly, of thirst. */
const idleDay = JSON.stringify({ thoughts: 'nothing', focus: null, site: null, queue: [] });

describe('AI player harness', () => {
  // 1. The observation carries what a player needs.
  it('observes the state as text', () => {
    expect(observe(runAction(createRegion1(), 'scout'))).toMatch(new RegExp(`^DAY 1 — autumn, snow on day ${DEFAULT_CALENDAR.winterDay} \\(30 days\\)`));
    // The rest of this test plays the short year (#1301): snow on day 13, the thaw on day 43.
    const s = runAction(createRegion1({ calendar: SHORT_YEAR }), 'scout');
    const text = observe(s);
    expect(text).toMatch(/^DAY 1 — autumn, snow on day 13 \(12 days\)/);
    expect(text).toMatch(/STORES: food 2 · water 2/);
    expect(text).toMatch(/READINESS \(a rough guide\): not ready — larder needs/);
    expect(text).toMatch(/WINTER OUTLOOK: 42 nights to the thaw · food 2 nights · water 2 nights · firewood 6 nights \(91 needed to the thaw, tonight 0\) · shelter 72% short/);
    expect(text).toMatch(/- hunt ring 1 .*BLOCKED: no game tracked/);
    expect(text).toMatch(/options "target": deer/);
    expect(observe(s, ['2 queued action(s) were dropped.'])).toMatch(/NOTE: 2 queued action\(s\) were dropped\./);

    // (Flat world: an unsheltered Warden in the full world doesn't last to the snow any more, #1306.)
    const late = fastForward(runAction(createRegion1({ calendar: SHORT_YEAR, world: FLAT_WORLD }), 'scout'), SHORT_YEAR.winterDay);
    expect(observe(late)).toMatch(/^DAY 13 — winter, thaw on day 43 \(30 days\)/);
    expect(observe(late)).not.toMatch(/EXIT/);
    expect(RULES).toMatch(/There are no exits/);
    // The rules are static (cacheable) and describe the response contract.
    expect(RULES).toMatch(/Reply with ONLY a JSON object/);
    expect(RULES).not.toMatch(/\$\{/);
  });

  // 2. Decisions parse into queue items, or come back as readable errors.
  it('parses decisions and reports bad ones', () => {
    const ok = parseDecision(json({
      thoughts: 'roof first', site: 'cave', exit: null,
      queue: [{ action: 'wood', ring: 2, options: [] }, { action: 'hunt', ring: 1, options: [{ key: 'target', value: 'small' }] }, { action: 'rest', ring: 1, options: [] }],
    }));
    expect(ok).toEqual({ ok: true, decision: { thoughts: 'roof first', site: 'cave', queue: ['wood@2', { q: 'hunt', opts: { target: 'small' } }, 'rest'] } });
    // Lenient about fences and prose around the object.
    expect(parseDecision('Here you go:\n```json\n' + json({ thoughts: '', site: null, exit: null, queue: [] }) + '\n```').ok).toBe(true);

    const bad = (o: unknown): string[] => { const r = parseDecision(typeof o === 'string' ? o : json(o)); return r.ok ? [] : r.errors; };
    expect(bad('not json at all')[0]).toMatch(/not valid JSON/);
    expect(bad({ thoughts: '', site: null, exit: null, queue: [{ action: 'fly', ring: 1, options: [] }] })[0]).toMatch(/"fly" is not an action/);
    expect(bad({ thoughts: '', site: null, exit: null, queue: [{ action: 'rest', ring: 2, options: [] }] })[0]).toMatch(/happens at camp/);
    expect(bad({ thoughts: '', site: null, exit: null, queue: [{ action: 'wood', ring: 4, options: [] }] })[0]).toMatch(/ring must be 1, 2 or 3/);
    expect(bad({ thoughts: '', site: 'castle', exit: null, queue: [] })[0]).toMatch(/site must be one of/);
    expect(bad({ thoughts: '', site: null, exit: 'winter', queue: [] })[0]).toMatch(/there are no exits/);
    expect(bad([1, 2])[0]).toMatch(/must be a JSON object/);
  });

  // 3. The loop applies decisions, retries once on bad replies, and always ends — at the thaw, or sooner.
  it('plays a run: applies decisions, retries invalid replies, ends at the thaw or sooner', async () => {
    // Day 1: invalid, then a valid correction; day 2: invalid twice (day passes); then fetch and forage, day after day.
    const day1 = json({ thoughts: 'look around', site: null, exit: null, queue: [{ action: 'scout', ring: 1, options: [] }, { action: 'wood', ring: 1, options: [] }] });
    // Waiting out the calendar still means fetching water and foraging — a Warden who only rests dies (#1234).
    const rest = json({ thoughts: 'wait', site: null, exit: null, queue: [{ action: 'water', ring: 1, options: [] }, { action: 'gather', ring: 1, options: [] }, { action: 'rest', ring: 1, options: [] }] });
    const p = replay(['oops', day1, 'still bad', 'bad again', rest]);
    const r = await playRun(p, { calendar: SHORT_YEAR });
    expect(r.turns[0]).toMatchObject({ day: 1, invalid: false, thoughts: 'look around', queue: ['scout', 'wood'] });
    expect(p.seen[1]).toMatch(/Your reply was invalid/);
    expect(r.turns[1]).toMatchObject({ day: 2, invalid: true });
    expect(p.seen[4]).toMatch(/NOTE: Your reply for day 2 was invalid twice/);
    expect(r.final.outcome).not.toBeNull();
    expect(r.record.day).toBeLessThanOrEqual(SHORT_YEAR.thawDay);

    // Asking for an exit is an invalid reply (#1302): the player is told, and asked again.
    const leaver = replay([json({ thoughts: '', site: null, exit: 'caravan', queue: [] }), day1, rest]);
    const l = await playRun(leaver, { calendar: SHORT_YEAR });
    expect(leaver.seen[1]).toMatch(/there are no exits/);
    expect(l.turns[0]).toMatchObject({ day: 1, invalid: false, queue: ['scout', 'wood'] });

    // …and one that truly does nothing dies of thirst long before the snow.
    const idle = await playRun(replay([json({ thoughts: 'nothing', site: null, exit: null, queue: [] })]), { calendar: SHORT_YEAR });
    expect(idle.record).toMatchObject({ kind: 'died', choice: 'collapse' });
    expect(idle.record.day).toBeLessThan(SHORT_YEAR.winterDay);
  });

  // 4. The scripted baseline is winter-ready early and survives to the thaw, every time.
  it('has a scripted baseline that survives the winter', async () => {
    const a = await playRun(scriptedPlayer());
    expect(a.record).toMatchObject({ kind: 'survived', choice: 'thaw', day: DEFAULT_CALENDAR.thawDay });
    expect(a.record.readyDay).toBeLessThan(DEFAULT_CALENDAR.winterDay);
    expect(a.turns.some(t => t.invalid)).toBe(false);
    const b = await playRun(scriptedPlayer());
    expect(b.record).toEqual(a.record);
  });

  // #1227 — "scout, then settle" on day 1 must work: the site claim waits for the queue.
  it('defers a site claim until the near ring is scouted', async () => {
    const day1 = json({ thoughts: 'scout then settle', site: 'cave', exit: null, queue: [{ action: 'scout', ring: 1, options: [] }] });
    const run = await playRun(replay([day1, idleDay]), { calendar: SHORT_YEAR });
    expect(run.turns[0].journal.join('\n')).not.toMatch(/Can't stake a claim/);
    expect(run.turns[0].journal.join('\n')).toMatch(/Chose the cave/);

    // …and a build queued in that same day settles on the chosen site.
    const withBuild = json({ thoughts: 'scout, cut, build', site: 'cave', exit: null, queue: [
      { action: 'scout', ring: 1, options: [] }, { action: 'wood', ring: 1, options: [] }, { action: 'build', ring: 1, options: [] }] });
    const built = await playRun(replay([withBuild, idleDay]), { calendar: SHORT_YEAR });
    expect(built.turns[0].journal.join('\n')).not.toMatch(/choose a location/);
    expect(built.turns[0].journal.join('\n')).toMatch(/Raised a .*lean-to/);
  });

  // #1229 — every turn carries a progression snapshot…
  it('records a progress snapshot on every turn', async () => {
    const run = await playRun(scriptedPlayer());
    expect(run.start).toMatchObject({ day: 1, rank: 'Apprentice', crafts: 0, discoveries: 0, exploration: 0, readiness: expect.any(Number) });
    for (const t of run.turns) expect(t.progress.day).toBe(t.day + 1);
    const day1 = run.turns[0].progress;
    expect(day1.shelter.tier).toBe(1);
    expect(day1.crafts).toBeGreaterThanOrEqual(1);
    expect(day1.exploration).toBeGreaterThan(0);
    const last = run.turns.at(-1)!.progress;
    expect(last.winterReady).toBe(true);
    expect(last.readiness).toBe(1);
    expect(last.stores.rations).toBeGreaterThanOrEqual(10);
    expect(Object.keys(last.pillars).sort()).toEqual(['body', 'fuel', 'larder', 'shelter']);
  });

  // …and the report folds runs into per-model day-by-day means and first-event days.
  it('aggregates runs per model', async () => {
    const a = await playRun(scriptedPlayer());
    const stub = await playRun(replay([json({ thoughts: 'stay', site: null, exit: null, queue: [{ action: 'water', ring: 1, options: [] }, { action: 'gather', ring: 1, options: [] }, { action: 'rest', ring: 1, options: [] }] })]), { calendar: SHORT_YEAR });
    const asT = (r: typeof a, player: string): Transcript => ({ ...r, player } as unknown as Transcript);
    const [best, worst] = aggregate([asT(a, 'scripted'), asT(a, 'scripted'), asT(stub, 'openrouter:lazy/model')]);
    expect(best).toMatchObject({ model: 'scripted', runs: 2, outcomes: { survived: 2 }, readyRuns: 2, readyDay: a.record.readyDay });
    expect(best.series.readiness[0]).toBe(Math.round(a.start.readiness * 1000) / 10);
    expect(best.series.readiness.at(-1)).toBe(100);
    expect(best.events.shelter).toEqual({ day: 1, runs: 2 });
    expect(best.events.ready.day).toBe(a.record.readyDay);
    expect(best.actions.hunt).toBeGreaterThan(0);
    expect(worst).toMatchObject({ model: 'lazy/model', runs: 1, readyRuns: 0, readyDay: null });
    expect(worst.events.shelter).toEqual({ day: null, runs: 0 });
    expect(worst.actions.rest).toBe(stub.turns.length);
  });

  // Random baselines: seeded (so they repeat), legal ones only queue possible actions,
  // and many runs double as a fuzz test — no crash, no broken invariant.
  it('runs seeded random baselines without breaking the sim', async () => {
    const a = await playRun(randomPlayer({ mode: 'legal', seed: 7 }));
    const b = await playRun(randomPlayer({ mode: 'legal', seed: 7 }));
    expect(b.record).toEqual(a.record);
    expect(b.turns.map(t => t.queue)).toEqual(a.turns.map(t => t.queue));
    expect(a.turns.some(t => t.invalid)).toBe(false);
    expect(a.turns.flatMap(t => t.journal).some(l => /skipped/.test(l))).toBe(false);
    for (let seed = 1; seed <= 40; seed++) {
      for (const mode of ['legal', 'uniform'] as const) {
        const run = await playRun(randomPlayer({ mode, seed }));
        expect(run.turns.flatMap(t => t.violations ?? [])).toEqual([]);
        expect(run.final.outcome).not.toBeNull();
      }
    }
  });

  // A value just under a threshold must never display as meeting it.
  it('rounds readiness values down so an unmet threshold never reads as met', async () => {
    const { createVitals } = await import('../artificer/vitality');
    const { progressOf } = await import('./progress');
    const base = runAction(createRegion1(), 'scout');
    const s = { ...base, vitals: { ...createVitals({ condition: 80 }), vigor: { current: 50, cap: 99.6 } } };
    expect(observe(s)).toMatch(/Vigor 50\/99 /);
    expect(observe(s)).toMatch(/body needs \(vigor capacity 99\/100/);
    const p = progressOf({ ...s, stores: { ...s.stores, rations: 12, firewood: 15 } }, s.known.length);
    expect(p.pillars.body).toBeLessThan(1);
    expect(p.readiness).toBeLessThan(1);
  });

  // #1231 — the run adds up the actual cost each call reports; unknown stays unknown, local play is free.
  it('totals the cost of a run and summarises spend per model', async () => {
    const reply = json({ thoughts: 'rest', site: null, exit: null, queue: [{ action: 'rest', ring: 1, options: [] }] });
    const priced: Player = { name: 'openrouter:paid/model', async decide() { return { text: reply, usage: { input: 10, output: 2, cost: 0.001 } }; } };
    const unpriced: Player = { name: 'openrouter:mystery/model', async decide() { return { text: reply }; } };
    const paid = await playRun(priced, { calendar: SHORT_YEAR });
    expect(paid.usage.cost).toBeCloseTo(0.001 * paid.turns.length, 10);
    expect((await playRun(unpriced, { calendar: SHORT_YEAR })).usage.cost).toBeNull();
    const free = await playRun(scriptedPlayer());
    expect(free.usage.cost).toBe(0);

    const asT = (r: typeof paid, player: string): Transcript => ({ ...r, player } as unknown as Transcript);
    const old = asT(await playRun(unpriced, { calendar: SHORT_YEAR }), 'openrouter:old/model');
    const byModel = Object.fromEntries(aggregate([asT(paid, 'openrouter:paid/model'), asT(paid, 'openrouter:paid/model'), asT(free, 'scripted'), old]).map(m => [m.model, m.cost]));
    expect(byModel['paid/model']).toEqual({ perGame: Math.round(paid.usage.cost! * 1e4) / 1e4, total: Math.round(2 * paid.usage.cost! * 1e4) / 1e4, perWin: null, estimated: false });
    expect(byModel.scripted).toMatchObject({ perGame: 0, total: 0, perWin: 0 });
    expect(byModel['old/model']).toEqual({ perGame: null, total: null, perWin: null, estimated: false });
  });

  // The roster keeps dropped models (Gemini Pro: cost; Mistral Large: overkill) from creeping back in.
  it('keeps dropped models out of the roster and the default', () => {
    const dropped = new Set(DROPPED.map(d => d.model));
    expect(ROSTER.filter(r => dropped.has(r.model))).toEqual([]);
    expect(dropped.has(DEFAULT_OPENROUTER_MODEL)).toBe(false);
    expect(ROSTER.every(r => r.perGame > 0 && r.perGame < 0.2)).toBe(true);
  });

  // #1238 — the AI sets its focus in the reply; null keeps it; bad values are explained.
  it('lets the AI choose a focus', async () => {
    const day = (focus: string | null) => json({ thoughts: 'x', focus, site: null, exit: null, queue: [{ action: 'water', ring: 1, options: [] }, { action: 'gather', ring: 1, options: [] }] });
    const run = await playRun(replay([day('goal:larder'), day(null), idleDay]), { calendar: SHORT_YEAR });
    expect(run.final.focus).toEqual({ kind: 'goal', id: 'larder' });
    const bad = parseDecision(json({ thoughts: '', focus: 'goal:fame', site: null, exit: null, queue: [] }));
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.errors[0]).toMatch(/focus must be one of/);
    expect(observe(setFocus(runAction(createRegion1(), 'scout'), { kind: 'skill', id: 'hunting' }))).toMatch(/FOCUS: skill:hunting/);
  });
});
