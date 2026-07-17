// sieges.ts — multi-year sieges.
//
// The engine's one-shot WAR resolution can't model long sieges like
// Constantinople 1453, Vienna 1683, Alesia 52 BC, Masada 73 CE. Those needed
// state that spans YEARS: provisions running out inside the walls, morale
// grinding down on both sides, sallies from the defender, plague in the
// attacker's camp, walls slowly cracking, occasional breakthroughs. This
// module holds that state and processes it each tick.
//
// Sieges are QUEUED from resolveWars when:
//   • The target title is kingdom-tier OR duchy-tier (well-fortified)
//   • The attacker/defender power ratio is 0.5-1.5 (close enough to be a real
//     siege, not a walkover in either direction)
//   • No existing siege at this title
//
// Each tick, runSieges:
//   • Ages every active siege
//   • Drops provisions and morale
//   • Rolls mid-siege events (sally, breach, starvation)
//   • Checks termination conditions and resolves the siege
//
// Sieges terminate when:
//   • provisions hit 0 → SIEGE_FALLEN (defender starves, title transfers)
//   • attackerMorale hits 0 → SIEGE_LIFTED (attacker gives up)
//   • yearsElapsed > 8 → forced end (whoever has higher morale wins)
//   • attacker or defender dies mid-siege → resolved via their side
//
// Guards on magicEnabled to preserve RNG symmetry with the base sim. If any
// sieges are queued (which won't happen without magic anyway), we still
// process them so nothing hangs.

import { addClaim } from "./inheritance.js";
import { markDead } from "./phenomena.js";
import type { Character, Siege, Title } from "./types.js";
import type { World } from "./world.js";

const MAX_SIEGE_YEARS = 8;      // forced termination point
const BREACH_YEAR_MIN = 3;      // walls can't crack in the first two years

// Try to queue a siege from an attempted war. Returns true if a siege was
// queued (so caller should SKIP the one-shot resolution); false if this war
// should resolve normally. Called from tick.ts:resolveWars — the trigger check.
export function trySpawnSiege(
  w: World,
  attacker: Character,
  defender: Character,
  title: Title,
  aPow: number,
  dPow: number,
): boolean {
  if (!w.magicEnabled) return false;
  if (title.tier !== "kingdom" && title.tier !== "duchy") return false;
  if (w.activeSiegeAt(title.id)) return false;
  const ratio = aPow / Math.max(1, dPow);
  if (ratio < 0.5 || ratio > 1.5) return false;
  // Underground titles aren't sieged the same way (they'd fall via cave-ins
  // instead), skip for now.
  const prov = w.province(title.provinceId);
  if (prov?.subsurface) return false;

  const siege: Siege = {
    id: w.freshId("sg"),
    attackerId: attacker.id,
    defenderId: defender.id,
    provinceId: title.provinceId,
    titleId: title.id,
    startYear: w.year,
    yearsElapsed: 0,
    provisions: 1.0,
    attackerMorale: 0.7,
    defenderMorale: 0.7,
    breached: false,
    outcome: "active",
  };
  w.siegeQueue.push(siege);
  w.log("SIEGE_LAID", {
    actorId: attacker.id,
    targetId: defender.id,
    titleId: title.id,
    provinceId: title.provinceId,
    data: { title: title.name, siegeId: siege.id },
  });
  return true;
}

// Public entry — called from tick.ts once per year, AFTER resolveWars.
export function runSieges(w: World): void {
  if (w.siegeQueue.length === 0) return;
  for (const s of w.siegeQueue) {
    if (s.outcome !== "active") continue;
    advanceSiege(w, s);
  }
  // Drop resolved sieges from the queue to keep it bounded.
  w.siegeQueue = w.siegeQueue.filter((s) => s.outcome === "active");
}

// Age a single siege by one year — attrition, events, termination check.
function advanceSiege(w: World, s: Siege): void {
  s.yearsElapsed++;

  // Death of a principal always ends the siege.
  const attacker = w.char(s.attackerId);
  const defender = w.char(s.defenderId);
  if (!attacker?.alive) {
    endSiegeLifted(w, s, "attacker slain");
    return;
  }
  if (!defender?.alive) {
    endSiegeFallen(w, s, "defender slain");
    return;
  }

  // Attrition — provisions and morale drop steadily. Random per-year variation
  // reflects harvest, discipline, weather. RNG consumption is guarded by the
  // outcome === "active" check above.
  s.provisions = Math.max(0, s.provisions - w.rng.float(0.05, 0.15));
  s.attackerMorale = Math.max(0, s.attackerMorale - w.rng.float(0.02, 0.08));
  s.defenderMorale = Math.max(0, s.defenderMorale - w.rng.float(0.03, 0.10));

  // Random mid-siege events.
  if (w.rng.chance(0.15)) {
    // Defender sortie — costs attacker morale.
    s.attackerMorale = Math.max(0, s.attackerMorale - 0.12);
    w.log("SIEGE_SALLY", {
      actorId: s.defenderId,
      targetId: s.attackerId,
      provinceId: s.provinceId,
      data: { siegeId: s.id, year: s.yearsElapsed },
    });
  }

  if (s.provisions < 0.3 && !hasStarvationLogged(w, s)) {
    // First time provisions dip below 30% — starvation event and morale plunge.
    s.defenderMorale = Math.max(0, s.defenderMorale - 0.15);
    w.log("SIEGE_STARVATION", {
      actorId: s.defenderId,
      provinceId: s.provinceId,
      data: { siegeId: s.id, provisions: s.provisions },
    });
  }

  if (s.yearsElapsed >= BREACH_YEAR_MIN && !s.breached && w.rng.chance(0.1)) {
    s.breached = true;
    // Once breached, morale on both sides shifts sharply — attacker sees an
    // opening, defender sees the end.
    s.attackerMorale = Math.min(1, s.attackerMorale + 0.15);
    s.defenderMorale = Math.max(0, s.defenderMorale - 0.15);
    w.log("SIEGE_WALLS_BREACHED", {
      actorId: s.attackerId,
      targetId: s.defenderId,
      provinceId: s.provinceId,
      data: { siegeId: s.id, year: s.yearsElapsed },
    });
  }

  // Termination checks.
  if (s.provisions === 0) {
    endSiegeFallen(w, s, "starvation");
    return;
  }
  if (s.attackerMorale === 0) {
    endSiegeLifted(w, s, "attacker morale broken");
    return;
  }
  if (s.breached && s.attackerMorale > s.defenderMorale + 0.1) {
    endSiegeFallen(w, s, "breach exploited");
    return;
  }
  if (s.yearsElapsed >= MAX_SIEGE_YEARS) {
    if (s.attackerMorale > s.defenderMorale) endSiegeFallen(w, s, "attritional collapse");
    else endSiegeLifted(w, s, "attritional withdrawal");
  }
}

function hasStarvationLogged(w: World, s: Siege): boolean {
  return w.events.some((e) => e.type === "SIEGE_STARVATION" && e.data["siegeId"] === s.id);
}

// City falls — title transfers to attacker, defender may die, siege ends.
function endSiegeFallen(w: World, s: Siege, cause: string): void {
  s.outcome = "fallen";
  const attacker = w.char(s.attackerId);
  const defender = w.char(s.defenderId);
  const title = w.title(s.titleId);
  if (!attacker?.alive || !title) return;
  // Transfer the title. Follows the same pattern tick.ts uses for war wins.
  title.holderId = attacker.id;
  attacker.provinceId = title.provinceId;
  // Defender loses their seat; mint a weak recovery claim.
  if (defender?.alive) {
    addClaim(defender, {
      titleId: title.id,
      strength: "weak",
      basis: `dispossessed in the siege of ${w.year}`,
      year: w.year,
    });
    // High chance of dying when the city falls — historical: fall of Constantinople.
    if (w.rng.chance(0.5)) markDead(w, defender, "killed at the fall of the city");
  }
  w.log("SIEGE_FALLEN", {
    actorId: attacker.id,
    targetId: s.defenderId,
    titleId: title.id,
    provinceId: title.provinceId,
    data: {
      title: title.name, siegeId: s.id, years: s.yearsElapsed, cause,
      breached: s.breached,
    },
  });
}

// Attacker withdraws — no title transfer, weak claim minted for reprisal.
function endSiegeLifted(w: World, s: Siege, cause: string): void {
  s.outcome = "lifted";
  const attacker = w.char(s.attackerId);
  const title = w.title(s.titleId);
  if (attacker?.alive && title) {
    addClaim(attacker, {
      titleId: title.id,
      strength: "weak",
      basis: `withdrew from the siege of ${w.year}`,
      year: w.year,
    });
  }
  w.log("SIEGE_LIFTED", {
    actorId: s.attackerId,
    targetId: s.defenderId,
    titleId: s.titleId,
    provinceId: s.provinceId,
    data: {
      title: title?.name ?? "the seat", siegeId: s.id, years: s.yearsElapsed, cause,
    },
  });
}
