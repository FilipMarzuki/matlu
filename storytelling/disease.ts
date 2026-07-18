// disease.ts — persistent named disease strains, mundane and magical.
//
// The existing runPlague fires one-shot PLAGUE calamities. This module adds
// a longer arc: a named strain (Black Death, the Ninefold Rot, the Ashen
// Cough) emerges, strikes, spreads via trade routes, mutates, and eventually
// burns out as populations build cross-immunity. Magical strains only appear
// in magic-enabled worlds and behave differently:
//   - mana_fever: fires only in high-mana provinces; hallucinations, spikes
//     madness onset
//   - rot_plague: kills, then RAISES the dead — feeds the undead-raid layer
//   - unraveling: survivors lose scattered fragments of memory / language
//   - choking_mist: only spawned by wrathful deities; targets that god's
//     out-of-pact churches
//
// Cross-immunity operates per family: a culture that survived one bubonic
// outbreak has half-lethality resistance to any other bubonic strain. This
// is why the same family fades over centuries.
//
// Runs after runTradeRoutes so this year's flourishing routes are visible
// as propagation vectors. Does NOT touch RNG unless catastrophes are on
// (RNG symmetry — non-catastrophe golden hashes must stay identical).

import { killResidentsByChance } from "./phenomena.js";
import type {
  Character,
  Disease,
  DiseaseFamily,
  DiseaseId,
  ProvinceId,
} from "./types.js";
import type { World } from "./world.js";

// ---- tuning constants ------------------------------------------------------
const NEW_STRAIN_PROB = 0.006;           // ~1 new named strain every ~170y
const STRIKE_PROB_BASE = 0.025;          // per active-strain per year
const MUTATION_PROB = 0.008;             // per active-strain per year
const TRADE_JUMP_PROB = 0.15;            // per strike, chance to jump a route
const BURN_OUT_STRIKES = 8;              // strikes past this → burn out (any immunity)
const MAGIC_STRAIN_ODDS = 0.35;          // fraction of new strains that are magical (magic only)
const MANA_FEVER_MIN_DENSITY = 0.5;      // mana_fever needs this manaDensity

const MUNDANE_FAMILIES: DiseaseFamily[] = ["bubonic", "hemorrhagic", "respiratory", "pox"];
const MAGICAL_FAMILIES: DiseaseFamily[] = ["mana_fever", "rot_plague", "unraveling", "choking_mist"];

const NAME_PREFIXES = [
  "Ashen", "Crimson", "Iron", "Whispering", "Nine-fold", "Salt", "Hollow", "Grey",
  "Long", "Copper", "Black", "Silver", "Bone", "Rust", "Pale", "Ember",
];
const NAME_SUFFIXES = [
  "Cough", "Fever", "Rot", "Fire", "Shakes", "Chill", "Plague", "Pox",
  "Bloom", "Blister", "Wasting", "Sighing-Death", "Sleep", "Frenzy",
];

// Called from tick.ts, once per year, after runTradeRoutes / runClimate so
// this year's contagion carriers are visible.
export function runDiseases(w: World): void {
  if (!w.catastrophesEnabled) return;   // RNG symmetry — no-op when off
  maybeEmergeStrain(w);
  ageActiveStrains(w);
  maybeBurnOut(w);
}

// ---------------------------------------------------------------------------
// Emergence. New strains arise more often when the world is dense (population
// pressure) and when trade is thick (contact surface).
// ---------------------------------------------------------------------------
function maybeEmergeStrain(w: World): void {
  // Slightly cap active strains so the chronicle stays readable.
  if (w.activeDiseases().length >= 6) return;
  if (!w.rng.chance(NEW_STRAIN_PROB)) return;

  // Roll magical vs mundane (magical requires magicEnabled).
  const goMagical = w.magicEnabled && w.rng.chance(MAGIC_STRAIN_ODDS);
  const family = goMagical
    ? MAGICAL_FAMILIES[Math.floor(w.rng.next() * MAGICAL_FAMILIES.length)]
    : MUNDANE_FAMILIES[Math.floor(w.rng.next() * MUNDANE_FAMILIES.length)];

  // Origin province — mana_fever needs high-mana; rot_plague prefers blighted;
  // most mundane strains prefer populous.
  const candidates = [...w.provinces.values()].filter((p) => !p.subsurface);
  if (candidates.length === 0) return;
  let origin = candidates.reduce((a, b) => (b.population > a.population ? b : a));
  if (family === "mana_fever") {
    const hot = candidates.filter((p) => p.manaDensity >= MANA_FEVER_MIN_DENSITY);
    if (hot.length === 0) return;   // no hot province; skip
    origin = hot[Math.floor(w.rng.next() * hot.length)];
  } else if (family === "rot_plague") {
    const rotten = candidates.filter((p) => p.blightLevel > 0.3);
    if (rotten.length === 0) return;
    origin = rotten[Math.floor(w.rng.next() * rotten.length)];
  } else if (family === "choking_mist") {
    // Choking mist requires a wrathful deity — otherwise it doesn't spawn.
    const wrathful = w.livingDeities().find((d) => d.mood === "wrathful");
    if (!wrathful || !wrathful.homeProvinceId) return;
    const home = w.province(wrathful.homeProvinceId);
    if (!home) return;
    origin = home;
  }

  const id: DiseaseId = w.freshId("dz");
  const disease: Disease = {
    id,
    name: procedurallyName(w),
    category: goMagical ? "magical" : "mundane",
    family,
    lethality: baseLethalityFor(family, w),
    emergedYear: w.year,
    originProvinceId: origin.id,
    parentStrainId: null,
    burnedOutYear: null,
    strikeCount: 0,
    immunisedCultures: [],
    totalDeaths: 0,
  };
  w.diseases.set(id, disease);

  strike(w, disease);
  w.log("DISEASE_EMERGES", {
    provinceId: origin.id,
    data: {
      diseaseId: id,
      disease: disease.name,
      category: disease.category,
      family: disease.family,
      origin: origin.name,
    },
  });
  if (disease.category === "magical") {
    w.log("MAGICAL_PLAGUE_ERUPTS", {
      provinceId: origin.id,
      data: {
        diseaseId: id,
        disease: disease.name,
        family: disease.family,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Active strains age each year: return chance, mutation chance, trade jump.
// ---------------------------------------------------------------------------
function ageActiveStrains(w: World): void {
  for (const d of [...w.diseases.values()]) {
    if (d.burnedOutYear !== null) continue;

    // Return strike — an existing strain re-emerges somewhere.
    let strikeProb = STRIKE_PROB_BASE;
    // Magical strains strike less often but hit harder each time.
    if (d.category === "magical") strikeProb *= 0.5;
    // Warm climate accelerates most strains; cold dampens (rot_plague inverted).
    if (w.climate.phase === "warm") strikeProb *= 1 + w.climate.severity * 0.5;
    if (w.climate.phase === "cold" && d.family !== "rot_plague") strikeProb *= 1 - w.climate.severity * 0.3;

    if (w.rng.chance(strikeProb)) {
      strike(w, d);
      w.log("DISEASE_RETURNS", {
        provinceId: d.originProvinceId,
        data: {
          diseaseId: d.id,
          disease: d.name,
          strike: d.strikeCount,
        },
      });
      // Post-strike, chance to jump onto a lingua-franca-connected route.
      if (w.rng.chance(TRADE_JUMP_PROB)) {
        const active = [...w.activeTradeRoutes()].filter((r) => r.wealth > 0.4);
        if (active.length > 0) {
          const r = active[Math.floor(w.rng.next() * active.length)];
          w.log("DISEASE_JUMPS_ROUTE", {
            provinceId: r.toProvinceId,
            data: {
              diseaseId: d.id,
              disease: d.name,
              fromProvinceId: r.fromProvinceId,
              toProvinceId: r.toProvinceId,
              conduit: r.conduit,
            },
          });
        }
      }
    }

    // Mutation — spawn a related strain with different lethality.
    if (w.rng.chance(MUTATION_PROB) && w.activeDiseases().length < 6) {
      const child: Disease = {
        id: w.freshId("dz"),
        name: mutantName(w, d),
        category: d.category,
        family: d.family,
        lethality: Math.max(0.05, Math.min(0.95, d.lethality + w.rng.float(-0.15, 0.15))),
        emergedYear: w.year,
        originProvinceId: d.originProvinceId,
        parentStrainId: d.id,
        burnedOutYear: null,
        strikeCount: 0,
        immunisedCultures: [],
        totalDeaths: 0,
      };
      w.diseases.set(child.id, child);
      w.log("DISEASE_MUTATES", {
        provinceId: child.originProvinceId,
        data: {
          parentDiseaseId: d.id,
          parentDisease: d.name,
          childDiseaseId: child.id,
          childDisease: child.name,
          childLethality: Math.round(child.lethality * 100) / 100,
        },
      });
    }
  }
}

// A strike hits some province, kills, and updates immunity.
function strike(w: World, d: Disease): void {
  const candidates = [...w.provinces.values()].filter((p) => !p.subsurface);
  if (candidates.length === 0) return;
  const target = d.originProvinceId
    ? (w.province(d.originProvinceId) ?? candidates[Math.floor(w.rng.next() * candidates.length)])
    : candidates[Math.floor(w.rng.next() * candidates.length)];

  // Resolve lethality with cross-immunity from same-family exposure.
  const holderCulture = getHolderCulture(w, target.id);
  let effective = d.lethality;
  if (holderCulture && d.immunisedCultures.includes(holderCulture)) {
    effective *= 0.35;
  } else {
    for (const sibling of w.strainsInFamily(d.family)) {
      if (sibling.id === d.id) continue;
      if (holderCulture && sibling.immunisedCultures.includes(holderCulture)) {
        effective *= 0.6;
        break;
      }
    }
  }

  const loss = Math.round(target.population * effective);
  target.population = Math.max(50, target.population - loss);
  d.totalDeaths += loss;
  killResidentsByChance(w, target.id, "plague", effective * 0.6);
  d.strikeCount++;

  // After a big strike, the holder culture accumulates immunity.
  if (holderCulture && loss >= 500 && !d.immunisedCultures.includes(holderCulture)) {
    d.immunisedCultures.push(holderCulture);
  }

  // Magical side-effects.
  if (d.family === "mana_fever") {
    // Fever spikes distortion onset — nudge psyche.
    for (const c of w.living()) {
      if (c.provinceId !== target.id) continue;
      if (c.psyche.distortion !== "none") continue;
      if (w.rng.chance(0.02)) {
        c.psyche.distortion = "paranoid";
        c.psyche.distortionOnsetYear = w.year;
      }
    }
  } else if (d.family === "rot_plague") {
    // Rot plague pushes the province toward becoming a dead zone.
    target.blightLevel = Math.min(1, target.blightLevel + 0.1);
  } else if (d.family === "unraveling") {
    // Erode the written corpus of the local language (memory loss).
    const lang = holderCulture ? w.languageOfCulture(holderCulture) : undefined;
    if (lang) lang.writtenCorpus = Math.max(0, lang.writtenCorpus - 0.05);
  }
}

// ---------------------------------------------------------------------------
// Burn-out — a strain that has struck enough times AND has immunised its main
// carrier cultures goes dormant.
// ---------------------------------------------------------------------------
function maybeBurnOut(w: World): void {
  for (const d of w.activeDiseases()) {
    if (d.strikeCount < BURN_OUT_STRIKES) continue;
    // Any immunity accelerates burn-out; without it the strain lingers longer.
    if (d.immunisedCultures.length === 0 && d.strikeCount < BURN_OUT_STRIKES * 2) continue;
    d.burnedOutYear = w.year;
    w.log("DISEASE_BURNS_OUT", {
      data: {
        diseaseId: d.id,
        disease: d.name,
        agedYears: w.year - d.emergedYear,
        strikes: d.strikeCount,
        totalDeaths: d.totalDeaths,
        immunisedCultures: d.immunisedCultures.length,
      },
    });
  }
}

// ---- helpers ---------------------------------------------------------------
function baseLethalityFor(family: DiseaseFamily, w: World): number {
  switch (family) {
    case "hemorrhagic":  return 0.35 + w.rng.float(0, 0.15);
    case "pox":          return 0.25 + w.rng.float(0, 0.15);
    case "bubonic":      return 0.20 + w.rng.float(0, 0.15);
    case "respiratory":  return 0.08 + w.rng.float(0, 0.10);
    case "mana_fever":   return 0.15 + w.rng.float(0, 0.10);
    case "rot_plague":   return 0.30 + w.rng.float(0, 0.20);
    case "unraveling":   return 0.12 + w.rng.float(0, 0.10);
    case "choking_mist": return 0.40 + w.rng.float(0, 0.20);
  }
}

function procedurallyName(w: World): string {
  const pfx = NAME_PREFIXES[Math.floor(w.rng.next() * NAME_PREFIXES.length)];
  const sfx = NAME_SUFFIXES[Math.floor(w.rng.next() * NAME_SUFFIXES.length)];
  return `the ${pfx} ${sfx}`;
}

function mutantName(w: World, parent: Disease): string {
  const roman = ["II", "III", "IV", "V", "VI"];
  const kids = [...w.diseases.values()].filter((d) => d.parentStrainId === parent.id).length;
  if (kids < roman.length) return `${parent.name} ${roman[kids]}`;
  // Fallback if exhausted.
  return `${parent.name}'s child`;
}

function getHolderCulture(w: World, provinceId: ProvinceId): string | null {
  const holder = [...w.titles.values()].find((t) => t.provinceId === provinceId);
  const c: Character | undefined = w.char(holder?.holderId ?? null);
  if (!c) return null;
  return w.dynasty(c.dynastyId)?.cultureId ?? null;
}
