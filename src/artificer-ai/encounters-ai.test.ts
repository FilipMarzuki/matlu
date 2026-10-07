/**
 * Acceptance tests for #1348 — the AI harness plays encounters: the observation lists the
 * options with their odds in words, the runner applies a choice and finishes the day, an
 * invalid choice falls back to the safest option, random runs keep every invariant, and the
 * report counts encounters and the deaths they caused. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { encounterById, safestOption } from '../artificer/encounters';
import { observeEncounter } from './observe';
import { parseEncounterDecision } from './decision';
import { playRun, type Player } from './runner';
import { scriptedPlayer } from './players/scripted';
import { randomPlayer } from './players/random';
import { invariantViolations } from './invariants';
import { aggregate, deathCause, type Transcript } from './report';
import { progressOf } from './progress';

const ON = { ...FULL_WORLD, encounters: true };

/** A Warden standing in front of an encounter, mid-morning on day 1. */
function meeting(id: string, ring: 1 | 2 | 3 = 1): Region1State {
  const s = createRegion1({ world: ON }, undefined, { id: 'w-enc-ai' });
  return { ...s, pending: { id, day: 1, hour: 10, ring, action: 'hunt' }, encounterDay: 1 };
}

/** A day plan that goes out on the land over and over: plenty of chances to meet something. */
const OUTINGS = [
  { action: 'scout', ring: 1, options: [] }, { action: 'water', ring: 1, options: [] },
  { action: 'wood', ring: 1, options: [] }, { action: 'water', ring: 1, options: [] },
];

/**
 * A test double: the scripted planner's days in the open-planning world, the same outings every
 * day, and `answer` for every encounter (whatever it is given, it says the same thing back).
 */
function outingsPlayer(answer: (s: Region1State) => string): Player & { asked: string[] } {
  const asked: string[] = [];
  return {
    name: 'outings', asked,
    async decide() { return { text: JSON.stringify({ thoughts: 'out again', site: null, queue: OUTINGS }) }; },
    async decideEncounter(message, s) { asked.push(message); return { text: answer(s) }; },
  };
}

/** Play outings until a run meets an encounter with the day's queue still to go. */
async function runWithEncounter(answer: (s: Region1State) => string) {
  for (let i = 1; i <= 80; i++) {
    const player = outingsPlayer(answer);
    const r = await playRun(player, { characterId: `ai-enc-${i}`, planning: 'open', maxDays: 61 });
    const t = r.turns.find(x => x.encounters?.length);
    if (t) return { r, t, player };
  }
  throw new Error('no run met an encounter');
}

describe('The AI harness plays encounters (#1348)', () => {
  // 1. A pending encounter: observe lists each option with its odds word and any requirement.
  it('lists each option with its odds in words, its cost, and what it needs', () => {
    const fox = observeEncounter(meeting('fox-at-the-treeline'));
    expect(fox).toMatch(/^ENCOUNTER — day 1, 10:00, ring 1 near, while out to hunt/);
    expect(fox).toContain(encounterById('fox-at-the-treeline')!.text);
    expect(fox).toMatch(/- watch: Stand still and watch — safe/);
    expect(fox).toMatch(/- chase: Chase it for the hare — (likely|risky|desperate)/);
    // A novice hunter can't follow it home: the requirement is shown, not the odds.
    expect(fox).toMatch(/- stalk: Follow it home — NOT AVAILABLE \(needs hunting 3\)/);
    expect(fox).toMatch(/"choice": "<option id>"/);
    // Costs are shown before the odds.
    expect(observeEncounter(meeting('crumbling-ledge', 2))).toMatch(/- go-around: Go the long way round to it — costs 2h — (safe|likely|risky|desperate)/);
    // Nothing waiting: nothing to show.
    expect(observeEncounter(createRegion1({ world: ON }))).toBe('');
    // The reply is checked against what's on offer.
    const offered = [{ id: 'watch', unmet: null }, { id: 'stalk', unmet: 'needs hunting 3' }];
    expect(parseEncounterDecision('{"thoughts":"","choice":"watch"}', offered)).toEqual({ ok: true, decision: { thoughts: '', choice: 'watch' } });
    expect(parseEncounterDecision('{"choice":"stalk"}', offered)).toMatchObject({ ok: false, errors: [expect.stringMatching(/isn't open to you \(needs hunting 3\) — choose one of: watch/)] });
    expect(parseEncounterDecision('{"choice":"back-away"}', offered)).toMatchObject({ ok: false, errors: [expect.stringMatching(/not an option here/)] });
  });

  // 2. An AI reply naming an option: the encounter resolves and the rest of the day runs.
  it('applies the choice, then runs the rest of the day', async () => {
    // Play it safe: name the safest option, whatever the encounter turns out to be.
    const careful = (s: Region1State) => JSON.stringify({ thoughts: 'carefully', choice: safestOption(s, encounterById(s.pending!.id)!).id });
    const { t, player } = await runWithEncounter(careful);
    const [e] = t.encounters!;
    expect(player.asked[0]).toMatch(/^ENCOUNTER/);
    expect(e.forced).toBeUndefined();
    // The choice is in the journal (unless panic took over), and the day went on after it: more work, then the night.
    const label = encounterById(e.id)!.options.find(o => o.id === (e.override?.taken ?? e.choice))?.label ?? '';
    const at = t.journal.findIndex(l => l.startsWith(`${label}:`) || l.startsWith('You meant to'));
    expect(at).toBeGreaterThan(0);
    expect(t.journal.length).toBeGreaterThan(at + 1);
    expect(t.violations).toBeUndefined();
  });

  // 3. An invalid choice twice: the safest available option is taken, and the turn is marked.
  it('takes the safest option after two invalid choices, and marks it', async () => {
    const { t, player } = await runWithEncounter(() => '{"choice":"bite-it"}');
    const [e] = t.encounters!;
    expect(player.asked).toHaveLength(2);
    expect(player.asked[1]).toMatch(/^Your choice was invalid:\n- "bite-it" is not an option here — choose one of:/);
    const safest = safestOption(createRegion1({ world: ON }), encounterById(e.id)!).id;
    expect(e).toMatchObject({ choice: safest, forced: true, reply: '{"choice":"bite-it"}', errors: [expect.stringMatching(/not an option here/)] });
    // A player that can't choose at all always gets the safest option.
    const mute: Player = { name: 'mute', decide: async () => ({ text: JSON.stringify({ thoughts: '', site: null, queue: OUTINGS }) }) };
    let forced = 0;
    for (let i = 1; i <= 20; i++) {
      const run = await playRun(mute, { characterId: `ai-enc-${i}`, planning: 'open' });
      // The safest is sure for most animals; a boar has nothing safer than "likely".
      for (const x of run.turns.flatMap(u => u.encounters ?? [])) { forced++; expect(x.forced).toBe(true); expect(['safe', 'likely']).toContain(x.odds); }
    }
    expect(forced).toBeGreaterThan(0);
  });

  // 4. 50 random-player runs: no invariant breaks.
  it('keeps every invariant across 50 random runs with encounters', async () => {
    let met = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const mode = seed % 5 === 0 ? 'uniform' : 'legal';
      const r = await playRun(randomPlayer({ mode, seed }), { characterId: `ai-random-enc-${seed}` });
      for (const t of r.turns) {
        expect(t.violations).toBeUndefined();
        met += t.encounters?.length ?? 0;
        // At most one encounter a day.
        expect(t.encounters?.length ?? 0).toBeLessThanOrEqual(1);
      }
      expect(r.final.pending ?? null).toBeNull();
      expect(invariantViolations(r.final)).toEqual([]);
    }
    expect(met).toBeGreaterThan(0); // the runs did meet things
    // The invariant itself: a turn that ends with an encounter waiting is broken.
    expect(invariantViolations(meeting('fox-at-the-treeline'))).toEqual([expect.stringMatching(/encounter fox-at-the-treeline still waiting/)]);
  });

  // 5. Finished runs: the report counts encounters and deaths by encounter.
  it('counts encounters, choices by kind and deaths by encounter in the report', async () => {
    const s = createRegion1({ world: ON }, undefined, { id: 'w-enc-report' });
    const start = progressOf(s, s.known.length);
    const run = (encounters: NonNullable<Transcript['turns'][number]['encounters']>[], kind: string, last: string[] = []): Transcript => ({
      player: 'scripted', start,
      turns: encounters.map((e, i) => ({ day: i + 1, queue: [], invalid: false, progress: start, encounters: e, journal: i === encounters.length - 1 ? last : [] })),
      record: { kind, choice: kind === 'died' ? 'collapse' : 'survive', day: encounters.length, readyDay: null },
      usage: { input: 0, output: 0, cacheRead: 0, cost: 0 },
    });
    const [m] = aggregate([
      run([[{ id: 'fox-at-the-treeline', kind: 'animal', choice: 'watch' }], [], [{ id: 'crumbling-ledge', kind: 'find', choice: 'leave', forced: true }]], 'survived'),
      run([[{ id: 'crumbling-ledge', kind: 'find', choice: 'climb-down', died: true }]], 'died', ['The ledge gives way.', 'Killed by a fall from a crumbling ledge.']),
    ]);
    expect(m.encounters).toEqual({
      perRun: 1.5,
      choices: { animal: { watch: 1 }, find: { leave: 1, 'climb-down': 1 } },
      deaths: { 'crumbling-ledge': 1 },
      forced: 1,
    });
    expect(m.survival.deaths).toEqual({ encounter: 1 });
    expect(deathCause(['Killed by a fall from a crumbling ledge.'])).toBe('encounter');
    // The scripted baseline plays it safe, so encounters never kill it.
    const scripted = await playRun(scriptedPlayer(), { characterId: 'ai-scripted' });
    expect(scripted.turns.flatMap(t => t.encounters ?? []).every(e => ['safe', 'likely'].includes(e.odds) && !e.died)).toBe(true);
  });
});
