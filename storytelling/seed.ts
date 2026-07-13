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
import type { Drives } from "./types.js";
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
      zoneFlags: [],
      subsurface: p.subsurface ?? false,
      mineralWealth: p.mineralWealth ?? 0,
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
  for (const c of spec.cultures ?? []) w.cultures.set(c.id, c);
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

  return w;
}

function toDrives(a: number[]): Drives {
  return { ambition: a[0], greed: a[1], vengeance: a[2], piety: a[3], lust: a[4], fear: a[5] };
}
