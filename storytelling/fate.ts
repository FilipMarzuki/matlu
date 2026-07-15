// fate.ts — the prophecy, doom, and legend layer.
//
// This is where the sim starts producing Iliad-shape stories rather than just
// Bede-shape chronicles. Base + emergence + challenges give you named deeds;
// this layer binds those deeds to FATE.
//
// Three sub-systems, all magic-gated, all event-log-native (no new state
// fields on Character or Dynasty — the log is the state, queried via per-tick
// indices for perf).
//
// PROPHECY
//   A distortion-holder, high-piety zealot, or doctrinal figure utters a
//   specific prediction about another character's death. The prediction is
//   drawn from a fixed vocabulary (die_by_kin, die_by_fire, die_in_battle,
//   die_of_slay, line_extinct). Every tick after the target dies (or their
//   dynasty extinguishes) we check whether the prediction matched — logging
//   PROPHECY_FULFILLED (dramatic irony) or PROPHECY_DEFIED (unexpected
//   subversion). Both flavours are chronicle gold.
//
// DOOM
//   When a MURDER happens, a surviving kin of the victim may curse the killer
//   with a doom. The doom sits on the killer for the rest of their life. If
//   they die violently within it, DOOM_FULFILLED — the wronged blood was
//   answered. The mere existence of a doom also raises the significance of
//   every event the doomed touches, so the reader feels the shadow hanging
//   over them (implemented in sifter.ts, not here).
//
// LEGEND
//   When a great figure dies (level 20+, or multiple trial skills, or a long
//   reign, or has slain a tier-4+ challenge), their deeds are inscribed into
//   cultural memory — LEGEND_INSCRIBED with the deed tags. Later characters
//   of the same culture with high piety may INVOKE the legend, taking a
//   psyche shift (honor_bound += ~0.08). This is how a hero's story keeps
//   shaping the world after they're gone — the exact texture missing from
//   pre-fate emergence.

import type { Character, WorldEvent } from "./types.js";
import type { World } from "./world.js";

const PREDICTION_TYPES = [
  "die_by_kin",       // MURDER by a fellow dynasty member
  "die_by_fire",      // ERUPTION / ASH_SUMMER / BLIGHT_LOCKED / MASS_DEATH at their province
  "die_in_battle",    // killed in WAR
  "die_of_slay",      // CHALLENGE_SLAYS_CHALLENGER
  "line_extinct",     // dynasty extinct within 60y of the prophecy
] as const;
type PredictionType = typeof PREDICTION_TYPES[number];

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export function runFate(w: World): void {
  if (!w.magicEnabled) return;
  const ctx = buildFateContext(w);
  checkProphecyUttered(w, ctx);
  checkProphecyResolved(w, ctx);
  checkDoomLaid(w, ctx);
  checkDoomFulfilled(w, ctx);
  checkLegendInscribed(w, ctx);
  checkLegendInvoked(w, ctx);
}

// ---------------------------------------------------------------------------
// Per-tick indices (built once, read O(1) per check)
// ---------------------------------------------------------------------------

interface FateContext {
  activeProphecies: Map<string, WorldEvent[]>; // targetId -> unresolved PROPHECY_UTTERED events
  resolvedProphecyIds: Set<number>;            // event ids that already produced FULFILLED/DEFIED
  activeDooms:      Map<string, WorldEvent[]>; // cursedId -> unresolved DOOM_LAID events
  fulfilledDoomIds: Set<number>;               // DOOM_LAID ids that already produced FULFILLED
  legends:          WorldEvent[];              // all LEGEND_INSCRIBED
  lastInvokedYear:  Map<number, number>;       // LEGEND event id -> last invocation year
  recentDeaths:     WorldEvent[];              // this year's DEATH events
  recentMurders:    WorldEvent[];              // this year's MURDER events
}

function buildFateContext(w: World): FateContext {
  const activeProphecies = new Map<string, WorldEvent[]>();
  const resolvedProphecyIds = new Set<number>();
  const activeDooms = new Map<string, WorldEvent[]>();
  const fulfilledDoomIds = new Set<number>();
  const legends: WorldEvent[] = [];
  const lastInvokedYear = new Map<number, number>();
  const recentDeaths: WorldEvent[] = [];
  const recentMurders: WorldEvent[] = [];

  for (const e of w.events) {
    switch (e.type) {
      case "PROPHECY_UTTERED": {
        const tgt = String(e.data["targetId"] ?? "");
        if (!tgt) break;
        const arr = activeProphecies.get(tgt) ?? [];
        arr.push(e);
        activeProphecies.set(tgt, arr);
        break;
      }
      case "PROPHECY_FULFILLED":
      case "PROPHECY_DEFIED":
        resolvedProphecyIds.add(Number(e.data["prophecyEventId"] ?? -1));
        break;
      case "DOOM_LAID": {
        const cursed = String(e.data["cursedId"] ?? "");
        if (!cursed) break;
        const arr = activeDooms.get(cursed) ?? [];
        arr.push(e);
        activeDooms.set(cursed, arr);
        break;
      }
      case "DOOM_FULFILLED":
        fulfilledDoomIds.add(Number(e.data["doomEventId"] ?? -1));
        break;
      case "LEGEND_INSCRIBED":
        legends.push(e);
        break;
      case "LEGEND_INVOKED":
        lastInvokedYear.set(Number(e.data["legendEventId"] ?? -1), e.year);
        break;
      case "DEATH":
        if (e.year === w.year) recentDeaths.push(e);
        break;
      case "MURDER":
        if (e.year === w.year) recentMurders.push(e);
        break;
    }
  }
  // Prune resolved prophecies/dooms from the active maps so downstream loops
  // only see live ones.
  for (const [tgt, arr] of activeProphecies) {
    const live = arr.filter((p) => !resolvedProphecyIds.has(p.id));
    if (live.length) activeProphecies.set(tgt, live);
    else activeProphecies.delete(tgt);
  }
  for (const [cursed, arr] of activeDooms) {
    const live = arr.filter((d) => !fulfilledDoomIds.has(d.id));
    if (live.length) activeDooms.set(cursed, live);
    else activeDooms.delete(cursed);
  }
  return {
    activeProphecies, resolvedProphecyIds, activeDooms, fulfilledDoomIds,
    legends, lastInvokedYear, recentDeaths, recentMurders,
  };
}

// ---------------------------------------------------------------------------
// PROPHECY
// ---------------------------------------------------------------------------

// A rare per-tick check: a fitting prophet exists, a fitting target exists,
// they cross paths. Rate is intentionally low — prophecy is a hinge moment,
// not weekly weather.
function checkProphecyUttered(w: World, _ctx: FateContext): void {
  // Only one prophecy uttered per tick, world-wide. Keeps the log legible.
  const prophets = w.living().filter((c) => {
    if (w.age(c) < 24) return false;
    if (c.psyche.distortion === "zealot") return true;
    if (c.psyche.biases.doctrinal > 0.75) return true;
    if (c.drives.piety > 0.85 && c.psyche.biases.providential > 0.5) return true;
    return false;
  });
  if (prophets.length === 0) return;
  if (!w.rng.chance(0.05)) return; // ~1-in-20 chance a fitting prophet speaks up

  // Target: prefer a young royal heir (adds tragic weight) or a HERO_RISEN.
  const rulers = new Set<string>();
  for (const t of w.titles.values()) if (t.holderId) rulers.add(t.holderId);
  const heirCandidates = w.living().filter((c) => {
    if (w.age(c) < 10 || w.age(c) > 30) return false;
    if (rulers.has(c.id)) return false;
    // Their father or mother rules something
    const dad = w.char(c.fatherId);
    const mum = w.char(c.motherId);
    return (dad && rulers.has(dad.id)) || (mum && rulers.has(mum.id));
  });
  const heroCandidates = w.living().filter((c) => c.level >= 10 && c.lowborn);
  const pool = heirCandidates.length > 0 ? heirCandidates : heroCandidates;
  if (pool.length === 0) return;

  const target = w.rng.pick(pool);
  const prophet = w.rng.pick(prophets);
  if (prophet.id === target.id) return; // no self-prophecy

  const predType = pickPrediction(w, target);
  w.log("PROPHECY_UTTERED", {
    actorId: prophet.id,
    targetId: target.id,
    provinceId: prophet.provinceId,
    data: {
      targetId: target.id,           // duplicated for the index-builder
      predictionType: predType,
      prophetHouse: w.dynasty(prophet.dynastyId)?.name ?? "",
      targetHouse: w.dynasty(target.dynastyId)?.name ?? "",
    },
  });
}

function pickPrediction(w: World, target: Character): PredictionType {
  // Tilt the vocabulary toward things that could actually happen in the sim,
  // given the target's context — a landlocked heir isn't going to fall in
  // battle at sea, but they might well be kinslain.
  const opts: PredictionType[] = ["die_by_kin", "line_extinct"];
  const prov = w.province(target.provinceId);
  if (prov?.terrain === "mountain" || (prov?.manaDensity ?? 0) > 0.5) opts.push("die_by_fire");
  // Anyone can die in war or by a challenge in a magic world
  opts.push("die_in_battle", "die_of_slay");
  return w.rng.pick(opts);
}

// Walk this year's deaths & each active prophecy on the deceased. Match
// prediction → cause → fulfilled/defied. If a prophecy's TARGET is dead but
// no direct match, log DEFIED (the target died in an unremarkable way,
// mocking the prophet). For LINE_EXTINCT, wait for the dynasty extinction.
function checkProphecyResolved(w: World, ctx: FateContext): void {
  for (const death of ctx.recentDeaths) {
    const target = death.actorId ? String(death.actorId) : "";
    if (!target) continue;
    const proph = ctx.activeProphecies.get(target);
    if (!proph) continue;
    for (const p of proph) {
      const predType = String(p.data["predictionType"] ?? "");
      if (predType === "line_extinct") continue; // handled separately
      const cause = String(death.data["cause"] ?? "");
      const matched = matchDeath(predType as PredictionType, cause, ctx.recentMurders, target);
      w.log(matched ? "PROPHECY_FULFILLED" : "PROPHECY_DEFIED", {
        actorId: p.actorId,       // the original prophet
        targetId: target,
        provinceId: death.provinceId,
        data: {
          prophecyEventId: p.id,
          predictionType: predType,
          cause,
          yearsToOutcome: w.year - p.year,
        },
      });
    }
    ctx.activeProphecies.delete(target);
  }
  // LINE_EXTINCT resolution — walk this year's DYNASTY_EXTINCT.
  for (const e of w.events) {
    if (e.type !== "DYNASTY_EXTINCT" || e.year !== w.year) continue;
    const house = String(e.data["house"] ?? "");
    if (!house) continue;
    // For every active prophecy with predictionType=line_extinct on a member
    // of that house, resolve as fulfilled.
    for (const [tgtId, proph] of ctx.activeProphecies) {
      const tgt = w.char(tgtId);
      const tgtHouse = w.dynasty(tgt?.dynastyId ?? "")?.name;
      if (tgtHouse !== house) continue;
      for (const p of proph) {
        if (p.data["predictionType"] !== "line_extinct") continue;
        w.log("PROPHECY_FULFILLED", {
          actorId: p.actorId,
          targetId: tgtId,
          data: {
            prophecyEventId: p.id,
            predictionType: "line_extinct",
            yearsToOutcome: w.year - p.year,
            house,
          },
        });
      }
    }
  }
  // Defiance-by-old-age: unresolved prophecies older than 60 years whose
  // target is still alive and past age 60 = the prediction failed.
  for (const [tgtId, proph] of ctx.activeProphecies) {
    const tgt = w.char(tgtId);
    if (!tgt || !tgt.alive) continue;
    if (w.age(tgt) < 60) continue;
    for (const p of proph) {
      if (p.data["predictionType"] === "line_extinct") continue; // still open
      if (w.year - p.year < 40) continue;
      w.log("PROPHECY_DEFIED", {
        actorId: p.actorId,
        targetId: tgtId,
        data: {
          prophecyEventId: p.id,
          predictionType: p.data["predictionType"],
          yearsToOutcome: w.year - p.year,
          reason: "outlived",
        },
      });
    }
  }
}

function matchDeath(pred: PredictionType, cause: string, murders: WorldEvent[], target: string): boolean {
  switch (pred) {
    case "die_in_battle":
      return cause === "killed in war";
    case "die_of_slay":
      return cause.startsWith("slain by") && !cause.includes("adventuring");
    case "die_by_fire":
      return cause === "eruption" || cause === "drought" || cause === "feral_surge";
    case "die_by_kin": {
      const murder = murders.find((m) => m.targetId === target);
      if (!murder) return false;
      // Simple heuristic: renderer/sifter can enrich this. Here we accept any
      // MURDER as "kin-adjacent" in the loose Homeric sense unless obviously not.
      return cause === "murder";
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// DOOM
// ---------------------------------------------------------------------------

// After a MURDER this year, a living spouse/child/sibling of the victim may
// call a doom down on the killer. One per murder max.
function checkDoomLaid(w: World, ctx: FateContext): void {
  for (const murder of ctx.recentMurders) {
    const killer = w.char(murder.actorId);
    const victim = w.char(murder.targetId);
    if (!killer || !victim) continue;
    // Already doomed by this murder?
    const already = w.events.some(
      (e) => e.type === "DOOM_LAID" && e.data["fromMurderEventId"] === murder.id,
    );
    if (already) continue;
    // Find a living kin curser — must not be the killer themselves (guards
    // against kinslaying cases where the killer IS a spouse/parent/child of
    // the victim).
    const kin = pickCurser(w, victim, killer.id);
    if (!kin) continue;
    // Kin willingness — high vengeance, honor_bound, or grief_locked bias.
    const willingness =
      kin.drives.vengeance * 0.5 +
      kin.psyche.biases.honor_bound * 0.3 +
      kin.psyche.biases.grief_locked * 0.4;
    if (willingness < 0.4) continue;
    if (!w.rng.chance(0.5)) continue;
    w.log("DOOM_LAID", {
      actorId: kin.id,
      targetId: killer.id,
      provinceId: kin.provinceId,
      data: {
        cursedId: killer.id,
        fromMurderEventId: murder.id,
        victimHouse: w.dynasty(victim.dynastyId)?.name ?? "",
        killerHouse: w.dynasty(killer.dynastyId)?.name ?? "",
        cursorHouse: w.dynasty(kin.dynastyId)?.name ?? "",
      },
    });
  }
}

function pickCurser(w: World, victim: Character, killerId: string): Character | null {
  const kin: Character[] = [];
  const spouse = w.char(victim.spouseId);
  if (spouse?.alive && spouse.id !== killerId) kin.push(spouse);
  for (const cid of victim.childrenIds) {
    const c = w.char(cid);
    if (c?.alive && w.age(c) >= 12 && c.id !== killerId) kin.push(c);
  }
  const father = w.char(victim.fatherId);
  if (father?.alive && father.id !== killerId) kin.push(father);
  const mother = w.char(victim.motherId);
  if (mother?.alive && mother.id !== killerId) kin.push(mother);
  if (kin.length === 0) return null;
  // Prefer highest vengeance drive.
  kin.sort((a, b) => b.drives.vengeance - a.drives.vengeance);
  return kin[0];
}

// If a doomed character dies violently, log DOOM_FULFILLED.
function checkDoomFulfilled(w: World, ctx: FateContext): void {
  for (const death of ctx.recentDeaths) {
    const target = String(death.actorId ?? "");
    if (!target) continue;
    const dooms = ctx.activeDooms.get(target);
    if (!dooms) continue;
    const cause = String(death.data["cause"] ?? "");
    const violent = cause === "murder" || cause === "killed in war" ||
                    cause.startsWith("slain by");
    if (!violent) continue;
    for (const d of dooms) {
      w.log("DOOM_FULFILLED", {
        actorId: d.actorId,        // original curser (may be dead — that's the tragedy)
        targetId: target,
        provinceId: death.provinceId,
        data: {
          doomEventId: d.id,
          cause,
          yearsToOutcome: w.year - d.year,
        },
      });
    }
    ctx.activeDooms.delete(target);
  }
}

// ---------------------------------------------------------------------------
// LEGEND
// ---------------------------------------------------------------------------

// When a great figure dies with meaningful signature deeds, inscribe them.
function checkLegendInscribed(w: World, ctx: FateContext): void {
  for (const death of ctx.recentDeaths) {
    const c = w.char(death.actorId);
    if (!c) continue;
    // Avoid double-inscription.
    if (w.events.some((e) => e.type === "LEGEND_INSCRIBED" && e.actorId === c.id)) continue;
    const deeds = qualifyingDeeds(w, c);
    if (deeds.length === 0) continue;
    // Age gate: a hero cut down at 22 is a saga, but for LEGEND we want
    // someone who lived long enough to be remembered. Except if they slew
    // something tier 4+ — that's story regardless.
    const bigSlay = deeds.some((d) => d.startsWith("challenge_tier"));
    if (w.age(c) < 35 && !bigSlay) continue;
    w.log("LEGEND_INSCRIBED", {
      actorId: c.id,
      provinceId: death.provinceId,
      data: {
        figure: c.name,
        house: w.dynasty(c.dynastyId)?.name ?? "",
        culture: w.dynasty(c.dynastyId)?.cultureId ?? "",
        level: c.level,
        deeds: deeds.join(","),
        diedAge: w.age(c),
      },
    });
  }
}

function qualifyingDeeds(w: World, c: Character): string[] {
  const deeds: string[] = [];
  if (c.level >= 20) deeds.push(`level_${c.level}`);
  if (c.skills && c.skills.length >= 2) deeds.push(`skills_${c.skills.length}`);
  // Slew a tier-4+ challenge?
  for (const e of w.events) {
    if (e.type !== "CHALLENGE_VANQUISHED" || e.actorId !== c.id) continue;
    const tier = Number(e.data["tier"] ?? 0);
    if (tier >= 4) deeds.push(`challenge_tier_${tier}`);
  }
  // Long reign — 20+ years as a titled ruler?
  let firstReignYear = Infinity, lastReignYear = -Infinity;
  for (const e of w.events) {
    if (e.type !== "SUCCESSION" || e.actorId !== c.id) continue;
    firstReignYear = Math.min(firstReignYear, e.year);
    lastReignYear = w.year;
  }
  if (Number.isFinite(firstReignYear) && lastReignYear - firstReignYear >= 20) {
    deeds.push(`reign_${lastReignYear - firstReignYear}y`);
  }
  return deeds;
}

// A high-piety character in the same culture, 50+ years after inscription,
// invokes the legend and takes an honor_bound psyche shift. Rare — once per
// legend per century.
function checkLegendInvoked(w: World, ctx: FateContext): void {
  if (ctx.legends.length === 0) return;
  if (!w.rng.chance(0.05)) return; // rare hinge
  for (const legend of ctx.legends) {
    if (w.year - legend.year < 50) continue;
    const last = ctx.lastInvokedYear.get(legend.id) ?? -Infinity;
    if (w.year - last < 100) continue;
    const culture = String(legend.data["culture"] ?? "");
    if (!culture) continue;
    const candidates = w.living().filter((c) => {
      if (w.age(c) < 20) return false;
      if (c.drives.piety < 0.6) return false;
      if (w.dynasty(c.dynastyId)?.cultureId !== culture) return false;
      // Don't invoke your own dynasty's legend as name-drop — too on the nose
      const legendChar = w.char(legend.actorId);
      if (legendChar && c.dynastyId === legendChar.dynastyId) return false;
      return true;
    });
    if (candidates.length === 0) continue;
    const invoker = w.rng.pick(candidates);
    invoker.psyche.biases.honor_bound = Math.min(1, invoker.psyche.biases.honor_bound + 0.08);
    w.log("LEGEND_INVOKED", {
      actorId: invoker.id,
      provinceId: invoker.provinceId,
      data: {
        legendEventId: legend.id,
        legendFigure: String(legend.data["figure"] ?? ""),
        legendHouse: String(legend.data["house"] ?? ""),
        yearsSinceInscription: w.year - legend.year,
      },
    });
    return; // one invocation per year
  }
}

// Exported for tests / external inspection.
export function summariseFate(w: World): Record<string, number> {
  const out: Record<string, number> = {
    prophecies_uttered: 0, prophecies_fulfilled: 0, prophecies_defied: 0,
    dooms_laid: 0, dooms_fulfilled: 0,
    legends_inscribed: 0, legends_invoked: 0,
  };
  for (const e of w.events) {
    switch (e.type) {
      case "PROPHECY_UTTERED":   out.prophecies_uttered++; break;
      case "PROPHECY_FULFILLED": out.prophecies_fulfilled++; break;
      case "PROPHECY_DEFIED":    out.prophecies_defied++; break;
      case "DOOM_LAID":          out.dooms_laid++; break;
      case "DOOM_FULFILLED":     out.dooms_fulfilled++; break;
      case "LEGEND_INSCRIBED":   out.legends_inscribed++; break;
      case "LEGEND_INVOKED":     out.legends_invoked++; break;
    }
  }
  return out;
}
