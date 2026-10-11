/**
 * Acceptance tests for #1506: the Claude player plays on the owner's Anthropic key — priced, so
 * `--budget` caps it like an OpenRouter run — and the bench falls back to OpenRouter once that
 * key's credit runs out.
 */

import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { claudePlayer, claudeCost, forStructuredOutput } from './players/claude';
import { withFallback, creditExhausted } from './players/fallback';
import { playRun, BudgetExceeded, type Player, type SpendLedger } from './runner';
import { scriptedPlayer } from './players/scripted';
import { DECISION_SCHEMA } from './decision';
import { SHORT_YEAR } from '../artificer/test-helpers';

/** A reply the runner accepts: rest the day. */
const REST = JSON.stringify({ thoughts: 'Rest.', focus: null, eating: null, site: null, forget: null, interest: [], queue: [{ action: 'rest', ring: 1, options: [] }] });

/** A stand-in for the SDK client: answers every turn with `reply`, billing `usage`, and keeps what it was sent. */
function fakeClient(usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }, reply = REST) {
  const sent: Record<string, unknown>[] = [];
  const client = {
    beta: { messages: { stream: (params: Record<string, unknown>) => {
      sent.push(params);
      return { finalMessage: async () => ({ model: params.model, stop_reason: 'end_turn', content: [{ type: 'text', text: reply }], usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage } }) };
    } } },
  } as unknown as Anthropic;
  return { client, sent };
}

describe('The Claude player on an Anthropic key (#1506)', () => {
  // 1. Known usage on Haiku 5.5 costs tokens × its prices, cache reads and writes included.
  it('prices a call from its usage', () => {
    // Haiku 5.5, prompts up to 100k tokens: $0.10 input, $0.125 5-minute cache write, $0.01 cache read, $0.50 output (per MTok).
    const cost = claudeCost('claude-haiku-5-5', { input: 2_000, output: 1_000, cacheRead: 10_000, cacheWrite: 4_000 });
    expect(cost).toBeCloseTo((2_000 * 0.10 + 4_000 * 0.125 + 10_000 * 0.01 + 1_000 * 0.50) / 1e6, 10);
    // Over 100k tokens of prompt (cache included), the whole call is billed at the long-prompt prices.
    const long = claudeCost('claude-haiku-5-5', { input: 1_000, output: 1_000, cacheRead: 120_000, cacheWrite: 0 });
    expect(long).toBeCloseTo((1_000 * 0.50 + 120_000 * 0.05 + 1_000 * 2.50) / 1e6, 10);
  });

  // 2. A $0.05 budget and $0.02 calls: no call starts once committed spend reaches the budget.
  it('stops a Claude run at the budget', async () => {
    // 200k output tokens on Haiku 5.5 is $0.10: too dear. Pick usage that costs exactly $0.02 a call.
    const { client } = fakeClient({ input_tokens: 0, output_tokens: 40_000 }); // 40k × $0.50/MTok = $0.02
    const ledger: SpendLedger = { spent: 0, budget: 0.05 };
    const err = await playRun(claudePlayer({ model: 'claude-haiku-5-5', client }), { calendar: SHORT_YEAR, ledger }).catch(e => e);
    expect(err).toBeInstanceOf(BudgetExceeded);
    expect((err as BudgetExceeded).partial.record).toMatchObject({ kind: 'stopped', choice: 'budget' });
    expect(ledger.spent).toBeGreaterThanOrEqual(0.05);
    expect(ledger.spent).toBeLessThan(0.05 + 0.02 + 1e-9);
  });

  // 3. A model with no price is counted as unpriced, and the run doesn't crash.
  it('treats an unpriced model as unpriced', async () => {
    expect(claudeCost('claude-unknown-9', { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })).toBeNull();
    const { client } = fakeClient({ input_tokens: 10, output_tokens: 10 });
    const r = await playRun(claudePlayer({ model: 'claude-unknown-9', client }), { calendar: SHORT_YEAR });
    expect(r.usage.cost).toBeNull();
  });

  // What the API is sent: no keyword structured outputs rejects (it 400s on integer minimum/maximum).
  it('sends a schema structured outputs accepts', async () => {
    const strip = JSON.stringify(forStructuredOutput(DECISION_SCHEMA as unknown as Record<string, unknown>));
    expect(strip).not.toMatch(/"(minimum|maximum|exclusiveMinimum|exclusiveMaximum|multipleOf|minLength|maxLength|maxItems)"/);
    // The limits survive as words, so the model still knows them.
    expect(strip).toMatch(/1–3|1 to 3|between 1 and 3|at least 1/);
    const { client, sent } = fakeClient({ input_tokens: 10, output_tokens: 10 });
    await claudePlayer({ model: 'claude-haiku-5-5', client }).decide('observe', undefined as never);
    expect(JSON.stringify(sent[0])).not.toMatch(/"(minimum|maximum)"/);
  });

  // Out of credit: the run carries on with the fallback player, and says so.
  it('falls back once the key is out of credit, and only then', async () => {
    const out = new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }, undefined, new Headers());
    const billing = new Anthropic.APIError(402, { type: 'error', error: { type: 'billing_error', message: 'billing' } }, undefined, new Headers());
    const schema = new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'output_config.format.schema: bad' } }, undefined, new Headers());
    expect([creditExhausted(out), creditExhausted(billing), creditExhausted(schema)]).toEqual([true, true, false]);

    const broke: Player = { name: 'claude:x', decide: async () => { throw out; } };
    const switched: string[] = [];
    const p = withFallback(broke, scriptedPlayer(), why => switched.push(why));
    const r = await playRun(p, { calendar: SHORT_YEAR });
    expect(r.record.kind).not.toBe('error');
    expect(switched).toHaveLength(1);
    expect(p.name).toMatch(/claude:x.*scripted/);
    // Any other error is the run's to report, not a reason to switch.
    const wrong: Player = { name: 'claude:y', decide: async () => { throw schema; } };
    await expect(withFallback(wrong, scriptedPlayer()).decide('o', undefined as never)).rejects.toBe(schema);
  });
});
