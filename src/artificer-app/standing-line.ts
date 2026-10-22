/**
 * The "where you stand" line (#1926, ui feature `standing-line`; roadmap item 4 of the design
 * review #1914, F4 and §1.6).
 *
 * The status bar used to say where you stand in three places that could disagree. On day 14 the
 * FOCUS chip said "Survive 5/5: ready for winter", which reads as done (it meant "step 5 of 5 is
 * the one you're on"); beside it the readiness tag said NOT READY; and PROGRESS said the food was
 * falling short. This merges the three into one sentence:
 *
 *   "Next: lay in food — 17 of ~30 nights. Tonight: warm."
 *
 * - **Next** is the Survival path's current step (survival-path.ts), read with the winter outlook
 *   (`outlook: true`), so step 5 is never done while the outlook falls short. At step 5 it names
 *   the first thing short: what the outlook says (progress-view.ts `outlookShortfalls`, the same
 *   rule as PROGRESS's warnings, so the numbers match), else the first readiness pillar not done
 *   (readiness.ts). Only when there's nothing left does it say "Ready for winter." (in winter,
 *   "Holding to the thaw.").
 * - **Tonight** is the night chip's warmth and fright (key-box.ts `tonight`), in a word.
 * - A focus of your own (a skill or concept you're studying) keeps its name at the end, as the
 *   FOCUS chip kept it; survival's lock takes "Next"'s place, as it took the chip's.
 *
 * The line is a button that opens the focus picker, as the FOCUS chip was: one control, not two.
 * Pure functions of the run and `t`, no DOM, so a unit test can read them. Nothing new is worked
 * out: every fact comes from a function the page already called. The play API, the console and
 * the AI players never see it.
 */

import type { Key, T } from '../artificer/i18n';
import { pillars, type PillarKey } from '../artificer/readiness';
import { readinessInput, survivalLockOf, winterOutlook, type Region1State } from '../artificer/region1';
import { statEffects } from '../artificer/stats';
import { seasonOf, type Season } from '../artificer/winter';
import type { Focus } from '../artificer/focus';
import { FOCUS_POP_ID } from './focus-popover';
import { tonight } from './key-box';
import { outlookShortfalls, type Shortfall, type StandingNote } from './progress-view';
import { esc } from './html';
import { focusName, lockText } from './sim-words';
import { FOOD_LAID_BY, PATH_STEPS, survivalPath } from './survival-path';

/** The ui feature (features.ts). It builds on the guide's Survival path, so main.ts needs `guide` on too. */
export const STANDING_FEATURE = 'standing-line';

/** What the line says comes next, or that nothing does. */
export type Next =
  /** Path steps 1–3: find a site, make camp, build a shelter. */
  | { kind: 'step'; step: 'site' | 'camp' | 'roof' }
  /** Path step 4: a week's food laid by (`FOOD_LAID_BY`), in nights. */
  | { kind: 'week'; have: number; need: number }
  /** Step 5, and the winter outlook falls short of the thaw: its first shortfall. */
  | { kind: 'short'; short: Shortfall }
  /** Step 5, the outlook holds, and a readiness pillar isn't done: the first one, with its amounts where it has them. */
  | { kind: 'pillar'; pillar: PillarKey; have: number; need: number }
  /** The path done: ready in the autumn, holding in the winter, the thaw come. */
  | { kind: 'ready'; season: Season };

/** Where you stand, as data. */
export interface Standing {
  /** Survival's lock on the mind (`survivalLockOf`): said in "Next"'s place. */
  lock: string | null;
  next: Next;
  /** A focus of your own (not a survival goal), as the FOCUS chip named it, and whether it's frayed. */
  focus: { focus: Focus; frayed: boolean } | null;
}

/** What comes next on the Survival path, read with the winter outlook. */
export function nextOf(s: Region1State): Next {
  const path = survivalPath(s, { outlook: true });
  if (path.current !== null) {
    const id = PATH_STEPS[path.current];
    if (id === 'food') return { kind: 'week', have: winterOutlook(s).foodDays, need: FOOD_LAID_BY };
    if (id !== 'winter') return { kind: 'step', step: id };
    const short = outlookShortfalls(s)[0];
    if (short) return { kind: 'short', short };
    const th = s.config.thresholds;
    const p = pillars(readinessInput(s), th).find(x => !x.done);
    if (p) {
      const amounts = p.key === 'larder' ? { have: s.stores.rations, need: th.larder } : p.key === 'fuel' ? { have: s.stores.firewood, need: th.fuel } : { have: 0, need: 0 };
      return { kind: 'pillar', pillar: p.key, ...amounts };
    }
  }
  // The path is done: winter-ready and the outlook holding (survival-path.ts).
  return { kind: 'ready', season: seasonOf(s.day, s.config.calendar) };
}

/** Where you stand (see the file's header). */
export function standing(s: Region1State): Standing {
  const lock = survivalLockOf(s);
  // The player's own study keeps its name, as on the FOCUS chip; a goal focus is the path's business.
  const own = !lock && s.focus && s.focus.kind !== 'goal' ? s.focus : null;
  return {
    lock,
    next: nextOf(s),
    focus: own ? { focus: own, frayed: s.vitals.clarity.current < statEffects(s.character.stats).unreliableBelow } : null,
  };
}

const plural = (n: number): 'one' | 'other' => (n === 1 ? 'one' : 'other');

/** "Next" as a sentence. */
export function nextText(n: Next, t: T): string {
  switch (n.kind) {
    case 'step': return t(`stand.next.${n.step}`);
    case 'week': return t('stand.next.week', { n: n.have, m: n.need });
    case 'short':
      if (n.short.what === 'cold') return t('stand.next.cold');
      return t(`stand.next.${n.short.what}.${plural(n.short.need)}`, { n: n.short.have, m: n.short.need });
    case 'pillar':
      return n.pillar === 'larder' ? t('stand.next.larder', { n: n.have, m: n.need })
        : n.pillar === 'fuel' ? t('stand.next.woodpile', { n: n.have, m: n.need })
          : t(`stand.next.${n.pillar}`);
    case 'ready': return t(n.season === 'autumn' ? 'stand.ready' : n.season === 'winter' ? 'stand.holding' : 'stand.thaw');
  }
}

/** Tonight as a sentence ("Tonight: cold, uneasy."), its colour class and its tooltip; null when the night chip would be empty. */
export function tonightText(s: Region1State, t: T): { text: string; cls: string; tip: string } | null {
  const n = tonight(s, t);
  if (!n) return null;
  const words: string[] = [];
  if (n.warmth) words.push(n.warmth.quality === 'pct' ? t('stand.night.pct', { n: n.warmth.pct }) : t(`stand.night.${n.warmth.quality}` as Key));
  if (n.fright) words.push(t(n.fright === 'shaken' ? 'stand.night.uneasy' : 'stand.night.sleepless'));
  // The night chip's colours: the fear's when frightened, else the night's quality.
  const cls = n.fright ? `fear s-${n.fright}` : `q-${n.warmth?.quality ?? ''}`;
  return { text: t('stand.tonight', { what: words.join(', ') }), cls, tip: n.tip };
}

/** "Next" coloured by what it says: ready, short of the thaw, or a step still to take. */
const tone = (n: Next): string => (n.kind === 'ready' ? 'ready' : n.kind === 'short' ? 'short' : 'todo');

/**
 * The line itself: a button that opens the focus picker (`data-cmd="focuspop"`, with the ARIA the
 * FOCUS chip had), its sentence in parts so each can take its colour. `night: false` leaves the
 * night out (the first-morning guide hasn't shown it yet). Empty once the run is over: there's no
 * "next" then, and the outcome card says how it went.
 */
export function standingLine(s: Region1State, t: T, opts: { open: boolean; night?: boolean }): string {
  if (s.outcome) return '';
  const st = standing(s);
  const parts = [st.lock
    ? `<span class="sl-lock">${esc(t('stand.lock', { why: lockText(st.lock, t) }))}</span>`
    : `<span class="sl-next ${tone(st.next)}">${esc(nextText(st.next, t))}</span>`];
  const night = opts.night === false ? null : tonightText(s, t);
  if (night) parts.push(`<span class="sl-night ${night.cls}">${esc(night.text)}</span>`);
  if (st.focus) {
    const name = focusName(st.focus.focus, t);
    parts.push(`<span class="sl-focus">${esc(t(st.focus.frayed ? 'stand.focusFrayed' : 'stand.focus', { name }))}</span>`);
  }
  const tip = [t('stand.tip'), night?.tip ?? ''].filter(Boolean).join(' ');
  const aria = `data-cmd="focuspop" aria-haspopup="dialog" aria-expanded="${opts.open}" aria-controls="${FOCUS_POP_ID}"`;
  return `<button class="standline${st.lock ? ' locked' : ''}" ${aria} title="${esc(tip)}">${parts.join(' ')}</button>`;
}

/**
 * What the line says, for PROGRESS to agree with (progress-view.ts `StandingNote`). Undefined once
 * the run is over, when the line is empty: PROGRESS is then drawn as before.
 */
export function standingNote(s: Region1State, t: T): StandingNote | undefined {
  if (s.outcome) return undefined;
  const next = nextOf(s);
  return { ready: next.kind === 'ready', next: nextText(next, t) };
}
