// emergence.ts — state-conditional "emergence" events.
//
// Where catastrophe.ts is exogenous shock (a die roll rolls and the sky falls),
// emergence.ts reads the world's current state and asks: given these characters,
// these dynasties, these blighted lands and mana-rich mountains — who WOULD
// naturally rise up? The base sim already answers this at the political level
// (LOWBORN_RISE, WAR, MURDER). This layer answers it at the mythic level:
// archmages, dark prophets, warlords, rediscovered arts, stolen rites.
//
// All events are gated behind World.magicEnabled — they all reference character
// `level` and dynasty `rite`, which only carry meaning when the magic layer is
// active. Golden-hash worlds have magic off, so this file makes zero RNG draws
// in the base configuration.
//
// Structure: one small check-function per event type. Each reads state, applies
// a probability curve modulated by that state, and calls w.log(...) on hit.
// Never mutates state directly — that's the sifter/render's job.

import { provincePeril } from "./magic.js";
import type { CharClass, Character, RareClass, WorldEvent } from "./types.js";
import type { World } from "./world.js";

// Helper: does the character's culture have the trait active in EITHER tier?
// Falls back to spec startingTraits when the live state hasn't been touched yet
// (character with no dynastyId, seed-worlds without culture drift, etc).
function cultureHasTrait(w: World, c: Character, trait: string): boolean {
  const dyn = w.dynasty(c.dynastyId);
  if (!dyn?.cultureId) return false;
  const state = w.cultureState(dyn.cultureId);
  if (state.eliteTraits.has(trait) || state.folkTraits.has(trait)) return true;
  return (w.cultures.get(dyn.cultureId)?.startingTraits ?? []).includes(trait);
}

// Public entry: runs once per tick after magic advances (so this year's LEVELED
// events are already in the log and can gate emergence checks below).
export function runEmergence(w: World): void {
  if (!w.magicEnabled) return;
  checkArchmageEmerges(w);
  checkDarkProphetRises(w);
  checkWarlordAscendant(w);
  checkLoneGeniusEmerges(w);
  checkPariahTurnsChampion(w);
  checkFallenNobleRises(w);
  checkArtRediscovered(w);
  checkLostClassResurfaces(w);
  checkForbiddenArtPracticed(w);
  checkLegendarySkillManifests(w);
  checkClassLineageBroken(w);
  checkRiteStolen(w);
}

// ---------------------------------------------------------------------------
// Individual emergence — a named figure crosses a mythic threshold
// ---------------------------------------------------------------------------

// ARCHMAGE_EMERGES — the highest-level mage in the world reaches level 20+ in a
// high-mana province. Fires at most once per (character, world) — the character
// carries a data tag on their first firing.
function checkArchmageEmerges(w: World): void {
  const alreadyNamed = new Set(
    w.events.filter((e) => e.type === "ARCHMAGE_EMERGES").map((e) => e.actorId),
  );
  const mages = w.living().filter((c) =>
    c.charClass === "stormcaller" || c.charClass === "necromancer" || c.charClass === "warden",
  );
  if (mages.length === 0) return;
  mages.sort((a, b) => b.level - a.level);
  const top = mages[0];
  if (top.level < 20 || alreadyNamed.has(top.id)) return;
  const prov = w.province(top.provinceId);
  if (!prov || prov.manaDensity < 0.55) return;
  // Prob scales with how far past the threshold they are; capped at ~40%.
  const p = Math.min(0.4, 0.08 + (top.level - 20) * 0.03 + prov.manaDensity * 0.15);
  if (!w.rng.chance(p)) return;
  w.log("ARCHMAGE_EMERGES", {
    actorId: top.id,
    provinceId: top.provinceId,
    data: { level: top.level, charClass: top.charClass, manaDensity: prov.manaDensity },
  });
}

// DARK_PROPHET_RISES — a high-piety character in a blighted province with a
// zealous-faith cultural tilt starts preaching an unsettling doctrine. Fires
// at most once per character.
function checkDarkProphetRises(w: World): void {
  const alreadyNamed = new Set(
    w.events.filter((e) => e.type === "DARK_PROPHET_RISES").map((e) => e.actorId),
  );
  for (const c of w.living()) {
    if (alreadyNamed.has(c.id)) continue;
    if (w.age(c) < 20) continue;
    if (c.drives.piety < 0.75) continue;
    const prov = w.province(c.provinceId);
    if (!prov || prov.blightLevel < 0.4) continue;
    const zealous = cultureHasTrait(w, c, "zealous_faith");
    // Prob boosted by zealous_faith trait, blight level, and character piety.
    let p = 0.005 + prov.blightLevel * 0.02 + c.drives.piety * 0.01;
    if (zealous) p += 0.02;
    if (p > 0.06) p = 0.06;
    if (!w.rng.chance(p)) return;
    w.log("DARK_PROPHET_RISES", {
      actorId: c.id,
      provinceId: c.provinceId,
      data: {
        piety: c.drives.piety,
        blightLevel: prov.blightLevel,
        zealous,
      },
    });
    return; // one per year — a prophet is a singular event
  }
}

// WARLORD_ASCENDANT — a titleless martial character with a strong martial class
// and high ambition takes on a warlord identity when the world is at war.
function checkWarlordAscendant(w: World): void {
  const alreadyNamed = new Set(
    w.events.filter((e) => e.type === "WARLORD_ASCENDANT").map((e) => e.actorId),
  );
  const anyWarRecently = w.events.some(
    (e) => e.type === "WAR" && w.year - e.year <= 3,
  );
  if (!anyWarRecently) return;
  for (const c of w.living()) {
    if (alreadyNamed.has(c.id)) continue;
    if (w.titlesHeldBy(c.id).length > 0) continue;
    if (c.charClass !== "soldier" && c.charClass !== "knight") continue;
    if (c.level < 12) continue;
    if (c.drives.ambition < 0.7) continue;
    const warriorCulture = cultureHasTrait(w, c, "warrior_culture");
    let p = 0.02 + (c.level - 12) * 0.01 + c.drives.ambition * 0.02;
    if (warriorCulture) p += 0.03;
    if (p > 0.12) p = 0.12;
    if (!w.rng.chance(p)) continue;
    w.log("WARLORD_ASCENDANT", {
      actorId: c.id,
      provinceId: c.provinceId,
      data: { level: c.level, ambition: c.drives.ambition, warriorCulture },
    });
    return; // one warlord per year at most
  }
}

// LONE_GENIUS_EMERGES — a high-level character with NO dynastic rite, in a
// low-population isolated province, breaks through on their own. The romantic
// hermit-scholar. Fires at most once per character.
function checkLoneGeniusEmerges(w: World): void {
  const alreadyNamed = new Set(
    w.events.filter((e) => e.type === "LONE_GENIUS_EMERGES").map((e) => e.actorId),
  );
  for (const c of w.living()) {
    if (alreadyNamed.has(c.id)) continue;
    if (c.level < 16) continue;
    const dyn = w.dynasty(c.dynastyId);
    if (dyn?.rite) continue; // must be uninstitutional
    const prov = w.province(c.provinceId);
    if (!prov) continue;
    if (prov.population > 250) continue; // isolated
    if (w.titlesHeldBy(c.id).length > 0) continue;
    const p = Math.min(0.15, 0.03 + (c.level - 16) * 0.02);
    if (!w.rng.chance(p)) continue;
    w.log("LONE_GENIUS_EMERGES", {
      actorId: c.id,
      provinceId: c.provinceId,
      data: { level: c.level, charClass: c.charClass, population: prov.population },
    });
    return;
  }
}

// PARIAH_TURNS_CHAMPION — a lowborn character with a stack of grudges reaches
// level 14+. The scorned figure becomes a hero (or an anti-hero — the sifter
// won't judge). Fires at most once per character.
function checkPariahTurnsChampion(w: World): void {
  const alreadyNamed = new Set(
    w.events.filter((e) => e.type === "PARIAH_TURNS_CHAMPION").map((e) => e.actorId),
  );
  for (const c of w.living()) {
    if (alreadyNamed.has(c.id)) continue;
    if (!c.lowborn) continue;
    if (c.level < 14) continue;
    if (c.grudges.length < 2) continue;
    // Prob scales with grudge count and level.
    const p = Math.min(0.25, 0.04 + c.grudges.length * 0.03 + (c.level - 14) * 0.015);
    if (!w.rng.chance(p)) continue;
    w.log("PARIAH_TURNS_CHAMPION", {
      actorId: c.id,
      provinceId: c.provinceId,
      data: { level: c.level, grudges: c.grudges.length, vengeance: c.drives.vengeance },
    });
    return;
  }
}

// FALLEN_NOBLE_RISES — a member of a recently-extinct-or-fallen dynasty (no
// remaining title holders) hits level 10+ and reclaims relevance. Fires once
// per character.
function checkFallenNobleRises(w: World): void {
  const alreadyNamed = new Set(
    w.events.filter((e) => e.type === "FALLEN_NOBLE_RISES").map((e) => e.actorId),
  );
  for (const c of w.living()) {
    if (alreadyNamed.has(c.id)) continue;
    if (c.lowborn) continue;
    if (c.level < 10) continue;
    if (w.titlesHeldBy(c.id).length > 0) continue;
    // Dynasty must have held titles before but no living member now does.
    const dyn = w.dynasty(c.dynastyId);
    if (!dyn) continue;
    const members = w.dynastyMembers(dyn.id);
    const anyTitled = members.some((m) => w.titlesHeldBy(m.id).length > 0);
    if (anyTitled) continue;
    // Dynasty had to have mattered historically.
    const everRuled = w.events.some(
      (e) => e.type === "SUCCESSION" && w.char(e.actorId)?.dynastyId === dyn.id,
    );
    if (!everRuled) continue;
    const p = Math.min(0.2, 0.03 + (c.level - 10) * 0.02);
    if (!w.rng.chance(p)) continue;
    w.log("FALLEN_NOBLE_RISES", {
      actorId: c.id,
      provinceId: c.provinceId,
      data: { level: c.level, house: dyn.name },
    });
    return;
  }
}

// ---------------------------------------------------------------------------
// Class & art layer — arts lost, found, stolen, mutated
// ---------------------------------------------------------------------------

// ART_REDISCOVERED — a scholar-type character in the same culture as a
// previously-lost art brings it back. Requires an ART_LOST event in history,
// no current bearer of that class in that culture, and a scholar of level 8+.
function checkArtRediscovered(w: World): void {
  const lostArts = w.events.filter((e) => e.type === "ART_LOST");
  if (lostArts.length === 0) return;
  const alreadyRediscovered = new Set(
    w.events.filter((e) => e.type === "ART_REDISCOVERED").map((e) => String(e.data["rite"])),
  );
  for (const lost of lostArts) {
    const rite = String(lost.data["rite"] ?? "");
    if (!rite || alreadyRediscovered.has(rite)) continue;
    // Is anyone currently practising this rite? If so, it isn't "lost."
    const stillActive = [...w.dynasties.values()].some((d) => d.rite === rite);
    if (stillActive) continue;
    // Find a scholar in the culture that lost it.
    const lostHouse = String(lost.data["house"] ?? "");
    const cultureOfLoss = [...w.dynasties.values()].find((d) => d.name === lostHouse)?.cultureId;
    const candidates = w.living().filter((c) =>
      c.charClass === "scholar" &&
      c.level >= 8 &&
      w.dynasty(c.dynastyId)?.cultureId === cultureOfLoss,
    );
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => b.level - a.level);
    const scholar = candidates[0];
    const p = 0.02 + (scholar.level - 8) * 0.02;
    if (!w.rng.chance(Math.min(0.25, p))) continue;
    // Restore the rite to the scholar's dynasty.
    const dyn = w.dynasty(scholar.dynastyId);
    if (!dyn) continue;
    dyn.rite = rite as RareClass;
    dyn.riteBearerId = scholar.id;
    scholar.charClass = rite as CharClass;
    w.log("ART_REDISCOVERED", {
      actorId: scholar.id,
      provinceId: scholar.provinceId,
      data: { rite, house: dyn.name, level: scholar.level, lostInYear: lost.year },
    });
    return; // one per year
  }
}

// LOST_CLASS_RESURFACES — a rare-class character appears whose class hasn't
// been held for 50+ years. Distinct from ART_REDISCOVERED because it doesn't
// require an ART_LOST — the class was simply dormant.
function checkLostClassResurfaces(w: World): void {
  const rareClasses: RareClass[] = ["warden", "stormcaller", "necromancer"];
  for (const rc of rareClasses) {
    // Any living character currently has this class?
    const anyHolds = w.living().some((c) => c.charClass === rc);
    if (anyHolds) continue;
    // Was it ever held before, but long ago?
    const lastSeen = [...w.events]
      .reverse()
      .find((e) => e.type === "CLASS_GAINED" && e.data["class"] === rc);
    if (!lastSeen || w.year - lastSeen.year < 50) continue;
    // Any dynasty currently listing this rite?
    const holdingDyn = [...w.dynasties.values()].find((d) => d.rite === rc);
    if (!holdingDyn) continue;
    // Modest per-year chance.
    if (!w.rng.chance(0.05)) continue;
    // Pick any living adult of that dynasty as the resurfacer.
    const revivalist = w.dynastyMembers(holdingDyn.id).find((m) => w.age(m) >= 16);
    if (!revivalist) continue;
    revivalist.charClass = rc as CharClass;
    holdingDyn.riteBearerId = revivalist.id;
    w.log("LOST_CLASS_RESURFACES", {
      actorId: revivalist.id,
      provinceId: revivalist.provinceId,
      data: { charClass: rc, house: holdingDyn.name, dormantYears: w.year - lastSeen.year },
    });
    return;
  }
}

// FORBIDDEN_ART_PRACTICED — when a province is actively corrupted (has a
// corruptionType) and there's a rite-bearer of "necromancer" nearby, the art
// starts being practised openly. Deepens local blight.
function checkForbiddenArtPracticed(w: World): void {
  for (const p of w.provinces.values()) {
    if (!p.corruptionType) continue;
    // A living necromancer resident or ruler.
    const necro = w.living().find((c) =>
      c.charClass === "necromancer" &&
      (c.provinceId === p.id || w.titlesHeldBy(c.id).some((t) => t.provinceId === p.id)),
    );
    if (!necro) continue;
    // Once per (province, character) — the tag lives on the province.
    const already = w.events.some(
      (e) => e.type === "FORBIDDEN_ART_PRACTICED" &&
             e.provinceId === p.id && e.actorId === necro.id,
    );
    if (already) continue;
    const prob = 0.03 + p.blightLevel * 0.05;
    if (!w.rng.chance(prob)) continue;
    // Openly practising the art accelerates the blight.
    p.blightLevel = Math.min(1, p.blightLevel + 0.08);
    w.log("FORBIDDEN_ART_PRACTICED", {
      actorId: necro.id,
      provinceId: p.id,
      data: { corruptionType: p.corruptionType, blightLevel: p.blightLevel },
    });
    return;
  }
}

// LEGENDARY_SKILL_MANIFESTS — a high-level character who survived a war or
// plague and has climbed past level 25 develops a unique skill. Fires at most
// once world-wide (the singular skill is world-defining).
function checkLegendarySkillManifests(w: World): void {
  const alreadyExists = w.events.some((e) => e.type === "LEGENDARY_SKILL_MANIFESTS");
  if (alreadyExists) return;
  for (const c of w.living()) {
    if (c.level < 25) continue;
    // Must have survived war or plague at some point.
    const survived = w.events.some(
      (e) =>
        (e.type === "WAR" && (e.actorId === c.id || e.targetId === c.id)) ||
        (e.type === "PLAGUE" && e.provinceId === c.provinceId),
    );
    if (!survived) continue;
    const prov = w.province(c.provinceId);
    const peril = prov ? provincePeril(w, prov) : 0;
    const p = Math.min(0.15, 0.02 + (c.level - 25) * 0.02 + peril * 0.05);
    if (!w.rng.chance(p)) continue;
    w.log("LEGENDARY_SKILL_MANIFESTS", {
      actorId: c.id,
      provinceId: c.provinceId,
      data: { level: c.level, charClass: c.charClass },
    });
    return;
  }
}

// CLASS_LINEAGE_BROKEN — precursor to ART_LOST. When a dynasty's rite-bearer
// dies and no living member of that dynasty has the class at level 4+, the
// lineage is at risk. Fires when the youngest capable bearer is below level 4
// and the dynasty is shrinking (fewer than 3 adults).
function checkClassLineageBroken(w: World): void {
  for (const dyn of w.dynasties.values()) {
    if (!dyn.rite || dyn.extinctYear !== null) continue;
    const members = w.dynastyMembers(dyn.id);
    const bearers = members.filter((m) => m.charClass === dyn.rite && m.level >= 4);
    if (bearers.length > 0) continue; // still has a capable bearer
    const adults = members.filter((m) => w.age(m) >= 16);
    if (adults.length >= 3) continue; // dynasty is still large
    // Only fire this once per dynasty.
    const already = w.events.some(
      (e) => e.type === "CLASS_LINEAGE_BROKEN" && e.data["house"] === dyn.name,
    );
    if (already) continue;
    if (!w.rng.chance(0.4)) continue;
    w.log("CLASS_LINEAGE_BROKEN", {
      provinceId: adults[0]?.provinceId ?? null,
      data: { house: dyn.name, rite: dyn.rite, adults: adults.length },
    });
    return;
  }
}

// RITE_STOLEN — when a scheme SUCCEEDS this year against a rite-holding
// dynasty (any DISCOVERED scheme actor scoring a MURDER of a rite-bearer this
// year), the rite may transfer to the actor's dynasty. Rare and dramatic.
function checkRiteStolen(w: World): void {
  // Look for MURDERs this year where the target held a rite for their dynasty.
  const thisYearMurders = w.events.filter(
    (e) => e.type === "MURDER" && e.year === w.year,
  );
  for (const m of thisYearMurders) {
    const victim = w.char(m.targetId);
    const killer = w.char(m.actorId);
    if (!victim || !killer) continue;
    const victimDyn = w.dynasty(victim.dynastyId);
    if (!victimDyn?.rite || victimDyn.riteBearerId !== victim.id) continue;
    if (killer.dynastyId === victim.dynastyId) continue; // kinslaying, not theft
    const killerDyn = w.dynasty(killer.dynastyId);
    if (!killerDyn || killerDyn.rite) continue; // killer's house already has one
    if (!w.rng.chance(0.25)) continue;
    // Transfer the rite: victim's house loses it, killer's house gains it.
    killerDyn.rite = victimDyn.rite;
    killerDyn.riteBearerId = killer.id;
    killer.charClass = victimDyn.rite as CharClass;
    victimDyn.rite = null;
    victimDyn.riteBearerId = null;
    w.log("RITE_STOLEN", {
      actorId: killer.id,
      targetId: victim.id,
      provinceId: killer.provinceId,
      data: {
        rite: killerDyn.rite,
        fromHouse: victimDyn.name,
        toHouse: killerDyn.name,
      },
    });
    return; // one per year
  }
}

// Exported for testing / external inspection.
export function summariseEmergence(w: World): Record<string, number> {
  const out: Record<string, number> = {};
  const tracked = [
    "ARCHMAGE_EMERGES",
    "DARK_PROPHET_RISES",
    "WARLORD_ASCENDANT",
    "LONE_GENIUS_EMERGES",
    "PARIAH_TURNS_CHAMPION",
    "FALLEN_NOBLE_RISES",
    "ART_REDISCOVERED",
    "LOST_CLASS_RESURFACES",
    "FORBIDDEN_ART_PRACTICED",
    "LEGENDARY_SKILL_MANIFESTS",
    "CLASS_LINEAGE_BROKEN",
    "RITE_STOLEN",
  ];
  for (const t of tracked) out[t] = 0;
  for (const e of w.events as WorldEvent[]) {
    if (out[e.type] !== undefined) out[e.type]++;
  }
  return out;
}
