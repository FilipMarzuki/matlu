// innovation.ts — codified craft-secrets with leak dynamics.
//
// Two related mechanics:
//   • INVENTIONS — persistent craft-secrets held by a dynasty (like Dynasty.rite
//     but procedural, category-typed, tier-scaled, and can leak). Each holds a
//     mechanical benefit (military strength, wealth, plague mortality, culture
//     drift rate) that scales with tier. If all bearer dynasties die out, the
//     invention is LOST (Roman concrete pattern) unless it had leaked.
//   • APPRENTICESHIP — Character.mentorId + apprenticeIds. When a master dies,
//     the top apprentice inherits personalWealth + a level bump + any inventions
//     the master's dynasty personally knew. This is the "personal skill can be
//     passed on but only through a named student" mechanism.
//
// This module runs LAST in the tick, after runMagic. It's gated on magicEnabled
// for RNG symmetry — base-sim worlds get zero RNG movement and their golden
// hashes stay byte-identical.
//
// The events themselves (INVENTION_MADE, GUILD_MONOPOLY_CLAIMED, ...) live in
// specs/innovation-events.ts and use the EventSpec catalog. This module holds
// the state-mutating machinery (leak rolls, lost checks, benefit application,
// personal-wealth transfer on death).

import type { DynastyId, Invention, InventionCategory } from "./types.js";
import type { World } from "./world.js";

// Public entry — called from tick.ts once per year, AFTER runMagic.
// No-op when magic is disabled: this preserves base-sim golden hashes byte-
// identical and keeps the base sim free of the personal-wealth economy.
export function runInnovations(w: World): void {
  if (!w.magicEnabled) return;

  // Leak roll — every active invention rolls once per year to spread to a new
  // dynasty. Guild-protected + mercantile cultures roll rarely; loose cultures
  // roll often. The roll only consumes RNG when the probability is > 0.
  rollLeaks(w);

  // Lost check — mark any invention whose bearer chain has extinguished. Doesn't
  // consume RNG; pure structural.
  checkLostInventions(w);
}

// ---------------------------------------------------------------------------
// Leak dynamics — per-year probability roll for every active invention.
// If the roll succeeds, one dynasty outside the current spread set is added.
// The RNG-symmetry guard is important: we only consume RNG if there is
// eligible spread space AND leakProbBase > 0.
// ---------------------------------------------------------------------------
function rollLeaks(w: World): void {
  for (const inv of w.inventions.values()) {
    if (inv.lost) continue;
    if (inv.leakProbBase <= 0) continue;
    // If every living dynasty already knows this invention, no possible spread.
    const eligibleTargets = collectEligibleLeakTargets(w, inv);
    if (eligibleTargets.length === 0) continue;
    if (!w.rng.chance(inv.leakProbBase)) continue;
    const next = eligibleTargets[w.rng.int(0, eligibleTargets.length - 1)];
    inv.spreadTo.push(next);
    inv.secret = false; // any leak breaks secrecy
    w.log("INVENTION_LEAKED", {
      titleId: null,
      provinceId: inv.inventorProvinceId,
      data: { invention: inv.name, category: inv.category, tier: inv.tier, toHouse: next },
    });
  }
}

// Every living dynasty NOT already in the spread set is a potential leak target.
function collectEligibleLeakTargets(w: World, inv: Invention): DynastyId[] {
  const known = new Set<DynastyId>([inv.inventorDynastyId, ...inv.spreadTo]);
  const out: DynastyId[] = [];
  for (const dyn of w.dynasties.values()) {
    if (dyn.extinctYear !== null) continue;
    if (known.has(dyn.id)) continue;
    out.push(dyn.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lost check — pure structural, no RNG. When the bearer chain is empty AND
// the invention was still secret (or spread to a single carrier), fire LOST.
// ---------------------------------------------------------------------------
function checkLostInventions(w: World): void {
  for (const inv of w.inventions.values()) {
    if (inv.lost) continue;
    const bearers = w.livingBearersOf(inv);
    if (bearers.length > 0) continue;
    inv.lost = true;
    inv.lostYear = w.year;
    w.log("INVENTION_LOST", {
      titleId: null,
      provinceId: inv.inventorProvinceId,
      data: { invention: inv.name, category: inv.category, tier: inv.tier },
    });
  }
}

// ---------------------------------------------------------------------------
// Benefit computations — read by other systems (accrueWealth, runPlague,
// resolveWars). Each returns a scalar multiplier or additive delta that the
// caller applies to their own base value.
// ---------------------------------------------------------------------------

// Sum a dynasty's active-invention multipliers for a given category. Tiers stack
// additively so many small techs beat one big one, but the total is capped so
// no dynasty runs away with a 5x wealth boost. Returns a multiplier bonus (add
// this to 1 for a multiplier, so 0.4 means +40% net).
export function inventionBonusFor(
  w: World,
  dynId: DynastyId,
  category: InventionCategory,
): number {
  const TIER_BONUS = [0, 0.1, 0.2, 0.35]; // by tier 1/2/3
  let sum = 0;
  for (const inv of w.inventionsKnownBy(dynId)) {
    if (inv.category === category) sum += TIER_BONUS[inv.tier];
  }
  return Math.min(0.8, sum); // cap at +80% to any single category
}

// Category-specific readers (thin wrappers around inventionBonusFor). Used by
// magic.ts:accrueWealth, phenomena.ts:runPlague, tick.ts:resolveWars, etc.
export function economicBonus(w: World, dynId: DynastyId): number {
  return inventionBonusFor(w, dynId, "textiles")
       + inventionBonusFor(w, dynId, "printing") * 0.5;
}
export function militaryBonus(w: World, dynId: DynastyId): number {
  return inventionBonusFor(w, dynId, "military")
       + inventionBonusFor(w, dynId, "metallurgy") * 0.7;
}
export function plagueResistBonus(w: World, dynId: DynastyId): number {
  return inventionBonusFor(w, dynId, "medicine");
}
export function agriculturalYieldBonus(w: World, dynId: DynastyId): number {
  return inventionBonusFor(w, dynId, "agriculture");
}

// ---------------------------------------------------------------------------
// On-death hook — called from markDead. Transfers a dying character's
// personalWealth + inventions to their top apprentice, or dissipates if none.
// Kept here (not in phenomena.ts) so all innovation logic lives in one module.
// ---------------------------------------------------------------------------
export function transferOnDeath(w: World, deceasedId: string): void {
  if (!w.magicEnabled) return;
  const c = w.characters.get(deceasedId);
  if (!c) return;
  // Clean up mentor link so a surviving apprentice doesn't reference a dead master.
  if (c.mentorId) {
    const master = w.characters.get(c.mentorId);
    if (master) {
      master.apprenticeIds = master.apprenticeIds.filter((a) => a !== c.id);
    }
    c.mentorId = null;
  }
  // If deceased had apprentices, transfer to the eldest LIVING one.
  const heir = c.apprenticeIds
    .map((id) => w.characters.get(id))
    .find((a): a is NonNullable<typeof a> => !!a && a.alive);
  if (heir) {
    heir.personalWealth += c.personalWealth;
    heir.level = Math.min(40, heir.level + 2);
    heir.mentorId = null; // orphaned; master is gone
    // Clean up remaining apprentice links.
    for (const aid of c.apprenticeIds) {
      const a = w.characters.get(aid);
      if (a) a.mentorId = null;
    }
    w.log("APPRENTICE_TAKEN", {
      actorId: heir.id, targetId: c.id, provinceId: heir.provinceId,
      data: { inherited: c.personalWealth, kind: "inheritance" },
    });
  } else {
    // No apprentice — personal wealth dissipates.
    for (const aid of c.apprenticeIds) {
      const a = w.characters.get(aid);
      if (a) a.mentorId = null;
    }
  }
  c.personalWealth = 0;
  c.apprenticeIds = [];
}
