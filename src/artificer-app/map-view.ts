/**
 * The map on the LAND tab (#1730): the Reach as one character per square, what you can see of it,
 * and a tapped square's details. Moved out of main.ts (where it was the MAP tab, #1539, #1686) so
 * the merged LAND tab can be drawn in a unit test, as a pure function of the run and `t`.
 *
 * Two kinds: with the descriptive-map switch off, the Reach map as the MAP tab drew it
 * (`reachMapSection`, its own box below the rings); with it on and your map drawn, your own map
 * (`drawnMapBlock`), which sits at the top of the LAND tab with its legend folded into a "Key".
 * The settlements a square can open, and the province history under a tapped square, stay in
 * main.ts (they need the history worker's result); `provinceInfo` hands that in.
 */

import { drawnSight, reachOfRun } from '../artificer/descriptive-map';
import { hasKit } from '../artificer/kit';
import { mapRows, sightFor, GLYPH, type Biome, type Reach } from '../artificer/world/reach';
import { provincesOf, type Provinces } from '../artificer/world/provinces';
import type { Region1State } from '../artificer/region1';
import type { T } from '../artificer/i18n';
import { esc } from './html';
import { cellText } from './sim-words';
import { fold } from './fold';

/** The land a run's map is drawn from (main.ts keeps both cached; a test can leave them out). */
export interface MapWorld { reach: Reach; provinces: Provinces }
/** The page's map state: the square last tapped, and what its province remembers (main.ts). */
export interface MapUi { cell: { x: number; y: number } | null; provinceInfo?: (x: number, y: number) => string }

const SEAT_GLYPH = '#';

const worldOf = (s: Region1State): MapWorld => { const reach = reachOfRun(s); return { reach, provinces: provincesOf(reach) }; };

/** The map's key, in the viewer's language. */
export const mapLegend = (t: T): string => `<div class="legend maplegend">${(['meadow', 'heath', 'birch', 'pine', 'marsh', 'river', 'lake', 'scree', 'fell', 'snow'] as Biome[])
  .map(b => `<span><b class="m-${b}">${GLYPH[b]}</b> ${esc(t(`biome.${b}`).toLowerCase())}</span>`).join('')}<span><b class="m-camp">${GLYPH.camp}</b> ${esc(t('map.legend.camp'))}</span><span><b class="m-seat">#</b> ${esc(t('map.legend.seat'))}</span><span><b class="m-fog">${GLYPH.unknown}</b> ${esc(t('map.legend.unknown'))}</span></div>`;

/** The grid and what's under it: the tapped square's line, a settlement to enter, its province. */
function mapBody(s: Region1State, t: T, drawn: boolean, ui: MapUi, w: MapWorld): string {
  const r = w.reach;
  const seatAt = new Map(w.provinces.list.map(p => [p.seat.y * r.w + p.seat.x, p]));
  // Your own drawn map (#1686) shows only what you've seen; with the switch off, the Reach map as before.
  const sight = drawn ? drawnSight(s) : sightFor(r, s.explore);
  const rows = mapRows(r, sight);
  const cell = ui.cell;
  const grid = rows.map((row, y) => [...row].map((ch, x) => {
    // Glimpsed squares (only suspected so far) draw dimmer than ones you've surveyed or worked.
    const seen = sight(x, y);
    const seat = seen > 0 && seatAt.has(y * r.w + x) && !(x === r.camp.x && y === r.camp.y);
    const cls = x === r.camp.x && y === r.camp.y ? 'm-camp' : seat ? `m-seat${seen === 1 ? ' dim' : ''}` : seen > 0 ? `m-${r.cells[y * r.w + x].biome}${seen === 1 ? ' dim' : ''}` : 'm-fog';
    const sel = cell?.x === x && cell?.y === y ? ' sel' : '';
    return `<span class="${cls}${sel}" data-cell="${x},${y}">${esc(seat ? SEAT_GLYPH : ch)}</span>`;
  }).join('')).join('\n');
  const known = !!cell && sight(cell.x, cell.y) > 0;
  const info = !cell ? t('map.tap') : known ? cellText(r, cell.x, cell.y, t) : t('map.unknown');
  const seatHere = known && cell ? seatAt.get(cell.y * r.w + cell.x) : undefined;
  const enter = seatHere ? `<p class="mapinfo">${t('map.standsHtml', { name: esc(seatHere.name) })} <button class="pill" data-settle="${seatHere.id}">${esc(t('btn.enter', { name: seatHere.name.toUpperCase() }))}</button></p>` : '';
  return `<div class="mapwrap"><pre class="reachmap" aria-label="${esc(t('map.rows', { name: t(drawn ? 'map.yourMap' : 'map.reachMap'), rows: rows.length, w: r.w }))}">${grid}</pre></div>
    <p class="mapinfo">${esc(info)}</p>${enter}${known && cell && ui.provinceInfo ? ui.provinceInfo(cell.x, cell.y) : ''}`;
}

/** With the descriptive-map switch off: the Reach map, in its own box, as the MAP tab drew it. */
export function reachMapSection(s: Region1State, t: T, ui: MapUi = { cell: null }, w: MapWorld = worldOf(s)): string {
  return `<section class="box"><p class="eyebrow">${esc(t('head.reachMap'))}</p>
    ${mapBody(s, t, false, ui, w)}${mapLegend(t)}
    <p class="mood">${esc(`${t('map.square')} ${t('map.reachNote')}`)}</p></section>`;
}

/** Your own drawn map (#1686), for the top of the LAND tab: the grid, the tapped square, and the legend in a "Key". */
export function drawnMapBlock(s: Region1State, t: T, ui: MapUi = { cell: null }, w: MapWorld = worldOf(s)): string {
  const note = `${t('map.square')} ${t(hasKit(s, 'map-compass') ? 'map.drawnCompass' : 'map.drawnNoCompass')}`;
  return `${mapBody(s, t, true, ui, w)}${fold('land.mapKey', esc(t('land.key')), `${mapLegend(t)}<p class="mood">${esc(note)}</p>`, false, 'keyfold')}`;
}
