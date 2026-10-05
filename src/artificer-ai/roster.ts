/**
 * The models we playtest with (#1231). One place to change the line-up;
 * `npm run ai:bench` plays all of them.
 *
 * Chosen on cost vs. how well they play (see the progression report): every
 * model here reached winter-ready in its playtests at a few cents a game.
 * `perGame` is the measured cost of one ~10-day game, used for the estimate
 * the bench prints before it starts.
 */

export interface RosterEntry {
  model: string;
  /** Measured USD per game (October 2026, OpenRouter). */
  perGame: number;
  note: string;
}

export const ROSTER: readonly RosterEntry[] = [
  { model: 'openai/gpt-6.1-sol', perGame: 0.057, note: 'fastest to winter-ready (day 6)' },
  { model: 'anthropic/claude-haiku-4.5', perGame: 0.04, note: 'cheap, quick, thrives' },
  { model: 'anthropic/claude-sonnet-5.5', perGame: 0.15, note: 'the priciest kept; careful play' },
  { model: 'google/gemini-3.8-flash', perGame: 0.1, note: 'thrives; heavier reasoning output' },
  { model: 'deepseek/deepseek-v4-pro', perGame: 0.013, note: 'cheapest, but ~8–9 min a game' },
  { model: 'meta-llama/llama-4-maverick', perGame: 0.02, note: 'cheap and terse; overworks — finds balance edges' },
];

/** Tried and dropped, so they don't creep back in. */
export const DROPPED: readonly { model: string; why: string }[] = [
  { model: 'google/gemini-3.1-pro-preview', why: '$0.37/game (~20k reasoning tokens), no better than the rest' },
  { model: 'google/gemini-2.5-pro', why: '$0.34/game, no better than the rest' },
  { model: 'mistralai/mistral-large-2512', why: 'overkill for this, and rate-limited upstream' },
];

/** The default when a single OpenRouter model is wanted and none is named. */
export const DEFAULT_OPENROUTER_MODEL = 'google/gemini-3.8-flash';
