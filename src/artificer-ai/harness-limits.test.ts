/**
 * Acceptance tests for #1448 (history stays bounded, so a whole-year game fits any model's
 * context) and #1449 (the budget is checked after every model call, not between runs).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { trimHistory, HISTORY_TURNS } from './history';
import { openRouterPlayer } from './players/openrouter';
import { playRun, BudgetExceeded, type Player } from './runner';
import { scriptedPlayer } from './players/scripted';
import { SHORT_YEAR } from '../artificer/test-helpers';

type Msg = { role: 'system' | 'user' | 'assistant'; content: string };
const conversation = (exchanges: number): Msg[] => [
  { role: 'system', content: 'rules' },
  ...Array.from({ length: exchanges }, (_, i) => [{ role: 'user' as const, content: `turn ${i}` }, { role: 'assistant' as const, content: `reply ${i}` }]).flat(),
];

afterEach(() => vi.unstubAllGlobals());

describe('Bounded history (#1448)', () => {
  // 2. The rules and the most recent turns always stay; old turns go in a block.
  it('keeps the rules and the recent turns, trimming in blocks', () => {
    const m = conversation(2 * HISTORY_TURNS);
    expect(trimHistory(m, HISTORY_TURNS, 1)).toBe(0); // up to 2 × keep: nothing to trim yet
    m.push({ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' });
    trimHistory(m, HISTORY_TURNS, 1);
    expect(m[0]).toEqual({ role: 'system', content: 'rules' });
    expect(m[1].role).toBe('user');
    expect((m.length - 1) / 2).toBe(HISTORY_TURNS);
    expect(m.at(-1)).toEqual({ role: 'assistant', content: 'y' });
    // Between cuts the prefix doesn't move, so caching keeps working.
    const prefix = JSON.stringify(m.slice(0, 3));
    for (let i = 0; i < HISTORY_TURNS - 1; i++) { m.push({ role: 'user', content: 'u' }, { role: 'assistant', content: 'a' }); trimHistory(m, HISTORY_TURNS, 1); }
    expect(JSON.stringify(m.slice(0, 3))).toBe(prefix);
  });

  it('never starts the kept history on a reply', () => {
    const m: Msg[] = [{ role: 'system', content: 'r' }, { role: 'assistant', content: 'stray' }, ...conversation(40).slice(1)];
    trimHistory(m, 4, 1);
    expect(m[1].role).toBe('user');
  });

  // 1. A long game through the OpenRouter player: no request grows past the window.
  it('keeps every request bounded over a long game', async () => {
    const sizes: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      sizes.push(JSON.parse(init.body).messages.length);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"thoughts":"","queue":[]}' } }], usage: { cost: 0 } }), { status: 200 });
    }));
    const p = openRouterPlayer({ model: 'test/model', apiKey: 'k' });
    for (let i = 0; i < 120; i++) await p.decide(`observation ${i}`, undefined as never);
    expect(sizes).toHaveLength(120);
    // The rules, at most 2 × keep exchanges, and the new turn.
    expect(Math.max(...sizes)).toBeLessThanOrEqual(1 + 2 * (2 * HISTORY_TURNS) + 1);
  });
});

describe('Budget checked after every call (#1449)', () => {
  /** The scripted player, but every call reports a cost. */
  const costly = (each: number): Player => {
    const base = scriptedPlayer();
    const wrap = <A extends unknown[]>(f: (...a: A) => Promise<{ text: string; usage?: object }>) =>
      async (...a: A) => ({ ...(await f(...a)), usage: { cost: each } });
    return { ...base, name: 'costly', decide: wrap(base.decide.bind(base)) };
  };

  // 1. --budget 0.1, $0.05 a call: the run stops after the call that reaches $0.10, and says why.
  it('stops the run once the budget is reached', async () => {
    const err = await playRun(costly(0.05), { calendar: SHORT_YEAR, budget: 0.1 }).catch(e => e);
    expect(err).toBeInstanceOf(BudgetExceeded);
    const partial = (err as BudgetExceeded).partial;
    expect(partial.usage.cost).toBeCloseTo(0.1);
    expect(partial.record).toMatchObject({ kind: 'stopped', choice: 'budget' });
    expect(partial.turns.length).toBeLessThanOrEqual(2);
  });

  // Parallel games share one budget through a guard counted after every call (ai:bench).
  it('stops through a shared spend guard', async () => {
    let spent = 0;
    const err = await playRun(costly(0.05), { calendar: SHORT_YEAR, spendGuard: c => (spent += c) < 0.15 }).catch(e => e);
    expect(err).toBeInstanceOf(BudgetExceeded);
    expect(spent).toBeCloseTo(0.15);
  });

  // 2. Without a budget, or under it, the run plays out as before.
  it('plays out when under budget', async () => {
    const r = await playRun(costly(0.001), { calendar: SHORT_YEAR, budget: 100, planning: 'open' });
    expect(r.record.kind).not.toBe('stopped');
  }, 60_000);
});
