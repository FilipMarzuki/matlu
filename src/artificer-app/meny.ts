/**
 * The ⚙ Menu (#1808): one page behind a gear in the header that gathers what used to crowd the
 * header and the help panel (new game, profile, language, guide, look, other ways to play,
 * experiments, dev mode). The header keeps only the title, the Warden, the day (and the week's chip
 * while playing the weekly world), help, feedback and the ⚙.
 *
 * A ui feature (`meny`): off, the header and the help panel are drawn exactly as before. Pure: the
 * page passes in the controls it draws itself (they read its own state: the open dev gate, the look
 * preview, …), and this file decides where each one goes, so a unit test can check the layout
 * without a browser.
 */

import type { T, Key } from '../artificer/i18n';
import { esc } from './html';

export const MENY_FEATURE = 'meny';

// ── The header ───────────────────────────────────────────────────────────────

/**
 * The header's controls after the title, each already drawn ('' for one that doesn't show here:
 * there's no help button on the road, no week chip outside the weekly world, …).
 */
export interface HeaderParts {
  warden: string;
  /** The day (and on the road the marks): the counters. */
  counters: string;
  week: string;
  /** The road's 🧪 chip, while its run plays with an experimental rule. */
  experiment: string;
  dev: string;
  playAi: string;
  weekly: string;
  features: string;
  look: string;
  help: string;
  feedback: string;
  reset: string;
}

/**
 * The header's controls, in order. With the Menu on, the ones that moved into it (Play with your AI,
 * this week's world, 🧪 features, the look switcher, New save) are left out and the ⚙ comes last; the
 * DEV chip rides on the ⚙ itself (`menyButton`), so a screenshot still shows dev mode. Off, the
 * header is the one from before #1808.
 */
export function headerControls(menyOn: boolean, p: HeaderParts, meny: string): string {
  const order = menyOn
    ? [p.warden, p.counters, p.week, p.experiment, p.help, p.feedback, meny]
    : [p.warden, p.counters, p.week, p.experiment, p.dev, p.playAi, p.weekly, p.features, p.look, p.help, p.feedback, p.reset];
  return order.filter(Boolean).join('\n      ');
}

/**
 * The two-row header (#1824, ui switch `two-row-header`, which builds on the Menu): row 1 is the
 * place (the title; on the road the road's title), the day (and the week's chip, the road's 🧪),
 * the ⚙ and last the feedback, on one line; row 2 is the Warden and the three resources
 * (`wardenRow`, vital-words.ts). Help (?) has moved into the Menu as How to play, and the ⚙ draws
 * its word so that a narrow screen can drop it (`menyButton`'s `short`).
 */
export function headerRows(p: { title: string; counters: string; week: string; experiment: string; feedback: string; row2: string }, meny: string): string {
  const row1 = [p.title, p.counters, p.week, p.experiment, `<span class="spacer"></span>`, meny, p.feedback].filter(Boolean).join('\n      ');
  return `<div class="hrow hrow1">${row1}</div>\n    ${p.row2}`;
}

/**
 * The ⚙ that opens and shuts the Menu: expanded (and gold, like an open tab) while it shows. With
 * `short` (the two-row header), the word after the ⚙ is its own span, hidden on a narrow screen;
 * the aria-label names the button either way.
 */
export function menyButton(open: boolean, t: T, devTag = '', short = false): string {
  const label = t('meny.button');
  const gear = label.startsWith('⚙') ? '⚙' : '';
  const text = short && gear ? `<span class="menygear" aria-hidden="true">${gear}</span><span class="menyword">${esc(label.slice(gear.length).trim())}</span>` : esc(label);
  return `<span class="ctl"><button class="pill menybtn${open ? ' on' : ''}" data-cmd="meny" aria-expanded="${open}" aria-controls="meny" aria-label="${esc(t('meny.buttonLabel'))}">${text}${devTag}</button></span>`;
}

/** The controls that move into the Menu, drawn the same wherever they are. */
export const playAiLink = (t: T): string =>
  `<span class="ctl"><a class="pill" href="/play-with-ai/" title="${esc(t('top.playAiTip'))}">${esc(t('top.playAi'))}</a></span>`;
export const weeklyButton = (t: T): string =>
  `<span class="ctl"><button class="pill" data-cmd="weekly" title="${esc(t('top.weekTip'))}">${esc(t('top.week'))}</button></span>`;
export const newSaveButton = (t: T): string =>
  `<span class="ctl"><button class="pill" data-cmd="reset">${esc(t('top.newSave'))}</button></span>`;

/**
 * What the help (?) panel holds besides how to play: with the Menu on, nothing (language, guide,
 * backdrop and the dev gate are in the Menu); off, as before.
 */
export const helpExtras = (menyOn: boolean, extras: readonly string[]): string => (menyOn ? '' : extras.join(''));

// ── The page ─────────────────────────────────────────────────────────────────

/**
 * The sections, in the owner's order. Sound comes between the look and the other ways to play once
 * the game has sound; until then there's no section for it (#1808: "only once sound exists"). How to
 * play (the old ? panel) comes after the guide, with the two-row header (#1824); without it the
 * page gets no body for it, and it isn't drawn.
 */
export const MENY_SECTIONS = ['newgame', 'profile', 'language', 'guide', 'howto', 'visual', 'elsewhere', 'experiments', 'developer'] as const;
export type MenySection = (typeof MENY_SECTIONS)[number];

const TITLES: Record<MenySection, Key> = {
  newgame: 'meny.newGame', profile: 'meny.profile', language: 'meny.language', guide: 'meny.guide', howto: 'meny.howTo',
  visual: 'meny.visual', elsewhere: 'meny.elsewhere', experiments: 'meny.experiments', developer: 'meny.developer',
};

/**
 * The Menu page, in place of the tab body (like the Warden's view), with its way back. A section
 * whose body is empty (the guide on the road, say) isn't drawn.
 */
export function menyPage(bodies: Partial<Record<MenySection, string>>, t: T): string {
  const sections = MENY_SECTIONS.filter(id => bodies[id]).map(id =>
    `<section class="menysec" data-meny="${id}" aria-labelledby="meny-${id}"><h3 class="eyebrow" id="meny-${id}">${esc(t(TITLES[id]))}</h3>${bodies[id]}</section>`).join('');
  return `<section class="box meny" id="meny" aria-labelledby="meny-title">
    <div class="menyhead"><h2 class="eyebrow" id="meny-title" tabindex="-1">${esc(t('meny.title'))}</h2><button class="pill" data-cmd="menyclose">${esc(t('meny.back'))}</button></div>
    ${sections}</section>`;
}

/**
 * New game: "Start a new game" asks on the page first (`confirm()` doesn't work in every viewer),
 * then the confirmation's yes is today's New save (`data-cmd="reset"`). This week's world keeps its
 * own question, as before.
 */
export function newGameBody(o: { asking: boolean }, t: T): string {
  const start = o.asking
    ? `<div class="menyconfirm" role="group" aria-labelledby="meny-confirm"><p id="meny-confirm">${esc(t('meny.confirm'))}</p>`
      + `<button class="btn go" data-cmd="reset">${esc(t('meny.confirmYes'))}</button> <button class="pill" data-cmd="newgameno">${esc(t('meny.confirmNo'))}</button></div>`
    : `<button class="pill" data-cmd="newgame" title="${esc(t('meny.startTip'))}">${esc(t('meny.start'))}</button>`;
  return `<div class="menyrow">${start}</div><div class="menyrow"><button class="pill" data-cmd="weekly" title="${esc(t('top.weekTip'))}">${esc(t('meny.weekly'))}</button></div>`;
}

/**
 * Profile: what the game keeps about the player today, read-only. The runs played in this browser,
 * this run's id (what feedback attaches, so it can be quoted), and the Records.
 */
export function profileBody(o: { runs: number; runId: string; copied: boolean }, t: T): string {
  return `<p class="mood">${esc(t('meny.runs', { n: o.runs }))}</p>`
    + `<p class="mood menyid">${esc(t('meny.runId'))} <code>${esc(o.runId)}</code> <button class="pill" data-cmd="copyid">${esc(t('meny.copy'))}</button>${o.copied ? ` <span class="faint" role="status">${esc(t('meny.copied'))}</span>` : ''}</p>`
    + `<div class="menyrow"><a class="pill" href="/records/">${esc(t('meny.records'))}</a></div>`;
}

/** Other ways to play: with your AI, and the text console. */
export function elsewhereBody(t: T): string {
  return `<div class="menyrow"><a class="pill" href="/play-with-ai/" title="${esc(t('top.playAiTip'))}">${esc(t('top.playAi'))}</a>`
    + `<a class="pill" href="/console/" title="${esc(t('meny.consoleTip'))}">${esc(t('meny.console'))}</a></div>`;
}

/**
 * Experiments: what they are, whether this run has any on (the names of its experimental rules,
 * what the road's 🧪 chip says), and in dev mode their switches (`controls`).
 */
export function experimentsBody(o: { on: readonly string[]; dev: boolean; controls: string }, t: T): string {
  // Most new rules start as experiments, so the names can be many: the count, and the names folded.
  const run = o.on.length
    ? `<p class="mood"><b>${esc(t('meny.expOn', { n: o.on.length }))}</b></p><details class="menyexp"><summary>${esc(t('meny.expWhich'))}</summary><p class="mood">${esc(o.on.join(', '))}</p></details>`
    : `<p class="mood"><b>${esc(t('meny.expNone'))}</b></p>`;
  return `<p class="mood">${esc(t('meny.expNote'))}</p>${run}`
    + (o.dev ? o.controls : `<p class="mood">${esc(t('meny.expDev'))}</p>`);
}
