// culture-drift.ts — how events and dominant individuals reshape a culture
// over generations.
//
// Two pressure pools accumulate each tick:
//   • Elite pressure — from titled characters (lords, kings, generals)
//   • Folk pressure  — from untitled adults (commoners, soldiers, craftspeople)
//
// Three main sources:
//   1. Drive averages  — living tier members push toward traits that mirror their
//      temperament (warlike lords → warrior_culture, fearful commons → caste_rigid).
//   2. This year's events — wars won, lowborn risers, famines, reforms spike
//      specific pressures in the appropriate tier.
//   3. Neighbor contact — folk-layer contagion from adjacent cultures (slow, steady).
//
// Cross-tier bleed: pressures converge at bleedRate = BLEED_BASE × (1 − stratification).
// A highly stratified society (caste_rigid, slavery) keeps lord and commoner worlds apart.
//
// Contested state: when pressure crosses a trait's threshold, the trait enters a
// generational contest — it takes `period` further years before it fully establishes.
// CULTURAL_CONTESTED fires on entry. If pressure collapses before the period ends,
// the contest is cancelled. CULTURAL_SHIFT fires on full establishment or abandonment.
//
// Reactive hardening: when the culture loses a war its folk traits spike — conquered
// peoples become more intensely themselves. Each defeat also seeds a small permanent
// warrior_culture pressure via the legacySeeds pool.
//
// Rifts: if elite and folk tiers hold directly opposed traits, CULTURAL_RIFT fires once.
//
// Aesthetic drift: the highest-title holder of the culture's dynasties is the "dominant
// figure." After 20 years of unbroken rule they may develop a quirk. At 3%/yr that
// quirk spreads to the whole culture's aesthetic layer as a CULTURAL_SHIFT.
//
// Gate: returns immediately when `w.cultures.size === 0` (the default world), so its
// golden hashes are completely unaffected.

import type { Character, WorldEvent } from "./types.js";
import type { World } from "./world.js";

// --------------------------------------------------------------------------
// Trait configuration — threshold to enter contest, period to establish,
// whether it is a deep-rooted "core" trait (hard to shift) or surface.
// --------------------------------------------------------------------------
const TRAIT_CONFIG: Record<string, { threshold: number; period: number; core: boolean }> = {
  slavery:         { threshold: 1.5, period: 30, core: true  },
  warrior_culture: { threshold: 1.5, period: 30, core: true  },
  zealous_faith:   { threshold: 1.5, period: 30, core: true  },
  caste_rigid:     { threshold: 1.5, period: 30, core: true  },
  meritocracy:     { threshold: 1.2, period: 25, core: false },
  mercantile:      { threshold: 0.7, period: 10, core: false },
  literacy_valued: { threshold: 0.7, period: 10, core: false },
};

const ALL_TRAITS = Object.keys(TRAIT_CONFIG);

// Mutually exclusive pairs: adopting one removes the other in the same tier.
const OPPOSED: [string, string][] = [
  ["slavery",         "meritocracy"],
  ["caste_rigid",     "meritocracy"],
  ["warrior_culture", "literacy_valued"],
];

// --------------------------------------------------------------------------
// Aesthetic quirk pool (dominant figure → cultural drift).
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
const BLEED_BASE = 0.15; // base cross-tier bleed rate per year at stratification = 0

// --------------------------------------------------------------------------
// Human-readable cause strings for event data.
// --------------------------------------------------------------------------
const CAUSE_LABEL: Record<string, string> = {
  warrior_culture: "generations of war hardened the people",
  meritocracy:     "lowborn talents rose to prominence",
  caste_rigid:     "scarcity deepened social divisions",
  mercantile:      "trade became the measure of all worth",
  slavery:         "the powerful bound the weak in chains",
  literacy_valued: "knowledge became a weapon of the capable",
  zealous_faith:   "the faithful grew fervent in their devotion",
};

const CONTESTED_CAUSE: Record<string, string> = {
  warrior_culture: "the drums of war grew louder",
  meritocracy:     "commoners began to question the accident of birth",
  caste_rigid:     "the walls between stations grew harder to cross",
  mercantile:      "the smell of profit began to outweigh the call of honour",
  slavery:         "whispers of bondage crept through the markets",
  literacy_valued: "the literate began to outcompete the merely noble",
  zealous_faith:   "the devout called for a more exacting faith",
};

// --------------------------------------------------------------------------
// Main entry point — called once per tick from tick.ts.
// --------------------------------------------------------------------------
export function advanceCultureDrift(w: World): void {
  if (w.cultures.size === 0) return;

  const thisYearEvents = w.events.filter((ev) => ev.year === w.year);

  for (const [cultureId] of w.cultures) {
    const state = w.cultureState(cultureId);

    const allMembers = w.adults().filter((c) => {
      const dyn = w.dynasty(c.dynastyId);
      return dyn?.cultureId === cultureId;
    });
    if (allMembers.length === 0) continue;

    const elite = allMembers.filter((c) => w.titlesHeldBy(c.id).length > 0);
    const folk  = allMembers.filter((c) => w.titlesHeldBy(c.id).length === 0);

    // 1. Drive-based pressure — each tier shaped by its own membership.
    if (elite.length > 0) applyDrivePressure(state.elitePressure, elite);
    if (folk.length  > 0) applyDrivePressure(state.folkPressure,  folk);

    // 2. Event-based pressure — routed to elite or folk by event type.
    applyEventPressure(state, thisYearEvents, allMembers);

    // 3. Reactive hardening — military defeats spike existing folk traits.
    applyReactiveHardening(state, thisYearEvents, allMembers);

    // 4. Legacy seeds — permanent pressure/yr from historical events, never decays.
    for (const [trait, delta] of Object.entries(state.legacySeeds)) {
      addPressure(state.elitePressure, trait, delta * 0.4);
      addPressure(state.folkPressure,  trait, delta * 0.6);
    }

    // 5. Cross-tier bleed — tiers converge at rate proportional to (1 − stratification).
    bleedPressure(state);

    // 6. Neighbor contact — folk-layer contagion from adjacent cultures.
    applyNeighborContact(w, cultureId, state);

    // 7. Decay all pressures.
    for (const k of Object.keys(state.elitePressure)) state.elitePressure[k] *= PRESSURE_DECAY;
    for (const k of Object.keys(state.folkPressure))  state.folkPressure[k]  *= PRESSURE_DECAY;

    // 8. Update stratification index.
    updateStratification(state, thisYearEvents, allMembers);

    // 9. Check whether any trait pressure just crossed its threshold.
    checkNewContested(w, state, cultureId);

    // 10. Advance contested traits toward establishment or abandonment.
    advanceContested(w, state, cultureId);

    // 11. Detect cross-tier rifts.
    detectRifts(w, state, cultureId);

    // 12. Dominant figure tracking & aesthetic drift.
    advanceDominantFigure(w, cultureId, state, allMembers);
  }
}

// --------------------------------------------------------------------------
// Drive-based pressure: each tier pushes toward traits that mirror its members'
// average temperament.
// --------------------------------------------------------------------------
function applyDrivePressure(pressure: Record<string, number>, members: Character[]): void {
  let ambition = 0, greed = 0, vengeance = 0, piety = 0, fear = 0;
  for (const c of members) {
    ambition  += c.drives.ambition;
    greed     += c.drives.greed;
    vengeance += c.drives.vengeance;
    piety     += c.drives.piety;
    fear      += c.drives.fear;
  }
  const n = members.length;
  if ((ambition + vengeance) / n > 1.30) addPressure(pressure, "warrior_culture", 0.08);
  if (greed     / n > 0.65) addPressure(pressure, "mercantile",    0.06);
  if (piety     / n > 0.65) addPressure(pressure, "zealous_faith", 0.07);
  if (fear      / n > 0.60) addPressure(pressure, "caste_rigid",   0.05);
}

// --------------------------------------------------------------------------
// Event-based pressure: this tick's events route to elite or folk pools.
// --------------------------------------------------------------------------
function applyEventPressure(
  state: ReturnType<World["cultureState"]>,
  events: WorldEvent[],
  allMembers: Character[],
): void {
  const memberSet = new Set(allMembers.map((c) => c.id));

  for (const ev of events) {
    switch (ev.type) {
      case "LOWBORN_RISE":
        // A commoner's rise is first a folk story, felt later in elite halls.
        addPressure(state.folkPressure,  "meritocracy", 0.25);
        addPressure(state.elitePressure, "meritocracy", 0.08);
        addPressure(state.folkPressure,  "caste_rigid", -0.15);
        break;

      case "FAMINE":
      case "PLAGUE":
        // Crises tighten hierarchy as people cling to known order.
        addPressure(state.folkPressure,  "caste_rigid", 0.08);
        addPressure(state.elitePressure, "caste_rigid", 0.04);
        break;

      case "WAR":
        if (ev.actorId && memberSet.has(ev.actorId) && ev.data["attacker_won"]) {
          addPressure(state.elitePressure, "warrior_culture", 0.10);
          addPressure(state.folkPressure,  "warrior_culture", 0.05);
        }
        if (ev.targetId && memberSet.has(ev.targetId) && !ev.data["attacker_won"]) {
          addPressure(state.folkPressure, "caste_rigid", 0.04);
        }
        break;

      case "REFORM":
        if (ev.actorId && memberSet.has(ev.actorId)) {
          const law = String(ev.data["new_law"] ?? "");
          if (law === "elective" || law === "meritocracy") {
            addPressure(state.elitePressure, "meritocracy", 0.15);
            addPressure(state.folkPressure,  "meritocracy", 0.08);
          }
        }
        break;

      default:
        break;
    }
  }
}

// --------------------------------------------------------------------------
// Reactive hardening: a defeated culture's folk traits spike — conquered peoples
// become more intensely themselves. Also seeds a legacy warrior pressure.
// --------------------------------------------------------------------------
function applyReactiveHardening(
  state: ReturnType<World["cultureState"]>,
  events: WorldEvent[],
  allMembers: Character[],
): void {
  const memberSet = new Set(allMembers.map((c) => c.id));
  for (const ev of events) {
    if (ev.type !== "WAR" || !ev.data["attacker_won"]) continue;
    // targetId is the losing defender — if they're one of ours, harden.
    if (!ev.targetId || !memberSet.has(ev.targetId)) continue;
    for (const trait of state.folkTraits) {
      addPressure(state.folkPressure, trait, 0.12);
    }
    // Each defeat leaves a small permanent seed of warrior pressure.
    state.legacySeeds["warrior_culture"] = Math.min(
      0.1,
      (state.legacySeeds["warrior_culture"] ?? 0) + 0.008,
    );
  }
}

// --------------------------------------------------------------------------
// Cross-tier bleed: elite and folk pressures converge toward each other at a
// rate proportional to (1 − stratification). High stratification seals tiers apart.
// --------------------------------------------------------------------------
function bleedPressure(state: ReturnType<World["cultureState"]>): void {
  const bleedRate = BLEED_BASE * (1 - state.stratification);
  const allKeys = new Set([
    ...Object.keys(state.elitePressure),
    ...Object.keys(state.folkPressure),
  ]);
  for (const trait of allKeys) {
    const ep = state.elitePressure[trait] ?? 0;
    const fp = state.folkPressure[trait]  ?? 0;
    const transfer = (ep - fp) * bleedRate;
    state.elitePressure[trait] = Math.max(-3, Math.min(3, ep - transfer));
    state.folkPressure[trait]  = Math.max(-3, Math.min(3, fp + transfer));
  }
}

// --------------------------------------------------------------------------
// Neighbor contact: folk layer absorbs traits from adjacent cultures.
// Contact years bonus accelerates the contagion for long-term neighbours.
// --------------------------------------------------------------------------
function applyNeighborContact(
  w: World,
  cultureId: string,
  state: ReturnType<World["cultureState"]>,
): void {
  const ownProvinces = new Set<string>();
  for (const c of w.adults()) {
    if (w.dynasty(c.dynastyId)?.cultureId === cultureId) ownProvinces.add(c.provinceId);
  }
  const adjacentProvinces = new Set<string>();
  for (const pid of ownProvinces) {
    const prov = w.province(pid);
    if (prov) for (const n of prov.neighbors) adjacentProvinces.add(n);
  }
  for (const c of w.adults()) {
    const dyn = w.dynasty(c.dynastyId);
    if (!dyn || dyn.cultureId === cultureId || !dyn.cultureId) continue;
    if (!adjacentProvinces.has(c.provinceId)) continue;
    const neighborId = dyn.cultureId;
    state.contactYears[neighborId] = (state.contactYears[neighborId] ?? 0) + 1;
    const contactBonus = Math.min(2, (state.contactYears[neighborId] ?? 1) / 50);
    const neighborState = w.cultureState(neighborId);
    for (const trait of neighborState.folkTraits) {
      addPressure(state.folkPressure, trait, 0.02 * (1 + contactBonus));
    }
  }
}

// --------------------------------------------------------------------------
// Stratification: a sliding 0..1 index of how sealed apart the tiers are.
// Shaped by active traits and events; drifts toward 0.3 when no forces act.
// --------------------------------------------------------------------------
function updateStratification(
  state: ReturnType<World["cultureState"]>,
  events: WorldEvent[],
  allMembers: Character[],
): void {
  const memberSet = new Set(allMembers.map((c) => c.id));

  if (state.eliteTraits.has("caste_rigid") || state.folkTraits.has("caste_rigid"))
    state.stratification = Math.min(1, state.stratification + 0.02);
  if (state.eliteTraits.has("slavery") || state.folkTraits.has("slavery"))
    state.stratification = Math.min(1, state.stratification + 0.01);
  if (state.eliteTraits.has("meritocracy") || state.folkTraits.has("meritocracy"))
    state.stratification = Math.max(0, state.stratification - 0.02);

  for (const ev of events) {
    if (ev.type === "LOWBORN_RISE" && ev.actorId && memberSet.has(ev.actorId))
      state.stratification = Math.max(0, state.stratification - 0.04);
  }

  // Slow mean-reversion toward 0.3.
  state.stratification += (0.3 - state.stratification) * 0.01;
}

// --------------------------------------------------------------------------
// Check whether any trait just crossed its threshold in either tier.
// Adoption and abandonment both enter contested state before committing.
// --------------------------------------------------------------------------
function checkNewContested(
  w: World,
  state: ReturnType<World["cultureState"]>,
  cultureId: string,
): void {
  const spec = w.cultures.get(cultureId);
  const cultureName = spec?.name ?? cultureId;

  for (const trait of ALL_TRAITS) {
    const cfg = TRAIT_CONFIG[trait]!;
    const ep = state.elitePressure[trait] ?? 0;
    const fp = state.folkPressure[trait]  ?? 0;

    const eAdoptKey    = `elite:${trait}`;
    const fAdoptKey    = `folk:${trait}`;
    const eAbandonKey  = `elite:abandon:${trait}`;
    const fAbandonKey  = `folk:abandon:${trait}`;

    // Elite adoption.
    if (!state.eliteTraits.has(trait) && ep >= cfg.threshold && !state.contested[eAdoptKey]) {
      state.contested[eAdoptKey] = { tier: "elite", trait, years: 0, direction: "adopt" };
      w.log("CULTURAL_CONTESTED", {
        data: {
          culture: cultureName,
          trait,
          tier: "elite",
          direction: "adopt",
          cause: CONTESTED_CAUSE[trait] ?? `pressure toward ${trait} builds among the lords`,
        },
      });
    }
    // Folk adoption.
    if (!state.folkTraits.has(trait) && fp >= cfg.threshold && !state.contested[fAdoptKey]) {
      state.contested[fAdoptKey] = { tier: "folk", trait, years: 0, direction: "adopt" };
      w.log("CULTURAL_CONTESTED", {
        data: {
          culture: cultureName,
          trait,
          tier: "folk",
          direction: "adopt",
          cause: CONTESTED_CAUSE[trait] ?? `pressure toward ${trait} builds among the commons`,
        },
      });
    }
    // Elite abandonment (quieter — no CULTURAL_CONTESTED event, just enters contest).
    const abandonThreshold = -(cfg.threshold * 0.6);
    if (state.eliteTraits.has(trait) && ep <= abandonThreshold && !state.contested[eAbandonKey]) {
      state.contested[eAbandonKey] = { tier: "elite", trait, years: 0, direction: "abandon" };
    }
    // Folk abandonment.
    if (state.folkTraits.has(trait) && fp <= abandonThreshold && !state.contested[fAbandonKey]) {
      state.contested[fAbandonKey] = { tier: "folk", trait, years: 0, direction: "abandon" };
    }
  }
}

// --------------------------------------------------------------------------
// Advance contested traits: increment years, tip or cancel.
// --------------------------------------------------------------------------
function advanceContested(
  w: World,
  state: ReturnType<World["cultureState"]>,
  cultureId: string,
): void {
  const spec = w.cultures.get(cultureId);
  const cultureName = spec?.name ?? cultureId;

  for (const [key, entry] of Object.entries(state.contested)) {
    const cfg = TRAIT_CONFIG[entry.trait];
    if (!cfg) { delete state.contested[key]; continue; }

    const pressure = entry.tier === "elite" ? state.elitePressure : state.folkPressure;
    const p = pressure[entry.trait] ?? 0;

    if (entry.direction === "adopt") {
      // Cancel if pressure fell well below threshold.
      if (p < cfg.threshold * 0.4) { delete state.contested[key]; continue; }
      entry.years++;
      if (entry.years >= cfg.period) {
        establishTrait(w, state, entry.trait, entry.tier, cultureName);
        delete state.contested[key];
      }
    } else {
      // Abandonment: cancel if pressure recovered above the abandon floor.
      const abandonFloor = -(cfg.threshold * 0.6);
      if (p > abandonFloor * 0.4) { delete state.contested[key]; continue; }
      entry.years++;
      if (entry.years >= Math.ceil(cfg.period * 0.7)) {
        abandonTrait(w, state, entry.trait, entry.tier, cultureName);
        delete state.contested[key];
      }
    }
  }
}

// --------------------------------------------------------------------------
// Establish a trait in a tier; fire CULTURAL_SHIFT; remove opposed traits.
// --------------------------------------------------------------------------
function establishTrait(
  w: World,
  state: ReturnType<World["cultureState"]>,
  trait: string,
  tier: "elite" | "folk",
  cultureName: string,
): void {
  const traitSet = tier === "elite" ? state.eliteTraits : state.folkTraits;
  traitSet.add(trait);
  for (const [a, b] of OPPOSED) {
    if (a === trait && traitSet.has(b)) traitSet.delete(b);
    else if (b === trait && traitSet.has(a)) traitSet.delete(a);
  }
  w.log("CULTURAL_SHIFT", {
    data: {
      culture: cultureName,
      trait,
      adopted: true,
      tier,
      cause: CAUSE_LABEL[trait] ?? "gradual drift",
    },
  });
}

// --------------------------------------------------------------------------
// Abandon a trait in a tier; fire CULTURAL_SHIFT.
// --------------------------------------------------------------------------
function abandonTrait(
  w: World,
  state: ReturnType<World["cultureState"]>,
  trait: string,
  tier: "elite" | "folk",
  cultureName: string,
): void {
  const traitSet = tier === "elite" ? state.eliteTraits : state.folkTraits;
  traitSet.delete(trait);
  const pressure = tier === "elite" ? state.elitePressure : state.folkPressure;
  pressure[trait] = 0;
  w.log("CULTURAL_SHIFT", {
    data: {
      culture: cultureName,
      trait,
      adopted: false,
      tier,
      cause: CAUSE_LABEL[trait] ?? "waning pressure",
    },
  });
}

// --------------------------------------------------------------------------
// Detect rifts: fire CULTURAL_RIFT once when elite and folk hold opposed traits.
// --------------------------------------------------------------------------
function detectRifts(
  w: World,
  state: ReturnType<World["cultureState"]>,
  cultureId: string,
): void {
  const spec = w.cultures.get(cultureId);
  const cultureName = spec?.name ?? cultureId;

  for (const [a, b] of OPPOSED) {
    const riftKey = `${a}vs${b}`;
    const hasRift =
      (state.eliteTraits.has(a) && state.folkTraits.has(b)) ||
      (state.eliteTraits.has(b) && state.folkTraits.has(a));

    if (hasRift && !state.activeRifts.has(riftKey)) {
      state.activeRifts.add(riftKey);
      const eliteTrait = state.eliteTraits.has(a) ? a : b;
      const folkTrait  = state.folkTraits.has(a)  ? a : b;
      w.log("CULTURAL_RIFT", {
        data: {
          culture:     cultureName,
          elite_trait: eliteTrait,
          folk_trait:  folkTrait,
          cause:       `lords uphold ${eliteTrait} while commoners cleave to ${folkTrait}`,
        },
      });
    }
    // Clear the rift once it no longer applies so it can re-fire if it recurrs.
    if (!hasRift) {
      state.activeRifts.delete(riftKey);
    }
  }
}

// --------------------------------------------------------------------------
// Dominant figure: track the highest-tier title holder of this culture.
// After 20yr tenure assign them a quirk; at 3%/yr that quirk spreads to the
// whole culture's aesthetic layer.
// --------------------------------------------------------------------------
function advanceDominantFigure(
  w: World,
  cultureId: string,
  state: ReturnType<World["cultureState"]>,
  members: Character[],
): void {
  let bestTier = 0;
  let dominant: Character | null = null;
  for (const c of members) {
    for (const t of w.titlesHeldBy(c.id)) {
      const tier = t.tier === "kingdom" ? 3 : t.tier === "duchy" ? 2 : 1;
      if (tier > bestTier) { bestTier = tier; dominant = c; }
    }
  }
  if (!dominant) return;

  if (state.establishedFigureId !== dominant.id) {
    state.establishedFigureId = dominant.id;
    state.establishedSince = w.year;
  }

  const tenure = w.year - state.establishedSince;
  if (tenure >= 20 && !dominant.quirk && !state.figureQuirks[dominant.id]) {
    const quirk = w.rng.pick(QUIRK_POOL);
    dominant.quirk = quirk;
    state.figureQuirks[dominant.id] = quirk;
  }

  const quirk = state.figureQuirks[dominant.id] ?? dominant.quirk;
  if (quirk && !state.aesthetic.linguisticShift && w.rng.chance(0.03)) {
    state.aesthetic.linguisticShift = quirk;
    const spec = w.cultures.get(cultureId);
    w.log("CULTURAL_SHIFT", {
      actorId: dominant.id,
      data: {
        culture:        spec?.name ?? cultureId,
        trait:          "aesthetic",
        tier:           "both",
        adopted:        true,
        cause:          `${dominant.name}'s ${quirk} spread through the generation`,
        aesthetic_value: quirk,
      },
    });
  }
}

// --------------------------------------------------------------------------
// Utility: clamp and accumulate a pressure delta.
// --------------------------------------------------------------------------
function addPressure(pressure: Record<string, number>, trait: string, delta: number): void {
  const cur = pressure[trait] ?? 0;
  pressure[trait] = Math.max(-3, Math.min(3, cur + delta));
}
