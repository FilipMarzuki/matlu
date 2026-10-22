/**
 * The PROGRESS tab in the viewer's language (#1711, phase 4 of #1685): the season's timeline, the
 * winter outlook (food, fuel and warmth against the nights to the thaw), the milestones, the past
 * runs, and the journal beside them.
 *
 * Moved out of main.ts so it can be drawn in a unit test, as a pure function of the run, the
 * finished runs and `t`. The status bar's verdict (`outlookTag` in main.ts) and the "where you
 * stand" line (#1926) read the same shortfalls (`outlookShortfalls`).
 */

import type { Key, T } from '../artificer/i18n';
import { REGION1_MILESTONES, warmth, winterOutlook, FIRE_WARMTH, type Region1State, type WinterOutlook } from '../artificer/region1';
import { MIDWINTER_AFTER } from '../artificer/winter';
import { nightTemp, coldNightNeeds } from '../artificer/weather';
import { bestRun, type RunRecord } from '../artificer/legacy';
import { seasonView, weatherReport } from '../artificer/weather-words';
import { keyMetrics, outlookNights, type KeyMetric } from '../artificer/key-metrics';
import { esc, pct } from './html';

const plural = (t: T, key: string, n: number, vars: Record<string, string | number> = {}): string => t(`${key}.${n === 1 ? 'one' : 'other'}` as Key, { n, ...vars });

/**
 * The season as a bar: autumn, winter, the thaw, and today. Until the calendar is earned (#1729,
 * weather-words.ts) there's no bar to draw: the season as you sense it, and the count if you keep one.
 */
export function timeline(s: Region1State, t: T): string {
  const view = seasonView(s);
  if (view === 'words' || view === 'tally') {
    const r = weatherReport(s);
    const lines = [
      t(`wx.season.${r.season}`),
      ...(r.tally ? [t(`wx.tally.${r.tally}`, { n: s.day })] : []),
      ...(r.toSnow !== null ? [t(r.toSnow === 1 ? 'wx.toSnow.one' : 'wx.toSnow.other', { n: r.toSnow })] : []),
    ];
    return `<div class="wxwords">${lines.map(l => `<p>${esc(l)}</p>`).join('')}</div>`;
  }
  const cal = s.config.calendar;
  const last = cal.thawDay;
  // Day d sits at the left edge of its slot; slots are 1/last wide.
  const x = (d: number): number => ((d - 1) / last) * 100;
  return `<div class="timeline">`
    + `<div class="season autumn" style="width:${x(cal.winterDay)}%"></div>`
    + `<div class="season winter" style="width:${100 - x(cal.winterDay)}%"></div>`
    + `<span class="lbl" style="left:0">${esc(t('progress.autumn'))}</span>`
    + `<span class="lbl" style="left:${x(cal.winterDay)}%">${esc(t('progress.winter'))}</span>`
    + `<span class="lbl" style="left:${x(cal.thawDay) - 8}%">${esc(t('progress.thaw'))}</span>`
    + `<div class="today" style="left:${Math.min(99.5, x(s.day + 0.5))}%"></div></div>`
    + `<div class="tl-legend"><span>${t('progress.autumnHtml', { a: 1, b: cal.winterDay - 1 })}</span><span>${t('progress.winterHtml', { a: cal.winterDay, b: cal.thawDay - 1 })}</span><span>${t('progress.thawHtml', { n: cal.thawDay })}</span></div>`;
}

/**
 * One thing the winter outlook says falls short of the thaw: the food or the firewood (the nights
 * it lasts, `have`, against the nights to last, `need`; for firewood also the wood still to find),
 * or the shelter too cold for a clear midwinter night.
 */
export type Shortfall =
  | { what: 'food'; have: number; need: number }
  | { what: 'fuel'; have: number; need: number; more: number }
  | { what: 'cold' };

/**
 * What falls short of the thaw, as data (empty when nothing does), in the order PROGRESS lists it:
 * food, firewood, warmth. The one rule for "short": the warnings below, the status bar's verdict and
 * the "where you stand" line (#1926, standing-line.ts) all read it, so they can't disagree.
 */
export function outlookShortfalls(s: Region1State): Shortfall[] {
  const o = winterOutlook(s);
  const need = outlookNights(s);
  const out: Shortfall[] = [];
  if (need === 0) return out; // the thaw: nothing left to last
  if (o.foodDays < need) out.push({ what: 'food', have: o.foodDays, need });
  if (o.fuelDays < need) out.push({ what: 'fuel', have: o.fuelDays, need, more: Math.max(0, o.fuelToThaw - s.stores.firewood) });
  if (o.warmthMargin < 0) out.push({ what: 'cold' });
  return out;
}

/** What falls short of the thaw, in plain words (empty when nothing does). */
export function outlookWarnings(s: Region1State, t: T): string[] {
  return outlookShortfalls(s).map(f => (f.what === 'food' ? plural(t, 'progress.foodShort', f.have, { m: f.need - f.have })
    : f.what === 'fuel' ? plural(t, 'progress.fuelShort', f.have, { m: f.more })
      : t('progress.tooCold')));
}

/**
 * What the "where you stand" line says (#1926, standing-line.ts `standingNote`), for PROGRESS to agree
 * with it: whether it says you're ready, and, when it doesn't, its "Next: …" sentence. Left out
 * (the switch off), PROGRESS is drawn exactly as before.
 */
export interface StandingNote { ready: boolean; next: string }

/**
 * One key metric's row (#1915): its bar against the winter outlook's need, its amount in one unit —
 * food in days, firewood in pieces with the nights it lasts in brackets, water as a plain count — and
 * its HOLDING / FALLING SHORT tag. A need of 0 (a cave's steady air asks no fire, #1770) is said in
 * words, not "12 of ~0". Water, fetched as you go, has no bar and no tag.
 */
function keyRow(m: KeyMetric, o: WinterOutlook, t: T): string {
  const name = t(`keys.row.${m.id}` as Key);
  if (m.need === null) return `<div class="pillar nobar"><span class="pn">${esc(name)}</span><span class="kn">${esc(t('keys.asYouGo', { n: m.value }))}</span></div>`;
  const text = m.need === 0 ? t('keys.noneNeeded', { n: m.value })
    : m.id === 'food' ? t(`keys.of.food.${m.need === 1 ? 'one' : 'other'}`, { n: m.value, m: m.need })
      : t(`keys.of.firewoodNights.${o.fuelDays === 1 ? 'one' : 'other'}`, { n: m.value, m: m.need, k: o.fuelDays });
  const ok = m.holding !== false;
  const amt = `<span class="amt"><span class="kn">${esc(text)}</span><span class="st ${ok ? 'done' : 'short'}">${esc(t(ok ? 'status.holding' : 'status.short'))}</span></span>`;
  return `<div class="pillar"><span class="pn">${esc(name)}</span><div class="track"><div class="fill ${ok ? 'done' : 'short'}" style="width:${pct(m.need ? m.value / m.need : 1)}%"></div></div>${amt}</div>`;
}

/**
 * The winter outlook (#1308, folded together with the key stores in #1915): each key metric
 * (key-metrics.ts) against the winter's need — food, firewood and water, each in one unit — then
 * warmth against the year's hardest night, the warnings and the "enough" line.
 */
export function outlookBlock(s: Region1State, t: T, note?: StandingNote): string {
  const cal = s.config.calendar;
  const o = winterOutlook(s);
  const warmNeed = coldNightNeeds(nightTemp(cal.winterDay + MIDWINTER_AFTER, 'clear', cal));
  const row = (name: string, progress: number, status: string, ok: boolean): string =>
    `<div class="pillar"><span class="pn">${esc(name)}</span><div class="track"><div class="fill ${ok ? 'done' : 'short'}" style="width:${pct(progress)}%"></div></div><span class="st ${ok ? 'done' : 'short'}">${esc(status)}</span></div>`;
  const warnings = outlookWarnings(s, t);
  return keyMetrics(s).map(m => keyRow(m, o, t)).join('')
    // Warmth is judged against the year's hardest kind of night: clear, at midwinter.
    + row(t('progress.warmth'), (warmth(s) + FIRE_WARMTH) / warmNeed, `${Math.floor((warmth(s) + FIRE_WARMTH) * 100)}% / ${Math.ceil(warmNeed * 100)}%`, o.warmthMargin >= 0)
    + (warnings.length ? `<ul class="warnlist">${warnings.map(w => `<li>⚠ ${esc(w)}</li>`).join('')}</ul>` : `<p class="mood ok">${esc(t('progress.enough'))}</p>`)
    // Enough laid by, but the line still has a step for you (the larder of rations, the body…): say
    // the same here, so "enough" never reads as "ready" beside it (#1926).
    + (note && !note.ready && !warnings.length ? `<p class="mood standnote">${esc(t('stand.progress.notYet', { next: note.next }))}</p>` : '');
}

/**
 * The milestones, done or still to do. Milestones latch (readiness.ts): once reached they stay
 * ticked. With the "where you stand" line (#1926) a ticked Winter-ready that the line doesn't
 * agree with now says "(not now)", so the two can't contradict each other.
 */
export function milesBlock(s: Region1State, t: T, note?: StandingNote): string {
  return `<ol class="miles">${REGION1_MILESTONES.map(m => {
    const done = s.milestones.includes(m.id);
    const name = t(`w.mile.${m.id}` as Key);
    const lapsed = done && m.id === 'ready' && note && !note.ready ? ` <span class="mnow">(${esc(t('stand.progress.notNow'))})</span>` : '';
    return `<li class="${done ? 'done' : ''}"><span class="mk">${done ? '✓' : '·'}</span><span class="mn">${esc((name === `w.mile.${m.id}` ? m.name : name).toUpperCase())}</span>${lapsed}</li>`;
  }).join('')}</ol>`;
}

/** The history of finished runs (newest first), with the best one marked. Empty with none: the tab leaves PAST WARDENS out (#1866). */
export function pastRuns(history: readonly RunRecord[], t: T): string {
  if (!history.length) return '';
  const best = bestRun(history);
  return `<ol class="runs">${history.map(r => `<li class="${r === best ? 'best' : ''}"><span class="rn">${r.characterName ? `${esc(r.characterName)} · ` : ''}${esc(t('progress.run', { n: r.run }))}</span>`
    + `<span class="rk k-${r.kind}">${esc(t(`progress.kind.${r.kind}` as Key))}${r.grade ? ` — ${esc(t(`grade.${r.grade}` as Key))}` : ''}${r.injury ? ` · ${esc(t('progress.frostbite'))}` : ''}</span>`
    + `<span class="rd">${esc(t('progress.day', { n: r.day }))}${r.readyDay ? ` · ${esc(t('progress.ready', { n: r.readyDay }))}` : ''} · ${esc(t('progress.recipes', { n: r.recipes }))}</span>${r === best ? `<span class="rb">${esc(t('progress.best'))}</span>` : ''}</li>`).join('')}</ol>`;
}

/**
 * The PROGRESS tab: the season, the outlook, the milestones and the past runs (only once a winter has
 * been finished, #1866); the journal (already
 * drawn) beside them. `journalHead` is the journal's heading when the page draws it itself (with the
 * 📖 and the notes, #1838); left out, the plain JOURNAL heading. `note` is what the "where you stand"
 * line says (#1926), with that switch on; left out, the tab is as before.
 */
export function progressTab(s: Region1State, history: readonly RunRecord[], journalHtml: string, t: T, journalHead?: string, note?: StandingNote): string {
  return `<div class="cols">
        <section class="box"><p class="eyebrow ice">${esc(t('head.season'))}</p>${timeline(s, t)}
          <p class="eyebrow" style="margin-top:16px">${esc(t('head.outlook'))}</p>${outlookBlock(s, t, note)}
          <p class="eyebrow" style="margin-top:16px">${esc(t('head.milestones'))}</p>${milesBlock(s, t, note)}
          ${history.length ? `<p class="eyebrow" style="margin-top:16px">${esc(t('head.pastRuns'))}</p>${pastRuns(history, t)}` : ''}</section>
        <section class="box log">${journalHead ?? `<p class="eyebrow" style="color:var(--faint);margin-bottom:7px">${esc(t('head.journal'))}</p>`}<ul class="full">${journalHtml}</ul></section>
      </div>`;
}
