// tick.ts — one year of history, in the canonical order.
//
// The loop ordering matters: shocks land first (so this year's famine can break
// this year's war), then people live and die, then succession heals the holes
// death made, then intentions regenerate against the new state, then plots and
// wars play out, then the social fabric updates. Each step reads the state the
// previous step left behind — that chaining is what makes the history causal.
//
// Brief's required order:
//   mortality/birth -> regenerate goals -> spawn/advance schemes ->
//   resolve pressed claims (wars) + marriages -> opinion drift -> log events
// We bracket that with the environmental layer (geography + phenomena) up top,
// since exogenous shocks are supposed to ripple UP into everything else.

import { runCatastrophes } from "./catastrophe.js";
import { runChallenges } from "./challenges.js";
import { runEmergence } from "./emergence.js";
import { runFate } from "./fate.js";
import { runSpecs } from "./event-spec.js";
import "./specs/index.js"; // side-effect: registers all catalog specs
import { advanceCultureDrift } from "./culture-drift.js";
import { advanceDiplomacy, allyFor, hasAlliance, mintTruce, purgeTreaties } from "./diplomacy.js";
import { regrowPopulation, scarcity } from "./geography.js";
import { regenerateGoals } from "./goals.js";
import { runAcademies } from "./academies.js";
import { runClimate } from "./climate.js";
import { runCompanies } from "./companies.js";
import { runDiseases } from "./disease.js";
import { runWildlife } from "./wildlife.js";
import { runLanguages } from "./language.js";
import { runHeroes } from "./heroes.js";
import { runReligion } from "./religion.js";
import { runUnions } from "./unions.js";
import { dynastyMartialSynergy, militaryBonus, runInnovations } from "./innovation.js";
import { runMagic } from "./magic.js";
import { runSieges, trySpawnSiege } from "./sieges.js";
import { runTradeRoutes } from "./trade.js";
import { addClaim, resolveSuccession } from "./inheritance.js";
import { commonSurname } from "./names.js";
import { markDead, runHarvest, runPlague } from "./phenomena.js";
import { getBiology } from "./biology.js";
import { createCharacter, createDynasty, inheritDrives, naturalDeathAge, randomDrives, zeroPsyche } from "./people.js";
import { applyPerception, computeInbreeding, decayBiases, maybeOnsetMadness, onConquerorVictory, onTitleLost } from "./perception.js";
import { advanceSchemes, spawnSchemes } from "./schemes.js";
import type { Character, Title } from "./types.js";
import type { World } from "./world.js";

export function tick(w: World): void {
  w.year++;

  // Mark where this year's events begin, so the magic layer can level people
  // from exactly the deeds done this year (and nothing earlier).
  const evStart = w.events.length;

  // --- Environmental layer: geography + natural phenomena ----------------
  // Climate phase drift runs first — multi-decade cold/warm periods that
  // modulate downstream harvest yield and plague spread. No-op when
  // catastrophes are disabled.
  runClimate(w);
  // Catastrophes run before population growth / harvest / plague so
  // province state is updated before those read it this tick.
  runCatastrophes(w);
  regrowPopulation(w);
  runHarvest(w);
  runPlague(w);
  // Plague/famine may have emptied thrones; heal those before anything else
  // reads the holder graph.
  resolvePendingSuccessions(w);

  // --- mortality / birth -------------------------------------------------
  runMortality(w);
  runBirths(w);
  // Annual perception update: biases fade, distortions may onset.
  decayBiases(w);
  maybeOnsetMadness(w);
  resolvePendingSuccessions(w);

  // --- diplomacy: purge expired treaties, then advance (alliances + truce breaks)
  // Must run BEFORE regenerateGoals so updated treaty state suppresses war goals.
  purgeTreaties(w);
  advanceDiplomacy(w);

  // --- regenerate goals --------------------------------------------------
  regenerateGoals(w);
  // Apply perceptual biases and distortions to the clean goal set.
  applyPerception(w);

  // --- spawn / advance schemes (murders may happen here) -----------------
  spawnSchemes(w);
  advanceSchemes(w);
  resolvePendingSuccessions(w);

  // --- resolve pressed claims (wars) + marriages -------------------------
  resolveWars(w);
  resolvePendingSuccessions(w);
  runMarriages(w);

  // --- opinion drift -----------------------------------------------------
  opinionDrift(w);

  // --- bookkeeping: dynasty extinction -----------------------------------
  detectExtinctions(w);

  // --- cultural evolution (no-op unless cultures are defined) ------------
  // Runs after all this year's events are logged so event-pressure reads the
  // full picture before deciding whether a trait tips.
  advanceCultureDrift(w);

  // --- magic / leveling layer (no-op unless enabled) ---------------------
  // Runs last: it reads the year's events to grow people, then advances the
  // capital/comfort/rite economy. Kept after the base loop so base behaviour is
  // byte-identical when magic is off.
  if (w.magicEnabled) runMagic(w, evStart);

  // --- emergent hero / faction layer (no-op unless magic is on) ----------
  // Runs after runMagic so this year's LEVELED / CLASS_GAINED events are in
  // the log and can gate emergence checks. Zero RNG when magicEnabled=false,
  // so golden-hash worlds are byte-identical.
  runEmergence(w);

  // --- persistent trade routes: age wealth, dormancy, revive, abandon ---
  // Guarded on catastrophesEnabled so base sim stays byte-identical. Reads
  // this year's TRADE_ROUTE_DISRUPTED / ESTABLISHED events (already fired by
  // emergence) to update entity state.
  runTradeRoutes(w);

  // --- discrete challenges layer (dragons, wraith hosts, abyssal gates) ---
  // Runs last: reads catastrophes that fired earlier this tick (to spawn
  // reactive challenges) and this year's XP state to pick brave challengers.
  runChallenges(w);

  // --- fate / doom / legend layer ---
  // Runs after challenges so CHALLENGE_VANQUISHED/SKILL events this tick
  // can qualify a dying figure for LEGEND_INSCRIBED. Also resolves this
  // year's DEATHs against active prophecies and dooms.
  runFate(w);

  // --- catalog-driven events (EventSpec / SPEC_REGISTRY) ---
  // Registered specs (including specs/innovation-events.ts) fire here. Ambient
  // specs consume RNG; the innovation specs' probability is inversely scaled
  // by manaDensity so high-mana provinces see less codified innovation.
  runSpecs(w);

  // --- codified craft-secrets: leak rolls + lost checks ---
  // Runs after runSpecs so any INVENTION_MADE fired this tick immediately
  // participates in leak/lost bookkeeping next tick. No-op when magic is off.
  runInnovations(w);

  // --- persistent academies — form new ones, age prestige, migrate on shock.
  // Runs after runInnovations so this tick's inventions boost prestige.
  runAcademies(w);

  // --- organised religion — deity manifestation, church aging, schisms,
  // investiture conflicts, divine wrath / intervention. In this world gods
  // are real, so doctrine is pact and miracles auditable. Guarded on
  // magicEnabled inside religion.ts (RNG-symmetric no-op otherwise).
  runReligion(w);

  // --- named heroes & legendary artefacts — a hero earns a living epithet;
  // masters forge persistent artefacts that pass through inheritance, get
  // stolen, get lost, and can be rediscovered. Magic-guarded.
  runHeroes(w);

  // --- language drift — proto-languages per culture, split on isolation,
  // converge on active trade routes, mint linguae francae, translation
  // events, language death + scholarly revival. Runs on cultures only,
  // so worlds with no defined cultures (the default tableau) get no
  // language activity.
  runLanguages(w);

  // --- disease strains — persistent named diseases (mundane + magical)
  // that emerge, strike repeatedly, mutate, jump routes, and burn out on
  // cross-immunity. Guarded on catastrophesEnabled inside disease.ts
  // (RNG-symmetric no-op when off).
  runDiseases(w);

  // --- dynastic unions — detect new political marriages between title-
  // holders, mint personal unions when heirs inherit both crowns, age
  // strength, dissolve on war. Runs on every world (not guarded on any flag).
  runUnions(w);

  // --- persistent companies — mercenary companies get hired, turn
  // condottiere on their patrons; pirate fleets raid coastal provinces and
  // get busted in naval battles. Runs on every world (not flag-guarded).
  runCompanies(w);

  // --- wildlife — seeded once at world init, aged annually. Hunters bag
  // trophies; blight culls habitat; species drift toward extinction or
  // recover; rare zoonotic jumps carry pathogens into humans. Mana-beasts
  // manifest in high-mana provinces in magic worlds. Guarded on
  // catastrophesEnabled inside wildlife.ts (RNG-symmetric no-op otherwise).
  runWildlife(w);

  // --- multi-year sieges — advance provisions/morale, resolve terminations.
  // No-op when the queue is empty.
  runSieges(w);

  // End-of-tick sweep: runChallenges can kill title-holders (challenger
  // slain by a hostile kind), and the last resolvePendingSuccessions call
  // was before that. Without this the "title held by dead char" invariant
  // can fail at end-of-simulation, since no next tick arrives to clean up.
  resolvePendingSuccessions(w);
}

// ---------------------------------------------------------------------------
// Mortality — age-driven, with a famine/plague boost handled separately in
// phenomena.ts. Two paths:
//   Biology path  (race has a biology block): character has a sampled natural
//     death age drawn once from Normal(lifespan, 15). Baseline hazard is very
//     low; it spikes sharply once the character passes their drawn death age.
//   Piecewise path (no biology): the original curve — human-tuned, unchanged.
// ---------------------------------------------------------------------------
function runMortality(w: World): void {
  for (const c of w.living()) {
    const age = w.age(c);
    // Level-based lifespan extension: high-tier characters live radically
    // longer (Wandering Inn / He-Who-Fights-Monsters style). Baseline for
    // level < 16 is 1.0. Only kicks in when magic is on (level > 1 requires
    // magic.ts running), so base-sim hashes are byte-identical.
    const lifeMult = levelLifespanMultiplier(c.level);
    const deathAge = naturalDeathAge(w, c);
    let p: number;
    if (deathAge !== null) {
      const eff = deathAge * lifeMult;
      // Biology path: very low baseline, accelerates near the drawn death age.
      p = 0.002;
      if (age < 3) p += 0.03;
      if (age >= eff) {
        p += 0.5 + (age - eff) * 0.1; // rapid decline past natural age
      } else if (age >= eff * 0.9) {
        p += (age - eff * 0.9) * 0.03; // late-life acceleration
      }
      // Use a lifespan-relative old-age threshold for the cause label.
      const oldThreshold = Math.round(eff * 0.7);
      if (w.rng.chance(Math.min(0.9, p))) {
        markDead(w, c, age > oldThreshold ? "old age" : "illness");
      }
    } else {
      // Original piecewise hazard for races without biology, with the same
      // level extension applied to the age thresholds.
      p = 0.006;
      if (age < 3) p += 0.03;                                     // infant mortality
      if (age > 50 * lifeMult) p += (age - 50 * lifeMult) * 0.004;
      if (age > 70 * lifeMult) p += (age - 70 * lifeMult) * 0.02; // old age catches up fast
      if (age > 90 * lifeMult) p += 0.15;
      if (w.rng.chance(Math.min(0.9, p))) {
        markDead(w, c, age > 60 * lifeMult ? "old age" : "illness");
      }
    }
  }
}

// Level → lifespan multiplier. A level-30 warden or archmage doesn't die of
// old age at 70 — they linger. Calibrated so:
//   level < 16:  1.0x (no extension; magic layer hasn't lifted them)
//   level 16-19: 1.2x
//   level 20-24: 1.6x
//   level 25-29: 2.2x
//   level 30+:   3.5x  (an Elder — grandfather to the age)
function levelLifespanMultiplier(level: number): number {
  if (level < 16) return 1.0;
  if (level < 20) return 1.2;
  if (level < 25) return 1.6;
  if (level < 30) return 2.2;
  return 3.5;
}

// ---------------------------------------------------------------------------
// Births — married women of childbearing age conceive with a per-year chance
// that tapers as the household fills up. Children take the father's dynasty and
// inherit a blended drive vector, giving lineages a temperament.
// ---------------------------------------------------------------------------
function runBirths(w: World): void {
  for (const mother of w.living()) {
    if (mother.sex !== "female") continue;
    const age = w.age(mother);
    const motherRaceId = w.raceIdOf(mother);
    const motherRace = motherRaceId ? w.races.get(motherRaceId) : undefined;
    // Biology-aware max fertile age: 35% of natural lifespan. Fallback: 45.
    const maxFertileAge = motherRace?.biology
      ? Math.round(getBiology(motherRace).lifespan * 0.35)
      : 45;
    if (age < 16 || age > maxFertileAge) continue;
    const father = w.char(mother.spouseId);
    if (!father || !father.alive) continue;

    const livingKids = w.livingChildren(mother).length;
    const chance = Math.max(0.05, 0.28 - livingKids * 0.04);
    if (!w.rng.chance(chance)) continue;

    const sex = w.rng.chance(0.51) ? "male" : "female";
    const child = createCharacter(w, {
      sex,
      dynastyId: father.dynastyId, // patrilineal in v1
      birthYear: w.year,
      provinceId: father.provinceId,
      drives: inheritDrives(w.rng, father.drives, mother.drives),
      fatherId: father.id,
      motherId: mother.id,
      biasCulture: true, // pull the child toward its house's cultural temperament
    });
    // Inbreeding coefficient requires the full family graph, so compute it after
    // createCharacter has wired the child into both parents' childrenIds lists.
    child.psyche.inbreedingCoeff = computeInbreeding(w, father.id, mother.id);
    w.log("BIRTH", {
      actorId: child.id,
      targetId: father.id,
      provinceId: child.provinceId,
      data: { mother: mother.id, sex, dynasty: father.dynastyId },
    });
  }
}

// ---------------------------------------------------------------------------
// Succession healing — find every title whose recorded holder is dead and run
// the inheritance law. Idempotent and called several times per tick because
// deaths arrive from many sources (plague, age, murder, war).
// ---------------------------------------------------------------------------
function resolvePendingSuccessions(w: World): void {
  for (const title of w.titles.values()) {
    const holder = w.char(title.holderId);
    if (title.holderId && (!holder || !holder.alive)) {
      // Holder is dead (or vanished) — resolve under the law.
      const deceased = holder ?? syntheticDeceased(title);
      resolveSuccession(w, title, deceased);
    }
  }
}

// In the rare case the holder record is missing entirely, fabricate a minimal
// stand-in so resolveSuccession can still mint a crisis. Should not normally
// happen, but keeps the loop total.
function syntheticDeceased(title: Title): Character {
  return {
    id: "<lost>",
    name: "the late lord",
    sex: "male",
    dynastyId: "<none>",
    birthYear: 0,
    deathYear: 0,
    alive: false,
    causeOfDeath: "unknown",
    fatherId: null,
    motherId: null,
    spouseId: null,
    childrenIds: [],
    provinceId: title.provinceId,
    drives: { ambition: 0, greed: 0, vengeance: 0, piety: 0, lust: 0, fear: 0 },
    claims: [],
    grudges: [],
    opinion: {},
    reputation: { schemer: 0, just: 0 },
    psyche: zeroPsyche(),
    lowborn: false,
    quirk: null,
    level: 1,
    lifeXp: 0,
    charClass: "commoner",
    comfort: 0,
    ventured: false,
    personalWealth: 0,
    mentorId: null,
    apprenticeIds: [],
    guildId: null,
  };
}

// ---------------------------------------------------------------------------
// Wars — pressed claims and expansion. We take the strongest-motivated war
// goals and resolve each as one decisive struggle weighted by raised power.
// Losers are minted weak claims (fuel for the next generation) and sometimes
// die on the field. Vacant titles (from a crisis) are seized by the boldest
// claimant — or, if the bloodline is spent, by a lowborn upstart.
// ---------------------------------------------------------------------------
function resolveWars(w: World): void {
  const warGoals = w.goals
    .filter((g) => g.type === "SEIZE_TITLE" || g.type === "EXPAND")
    .sort((a, b) => b.priority - a.priority);

  const settledThisYear = new Set<string>();
  let warsFought = 0;
  const MAX_WARS = 3; // keep a year's history legible

  for (const g of warGoals) {
    if (warsFought >= MAX_WARS) break;
    if (!g.targetTitleId || settledThisYear.has(g.targetTitleId)) continue;
    const title = w.title(g.targetTitleId);
    const attacker = w.char(g.actorId);
    if (!title || !attacker || !attacker.alive) continue;
    if (title.holderId === attacker.id) continue;

    const defender = w.char(title.holderId);

    // --- Vacant title (succession crisis) -------------------------------
    if (!defender) {
      seizeVacantTitle(w, title, attacker, g.priority);
      settledThisYear.add(title.id);
      warsFought++;
      continue;
    }

    // --- Held title: does the attacker dare press? ----------------------

    // Alliance betrayal: if the attacker is attacking their own ally, the pact
    // is shattered before the war and both parties pay an opinion penalty.
    if (hasAlliance(w, attacker.id, defender.id)) {
      w.treaties = w.treaties.filter(
        (t) =>
          !(
            t.type === "alliance" &&
            ((t.partyA === attacker.id && t.partyB === defender.id) ||
              (t.partyA === defender.id && t.partyB === attacker.id))
          ),
      );
      w.log("ALLIANCE_BETRAYED", {
        actorId: attacker.id,
        targetId: defender.id,
        titleId: title.id,
        data: { title: title.name },
      });
      w.adjustOpinion(defender, attacker.id, -40);
    }

    // Underground fortifications heavily favour the defender: attackers
    // advancing through narrow tunnels lose much of their numerical edge.
    const prov = w.province(title.provinceId);
    // Military inventions (siege engines, war-drill, metallurgy) held by the
    // dynasty amplify raised power. Symmetric — both sides get their bonus.
    // Dynasty martial specialization — a house of soldiers/knights (or a
    // rare-class rite of stormcallers/necromancers/wardens) adds super-linear
    // force. Multiple rare-class bearers is CATASTROPHIC for the opponent.
    const aMil = 1 + militaryBonus(w, attacker.dynastyId) + dynastyMartialSynergy(w, attacker.dynastyId);
    const dMil = 1 + militaryBonus(w, defender.dynastyId) + dynastyMartialSynergy(w, defender.dynastyId);
    const aPow = w.power(attacker) * (prov?.subsurface ? 0.5 : 1.0) * aMil;
    // loss_aversion makes defenders fight harder to keep what they have.
    const defBase = w.power(defender) * (1 + defender.psyche.biases.loss_aversion * 0.25) * dMil;
    // A defensive ally contributes half their power to the defender's cause.
    const ally = allyFor(w, defender.id, attacker.id);
    const dPow = defBase + (ally ? w.power(ally) * 0.5 : 0);

    const hasStrongClaim = attacker.claims.some(
      (c) => c.titleId === title.id && c.strength === "strong",
    );
    // You cannot wage a war of conquest with no lands to raise a host from.
    // This is what stops landless teenage claimants from suicidally charging a
    // king every year — they must first acquire a seat (by inheritance, a
    // vacant-title grab, or marriage) before they can press a claim by force.
    const canFieldArmy = aPow > 0;
    const willing =
      canFieldArmy &&
      (hasStrongClaim || aPow > dPow * 0.7 || attacker.drives.ambition > 0.85);
    if (!willing) continue;

    settledThisYear.add(title.id);
    warsFought++;

    // Well-fortified target + close power ratio → LONG SIEGE instead of one-
    // shot. Sieges are queued and processed each tick by sieges.ts:runSieges.
    // Only fires when magicEnabled (guard inside trySpawnSiege).
    if (trySpawnSiege(w, attacker, defender, title, aPow, dPow)) continue;

    // Victory probability from relative power, nudged by a strong claim's
    // legitimacy (it rallies more support).
    const claimEdge = hasStrongClaim ? 0.15 : 0;
    const pWin = Math.min(0.92, Math.max(0.08, aPow / (aPow + dPow) + claimEdge));
    const attackerWins = w.rng.chance(pWin);

    const winner = attackerWins ? attacker : defender;
    const loser = attackerWins ? defender : attacker;

    if (attackerWins) {
      transferTitle(title, attacker);
      onConquerorVictory(w, attacker);
      onTitleLost(w, defender);
    } else {
      onConquerorVictory(w, defender);
    }
    // The loser is minted a (renewed) weak claim — wars rarely truly end.
    // Defenders who lost their seat get a "dispossessed" basis so loss_aversion
    // in the perception pass recognises it as recovery rather than fresh conquest.
    addClaim(loser, {
      titleId: title.id,
      strength: "weak",
      basis: attackerWins ? `dispossessed in the war of ${w.year}` : `lost the war of ${w.year}`,
      year: w.year,
    });
    w.adjustOpinion(loser, winner.id, -30);

    // War is lethal. The defeated party — or the late defender — may fall.
    let casualty: Character | null = null;
    if (w.rng.chance(0.35)) {
      casualty = loser;
      markDead(w, loser, "killed in war");
    }

    w.log("WAR", {
      actorId: attacker.id,
      targetId: defender.id,
      titleId: title.id,
      provinceId: title.provinceId,
      data: {
        title: title.name,
        attacker_won: attackerWins,
        attacker_power: aPow,
        defender_power: dPow,
        strong_claim: hasStrongClaim,
        casualty: casualty ? casualty.id : "",
      },
    });

    // Mint a truce so neither party immediately rekindles the same war.
    // This runs AFTER the WAR event so the truce comes logically after the fight.
    const truceDuration = w.rng.int(10, 15);
    mintTruce(w, winner.id, loser.id, truceDuration);
  }
}

function seizeVacantTitle(
  w: World,
  title: Title,
  attacker: Character,
  priority: number,
): void {
  transferTitle(title, attacker);
  w.log("WAR", {
    actorId: attacker.id,
    targetId: null,
    titleId: title.id,
    provinceId: title.provinceId,
    data: { title: title.name, attacker_won: true, vacant: true, priority },
  });
}

// Move a title to a new holder, re-seating them at its province. Any residual
// claim for the previous holder is minted by the caller (so a defeated lord
// keeps a grievance to press another day).
function transferTitle(title: Title, to: Character): void {
  title.holderId = to.id;
  to.provinceId = title.provinceId;
}

// ---------------------------------------------------------------------------
// Lowborn rise — when a vacant title has NO living claimant in any noble line,
// the discontented pops of its province can throw up a leader who seizes it and
// founds a new dynasty. This is the social-mobility seam: a commoner enters the
// inheritance system and starts a house of his own. (A light v1 stand-in for
// the full multi-scale mobility engine.)
// ---------------------------------------------------------------------------
function maybeLowbornRise(w: World, title: Title): boolean {
  if (title.law === "clan_elder") {
    // Random commoners cannot claim a clan_elder hold. But if the hold is
    // subsurface and the founding bloodline is spent, a new dwarf clan may
    // rise from the deep — an age-of-legend event, rare by design.
    return maybeDwarfClanFounding(w, title);
  }
  // Only when nobody, anywhere, holds a claim to this title.
  const anyClaimant = [...w.characters.values()].some(
    (c) => c.alive && c.claims.some((cl) => cl.titleId === title.id),
  );
  if (anyClaimant) return false;

  const prov = w.province(title.provinceId);
  if (!prov) return false;
  // Hungrier, larger populations are likelier to produce an upstart.
  const pressure = scarcity(prov);
  if (!w.rng.chance(0.4 + pressure * 0.3)) return false;

  // Found the new house.
  const dyn = createDynasty(w, commonSurname(w.rng), "");
  const riser = createCharacter(w, {
    sex: w.rng.chance(0.85) ? "male" : "female",
    dynastyId: dyn.id,
    birthYear: w.year - w.rng.int(20, 40),
    provinceId: title.provinceId,
    drives: { ...randomDrives(w.rng), ambition: w.rng.float(0.7, 0.98) },
    lowborn: true,
  });
  dyn.founderId = riser.id;
  title.holderId = riser.id;
  addClaim(riser, {
    titleId: title.id,
    strength: "strong",
    basis: `seized in the troubles of ${w.year}`,
    year: w.year,
  });

  w.log("LOWBORN_RISE", {
    actorId: riser.id,
    titleId: title.id,
    provinceId: title.provinceId,
    data: { house: dyn.name, title: title.name },
  });
  return true;
}

// When a subsurface clan_elder hold is vacant and its founding bloodline is
// spent, a new dwarf clan may form from the deep folk — once per ~10 years on
// average. The new clan takes the culture/race/faith of any surviving dwarf
// dynasty in the world (so the flavour stays consistent even if the original
// house is gone). Logged as LOWBORN_RISE to reuse the existing sifter/renderer
// path rather than introducing a new event type.
function maybeDwarfClanFounding(w: World, title: Title): boolean {
  const prov = w.province(title.provinceId);
  if (!prov?.subsurface) return false;
  if (!w.rng.chance(0.1)) return false;

  // Find a dwarf cultural template to stamp the new clan with.
  const refDyn = [...w.dynasties.values()].find((d) => d.raceId === "dwarf");
  if (!refDyn) return false;

  const dyn = createDynasty(w, commonSurname(w.rng), "", {
    culture: refDyn.cultureId,
    race: refDyn.raceId,
    faith: refDyn.faithId,
  });
  const founder = createCharacter(w, {
    sex: w.rng.chance(0.85) ? "male" : "female",
    dynastyId: dyn.id,
    birthYear: w.year - w.rng.int(40, 80), // experienced, not a youth
    provinceId: title.provinceId,
    drives: { ...randomDrives(w.rng), ambition: w.rng.float(0.6, 0.9), greed: w.rng.float(0.65, 0.9) },
    lowborn: true,
  });
  dyn.founderId = founder.id;
  title.holderId = founder.id;
  addClaim(founder, {
    titleId: title.id,
    strength: "strong",
    basis: `new clan founded the hold in ${w.year}`,
    year: w.year,
  });
  w.log("LOWBORN_RISE", {
    actorId: founder.id,
    titleId: title.id,
    provinceId: title.provinceId,
    data: { house: dyn.name, title: title.name },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Marriages — every unwed title-holder seeks a match (heirs keep dynasties
// alive). Prefer an unwed noble of another house (an alliance); if none exists,
// a spouse is married in from a minor/foreign house so the line can continue.
// ---------------------------------------------------------------------------
function runMarriages(w: World): void {
  // First: try to fill empty thrones whose bloodline died out, before marrying.
  for (const title of w.titles.values()) {
    if (!title.holderId) maybeLowbornRise(w, title);
  }

  // Only the dynastically RELEVANT marry in the sim: those who hold a title or
  // carry a claim (heirs, cadets, pretenders). Spares with neither stay single,
  // which keeps the named cast centred on the lineages that drive the story
  // rather than ballooning into a full population census. (When a parent dies,
  // passed-over children are minted claims — so they become "relevant" and
  // marriageable exactly when they start to matter to the succession.)
  const eligible = w.adults().filter((c) => {
    if (c.spouseId) return false;
    const raceId = w.raceIdOf(c);
    const race = raceId ? w.races.get(raceId) : undefined;
    const ageLimit = race?.biology ? Math.round(getBiology(race).lifespan * 0.35) : 50;
    if (w.age(c) > ageLimit) return false;
    return w.titlesHeldBy(c.id).length > 0 || c.claims.length > 0;
  });

  for (const c of eligible) {
    if (c.spouseId) continue; // may have been wed earlier this pass
    const partner = findDomesticPartner(w, c) ?? makeForeignSpouse(w, c);
    if (partner) wed(w, c, partner);
  }
}

function findDomesticPartner(w: World, c: Character): Character | null {
  const wantSex = c.sex === "male" ? "female" : "male";
  const candidates = w.adults().filter((o) => {
    if (o.spouseId || o.sex !== wantSex) return false;
    if (o.id === c.id) return false;
    if (o.dynastyId === c.dynastyId) return false; // no close-kin marriage in v1
    const oRaceId = w.raceIdOf(o);
    const oRace = oRaceId ? w.races.get(oRaceId) : undefined;
    const partnerAgeLimit = oRace?.biology ? Math.round(getBiology(oRace).lifespan * 0.35) : 50;
    if (w.age(o) > partnerAgeLimit) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  // Prefer a partner who brings power (lands/claims) — alliances are strategic.
  candidates.sort((a, b) => w.power(b) + b.claims.length - (w.power(a) + a.claims.length));
  return candidates[0];
}

// Marry in an outsider from a minor house. This keeps the simulation from
// collapsing for want of partners and quietly introduces fresh bloodlines
// (and, occasionally, the founders of future rival dynasties).
function makeForeignSpouse(w: World, c: Character): Character {
  const wantSex = c.sex === "male" ? "female" : "male";
  // A lightweight foreign house — reuse one per few years to avoid a flood.
  // It takes on the local people (culture/race/faith of the house it marries
  // into) so the married-in spouse is named and tempered like the region.
  const home = w.dynasty(c.dynastyId);
  const dyn = createDynasty(w, `${commonSurname(w.rng)}`, "", {
    culture: home?.cultureId,
    race: home?.raceId,
    faith: home?.faithId,
  });
  const spouse = createCharacter(w, {
    sex: wantSex,
    dynastyId: dyn.id,
    birthYear: w.year - w.rng.int(16, 30),
    provinceId: c.provinceId,
  });
  dyn.founderId = spouse.id;
  return spouse;
}

function wed(w: World, a: Character, b: Character): void {
  a.spouseId = b.id;
  b.spouseId = a.id;
  // The wife joins the husband's seat (patrilocal in v1).
  if (a.sex === "male") b.provinceId = a.provinceId;
  else a.provinceId = b.provinceId;
  w.adjustOpinion(a, b.id, 20);
  w.adjustOpinion(b, a.id, 20);
  w.log("MARRIAGE", {
    actorId: a.id,
    targetId: b.id,
    provinceId: a.provinceId,
    data: { houses: `${w.dynasty(a.dynastyId)?.name}-${w.dynasty(b.dynastyId)?.name}` },
  });
}

// ---------------------------------------------------------------------------
// Opinion drift — a gentle mean-reversion toward neutral plus a steady chill
// toward known schemers. This is the social-adaptation seed: behaviour observed
// over time reshapes who will deal with whom.
// ---------------------------------------------------------------------------
function opinionDrift(w: World): void {
  for (const c of w.living()) {
    // Dwarfs never forgive — negative opinions are immortal. This is the grudge
    // immortality that makes their long-simmering feuds feel true to the lore.
    const isDwarf = w.dynasty(c.dynastyId)?.raceId === "dwarf";
    for (const otherId of Object.keys(c.opinion)) {
      const other = w.char(otherId);
      if (!other) continue;
      let v = c.opinion[otherId];
      // Mean-revert toward 0, but dwarfs never forgive negative opinions.
      if (!(isDwarf && v < 0)) {
        v += v > 0 ? -1 : v < 0 ? 1 : 0;
      }
      // Known schemers keep losing the room.
      if (other.reputation.schemer > 0.4) v -= 1;
      c.opinion[otherId] = Math.max(-100, Math.min(100, v));
    }
  }
}

// ---------------------------------------------------------------------------
// Dynasty extinction — the quiet tragedies. When a house's last member dies it
// is marked extinct exactly once; the sifter loves these.
// ---------------------------------------------------------------------------
function detectExtinctions(w: World): void {
  for (const dyn of w.dynasties.values()) {
    if (dyn.extinctYear !== null) continue;
    const members = w.dynastyMembers(dyn.id);
    if (members.length === 0) {
      // Only chronicle the fall of houses that ever actually held land/mattered.
      const mattered = hadHistory(w, dyn.id);
      dyn.extinctYear = w.year;
      if (mattered) {
        w.log("DYNASTY_EXTINCT", {
          data: { house: dyn.name, founded: foundingYear(w, dyn.id) },
        });
      }
    }
  }
}

function hadHistory(w: World, dynId: string): boolean {
  // A house "mattered" if any of its (now dead) members ever held a title.
  for (const ev of w.events) {
    if (ev.type === "SUCCESSION" && ev.data["title"]) {
      const heir = w.char(ev.actorId);
      if (heir && heir.dynastyId === dynId) return true;
    }
    if (ev.type === "LOWBORN_RISE") {
      const r = w.char(ev.actorId);
      if (r && r.dynastyId === dynId) return true;
    }
  }
  return false;
}

function foundingYear(w: World, dynId: string): number {
  let min = Infinity;
  for (const c of w.characters.values()) {
    if (c.dynastyId === dynId) min = Math.min(min, c.birthYear);
  }
  return Number.isFinite(min) ? min : w.year;
}
