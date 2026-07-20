// seed.ts — turn a WorldSpec (pure data) into a live World.
//
// The starting tableau used to be hand-built here in code. It now lives as data
// in world-spec.ts (DEFAULT_SPEC); this file is just the loader. That split is
// what lets us feed real geography/cultures/dynasties later — an Azgaar map, the
// macro-world cultures, lore-seeded houses — each as a different WorldSpec,
// without touching engine code.
//
// Determinism note: createCharacter draws one rng value per call (reputation),
// so characters MUST be created in spec order — the same order the original
// seed used — to keep the RNG stream (and thus every chronicle) identical.

import { addClaim } from "./inheritance.js";
import { createCharacter, createDynasty } from "./people.js";
import type { ClassStructure, Drives } from "./types.js";
import { World } from "./world.js";
import { DEFAULT_SPEC, type WorldSpec } from "./world-spec.js";

export const START_YEAR = DEFAULT_SPEC.startYear;

// The default convenience used by main.ts and the tests.
export function buildWorld(seed: number): World {
  return loadWorld(DEFAULT_SPEC, seed);
}

export function loadWorld(spec: WorldSpec, seed: number): World {
  const w = new World(seed);
  w.year = spec.startYear;

  // --- Provinces --------------------------------------------------------
  for (const p of spec.provinces) {
    w.provinces.set(p.id, {
      id: p.id,
      name: p.name,
      terrain: p.terrain,
      fertility: p.fertility,
      coastal: p.coastal,
      riverConnected: p.river,
      neighbors: [...p.neighbors], // order matters: plague spread iterates it
      population: p.population,
      titleId: "", // set by the title pass
      manaDensity: p.mana,
      blightLevel: 0,
      zoneFlags: [...(p.zoneFlags ?? [])],
      subsurface: p.subsurface ?? false,
      mineralWealth: p.mineralWealth ?? 0,
      // classStructure is filled in a second pass below, after cultures are
      // in place (culture is needed to pick between urban_patriciate and
      // agrarian_serfs when the terrain alone is ambiguous).
      classStructure: "mixed",
      burgherStrength: 0,
    });
  }

  // --- Titles -----------------------------------------------------------
  for (const t of spec.titles) {
    w.titles.set(t.id, {
      id: t.id,
      name: t.name,
      tier: t.tier,
      law: t.law,
      holderId: null,
      provinceId: t.seat,
      liegeId: t.liege,
    });
    const prov = w.province(t.seat);
    if (prov) prov.titleId = t.id;
  }

  // --- Peoples layer (optional) — cultures/races/faiths as data ---------
  for (const c of spec.cultures ?? []) {
    w.cultures.set(c.id, c);
    // Seed the live state with any traits the spec declares at founding.
    if (c.startingTraits?.length) {
      const state = w.cultureState(c.id);
      for (const t of c.startingTraits) {
        state.eliteTraits.add(t);
        state.folkTraits.add(t);
      }
    }
  }
  for (const r of spec.races ?? []) w.races.set(r.id, r);
  for (const fa of spec.faiths ?? []) w.faiths.set(fa.id, fa);

  // --- Dynasties (founderId wired in the character pass) -----------------
  const dynId = new Map<string, string>(); // spec label -> real id
  for (const dy of spec.dynasties) {
    dynId.set(
      dy.id,
      createDynasty(w, dy.name, "", { culture: dy.culture, race: dy.race, faith: dy.faith }).id,
    );
  }

  // --- Characters -------------------------------------------------------
  // Created in spec order (parents always precede their children, so father/
  // mother references resolve). This order also fixes the RNG stream.
  const charId = new Map<string, string>(); // spec label -> real id
  for (const c of spec.characters) {
    const real = createCharacter(w, {
      name: c.name,
      sex: c.sex,
      dynastyId: dynId.get(c.dynasty)!,
      birthYear: c.birthYear,
      provinceId: c.province,
      drives: toDrives(c.drives),
      fatherId: c.father ? charId.get(c.father)! : null,
      motherId: c.mother ? charId.get(c.mother)! : null,
    });
    charId.set(c.id, real.id);
  }

  // --- Wire founders, marriages, holdings, claims (all entities now exist) -
  for (const c of spec.characters) {
    const self = w.char(charId.get(c.id)!)!;
    if (c.founds) {
      const dy = w.dynasty(dynId.get(c.founds)!);
      if (dy) dy.founderId = self.id;
    }
    if (c.spouse) self.spouseId = charId.get(c.spouse)!;
    if (c.holds) {
      const t = w.title(c.holds);
      if (t) t.holderId = self.id;
    }
    for (const cl of c.claims) {
      addClaim(self, { titleId: cl.title, strength: cl.strength, basis: cl.basis, year: cl.year });
    }
  }

  // --- Class stratification pass (deterministic — no RNG) ----------------
  // Now that titles + holders are in place, pick each province's class shape
  // from terrain + population + culture. This is one static pass at world
  // load; class-events.ts mutates it over the run.
  for (const p of w.provinces.values()) {
    p.classStructure = pickClassStructure(w, p.id);
    p.burgherStrength = pickBurgherStrength(p.classStructure);
  }

  return w;
}

// Deterministic class-structure picker. Reads terrain/population/culture only;
// consumes no RNG. New provinces added later (mid-run) can call this to keep
// the class layer consistent.
function pickClassStructure(w: World, provinceId: string): ClassStructure {
  const p = w.province(provinceId);
  if (!p) return "mixed";
  if (p.subsurface) return "agrarian_serfs"; // dwarf mine-labour
  const terrain = p.terrain;
  const port = p.zoneFlags.includes("port");
  if (terrain === "steppe" || terrain === "desert") return "pastoral_bands";
  if (terrain === "coast" && port) return "urban_patriciate";
  if (terrain === "coast") return "mixed";
  if (terrain === "plains" || terrain === "meadow") {
    return p.population > 500 ? "agrarian_serfs" : "free_yeomen";
  }
  if (terrain === "hills" || terrain === "mountain") return "free_yeomen";
  if (terrain === "forest" || terrain === "jungle") return "free_yeomen";
  if (terrain === "swamp") return "mixed";
  return "mixed";
}

function pickBurgherStrength(cs: ClassStructure): number {
  switch (cs) {
    case "urban_patriciate": return 0.5;
    case "mixed":            return 0.25;
    case "free_yeomen":      return 0.10;
    case "agrarian_serfs":   return 0.05;
    case "pastoral_bands":   return 0.05;
  }
}

function toDrives(a: number[]): Drives {
  return { ambition: a[0], greed: a[1], vengeance: a[2], piety: a[3], lust: a[4], fear: a[5] };
}
