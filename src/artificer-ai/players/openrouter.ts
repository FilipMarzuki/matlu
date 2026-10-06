/**
 * Any other model as an Artificer player (#1226), via OpenRouter — the same
 * request shape as the repo's second-opinion reviewer
 * (.github/scripts/run-second-review.js). Use it to pit non-Claude models
 * (Gemini, GPT, Llama…) against the game or against Claude.
 *
 * Reads OPENROUTER_API_KEY from the environment. Asks for a JSON-schema
 * response where the model supports it; `parseDecision` validates either way.
 */

import { RULES } from '../observe';
import { DECISION_SCHEMA, ROAD_DECISION_SCHEMA } from '../decision';
import { DEFAULT_OPENROUTER_MODEL } from '../roster';
import type { Player } from '../runner';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface OpenRouterPlayerOptions {
  model?: string;
  apiKey?: string;
  /** Ask for schema-constrained JSON (turn off for models that reject response_format). */
  schema?: boolean;
}

export function openRouterPlayer(opts: OpenRouterPlayerOptions = {}): Player {
  const model = opts.model ?? process.env.AI_PLAY_OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const useSchema = opts.schema ?? true;
  const messages: ChatMessage[] = [{ role: 'system', content: RULES }];
  // Anthropic models on OpenRouter only cache with explicit breakpoints; others cache implicitly.
  const anthropic = model.startsWith('anthropic/');

  // One conversation for the whole run; the caravan road (#1251) continues it with its own schema.
  async function send(message: string, schemaName: string, schema: object) {
    messages.push({ role: 'user', content: message });
    const request = () => fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'matlu artificer AI player',
      },
      body: JSON.stringify({
        model,
        messages: anthropic ? withCacheBreakpoints(messages) : messages,
        // Usage accounting: the response then carries the actual billed cost in USD (#1231).
        usage: { include: true },
        ...(useSchema ? { response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } } } : {}),
      }),
    });
    const res = await withRetry(request);
    if (!res.ok) throw new Error(`OpenRouter → ${res.status}: ${await res.text()}`);
    const data = await res.json() as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    messages.push({ role: 'assistant', content: text });
    return {
      text,
      usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0, cacheRead: data.usage?.prompt_tokens_details?.cached_tokens ?? 0, cost: data.usage?.cost ?? null },
    };
  }

  return {
    name: `openrouter:${model}`,
    decide: message => send(message, 'decision', DECISION_SCHEMA),
    decideRoad: message => send(message, 'road_decision', ROAD_DECISION_SCHEMA),
  };
}

/**
 * Rate limits (429) and provider hiccups (5xx) are routine on shared pools, so a
 * single one shouldn't end a whole run. Back off and retry a few times first.
 */
async function withRetry(request: () => Promise<Response>, attempts = 5, baseMs = 2000): Promise<Response> {
  for (let i = 1; ; i++) {
    const res = await request();
    if (res.ok || i >= attempts || !(res.status === 429 || res.status >= 500)) return res;
    await new Promise(r => setTimeout(r, baseMs * 2 ** (i - 1)));
  }
}

type Part = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };

/**
 * Mark the rules (system) and the newest user turn as cache breakpoints, in
 * OpenRouter's pass-through form of Anthropic's `cache_control`. The history is
 * append-only, so each request reads everything up to the previous turn from cache.
 */
function withCacheBreakpoints(messages: readonly ChatMessage[]): { role: ChatMessage['role']; content: string | Part[] }[] {
  const last = messages.length - 1;
  return messages.map((m, i) => (i === 0 || i === last
    ? { role: m.role, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] }
    : m));
}
