// diplomacy.ts — treaties between rulers: truces (finite) and alliances (permanent).
//
// Truces are minted by tick.ts after every war, preventing the same two parties
// from immediately re-fighting. Alliances form from high mutual opinion and pool
// defensive power. A paranoid or conqueror_confident ruler may break a truce early.
//
// Kept separate from tick.ts so the goal system can query hasTruce without a
// circular import (tick → goals → diplomacy, never diplomacy → tick).

import type { Character, CharId, Treaty } from "./types.js";
import type { World } from "./world.js";

// All non-expired treaties involving a character.
export function activeTreaties(w: World, charId: CharId): Treaty[] {
  return w.treaties.filter(
    (t) =>
      (t.partyA === charId || t.partyB === charId) &&
      (t.expiresYear === null || t.expiresYear > w.year),
  );
}

export function hasTruce(w: World, a: CharId, b: CharId): boolean {
  return w.treaties.some(
    (t) =>
      t.type === "truce" &&
      ((t.partyA === a && t.partyB === b) || (t.partyA === b && t.partyB === a)) &&
      (t.expiresYear === null || t.expiresYear > w.year),
  );
}

export function hasAlliance(w: World, a: CharId, b: CharId): boolean {
  return w.treaties.some(
    (t) =>
      t.type === "alliance" &&
      ((t.partyA === a && t.partyB === b) || (t.partyA === b && t.partyB === a)) &&
      (t.expiresYear === null || t.expiresYear > w.year),
  );
}

// The living, landed ally for targetId against attackerId (if any).
export function allyFor(w: World, targetId: CharId, attackerId: CharId): Character | null {
  for (const t of w.treaties) {
    if (t.type !== "alliance") continue;
    if (t.expiresYear !== null && t.expiresYear <= w.year) continue;
    let allyId: CharId | null = null;
    if (t.partyA === targetId) allyId = t.partyB;
    else if (t.partyB === targetId) allyId = t.partyA;
    if (!allyId || allyId === attackerId) continue;
    const ally = w.char(allyId);
    if (ally?.alive && w.titlesHeldBy(allyId).length > 0) return ally;
  }
  return null;
}

// Mint a cease-fire between winner and loser for the given number of years.
export function mintTruce(w: World, winnerId: CharId, loserId: CharId, duration: number): void {
  w.treaties.push({
    id: w.freshId("treaty"),
    type: "truce",
    partyA: winnerId,
    partyB: loserId,
    startYear: w.year,
    expiresYear: w.year + duration,
  });
  w.log("TRUCE", {
    actorId: winnerId,
    targetId: loserId,
    data: { years: duration, expires: w.year + duration },
  });
}

function mintAlliance(w: World, aId: CharId, bId: CharId): void {
  w.treaties.push({
    id: w.freshId("treaty"),
    type: "alliance",
    partyA: aId,
    partyB: bId,
    startYear: w.year,
    expiresYear: null,
  });
  w.log("ALLIANCE_FORMED", { actorId: aId, targetId: bId, data: { year: w.year } });
}

// Remove treaties that have expired or whose parties are dead.
export function purgeTreaties(w: World): void {
  w.treaties = w.treaties.filter((t) => {
    if (t.expiresYear !== null && t.expiresYear <= w.year) return false;
    const a = w.char(t.partyA);
    const b = w.char(t.partyB);
    return a?.alive && b?.alive;
  });
}

// Called once per tick before regenerateGoals.
// Advances alliance formation and psyche-driven truce breaking.
export function advanceDiplomacy(w: World): void {
  // Only landed adults participate in diplomacy.
  const rulers = w.adults().filter((c) => w.titlesHeldBy(c.id).length > 0);

  for (const c of rulers) {
    // --- Alliance formation ---
    // Two rulers with high mutual opinion and no existing pact may swear one.
    for (const other of rulers) {
      if (other.id <= c.id) continue; // each pair once
      if (hasAlliance(w, c.id, other.id)) continue;
      if (hasTruce(w, c.id, other.id)) continue;
      const opinion = (w.opinionOf(c, other.id) + w.opinionOf(other, c.id)) / 2;
      if (opinion < 35) continue;
      // Chance scales gently with mutual warmth so alliances take time to form.
      const allianceChance = 0.04 + Math.max(0, (opinion - 35) / 400);
      if (w.rng.chance(allianceChance)) mintAlliance(w, c.id, other.id);
    }

    // --- Psyche-driven truce breaking ---
    // Paranoid rulers suspect betrayal; conqueror_confident rulers feel invincible.
    // Either disposition can compel a ruler to spurn an active truce early.
    const paranoid = c.psyche.distortion === "paranoid";
    const confidentOverride = c.psyche.biases.conqueror_confident > 0.7;
    if (!paranoid && !confidentOverride) continue;

    for (const t of activeTreaties(w, c.id)) {
      if (t.type !== "truce") continue;
      // Only break truces that still have more than 2 years to run — short
      // remainders aren't worth the political cost.
      if (t.expiresYear !== null && t.expiresYear - w.year > 2) {
        const breakChance = paranoid ? 0.15 : 0.08;
        if (w.rng.chance(breakChance)) {
          const otherId = t.partyA === c.id ? t.partyB : t.partyA;
          w.treaties = w.treaties.filter((tr) => tr.id !== t.id);
          const other = w.char(otherId);
          if (other) w.adjustOpinion(other, c.id, -25);
          w.log("TRUCE_BROKEN", {
            actorId: c.id,
            targetId: otherId,
            data: { years_remaining: (t.expiresYear ?? w.year) - w.year },
          });
        }
      }
    }
  }
}
