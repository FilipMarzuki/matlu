/**
 * The HISTORY tab, and a province's history on the MAP tab, in the viewer's language (#1711,
 * phase 4 of #1685).
 *
 * The chronicle is the story engine's (storytelling/render.ts renderLayeredChronicle): plain English
 * text, kept as it was told (the page stores it), its golden hashes pinned. So each line is read back
 * as it's drawn: a section rule becomes a heading, a dated line keeps its year, and every sentence
 * goes through `simLine` (sim-words.ts), whose `hist.*` templates (i18n/en/history.ts) know the
 * engine's sentences and whose parts (history-words.ts) say its names and words. A sentence no
 * template knows is drawn in English, as the engine wrote it. In English every line is untouched.
 *
 * Pure: the told history, which province camp is in, and `t` in; HTML out.
 */

import type { T } from '../artificer/i18n';
import type { ProvinceHistory, ReachHistory } from '../artificer/world/history-format';
import { esc } from './html';
import { simLine } from './sim-words';
import { cultureText, isEnglish, personText, titleText } from './history-words';

/** The marker the engine puts on a big regional event (render.ts EXTRA_MARK). */
const MARK = '◇';
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A lordship's name in the viewer's language, as a table or a heading shows it ("Häradet Ravenford"). */
export const lordshipName = (title: string, t: T): string => (isEnglish(t) ? title : cap(titleText(title, t) ?? title));
/** Who holds it, as the chronicle names them ("Ivar av Hedlund"). */
export const holderName = (holder: string, t: T): string => personText(holder, t) ?? holder;
/** A culture's name ("Fieldborn" → "åkerfödda"). */
export const cultureLabel = (culture: string, t: T): string => (isEnglish(t) ? culture : cultureText(culture, t) ?? culture);

/**
 * A sentence of the chronicle in the viewer's language. A big regional event in THE CHRONICLE
 * carries its year after it ("Plague swept through the Hollowford country, 3 of its 5 lands (84)."):
 * the sentence is read without it, and the year goes back on.
 */
export function chronicleSentence(text: string, t: T): string {
  const dated = text.match(/^(.*) \((\d+)\)\.$/s);
  if (dated && !/\(\d+–\d+\)$/.test(text)) {
    const said = simLine(`${dated[1]}.`, t);
    if (said !== `${dated[1]}.`) return `${said.replace(/\.$/, '')} (${dated[2]}).`;
  }
  // An age of legend: "the 100s — The Feud of … ; The Lords of …." Each thread is read on its own.
  const legend = text.match(/^the (\d+)s — (.*)\.$/s);
  if (legend) {
    const threads = legend[2].split('; ').map(x => simLine(x, t));
    return t('hist.legendCentury', { year: legend[1], line: `${threads.join('; ')}.` });
  }
  return simLine(text, t);
}

/**
 * The HISTORY tab (#1540): who holds the Reach now, and the chronicle the engine wrote. The
 * chronicle is plain text (the engine's layered renderer: threads for the older years, then living
 * memory year by year); its section rules become headings and its dated lines get their year picked out.
 * `h` null: the history is still being told. `campProvince` is the province camp is in, marked.
 */
export function historyTab(h: ReachHistory | null, campProvince: string | null, t: T): string {
  if (!h) return `<section class="box"><p class="eyebrow">${esc(t('head.history'))}</p><p class="mood">${esc(t('history.telling'))}</p></section>`;
  const lordships = h.provinces.map(p => `<tr><td><b>${esc(lordshipName(p.title, t))}</b>${p.id === campProvince ? ` <span class="chip">${esc(t('history.yourCamp'))}</span>` : ''}</td><td>${esc(cultureLabel(p.culture, t))}</td><td>${p.holder ? esc(holderName(p.holder, t)) : `<span class="faint">${esc(t('history.emptySeat'))}</span>`}</td></tr>`).join('');
  const body = h.chronicle.split('\n').map(line => {
    if (!line.trim() || /^[─═]+$/.test(line)) return '';
    if (/^(AGES OF LEGEND|THE CHRONICLE|LIVING MEMORY)/.test(line)) return `<p class="eyebrow chronhead">${esc(simLine(line, t))}</p>`;
    // A line marked ◇ is a big regional event (#1598): news from a region's countryside, not a court.
    const dated = line.match(/^\s*(\d+)\s{2}(.*)$/);
    const text = (dated ? dated[2] : line).trim();
    const regional = text.startsWith(`${MARK} `);
    const said = esc(chronicleSentence(regional ? text.slice(2) : text, t));
    const mark = regional ? `<span class="regmark" title="${esc(t('history.regionalTip'))}">${MARK}</span> ` : '';
    return `<p class="chron${regional ? ' regional' : ''}">${dated ? `<b>${dated[1]}</b> ` : ''}${mark}${said}</p>`;
  }).join('');
  return `<section class="box"><p class="eyebrow">${esc(t('head.history'))}</p>
    <p class="mood">${t('history.introHtml', { year: h.year, told: h.told, logged: h.logged, mark: `<span class="regmark">${MARK}</span>` })}</p>
    <p class="eyebrow" style="margin-top:12px">${esc(t('head.lordships'))}</p>
    <div class="tablewrap"><table class="lordships"><thead><tr><th>${esc(t('head.lordship'))}</th><th>${esc(t('head.people'))}</th><th>${esc(t('head.heldBy'))}</th></tr></thead><tbody>${lordships}</tbody></table></div>
    <div class="chronicle">${body}</div></section>`;
}

/**
 * Who holds a square's province, and what the province remembers (for the MAP tab's square info).
 * `name`/`culture` are the province's own (provinces.ts: `culture` is its id, named by the caller);
 * `h` is its told history, null while the history is still being told.
 */
export function provinceInfo(name: string, culture: string, h: ProvinceHistory | null | undefined, t: T): string {
  if (!h) return `<p class="mapinfo provinfo">${t('history.provTellingHtml', { name: esc(name), culture: esc(cultureLabel(culture, t)) })}</p>`;
  const lines = h.lines.map(l => `<li><b>${esc(t('history.year', { n: l.year }))}</b> ${esc(simLine(l.text, t))}</li>`).join('');
  const head = h.holder
    ? t('history.provHeldHtml', { title: esc(lordshipName(h.title, t)), culture: esc(cultureLabel(h.culture, t)), holder: esc(holderName(h.holder, t)) })
    : t('history.provEmptyHtml', { title: esc(lordshipName(h.title, t)), culture: esc(cultureLabel(h.culture, t)) });
  return `<p class="mapinfo provinfo">${head}</p>${lines ? `<ul class="provlines">${lines}</ul>` : ''}`;
}
