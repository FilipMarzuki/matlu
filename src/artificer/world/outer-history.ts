/**
 * History over the wider world (#1906, plan: docs/spikes/artificer-hex-world.md §7 "History over
 * the wider world"). Step 13 of 17 of the hex world (#1873).
 *
 * The outer provinces (worldmap/provinces.ts `outerProvinces`, #1904) get a history of their own:
 * a second run of the engine beside the Reach's (history.ts `runHistory`), over the hex-cluster
 * provinces outside the Reach rather than the Reach's own cell-grown ones. It shares the Reach's
 * house-building (`housesOf`) and engine code, but its own streams (`|hexworld|houses`,
 * `|hexworld|history`), so the Reach's own history stays byte-identical whether this runs or not.
 *
 * Told as plain data the same shape as the Reach's per-province lines (history-format.ts
 * `ProvinceHistory`), but with no chronicle text, regions or organisations: those, and the road's
 * people telling this history, are later work. `src/artificer-app/history.worker.ts` runs this off
 * the main thread, the way it runs the Reach's.
 */

import { loadWorld } from '../../../storytelling/seed';
import { tick } from '../../../storytelling/tick';
import { sift } from '../../../storytelling/sifter';
import { renderEvent } from '../../../storytelling/render';
import type { Terrain, WorldEvent } from '../../../storytelling/types';
import type { WorldSpec } from '../../../storytelling/world-spec';
import { generator, seedOf } from '../rng';
import { VILLAGES } from '../villages';
import { outerProvinces, type OuterProvince } from '../../../worldmap/provinces';
import { hexCells } from '../../../worldmap/rivers';
import { hexName } from '../../../worldmap/hex-names';
import { ROAD_VILLAGE_HEXES, type RoadVillageId } from '../../../worldmap/road';
import { hexKey, type CellXY, type Hex } from '../../../worldmap/coords';
import { REACH_W, REACH_H, type Cell } from './reach';
import { TERRAIN, FERTILITY, mostCommon, round2, type RoadAnchors, type WorldOpts } from './provinces';
import { REACH_CULTURES, REACH_PEOPLES, cultureName, type ReachCulture } from './peoples';
import { HISTORY_YEARS, TELL_THRESHOLD, HOUSE_START_YEAR, housesOf, pickLines, houseOf, fullName, type HouseProvince } from './history';
import { HISTORY_VERSION, type OuterHistory, type ProvinceHistory } from './history-format';

export { keptOuterHistory } from './history-format';
export { HISTORY_YEARS };
export type { OuterHistory };

/** The three road villages' ids, in `ROAD_VILLAGE_HEXES`' (and so `outerProvinces`' `h0`/`h1`/`h2`) order. */
const ROAD_VILLAGE_IDS: readonly RoadVillageId[] = ['hollowford', 'saltmere', 'kestrel-gate'];

/** The road village seated at hex `seat`, if any (`ROAD_VILLAGE_HEXES`). */
function anchorAt(seat: Hex): RoadVillageId | undefined {
  return ROAD_VILLAGE_IDS.find(id => hexKey(ROAD_VILLAGE_HEXES[id]) === hexKey(seat));
}

/** Is the cell inside the Reach rectangle? Those are the Reach provinces' own (never an outer province's). */
const inReach = (c: CellXY): boolean => c.cx >= 0 && c.cx < REACH_W && c.cy >= 0 && c.cy < REACH_H;

/** An outer province's own cells (its hexes', minus the Reach's part of any that reach into it), full with rivers (`hexCells`, #1897). */
function ownLand(seed: number, op: OuterProvince): Cell[] {
  const out: Cell[] = [];
  for (const hex of op.hexes) {
    const { cells, land } = hexCells(seed, hex);
    cells.forEach((c, i) => { if (!inReach(c)) out.push(land[i]); });
  }
  return out;
}

/** An outer province, adapted to the fields `reachSpec`'s provinces carry (history.ts, `housesOf`'s `HouseProvince` among them). */
interface OuterField extends HouseProvince {
  terrain: Terrain;
  fertility: number;
  lakeside: boolean;
  river: boolean;
  mana: number;
}

/**
 * `op`'s fields for the engine: terrain, fertility, lakeside and river from its own cells
 * (`ownLand`, `TERRAIN`/`FERTILITY`, the way `provincesOf` reads the Reach's); population and mana
 * the same formulas as `reachSpec`'s provinces; culture from `op.culture` (one of `REACH_CULTURES`'
 * ids already, `worldmap/provinces.ts`'s `OuterCulture`). With `roadAnchors: 'hexes'`, the road
 * village seated at `op`'s hex (if any) takes over its name and culture, as `placeAnchors` does
 * for the Reach's own provinces; without it (or at any other province), its name comes from the
 * hex's own name (`hexName`, #1898) — generated, but never `'Hollowford'`, `'Saltmere'` or
 * `'Kestrel Gate'`, since those are never a hex's plain or qualified name.
 */
function fieldsOf(seed: number, op: OuterProvince, roadAnchors: RoadAnchors | undefined): OuterField {
  const own = ownLand(seed, op);
  const land = own.filter(c => c.biome !== 'lake' && c.biome !== 'river');
  const lakeCells = own.filter(c => c.biome === 'lake').length;
  const terrain = mostCommon(land.map(c => TERRAIN[c.biome]!)) ?? 'meadow';
  const fertility = round2(own.reduce((s, c) => s + FERTILITY[c.biome], 0) / own.length);
  const height = own.reduce((s, c) => s + c.height, 0) / own.length;

  const anchor = roadAnchors === 'hexes' ? anchorAt(op.seat) : undefined;
  return {
    id: op.id,
    name: anchor ? VILLAGES[anchor].name : hexName(seed, op.seat, 'en'),
    terrain,
    fertility,
    lakeside: lakeCells >= 3,
    river: own.some(c => c.biome === 'river'),
    neighbors: op.neighbors,
    population: Math.round(40 + fertility * land.length * 5),
    mana: round2(0.2 + 0.6 * height),
    culture: anchor ? (VILLAGES[anchor].cultures[0] as ReachCulture) : (op.culture as ReachCulture),
  };
}

/** Every outer province's fields, seated as `roadAnchors` (`opts`) says. */
function outerFields(seed: number, opts: WorldOpts): OuterField[] {
  return outerProvinces(seed).map(op => fieldsOf(seed, op, opts.roadAnchors));
}

/** The engine's `WorldSpec` over a set of already-adapted outer fields: their lordships and houses (`housesOf`), on its own `|hexworld|houses` stream. */
function specOf(seed: number, P: readonly OuterField[]): WorldSpec {
  const { titles, dynasties, characters } = housesOf(generator(seedOf(`${seed}|hexworld|houses`)), P);
  return {
    startYear: HOUSE_START_YEAR,
    provinces: P.map(p => ({
      id: p.id, name: p.name, terrain: p.terrain, fertility: p.fertility, coastal: false, river: p.river,
      neighbors: p.neighbors, population: p.population, mana: p.mana, lake: p.lakeside,
    })),
    titles,
    dynasties,
    characters,
    cultures: [...REACH_CULTURES],
    races: [...REACH_PEOPLES],
  };
}

/**
 * The starting world for the engine over the outer provinces (`outerProvinces`), the way
 * `reachSpec` builds it over the Reach's: every province a lordship, gathered under two or three
 * realms, each held by a house of its province's culture (`housesOf`).
 */
export function outerSpec(seed: number, opts: WorldOpts = {}): WorldSpec {
  return specOf(seed, outerFields(seed, opts));
}

/**
 * The outer provinces' history: a second run of the engine beside the Reach's (`runHistory`), its
 * own streams (`specOf`'s houses, and this function's own `|hexworld|history`) keeping it from
 * sharing a draw with the Reach's `|world|` streams. Written up as plain data, per province only:
 * no chronicle text, regions or organisations (out of scope for #1906).
 */
export function runOuterHistory(seed: number, years = HISTORY_YEARS, opts: WorldOpts = {}): OuterHistory {
  const P = outerFields(seed, opts);
  const world = loadWorld(specOf(seed, P), seedOf(`${seed}|hexworld|history`));
  for (let y = 0; y < years; y++) tick(world);
  const { chronicle } = sift(world, TELL_THRESHOLD);

  // Which province an event happened in: its own, or the seat of the title it's about (history.ts `runHistory`'s rule).
  const where = (ev: WorldEvent) => ev.provinceId ?? world.title(ev.titleId)?.provinceId ?? null;

  const provinces: ProvinceHistory[] = P.map(p => {
    const title = world.province(p.id)?.titleId ? world.title(world.province(p.id)!.titleId) : undefined;
    const holder = title?.holderId ? world.char(title.holderId) : undefined;
    const lines = pickLines(chronicle.filter(ev => where(ev) === p.id), world.year)
      .map(ev => ({ year: ev.year, text: renderEvent(world, ev), kind: ev.type, house: houseOf(world, ev) }));
    return {
      id: p.id,
      name: p.name,
      culture: cultureName(p.culture),
      title: title?.name ?? p.name,
      holder: holder ? fullName(world, holder.id) : null,
      house: holder ? world.dynasty(holder.dynastyId)?.name ?? null : null,
      lines,
    };
  });

  return {
    version: HISTORY_VERSION,
    seed,
    ...(opts.roadAnchors === 'hexes' ? { roadAnchors: 'hexes' as const } : {}),
    provinces,
  };
}
