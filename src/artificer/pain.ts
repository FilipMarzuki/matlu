/**
 * Pain (#1409, epic #1391): the felt signal of an injury. A child doesn't know how bad a sprain is
 * — but they know it hurts, and that it hurts more when they push it. Pain is always felt (the
 * player and the AI both see it); how much more than pain you understand is First aid's (#1410).
 *
 * - **Resting pain** each morning: the worst of your open injuries — a minor or serious one aches,
 *   a grave one is sharp; treated, one step less.
 * - **Straining pain**: work that strains a serious untreated or a grave injury (the same rule as
 *   aggravation) raises pain one step for the rest of the day. So sharp pain after work means the
 *   risk is real — the signal is honest. A minor or treated injury doesn't spike.
 * - **What it costs**: sharp pain makes work drain more of the mind and the night restless;
 *   agony slows the work too. Ignoring it has a price even when nothing gives.
 *
 * Pure: region1.ts reads `painOf`, applies the costs and calls `strainPain` after work.
 */

import { strains, INJURY_NAME, type Injury } from './injuries';

/** None, ache, sharp, agony. */
export type Pain = 0 | 1 | 2 | 3;
export const PAIN_NAME: readonly string[] = ['none', 'ache', 'sharp', 'agony'];

const clamp = (n: number): Pain => Math.max(0, Math.min(3, n)) as Pain;

/** How much one injury hurts at rest: a grave one sharp, any other an ache — treated, a step less. */
export const injuryPain = (i: Injury): Pain => clamp((i.severity === 'grave' ? 2 : 1) - (i.treated ? 1 : 0));

/** Resting pain: the worst of your open injuries. */
export const restingPain = (injuries: readonly Injury[] | undefined): Pain =>
  clamp(Math.max(0, ...(injuries ?? []).map(injuryPain)));

/** How much pain you're in now: the day's peak, or resting pain if that's more. */
export const painOf = (s: { injuries?: Injury[]; today: { pain?: Pain } }): Pain =>
  clamp(Math.max(restingPain(s.injuries), s.today.pain ?? 0));

/** Does this injury spike when strained? Only one that can still get worse, or is already grave. */
const spikes = (i: Injury): boolean => (i.severity === 'serious' && !i.treated) || i.severity === 'grave';

/**
 * The pain after a piece of work: each injury the work strains (if it spikes) hurts one step more
 * than at rest. Returns the new level and the injury that hurts most, when it rose.
 */
export function strainPain(injuries: readonly Injury[] | undefined, before: Pain, action: string, ring: number, craft: boolean): { pain: Pain; rose: Injury | null } {
  let pain = before, rose: Injury | null = null;
  for (const i of injuries ?? []) {
    if (!spikes(i) || !strains(i.kind, action, ring, craft)) continue;
    const p = clamp(injuryPain(i) + 1);
    if (p > pain) { pain = p; rose = i; }
  }
  return { pain, rose };
}

/** What pain costs: sharp — the mind drains ×1.1 at work and the night costs 2 Clarity; agony — ×1.25, the work takes ×1.1 as long, and the night 5. */
export const PAIN_DRAIN: readonly number[] = [1, 1, 1.1, 1.25];
export const PAIN_HOURS: readonly number[] = [1, 1, 1, 1.1];
export const PAIN_NIGHT: readonly number[] = [0, 0, 2, 5];

/** What the journal says when pain rises at work, and at night. */
export const painRiseLine = (i: Injury, p: Pain): string => {
  const where = i.kind === 'sprain' ? 'ankle' : i.kind === 'hand' ? 'hand' : 'cut';
  return p >= 3 ? `Agony — your ${where} screams at every step. You should stop.` : `Pain shoots through your ${where} — it's sharp now.`;
};
export const painNightLine = (injuries: readonly Injury[] | undefined, p: Pain): string => {
  const worst = [...(injuries ?? [])].sort((a, b) => injuryPain(b) - injuryPain(a))[0];
  const name = worst ? INJURY_NAME[worst.kind].replace(/^(sprained|hurt|deep) /, '') : 'body';
  return p >= 3 ? `The pain in your ${name} keeps you awake half the night.` : `Your ${name} throbs all night.`;
};
