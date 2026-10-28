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

import { drawnSight, landOrigin, reachOfRun, withSeenOut, withShores } from '../artificer/descriptive-map';
import { hasKit } from '../artificer/kit';
import { mapRows, sightFor, GLYPH, IN_VIEW_HOURS, type Biome, type Reach, type Sight } from '../artificer/world/reach';
import { provincesOf, type Provinces } from '../artificer/world/provinces';
import { landOfRun, roadAnchorsOf, toLocal, type Land } from '../artificer/world/hex-window';
import { furtherOff, furtherOffLine, ownHexOf, type FurtherOff } from '../artificer/hex-words';
import { seedOf } from '../artificer/rng';
import { cellsOfHex, hexKey, hexOfCell } from '../../worldmap/coords';
import { summariesAround, KNOWN_RADIUS } from '../../worldmap/hex-summary';
import { hexName, type HexNameLang } from '../../worldmap/hex-names';
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

const worldOf = (s: Region1State): MapWorld => {
  const reach = reachOfRun(s);
  return { reach, provinces: provincesOf(reach, { roadAnchors: roadAnchorsOf(s.config.world.features) }) };
};

/** Every biome's glyph and name (lower case), shared by the Reach map's key and the hex overview's. */
const BIOME_LEGEND: readonly Biome[] = ['meadow', 'heath', 'birch', 'pine', 'marsh', 'river', 'lake', 'scree', 'fell', 'snow'];
const biomeLegendItems = (t: T): string => BIOME_LEGEND.map(b => `<span><b class="m-${b}">${GLYPH[b]}</b> ${esc(t(`biome.${b}`).toLowerCase())}</span>`).join('');

/** The map's key, in the viewer's language. */
export const mapLegend = (t: T): string => `<div class="legend maplegend">${biomeLegendItems(t)}<span><b class="m-camp">${GLYPH.camp}</b> ${esc(t('map.legend.camp'))}</span><span><b class="m-seat">#</b> ${esc(t('map.legend.seat'))}</span><span><b class="m-fog">${GLYPH.unknown}</b> ${esc(t('map.legend.unknown'))}</span></div>`;

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

// ── The drawn hex map (#1903, hex world step 10 of 17, #1873; plan: docs/spikes/artificer-hex-world.md
// §6 Views, "The hex overview, drawn" and "The cell map") ───────────────────
//
// Replaces the block above once `mapLearned` and the `hex-world` switch are both on: the known
// world as one glyph per hex (`hexOverviewBlock`), then the current hex's own ground as a square
// grid (`hexCellMapBlock`), under the same "Key" fold. Before a map is made, or with the switch
// off, this file is untouched: land-view.ts keeps the words (#1902) or the old drawn map.

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The hex overview's own tapped hex (main.ts keeps it, like `MapUi.cell` for the cell grid). */
export interface HexOverviewUi { hex: { q: number; r: number } | null }

/** The hex overview's key: the same biomes as the Reach map's, plus what `@`, `?` and `·` mean there. */
const hexLegend = (t: T): string => `<div class="legend maplegend">${biomeLegendItems(t)}<span><b class="m-camp">${GLYPH.camp}</b> ${esc(t('map.legend.you'))}</span><span><b class="m-heard">?</b> ${esc(t('map.legend.heard'))}</span><span><b class="m-fog">${GLYPH.unknown}</b> ${esc(t('map.legend.unknown'))}</span></div>`;

/** One hex's glyph and style on the overview; `tap` is set only for a hex tapping can say something about (#1902's `furtherOff`). */
interface HexCell { ch: string; cls: string; tap?: FurtherOff }

/**
 * Every hex within `KNOWN_RADIUS` (#1898) as a `HexCell`, in flat-top "doubled" offset coordinates
 * (`col = q`, `row = 2r + q`): adjacent columns fall on alternating rows, which is exactly "odd
 * columns sit half a row lower" (the spike's words) without any extra interleaving step. Blank
 * entries (` `, no class) are grid positions no hex within the radius maps to.
 */
function hexOverviewGrid(s: Region1State): HexCell[][] {
  const seed = seedOf(s.character.id);
  const own = ownHexOf(s);
  const far = new Map(furtherOff(s).map(f => [hexKey(f.hex), f]));
  const radius = KNOWN_RADIUS;
  const cols = 2 * radius + 1;
  const rows = 4 * radius + 1;
  const grid: HexCell[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, (): HexCell => ({ ch: ' ', cls: '' })));
  for (const sum of summariesAround(seed, radius)) {
    const { q, r } = sum.hex;
    const col = q + radius;
    const row = 2 * r + q + 2 * radius;
    const f = far.get(hexKey(sum.hex));
    grid[row][col] = q === own.q && r === own.r ? { ch: GLYPH.camp, cls: 'm-camp' }
      : !f ? { ch: GLYPH.unknown, cls: 'm-fog' }
      : f.how === 'seen' ? { ch: GLYPH[sum.biome], cls: `m-${sum.biome}`, tap: f }
      : { ch: '?', cls: 'm-heard', tap: f };
  }
  return grid;
}

/**
 * The hex overview, drawn (#1903): one glyph per hex within `KNOWN_RADIUS`, the legend in the "Key"
 * fold (hexCellMapBlock's note joins it there too). Tapping a hex that `furtherOff` has something to
 * say about shows its name and that line, in the viewer's language; `lang` picks the name's.
 */
export function hexOverviewBlock(s: Region1State, t: T, ui: HexOverviewUi = { hex: null }, lang: HexNameLang = 'en'): string {
  const grid = hexOverviewGrid(s);
  const seed = seedOf(s.character.id);
  const sel = ui.hex;
  const rowsHtml = grid.map(row => row.map(c => {
    if (!c.tap) return `<span class="${c.cls}">${esc(c.ch)}</span>`;
    const isSel = !!sel && sel.q === c.tap.hex.q && sel.r === c.tap.hex.r;
    return `<span class="${c.cls}${isSel ? ' sel' : ''}" data-hex="${c.tap.hex.q},${c.tap.hex.r}">${esc(c.ch)}</span>`;
  }).join('')).join('\n');
  const tapped = sel && furtherOff(s).find(f => f.hex.q === sel.q && f.hex.r === sel.r);
  const info = tapped
    ? `<p class="mapinfo"><b>${esc(capitalize(hexName(seed, tapped.hex, lang)))}</b></p><p class="mapinfo">${esc(furtherOffLine(tapped, t, seed, lang))}</p>`
    : `<p class="mapinfo">${esc(t('map.hexTap'))}</p>`;
  return `<div class="mapwrap"><pre class="reachmap hexoverview" aria-label="${esc(t('map.hexOverview'))}">${rowsHtml}</pre></div>${info}`;
}

/**
 * Sight over a `Land` (the window `landOfRun` gives, or the bare Reach with `hex-world` off), the
 * same rule `descriptive-map.ts`'s `drawnSight` uses for the Reach alone: the rings' knowledge plus
 * noted-seen squares (`withSeenOut`), ground only glimpsed from afar held back without a compass,
 * and a lake's far shore seen from the near one (`withShores`). The current hex's cell map (below)
 * is the one caller that needs this past the Reach's edge.
 */
function landSight(s: Region1State, land: Land): Sight {
  const base = withSeenOut(s, land, sightFor(land as Reach, s.explore));
  const compass = hasKit(s, 'map-compass');
  const placed: Sight = compass ? base : (x, y) => {
    const v = base(x, y);
    return v === 1 && land.hours[y * land.w + x] > IN_VIEW_HOURS ? 0 : v;
  };
  return withShores(land, placed);
}

/**
 * The current hex's cell map (#1903): `mapRows`-style rows over the bounding box of
 * `cellsOfHex(ownHexOf(s))` on `landOfRun(s)` — square, not hex-shaped, so its corners belong to
 * neighbouring hexes; those cells show as unseen fog unless you've actually seen them, dimmed when
 * you have (own-hex ground glimpsed but not surveyed dims the same way). Camp and where you stand
 * both mark `@`; camp wins where the two coincide.
 */
export function hexCellMapBlock(s: Region1State, t: T): string {
  const land = landOfRun(s);
  const own = ownHexOf(s);
  const cells = cellsOfHex(own);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cells) {
    if (c.cx < x0) x0 = c.cx;
    if (c.cx > x1) x1 = c.cx;
    if (c.cy < y0) y0 = c.cy;
    if (c.cy > y1) y1 = c.cy;
  }
  const sight = landSight(s, land);
  const origin = landOrigin(s, reachOfRun(s));
  const stand = s.afield ?? origin;
  const camp = { x: land.camp.x + land.ox, y: land.camp.y + land.oy };
  const rows: string[] = [];
  for (let wy = y0; wy <= y1; wy++) {
    let row = '';
    for (let wx = x0; wx <= x1; wx++) {
      const isCamp = wx === camp.x && wy === camp.y;
      const isHere = !isCamp && wx === stand.x && wy === stand.y;
      const local = toLocal(land, wx, wy);
      const level = local ? sight(local.x, local.y) : 0;
      if (isCamp || isHere) { row += `<span class="m-${isCamp ? 'camp' : 'here'}">${esc(GLYPH.camp)}</span>`; continue; }
      if (!local || level === 0) { row += `<span class="m-fog">${esc(GLYPH.unknown)}</span>`; continue; }
      const mine = hexOfCell({ cx: wx, cy: wy }).q === own.q && hexOfCell({ cx: wx, cy: wy }).r === own.r;
      const biome = land.cells[local.y * land.w + local.x].biome;
      const dim = !mine || level === 1 ? ' dim' : '';
      row += `<span class="m-${biome}${dim}">${esc(GLYPH[biome])}</span>`;
    }
    rows.push(row);
  }
  return `<div class="mapwrap"><pre class="reachmap" aria-label="${esc(t('map.hexCellMap'))}">${rows.join('\n')}</pre></div>`;
}

/** Your drawn hex map (#1903), for the top of the LAND tab: the overview, the current hex's cells, and the legend in a "Key". */
export function hexDrawnMapBlock(s: Region1State, t: T, ui: HexOverviewUi = { hex: null }, lang: HexNameLang = 'en'): string {
  const note = `${t('map.square')} ${t(hasKit(s, 'map-compass') ? 'map.drawnCompass' : 'map.drawnNoCompass')}`;
  return `${hexOverviewBlock(s, t, ui, lang)}${hexCellMapBlock(s, t)}${fold('land.mapKey', esc(t('land.key')), `${hexLegend(t)}<p class="mood">${esc(note)}</p>`, false, 'keyfold')}`;
}
