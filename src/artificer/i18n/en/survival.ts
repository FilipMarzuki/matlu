/**
 * English for the Survival path (#1793, artificer-app/survival-path.ts, ui feature `guide`): the
 * FOCUS chip's step and the picker's checklist. Spread into `en` (../en.ts).
 */
export const survival = {
  // ── The chip: "FOCUS Survive 1/5: find a camp site" ───────────────────────
  'path.chip': 'Survive {n}/{total}:',
  'path.chipTip': 'Survival, step {n} of {total}: {step}. Tap for the steps.',
  // ── The steps, as the chip and the checklist say them ─────────────────────
  'path.step.site': 'find a camp site',
  'path.step.camp': 'make camp',
  'path.step.roof': 'a roof over you',
  'path.step.food': 'food laid by',
  'path.step.winter': 'ready for winter',
  // ── What the current step asks, under it in the picker ────────────────────
  'path.hint.site': 'Explore until you find a good place to camp.',
  'path.hint.camp': 'Make camp at one of the places you know.',
  'path.hint.roof': 'Build a shelter at camp.',
  'path.hint.food': 'Lay by food for {n} nights: {have} so far.',
  'path.hint.winter': 'Fill the larder and the woodpile, and make the shelter warm enough for winter.',
  // ── The picker ─────────────────────────────────────────────────────────────
  'path.head': 'SURVIVE',
  'path.done': 'done',
  'path.now': 'now',
  'path.suggest': 'Focus: {goal}',
  'path.suggestTip': 'Set your focus to {goal}: it helps with this step',
  'path.focused': 'Your focus: {goal}',
};
