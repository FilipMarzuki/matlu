/**
 * The models we playtest with (#1231). One place to change the line-up;
 * `npm run ai:bench` plays all of them.
 *
 * Chosen on cost vs. how well they play (see the progression report): every
 * model here reached winter-ready in its playtests at a few cents a game.
 * `perGame` is the measured cost of one ~10-day game (from before winter was
 * played). A game is now the whole year, about 60 turns (#1309), so the bench
 * scales it up for its estimate.
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
  { model: 'deepseek/deepseek-v4-pro', perGame: 0.013, note: 'cheapest, but ~8–9 min a game' },
  { model: 'meta-llama/llama-4-maverick', perGame: 0.02, note: 'cheap and terse; overworks — finds balance edges' },
];

/** Tried and dropped, so they don't creep back in. */
export const DROPPED: readonly { model: string; why: string }[] = [
  { model: 'google/gemini-3.1-pro-preview', why: '$0.37/game (~20k reasoning tokens), no better than the rest' },
  { model: 'google/gemini-2.5-pro', why: '$0.34/game, no better than the rest' },
  { model: 'mistralai/mistral-large-2512', why: 'overkill for this, and rate-limited upstream' },
  // Whole-year games (#1309) cost ~6× a 10-day one; these two alone were most of a night's spend (#1326).
  { model: 'anthropic/claude-sonnet-5.5', why: '~$0.90 a whole-year game: over half the nightly $1 budget on its own' },
  { model: 'google/gemini-3.8-flash', why: '~$0.60 a whole-year game (heavy reasoning output); the roster fits $1 without it' },
];

/** How many days `perGame` was measured over, and how many a game lasts now (to the thaw). */
export const MEASURED_DAYS = 10;
export const YEAR_DAYS = 60;

/** Estimated USD for one whole-year game: the measured cost, scaled by the turns (a ceiling — caching makes later turns cheaper). */
export const perYear = (r: RosterEntry): number => (r.perGame * YEAR_DAYS) / MEASURED_DAYS;

/**
 * Whether a budget covers a night of the roster, and if not, what to do (#1309):
 * raise the budget to the estimate, or trim to the models it does cover —
 * cheapest first, which is what an even spend leaves playing.
 */
export function budgetAdvice(roster: readonly RosterEntry[], runs: number, budget: number): string {
  const estimate = roster.reduce((n, r) => n + perYear(r) * runs, 0);
  if (!Number.isFinite(budget) || estimate <= budget) return `The budget covers the roster (~$${estimate.toFixed(2)}).`;
  let left = budget, fits = 0;
  for (const r of [...roster].sort((x, y) => perYear(x) - perYear(y))) { if (perYear(r) * runs > left) break; left -= perYear(r) * runs; fits++; }
  return `The budget ($${budget}) covers about ${fits} of ${roster.length} models at ~$${estimate.toFixed(2)} for all: raise AI_BENCH_BUDGET to ~$${Math.ceil(estimate)}, or trim the roster.`;
}

/** The default when a single OpenRouter model is wanted and none is named. */
export const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-haiku-4.5';
