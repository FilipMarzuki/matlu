/**
 * Claude as an Artificer player (#1226), via the official Anthropic SDK.
 *
 * - One conversation per run, append-only: each day adds the observation and
 *   Claude's full reply (thinking blocks included), so the run's history is a
 *   stable, cacheable prefix and thinking stays valid turn to turn.
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
 */

import Anthropic from '@anthropic-ai/sdk';
import { RULES } from '../observe';
import { DECISION_SCHEMA, ROAD_DECISION_SCHEMA, ENCOUNTER_DECISION_SCHEMA, PACK_DECISION_SCHEMA } from '../decision';
import type { Player } from '../runner';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ClaudePlayerOptions {
  model?: string;
  effort?: Effort;
  client?: Anthropic;
}

export function claudePlayer(opts: ClaudePlayerOptions = {}): Player {
  const client = opts.client ?? new Anthropic();
  const model = opts.model ?? 'claude-opus-5-5';
  const effort = opts.effort ?? 'medium';
  const messages: Anthropic.Beta.BetaMessageParam[] = [];

  async function send(message: string, schema: Record<string, unknown>) {
    messages.push({ role: 'user', content: message });
    // Streaming keeps long thinking turns clear of HTTP timeouts; we only need the final message.
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort, format: { type: 'json_schema', schema } },
      system: [{ type: 'text', text: RULES, cache_control: { type: 'ephemeral' } }],
      cache_control: { type: 'ephemeral' },
      messages,
    });
    const response = await stream.finalMessage();

    if (response.stop_reason === 'refusal') {
      throw new Error(`Claude declined the turn (${response.stop_details?.category ?? 'no category'}).`);
    }
    // Keep the full reply (thinking included) so the history stays append-only and valid.
    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'max_tokens') {
      return { text: '', usage: usageOf(response) }; // the runner treats an empty reply as invalid and asks again
    }
    const text = response.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
    return { text, usage: usageOf(response) };
  }

  return {
    name: `claude:${model}:${effort}`,
    decide: message => send(message, DECISION_SCHEMA as unknown as Record<string, unknown>),
    decideRoad: message => send(message, ROAD_DECISION_SCHEMA as unknown as Record<string, unknown>),
    decideEncounter: message => send(message, ENCOUNTER_DECISION_SCHEMA as unknown as Record<string, unknown>),
    decidePack: message => send(message, PACK_DECISION_SCHEMA as unknown as Record<string, unknown>),
  };
}

function usageOf(r: Anthropic.Beta.BetaMessage) {
  return {
    input: r.usage.input_tokens,
    output: r.usage.output_tokens,
    cacheRead: r.usage.cache_read_input_tokens ?? 0,
    cacheWrite: r.usage.cache_creation_input_tokens ?? 0,
  };
}
