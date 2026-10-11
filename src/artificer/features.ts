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
    // Its own switch, not `free-questions`: with it a free question stops passing the trust gates
    // (#1575's rule) and answers the way the knowledge model does, which is a different game, so
    // a run from before it (absent: false) must keep playing its questions the old way on replay.
    id: 'knowledge-questions', name: 'Questions people answer from what they know', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1611,
    note: 'A free question is matched to what the person knows, their People\'s and culture\'s ways too, and answered as an ask is: trust opens what they\'ll say, and someone who doesn\'t know may send you to someone who does.',
  },
  {
    // A rules feature: it changes what people can tell you (more topics answered, other referrals,
    // other leads), so a run from before it (absent: false) keeps today's answers on replay.
    id: 'scope-facts', name: 'What everyone knows', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1610,
    note: 'People know what their village, the road, and their trade know: ask about a village, the road, a trade or who does what, not only what one person has to say.',
  },
  {
    // A rules feature: it moves the trust at which people voice their views (culture-lore.ts
    // `effectiveCandour`), so a run from before it (absent: false) keeps today's voicing on replay.
    id: 'candour-by-place', name: 'Candour shaped by place', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1619,
    note: 'Where people are changes how openly they speak their minds: blunter in a hard place or harsh weather, more careful under a strict lord or in uneasy times.',
  },
  {
    // A rules feature: it changes prices, what's offered and the quests (economy.ts), so a run
    // from before it (absent: false) keeps today's market and jobs on replay.
    id: 'village-economies', name: 'Village economies', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1599,
    note: 'Each village lives on its own trade: what it makes is cheap there, what it lacks is dear and sells well, and each has a job that comes from its work.',
  },
  {
    // A rules feature: it changes what people can tell you (their organisations' facts, at their
    // organisations' gates, opened further by your standing with them), so a run from before it
    // (absent: false) keeps today's answers on replay. Membership itself needs no switch: on its
    // own it changes no answer, and its signs are the ones noticing already had.
    id: 'organisations', name: 'Organisations', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1587,
    note: 'People belong to organisations (the Compact, the Vidde Accords, the Compact of Knowing, the Bergfolk holds): members know what their organisation knows, keep its secrets from outsiders or are bound to tell, and a deed told to one member is known to them all.',
  },
  {
    // A rules feature: it changes who someone on the road is (villages.ts `asPlayed`: Maren of
    // Hollowford is Riksfolk, a human), so what they answer for their People and which topics
    // open. A run from before it (absent: false) keeps Maren a Markfolk orc on replay.
    id: 'humans-on-the-road', name: 'Humans on the road', stage: 'experimental', kind: 'rules', default: true, absent: false, issue: 1631,
    note: 'Humans walk the road: Maren of Hollowford is Riksfolk, one of the two human Peoples, and speaks for them.',
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
