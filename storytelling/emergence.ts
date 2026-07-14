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

// Composition snapshot: how many characters of each class live in this
// province. Computed on demand; cheap for a few hundred characters.
interface Composition {
  total: number;
  adults: number;
  scholars: number;
  merchants: number;
  knights: number;
  soldiers: number;
  hunters: number;
  wardens: number;
  stormcallers: number;
  necromancers: number;
  martial: number;    // knights + soldiers
  literate: number;   // scholars
  mageish: number;    // wardens + stormcallers + necromancers
}


// Per-tick indices, built once and reused across the year's checks so we don't
// re-walk the event log for every province. Without this the trade/composition
// checks become O(events × provinces × years) and blow past the test timeout.
interface EmergenceContext {
  activeTradeRoutes: Set<string>; // canonical "min~max" province pair keys
  activeTributes:    Set<string>; // "master|vassal" keys
  routeCounts:       Map<string, number>; // per-province endpoint count
  recentShocks:      Set<string>; // province ids with WAR/PLAGUE/FAMINE/DROUGHT/LOCUST in last 2y
  recentShockCause:  Map<string, string>; // pid -> event type name of most recent shock
  composition:       Map<string, Composition>; // per-province class snapshot
}

function buildContext(w: World): EmergenceContext {
  const active = new Set<string>();
  const tribs = new Set<string>();
  const counts = new Map<string, number>();
  for (const e of w.events) {
    if (e.type === "TRADE_ROUTE_ESTABLISHED") {
      const from = String(e.data["fromProvinceId"] ?? "");
      const to   = String(e.data["toProvinceId"] ?? "");
      if (!from || !to) continue;
      active.add([from, to].sort().join("~"));
    } else if (e.type === "TRADE_ROUTE_DISRUPTED") {
      const from = String(e.data["fromProvinceId"] ?? "");
      const to   = String(e.data["toProvinceId"] ?? "");
      if (!from || !to) continue;
      active.delete([from, to].sort().join("~"));
    } else if (e.type === "TRIBUTE_IMPOSED") {
      const m = String(e.data["masterProvinceId"] ?? "");
      const v = String(e.data["vassalProvinceId"] ?? "");
      if (m && v) tribs.add(`${m}|${v}`);
    } else if (e.type === "TRIBUTE_REVOKED" || e.type === "VASSAL_REBELS") {
      const m = String(e.data["masterProvinceId"] ?? "");
      const v = String(e.data["vassalProvinceId"] ?? "");
      if (m && v) tribs.delete(`${m}|${v}`);
    }
  }
  // Route-endpoint counts from active set.
  for (const key of active) {
    const [a, b] = key.split("~");
    counts.set(a, (counts.get(a) ?? 0) + 1);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  // Recent shocks — last 2 years only. Walk the tail of the log rather than
  // scanning it in full each time.
  const shocks = new Set<string>();
  const cause = new Map<string, string>();
  const shockTypes = new Set(["WAR", "PLAGUE", "FAMINE", "DROUGHT", "LOCUST_SWARM", "BLIGHT_LOCKED", "MASS_DEATH"]);
  for (let i = w.events.length - 1; i >= 0; i--) {
    const e = w.events[i];
    if (w.year - e.year > 2) break;
    if (shockTypes.has(e.type) && e.provinceId) {
      shocks.add(e.provinceId);
      if (!cause.has(e.provinceId)) cause.set(e.provinceId, e.type);
    }
  }
  // Composition — single walk of living characters, bucket by provinceId.
  const comp = new Map<string, Composition>();
  for (const p of w.provinces.values()) {
    comp.set(p.id, {
      total: 0, adults: 0, scholars: 0, merchants: 0, knights: 0,
      soldiers: 0, hunters: 0, wardens: 0, stormcallers: 0, necromancers: 0,
      martial: 0, literate: 0, mageish: 0,
    });
  }
  for (const ch of w.living()) {
    const c = comp.get(ch.provinceId);
    if (!c) continue;
    c.total++;
    if (w.age(ch) >= 16) c.adults++;
    switch (ch.charClass) {
      case "scholar":     c.scholars++;    c.literate++; break;
      case "merchant":    c.merchants++;   break;
      case "knight":      c.knights++;     c.martial++;  break;
      case "soldier":     c.soldiers++;    c.martial++;  break;
      case "hunter":      c.hunters++;     break;
      case "warden":      c.wardens++;     c.mageish++;  break;
      case "stormcaller": c.stormcallers++; c.mageish++; break;
      case "necromancer": c.necromancers++; c.mageish++; break;
    }
  }
  return { activeTradeRoutes: active, activeTributes: tribs, routeCounts: counts,
           recentShocks: shocks, recentShockCause: cause, composition: comp };
}

// Public entry: runs once per tick after magic advances (so this year's LEVELED
// events are already in the log and can gate emergence checks below).
export function runEmergence(w: World): void {
  if (!w.magicEnabled) return;
  const ctx = buildContext(w);
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
  // Trade & asymmetric relations
  checkTradeRouteEstablished(w, ctx);
  checkTradeRouteDisrupted(w, ctx);
  checkTributeImposed(w, ctx);
  checkTributeRevoked(w, ctx);
  checkVassalRebels(w, ctx);
  checkMarketMonopoly(w, ctx);
  // Class-composition driven
  checkScholarFlourish(w, ctx);
  checkLibraryFounded(w, ctx);
  checkLibraryBurned(w, ctx);
  checkMartialDecadence(w, ctx);
  checkMercantileAscendant(w, ctx);
  checkKnowledgeLost(w, ctx);
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

// ---------------------------------------------------------------------------
// Trade & asymmetric relations layer
// ---------------------------------------------------------------------------

// TRADE_ROUTE_ESTABLISHED — two neighbouring provinces both have merchants and
// a shared trade conduit (both coastal or both river). Strength stored in data
// gives an asymmetric weight — smaller/poorer province depends more on the
// larger. Route is durable until a DISRUPTED event tears it down.
function checkTradeRouteEstablished(w: World, ctx: EmergenceContext): void {
  for (const a of w.provinces.values()) {
    if (a.subsurface) continue;
    const compA = ctx.composition.get(a.id)!;
    if (compA.merchants < 1) continue;
    for (const bId of a.neighbors) {
      if (a.id >= bId) continue; // canonical ordering to dedupe
      const b = w.province(bId);
      if (!b || b.subsurface) continue;
      const compB = ctx.composition.get(b.id)!;
      if (compB.merchants < 1) continue;
      // Need a shared conduit — both coastal, both river, or coastal+coastal
      // adjacency counts as sea trade.
      const conduit = (a.coastal && b.coastal) || (a.riverConnected && b.riverConnected);
      if (!conduit) continue;
      if (ctx.activeTradeRoutes.has([a.id, b.id].sort().join("~"))) continue;
      const p = 0.06 + Math.min(compA.merchants, compB.merchants) * 0.03;
      if (!w.rng.chance(Math.min(0.25, p))) continue;
      // Strength: min of merchant counts, normalised. Direction: the province
      // with FEWER merchants depends more (higher "dependence" from A→B if B
      // has more merchants).
      const strength = Math.min(compA.merchants, compB.merchants) / 6;
      const aDependsOnB = compB.merchants > compA.merchants;
      w.log("TRADE_ROUTE_ESTABLISHED", {
        provinceId: a.id,
        data: {
          fromProvinceId: aDependsOnB ? a.id : b.id,
          toProvinceId:   aDependsOnB ? b.id : a.id,
          strength: Math.min(1, strength),
          conduit: a.coastal && b.coastal ? "sea" : "river",
        },
      });
      return;
    }
  }
}

// TRADE_ROUTE_DISRUPTED — an active route where one endpoint suffered a
// severe event (WAR, PLAGUE, FAMINE, DROUGHT, LOCUST_SWARM) in the last 2y.
function checkTradeRouteDisrupted(w: World, ctx: EmergenceContext): void {
  // Only consider active routes (from index) — no full log walk.
  for (const key of ctx.activeTradeRoutes) {
    const [a, b] = key.split("~");
    const shockedA = ctx.recentShocks.has(a);
    const shockedB = ctx.recentShocks.has(b);
    if (!shockedA && !shockedB) continue;
    if (!w.rng.chance(0.45)) continue;
    const shocked = shockedA ? a : b;
    w.log("TRADE_ROUTE_DISRUPTED", {
      provinceId: shocked,
      data: {
        fromProvinceId: a,
        toProvinceId: b,
        cause: ctx.recentShockCause.get(shocked) ?? "shock",
      },
    });
    return;
  }
}

// TRIBUTE_IMPOSED — a title-holder projects >= 3x the power of a neighbouring
// title-holder. The stronger house extracts tribute. Directional: master → vassal.
function checkTributeImposed(w: World, ctx: EmergenceContext): void {
  // Pre-index titles by provinceId so the inner loop is O(1) instead of O(T).
  const titleByProv = new Map<string, typeof w.titles extends Map<string, infer T> ? T : never>();
  for (const t of w.titles.values()) titleByProv.set(t.provinceId, t);
  for (const title of w.titles.values()) {
    const holder = w.char(title.holderId);
    if (!holder) continue;
    const masterProv = w.province(title.provinceId);
    if (!masterProv) continue;
    for (const nId of masterProv.neighbors) {
      const nProv = w.province(nId);
      if (!nProv || nProv.subsurface !== masterProv.subsurface) continue;
      const nTitle = titleByProv.get(nId);
      if (!nTitle) continue;
      const vHolder = w.char(nTitle.holderId);
      if (!vHolder || vHolder.id === holder.id) continue;
      const mp = w.power(holder);
      const vp = w.power(vHolder);
      if (mp < vp * 3) continue;
      if (ctx.activeTributes.has(`${masterProv.id}|${nProv.id}`)) continue;
      if (!w.rng.chance(0.12)) continue;
      w.log("TRIBUTE_IMPOSED", {
        actorId: holder.id,
        targetId: vHolder.id,
        titleId: title.id,
        provinceId: masterProv.id,
        data: {
          masterProvinceId: masterProv.id,
          vassalProvinceId: nProv.id,
          masterHouse: w.dynasty(holder.dynastyId)?.name,
          vassalHouse: w.dynasty(vHolder.dynastyId)?.name,
          powerRatio: Math.round((mp / Math.max(1, vp)) * 100) / 100,
        },
      });
      return;
    }
  }
}

// TRIBUTE_REVOKED — an active tribute where vassal has caught up (within 1.5x)
// and master doesn't want a war it can't win.
function checkTributeRevoked(w: World, ctx: EmergenceContext): void {
  for (const e of w.events) {
    if (e.type !== "TRIBUTE_IMPOSED") continue;
    const master = String(e.data["masterProvinceId"] ?? "");
    const vassal = String(e.data["vassalProvinceId"] ?? "");
    if (!master || !vassal) continue;
    if (!ctx.activeTributes.has(`${master}|${vassal}`)) continue;
    const masterHolder = w.char(e.actorId);
    const vassalHolder = w.char(e.targetId);
    if (!masterHolder || !vassalHolder) continue;
    const mp = w.power(masterHolder);
    const vp = w.power(vassalHolder);
    if (vp * 1.5 < mp) continue;
    if (!w.rng.chance(0.15)) continue;
    w.log("TRIBUTE_REVOKED", {
      actorId: masterHolder.id,
      targetId: vassalHolder.id,
      provinceId: master,
      data: {
        masterProvinceId: master,
        vassalProvinceId: vassal,
        masterHouse: w.dynasty(masterHolder.dynastyId)?.name,
        vassalHouse: w.dynasty(vassalHolder.dynastyId)?.name,
      },
    });
    return;
  }
}

// VASSAL_REBELS — active tribute, vassal has strong martial composition and
// vengeance drive. Instead of gracefully lapsing, they throw off the yoke.
function checkVassalRebels(w: World, ctx: EmergenceContext): void {
  const titleByProv = new Map<string, typeof w.titles extends Map<string, infer T> ? T : never>();
  for (const t of w.titles.values()) titleByProv.set(t.provinceId, t);
  for (const e of w.events) {
    if (e.type !== "TRIBUTE_IMPOSED") continue;
    const master = String(e.data["masterProvinceId"] ?? "");
    const vassal = String(e.data["vassalProvinceId"] ?? "");
    if (!master || !vassal) continue;
    if (!ctx.activeTributes.has(`${master}|${vassal}`)) continue;
    const yearsUnder = w.year - e.year;
    if (yearsUnder < 8) continue;
    const vassalTitle = titleByProv.get(vassal);
    const vassalHolder = w.char(vassalTitle?.holderId ?? null);
    if (!vassalHolder) continue;
    const comp = ctx.composition.get(vassal)!;
    if (comp.martial < 2) continue;
    const drive = vassalHolder.drives.vengeance + vassalHolder.drives.ambition;
    if (drive < 1.0) continue;
    const p = Math.min(0.35, 0.05 + yearsUnder * 0.01 + comp.martial * 0.03);
    if (!w.rng.chance(p)) continue;
    w.log("VASSAL_REBELS", {
      actorId: vassalHolder.id,
      targetId: e.actorId,
      provinceId: vassal,
      data: {
        masterProvinceId: master,
        vassalProvinceId: vassal,
        yearsUnder,
        martial: comp.martial,
      },
    });
    return;
  }
}

// MARKET_MONOPOLY — one province is endpoint of 3+ active trade routes; it
// becomes the dominant hub of its cluster. Fires once per province.
function checkMarketMonopoly(w: World, ctx: EmergenceContext): void {
  const alreadyNamed = new Set(
    w.events.filter((e) => e.type === "MARKET_MONOPOLY").map((e) => e.provinceId),
  );
  for (const [pid, count] of ctx.routeCounts) {
    if (count < 3 || alreadyNamed.has(pid)) continue;
    if (!w.rng.chance(0.35)) continue;
    w.log("MARKET_MONOPOLY", {
      provinceId: pid,
      data: { routes: count, province: w.province(pid)?.name ?? pid },
    });
    return;
  }
}

// ---------------------------------------------------------------------------
// Class-composition driven layer
// ---------------------------------------------------------------------------

// SCHOLAR_FLOURISH — a province accumulates 3+ living scholars. Fires once
// per province per century.
function checkScholarFlourish(w: World, ctx: EmergenceContext): void {
  for (const p of w.provinces.values()) {
    const comp = ctx.composition.get(p.id)!;
    if (comp.scholars < 3) continue;
    const recent = w.events.some(
      (e) => e.type === "SCHOLAR_FLOURISH" && e.provinceId === p.id && w.year - e.year < 100,
    );
    if (recent) continue;
    if (!w.rng.chance(0.4)) continue;
    w.log("SCHOLAR_FLOURISH", {
      provinceId: p.id,
      data: { scholars: comp.scholars, adults: comp.adults },
    });
    return;
  }
}

// LIBRARY_FOUNDED — a wealthy title-holder in a scholar-heavy province funds
// a lasting institution. Requires an active SCHOLAR_FLOURISH.
function checkLibraryFounded(w: World, _ctx: EmergenceContext): void {
  const flourishing = new Set<string>();
  const alreadyFounded = new Set<string>();
  for (let i = w.events.length - 1; i >= 0; i--) {
    const e = w.events[i];
    if (e.type === "SCHOLAR_FLOURISH" && e.provinceId && w.year - e.year < 60) {
      flourishing.add(e.provinceId);
    } else if (e.type === "LIBRARY_FOUNDED" && e.provinceId) {
      alreadyFounded.add(e.provinceId);
    }
  }
  const titleByProv = new Map<string, typeof w.titles extends Map<string, infer T> ? T : never>();
  for (const t of w.titles.values()) titleByProv.set(t.provinceId, t);
  for (const pid of flourishing) {
    if (alreadyFounded.has(pid)) continue;
    const title = titleByProv.get(pid);
    const holder = w.char(title?.holderId ?? null);
    const dyn = w.dynasty(holder?.dynastyId ?? "");
    if (!holder || !dyn || dyn.wealth < 400) continue;
    if (!w.rng.chance(0.2)) continue;
    w.log("LIBRARY_FOUNDED", {
      actorId: holder.id,
      titleId: title?.id ?? null,
      provinceId: pid,
      data: { house: dyn.name, wealth: dyn.wealth },
    });
    return;
  }
}

// LIBRARY_BURNED — a founded library at a province that suffered war or
// blight-locked in the last 2 years.
function checkLibraryBurned(w: World, ctx: EmergenceContext): void {
  // Use the shared recent-shocks index (already includes WAR, BLIGHT_LOCKED,
  // MASS_DEATH). Precompute already-burned (foundedYear) set once.
  const burnedYears = new Set<string>(); // key = `${pid}|${foundedYear}`
  const foundedLibs: WorldEvent[] = [];
  for (const e of w.events) {
    if (e.type === "LIBRARY_BURNED") {
      burnedYears.add(`${e.provinceId}|${e.data["foundedInYear"] ?? -1}`);
    } else if (e.type === "LIBRARY_FOUNDED" && e.provinceId) {
      foundedLibs.push(e);
    }
  }
  for (const e of foundedLibs) {
    if (!e.provinceId) continue;
    if (!ctx.recentShocks.has(e.provinceId)) continue;
    if (burnedYears.has(`${e.provinceId}|${e.year}`)) continue;
    if (!w.rng.chance(0.4)) continue;
    w.log("LIBRARY_BURNED", {
      provinceId: e.provinceId,
      data: { house: e.data["house"], foundedInYear: e.year },
    });
    return;
  }
}

// MARTIAL_DECADENCE — a wealthy title-holder's province has no soldier/knight,
// no war for 30+ years, and merchants+scholars dominate. Fires once per
// province per 60 years.
function checkMartialDecadence(w: World, ctx: EmergenceContext): void {
  // Single walk to build war-in-30y and recent-MARTIAL_DECADENCE indices.
  const recentWar = new Set<string>();
  const recentDecadence = new Set<string>();
  for (let i = w.events.length - 1; i >= 0; i--) {
    const e = w.events[i];
    if (w.year - e.year > 60) break;
    if (e.type === "WAR" && e.provinceId && w.year - e.year < 30) recentWar.add(e.provinceId);
    if (e.type === "MARTIAL_DECADENCE" && e.provinceId && w.year - e.year < 60) recentDecadence.add(e.provinceId);
  }
  const titleByProv = new Map<string, typeof w.titles extends Map<string, infer T> ? T : never>();
  for (const t of w.titles.values()) titleByProv.set(t.provinceId, t);
  for (const p of w.provinces.values()) {
    const comp = ctx.composition.get(p.id)!;
    if (comp.martial > 0) continue;
    if (comp.merchants + comp.scholars < 2) continue;
    if (recentWar.has(p.id)) continue;
    if (recentDecadence.has(p.id)) continue;
    const title = titleByProv.get(p.id);
    const holder = w.char(title?.holderId ?? null);
    const dyn = w.dynasty(holder?.dynastyId ?? "");
    if (!dyn || dyn.wealth < 300) continue;
    if (!w.rng.chance(0.25)) continue;
    w.log("MARTIAL_DECADENCE", {
      provinceId: p.id,
      titleId: title?.id ?? null,
      data: {
        house: dyn.name,
        wealth: dyn.wealth,
        merchants: comp.merchants,
        scholars: comp.scholars,
      },
    });
    return;
  }
}

// MERCANTILE_ASCENDANT — a province where merchants outnumber martial 3:1
// AND the province is coastal/river becomes politically dominated by them.
function checkMercantileAscendant(w: World, ctx: EmergenceContext): void {
  const alreadyNamed = new Set(
    w.events.filter((e) => e.type === "MERCANTILE_ASCENDANT").map((e) => e.provinceId),
  );
  for (const p of w.provinces.values()) {
    if (alreadyNamed.has(p.id)) continue;
    if (!p.coastal && !p.riverConnected) continue;
    const comp = ctx.composition.get(p.id)!;
    if (comp.merchants < 3) continue;
    if (comp.merchants < comp.martial * 3 && comp.martial > 0) continue;
    if (!w.rng.chance(0.3)) continue;
    w.log("MERCANTILE_ASCENDANT", {
      provinceId: p.id,
      data: { merchants: comp.merchants, martial: comp.martial },
    });
    return;
  }
}

// KNOWLEDGE_LOST — a province that once had SCHOLAR_FLOURISH now has no
// scholars for 20+ years. Records a slow decline.
function checkKnowledgeLost(w: World, ctx: EmergenceContext): void {
  const lostYears = new Set<string>();
  const oldFlourishes: WorldEvent[] = [];
  for (const e of w.events) {
    if (e.type === "KNOWLEDGE_LOST") {
      lostYears.add(`${e.provinceId}|${e.data["flourishedInYear"] ?? -1}`);
    } else if (e.type === "SCHOLAR_FLOURISH" && e.provinceId && w.year - e.year >= 40) {
      oldFlourishes.push(e);
    }
  }
  for (const e of oldFlourishes) {
    if (!e.provinceId) continue;
    const comp = ctx.composition.get(e.provinceId);
    if (!comp || comp.scholars > 0) continue;
    if (lostYears.has(`${e.provinceId}|${e.year}`)) continue;
    if (!w.rng.chance(0.15)) continue;
    w.log("KNOWLEDGE_LOST", {
      provinceId: e.provinceId,
      data: { flourishedInYear: e.year, yearsQuiet: w.year - e.year },
    });
    return;
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
