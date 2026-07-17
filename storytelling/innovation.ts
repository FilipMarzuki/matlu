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

import type { CharClass, Character, DynastyId, Guild, Invention, InventionCategory } from "./types.js";
import type { World } from "./world.js";

// Rare classes get a stronger synergy curve than common classes — a house of
// three necromancers is much more than 3x one necromancer. Common classes get
// modest linear-plus curves that reward specialization without runaway scaling.
const RARE_CLASSES = new Set<CharClass>(["warden", "stormcaller", "necromancer"]);
const COMMON_SYNERGY = 0.3; // 2 masters = 1.3x each, 3 = 1.6x each, ...
const RARE_SYNERGY = 0.6;   // 2 arcanists = 1.6x each, 3 = 2.2x each, 4 = 2.8x

// Public entry — called from tick.ts once per year, AFTER runMagic.
// No-op when magic is disabled: this preserves base-sim golden hashes byte-
// identical and keeps the base sim free of the personal-wealth economy.
export function runInnovations(w: World): void {
  if (!w.magicEnabled) return;

  // Build the adults-by-dynasty index once — recomputeDynastySpecialization
  // reuses it. Not cached across the tick boundary (would give specs stale
  // one-tick-old data on the following tick and break golden hashes).
  const adultsByDyn = buildAdultsIndex(w);

  // Recompute dynasty specialization from current member class distribution.
  // Pure structural read — no RNG.
  recomputeDynastySpecialization(w, adultsByDyn);

  // Prune dead guildmasters; disband guilds whose masters are gone. Pure
  // structural. Also prunes dead members from memberIds lists.
  maintainGuilds(w);

  // Leak roll — every active invention rolls once per year to spread to a new
  // dynasty. Guild-protected + mercantile cultures roll rarely; loose cultures
  // roll often. The roll only consumes RNG when the probability is > 0.
  rollLeaks(w);

  // Lost check — mark any invention whose bearer chain has extinguished. Doesn't
  // consume RNG; pure structural.
  checkLostInventions(w);
}

// Build an index of living adults grouped by dynasty. O(N) once per tick,
// replacing what would otherwise be O(dynasties × chars) inside the spec
// recompute. Same idea applies to synergy readers — see W._adultsByDynasty
// which world.ts caches during runInnovations.
function buildAdultsIndex(w: World): Map<DynastyId, Character[]> {
  const map = new Map<DynastyId, Character[]>();
  for (const c of w.characters.values()) {
    if (!c.alive) continue;
    if (w.age(c) < 16) continue;
    let arr = map.get(c.dynastyId);
    if (!arr) { arr = []; map.set(c.dynastyId, arr); }
    arr.push(c);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Dynasty specialization — recompute each tick from member class distribution.
// A dynasty acquires a `dominantClass` when at least 40% of adult members share
// a class AND at least one member is level 8+. `specializationDepth` = fraction
// × avgLevel/20 (capped at 1), which is what synergy readers multiply against.
// ---------------------------------------------------------------------------
function recomputeDynastySpecialization(w: World, adultsByDyn: Map<DynastyId, Character[]>): void {
  for (const dyn of w.dynasties.values()) {
    if (dyn.extinctYear !== null) continue;
    const adults = adultsByDyn.get(dyn.id) ?? [];
    if (adults.length === 0) {
      dyn.dominantClass = null;
      dyn.specializationDepth = 0;
      continue;
    }
    // Tally class counts + level sums.
    const counts = new Map<CharClass, number>();
    const levelSums = new Map<CharClass, number>();
    for (const c of adults) {
      counts.set(c.charClass, (counts.get(c.charClass) ?? 0) + 1);
      levelSums.set(c.charClass, (levelSums.get(c.charClass) ?? 0) + c.level);
    }
    // Pick the plurality class. Deterministic tie-break: alphabetical.
    let best: CharClass | null = null;
    let bestCount = 0;
    for (const [cls, n] of counts) {
      if (n > bestCount || (n === bestCount && best && cls < best)) {
        best = cls;
        bestCount = n;
      }
    }
    if (!best || bestCount / adults.length < 0.4) {
      dyn.dominantClass = null;
      dyn.specializationDepth = 0;
      continue;
    }
    // Require at least one level-8+ master in the dominant class — a house of
    // apprentices isn't yet a specialized house.
    const avgLevel = (levelSums.get(best) ?? 0) / bestCount;
    if (avgLevel < 4) {
      dyn.dominantClass = null;
      dyn.specializationDepth = 0;
      continue;
    }
    dyn.dominantClass = best;
    dyn.specializationDepth = Math.min(1, (bestCount / adults.length) * (avgLevel / 20));
  }
}

// Recompute guildmasters (highest-level living member) and disband guilds
// whose active member count drops below 2 or whose master is missing.
function maintainGuilds(w: World): void {
  for (const g of w.guilds.values()) {
    if (g.disbandedYear !== null) continue;
    // Prune dead members.
    g.memberIds = g.memberIds.filter((id) => w.characters.get(id)?.alive === true);
    if (g.memberIds.length < 2) {
      g.disbandedYear = w.year;
      w.log("GUILD_DISSOLVED", {
        provinceId: g.provinceId,
        data: { guild: g.name, craft: g.craft, guildId: g.id },
      });
      // Clear guildId on remaining members.
      for (const id of g.memberIds) {
        const c = w.characters.get(id);
        if (c) c.guildId = null;
      }
      g.memberIds = [];
      continue;
    }
    // Choose master — highest-level living member.
    const members = w.guildMembers(g);
    const master = members.reduce((a, b) => (b.level > a.level ? b : a), members[0]);
    g.masterId = master.id;
  }
}

// ---------------------------------------------------------------------------
// Synergy readers — used by accrueWealth, resolveWars, invention prob. Return
// a multiplicative bonus (add to 1) representing the class-specialization edge
// a dynasty has. Formula: 1 + synergyCoef * (N-1) * specializationDepth. So a
// house with 4 members of class C at high level gets a 1.9x multiplier for that
// class's productive output.
// ---------------------------------------------------------------------------
export function classSynergyBonus(w: World, dynId: DynastyId, cls: CharClass, minLevel: number = 8): number {
  const dyn = w.dynasty(dynId);
  if (!dyn) return 0;
  const masters = w.dynastyMastersOfClass(dynId, cls, minLevel);
  if (masters.length === 0) return 0;
  const coef = RARE_CLASSES.has(cls) ? RARE_SYNERGY : COMMON_SYNERGY;
  // If dominantClass matches, apply the specialization depth as an amplifier.
  const depth = dyn.dominantClass === cls ? dyn.specializationDepth : 0.3;
  return coef * (masters.length - 1) * depth;
}

// Dynasty-level bonus for wealth accrual (via merchant/scholar concentration).
export function dynastyWealthSynergy(w: World, dynId: DynastyId): number {
  return classSynergyBonus(w, dynId, "merchant") + classSynergyBonus(w, dynId, "scholar");
}

// Dynasty-level bonus for war strength (via soldier/knight + rare-class).
export function dynastyMartialSynergy(w: World, dynId: DynastyId): number {
  const dyn = w.dynasty(dynId);
  if (!dyn) return 0;
  const soldier = classSynergyBonus(w, dynId, "soldier");
  const knight = classSynergyBonus(w, dynId, "knight");
  // Rare-class synergy — one bearer is normal, but multiple bearers stack
  // super-linearly. Historical: three necromancers in a house is world-changing.
  let rare = 0;
  if (dyn.rite) rare = classSynergyBonus(w, dyn.id, dyn.rite, 1);
  return soldier + knight + rare;
}

// Dynasty-level bonus for invention probability (scholar/merchant concentration).
export function dynastyInnovationSynergy(w: World, dynId: DynastyId): number {
  return classSynergyBonus(w, dynId, "scholar") * 0.7
       + classSynergyBonus(w, dynId, "merchant") * 0.3;
}

// Guild-level bonus — a guild with N active members at level >= L amplifies
// each member's productive output. Used by wealth accrual for scholar/merchant
// classes and by invention prob (guild masters cluster masters and apprentices).
export function guildSynergyBonus(w: World, g: Guild, minLevel: number = 5): number {
  const active = w.guildMembers(g).filter((c) => c.level >= minLevel);
  if (active.length <= 1) return 0;
  const coef = g.craft === "arcana" ? RARE_SYNERGY : COMMON_SYNERGY;
  return coef * (active.length - 1) * 0.5; // guild synergy is half a dynasty's
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
