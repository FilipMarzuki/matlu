/**
 * The map-drawing session on the page (#1754, map-learning.ts): a blank grid, camp in the middle,
 * north up, and the list of what you've found. Tap a place, then the square where it goes (touch
 * and mouse alike); with a keyboard, Tab to the grid, move with the arrow keys and press Enter. A
 * near-enough square places it; a wrong one gets a hint from what the Warden knows. Once
 * everything is placed, "Draw it" queues the Draw your map action, which is what draws the map.
 *
 * Why a modal opened by the action, not a tab of its own: drawing is something the Warden does at
 * camp, for hours, like Make camp (#1732), so it's an action in the plan; the modal is just how a
 * person does the placing first (the AI and the API do the action itself). It sits over the page
 * the way an encounter does, so the day stays where it was underneath.
 *
 * Pure functions of the run, the session's page state and `t`; main.ts keeps the state and wires
 * the taps and keys (the decisions are map-learning.ts's, unit-tested there).
 */

import type { Key, T } from '../artificer/i18n';
import type { Region1State } from '../artificer/region1';
import {
  GRID, CENTRE, MAP_DRAW_HOURS, LOOK_AROUND_LINE, mapPlaces, sessionDone, cellBearing, onArrival,
  type Cell, type Hint, type MapPlace, type MapSession,
} from '../artificer/map-learning';
import { directionIndex } from '../artificer/descriptive-map';
import { esc } from './html';
import { landLines } from './sim-words';
import { siteBadge } from './rating-badges';
import type { SiteId } from '../artificer/region1';

/** What the session shows: where things are placed, the place picked, the keyboard's square, and the last word on a placement. */
export interface MapSessionUi {
  session: MapSession;
  selected: string | null;
  cursor: Cell;
  note: { kind: 'hint'; hint: Hint } | { kind: 'right'; id: string } | { kind: 'pick' } | null;
}

export const newSessionUi = (session: MapSession): MapSessionUi => ({ session, selected: null, cursor: { x: CENTRE, y: CENTRE }, note: null });

/** A place by name ("The stream", "The cave"), in the viewer's language. */
export const placeName = (p: Pick<MapPlace, 'kind'>, t: T): string => t(`mapl.name.${p.kind}` as Key);

/** A small mark for each kind, so the grid reads at a glance. */
const MARK: Readonly<Record<MapPlace['kind'], string>> = {
  stream: '〰', lake: '💧', marsh: '🌾', birch: '🌳', pine: '🌲', open: '🌼', high: '⛰️', cave: '🕳️', tree: '🌲', river: '〰', hill: '⛰️',
};
export const placeMark = (p: Pick<MapPlace, 'kind'>): string => MARK[p.kind];

const dirText = (d: { exact: boolean; i: number }, t: T): string => (d.exact ? t(`map.dir.${d.i}` as Key) : t(`map.vague.${d.i}` as Key));
const timeText = (w: Hint['time'], t: T): string => ('n' in w ? t(`map.time.${w.band}`, { n: w.n }) : t(`map.time.${w.band}`));
const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** A hint in words: the sharp Warden's says it all; else what was wrong, the direction first. */
export function hintText(hint: Hint, p: MapPlace, t: T): string {
  const name = placeName(p, t), was = dirText(hint.was, t), time = timeText(hint.time, t);
  if (hint.full) return t('mapl.hint.full', { name: lower(name), was, time });
  if (hint.dirWrong) return t('mapl.hint.dir', { name: lower(name), was, tapped: dirText(hint.tapped, t) });
  return t(hint.distance === 'further' ? 'mapl.hint.further' : 'mapl.hint.nearer', { name, time });
}

/** The direction of a square from camp, in the words the Warden uses (exact with the compass). */
const cellDir = (c: Cell, exact: boolean, t: T): string => dirText({ exact, i: directionIndex(cellBearing(c), exact) }, t);

/** A place to camp's rating badge (#1798, `camp-site-ratings`), as the LAND tab and Make camp show it; '' for any other place. */
const spotBadge = (s: Region1State, p: MapPlace, t: T): string => (p.spot ? siteBadge(s, { kind: p.kind as SiteId, x: p.x, y: p.y }, t) : '');

/** The session's modal. Empty when there's no session. */
export function mapSessionModal(s: Region1State, ui: MapSessionUi | null, t: T): string {
  if (!ui) return '';
  const places = mapPlaces(s);
  const exact = places[0]?.dir.exact ?? false;
  const placedN = places.filter(p => ui.session.placed[p.id]).length;
  const done = sessionDone(s, ui.session);
  const list = places.map(p => {
    const at = ui.session.placed[p.id];
    const on = ui.selected === p.id;
    return `<li><button class="mapl-place${on ? ' on' : ''}${at ? ' placed' : ''}" data-mapsel="${esc(p.id)}" aria-pressed="${on}" ${at ? 'disabled' : ''}>`
      + `<span class="mk" aria-hidden="true">${placeMark(p)}</span> <b>${esc(placeName(p, t))}</b>${p.spot ? ` <span class="faint">⛺ ${esc(t('mapl.spot'))}</span>${spotBadge(s, p, t)}` : ''}`
      + `${at ? ` <span class="mapl-ok">✓ ${esc(t('mapl.placed'))}</span>` : ''}`
      // What the Warden knows of it: the direction and walking time the LAND tab says, all there is to go by.
      + `<span class="mapl-where">${esc(t('campsite.where', { dir: dirText(p.dir, t), time: timeText(p.time, t) }))}</span></button></li>`;
  }).join('');
  const byCell = new Map<string, MapPlace[]>();
  for (const p of places) { const c = ui.session.placed[p.id]; if (c) byCell.set(`${c.x},${c.y}`, [...(byCell.get(`${c.x},${c.y}`) ?? []), p]); }
  const cells: string[] = [];
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    const c = { x, y };
    const camp = x === CENTRE && y === CENTRE;
    const here = byCell.get(`${x},${y}`) ?? [];
    const label = camp ? t('mapl.cellCamp') : here.length ? t('mapl.cellHas', { names: here.map(p => placeName(p, t)).join(', '), dir: cellDir(c, exact, t) }) : t('mapl.cellEmpty', { dir: cellDir(c, exact, t) });
    const cur = ui.cursor.x === x && ui.cursor.y === y;
    // A roving tabindex: one square of the grid is in the Tab order, the arrow keys move it (main.ts).
    cells.push(`<button class="mapl-cell${camp ? ' camp' : ''}${here.length ? ' has' : ''}${cur ? ' cur' : ''}" role="gridcell" data-mapcell="${x},${y}" tabindex="${cur ? 0 : -1}" aria-label="${esc(label)}">${camp ? '⛺' : here.map(placeMark).join('')}</button>`);
  }
  const grid = `<div class="mapl-gridwrap"><span class="mapl-n">${esc(t('mapl.n'))}</span><span class="mapl-e">${esc(t('mapl.e'))}</span><span class="mapl-s">${esc(t('mapl.s'))}</span><span class="mapl-w">${esc(t('mapl.w'))}</span>`
    + `<div class="mapl-grid" role="grid" aria-label="${esc(t('mapl.gridLabel'))}" style="--n:${GRID}">${cells.join('')}</div></div>`;
  const note = ui.note?.kind === 'hint' ? (() => { const p = places.find(q => q.id === (ui.note as { hint: Hint }).hint.id); return p ? `<p class="mapl-note hint">${esc(hintText(ui.note.hint, p, t))}</p>` : ''; })()
    : ui.note?.kind === 'right' ? (() => { const p = places.find(q => q.id === (ui.note as { id: string }).id); return p ? `<p class="mapl-note right">${esc(t('mapl.right', { name: placeName(p, t) }))}</p>` : ''; })()
    : ui.note?.kind === 'pick' ? `<p class="mapl-note">${esc(t('mapl.pick'))}</p>` : '';
  const bar = done
    ? `<p class="mapl-note right">${esc(t('mapl.done'))}</p><div class="runbar"><button class="btn go" data-cmd="mapdraw">${esc(t('mapl.drawIt', { h: MAP_DRAW_HOURS }))}</button> <button class="btn" data-cmd="mapclose">${esc(t('mapl.later'))}</button></div>`
    : `<div class="runbar"><button class="btn" data-cmd="mapclose">${esc(t('mapl.later'))}</button></div>`;
  return `<div class="enc-backdrop mapl-backdrop"><section class="enc box mapl" role="dialog" aria-modal="true" aria-labelledby="mapl-title">
    <button class="mapl-x" data-cmd="mapclose" aria-label="${esc(t('mapl.close'))}">✕</button>
    <p class="enc-kind" id="mapl-title">🗺️ ${esc(t('mapl.title'))} · ${esc(t('mapl.progress', { n: placedN, m: places.length }))}</p>
    <p class="enc-text">${esc(t('mapl.intro'))}</p>
    <p class="mapl-how faint">${esc(t('mapl.how'))}</p>
    <div class="mapl-body"><div class="mapl-side"><p class="eyebrow">${esc(t('mapl.list'))}</p><ul class="mapl-list">${list}</ul>${note}</div>${grid}</div>
    ${bar}</section></div>`;
}

/**
 * After the first day's look around in the journal (#1754): what lay where that morning, in the
 * viewer's language (the land as it was on arrival: map-learning.ts `onArrival`). '' for any other line.
 */
export function lookAroundLand(s: Region1State, line: { text: string }, t: T): string {
  if (line.text !== LOOK_AROUND_LINE) return '';
  return `<span class="lookland">${landLines(onArrival(s), t).map(l => esc(l)).join(' ')}</span>`;
}

/** The LAND tab's way in, once the session is open: a line and the button. */
export const mapSessionInvite = (t: T): string =>
  `<p class="mood mapl-invite">${esc(t('mapl.ready'))} <button class="pill" data-cmd="mapsession">${esc(t('mapl.open'))}</button></p>`;
