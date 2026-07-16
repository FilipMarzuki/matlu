// phenomena.ts — natural shocks: harvest variance, famine, plague.
//
// Layer 2 of the causal stack. These are EXOGENOUS shocks that ripple UP into
// the human story: a famine thins a province's levies (weakening a claimant
// mid-war), a plague kills named characters (triggering succession crises).
// The drama isn't the plague itself — it's the throne it empties.

import { getBiology } from "./biology.js";
import { scarcity } from "./geography.js";
import { plagueResistBonus, transferOnDeath } from "./innovation.js";
import { onGrief } from "./perception.js";
import type { Character } from "./types.js";
import type { World } from "./world.js";

// Each year every province rolls a harvest multiplier around 1.0. Most years
// are unremarkable (gaussian clustered near the mean); occasionally the crop
// fails badly. A failed harvest on top of existing scarcity is what tips a
// province into famine.
export function runHarvest(w: World): void {
  for (const p of w.provinces.values()) {
    // Fertile land has steadier harvests; marginal land swings wildly.
    const variance = 0.18 + (1 - p.fertility) * 0.15;
    const yield_ = w.rng.gaussian(1.0, variance);

    if (yield_ < 0.7) {
      // A poor harvest. Population takes a hit; the worse the harvest and the
      // tighter the scarcity, the deeper the loss.
      const s = scarcity(p);
      const severity = (0.7 - yield_) * (0.5 + s); // bigger when overpopulated
      const loss = Math.round(p.population * Math.min(0.25, severity));
      if (loss > 0) {
        p.population = Math.max(50, p.population - loss);
        // Only a genuinely bad year on stressed land is worth chronicling as
        // a famine; a mild dip is just a hungry winter.
        if (yield_ < 0.55 && s > 0.85) {
          w.log("FAMINE", {
            provinceId: p.id,
            data: { deaths: loss, harvest: Number(yield_.toFixed(2)) },
          });
          // Famine can also kill named characters seated in the province.
          killResidentsByChance(w, p.id, "famine", 0.04 + severity * 0.05);
        } else {
          w.log("HARVEST_FAILURE", {
            provinceId: p.id,
            data: { deaths: loss, harvest: Number(yield_.toFixed(2)) },
          });
        }
      }
    }
  }
}

// Plague: rare to ignite, but once loose it spreads along the connectivity
// graph — faster via rivers and coasts — and kills both pops and named
// characters. A plague year that carries off a king is the single richest
// story generator in the prototype.
export function runPlague(w: World): void {
  // ~3% chance per year of a new outbreak somewhere.
  if (!w.rng.chance(0.03)) return;

  const provs = [...w.provinces.values()];
  // Plagues originate only on the surface — underground halls are immune to the
  // vectors (airborne, water-borne) that drive surface epidemics.
  const origin = w.rng.pick(provs.filter((p) => !p.subsurface));

  // BFS-style spread frontier with decaying probability.
  const infected = new Set<string>([origin.id]);
  let frontier = [origin.id];
  let spreadChance = 0.8;

  while (frontier.length > 0 && spreadChance > 0.1) {
    const nextFrontier: string[] = [];
    for (const pid of frontier) {
      const p = w.province(pid);
      if (!p) continue;
      for (const nId of p.neighbors) {
        if (infected.has(nId)) continue;
        const n = w.province(nId);
        if (!n) continue;
        // Underground halls are sealed from surface contagion.
        if (n.subsurface) continue;
        // Rivers and coasts are highways for disease.
        const conduit = (p.coastal && n.coastal) || (p.riverConnected && n.riverConnected);
        const chance = spreadChance * (conduit ? 1.0 : 0.55);
        if (w.rng.chance(chance)) {
          infected.add(nId);
          nextFrontier.push(nId);
        }
      }
    }
    frontier = nextFrontier;
    spreadChance *= 0.7; // burns out as it travels
  }

  let totalDeaths = 0;
  let namedDead = 0;
  for (const pid of infected) {
    const p = w.province(pid);
    if (!p) continue;
    const mortality = w.rng.float(0.1, 0.35);
    const loss = Math.round(p.population * mortality);
    p.population = Math.max(50, p.population - loss);
    totalDeaths += loss;
    namedDead += killResidentsByChance(w, pid, "plague", mortality * 0.6);
  }

  w.log("PLAGUE", {
    provinceId: origin.id,
    data: {
      provinces: infected.size,
      deaths: totalDeaths,
      named_dead: namedDead,
    },
  });
}

// Kill named characters living in a province with the given per-head chance.
// Returns how many died so the plague event can report a body count of the
// people the chronicle actually cares about. The deaths themselves are logged
// individually so inheritance can react to each one in the same tick.
export function killResidentsByChance(
  w: World,
  provinceId: string,
  cause: string,
  chance: number,
): number {
  let dead = 0;
  for (const c of w.living()) {
    if (c.provinceId !== provinceId) continue;
    // Biology: plague resistance reduces effective kill chance per character.
    // Held medicine-inventions further reduce plague mortality.
    let effectiveChance = chance;
    if (cause === "plague") {
      const raceId = w.raceIdOf(c);
      const race = raceId ? w.races.get(raceId) : undefined;
      if (race?.biology) {
        effectiveChance = chance * (1 - getBiology(race).plagueResistance);
      }
      // Medicine inventions held by this dynasty attenuate plague further.
      effectiveChance *= 1 - plagueResistBonus(w, c.dynastyId);
    }
    if (w.rng.chance(effectiveChance)) {
      markDead(w, c, cause);
      dead++;
    }
  }
  return dead;
}

// Centralised death so every path (plague, famine, old age, murder, war)
// records the same structured DEATH event. Succession is resolved later in
// the tick by inheritance.ts, which scans for the freshly dead title-holders.
export function markDead(w: World, c: Character, cause: string): void {
  if (!c.alive) return;
  c.alive = false;
  c.deathYear = w.year;
  c.causeOfDeath = cause;
  w.log("DEATH", {
    actorId: c.id,
    provinceId: c.provinceId,
    data: { cause, age: w.year - c.birthYear, dynasty: c.dynastyId },
  });
  // Notify living close kin — grief warps their perceptual lens.
  const spouse = w.char(c.spouseId);
  if (spouse?.alive) onGrief(spouse);
  const father = w.char(c.fatherId);
  if (father?.alive) onGrief(father);
  const mother = w.char(c.motherId);
  if (mother?.alive) onGrief(mother);
  // Personal wealth + apprentice-inheritance hook. No-op when magic is off.
  transferOnDeath(w, c.id);
}
