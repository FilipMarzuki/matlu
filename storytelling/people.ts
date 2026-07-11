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
import type { CultureSpec } from "./world-spec.js";

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
  // Sim-born characters set this so their drives pull toward their culture's
  // temperament. Authored (seed) characters leave it off — their drives stand.
  biasCulture?: boolean;
}

// Pick a given name from the character's culture pool, falling back to the
// global pool. Exactly one rng draw either way, so a world without cultures
// consumes the RNG identically to before (byte-stable determinism).
function pickName(w: World, culture: CultureSpec | undefined, sex: Sex): string {
  if (culture) {
    const pool = sex === "male" ? culture.namesMale : culture.namesFemale;
    if (pool && pool.length) return w.rng.pick(pool);
  }
  return givenName(w.rng, sex);
}

// Pull a drive vector toward a culture's target temperament (no rng — a
// deterministic blend). Weight ~0.35 means a newborn is mostly its parents but
// noticeably shaped by its people, so a culture's character persists.
function blendToCulture(d: Drives, target: number[]): Drives {
  const wgt = 0.35;
  const mix = (x: number, t: number) => Math.max(0, Math.min(1, x * (1 - wgt) + t * wgt));
  return {
    ambition: mix(d.ambition, target[0]),
    greed: mix(d.greed, target[1]),
    vengeance: mix(d.vengeance, target[2]),
    piety: mix(d.piety, target[3]),
    lust: mix(d.lust, target[4]),
    fear: mix(d.fear, target[5]),
  };
}

export function createCharacter(w: World, opts: NewCharacterOpts): Character {
  const id = w.freshId("c");
  const dyn = w.dynasties.get(opts.dynastyId);
  const culture = dyn?.cultureId ? w.cultures.get(dyn.cultureId) : undefined;
  const c: Character = {
    id,
    name: opts.name ?? pickName(w, culture, opts.sex),
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
    drives: biasDrives(opts.drives ?? randomDrives(w.rng), opts.biasCulture ? culture : undefined),
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

// Wrap a drive vector with its culture's temperament pull (no rng), or return
// it unchanged when there's no culture bias to apply.
function biasDrives(d: Drives, culture: CultureSpec | undefined): Drives {
  return culture?.driveBias ? blendToCulture(d, culture.driveBias) : d;
}

export function createDynasty(
  w: World,
  name: string,
  founderId: string,
  people?: { culture?: string; race?: string; faith?: string },
): Dynasty {
  const id = w.freshId("d");
  const dyn: Dynasty = {
    id,
    name,
    founderId,
    extinctYear: null,
    wealth: 0,
    rite: null,
    riteBearerId: null,
    cultureId: people?.culture ?? "",
    raceId: people?.race ?? "",
    faithId: people?.faith ?? "",
  };
  w.dynasties.set(id, dyn);
  return dyn;
}
