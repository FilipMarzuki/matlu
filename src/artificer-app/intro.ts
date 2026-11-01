/**
 * The intro (#1228): the quick start (#1928), the only intro since #2009. One story page (a weekend
 * hike, and a seam in the air you fall through), then a card: "You're Saga, 12, a scout. Your pack
 * is ready." with Play, or Change for the creation and pack screens, which lead back to the card.
 *
 * Pure on purpose — it only decides *what* the intro says, from the sim state,
 * so it can be unit-tested; main.ts decides how it looks and when it plays.
 *
 * The words come from the string catalog (#1707) in the viewer's language: `t` is the page's
 * translate function, English by default (the tests, and anything else that asks).
 */

import type { Region1State } from '../artificer/region1';
import { makeT, type T } from '../artificer/i18n';
import { statsBeforePack } from '../artificer/kit';
import { gradeWord, recipeName } from './sim-words';
import { esc } from './html';

export { artificerRank, conceptRanks, RANKS } from '../artificer/rank';

/** Each intro screen's name (#1845). */
export type BeatId = 'fall' | 'create' | 'pack' | 'ready';

/**
 * One screen of the intro.
 * - `narration`: the player's own senses (prose): the story page.
 */
export interface Beat {
  /**
   * Which screen this is, by name (#1845): what feedback sent from the intro says the player was on
   * ("intro: pack").
   */
  id: BeatId;
  /**
   * `create`: the character-creation screen (name, portrait, talents, stats) — #1239, #1258, #1263.
   * `pack`: packing for the hike (#1401). `ready`: the quick start's card (#1928), with Play and Change.
   */
  kind: 'narration' | 'create' | 'pack' | 'ready';
  lines: string[];
  /** Show the portal behind this beat. */
  portal?: boolean;
}

const EN = makeT('en');

/** The ready-made Warden's name (#1928): what the creation screen's name starts as, and changes from. */
export const QUICK_NAME = 'Saga';

/**
 * Where the quick start is (#1928). `ready`: the story page, then the card with Play and Change.
 * `change`: the player tapped Change, so the creation and pack screens come between the two, in the
 * order the run's `stats-before-pack` sets, and lead back to the card. `age` is the age the card
 * says: the draft's, which the creation screen can change.
 */
export interface QuickStep { step: 'ready' | 'change'; age: number }

/**
 * The intro's beats for a Warden about to start `s`, in the language `t` speaks, at the quick
 * start's `quick` step (#1928; the only intro since #2009, which retired the whole arrival).
 */
export function introBeats(s: Region1State, t: T, quick: QuickStep): Beat[] {
  // What the last Warden left (#1455): one run each, and the tools pass on.
  const left = s.tools.filter(x => x.heirloom).map(x => t('intro.heirloom', { grade: gradeWord(x.grade, t), item: recipeName(x.item, t).toLowerCase() })).join(', ');
  // One story page (the hike, and the seam you fall through, which is all LAND's first note assumes
  // you know), then the card. What the last Warden left and the winter ride on the card, the two
  // things the old arrival's voice said that matter in play (#1830). The creation screen asks in the
  // scout's own voice ("Who are you?") in either order.
  const fall: Beat = { id: 'fall', kind: 'narration', portal: true, lines: [t('intro.hike1'), t('intro.seam1'), t('intro.seam2')] };
  // `{name}` stays in the line: fillName fills it with the draft's name.
  const ready: Beat = { id: 'ready', kind: 'ready', lines: [t('quick.ready', { age: quick.age }), ...(left ? [t('intro.before'), t('intro.left', { list: left })] : []), t('intro.winter')] };
  if (quick.step === 'ready') return [fall, ready];
  // Change: the creation and pack screens, in the order the run's `stats-before-pack` sets (#1872),
  // so the stats chosen can shape the pack; then back to the card.
  const create: Beat = { id: 'create', kind: 'create', lines: [t('intro.whoAreYou')] };
  const pack: Beat = { id: 'pack', kind: 'pack', lines: [t('intro.pack')] };
  return [fall, ...(statsBeforePack(s) ? [create, pack] : [pack, create]), ready];
}

/** Put the Warden's name into a line ("{name}"); an unnamed Warden is just "Artificer". */
export const fillName = (line: string, name: string, t: T = EN): string => line.replace(/\{name\}/g, name.trim() || t('intro.noName'));

/**
 * Where feedback sent from the intro says the player was (#1845), in the context fields the 💬 panel
 * already sends (`where.stage`, `where.tab`; the `artificer_feedback` row keeps the context as
 * jsonb): the stage is "intro" and the tab names the beat, "intro: pack". No new field, so no
 * schema change, and the server's cleaner keeps both as they are (letters, spaces and ":").
 */
export const introWhere = (b: Pick<Beat, 'id'>): { stage: string; tab: string } => ({ stage: 'intro', tab: `intro: ${b.id}` });

/** What one intro screen is drawn from: the page works these out, `introHtml` only lays them out. */
export interface IntroView {
  beat: Beat;
  /** Which beat this is (0-based) and how many there are, for the dots. */
  i: number;
  count: number;
  /** The Warden's name so far, for `{name}` lines. */
  name: string;
  /** The creation or packing form under the lines (already HTML), or ''. */
  form: string;
  /** The Next button waits (the creation screen without a name). */
  nextDisabled: boolean;
  /** The 💬 feedback button's HTML (feedback-panel.ts `button`), shown on every beat (#1845). */
  feedback: string;
  t: T;
}

/**
 * One intro screen's markup. Pure, so the tests can check what every beat shows; main.ts puts it in
 * the overlay and wires the clicks.
 *
 * - The 💬 button sits in its own corner (`.introfb`, top right), outside the beat and the bottom
 *   bar, so it never covers the intro's words or its Skip / Next.
 * - The pack beat's question is a heading (`.packq`, #1844), not a line of prose: the intro's
 *   strongest type, on its own soft panel, pinned above the pack while the list scrolls under it.
 */
export function introHtml(v: IntroView): string {
  const { beat: b, t } = v;
  const said = b.lines.map(l => esc(fillName(l, v.name, t)));
  // Each line fades in after the one before (--n drives the CSS animation delay).
  const lines = b.kind === 'pack'
    ? said.map((l, n) => `<h2 class="packq" style="--n:${n}">${l}</h2>`).join('')
    : said.map((l, n) => `<p style="--n:${n}">${l}</p>`).join('');
  const dots = Array.from({ length: v.count }, (_, n) => `<i class="${n === v.i ? 'on' : n < v.i ? 'past' : ''}"></i>`).join('');
  const next = t(b.kind === 'ready' ? 'quick.play' : b.kind === 'pack' ? 'intro.offWeGo' : 'intro.next');
  // The card (#1928) has no Skip: Play is it. Change opens the creation and pack screens.
  const aside = b.kind === 'ready' ? `<button class="pill" data-intro="change">${esc(t('quick.change'))}</button>`
    : `<button class="pill" data-intro="skip">${esc(t('intro.skip'))}</button>`;
  return `
    <div class="portal ${b.portal ? 'open' : ''}" aria-hidden="true"></div>
    <div class="introfb">${v.feedback}</div>
    <div class="beat ${b.kind}" data-beat="${b.id}" aria-live="polite">${lines}${v.form}</div>
    <div class="introbar">
      <span class="dots" aria-hidden="true">${dots}</span>
      <span class="spacer"></span>
      ${aside}
      <button class="btn go" data-intro="next" ${v.nextDisabled ? 'disabled' : ''}>${esc(next)}</button>
    </div>`;
}
