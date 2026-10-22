/**
 * One player until its account runs out of credit, then another (#1506).
 *
 * The owner's Anthropic key has free credit for Claude models: the bench plays them on it
 * directly, and once it's spent, carries on through OpenRouter. The switch happens on the call
 * that failed (that call is retried on the fallback), so no game is lost to it, and it's for
 * good: every later call goes to the fallback. Any other error is the run's to report.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Player } from '../runner';

/**
 * Whether an error means the key is out of credit, not that the request was wrong. Per the API's
 * errors page: 402 is a billing error; a spend limit or an empty balance comes back as a 400 (and
 * a tier's spend cap as a 429) whose message says so.
 */
export function creditExhausted(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return false;
  if (err.status === 402) return true;
  return (err.status === 400 || err.status === 429) && /credit balance|spend (limit|cap)|billing/i.test(err.message);
}

/** Any of a player's turns: the message, then whatever state that turn takes (the meeting takes two). */
type Decide = (...args: never[]) => Promise<{ text: string; usage?: object }>;

/** `primary`, until it's out of credit (`isOut`); then `fallback` for this call and every one after. */
export function withFallback(primary: Player, fallback: Player, onSwitch: (why: string) => void = () => {}, isOut: (err: unknown) => boolean = creditExhausted): Player {
  let out = false;
  const via = (pick: (p: Player) => Decide | undefined): Decide | undefined => {
    // Only the turns the primary takes: one it lacks goes the runner's usual way (a meeting with
    // no decideMeeting is answered by decideEncounter), not to the fallback while there's credit.
    if (!pick(primary)) return undefined;
    return async (...args) => {
      const first = out ? undefined : pick(primary);
      if (first) {
        try { return await first.apply(primary, args); } catch (err) {
          if (!isOut(err)) throw err;
          out = true;
          onSwitch(err instanceof Error ? err.message : String(err));
        }
      }
      const next = pick(fallback);
      if (!next) throw new Error(`${fallback.name} can't take over this kind of turn`);
      return next.apply(fallback, args);
    };
  };
  const p = {
    get name() { return out ? `${primary.name}→${fallback.name}` : primary.name; },
    decide: via(x => x.decide as Decide)!,
    decideRoad: via(x => x.decideRoad as Decide | undefined),
    decideEncounter: via(x => x.decideEncounter as Decide | undefined),
    decideMeeting: via(x => (x as { decideMeeting?: Decide }).decideMeeting),
    decidePack: via(x => x.decidePack as Decide | undefined),
  };
  // Leave out the turns the primary doesn't take, so the runner handles them as it would for it.
  for (const k of Object.keys(p) as (keyof typeof p)[]) if (k !== 'name' && p[k] === undefined) delete (p as Record<string, unknown>)[k];
  return p as unknown as Player;
}
