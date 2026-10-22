// ether.ts — the Ether (spirit realm) merging into Mistheim. Phase 1.
//
// Design: docs/ETHER_REALM.md. Opt-in via `--ether` (World.etherEnabled).
//
// The Ether is not a place on the map. It is a layer over Mistheim's
// provinces, measured by one number each: the VEIL (1 = sealed, 0 = open).
// This pass runs once a year, at the end of the tick, and does four things:
//
//   1. CONVERGENCE — some years in, the Ether begins to merge (once per world).
//      Nothing below happens before it.
//   2. VEIL — death wears the veil thin where it happens (violent death most of
//      all); a seat held by one house for generations thins it slowly; peace
//      lets it drift back toward a resting level. A spirit moving on thickens it.
//   3. LINGER OR MOVE ON — every death since last year is checked. Most of the
//      dead move on and are gone for good. A spirit lingers only when an
//      ANCHOR holds it (an unavenged murder, a grudge, the end of a house, a
//      violent death in a thin place), and even then only by chance, scaled by
//      how thin the veil is where they died.
//   4. RESOLUTION — when a lingering spirit's anchor resolves (the killer dies,
//      the grudge target dies, peace returns to the battlefield) it moves on.
//      Its `movedOnYear` is set and never cleared: it can never come back.
//
// RNG symmetry: runEther returns at once when the flag is off, and markDead
// only records deaths when it is on, so the base sim draws no extra random
// numbers and logs no extra events. Golden hashes stay put.

import type { PendingDeath } from "./ether-state.js";
import type { CharId, Character, ProvinceId, SpiritAnchor } from "./types.js";
import type { World } from "./world.js";

// Below this veil a province is a "thin place" (docs/ETHER_REALM.md §3.1).
export const ETHER_THIN = 0.35;

// --- Convergence ---------------------------------------------------------
const CONVERGENCE_DELAY = 15;     // years after the run starts before it can happen
const CONVERGENCE_CHANCE = 0.04;  // per year after that (≈ certain within 150 years)
const CONVERGENCE_VEIL = 0.85;    // every veil drops to at most this when it happens

// --- Veil dynamics (applied yearly after convergence) ----------------------
const REST_VEIL = 0.8;            // where an untroubled province drifts back to
const RECOVERY_RATE = 0.03;       // fraction of the gap to REST_VEIL closed per year
const THIN_VIOLENT = 0.025;       // per violent death in the province
const THIN_RULER_MURDERED = 0.05; // extra when the murdered held a title
const THIN_RULER_SLAIN = 0.03;    // extra when a ruler dies violently otherwise
const THIN_MASS = 0.01;           // per death in plague, famine, catastrophe…
const THIN_NATURAL = 0.003;       // per death of old age or illness
const LONG_SEAT_YEARS = 80;       // one house holding a seat this long…
const THIN_LONG_SEAT = 0.004;     // …thins its veil this much per year
const THICKEN_MOVED_ON = 0.04;    // a spirit moving on closes the veil a little
const VEIL_FLOOR = 0.05;

// --- Lingering ---------------------------------------------------------------
// Chance an anchored spirit lingers when the veil is fully at the thin-place
// threshold or below. Above it, the chance shrinks with the veil's openness.
// Tuned so a 200-year run has a handful of lingering spirits, not dozens:
// murders are common in Mistheim, and most murdered dead still move on.
const LINGER_BASE: Record<SpiritAnchor, number> = {
  unavenged_murder: 0.08,
  last_of_house: 0.4,
  battlefield: 0.1,
  grudge: 0.08,
};
const BATTLEFIELD_PEACE_YEARS = 25; // years without violent death before a battlefield host rests

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// Death causes, as written by every markDead call site (phenomena.ts).
function isViolent(cause: string): boolean {
  return (
    cause === "murder" ||
    cause === "killed in war" ||
    cause === "killed at the fall of the city" ||
    cause === "undead_raid" ||
    cause.startsWith("slain")
  );
}
function isNatural(cause: string): boolean {
  return cause === "old age" || cause === "illness";
}

export function runEther(w: World): void {
  if (!w.etherEnabled) return;
  const st = w.ether;
  if (st.firstYear === null) st.firstYear = w.year;

  const deaths = st.pendingDeaths;
  st.pendingDeaths = [];
  for (const d of deaths) {
    const c = w.char(d.charId);
    if (!c) continue;
    st.deathCounts.set(c.provinceId, (st.deathCounts.get(c.provinceId) ?? 0) + 1);
    if (isViolent(c.causeOfDeath ?? "")) st.lastViolentYear.set(c.provinceId, w.year);
  }
  // Seats are tracked from the start, so a house that ruled for a century
  // before the convergence already counts as an old seat when it comes.
  updateSeats(w);

  if (st.convergedYear === null) {
    maybeConverge(w);
    return; // the year of convergence itself is quiet: nothing lingers yet
  }

  thinVeils(w, deaths);
  resolveSpirits(w);
  const killers = murdersThisYear(w);
  for (const d of deaths) considerLinger(w, d, killers);
  recognizeThinPlaces(w);
}

// ---------------------------------------------------------------------------
// 1. Convergence
// ---------------------------------------------------------------------------
function maybeConverge(w: World): void {
  const st = w.ether;
  if (w.year - (st.firstYear ?? w.year) < CONVERGENCE_DELAY) return;
  if (!w.rng.chance(CONVERGENCE_CHANCE)) return;

  st.convergedYear = w.year;
  for (const p of w.provinces.values()) p.veil = Math.min(p.veil, CONVERGENCE_VEIL);

  // It is felt first where the most have died.
  let where: ProvinceId | null = null;
  let most = -1;
  for (const p of w.provinces.values()) {
    const n = st.deathCounts.get(p.id) ?? 0;
    if (n > most) { most = n; where = p.id; }
  }
  w.log("ETHER_CONVERGENCE", { provinceId: where, data: { dead: most } });
}

// ---------------------------------------------------------------------------
// 2. Veil
// ---------------------------------------------------------------------------
function updateSeats(w: World): void {
  const seats = w.ether.seatHeld;
  for (const p of w.provinces.values()) {
    const holder = w.char(w.title(p.titleId)?.holderId ?? null);
    if (!holder) { seats.delete(p.id); continue; }
    const cur = seats.get(p.id);
    if (!cur || cur.dynastyId !== holder.dynastyId) {
      seats.set(p.id, { dynastyId: holder.dynastyId, since: w.year });
    }
  }
}

function thinVeils(w: World, deaths: PendingDeath[]): void {
  // Drift back toward rest, and wear down long-held seats.
  for (const p of w.provinces.values()) {
    p.veil += (REST_VEIL - p.veil) * RECOVERY_RATE;
    const seat = w.ether.seatHeld.get(p.id);
    if (seat && w.year - seat.since >= LONG_SEAT_YEARS) p.veil -= THIN_LONG_SEAT;
  }
  // This year's dead.
  for (const d of deaths) {
    const c = w.char(d.charId);
    const p = c ? w.province(c.provinceId) : undefined;
    if (!c || !p) continue;
    const cause = c.causeOfDeath ?? "";
    if (isViolent(cause)) {
      p.veil -= THIN_VIOLENT;
      if (d.wasRuler) p.veil -= cause === "murder" ? THIN_RULER_MURDERED : THIN_RULER_SLAIN;
    } else if (isNatural(cause)) {
      p.veil -= THIN_NATURAL;
    } else {
      p.veil -= THIN_MASS;
    }
  }
  for (const p of w.provinces.values()) p.veil = Math.max(VEIL_FLOOR, Math.min(1, p.veil));
}

// Logged once per province, the first time it falls below the threshold.
function recognizeThinPlaces(w: World): void {
  for (const p of w.provinces.values()) {
    if (p.veil >= ETHER_THIN || w.ether.thinPlaces.has(p.id)) continue;
    w.ether.thinPlaces.add(p.id);
    w.log("THIN_PLACE_RECOGNIZED", { provinceId: p.id, data: { veil: Math.round(p.veil * 100) / 100 } });
  }
}

// ---------------------------------------------------------------------------
// 3. Linger or move on
// ---------------------------------------------------------------------------

// victim → killer for this year's successful murders. markDead runs before
// the MURDER event is logged, so the killer isn't known at the moment of death;
// by the end of the tick it is.
function murdersThisYear(w: World): Map<CharId, CharId> {
  const out = new Map<CharId, CharId>();
  for (let i = w.events.length - 1; i >= 0; i--) {
    const e = w.events[i];
    if (e.year !== w.year) break;
    if (e.type === "MURDER" && e.targetId && e.actorId) out.set(e.targetId, e.actorId);
  }
  return out;
}

// What, if anything, holds this spirit here. Strongest anchor wins.
function findAnchor(
  w: World,
  c: Character,
  d: PendingDeath,
  killers: Map<CharId, CharId>,
): { anchor: SpiritAnchor; targetId: CharId | null } | null {
  const killerId = killers.get(c.id);
  if (killerId && w.char(killerId)?.alive) return { anchor: "unavenged_murder", targetId: killerId };

  // Most recent grudge against someone still living.
  for (let i = c.grudges.length - 1; i >= 0; i--) {
    const g = c.grudges[i];
    if (w.char(g.targetId)?.alive) return { anchor: "grudge", targetId: g.targetId };
  }

  // Only a house that ruled leaves a ghost in its hall.
  if (d.wasRuler && w.dynastyMembers(c.dynastyId).length === 0) {
    return { anchor: "last_of_house", targetId: null };
  }

  const p = w.province(c.provinceId);
  if (p && p.veil < ETHER_THIN && isViolent(c.causeOfDeath ?? "")) {
    return { anchor: "battlefield", targetId: null };
  }
  return null;
}

function considerLinger(w: World, d: PendingDeath, killers: Map<CharId, CharId>): void {
  const c = w.char(d.charId);
  const p = c ? w.province(c.provinceId) : undefined;
  if (!c || !p || c.spirit) return;

  const found = findAnchor(w, c, d, killers);
  if (!found) return; // no anchor: they move on, and nothing is recorded

  // A sealed veil holds even the murdered back from lingering; a thin one
  // doesn't. Squared, so a province at the resting veil (0.8) is ~10% open and
  // only a real thin place is fully open.
  const openness = clamp01((1 - p.veil) / (1 - ETHER_THIN)) ** 2;
  if (!w.rng.chance(LINGER_BASE[found.anchor] * openness)) return;

  c.spirit = {
    anchor: found.anchor,
    anchorTargetId: found.targetId,
    provinceId: p.id,
    sinceYear: w.year,
    movedOnYear: null,
  };
  w.ether.lingering.push(c.id);
  w.log("SPIRIT_LINGERS", {
    actorId: c.id,
    targetId: found.targetId,
    provinceId: p.id,
    data: { anchor: found.anchor, house: w.dynasty(c.dynastyId)?.name ?? "" },
  });
}

// ---------------------------------------------------------------------------
// 4. Resolution
// ---------------------------------------------------------------------------
function anchorResolved(w: World, c: Character): boolean {
  const s = c.spirit!;
  switch (s.anchor) {
    case "unavenged_murder":
    case "grudge":
      return !w.char(s.anchorTargetId)?.alive;
    case "battlefield":
      return w.year - (w.ether.lastViolentYear.get(s.provinceId) ?? s.sinceYear) >= BATTLEFIELD_PEACE_YEARS;
    case "last_of_house":
      // Phase 1 has no way to restore a fallen house. These spirits stay —
      // later phases give them a resolution (or turn them into wraiths).
      return false;
  }
}

function resolveSpirits(w: World): void {
  const still: CharId[] = [];
  for (const id of w.ether.lingering) {
    const c = w.char(id);
    if (!c?.spirit || c.spirit.movedOnYear !== null) continue;
    if (!anchorResolved(w, c)) { still.push(id); continue; }

    const s = c.spirit;
    s.movedOnYear = w.year;
    const p = w.province(s.provinceId);
    if (p) p.veil = Math.min(1, p.veil + THICKEN_MOVED_ON);
    w.log("SPIRIT_MOVES_ON", {
      actorId: c.id,
      targetId: s.anchorTargetId,
      provinceId: s.provinceId,
      data: { anchor: s.anchor, years: w.year - s.sinceYear },
    });
  }
  w.ether.lingering = still;
}
