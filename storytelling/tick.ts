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
import { regrowPopulation, scarcity } from "./geography.js";
import { regenerateGoals } from "./goals.js";
import { runMagic } from "./magic.js";
import { addClaim, resolveSuccession } from "./inheritance.js";
import { commonSurname } from "./names.js";
import { markDead, runHarvest, runPlague } from "./phenomena.js";
import { createCharacter, createDynasty, inheritDrives, randomDrives } from "./people.js";
import { advanceSchemes, spawnSchemes } from "./schemes.js";
import type { Character, Title } from "./types.js";
import type { World } from "./world.js";

export function tick(w: World): void {
  w.year++;

  // Mark where this year's events begin, so the magic layer can level people
  // from exactly the deeds done this year (and nothing earlier).
  const evStart = w.events.length;

  // --- Environmental layer: geography + natural phenomena ----------------
  // Catastrophes run first so province state is updated before population
  // growth, harvest, and plague read it this tick.
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
  resolvePendingSuccessions(w);

  // --- regenerate goals --------------------------------------------------
  regenerateGoals(w);

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

  // --- magic / leveling layer (no-op unless enabled) ---------------------
  // Runs last: it reads the year's events to grow people, then advances the
  // capital/comfort/rite economy. Kept after the base loop so base behaviour is
  // byte-identical when magic is off.
  if (w.magicEnabled) runMagic(w, evStart);
}

// ---------------------------------------------------------------------------
// Mortality — age-driven, with a famine/plague boost handled separately in
// phenomena.ts. A gentle baseline plus a steep climb after ~60 gives realistic
// reign lengths and the occasional heirless old king.
// ---------------------------------------------------------------------------
function runMortality(w: World): void {
  for (const c of w.living()) {
    const age = w.age(c);
    let p = 0.006; // baseline annual hazard
    if (age < 3) p += 0.03; // infant mortality
    if (age > 50) p += (age - 50) * 0.004;
    if (age > 70) p += (age - 70) * 0.02; // old age catches up fast
    if (age > 90) p += 0.15;
    if (w.rng.chance(Math.min(0.9, p))) {
      markDead(w, c, age > 60 ? "old age" : "illness");
    }
  }
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
    if (age < 16 || age > 45) continue;
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
    lowborn: false,
    level: 1,
    lifeXp: 0,
    charClass: "commoner",
    comfort: 0,
    ventured: false,
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
    const aPow = w.power(attacker);
    const dPow = w.power(defender);
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

    // Victory probability from relative power, nudged by a strong claim's
    // legitimacy (it rallies more support).
    const claimEdge = hasStrongClaim ? 0.15 : 0;
    const pWin = Math.min(0.92, Math.max(0.08, aPow / (aPow + dPow) + claimEdge));
    const attackerWins = w.rng.chance(pWin);

    const winner = attackerWins ? attacker : defender;
    const loser = attackerWins ? defender : attacker;

    if (attackerWins) {
      transferTitle(title, attacker);
    }
    // The loser is minted a (renewed) weak claim — wars rarely truly end.
    addClaim(loser, {
      titleId: title.id,
      strength: "weak",
      basis: `lost the war of ${w.year}`,
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
  const eligible = w
    .adults()
    .filter(
      (c) =>
        !c.spouseId &&
        w.age(c) <= 50 &&
        (w.titlesHeldBy(c.id).length > 0 || c.claims.length > 0),
    );

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
    if (w.age(o) > 50) return false;
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
    for (const otherId of Object.keys(c.opinion)) {
      const other = w.char(otherId);
      if (!other) continue;
      let v = c.opinion[otherId];
      // Mean-revert by 1 toward 0.
      v += v > 0 ? -1 : v < 0 ? 1 : 0;
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
