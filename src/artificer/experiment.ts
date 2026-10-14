/**
 * Experiment (#1690, the owner's comment; switch `action-visibility`): "Try something with what you
 * have." Hiding what you don't know how to do mustn't lock it away, so one action is always there:
 * spend a few hours turning over the tools and materials at hand, and you edge towards the things
 * they make possible. Try with a hide and some cord long enough and the waterskin comes.
 *
 * - **What you can work towards:** each recipe you haven't worked out whose inputs you hold some of.
 * - **Steered by focus:** a focus on the recipe's concept or its craft skill picks it first, and
 *   doubles the progress. Choosing a material to try with (`with`) narrows it the same way.
 * - **Deterministic:** progress is hours, kept per recipe in the run; the first session gives a
 *   hint that names no recipe, and enough progress teaches it. No dice.
 *
 * Pure: region1.ts supplies the recipes and reads the result.
 */

import type { Focus } from './focus';

/** A session's length, and its pull on the body and mind (set in region1's ACTIONS). */
export const EXPERIMENT_HOURS = 3;
/** Progress at which you sense there's something in it. One session gets there. */
export const EXPERIMENT_HINT = 3;
/** Progress at which you work it out: three plain sessions, two with focus. */
export const EXPERIMENT_LEARN = 9;
/** A focus on the recipe's concept or skill (or the material chosen) multiplies progress by this. */
export const EXPERIMENT_STEER = 2;

/** Something experimenting can lead to: a recipe not yet known, and what making it would take. */
export interface ExperimentTarget {
  recipe: string;
  name: string;
  /** The concepts behind it (the discovery's concept and the recipe's own). */
  concepts: readonly string[];
  /** The skill its craft trains, if any. */
  skill: string | null;
  /** Store keys the recipe is made from. */
  inputs: readonly string[];
}

export interface ExperimentInput {
  /** Everything that could be worked out, in a fixed order (the tie-break). */
  targets: readonly ExperimentTarget[];
  known: readonly string[];
  /** How much of a store key is at hand. */
  have: (item: string) => number;
  /** Progress so far, by recipe id. */
  progress: Readonly<Record<string, number>>;
  focus: Focus | null;
  /** A material chosen to try with (a store key), or none. */
  with?: string;
}

export interface ExperimentStep {
  /** What the session worked towards, or null when there's nothing at hand to try anything with. */
  target: ExperimentTarget | null;
  steered: boolean;
  progress: Record<string, number>;
  /** Crossed the hint line this session. */
  hinted: boolean;
  /** Worked it out this session. */
  learned: boolean;
}

/** The recipes not yet known whose every input is at hand. */
export const experimentCandidates = (i: Pick<ExperimentInput, 'targets' | 'known' | 'have'>): ExperimentTarget[] =>
  i.targets.filter(t => !i.known.includes(t.recipe) && t.inputs.length > 0 && t.inputs.every(k => i.have(k) >= 1));

const focused = (t: ExperimentTarget, f: Focus | null): boolean =>
  (f?.kind === 'concept' && t.concepts.includes(f.id)) || (f?.kind === 'skill' && t.skill === f.id);

/**
 * Which candidate a session works on: those using the chosen material first (if any do), then
 * those the focus points at, then the one furthest along, then the first in `targets` order.
 */
export function pickTarget(i: ExperimentInput): { target: ExperimentTarget | null; steered: boolean } {
  let pool = experimentCandidates(i);
  if (!pool.length) return { target: null, steered: false };
  const withIt = i.with ? pool.filter(t => t.inputs.includes(i.with!)) : [];
  if (withIt.length) pool = withIt;
  const onFocus = pool.filter(t => focused(t, i.focus));
  if (onFocus.length) pool = onFocus;
  const at = (t: ExperimentTarget): number => i.progress[t.recipe] ?? 0;
  const target = [...pool].sort((a, b) => at(b) - at(a) || i.targets.indexOf(a) - i.targets.indexOf(b))[0];
  return { target, steered: onFocus.length > 0 || withIt.length > 0 };
}

/** One session of experimenting, `hours` long. */
export function experimentStep(i: ExperimentInput, hours = EXPERIMENT_HOURS): ExperimentStep {
  const { target, steered } = pickTarget(i);
  if (!target) return { target: null, steered: false, progress: { ...i.progress }, hinted: false, learned: false };
  const before = i.progress[target.recipe] ?? 0;
  const after = before + hours * (steered ? EXPERIMENT_STEER : 1);
  const learned = after >= EXPERIMENT_LEARN;
  const progress = { ...i.progress };
  // Once worked out, the recipe is known and its progress has done its job.
  if (learned) delete progress[target.recipe]; else progress[target.recipe] = after;
  return { target, steered, progress, hinted: !learned && before < EXPERIMENT_HINT && after >= EXPERIMENT_HINT, learned };
}

export const WORD: Readonly<Record<string, string>> = { materials: 'cord and sticks', hides: 'the hide', stone: 'the stone', firewood: 'the firewood', rawFood: 'the food', water: 'the water', rations: 'the rations' };
/** The things a target is made from, in words ("the hide and cord and sticks"). */
export const inputWords = (t: ExperimentTarget): string => {
  const w = t.inputs.map(k => WORD[k] ?? k);
  return w.length > 1 ? `${w.slice(0, -1).join(', ')} and ${w.at(-1)}` : w[0] ?? 'what you have';
};

/** A save's experiment progress, if well-formed: recipe ids to non-negative hours. */
export const validExperiments = (x: unknown): x is Record<string, number> =>
  typeof x === 'object' && x !== null && !Array.isArray(x) && Object.values(x).every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0);
