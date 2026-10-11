// odd-patches.ts — odd patches of humans and strangely growing settlements (#1633).
//
// Owner canon: humans are native to Mistheim. Nobody in the world knows more
// than that, but they know the pattern: "throughout history there have been odd
// patches of extra humans in unexpected places. And sometimes human settlements
// have grown in strange ways." The engine SHOWS this and never EXPLAINS it:
//
//   • ODD_PATCH — a rare year, a group of humans nobody has seen before turns up
//     somewhere nobody expected them: a shore, a wood, a high valley. They have
//     no past (no parents, no kin, no lineage), found a new low-born house, and
//     take the culture and faith of the place they settle. The province gains
//     their number; a few of them are named people who live on in the sim.
//   • STRANGE_GROWTH — a rare year, a human settlement grows by far more than a
//     year's births allow, with no arrivals from any known place: no migrants,
//     no named newcomers, just more people than there were.
//
// Neither event, nor its telling (render.ts), names a cause. The chronicle tells
// what the neighbours said instead, and that differs by People (WORLD.md).
//
// Randomness: everything here draws from World.oddPatchRng, a stream of its own
// (world.ts), never from World.rng. A world with no human race (the default
// tableau) returns before its first draw, so it never touches the stream and
// its history is exactly as before. In a world with humans, the pass draws two
// numbers a year whatever happens (so the stream's position depends only on
// the year and on what fired before), and the main stream only feels the
// strangers once they're living in the world: their births, marriages and
// deaths are rolled by the main sim like anyone else's, a year on.
//
// It runs at the very end of tick(), after the regional level, so this year's
// rolls everywhere else are exactly as they were.

import { commonSurname } from "./names.js";
import { carryingCapacity } from "./geography.js";
import { createCharacter, createDynasty } from "./people.js";
import type { Character, Province, ProvinceId, WorldEvent } from "./types.js";
import type { World } from "./world.js";
import type { RaceSpec } from "./world-spec.js";

/**
 * A world's yearly chance of an odd patch. Plague's is 0.03 (phenomena.ts), so
 * a patch is about a third as common: one or two in a 150-200 year history.
 */
export const ODD_PATCH_CHANCE = 0.01;
/** A world's yearly chance that one of its human settlements grows strangely. A little commoner than a patch. */
export const STRANGE_GROWTH_CHANCE = 0.012;

/** A patch is a few dozen people (abstract population), this many at least and at most. */
const PATCH_SOULS = [20, 60] as const;
/** Of whom 2 to 4 are named people the chronicle can follow. */
const PATCH_NAMED = [2, 4] as const;
/** A strange growth adds 8% to 20% of the settlement's people in one year (regrowth is at most 3%). */
const GROWTH_SHARE = [0.08, 0.2] as const;
/** A settlement big enough to be noticed growing: a hamlet of a few dozen isn't one. */
const GROWTH_MIN_PEOPLE = 120;
/** It needs room to grow (under 110% of what the land feeds), and never takes it past 125%. */
const GROWTH_ROOM = 1.1;
const GROWTH_CAP = 1.25;

/**
 * Is this race human? A spec says so with `human: true` (or false); left out,
 * only a race whose id is "human" is. So the frontier world's "human" counts,
 * and a world whose human Peoples have their own names (the Reach's Riksfolk
 * and Strandfolk) opts them in with the flag.
 */
export function isHumanRace(race: RaceSpec | undefined): boolean {
  if (!race) return false;
  return race.human ?? race.id.toLowerCase() === "human";
}

/** The world's human races, by id, in the spec's order. Empty means the pass never runs. */
export function humanRaceIds(w: World): string[] {
  return [...w.races.values()].filter(isHumanRace).map((r) => r.id);
}

function isHuman(w: World, c: Character): boolean {
  return isHumanRace(w.races.get(w.raceIdOf(c)));
}

/** The race of whoever holds the province's title ("" if nobody does, or the world has no peoples). */
function holderRace(w: World, p: Province): string {
  const holder = w.char(w.title(p.titleId)?.holderId ?? null);
  return holder ? w.raceIdOf(holder) : "";
}

/** Humans live here: its lord is human, or someone named and human lives here. */
export function hasHumans(w: World, p: Province): boolean {
  if (isHumanRace(w.races.get(holderRace(w, p)))) return true;
  for (const c of w.characters.values()) if (c.alive && c.provinceId === p.id && isHuman(w, c)) return true;
  return false;
}

/**
 * Whose story gets told: the People of the place, if they're not human; if
 * they are, the neighbours' (the most populous non-human neighbour, the first
 * listed on a tie), since humans have no story for themselves; else the
 * place's own humans. RNG-free.
 */
function tellerOf(w: World, p: Province): string {
  const own = holderRace(w, p);
  if (own && !isHumanRace(w.races.get(own))) return own;
  let best: Province | null = null;
  for (const id of p.neighbors) {
    const n = w.province(id);
    if (!n) continue;
    const r = holderRace(w, n);
    if (!r || isHumanRace(w.races.get(r))) continue;
    if (!best || n.population > best.population) best = n;
  }
  return best ? holderRace(w, best) : own;
}

/** Where strangers are found, for the telling: a shore, a wood, a high valley... Stored on the event. */
function settingOf(p: Province): string {
  if (p.coastal || p.lake) return "shore";
  switch (p.terrain) {
    case "forest": case "jungle": return "woods";
    case "hills": case "mountain": return "valley";
    case "swamp": return "marsh";
    case "steppe": case "desert": return "open";
    default: return "fields";
  }
}

/** A place strangers can be found: on the surface, and not a dead land. */
function canHold(p: Province): boolean {
  return !p.subsurface && !p.zoneFlags.includes("dead_zone");
}

// ---------------------------------------------------------------------------
// The yearly pass
// ---------------------------------------------------------------------------

/**
 * One year's odd patches and strange growths (called from tick.ts, last). Two
 * rolls a year from the odd-patches stream, whatever they come to:
 *  1. an odd patch, somewhere weighted toward the unexpected: a place with no
 *     humans in it (×4), none next door either (×2 more), a shore (×1.5), a
 *     remote place with one or two neighbours (×1.5);
 *  2. a strange growth, in one of the world's human settlements with room to grow.
 */
export function runOddPatches(w: World): void {
  const humans = humanRaceIds(w);
  if (humans.length === 0) return; // no humans: no draws, no change, ever
  const rng = w.oddPatchRng;
  const patchRoll = rng.next();
  const growthRoll = rng.next();

  if (patchRoll < ODD_PATCH_CHANCE) {
    const sites = [...w.provinces.values()].filter(canHold);
    if (sites.length) {
      const weights = sites.map((p) => {
        let wt = 1;
        if (!hasHumans(w, p)) {
          wt *= 4;
          const nextDoor = p.neighbors.some((id) => { const n = w.province(id); return !!n && hasHumans(w, n); });
          if (!nextDoor) wt *= 2;
        }
        if (p.coastal || p.lake) wt *= 1.5;
        if (p.neighbors.length <= 2) wt *= 1.5;
        return wt;
      });
      spawnOddPatch(w, rng.weighted(sites, weights).id);
    }
  }

  if (growthRoll < STRANGE_GROWTH_CHANCE) {
    const towns = [...w.provinces.values()].filter((p) => canGrow(w, p));
    if (towns.length) strangeGrowth(w, rng.pick(towns).id);
  }
}

/**
 * Plant an odd patch of humans in a province: a new low-born house of a human
 * People, with the culture and faith of whoever holds the place, a few named
 * people with no parents, and a few dozen souls added to its population.
 * Returns the ODD_PATCH event, or null if no human People exists or nobody
 * could be found there (underground, a dead land).
 */
export function spawnOddPatch(w: World, provinceId: ProvinceId): WorldEvent | null {
  const p = w.province(provinceId);
  const humans = humanRaceIds(w);
  if (!p || !canHold(p) || humans.length === 0) return null;
  const rng = w.oddPatchRng;
  // Read before they arrive: were there humans here already?
  const unexpected = !hasHumans(w, p);
  const teller = tellerOf(w, p);

  // Their People: the world's human People (one picked, when it has several).
  const race = humans.length === 1 ? humans[0] : rng.pick(humans);
  // Their ways: the place's. They remember none of their own.
  const locals = w.dynasty(w.char(w.title(p.titleId)?.holderId ?? null)?.dynastyId ?? "");
  const culture = locals?.cultureId ?? "";
  const faith = locals?.faithId ?? "";
  // The house the locals name them: a surname of the place no house there
  // already bears (they're kin to nobody), else a common one.
  const taken = new Set([...w.dynasties.values()].map((d) => d.name));
  const surnames = (w.cultures.get(culture)?.surnames ?? []).filter((n) => !taken.has(n));
  const houseName = surnames.length ? rng.pick(surnames) : commonSurname(rng);
  const house = createDynasty(w, houseName, "", { culture, race, faith });

  const named = rng.int(PATCH_NAMED[0], PATCH_NAMED[1]);
  const people: Character[] = [];
  for (let i = 0; i < named; i++) {
    const sex = rng.chance(0.5) ? "male" : "female";
    // The first is the one the chronicle names; all are grown, none has a past.
    const age = i === 0 ? rng.int(20, 40) : rng.int(16, 45);
    people.push(createCharacter(w, {
      sex,
      dynastyId: house.id,
      birthYear: w.year - age,
      provinceId: p.id,
      fatherId: null,
      motherId: null,
      lowborn: true,
      biasCulture: true, // they take the place's temperament with its ways
      rng,
    }));
  }
  house.founderId = people[0].id;
  // A man and a woman among them are a couple (they came together, or found
  // each other), so the house can have children here. No MARRIAGE event: they
  // were a pair before anyone thought to record it.
  const man = people.find((c) => c.sex === "male");
  const woman = people.find((c) => c.sex === "female");
  if (man && woman) { man.spouseId = woman.id; woman.spouseId = man.id; }

  const souls = rng.int(PATCH_SOULS[0], PATCH_SOULS[1]);
  p.population += souls;

  return w.log("ODD_PATCH", {
    actorId: people[0].id,
    provinceId: p.id,
    data: { house: house.name, race, culture, named, souls, unexpected, teller, setting: settingOf(p) },
  });
}

/** A human settlement on the surface, big enough to notice, with room to grow. */
function canGrow(w: World, p: Province): boolean {
  return canHold(p) && p.population >= GROWTH_MIN_PEOPLE && hasHumans(w, p) && p.population < carryingCapacity(p) * GROWTH_ROOM;
}

/**
 * Grow a human settlement strangely: 8% to 20% more people in a year, never
 * past 125% of what its land feeds (an overfull place then bleeds people and
 * goes hungry like any other, which is the engine's to tell). No named person
 * arrives and no road is said to have brought them. Returns the STRANGE_GROWTH
 * event, or null if the place isn't a human settlement with room to grow.
 */
export function strangeGrowth(w: World, provinceId: ProvinceId): WorldEvent | null {
  const p = w.province(provinceId);
  if (!p || !canGrow(w, p)) return null;
  const rng = w.oddPatchRng;
  const share = rng.float(GROWTH_SHARE[0], GROWTH_SHARE[1]);
  const room = Math.round(carryingCapacity(p) * GROWTH_CAP) - p.population;
  const gain = Math.min(room, Math.round(p.population * share));
  if (gain <= 0) return null;
  const before = p.population;
  p.population += gain;
  return w.log("STRANGE_GROWTH", {
    provinceId: p.id,
    data: { gain, share: Math.round((gain / before) * 100) / 100, teller: tellerOf(w, p) },
  });
}
