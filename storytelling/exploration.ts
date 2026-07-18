// exploration.ts — Age-of-Discovery maritime voyages.
//
// A wealthy coastal port (title-holder wealth above threshold + coastal
// province + captain of appropriate level) launches an Expedition. Each year
// the fleet is at sea it rolls: still-underway, returned, lost, or wrecked.
// A successful return can:
//   • Chart new lands (NEW_LANDS_CHARTED)
//   • Establish first contact with a distant culture (FIRST_CONTACT_ESTABLISHED)
//   • Trigger a Great Exchange — commodity + species + occasional zoonotic
//     disease seed (GREAT_EXCHANGE + optional MAGICAL_PLAGUE_ERUPTS setup)
//
// In magic worlds the deep ocean is dangerous in a different way — a rare
// SEA_MONSTER_ENCOUNTERED event either wrecks the fleet outright or
// escalates its captain to hero status via emergence.
//
// Guarded on catastrophesEnabled — non-catastrophe golden hashes stay
// byte-identical (RNG-symmetric no-op when off).

import type {
  CharClass,
  Character,
  Expedition,
  ExpeditionId,
  ExpeditionPurpose,
  ProvinceId,
} from "./types.js";
import type { World } from "./world.js";

// ---- tuning constants ------------------------------------------------------
const LAUNCH_PROB_PER_PORT = 0.008;     // per eligible coastal port per year
const RETURN_PROB_PER_YEAR = 0.28;      // per year at sea
const LOST_PROB_PER_YEAR = 0.06;        // per year at sea
const WRECKED_PROB_PER_YEAR = 0.03;     // per year at sea
const MIN_CAPTAIN_LEVEL = 6;            // sub-captain level to lead a voyage
const MIN_PORT_WEALTH = 0.5;            // sponsoring dynasty's wealth threshold
const NEW_LANDS_PROB = 0.65;            // chance a returned expedition charts new lands
const FIRST_CONTACT_PROB = 0.35;        // chance to first-contact a foreign culture
const GREAT_EXCHANGE_PROB = 0.4;        // chance to trigger a Columbian-analog swap
const ZOONOTIC_ON_EXCHANGE = 0.25;      // when exchange happens, chance to seed zoonotic
const SEA_MONSTER_PROB = 0.02;          // magic-only, per active expedition per year
const MAX_ACTIVE = 4;                   // simultaneous voyages cap for chronicle brevity

// Coastal-name pools for procedural fleet/lands naming.
const FLEET_NAMES = [
  "Wave-cutter", "Longsail", "Salt-Reader", "Star-Follower", "Coastborn", "Iron-Prow",
  "Farhorizon", "Grey-Gull", "Sable-Fin", "Manta", "Deepvoice", "Windward",
];

const LAND_ADJ = [
  "Vermilion", "Hollow", "Southern", "Farside", "Sunken", "Broken", "Whispering",
  "Iron", "Salt", "Ashen", "Green", "Longtide", "Copper",
];
const LAND_NOUN = [
  "Isles", "Coast", "Cape", "Reach", "Shoal", "Archipelago", "Strand", "Sea-Marches",
];

const FOREIGN_CULTURE_NAMES = [
  "the People of the Far Waters", "the Iron-River folk", "the Green-Sky nomads",
  "the Reef-Kings", "the Silvertongue city-states", "the Cave-Weavers",
  "the Sun-Priests of the Long Coast", "the Bone-Rune traders",
];

// Captain classes eligible to lead expeditions.
const CAPTAIN_CLASSES = new Set<CharClass>(["knight", "soldier", "hunter", "warden", "scholar"]);

// ---------------------------------------------------------------------------
// Public entry — called from tick.ts after runDiseases (so this year's
// zoonotic hook line up with the disease system). Guarded to preserve
// golden hashes when catastrophes are off.
// ---------------------------------------------------------------------------
export function runExploration(w: World): void {
  if (!w.catastrophesEnabled) return;

  ageActiveExpeditions(w);
  maybeLaunchExpedition(w);
}

// ---------------------------------------------------------------------------
// Aging: each launched expedition rolls once per year.
// ---------------------------------------------------------------------------
function ageActiveExpeditions(w: World): void {
  for (const ex of [...w.expeditions.values()]) {
    if (ex.resolvedYear !== null) continue;
    ex.yearsAtSea++;

    // Magic-only: sea-monster branch. Overrides normal outcomes when it hits.
    if (w.magicEnabled && w.rng.chance(SEA_MONSTER_PROB)) {
      const survives = w.rng.chance(0.4);
      w.log("SEA_MONSTER_ENCOUNTERED", {
        provinceId: ex.launchedFromProvinceId,
        actorId: ex.captainId,
        data: {
          expeditionId: ex.id,
          expedition: ex.name,
          survived: survives,
        },
      });
      if (!survives) {
        ex.status = "lost";
        ex.resolvedYear = w.year;
        ex.lostReason = "taken by a leviathan of the deep";
        w.log("EXPEDITION_LOST", {
          provinceId: ex.launchedFromProvinceId,
          actorId: ex.captainId,
          data: { expeditionId: ex.id, expedition: ex.name, reason: ex.lostReason, yearsAtSea: ex.yearsAtSea },
        });
        continue;
      }
    }

    // Outcome roll — order matters: return first, then lost, then wrecked.
    if (w.rng.chance(RETURN_PROB_PER_YEAR)) {
      resolveReturn(w, ex);
    } else if (w.rng.chance(LOST_PROB_PER_YEAR)) {
      ex.status = "lost";
      ex.resolvedYear = w.year;
      ex.lostReason = pickLostReason(w);
      w.log("EXPEDITION_LOST", {
        provinceId: ex.launchedFromProvinceId,
        actorId: ex.captainId,
        data: { expeditionId: ex.id, expedition: ex.name, reason: ex.lostReason, yearsAtSea: ex.yearsAtSea },
      });
    } else if (w.rng.chance(WRECKED_PROB_PER_YEAR)) {
      ex.status = "wrecked";
      ex.resolvedYear = w.year;
      ex.lostReason = "wrecked on an unknown shore";
      w.log("EXPEDITION_WRECKED", {
        provinceId: ex.launchedFromProvinceId,
        actorId: ex.captainId,
        data: { expeditionId: ex.id, expedition: ex.name, yearsAtSea: ex.yearsAtSea },
      });
    }
    // Otherwise still at sea; will roll again next year.
  }
}

// ---------------------------------------------------------------------------
// Successful return — fires EXPEDITION_RETURNED then a variable set of
// downstream discovery events.
// ---------------------------------------------------------------------------
function resolveReturn(w: World, ex: Expedition): void {
  ex.status = "returned";
  ex.resolvedYear = w.year;

  w.log("EXPEDITION_RETURNED", {
    provinceId: ex.launchedFromProvinceId,
    actorId: ex.captainId,
    data: {
      expeditionId: ex.id,
      expedition: ex.name,
      yearsAtSea: ex.yearsAtSea,
      purpose: ex.purpose,
    },
  });

  // Chart new lands?
  if (w.rng.chance(NEW_LANDS_PROB)) {
    const lands = `the ${LAND_ADJ[Math.floor(w.rng.next() * LAND_ADJ.length)]} ${LAND_NOUN[Math.floor(w.rng.next() * LAND_NOUN.length)]}`;
    ex.discoveredLands.push(lands);
    w.log("NEW_LANDS_CHARTED", {
      provinceId: ex.launchedFromProvinceId,
      actorId: ex.captainId,
      data: {
        expeditionId: ex.id,
        expedition: ex.name,
        lands,
      },
    });
  }

  // First contact with a distant culture?
  if (w.rng.chance(FIRST_CONTACT_PROB)) {
    const foreign = FOREIGN_CULTURE_NAMES[Math.floor(w.rng.next() * FOREIGN_CULTURE_NAMES.length)];
    ex.contactedCulture = foreign;
    w.log("FIRST_CONTACT_ESTABLISHED", {
      provinceId: ex.launchedFromProvinceId,
      actorId: ex.captainId,
      data: {
        expeditionId: ex.id,
        expedition: ex.name,
        foreignCulture: foreign,
        peaceful: w.rng.chance(0.7),
      },
    });
  }

  // Great Exchange?
  if (w.rng.chance(GREAT_EXCHANGE_PROB)) {
    const seedsZoo = w.rng.chance(ZOONOTIC_ON_EXCHANGE);
    ex.triggeredZoonotic = seedsZoo;
    w.log("GREAT_EXCHANGE", {
      provinceId: ex.launchedFromProvinceId,
      actorId: ex.captainId,
      data: {
        expeditionId: ex.id,
        expedition: ex.name,
        broughtDisease: seedsZoo,
        broughtSpecies: w.rng.chance(0.6),
        broughtCrops: w.rng.chance(0.8),
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Launching. A coastal province with a wealthy dynasty (via title-holder) and
// an eligible captain has a small annual chance to sponsor a new voyage.
// ---------------------------------------------------------------------------
function maybeLaunchExpedition(w: World): void {
  if (w.activeExpeditions().length >= MAX_ACTIVE) return;
  if (!w.rng.chance(LAUNCH_PROB_PER_PORT)) return;

  // Pool of eligible ports — coastal, above-floor population, has a
  // title-holder from a sufficiently wealthy dynasty.
  const candidates = [...w.provinces.values()].filter((p) => p.coastal && !p.subsurface);
  if (candidates.length === 0) return;

  // Try a few random ports before giving up. Deterministic RNG shuffle.
  for (let i = 0; i < Math.min(candidates.length, 3); i++) {
    const port = candidates[Math.floor(w.rng.next() * candidates.length)];
    const captain = findCaptainAt(w, port.id);
    if (!captain) continue;
    const sponsor = findWealthySponsorAt(w, port.id);
    if (!sponsor) continue;

    launch(w, port.id, captain, sponsor);
    return;
  }
}

function launch(
  w: World,
  portId: ProvinceId,
  captain: Character,
  sponsorDynastyId: string,
): void {
  const id: ExpeditionId = w.freshId("ex");
  const fleetName = `the ${FLEET_NAMES[Math.floor(w.rng.next() * FLEET_NAMES.length)]}`;
  const purpose = pickPurpose(w);
  const ex: Expedition = {
    id,
    name: fleetName,
    purpose,
    launchedYear: w.year,
    launchedFromProvinceId: portId,
    sponsorDynastyId,
    captainId: captain.id,
    status: "launched",
    yearsAtSea: 0,
    resolvedYear: null,
    discoveredLands: [],
    contactedCulture: null,
    broughtBackSpeciesId: null,
    triggeredZoonotic: false,
    lostReason: null,
  };
  w.expeditions.set(id, ex);

  w.log("EXPEDITION_LAUNCHED", {
    provinceId: portId,
    actorId: captain.id,
    data: {
      expeditionId: id,
      expedition: fleetName,
      purpose,
      sponsorDynastyId,
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------
function findCaptainAt(w: World, portId: ProvinceId): Character | null {
  const pool: Character[] = [];
  for (const c of w.living()) {
    if (c.provinceId !== portId) continue;
    if (c.level < MIN_CAPTAIN_LEVEL) continue;
    if (!CAPTAIN_CLASSES.has(c.charClass)) continue;
    pool.push(c);
  }
  if (pool.length === 0) return null;
  return pool[Math.floor(w.rng.next() * pool.length)];
}

function findWealthySponsorAt(w: World, portId: ProvinceId): string | null {
  // The province's ruling title (if any); check that dynasty's wealth.
  for (const t of w.titles.values()) {
    if (t.holderId === null) continue;
    if (t.provinceId !== portId) continue;
    const h = w.char(t.holderId);
    if (!h) continue;
    const dyn = w.dynasty(h.dynastyId);
    if (!dyn) continue;
    if (dyn.wealth < MIN_PORT_WEALTH) continue;
    return dyn.id;
  }
  return null;
}

function pickPurpose(w: World): ExpeditionPurpose {
  const pool: ExpeditionPurpose[] = ["trade", "trade", "conquest", "religious", "scientific", "raid"];
  return pool[Math.floor(w.rng.next() * pool.length)];
}

function pickLostReason(w: World): string {
  const reasons = [
    "swallowed by a wintering storm",
    "lost beyond the maps",
    "scattered by a maelstrom",
    "provisions failed on the far crossing",
    "the last sight was a burning ship on the horizon",
  ];
  return reasons[Math.floor(w.rng.next() * reasons.length)];
}
