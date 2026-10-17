/**
 * The arrival intro (#1228): packing for a weekend hike (#1666), then pulled
 * through a portal, a voice designates your class and rank, then
 * "Survive. Thrive. Master your new reality."
 *
 * Pure on purpose — it only decides *what* the intro says, from the sim state,
 * so it can be unit-tested; main.ts decides how it looks and when it plays.
 *
 * The words come from the string catalog (#1707) in the viewer's language: `t` is the page's
 * translate function, English by default (the tests, and anything else that asks).
 */

import { CRAFT_WORLD, type Region1State } from '../artificer/region1';
import { artificerRank } from '../artificer/rank';
import { makeT, type T } from '../artificer/i18n';
import { gradeWord, rankName, recipeName } from './sim-words';
import { esc } from './html';

export { artificerRank, conceptRanks, RANKS } from '../artificer/rank';

/** Each intro screen's name (#1845). */
export type BeatId = 'hike' | 'pack' | 'portal' | 'stone' | 'arrival' | 'class' | 'create' | 'registered' | 'before' | 'title';

/**
 * One screen of the intro.
 * - `narration`: the player's own senses (prose).
 * - `voice`: the strange voice — terse, system-like.
 * - `title`: the closing card.
 */
export interface Beat {
  /**
   * Which screen this is, by name (#1845): what feedback sent from the intro says the player was on
   * ("intro: pack"). Kinds repeat (three narration screens), so the kind alone can't find the spot.
   */
  id: BeatId;
  /** `create`: the character-creation screen (name, portrait, talents, stats) — #1239, #1258, #1263. `pack`: packing for the hike (#1401). */
  kind: 'narration' | 'voice' | 'title' | 'create' | 'pack';
  lines: string[];
  /** Show the portal behind this beat. */
  portal?: boolean;
}

const EN = makeT('en');

/** The intro's beats for a Warden about to start `s`, in the language `t` speaks. */
export function introBeats(s: Region1State, t: T = EN): Beat[] {
  const rank = rankName(artificerRank(s, CRAFT_WORLD.concepts), t).toUpperCase();
  // What the last Warden left (#1455): one run each, and the tools pass on.
  const left = s.tools.filter(x => x.heirloom).map(x => t('intro.heirloom', { grade: gradeWord(x.grade, t), item: recipeName(x.item, t).toLowerCase() })).join(', ');

  return [
    // First the weekend (#1666): the hike, and packing for it — then the portal.
    { id: 'hike', kind: 'narration', lines: [t('intro.hike1'), t('intro.hike2'), t('intro.hike3')] },
    { id: 'pack', kind: 'pack', lines: [t('intro.pack')] },
    { id: 'portal', kind: 'narration', portal: true, lines: [t('intro.seam1'), t('intro.seam2')] },
    { id: 'stone', kind: 'narration', lines: [t('intro.stone1'), t('intro.stone2')] },
    { id: 'arrival', kind: 'voice', lines: [t('intro.arrival'), t('intro.scanning'), t('intro.threshold')] },
    { id: 'class', kind: 'voice', lines: [t('intro.class'), t('intro.rank', { rank })] },
    { id: 'create', kind: 'create', lines: [t('intro.identify')] },
    // `{name}` stays in the line: fillName fills it once the Warden has one.
    // Just the name and the one thing that matters (the owner, #1830).
    { id: 'registered', kind: 'voice', lines: [t('intro.registered'), t('intro.winter')] },
    ...(left ? [{ id: 'before' as const, kind: 'voice' as const, lines: [t('intro.before'), t('intro.left', { list: left })] }] : []),
    { id: 'title', kind: 'title', lines: [t('intro.close1'), t('intro.close2'), t('intro.close3')] },
  ];
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
  const last = v.i === v.count - 1;
  const said = b.lines.map(l => esc(fillName(l, v.name, t)));
  // Each line fades in after the one before (--n drives the CSS animation delay).
  const lines = b.kind === 'pack'
    ? said.map((l, n) => `<h2 class="packq" style="--n:${n}">${l}</h2>`).join('')
    : said.map((l, n) => `<p style="--n:${n}">${l}</p>`).join('');
  const dots = Array.from({ length: v.count }, (_, n) => `<i class="${n === v.i ? 'on' : n < v.i ? 'past' : ''}"></i>`).join('');
  const next = t(last ? 'intro.begin' : b.kind === 'pack' ? 'intro.offWeGo' : 'intro.next');
  return `
    <div class="portal ${b.portal ? 'open' : ''}" aria-hidden="true"></div>
    <div class="introfb">${v.feedback}</div>
    <div class="beat ${b.kind}" data-beat="${b.id}" aria-live="polite">${lines}${v.form}</div>
    <div class="introbar">
      <span class="dots" aria-hidden="true">${dots}</span>
      <span class="spacer"></span>
      ${last ? '' : `<button class="pill" data-intro="skip">${esc(t('intro.skip'))}</button>`}
      <button class="btn go" data-intro="next" ${v.nextDisabled ? 'disabled' : ''}>${esc(next)}</button>
    </div>`;
}
