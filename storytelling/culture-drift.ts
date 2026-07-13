// culture-drift.ts — how events and dominant individuals reshape a culture
// over generations.
//
// Three pressure sources accumulate each year:
//   1. Drive averages  — living members of the culture push toward traits that
//      mirror their temperament (warlike people → warrior_culture, etc.)
//   2. This year's events — wars won, lowborn risers, famines, etc. spike
//      specific pressures immediately.
//   3. Neighbor contact — cultures absorb traits from neighbours who already
//      hold them (slow, steady contagion).
//
// Pressure decays by 7 % per year and tips at ±1.0, firing a CULTURAL_SHIFT
// event. Adopted traits can later be reversed if opposite pressure accumulates.
//
// Aesthetic drift: the highest-title holder of the culture's dynasties is the
// "dominant figure." After 20 years of unbroken rule they may develop a
// personal quirk. After a further 3 %/yr chance, that quirk spreads to the
// whole culture's aesthetic and is logged as a CULTURAL_SHIFT of trait="aesthetic".
//
// The entire function is gated on `w.cultures.size === 0` — it returns
// immediately for the default world, which defines no cultures. This ensures
// zero RNG draws and zero new events in the default world, so its golden hashes
// are unaffected.

import type { Character } from "./types.js";
import type { World } from "./world.js";

// --------------------------------------------------------------------------
// Canonical mechanical traits.
// --------------------------------------------------------------------------
const ALL_TRAITS = [
  "slavery",
  "warrior_culture",
  "caste_rigid",
  "meritocracy",
  "mercantile",
  "literacy_valued",
  "zealous_faith",
] as const;

type MechTrait = (typeof ALL_TRAITS)[number];

// Mutually exclusive pairs: adopting one removes the other.
const OPPOSED: [MechTrait, MechTrait][] = [
  ["slavery", "meritocracy"],
  ["caste_rigid", "meritocracy"],
  ["warrior_culture", "literacy_valued"],
];

// --------------------------------------------------------------------------
// Aesthetic quirk pool (personal → cultural).
// --------------------------------------------------------------------------
const QUIRK_POOL: string[] = [
  "sibilant speech",
  "clipped consonants",
  "nasal intonation",
  "drawling vowels",
  "elaborate dress",
  "austere simplicity",
  "merchant's bearing",
  "scholar's manner",
  "warrior's posture",
  "farmer's humility",
  "ornate jewellery",
  "bare-faced custom",
  "tattooed tradition",
  "braided hair custom",
  "formal greetings",
];

const PRESSURE_DECAY = 0.93;
const TRAIT_THRESHOLD = 1.0;

// --------------------------------------------------------------------------
// Human-readable cause labels for event data.
// --------------------------------------------------------------------------
const CAUSE_LABEL: Record<string, string> = {
  warrior_culture: "generations of war hardened the people",
  meritocracy: "lowborn talents rose to prominence",
  caste_rigid: "scarcity deepened social divisions",
  mercantile: "trade became the measure of all worth",
  slavery: "the powerful bound the weak in chains",
  literacy_valued: "knowledge became a weapon of the capable",
  zealous_faith: "the faithful grew fervent in their devotion",
};

// --------------------------------------------------------------------------
// Main entry point — called once per tick from tick.ts.
// --------------------------------------------------------------------------
export function advanceCultureDrift(w: World): void {
  if (w.cultures.size === 0) return;

  // Collect this year's events (added this tick — from evStart to end).
  // We read ALL events for now; the cost is O(events) per year, manageable.
  const thisYearEvents = w.events.filter((ev) => ev.year === w.year);

  for (const [cultureId] of w.cultures) {
    const state = w.cultureState(cultureId);

    // --- 1. Members of this culture (living adults) -----------------------
    const members = w.adults().filter((c) => {
      const dyn = w.dynasty(c.dynastyId);
      return dyn?.cultureId === cultureId;
    });

    if (members.length === 0) continue;

    // --- 2. Drive-based pressure -----------------------------------------
    applyDrivePressure(state, members);

    // --- 3. Event-based pressure -----------------------------------------
    applyEventPressure(state, thisYearEvents, members);

    // --- 4. Neighbour contact pressure -----------------------------------
    applyNeighborPressure(w, cultureId, state);

    // --- 5. Decay all pressures ------------------------------------------
    for (const key of Object.keys(state.traitPressure)) {
      state.traitPressure[key] *= PRESSURE_DECAY;
    }

    // --- 6. Tip traits that crossed the threshold ------------------------
    for (const trait of ALL_TRAITS) {
      const p = state.traitPressure[trait] ?? 0;
      if (p >= TRAIT_THRESHOLD && !state.traits.has(trait)) {
        adoptTrait(w, state, trait, "positive pressure");
      } else if (p <= -TRAIT_THRESHOLD && state.traits.has(trait)) {
        abandonTrait(w, state, trait, "waning pressure");
      }
    }

    // --- 7. Dominant figure tracking & quirk propagation -----------------
    advanceDominantFigure(w, cultureId, state, members);
  }
}

// --------------------------------------------------------------------------
// Pressure from the average temperament of living culture members.
// --------------------------------------------------------------------------
function applyDrivePressure(
  state: ReturnType<World["cultureState"]>,
  members: Character[],
): void {
  if (!members.length) return;
  let ambition = 0, greed = 0, vengeance = 0, piety = 0, fear = 0;
  for (const c of members) {
    ambition += c.drives.ambition;
    greed += c.drives.greed;
    vengeance += c.drives.vengeance;
    piety += c.drives.piety;
    fear += c.drives.fear;
  }
  const n = members.length;
  const avgAmbition = ambition / n;
  const avgGreed = greed / n;
  const avgVengeance = vengeance / n;
  const avgPiety = piety / n;
  const avgFear = fear / n;

  if (avgAmbition + avgVengeance > 0.65 * 2) addPressure(state, "warrior_culture", 0.08);
  if (avgGreed > 0.65) addPressure(state, "mercantile", 0.06);
  if (avgPiety > 0.65) addPressure(state, "zealous_faith", 0.07);
  if (avgFear > 0.60) addPressure(state, "caste_rigid", 0.05);
}

// --------------------------------------------------------------------------
// Pressure from noteworthy events this tick.
// --------------------------------------------------------------------------
function applyEventPressure(
  state: ReturnType<World["cultureState"]>,
  events: ReturnType<World["events"]["filter"]>,
  members: Character[],
): void {
  const memberSet = new Set(members.map((c) => c.id));

  for (const ev of events) {
    switch (ev.type) {
      case "LOWBORN_RISE":
        addPressure(state, "meritocracy", 0.20);
        addPressure(state, "caste_rigid", -0.12);
        break;

      case "FAMINE":
      case "PLAGUE":
        addPressure(state, "caste_rigid", 0.06);
        break;

      case "WAR":
        if (
          ev.data["attacker_won"] &&
          ev.actorId &&
          memberSet.has(ev.actorId)
        ) {
          addPressure(state, "warrior_culture", 0.08);
        }
        if (
          !ev.data["attacker_won"] &&
          ev.targetId &&
          memberSet.has(ev.targetId)
        ) {
          // Losing wars can fracture warrior confidence or harden it; small push
          // toward caste rigidity as survivors cling to existing hierarchy.
          addPressure(state, "caste_rigid", 0.03);
        }
        break;

      case "REFORM":
        // Legal reform toward more open succession suggests meritocratic drift.
        if (ev.actorId && memberSet.has(ev.actorId)) {
          const law = String(ev.data["new_law"] ?? "");
          if (law === "elective" || law === "meritocracy") {
            addPressure(state, "meritocracy", 0.12);
          }
        }
        break;

      default:
        break;
    }
  }
}

// --------------------------------------------------------------------------
// Contact pressure: traits held by neighbouring cultures leak in slowly.
// "Neighbour" = another culture whose dynasties share provinces adjacent to
// this culture's dynastic seats.
// --------------------------------------------------------------------------
function applyNeighborPressure(
  w: World,
  cultureId: string,
  state: ReturnType<World["cultureState"]>,
): void {
  // Build the set of provinces occupied by this culture's members.
  const ownProvinces = new Set<string>();
  for (const c of w.adults()) {
    if (w.dynasty(c.dynastyId)?.cultureId === cultureId) {
      ownProvinces.add(c.provinceId);
    }
  }
  // Collect adjacent provinces.
  const adjacentProvinces = new Set<string>();
  for (const pid of ownProvinces) {
    const prov = w.province(pid);
    if (prov) for (const n of prov.neighbors) adjacentProvinces.add(n);
  }
  // Characters in adjacent provinces whose culture is different.
  for (const c of w.adults()) {
    const dyn = w.dynasty(c.dynastyId);
    if (!dyn || dyn.cultureId === cultureId || !dyn.cultureId) continue;
    if (!adjacentProvinces.has(c.provinceId)) continue;
    const neighborState = w.cultureState(dyn.cultureId);
    for (const trait of neighborState.traits) {
      addPressure(state, trait, 0.02);
    }
  }
}

// --------------------------------------------------------------------------
// Adopt a mechanical trait, fire CULTURAL_SHIFT, remove opposed traits.
// --------------------------------------------------------------------------
function adoptTrait(
  w: World,
  state: ReturnType<World["cultureState"]>,
  trait: string,
  cause: string,
): void {
  state.traits.add(trait);
  state.traitPressure[trait] = 0;
  // Remove mutually exclusive opposites.
  for (const [a, b] of OPPOSED) {
    if (a === trait && state.traits.has(b)) {
      state.traits.delete(b);
      state.traitPressure[b] = 0;
    } else if (b === trait && state.traits.has(a)) {
      state.traits.delete(a);
      state.traitPressure[a] = 0;
    }
  }
  const spec = w.cultures.get(state.cultureId);
  w.log("CULTURAL_SHIFT", {
    data: {
      culture: spec?.name ?? state.cultureId,
      trait,
      adopted: true,
      cause: CAUSE_LABEL[trait] ?? cause,
    },
  });
}

// --------------------------------------------------------------------------
// Abandon a mechanical trait, fire CULTURAL_SHIFT.
// --------------------------------------------------------------------------
function abandonTrait(
  w: World,
  state: ReturnType<World["cultureState"]>,
  trait: string,
  cause: string,
): void {
  state.traits.delete(trait);
  state.traitPressure[trait] = 0;
  const spec = w.cultures.get(state.cultureId);
  w.log("CULTURAL_SHIFT", {
    data: {
      culture: spec?.name ?? state.cultureId,
      trait,
      adopted: false,
      cause: CAUSE_LABEL[trait] ?? cause,
    },
  });
}

// --------------------------------------------------------------------------
// Dominant figure logic: track the highest-tier title holder of this culture.
// After 20yr tenure assign them a quirk; at 3%/yr that quirk spreads to the
// whole culture's aesthetic.
// --------------------------------------------------------------------------
function advanceDominantFigure(
  w: World,
  cultureId: string,
  state: ReturnType<World["cultureState"]>,
  members: Character[],
): void {
  // Find the highest-tier title held by a culture member.
  let bestTier = 0;
  let dominant: Character | null = null;
  for (const c of members) {
    for (const t of w.titlesHeldBy(c.id)) {
      const tier = t.tier === "kingdom" ? 3 : t.tier === "duchy" ? 2 : 1;
      if (tier > bestTier) { bestTier = tier; dominant = c; }
    }
  }
  if (!dominant) return;

  // Reset or continue tracking continuity.
  if (state.establishedFigureId !== dominant.id) {
    state.establishedFigureId = dominant.id;
    state.establishedSince = w.year;
  }

  const tenure = w.year - state.establishedSince;

  // After 20 years, assign a quirk if they don't have one yet.
  if (tenure >= 20 && !dominant.quirk && !state.figureQuirks[dominant.id]) {
    const quirk = w.rng.pick(QUIRK_POOL);
    dominant.quirk = quirk;
    state.figureQuirks[dominant.id] = quirk;
  }

  // 3 %/yr: the quirk spreads to the culture's linguistic/aesthetic layer.
  const quirk = state.figureQuirks[dominant.id] ?? dominant.quirk;
  if (quirk && !state.aesthetic.linguisticShift && w.rng.chance(0.03)) {
    state.aesthetic.linguisticShift = quirk;
    const spec = w.cultures.get(cultureId);
    w.log("CULTURAL_SHIFT", {
      actorId: dominant.id,
      data: {
        culture: spec?.name ?? cultureId,
        trait: "aesthetic",
        adopted: true,
        cause: `${dominant.name}'s ${quirk} spread through the generation`,
        aesthetic_value: quirk,
      },
    });
  }
}

// --------------------------------------------------------------------------
// Utility: clamp and accumulate a pressure delta.
// --------------------------------------------------------------------------
function addPressure(
  state: ReturnType<World["cultureState"]>,
  trait: string,
  delta: number,
): void {
  const cur = state.traitPressure[trait] ?? 0;
  state.traitPressure[trait] = Math.max(-3, Math.min(3, cur + delta));
}
