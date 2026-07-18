// wildlife.ts — persistent apex predators, megafauna and mana-beasts.
//
// A WildlifeSpecies is a named world-scoped entity with a set of provinces
// it inhabits and a population health score. It ages annually — hunters
// (level-4+ knights/soldiers/wardens) can bag notable specimens, populations
// dwindle from over-hunting, catastrophes, or spreading blight, and rare
// zoonotic jumps spawn new mundane disease strains that share their host
// province with the species' population. Extinctions are permanent (extinct
// year set) but a very rare WILDLIFE_RESURGENCE can revive an extinct arc
// (echoes the historical wisent / thylacine cases).
//
// Composes with:
//   - disease.ts (zoonotic jumps mint a new bubonic/hemorrhagic strain)
//   - catastrophe.ts (heavy blight cull can push a species toward extinction)
//   - magic.ts (mana-beast manifestation gated on manaDensity)
//
// Runs after runDiseases so this year's carrier populations are visible
// as zoonotic sources. Guarded on catastrophesEnabled — non-catastrophe
// worlds see no wildlife activity (RNG symmetry with existing hashes).

import type {
  Character,
  ProvinceId,
  SpeciesId,
  SpeciesKind,
  Terrain,
  WildlifeSpecies,
} from "./types.js";
import type { World } from "./world.js";

// ---- tuning constants ------------------------------------------------------
const SEED_PROB_PER_TERRAIN = 0.7;    // chance to seed a species for a terrain family at world init
const HUNT_PROB_PER_HUNTER = 0.006;   // per eligible hunter per year
const HUNT_HEALTH_HIT = 0.03;         // health cost per notable hunt
const THREATENED_HEALTH = 0.35;       // below this + not already logged → SPECIES_THREATENED
const EXTINCT_HEALTH = 0.05;          // below this → SPECIES_EXTINCT
const RESURGENCE_PROB = 0.00025;      // per extinct species per year (very rare)
const ZOONOTIC_JUMP_PROB = 0.001;     // per active mundane-territorial species per year
const MANA_BEAST_MIN_DENSITY = 0.55;  // mana-beast requires this province manaDensity
const MANA_BEAST_MANIFEST_PROB = 0.0015;   // per high-mana province per year
const BLIGHT_CULL_THRESHOLD = 0.6;         // provinces beyond this shed species
const NATURAL_RECOVERY = 0.008;            // per untroubled year, health regrows a bit

// ---- terrain → species table ----------------------------------------------
// One representative species-name pool per (kind, terrainAffinity) mix.
interface Archetype {
  kind: SpeciesKind;
  terrains: Terrain[];
  namePool: string[];
}

const ARCHETYPES: Archetype[] = [
  { kind: "apex", terrains: ["forest", "hills", "mountain"], namePool: ["dire-wolf", "cave-lion", "grey-stalker", "ridgeback tiger"] },
  { kind: "apex", terrains: ["steppe", "plains"], namePool: ["ash-panther", "sable-jaguar", "gale-cougar"] },
  { kind: "apex", terrains: ["jungle", "swamp"], namePool: ["mistcat", "ferrund's-tiger", "cinder-croc"] },
  { kind: "megafauna", terrains: ["plains", "meadow", "steppe"], namePool: ["horned aurochs", "great elk", "war-bison", "long-horn"] },
  { kind: "megafauna", terrains: ["forest", "hills"], namePool: ["boar-of-the-black-oaks", "crescent-antelope", "stormboar"] },
  { kind: "megafauna", terrains: ["mountain"], namePool: ["cliff-goat", "ridge-elk", "high-country auroch"] },
  { kind: "flying", terrains: ["mountain", "hills"], namePool: ["stormroc", "cloud-eagle", "peak-hawk"] },
  { kind: "flying", terrains: ["coast"], namePool: ["salt-wyrm", "cliff-shrike", "wave-shearer"] },
  { kind: "amphibious", terrains: ["coast", "swamp"], namePool: ["sea-serpent", "kelp-drake", "coilfish"] },
  { kind: "swarm", terrains: ["desert", "steppe"], namePool: ["shrike-swarm", "iron-locust", "sand-hornet"] },
  { kind: "swarm", terrains: ["swamp", "jungle"], namePool: ["fen-wasp", "black-hornet", "rot-fly"] },
];

const MANA_BEAST_NAMES = [
  "manastag", "auric-lynx", "ember-serpent", "sky-basilisk",
  "pale-drake", "moonwhale", "crystalback tortoise", "veilfox",
];

// ---------------------------------------------------------------------------
// Public entry — called from tick.ts once per year after runDiseases.
// ---------------------------------------------------------------------------
export function runWildlife(w: World): void {
  if (!w.catastrophesEnabled) return;   // RNG-symmetry — no-op when off

  // One-time seeding: on the very first tick with wildlife off, populate the
  // world with terrain-appropriate species. Runs iff the map is still empty.
  if (w.wildlife.size === 0) seedInitialSpecies(w);

  ageActiveSpecies(w);
  maybeManifestManaBeasts(w);
  maybeResurgence(w);
}

// ---------------------------------------------------------------------------
// Initial seeding — one pass, at first tick.
// For each archetype, roll SEED_PROB_PER_TERRAIN; if it hits, pick provinces
// with matching terrain and assign the species there. Runs once per world.
// ---------------------------------------------------------------------------
function seedInitialSpecies(w: World): void {
  for (const arch of ARCHETYPES) {
    if (!w.rng.chance(SEED_PROB_PER_TERRAIN)) continue;
    const eligible = [...w.provinces.values()].filter(
      (p) => !p.subsurface && arch.terrains.includes(p.terrain),
    );
    if (eligible.length === 0) continue;

    const name = arch.namePool[Math.floor(w.rng.next() * arch.namePool.length)];
    const populated: ProvinceId[] = [];
    for (const p of eligible) {
      // Not every eligible province gets a population — thin it out.
      if (w.rng.chance(0.55)) populated.push(p.id);
    }
    if (populated.length === 0) continue;

    const id: SpeciesId = w.freshId("sp");
    const species: WildlifeSpecies = {
      id,
      name,
      kind: arch.kind,
      terrainAffinity: arch.terrains,
      provinces: populated,
      populationHealth: 0.7 + w.rng.next() * 0.2,
      firstDocumentedYear: w.year,
      extinctYear: null,
      extinctReason: null,
      huntTrophyCount: 0,
      lastNotableHuntYear: null,
    };
    w.wildlife.set(id, species);

    w.log("SPECIES_DISCOVERED", {
      provinceId: populated[0],
      data: {
        speciesId: id,
        species: name,
        kind: arch.kind,
        rangeSize: populated.length,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Annual ageing: hunts, blight culls, natural recovery, threatened/extinction
// thresholds, zoonotic jumps.
// ---------------------------------------------------------------------------
function ageActiveSpecies(w: World): void {
  for (const s of [...w.wildlife.values()]) {
    if (s.extinctYear !== null) continue;

    // --- notable hunts -----------------------------------------------------
    // Level-4+ warrior/hunter classes bag a specimen per province.
    let hunts = 0;
    for (const p of s.provinces) {
      const hunters = eligibleHuntersIn(w, p);
      for (const _h of hunters) {
        if (w.rng.chance(HUNT_PROB_PER_HUNTER)) hunts++;
      }
    }
    if (hunts > 0) {
      s.huntTrophyCount += hunts;
      s.lastNotableHuntYear = w.year;
      s.populationHealth = clamp01(s.populationHealth - hunts * HUNT_HEALTH_HIT);
      // Log ONE trophy event per year per species (chronicle brevity).
      w.log("HUNT_TROPHY_TAKEN", {
        provinceId: s.provinces[0],
        data: {
          speciesId: s.id,
          species: s.name,
          hunts,
          trophyCount: s.huntTrophyCount,
        },
      });
    }

    // --- blight cull -------------------------------------------------------
    // Provinces past BLIGHT_CULL_THRESHOLD lose this species from their range.
    // Drops health toward extinction as the animal's habitat shrinks.
    const before = s.provinces.length;
    s.provinces = s.provinces.filter((pid) => {
      const p = w.province(pid);
      return p !== undefined && p.blightLevel < BLIGHT_CULL_THRESHOLD;
    });
    if (s.provinces.length < before) {
      s.populationHealth = clamp01(s.populationHealth - (before - s.provinces.length) * 0.08);
    }

    // --- natural recovery when untroubled ---------------------------------
    if (hunts === 0 && s.provinces.length === before) {
      s.populationHealth = clamp01(s.populationHealth + NATURAL_RECOVERY);
    }

    // --- threatened threshold ---------------------------------------------
    // Fires ONCE per species. Anchor province is the current holding range
    // (a species already down to zero provinces will hit extinction first).
    if (
      s.populationHealth < THREATENED_HEALTH &&
      s.populationHealth >= EXTINCT_HEALTH &&
      s.provinces.length > 0
    ) {
      const alreadyLogged = w.events.some(
        (e) => e.type === "SPECIES_THREATENED" && e.data?.speciesId === s.id,
      );
      if (!alreadyLogged) {
        w.log("SPECIES_THREATENED", {
          provinceId: s.provinces[0],
          data: {
            speciesId: s.id,
            species: s.name,
            populationHealth: Math.round(s.populationHealth * 100) / 100,
          },
        });
      }
    }

    // --- extinction --------------------------------------------------------
    if (s.populationHealth < EXTINCT_HEALTH || s.provinces.length === 0) {
      s.extinctYear = w.year;
      s.extinctReason =
        s.provinces.length === 0
          ? "habitat lost to blight"
          : s.huntTrophyCount >= 3
            ? "over-hunted"
            : "climate collapse";
      w.log("SPECIES_EXTINCT", {
        provinceId: s.provinces[0] ?? null,
        data: {
          speciesId: s.id,
          species: s.name,
          reason: s.extinctReason,
          age: w.year - s.firstDocumentedYear,
        },
      });
      continue;
    }

    // --- zoonotic jump -----------------------------------------------------
    // Mundane apex/megafauna/swarm species can seed a new disease strain when
    // health is stressed. Requires the disease system to be active (it is,
    // since we're guarded on catastrophesEnabled).
    if (
      s.kind !== "mana_beast" &&
      s.populationHealth < 0.5 &&
      s.provinces.length > 0 &&
      w.rng.chance(ZOONOTIC_JUMP_PROB)
    ) {
      const p = s.provinces[Math.floor(w.rng.next() * s.provinces.length)];
      w.log("ZOONOTIC_JUMP", {
        provinceId: p,
        data: {
          speciesId: s.id,
          species: s.name,
          hostKind: s.kind,
        },
      });
      // The disease system produces the actual strain next tick when its
      // NEW_STRAIN_PROB rolls — we don't force one here to keep zoonotic
      // rare-and-narrative rather than mechanical spawn.
    }
  }
}

// ---------------------------------------------------------------------------
// Mana-beast manifestation — magic-only, in high-manaDensity provinces.
// The province needs to be habitable and not already carrying a mana-beast.
// ---------------------------------------------------------------------------
function maybeManifestManaBeasts(w: World): void {
  if (!w.magicEnabled) return;

  for (const p of w.provinces.values()) {
    if (p.subsurface) continue;
    if (p.manaDensity < MANA_BEAST_MIN_DENSITY) continue;
    // Cap: skip if a mana-beast already present here
    if (w.speciesAt(p.id).some((s) => s.kind === "mana_beast")) continue;
    if (!w.rng.chance(MANA_BEAST_MANIFEST_PROB * p.manaDensity)) continue;

    const name = MANA_BEAST_NAMES[Math.floor(w.rng.next() * MANA_BEAST_NAMES.length)];
    const id: SpeciesId = w.freshId("sp");
    const species: WildlifeSpecies = {
      id,
      name,
      kind: "mana_beast",
      terrainAffinity: [p.terrain],
      provinces: [p.id],
      populationHealth: 0.6 + w.rng.next() * 0.2,
      firstDocumentedYear: w.year,
      extinctYear: null,
      extinctReason: null,
      huntTrophyCount: 0,
      lastNotableHuntYear: null,
    };
    w.wildlife.set(id, species);
    w.log("MANA_BEAST_MANIFESTS", {
      provinceId: p.id,
      data: {
        speciesId: id,
        species: name,
        manaDensity: Math.round(p.manaDensity * 100) / 100,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Resurgence — extinct species can return in a habitat-matched province.
// Very rare (historical: wisent, thylacine sightings, coelacanth). Health
// starts low and the range is a single province.
// ---------------------------------------------------------------------------
function maybeResurgence(w: World): void {
  const extinct = [...w.wildlife.values()].filter((s) => s.extinctYear !== null);
  for (const s of extinct) {
    if (!w.rng.chance(RESURGENCE_PROB)) continue;
    const eligible = [...w.provinces.values()].filter(
      (p) => !p.subsurface && s.terrainAffinity.includes(p.terrain) && p.blightLevel < 0.5,
    );
    if (eligible.length === 0) continue;
    const p = eligible[Math.floor(w.rng.next() * eligible.length)];
    s.extinctYear = null;
    s.extinctReason = null;
    s.provinces = [p.id];
    s.populationHealth = 0.35;
    w.log("WILDLIFE_RESURGENCE", {
      provinceId: p.id,
      data: {
        speciesId: s.id,
        species: s.name,
        centuriesGone: Math.round((w.year - s.firstDocumentedYear) / 100),
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------
function eligibleHuntersIn(w: World, pid: ProvinceId): Character[] {
  const out: Character[] = [];
  for (const c of w.living()) {
    if (c.provinceId !== pid) continue;
    if (c.level < 4) continue;
    if (c.charClass !== "knight" && c.charClass !== "soldier" && c.charClass !== "hunter" && c.charClass !== "warden") continue;
    out.push(c);
  }
  return out;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
