/**
 * Feature switches (#1579): a new feature can be tried, switched off and on, and marked as an
 * experiment in the game while it's new, before it settles into the game for good.
 *
 * Two kinds:
 * - **rules** features change what can happen in a run (free questions can pass a trust gate and
 *   hand you a lead). A run's rule features are fixed when it starts and saved with it, in its
 *   world (`WorldConfig.features`), so a replay plays the same game and its record says what was on.
 *   Switching one changes the next new game, never the one being played.
 * - **ui** features only change how the game looks; they switch live, per browser.
 *
 * Pure: the registry and how a run's saved switches read. Where a player's own choices are kept
 * (the browser) is the app's business (artificer-app/feature-choices.ts).
 */

export type FeatureStage = 'experimental' | 'beta' | 'stable';
export type FeatureKind = 'rules' | 'ui';

export interface FeatureDef {
  id: string;
  name: string;
  /** One line on what it does, for the dev panel and the API's rules. */
  note: string;
  stage: FeatureStage;
  kind: FeatureKind;
  /** On in a new game unless the player switches it off. */
  default: boolean;
  /**
   * How a run saved before this feature had a switch reads: on for a feature that shipped before
   * its switch (its runs had it), off for one that arrives with its switch (they couldn't have).
   */
  absent: boolean;
  /** The issue it came from. */
  issue: number;
}

export const FEATURES: readonly FeatureDef[] = [
  {
    id: 'free-questions', name: 'Free questions', stage: 'experimental', kind: 'rules', default: true, absent: true, issue: 1575,
    note: 'On the road, ask anyone one question in your own words, once per stay. Questions are kept to improve the game.',
  },
  {
    id: 'referrals', name: 'Referrals', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1609,
    note: 'Asked about something they don\'t know, a person names someone nearby who would.',
  },
  {
    // A rules feature: it changes what people can tell you (more topics answered, other referrals,
    // other leads), so a run from before it (absent: false) keeps today's answers on replay.
    id: 'scope-facts', name: 'What everyone knows', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1610,
    note: 'People know what their village, the road, and their trade know: ask about a village, the road, a trade or who does what, not only what one person has to say.',
  },
];

/** Switches by feature id. */
export type FeatureSwitches = Readonly<Record<string, boolean>>;

export const featureById = (id: string): FeatureDef | undefined => FEATURES.find(f => f.id === id);

/** A set of switches as saved or sent: an object of booleans. Anything else isn't one. */
export function validFeatures(x: unknown): x is Record<string, boolean> {
  return typeof x === 'object' && x !== null && !Array.isArray(x) && Object.values(x).every(v => typeof v === 'boolean');
}

/**
 * The rule features a new game plays with: every rule feature's default, then the player's own
 * choices on top. Written out in full, so the run keeps them even if a default changes later.
 * Ids that aren't rule features are left out.
 */
export function ruleFeatures(choices: FeatureSwitches = {}): Record<string, boolean> {
  return Object.fromEntries(FEATURES.filter(f => f.kind === 'rules').map(f => [f.id, typeof choices[f.id] === 'boolean' ? choices[f.id] : f.default]));
}

/** Whether a rule feature is on in a run: as the run saved it, else as runs from before its switch had it. */
export function featureOn(saved: FeatureSwitches | undefined, id: string): boolean {
  const v = saved?.[id];
  return typeof v === 'boolean' ? v : featureById(id)?.absent ?? false;
}

/** Every rule feature, on or off in a run, as `featureOn` reads it: what a record keeps. */
export const featuresOf = (saved: FeatureSwitches | undefined): Record<string, boolean> =>
  Object.fromEntries(FEATURES.filter(f => f.kind === 'rules').map(f => [f.id, featureOn(saved, f.id)]));

/** The experimental features among those on: what earns a run its 🧪. Unknown ids don't count. */
export const experimentalOn = (switches: FeatureSwitches | null | undefined): FeatureDef[] =>
  FEATURES.filter(f => f.stage === 'experimental' && switches?.[f.id] === true);

/** A ui feature as the player has it: their choice, else its default. */
export const uiFeatureOn = (choices: FeatureSwitches, id: string): boolean => {
  const f = featureById(id);
  return f?.kind === 'ui' ? (typeof choices[id] === 'boolean' ? choices[id] : f.default) : false;
};
