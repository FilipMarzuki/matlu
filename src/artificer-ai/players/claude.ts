/**
 * Claude as an Artificer player (#1226), via the official Anthropic SDK.
 *
 * - One conversation per run: each day adds the observation and Claude's full
 *   reply (thinking blocks included), so the history is a stable, cacheable
 *   prefix. It's bounded (#1448): past 2 × HISTORY_TURNS exchanges the oldest are
 *   dropped in one block, and the replies kept lose their thinking — a thinking
 *   block belongs to the conversation that produced it, and that prefix is gone.
 * - The rules are the system prompt, marked for prompt caching; a top-level
 *   cache breakpoint also caches the growing conversation.
 * - Structured output: the reply must match DECISION_SCHEMA — or, on the caravan
 *   road (#1251), ROAD_DECISION_SCHEMA, and in an encounter (#1348),
 *   ENCOUNTER_DECISION_SCHEMA; and packing for the hike (#1401), PACK_DECISION_SCHEMA — all in the same conversation.
 * - Adaptive thinking with an explicit effort (Claude Opus 5.5 defaults to
 *   medium; we set it so a model swap doesn't silently change it).
 * - Safety-classifier declines are handled: `fallbacks: "default"` lets the
 *   API re-run a declined turn on Anthropic's recommended fallback model.
 *
 * Credentials come from the environment (ANTHROPIC_API_KEY, an auth token, or
 * an `ant auth login` profile) — nothing is hard-coded.
 *
 * Priced (#1506): each call's cost comes from its token usage and CLAUDE_PRICES, so
 * `--budget` caps a Claude run as it does an OpenRouter one. The default is the cheap
 * playtest setting, Claude Haiku 5.5 at low effort.
 */

import Anthropic from '@anthropic-ai/sdk';
import { trimHistory, HISTORY_TURNS } from '../history';
import { RULES } from '../observe';
import { DECISION_SCHEMA, ROAD_DECISION_SCHEMA, ENCOUNTER_DECISION_SCHEMA, PACK_DECISION_SCHEMA } from '../decision';
import type { Player } from '../runner';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ClaudePlayerOptions {
  model?: string;
  effort?: Effort;
  client?: Anthropic;
  /** Recent exchanges kept in the conversation (#1448); older ones are trimmed in blocks. */
  historyTurns?: number;
}

/**
 * USD per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing
 * (read 2026-10-10). Cache writes are the 5-minute kind (`cache_control: ephemeral`). Haiku 5.5
 * is priced by prompt length: over 100k tokens (cache included), the whole call costs more.
 * A model not listed here is unpriced: its calls count as unknown, never as free.
 */
interface Rates { input: number; cacheWrite: number; cacheRead: number; output: number }
export const CLAUDE_PRICES: Readonly<Record<string, { rates: Rates; long?: { over: number; rates: Rates } }>> = {
  'claude-haiku-5-5': {
    rates: { input: 0.10, cacheWrite: 0.125, cacheRead: 0.01, output: 0.50 },
    long: { over: 100_000, rates: { input: 0.50, cacheWrite: 0.625, cacheRead: 0.05, output: 2.50 } },
  },
  'claude-haiku-4-5': { rates: { input: 1, cacheWrite: 1.25, cacheRead: 0.10, output: 5 } },
  'claude-sonnet-5-5': { rates: { input: 2, cacheWrite: 2.50, cacheRead: 0.10, output: 10 } },
  'claude-opus-5-5': { rates: { input: 4, cacheWrite: 5, cacheRead: 0.20, output: 20 } },
};

/** What a call cost in USD, from its usage; null for a model with no price. */
export function claudeCost(model: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number }): number | null {
  const price = CLAUDE_PRICES[model];
  if (!price) return null;
  const prompt = u.input + u.cacheRead + u.cacheWrite;
  const r = price.long && prompt > price.long.over ? price.long.rates : price.rates;
  return (u.input * r.input + u.cacheWrite * r.cacheWrite + u.cacheRead * r.cacheRead + u.output * r.output) / 1e6;
}

/** Keywords structured outputs rejects with a 400 (its docs: numeric and string constraints, arrays past minItems 1). */
const UNSUPPORTED = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems'] as const;

/**
 * A schema structured outputs accepts (#1506): the unsupported limits come out, and what they
 * said goes into the field's description, so the model still knows them ("1 to 3"). The runner
 * checks every reply against the real rules, so nothing is lost. This is what the SDK's own
 * schema helpers do.
 */
export function forStructuredOutput(schema: Record<string, unknown>): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const o = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const said: string[] = [];
    for (const [k, v] of Object.entries(o)) {
      if ((UNSUPPORTED as readonly string[]).includes(k)) continue;
      if (k === 'minItems' && typeof v === 'number' && v > 1) { said.push(`at least ${v} items`); continue; }
      out[k] = walk(v);
    }
    if (typeof o.minimum === 'number' && typeof o.maximum === 'number') said.push(`${o.minimum} to ${o.maximum}`);
    else if (typeof o.minimum === 'number') said.push(`at least ${o.minimum}`);
    else if (typeof o.maximum === 'number') said.push(`at most ${o.maximum}`);
    if (typeof o.maxItems === 'number') said.push(`at most ${o.maxItems} items`);
    if (typeof o.minLength === 'number') said.push(`at least ${o.minLength} characters`);
    if (typeof o.maxLength === 'number') said.push(`at most ${o.maxLength} characters`);
    if (said.length) out.description = [typeof o.description === 'string' ? o.description : '', `(${said.join('; ')})`].filter(Boolean).join(' ');
    return out;
  };
  return walk(schema) as Record<string, unknown>;
}

export function claudePlayer(opts: ClaudePlayerOptions = {}): Player {
  const client = opts.client ?? new Anthropic();
  // The cheap playtest default (#1506): Haiku 5.5 at low effort. --model and --effort change it.
  const model = opts.model ?? 'claude-haiku-5-5';
  const effort = opts.effort ?? 'low';
  // The four reply schemas, made acceptable to structured outputs once.
  const schemas = new Map<Record<string, unknown>, Record<string, unknown>>();
  const accepted = (schema: Record<string, unknown>) => schemas.get(schema) ?? schemas.set(schema, forStructuredOutput(schema)).get(schema)!;
  const messages: Anthropic.Beta.BetaMessageParam[] = [];

  async function send(message: string, schema: Record<string, unknown>) {
    // A recent window (#1448). After a cut, the kept replies keep their text but not their
    // thinking: those blocks were written after turns that are no longer in the conversation.
    if (trimHistory(messages, opts.historyTurns ?? HISTORY_TURNS) > 0) {
      for (const m of messages) {
        if (m.role === 'assistant' && Array.isArray(m.content)) {
          m.content = m.content.filter(b => b.type !== 'thinking' && b.type !== 'redacted_thinking');
          // A reply that was all thinking (cut off by max_tokens) would be left empty, which the API rejects.
          if (!m.content.length) m.content = [{ type: 'text', text: '(no reply)' }];
        }
      }
    }
    messages.push({ role: 'user', content: message });
    // Streaming keeps long thinking turns clear of HTTP timeouts; we only need the final message.
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort, format: { type: 'json_schema', schema: accepted(schema) } },
      system: [{ type: 'text', text: RULES, cache_control: { type: 'ephemeral' } }],
      cache_control: { type: 'ephemeral' },
      messages,
    });
    const response = await stream.finalMessage();

    if (response.stop_reason === 'refusal') {
      throw new Error(`Claude declined the turn (${response.stop_details?.category ?? 'no category'}).`);
    }
    // Keep the full reply (thinking included): between history cuts (#1448) the conversation only grows, so it stays a cacheable prefix.
    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'max_tokens') {
      return { text: '', usage: usageOf(response, model) }; // the runner treats an empty reply as invalid and asks again
    }
    const text = response.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
    return { text, usage: usageOf(response, model) };
  }

  return {
    name: `claude:${model}:${effort}`,
    decide: message => send(message, DECISION_SCHEMA as unknown as Record<string, unknown>),
    decideRoad: message => send(message, ROAD_DECISION_SCHEMA as unknown as Record<string, unknown>),
    decideEncounter: message => send(message, ENCOUNTER_DECISION_SCHEMA as unknown as Record<string, unknown>),
    decidePack: message => send(message, PACK_DECISION_SCHEMA as unknown as Record<string, unknown>),
  };
}

/**
 * Tokens, and what they cost (#1506). Priced by the model that answered (`fallbacks` can re-run a
 * declined turn on another model), or the one asked for when the answer names a model we don't price.
 */
function usageOf(r: Anthropic.Beta.BetaMessage, model: string) {
  const tokens = {
    input: r.usage.input_tokens,
    output: r.usage.output_tokens,
    cacheRead: r.usage.cache_read_input_tokens ?? 0,
    cacheWrite: r.usage.cache_creation_input_tokens ?? 0,
  };
  return { ...tokens, cost: claudeCost(r.model && CLAUDE_PRICES[r.model] ? r.model : model, tokens) };
}
