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
import { DECISION_SCHEMA } from '../decision';
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
  const model = opts.model ?? process.env.AI_PLAY_OPENROUTER_MODEL ?? 'google/gemini-2.5-pro';
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const useSchema = opts.schema ?? true;
  const messages: ChatMessage[] = [{ role: 'system', content: RULES }];

  return {
    name: `openrouter:${model}`,
    async decide(message) {
      messages.push({ role: 'user', content: message });
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'matlu artificer AI player',
        },
        body: JSON.stringify({
          model,
          messages,
          ...(useSchema ? { response_format: { type: 'json_schema', json_schema: { name: 'decision', strict: true, schema: DECISION_SCHEMA } } } : {}),
        }),
      });
      if (!res.ok) throw new Error(`OpenRouter → ${res.status}: ${await res.text()}`);
      const data = await res.json() as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
      };
      const text = data.choices?.[0]?.message?.content ?? '';
      messages.push({ role: 'assistant', content: text });
      return {
        text,
        usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0, cacheRead: data.usage?.prompt_tokens_details?.cached_tokens ?? 0 },
      };
    },
  };
}
