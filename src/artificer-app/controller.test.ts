/**
 * Tests for #1209 — the Artificer web frontend's controller (queue + save).
 * The DOM itself is exempt (ui-menus); these cover the rules it relies on.
 */

import { describe, it, expect } from 'vitest';
import { supplied, SHORT_YEAR } from '../artificer/test-helpers';
import { newGame, newRun, recordRun, serializeHistory, deserializeHistory, enqueue, dequeueAt, clearQueue, setOption, runQueuedDay, runWholeQueue, settle, previewQueue, serialize, deserialize, makeWarden, SAVE_VERSION, type AppState } from './controller';
import { scouted } from '../artificer/exploration';
import { createRegion1, type Region1State } from '../artificer/region1';
import { bestPerItem } from '../artificer/crafting';
import { FLAT_WORLD } from '../artificer/world';
import { HEX_WORLD } from '../artificer/world/hex-window';
import { noteSeenCells } from '../artificer/world/hex-knowledge';
import { DIRECTED_EXPLORE } from '../artificer/directed-explore';
import { WALK_THE_MAP } from '../artificer/walk-the-map';
import { packCell } from '../../worldmap/coords';
import { WORLDGEN_VERSION } from '../../worldmap/version';

/** A new game in the flat world: a fresh game's random character id would otherwise roll random weather (fog blinds a scout, #1284). */
const flatGame = (): AppState => ({ ...newGame(), sim: createRegion1({ world: FLAT_WORLD, calendar: SHORT_YEAR }, undefined, { id: 'w-controller' }) });
/** The same game on the last night of winter, fed and watered. */
const lastNight = (a: AppState): AppState => ({ ...a, sim: { ...supplied(a.sim), day: SHORT_YEAR.thawDay - 1 } });
const withQueue = (a: AppState, ids: Parameters<typeof enqueue>[1][]): AppState => ids.reduce(enqueue, a);

describe('Artificer controller', () => {
  // 1. Queue editing is pure.
  it('adds, removes and clears queued actions without mutating', () => {
    const a = flatGame();
    const q = withQueue(a, ['scout', 'water', 'wood']);
    expect(q.queue).toEqual(['scout', 'water', 'wood']);
    expect(dequeueAt(q, 1).queue).toEqual(['scout', 'wood']);
    expect(dequeueAt(q, 9).queue).toEqual(q.queue); // out of range is a no-op
    expect(clearQueue(q).queue).toEqual([]);
    expect(a.queue).toEqual([]);
  });

  // 2. Running a day runs what fits and keeps the rest.
  it('runs one day of the queue and carries the remainder', () => {
    const a = withQueue(flatGame(), ['scout', 'wood', 'wood', 'wood', 'water']);
    const r = runQueuedDay(a);
    // scout 4h + 3×wood 12h → the 3rd wood starts at 12h (< 14) and finishes; water waits
    expect(r.queue).toEqual(['water']);
    expect(r.sim.day).toBe(2);
    expect(scouted(r.sim.explore, 1)).toBe(true);
  });

  // 3. Running the whole queue drains it across days.
  it('drains a multi-day queue', () => {
    const a = withQueue(flatGame(), ['scout', 'wood', 'wood', 'wood', 'water', 'wood', 'wood']);
    const r = runWholeQueue(a);
    expect(r.queue).toEqual([]);
    expect(r.sim.day).toBe(3);
    // An empty queue is a no-op (no day passes).
    expect(runWholeQueue(r).sim.day).toBe(3);
  });

  // 4. The preview splits days like runDay and flags skips against the plan so far.
  it('previews day splits and warns about actions that would be skipped', () => {
    const a = withQueue(flatGame(), ['hunt', 'scout', 'gather', 'wood', 'wood']);
    const p = previewQueue(a);
    // hunt is refused (no hours), scout 4, gather 5 → 9, wood → 13, next wood still starts today
    expect(p.dayOffset).toEqual([0, 0, 0, 0, 0]);
    expect(p.warnings[0]).toMatch(/no game tracked/);
    expect(p.warnings.slice(1)).toEqual([null, null, null, null]);
    expect(withQueue(a, ['water']).queue.length).toBe(6);
    expect(previewQueue(withQueue(a, ['water'])).dayOffset[5]).toBe(1);
  });

  // 5. Sites go through the sim; the run ends at the thaw (#1302), which clears the plan.
  it('settles a site, and ends the run at the thaw', () => {
    const a = settle(runQueuedDay(withQueue(flatGame(), ['scout'])), 'cave');
    expect(a.sim.site).toBe('cave');
    const left = runQueuedDay(withQueue(lastNight(a), ['rest', 'rest', 'rest', 'rest', 'rest', 'rest']));
    expect(left.sim.outcome).toMatchObject({ choice: 'thaw', kind: 'survived' });
    expect(left.queue).toEqual([]);
    // Once resolved, the queue can't grow and days don't run.
    expect(enqueue(left, 'rest')).toBe(left);
    expect(runQueuedDay(left)).toBe(left);
  });

  // 6. Saves round-trip; anything malformed or stale is rejected (never throws).
  it('round-trips a save and rejects corrupt or wrong-version data', () => {
    const a = runQueuedDay(withQueue(flatGame(), ['scout', 'water', 'wood', 'wood', 'gather']));
    expect(deserialize(serialize(a))).toEqual(a);

    expect(deserialize(null)).toBeNull();
    expect(deserialize('')).toBeNull();
    expect(deserialize('{not json')).toBeNull();
    expect(deserialize(JSON.stringify({ version: SAVE_VERSION + 1, sim: a.sim, queue: [] }))).toBeNull();
    // v1 saves (before tools existed) start fresh rather than load half-shaped.
    expect(deserialize(JSON.stringify({ version: 1, sim: a.sim, queue: [] }))).toBeNull();
    expect(deserialize(JSON.stringify({ version: 2, sim: a.sim, queue: [] }))).toBeNull();
    expect(deserialize(JSON.stringify({ version: 3, sim: a.sim, queue: [] }))).toBeNull();
    expect(deserialize(JSON.stringify({ version: 4, sim: a.sim, queue: [] }))).toBeNull();
    expect(deserialize(JSON.stringify({ version: 5, sim: a.sim, queue: [] }))).toBeNull();
    expect(deserialize(JSON.stringify({ version: 6, sim: a.sim, queue: [] }))).toBeNull();
    const { known: _k, ...noKnown } = a.sim;
    expect(deserialize(JSON.stringify({ version: SAVE_VERSION, sim: noKnown, queue: [] }))).toBeNull();
    // Options chosen on a queued build round-trip; malformed options don't load.
    const planned = setOption(enqueue(a, 'build'), 0, 'type', 'hut');
    expect(deserialize(serialize(planned))).toEqual(planned);
    expect(deserialize(JSON.stringify({ version: SAVE_VERSION, sim: a.sim, queue: [{ q: 'build', opts: { type: 3 } }] }))).toBeNull();
    // Ring-aimed queue entries round-trip; nonsense rings or rings on camp actions don't load.
    const roaming = withQueue(a, ['wood@2', 'scout@3']);
    expect(deserialize(serialize(roaming))).toEqual(roaming);
    expect(deserialize(JSON.stringify({ version: SAVE_VERSION, sim: a.sim, queue: ['wood@5'] }))).toBeNull();
    expect(deserialize(JSON.stringify({ version: SAVE_VERSION, sim: a.sim, queue: ['rest@2'] }))).toBeNull();
    const { explore: _e, ...noMap } = a.sim;
    expect(deserialize(JSON.stringify({ version: SAVE_VERSION, sim: noMap, queue: [] }))).toBeNull();
    const graded = { ...a, sim: { ...a.sim, tier: 1 as const, shelterGrade: 'fine' as const } };
    expect(deserialize(serialize(graded))).toEqual(graded);
    const { tools: _t, ...noTools } = a.sim;
    expect(deserialize(JSON.stringify({ version: SAVE_VERSION, sim: noTools, queue: [] }))).toBeNull();
    // Tools and concepts round-trip.
    const crafted = { ...a, sim: { ...a.sim, tools: [{ item: 'stone-knife', grade: 'fine' as const }], concepts: { sharpening: { rank: 1, insight: 2 } } } };
    expect(deserialize(serialize(crafted))).toEqual(crafted);
    expect(deserialize(JSON.stringify({ version: SAVE_VERSION, sim: a.sim, queue: ['fly'] }))).toBeNull();
    expect(deserialize(JSON.stringify({ version: SAVE_VERSION, sim: { ...a.sim, vitals: null }, queue: [] }))).toBeNull();
    expect(deserialize(JSON.stringify({ version: SAVE_VERSION, sim: { ...a.sim, day: 'one' }, queue: [] }))).toBeNull();
  });

  // 7. Options live on their queue entry and change the preview.
  it('sets an option on one queued entry and previews its cost', () => {
    const played = settle(runQueuedDay(withQueue(flatGame(), ['scout', 'wood', 'wood'])), 'cave');
    const a = { ...played, sim: { ...played.sim, known: [...played.sim.known, 'shelter-hut'] } }; // the hut is discovered
    const q = withQueue(a, ['build', 'rest']);
    const hut = setOption(q, 0, 'type', 'hut');
    expect(hut.queue).toEqual([{ q: 'build', opts: { type: 'hut' } }, 'rest']);
    expect(setOption(hut, 0, 'site', 'tree').queue[0]).toEqual({ q: 'build', opts: { type: 'hut', site: 'tree' } });
    expect(setOption(q, 7, 'type', 'hut')).toBe(q); // out of range: no-op
    // The preview runs the chosen design: a hut is 11h against the lean-to's 8h.
    expect(previewQueue(hut).projected.shelter.type).toBe('hut');
    expect(previewQueue(q).projected.shelter.type).toBe('leanto');
  });

  // 8. (#1224) A run is recorded once when it resolves; history saves separately and survives bad data.
  it('records finished runs and starts the next one', () => {
    const a = settle(runQueuedDay(withQueue(flatGame(), ['scout', 'track'])), 'cave');
    const done = runQueuedDay(lastNight(a));

    let h = recordRun([], a, done);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ run: 1, kind: 'survived', choice: 'thaw' });
    expect(recordRun(h, done, done)).toHaveLength(1); // already resolved before: no double record
    expect(recordRun(h, a, a)).toHaveLength(1); // not resolved: nothing to record

    // The next run is someone new (#1455): the last Warden's tools pass on (those the next pack doesn't match), their knowledge (the snare) doesn't.
    const finished = { ...done.sim, tools: [...done.sim.tools, { item: 'stone-knife', grade: 'masterwork' as const }] };
    const next = newRun(finished);
    expect(next.sim.known).not.toContain('trap-snare');
    expect(next.sim.character.id).not.toBe(done.sim.character.id);
    expect(next.sim.tools.filter(t => t.heirloom)).toEqual([{ item: 'stone-knife', grade: 'masterwork', heirloom: true }]);
    expect(bestPerItem(finished.tools).map(t => t.item)).toContain('stone-knife');
    expect(newRun(a.sim).sim.tools.some(t => t.heirloom)).toBe(false); // an unfinished run leaves nothing

    h = recordRun(h, a, done);
    expect(h.map(r => r.run)).toEqual([2, 1]);
    expect(deserializeHistory(serializeHistory(h))).toEqual(h);
    expect(deserializeHistory(null)).toEqual([]);
    expect(deserializeHistory('{oops')).toEqual([]);
    expect(deserializeHistory(JSON.stringify({ version: 1, runs: [{ run: 'x' }] }))).toEqual([]);
  });
});

/** A fresh hex-world (#1900) game, with the switch forced on or off. */
const hexGame = (on: boolean): AppState => makeWarden({ id: on ? 'w-hexsave' : 'w-hexoff' }, undefined, { [HEX_WORLD]: on });
const rawSave = (sim: Region1State, queue: AppState['queue'] = []): string => JSON.stringify({ version: SAVE_VERSION, sim, queue });

describe('hex-world saves: seenWorld, heardHexes and worldGen (#1900)', () => {
  // 2. Given that state (seenOut/seenWorld/worldGen from noteSeenCells), plus afield and heardHexes,
  // serialize → deserialize brings them back equal, with heardHexes sorted.
  it('round-trips seenWorld, heardHexes, worldGen and a world afield, sorting heardHexes', () => {
    const a = hexGame(true);
    const sim: Region1State = {
      ...a.sim,
      afield: { x: -5, y: 3 },
      seenWorld: [packCell({ cx: -2, cy: 5 }), packCell({ cx: 50, cy: 40 })],
      heardHexes: ['0,2', '-1,3'],
      worldGen: WORLDGEN_VERSION,
    };
    const back = deserialize(rawSave(sim, a.queue))!;
    expect(back.sim.seenWorld).toEqual(sim.seenWorld);
    expect(back.sim.worldGen).toBe(WORLDGEN_VERSION);
    expect(back.sim.afield).toEqual(sim.afield);
    expect(back.sim.heardHexes).toEqual(['-1,3', '0,2']);
  });

  // 3. Malformed values drop just that field; the rest of the save still loads.
  it('drops malformed seenWorld, heardHexes and afield values, keeping the rest of the save', () => {
    const a = hexGame(true);
    const bad = (sim: Partial<Region1State>): AppState => deserialize(rawSave({ ...a.sim, ...sim } as Region1State, a.queue))!;

    const badSeenWorld = bad({ seenWorld: [1.5] });
    expect(badSeenWorld.sim.seenWorld).toBeUndefined();
    expect(badSeenWorld).not.toBeNull();

    const notArray = bad({ seenWorld: 'x' as unknown as number[] });
    expect(notArray.sim.seenWorld).toBeUndefined();

    const badHeard = bad({ heardHexes: ['north'] });
    expect(badHeard.sim.heardHexes).toBeUndefined();

    const fracAfield = bad({ afield: { x: -5.5, y: 0 } });
    expect(fracAfield.sim.afield).toBeUndefined();

    const farAfield = bad({ afield: { x: 500, y: 0 } });
    expect(farAfield.sim.afield).toBeUndefined();
  });

  // 4. A worldGen mismatch drops seenWorld/worldGen, and an afield the mismatch strands outside the
  // Reach — but an afield inside the Reach rectangle is unaffected, since the Reach never moves.
  it('drops seenWorld, worldGen and an out-of-Reach afield on a worldGen mismatch, keeping one inside the Reach', () => {
    const a = hexGame(true);
    const stranded = deserialize(rawSave({ ...a.sim, worldGen: 0, seenWorld: [packCell({ cx: -2, cy: 5 })], afield: { x: -5, y: 3 } } as Region1State, a.queue))!;
    expect(stranded.sim.seenWorld).toBeUndefined();
    expect(stranded.sim.worldGen).toBeUndefined();
    expect(stranded.sim.afield).toBeUndefined();

    const athome = deserialize(rawSave({ ...a.sim, worldGen: 0, seenWorld: [packCell({ cx: -2, cy: 5 })], afield: { x: 10, y: 10 } } as Region1State, a.queue))!;
    expect(athome.sim.afield).toEqual({ x: 10, y: 10 });
  });

  // 5. With hex-world off, noteSeenCells is covered in hex-knowledge.test.ts; here, a save holding
  // all three fields loads with none of them, and afield is dropped as it is today.
  it('drops seenWorld, heardHexes, worldGen and afield with hex-world off', () => {
    const a = hexGame(false);
    const sim: Region1State = { ...a.sim, afield: { x: -5, y: 3 }, seenWorld: [packCell({ cx: -2, cy: 5 })], heardHexes: ['0,2'], worldGen: WORLDGEN_VERSION };
    const back = deserialize(rawSave(sim, a.queue))!;
    expect(back.sim.seenWorld).toBeUndefined();
    expect(back.sim.heardHexes).toBeUndefined();
    expect(back.sim.worldGen).toBeUndefined();
    expect(back.sim.afield).toBeUndefined();
  });

  // 6. An existing save (this file's own round-trip fixture, with no hex-world fields at all)
  // deep-equals today's load: see "round-trips a save and rejects corrupt or wrong-version data" above.
  // That fixture is a flat world with no switches, so here is one with directed-explore and
  // walk-the-map's fields too (afield, seenOut, trail), with hex-world (#1899) off and on.
  it('loads a save from before #1900 exactly as saved, with hex-world off or on', () => {
    for (const on of [false, true]) {
      const a = hexGame(on);
      const old: AppState = { ...a, sim: { ...a.sim, afield: { x: 10, y: 10 }, seenOut: [5, 100], trail: [{ day: 1, path: [1, 2] }] } };
      expect(deserialize(serialize(old))).toEqual(old);
    }
  });
});

describe('hex-world saves: what the writer writes, the loader keeps (#1900 review)', () => {
  const reload = (a: AppState): AppState => deserialize(serialize(a))!;

  // A stray seenWorld entry (past the window, not a cell at all) costs only itself, and a cell past
  // the window is never written by noteSeenCells, so everything it did write loads back.
  it('loads back all noteSeenCells wrote, and keeps the rest of seenWorld past a stray entry', () => {
    const a = hexGame(true);
    noteSeenCells(a.sim, [{ cx: -2, cy: 5 }, { cx: 50, cy: 40 }, { cx: -13, cy: 0 }]);
    const back = reload(a);
    expect(back.sim.seenWorld).toEqual([packCell({ cx: -2, cy: 5 }), packCell({ cx: 50, cy: 40 })]);
    expect(back.sim.worldGen).toBe(WORLDGEN_VERSION);

    const strays = [packCell({ cx: -2, cy: 5 }), packCell({ cx: 100, cy: 0 }), 1.5, 'x', -1, null];
    const stray = deserialize(rawSave({ ...a.sim, seenWorld: strays as number[], worldGen: WORLDGEN_VERSION }, a.queue))!;
    expect(stray.sim.seenWorld).toEqual([packCell({ cx: -2, cy: 5 })]);
  });

  // A worldGen that matches is kept on its own, not only beside a surviving seenWorld: else a Warden
  // outside the Reach keeps their afield on the first load, loses worldGen, and is sent back to camp
  // on the next one.
  it('keeps an out-of-Reach afield and worldGen through two reloads, with or without seenWorld', () => {
    const a = hexGame(true);
    for (const seenWorld of [[1.5], undefined]) {
      const once = deserialize(rawSave({ ...a.sim, worldGen: WORLDGEN_VERSION, seenWorld, afield: { x: -5, y: 3 } } as Region1State, a.queue))!;
      expect(once.sim.afield).toEqual({ x: -5, y: 3 });
      const twice = reload(once);
      expect(twice.sim.afield).toEqual({ x: -5, y: 3 });
      expect(twice.sim.worldGen).toBe(WORLDGEN_VERSION);
      expect(twice).toEqual(once);
    }
  });

  // noteSeenCells puts Reach cells in seenOut with hex-world on alone, so the load keeps seenOut with
  // hex-world on alone too: else a reload forgets the Reach sightings and remembers the outside ones.
  it('keeps seenOut with hex-world on, even with directed-explore and walk-the-map off', () => {
    const only = { [HEX_WORLD]: true, [DIRECTED_EXPLORE]: false, [WALK_THE_MAP]: false };
    const a = makeWarden({ id: 'w-hexonly' }, undefined, only);
    noteSeenCells(a.sim, [{ cx: 3, cy: 4 }, { cx: -2, cy: 5 }]);
    const back = reload(a);
    expect(back.sim.seenOut).toEqual([4 * 48 + 3]);
    expect(back.sim.seenWorld).toEqual([packCell({ cx: -2, cy: 5 })]);
    // With all three off, a stray seenOut is dropped, as before #1900.
    const off = makeWarden({ id: 'w-hexonly' }, undefined, { ...only, [HEX_WORLD]: false });
    expect(reload({ ...off, sim: { ...off.sim, seenOut: [3] } }).sim.seenOut).toBeUndefined();
  });

  // seenWorld's doc promises sorted, unique cells outside the Reach; the load makes it so, as it does heardHexes.
  it('sorts and dedupes seenWorld on load, dropping Reach cells', () => {
    const a = hexGame(true);
    const mixed = [packCell({ cx: 50, cy: 40 }), packCell({ cx: -2, cy: 5 }), packCell({ cx: 50, cy: 40 }), packCell({ cx: 3, cy: 4 })];
    const back = deserialize(rawSave({ ...a.sim, worldGen: WORLDGEN_VERSION, seenWorld: mixed }, a.queue))!;
    expect(back.sim.seenWorld).toEqual([packCell({ cx: -2, cy: 5 }), packCell({ cx: 50, cy: 40 })]);
    const reachOnly = deserialize(rawSave({ ...a.sim, worldGen: WORLDGEN_VERSION, seenWorld: [packCell({ cx: 3, cy: 4 })] }, a.queue))!;
    expect(reachOnly.sim.seenWorld).toBeUndefined();
  });

  // heardHexes keys load as `hexKey` writes them, so '01,2' and '1,2' are one hex and a lookup by hexKey finds it.
  it('canonicalises heardHexes keys on load, dropping ones that do not parse', () => {
    const a = hexGame(true);
    const back = deserialize(rawSave({ ...a.sim, heardHexes: ['01,2', '-0,3', '0,3', '1,2'] }, a.queue))!;
    expect(back.sim.heardHexes).toEqual(['0,3', '1,2']);
    const rough = deserialize(rawSave({ ...a.sim, heardHexes: ['-1,-0', 'north', '99999999999999999999,0', '2,1'] }, a.queue))!;
    expect(rough.sim.heardHexes).toEqual(['-1,0', '2,1']);
  });
});
