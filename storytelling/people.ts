// people.ts — factory helpers for creating characters and dynasties.
//
// Shared by seed.ts (the initial cast), tick.ts (newborns), and marriage
// (foreign spouses married in from minor houses). Centralised so the default
// shape of a character — neutral opinions, empty claim/grudge lists, a drive
// vector — is defined exactly once.

import type { RNG } from "./rng.js";
import { givenName } from "./names.js";
import type { Character, Drives, Dynasty, ProvinceId, Sex } from "./types.js";
import type { World } from "./world.js";

// A random personality. Drives are independent uniforms; correlations (a
// pious character being less ambitious, say) are left to emerge rather than
// hand-tuned — the prototype is about whether structure alone reads as story.
export function randomDrives(rng: RNG): Drives {
  return {
    ambition: rng.float(0.1, 0.95),
    greed: rng.float(0.1, 0.9),
    vengeance: rng.float(0.05, 0.9),
    piety: rng.float(0.1, 0.9),
    lust: rng.float(0.2, 0.9),
    fear: rng.float(0.05, 0.8),
  };
}

// Children resemble their parents: average the two drive vectors and add a
// little noise. This makes dynasties have *temperaments* — a line of schemers,
// a line of pious caretakers — which is half of why successions feel inherited.
export function inheritDrives(rng: RNG, a: Drives, b: Drives): Drives {
  const mix = (x: number, y: number) =>
    Math.max(0, Math.min(1, (x + y) / 2 + rng.float(-0.15, 0.15)));
  return {
    ambition: mix(a.ambition, b.ambition),
    greed: mix(a.greed, b.greed),
    vengeance: mix(a.vengeance, b.vengeance),
    piety: mix(a.piety, b.piety),
    lust: mix(a.lust, b.lust),
    fear: mix(a.fear, b.fear),
  };
}

export interface NewCharacterOpts {
  name?: string;
  sex: Sex;
  dynastyId: string;
  birthYear: number;
  provinceId: ProvinceId;
  drives?: Drives;
  fatherId?: string | null;
  motherId?: string | null;
  lowborn?: boolean;
}

export function createCharacter(w: World, opts: NewCharacterOpts): Character {
  const id = w.freshId("c");
  const c: Character = {
    id,
    name: opts.name ?? givenName(w.rng, opts.sex),
    sex: opts.sex,
    dynastyId: opts.dynastyId,
    birthYear: opts.birthYear,
    deathYear: null,
    alive: true,
    causeOfDeath: null,
    fatherId: opts.fatherId ?? null,
    motherId: opts.motherId ?? null,
    spouseId: null,
    childrenIds: [],
    provinceId: opts.provinceId,
    drives: opts.drives ?? randomDrives(w.rng),
    claims: [],
    grudges: [],
    opinion: {},
    reputation: { schemer: 0, just: w.rng.float(0.2, 0.6) },
    lowborn: opts.lowborn ?? false,
    // Magic/leveling defaults — everyone starts ordinary. The magic layer
    // (magic.ts) assigns classes at adulthood and grows levels over a life.
    level: 1,
    lifeXp: 0,
    charClass: "commoner",
    comfort: 0,
    ventured: false,
  };
  w.characters.set(id, c);
  // Wire the child into its parents' child lists so the family graph is whole.
  const father = w.char(opts.fatherId ?? null);
  if (father) father.childrenIds.push(id);
  const mother = w.char(opts.motherId ?? null);
  if (mother) mother.childrenIds.push(id);
  return c;
}

export function createDynasty(w: World, name: string, founderId: string): Dynasty {
  const id = w.freshId("d");
  const dyn: Dynasty = {
    id,
    name,
    founderId,
    extinctYear: null,
    wealth: 0,
    rite: null,
    riteBearerId: null,
  };
  w.dynasties.set(id, dyn);
  return dyn;
}
