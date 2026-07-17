// academies.ts — persistent scholar-academies.
//
// Cross-dynasty organisations of scholar-masters — Al-Azhar, Sorbonne,
// Nalanda, Timbuktu. Similar to guilds but with two additional dynamics:
//
//   1. Prestige — a slow-growing capital that draws foreign scholars.
//      Grows with member count and inventions produced in the province.
//      Falls with sackings, ossification, or master death without heir.
//
//   2. Migration — when an academy's prestige collapses (siege, invasion),
//      surviving scholars may reconstitute at another literacy_valued
//      province, firing ACADEMY_MIGRATED. Historical: Byzantine scholars
//      fleeing to Italy after 1453 seeded the Renaissance.
//
// Guarded on magicEnabled — scholar classes don't emerge without magic.

import type { Academy, AcademyId, Character, DynastyId, ProvinceId } from "./types.js";
import type { World } from "./world.js";

const FLOURISH_THRESHOLD = 0.75;
const FORMATION_MIN_SCHOLARS = 2;   // level-6+ scholars needed to found
const FORMATION_MIN_LEVEL = 6;
const MIGRATION_PRESTIGE_DROP = 0.5;
const MIGRATION_MIN_YEAR = 20;      // must be at least this old before migration

// Called from tick.ts, once per year, AFTER runInnovations (so this year's
// invention events already exist for the prestige-growth pass).
export function runAcademies(w: World): void {
  if (!w.magicEnabled) return;
  formNewAcademies(w);
  ageAcademies(w);
}

// ---------------------------------------------------------------------------
// Formation — a province with 3+ level-8 scholars, no active academy already,
// and literacy_valued culture is a candidate.
// ---------------------------------------------------------------------------
function formNewAcademies(w: World): void {
  for (const p of w.provinces.values()) {
    if (p.subsurface) continue;
    if (academyAt(w, p.id)) continue;
    const scholars = w.living().filter(
      (c) => c.provinceId === p.id && c.charClass === "scholar" && c.level >= FORMATION_MIN_LEVEL,
    );
    if (scholars.length < FORMATION_MIN_SCHOLARS) continue;
    // Culture gate — literacy_valued OR meritocracy (checked against any scholar's
    // culture OR against the province holder's culture — either qualifies).
    const holder = [...w.titles.values()].find((t) => t.provinceId === p.id);
    const holderChar = w.char(holder?.holderId ?? null);
    const hasLitTrait = (dynId: string): boolean => {
      const dyn = w.dynasty(dynId);
      if (!dyn?.cultureId) return false;
      const state = w.cultureState(dyn.cultureId);
      const starting = w.cultures.get(dyn.cultureId)?.startingTraits ?? [];
      return state.eliteTraits.has("literacy_valued")
          || state.folkTraits.has("literacy_valued")
          || starting.includes("literacy_valued")
          || state.eliteTraits.has("meritocracy")
          || state.folkTraits.has("meritocracy")
          || starting.includes("meritocracy");
    };
    const anyCulturedScholar = scholars.some((c) => hasLitTrait(c.dynastyId))
                            || (holderChar ? hasLitTrait(holderChar.dynastyId) : false);
    if (!anyCulturedScholar) continue;
    if (!w.rng.chance(0.12)) continue;
    // Founding — rector is the highest-level scholar; the patron is their dynasty.
    const master = scholars.reduce((a, b) => (b.level > a.level ? b : a));
    const acId: AcademyId = w.freshId("ac");
    const provName = p.name;
    const academy: Academy = {
      id: acId,
      name: `Academy of ${provName}`,
      provinceId: p.id,
      foundedYear: w.year,
      closedYear: null,
      masterId: master.id,
      memberIds: scholars.map((c) => c.id),
      prestige: 0.3,
      peakPrestige: 0.3,
      flourishesLoggedAt: null,
      patronDynastyId: master.dynastyId,
    };
    w.academies.set(acId, academy);
    w.log("ACADEMY_FOUNDED", {
      actorId: master.id,
      provinceId: p.id,
      data: {
        academy: academy.name, academyId: acId,
        patronDynasty: w.dynasty(master.dynastyId)?.name ?? master.dynastyId,
        founders: scholars.length,
      },
    });
  }
}

function academyAt(w: World, provinceId: ProvinceId): Academy | undefined {
  for (const a of w.academies.values()) {
    if (a.closedYear !== null) continue;
    if (a.provinceId === provinceId) return a;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Aging — each academy grows/loses prestige based on member count, inventions,
// and shocks (sieges, sacking events).
// ---------------------------------------------------------------------------
function ageAcademies(w: World): void {
  for (const a of w.academies.values()) {
    if (a.closedYear !== null) continue;
    // Prune dead members.
    a.memberIds = a.memberIds.filter((id) => w.characters.get(id)?.alive === true);
    if (a.memberIds.length < 2) {
      // Not enough scholars — the academy is failing. Check for migration OR dissolve.
      tryMigrate(w, a);
      if (a.closedYear === null) {
        a.closedYear = w.year;
        w.log("ACADEMY_DISSOLVED", {
          provinceId: a.provinceId,
          data: { academy: a.name, academyId: a.id, cause: "no scholars remain" },
        });
      }
      continue;
    }
    // Update master.
    const members = a.memberIds.map((id) => w.characters.get(id)!).filter((c) => c);
    a.masterId = members.reduce((m, c) => (c.level > m.level ? c : m), members[0]).id;

    // Prestige change — small per-year growth if healthy, drops on sack/shock.
    const inventionsThisYear = w.events.filter(
      (e) => e.type === "INVENTION_MADE" && e.provinceId === a.provinceId && e.year === w.year,
    ).length;
    let delta = 0.02 + inventionsThisYear * 0.05;
    // Shock check — SIEGE_LAID or WAR at the province this year OR last year.
    const shock = w.events.some(
      (e) => (e.type === "SIEGE_LAID" || e.type === "SIEGE_FALLEN" || e.type === "WAR"
           || e.type === "PLAGUE" || e.type === "URBAN_MOB_RIOT")
          && e.provinceId === a.provinceId && w.year - e.year <= 1,
    );
    if (shock) delta -= 0.15;
    a.prestige = Math.max(0, Math.min(1, a.prestige + delta));
    if (a.prestige > a.peakPrestige) a.peakPrestige = a.prestige;

    if (a.prestige >= FLOURISH_THRESHOLD && a.flourishesLoggedAt === null) {
      a.flourishesLoggedAt = w.year;
      w.log("ACADEMY_FLOURISHES", {
        provinceId: a.provinceId,
        data: { academy: a.name, academyId: a.id, prestige: a.prestige },
      });
    }
    // Big prestige drop triggers migration eligibility.
    if (delta <= -MIGRATION_PRESTIGE_DROP && w.year - a.foundedYear >= MIGRATION_MIN_YEAR) {
      tryMigrate(w, a);
    }
  }
}

// Try to migrate an academy's surviving scholars to another literacy_valued
// province. Fires ACADEMY_MIGRATED, closes this academy, spawns a new one.
function tryMigrate(w: World, a: Academy): void {
  const survivors = a.memberIds
    .map((id) => w.characters.get(id))
    .filter((c): c is Character => !!c && c.alive && c.level >= FORMATION_MIN_LEVEL - 2);
  if (survivors.length < 2) return;
  // Pick a target — highest-population non-shocked province with a scholar-friendly
  // culture, excluding the current province.
  let best: ProvinceId | null = null;
  let bestScore = -1;
  for (const p of w.provinces.values()) {
    if (p.id === a.provinceId) continue;
    if (p.subsurface) continue;
    if (academyAt(w, p.id)) continue;
    // Score: population + a bonus for cultural fit
    let score = p.population;
    const holder = [...w.titles.values()].find((t) => t.provinceId === p.id);
    const holderChar = w.char(holder?.holderId ?? null);
    if (holderChar) {
      const dyn = w.dynasty(holderChar.dynastyId);
      if (dyn?.cultureId) {
        const state = w.cultureState(dyn.cultureId);
        if (state.eliteTraits.has("literacy_valued")) score += 300;
        if (state.eliteTraits.has("meritocracy")) score += 200;
      }
    }
    if (score > bestScore) { bestScore = score; best = p.id; }
  }
  if (!best) return;
  // Close current academy.
  const oldProv = a.provinceId;
  a.closedYear = w.year;
  // Move survivors physically.
  for (const s of survivors) s.provinceId = best;
  // Spawn new academy at target.
  const acId: AcademyId = w.freshId("ac");
  const provName = w.province(best)?.name ?? "the new seat";
  const master = survivors.reduce((m, c) => (c.level > m.level ? c : m));
  w.academies.set(acId, {
    id: acId,
    name: `Academy of ${provName}`,
    provinceId: best,
    foundedYear: w.year,
    closedYear: null,
    masterId: master.id,
    memberIds: survivors.map((c) => c.id),
    prestige: 0.35,
    peakPrestige: Math.max(0.35, a.peakPrestige * 0.8),
    flourishesLoggedAt: null,
    patronDynastyId: null,
  });
  w.log("ACADEMY_MIGRATED", {
    actorId: master.id,
    provinceId: best,
    data: {
      fromProvinceId: oldProv,
      toProvinceId: best,
      oldAcademyId: a.id,
      newAcademyId: acId,
      scholars: survivors.length,
    },
  });
}

// ---------------------------------------------------------------------------
// Prestige bonus reader — academies at a province boost innovation prob for
// scholars there. Used by specs/innovation-events.ts.
// ---------------------------------------------------------------------------
export function academyPrestigeAt(w: World, provinceId: ProvinceId): number {
  const a = academyAt(w, provinceId);
  return a ? a.prestige : 0;
}

void ({} as DynastyId); // keep the import used
