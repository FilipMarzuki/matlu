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

  // ── The "where you stand" line (#1926, artificer-app/standing-line.ts, ui feature `standing-line`) ──
  // One sentence in place of the FOCUS chip, the readiness tag and the night chip: "Next: lay in
  // food — 17 of ~30 nights. Tonight: warm." Short enough for a phone. Never "ready" while the
  // winter outlook falls short.
  'stand.next.site': 'Next: find a camp site.',
  'stand.next.camp': 'Next: make camp.',
  'stand.next.roof': 'Next: build a shelter.',
  'stand.next.week': "Next: a week's food — {n} of {m} nights.",
  'stand.next.food.one': 'Next: lay in food — {n} of ~{m} night.',
  'stand.next.food.other': 'Next: lay in food — {n} of ~{m} nights.',
  'stand.next.fuel.one': 'Next: lay in firewood — {n} of ~{m} night.',
  'stand.next.fuel.other': 'Next: lay in firewood — {n} of ~{m} nights.',
  'stand.next.cold': 'Next: a shelter warm enough for midwinter.',
  'stand.next.larder': 'Next: smoke or dry food — {n} of {m} rations.',
  'stand.next.woodpile': 'Next: a woodpile — {n} of {m} firewood.',
  'stand.next.shelter': 'Next: a warmer shelter.',
  'stand.next.body': 'Next: get your strength back.',
  'stand.ready': 'Ready for winter.',
  'stand.holding': 'Holding to the thaw.',
  'stand.thaw': 'The thaw has come.',
  'stand.lock': 'Survival first: {why}.',
  'stand.tonight': 'Tonight: {what}.',
  'stand.night.warm': 'warm',
  'stand.night.cool': 'cool',
  'stand.night.cold': 'cold',
  'stand.night.dangerous': 'dangerously cold',
  'stand.night.pct': '{n}% warm',
  'stand.night.uneasy': 'uneasy',
  'stand.night.sleepless': 'sleepless',
  'stand.focus': 'Focus: {name}.',
  'stand.focusFrayed': 'Focus: {name} (frayed).',
  'stand.tip': 'Where you stand. Tap for the survival steps and your focus.',
  // PROGRESS, so it agrees with the line.
  'stand.progress.notYet': 'Not ready for winter yet. {next}',
  'stand.progress.notNow': 'not now',
};
