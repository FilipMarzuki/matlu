// magic.ts — the leveling / magic layer (only runs when World.magicEnabled).
//
// Design thread this implements (see README's "Magic layer" section):
//   • Leveling is driven by the SIFTER's own logic — you grow from doing
//     dangerous, significant things. Comfort and safety throttle it.
//   • Levels are gated by INHERITED CAPITAL (wealth, a house's rare class-rite,
//     noble access) — the Matthew effect — so power concentrates in houses.
//   • But three forces keep it from ossifying:
//       (+) capital concentrates power            [accrual]
//       (−) COMFORT rots the entrenched from within: too many advantages remove
//           the real risk that leveling requires, and the will to seek it; the
//           cost of buying levels rises exponentially and hits a hard wall.
//       (−) CATASTROPHE (war/plague) culls the high-level tier and severs the
//           transmission of rites — handled by phenomena + maintainRites here.
//   • Knowledge (rare class-rites) lives in houses and is LOST if its last
//     master dies un-transmitted (Ibn Khaldun / Henrich: forgetting is default).
//
// The net effect we're hunting for in the chronicle: third-generation decline,
// frontier houses eclipsing the soft core, and the rare low-born breakout.

import { getBiology } from "./biology.js";
import { scarcity } from "./geography.js";
import { dynastyWealthSynergy, economicBonus } from "./innovation.js";
import { markDead } from "./phenomena.js";
import type { CharClass, Character, Dynasty, Province, RareClass, WorldEvent } from "./types.js";
import type { World } from "./world.js";

const RARE: ReadonlySet<CharClass> = new Set(["warden", "stormcaller", "necromancer"]);

// Highest level reached by anyone in this world so far — so we can chronicle the
// rare moment a new "mightiest soul of the age" emerges. Per-world (keyed) so
// multiple runs don't interfere.
const peakLevel = new WeakMap<World, number>();

// Past this level, no amount of safe training (SHELTER) helps — the only way up
// is real, lethal peril (TEMPER). This is the "comfortable plateau".
// The comfortable plateau: safe training (SHELTER) buys levels only up to here.
// Past it, the only way up is real, lethal risk (TEMPER / venture / war). Kept
// low so the achievable range has real headroom ABOVE the plateau — most
// nobles cluster at ~8, risk-takers reach the heroic tier (12), and the rare
// long-lived warlord becomes a titan (16+).
const L_SAFE = 8;
const LEVEL_CAP = 40;
// Milestones worth chronicling — all above the plateau, so any one of them
// means its subject took real risks to get there.
const MILESTONES = [12, 16, 20, 25, 30];

// ───────────────────────────────────────────────────────────────────────────
// One-time initialisation: seed the world with starting wealth, rare class
// rites, and leveled-up founders (the seed kings didn't get where they are at
// level 1). Called from main.ts when --magic is passed.
// ───────────────────────────────────────────────────────────────────────────
export function magicInit(w: World): void {
  // Assign each great house its hereditary rite, and a starting treasury.
  const riteByHouse: Record<string, RareClass> = {
    Aldermark: "warden",
    Corvane: "necromancer",
    Halvar: "stormcaller",
  };
  for (const dyn of w.dynasties.values()) {
    dyn.wealth = 400;
    const rite = riteByHouse[dyn.name];
    if (rite) {
      dyn.rite = rite;
      // The bearer is the house's current ruler (or eldest member).
      const bearer = ruleOrEldest(w, dyn);
      if (bearer) {
        dyn.riteBearerId = bearer.id;
        bearer.charClass = rite;
      }
    }
  }

  // Give the founding cast classes and a head start in level, so the opening
  // generation already has texture (a king is not a level-1 farmer).
  for (const c of w.living()) {
    if (w.age(c) < 16) continue;
    if (c.charClass === "commoner") c.charClass = desiredClass(w, c);
    const holdsTitle = w.titlesHeldBy(c.id).length > 0;
    // Holders start as seasoned figures; their kin already have some standing
    // (so a house can transmit its rite through an ordinary succession).
    c.level = Math.max(c.level, holdsTitle ? 10 + w.rng.int(0, 4) : 3 + w.rng.int(0, 4));
    c.comfort = computeComfort(w, c);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Per-tick driver. `evStart` is w.events.length captured at the top of the
// tick, so events[evStart..] are exactly THIS year's events — the deeds people
// level from. (We slice before logging any of our own events.)
// ───────────────────────────────────────────────────────────────────────────
export function runMagic(w: World, evStart: number): void {
  const yearEvents = w.events.slice(evStart);

  // 1. Refresh derived state for every living adult.
  for (const c of w.living()) {
    c.ventured = false;
    if (w.age(c) >= 16) {
      if (c.charClass === "commoner") c.charClass = desiredClass(w, c);
      c.comfort = computeComfort(w, c);
    }
  }

  // 2. People level from what happened to them this year.
  accrueFromEvents(w, yearEvents);

  // 3. The hungry seek danger on their own (the striving / exile engine).
  runVentures(w);

  // 4. Houses earn, then spend wealth forging their heirs.
  accrueWealth(w);
  cultivateHeirs(w);

  // 5. Knowledge survives only if transmitted; otherwise a rite is lost.
  maintainRites(w);
}

// ───────────────────────────────────────────────────────────────────────────
// Capital, comfort, peril — the derived quantities the whole model turns on.
// ───────────────────────────────────────────────────────────────────────────

// Inherited capital, ~0..2: the leg-up a character's house gives them. Wealth +
// access to a rare rite + being landed. Drives leveling EFFICIENCY (tutors,
// gear) and gates rare classes.
function capital(w: World, c: Character): number {
  const dyn = w.dynasty(c.dynastyId);
  const wealth01 = dyn ? Math.min(1, dyn.wealth / 1000) : 0;
  const rite = dyn?.rite ? 0.6 : 0;
  const landed = houseHoldsTitle(w, dyn) ? 0.4 : 0;
  return wealth01 + rite + landed;
}

// Comfort, 0..1: safety and luxury. RISES with capital, landed seats, age and
// a peaceful home — and FALLS with a perilous province. High comfort both
// throttles XP (less real risk) and saps the will to chase danger.
function computeComfort(w: World, c: Character): number {
  const dyn = w.dynasty(c.dynastyId);
  const wealth01 = dyn ? Math.min(1, dyn.wealth / 1000) : 0;
  const landed = houseHoldsTitle(w, dyn) ? 0.25 : 0;
  const established = w.age(c) > 40 ? 0.15 : 0;
  const prov = w.province(c.provinceId);
  const peril = prov ? provincePeril(w, prov) : 0.3;
  return clamp01(wealth01 * 0.5 + landed + established - peril * 0.3);
}

// Peril, 0..1: how dangerous a province is — and danger is what mints levels.
// Wild mana, scarcity (desperation), and being a contested BORDER all raise it.
// The safe fertile interior is low-peril and breeds soft, high-comfort houses.
export function provincePeril(w: World, prov: Province): number {
  const s = scarcity(prov);
  const border = isBorder(w, prov) ? 0.35 : 0;
  return clamp01(0.25 * prov.manaDensity + 0.4 * Math.max(0, s - 0.8) + border);
}

function isBorder(w: World, prov: Province): boolean {
  const t = w.title(prov.titleId);
  const ownerDyn = w.char(t?.holderId ?? null)?.dynastyId;
  if (!ownerDyn) return true; // a vacant/contested seat is perilous
  for (const nId of prov.neighbors) {
    const np = w.province(nId);
    const nt = w.title(np?.titleId ?? null);
    const nDyn = w.char(nt?.holderId ?? null)?.dynastyId;
    if (nDyn && nDyn !== ownerDyn) return true;
  }
  return false;
}

// Leveling efficiency from capital (tutors, gear): monotonic up. On its own this
// would make the rich level fastest — but capital also raises comfort, which
// cuts riskFraction, and the product of the two peaks at MODERATE capital. That
// inverted-U is the striving-middle / cadet-son engine.
function capitalEff(w: World, c: Character): number {
  return 1 + 0.6 * capital(w, c);
}
function riskFraction(c: Character): number {
  return clamp(1 - c.comfort, 0.15, 1);
}

// ───────────────────────────────────────────────────────────────────────────
// XP & leveling.
// ───────────────────────────────────────────────────────────────────────────

// XP needed to advance FROM `level`. Grows exponentially, so the top tier is
// sticky and slow to refill — easy to lose (one death), hard to regain.
function levelCost(level: number): number {
  return Math.round(5 * Math.pow(1.16, level));
}

function addXp(w: World, c: Character, gain: number): void {
  if (gain <= 0 || c.level >= LEVEL_CAP) return;
  // Biology: mana-attuned races gain XP faster; manaAffinity=0.5 is neutral
  // (human baseline). Scale by affinity/0.5 so 0.5→1×, 0.7→1.4×, 0.25→0.5×.
  const raceId = w.raceIdOf(c);
  const race = raceId ? w.races.get(raceId) : undefined;
  if (race?.biology) gain = gain * (getBiology(race).manaAffinity / 0.5);
  c.lifeXp += gain;
  while (c.lifeXp >= levelCost(c.level) && c.level < LEVEL_CAP) {
    c.lifeXp -= levelCost(c.level);
    const from = c.level;
    c.level++;
    onLevelUp(w, c, from, c.level);
  }
}

function onLevelUp(w: World, c: Character, from: number, to: number): void {
  // The self-made breakthrough: someone with ~no inherited capital reaching the
  // heroic tier on sheer deed. We fire it for genuine low-born risers and for
  // strivers of houses with no land, no rite and no claim — but NOT for cadets
  // of the great houses (who'd be mislabelled "born to nothing").
  const dyn = w.dynasty(c.dynastyId);
  const selfMade =
    c.lowborn || (!houseHoldsTitle(w, dyn) && !dyn?.rite && c.claims.length === 0);
  if (from < 10 && to >= 10 && selfMade) {
    w.log("HERO_RISEN", {
      actorId: c.id,
      provinceId: c.provinceId,
      data: { level: to, class: c.charClass, house: dyn?.name ?? "" },
    });
  }

  // A new "mightiest of the age": whenever someone breaks the world record for
  // raw power. Self-pacing — it fires only on genuine new peaks, so it's a rare,
  // earned beat rather than a flood.
  const rec = peakLevel.get(w) ?? 11;
  if (to > rec && to >= 12) {
    peakLevel.set(w, to);
    w.log("LEVELED", {
      actorId: c.id,
      provinceId: c.provinceId,
      data: { level: to, class: c.charClass, ascendant: true },
    });
    return; // don't also fire the ordinary milestone line for the same step
  }

  // Chronicle a milestone only when it's genuinely remarkable: a rare-class
  // master coming into their power, or a true titan (16+). A common knight
  // hitting the plateau-cap of 12 is not news — it's the texture, not the story.
  if (!(RARE.has(c.charClass) || to >= 16)) return;
  for (const m of MILESTONES) {
    if (from < m && to >= m) {
      w.log("LEVELED", {
        actorId: c.id,
        provinceId: c.provinceId,
        data: { level: to, class: c.charClass },
      });
      break;
    }
  }
}

// People level from the year's significant, risky deeds. The base value per
// deed echoes the sifter's own significance ranking (war > murder > surviving a
// plague), scaled by the actor's capital and how much real risk they faced.
function accrueFromEvents(w: World, events: WorldEvent[]): void {
  const award = (id: string | null, base: number) => {
    const c = w.char(id);
    if (!c || !c.alive || w.age(c) < 16) return;
    addXp(w, c, base * capitalEff(w, c) * riskFraction(c));
  };
  // War is real, lethal risk for whoever leads it — even a pampered king is on
  // the field. So war XP is only lightly damped by comfort (floored at 0.6).
  // This is what lets a WARLIKE ruler keep climbing past the plateau while a
  // peaceful, comfortable one stagnates — the warrior-king vs the soft-king.
  const awardWar = (id: string | null, base: number) => {
    const c = w.char(id);
    if (!c || !c.alive || w.age(c) < 16) return;
    addXp(w, c, base * capitalEff(w, c) * Math.max(0.6, riskFraction(c)));
  };

  for (const ev of events) {
    switch (ev.type) {
      case "WAR": {
        const underdog = ev.data["attacker_won"] && ev.data["defender_power"] && Number(ev.data["attacker_power"]) < Number(ev.data["defender_power"]);
        awardWar(ev.actorId, underdog ? 13 : 9); // attacker
        awardWar(ev.targetId, 7); // defender
        break;
      }
      case "MURDER":
        award(ev.actorId, 5); // a bold, lethal act under risk of discovery
        break;
      case "SCHEME_DISCOVERED":
        award(ev.actorId, 2); // survived exposure
        break;
      case "PLAGUE":
      case "FAMINE": {
        // Everyone who lived through it in the stricken province hardens a little.
        for (const c of w.living()) {
          if (c.provinceId === ev.provinceId && w.age(c) >= 16) {
            addXp(w, c, 1.5 * capitalEff(w, c) * riskFraction(c));
          }
        }
        break;
      }
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Ventures — the hungry go looking for danger. This is what lets the landless,
// the disinherited and the exiled (low comfort, real grievance) out-level the
// pampered trueborn heirs: they have everything to prove and put their lives on
// the line to prove it.
// ───────────────────────────────────────────────────────────────────────────
function runVentures(w: World): void {
  for (const c of w.living()) {
    if (w.age(c) < 16 || w.age(c) > 45) continue;
    if (w.titlesHeldBy(c.id).length > 0) continue; // rulers don't go adventuring
    const grievance = c.claims.length > 0 || c.grudges.length > 0 ? 0.2 : 0;
    const willingness =
      c.drives.ambition * 0.5 + (1 - c.comfort) * 0.5 + grievance - c.drives.fear * 0.3;
    if (willingness < 0.55) continue;
    if (!w.rng.chance(0.4)) continue;

    c.ventured = true;
    const prov = w.province(c.provinceId);
    const peril = prov ? provincePeril(w, prov) : 0.3;
    // Hardship + novelty = XP. No capital can buy down the risk of a real venture.
    addXp(w, c, 8 * (0.5 + peril) * capitalEff(w, c));
    // ...but the danger is real, and the bold sometimes don't come back.
    const death = clamp(0.02 + peril * 0.06 - capital(w, c) * 0.015, 0.005, 0.2);
    if (w.rng.chance(death)) markDead(w, c, "slain adventuring");
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Cultivation — houses spend wealth to forge an heir. SHELTER buys safe levels
// cheaply up to the plateau (L_SAFE) and raises comfort (sowing future decline);
// TEMPER buys big levels past the plateau but risks the heir's life. The cost
// rises exponentially with the heir's level — wealth can mint competence, never
// a hero.
// ───────────────────────────────────────────────────────────────────────────
function cultivateHeirs(w: World): void {
  for (const dyn of w.dynasties.values()) {
    if (dyn.wealth <= 0) continue;
    const holder = landedHolder(w, dyn);
    if (!holder) continue; // only landed houses can afford to cultivate

    const heir = pickHeirToCultivate(w, holder);
    if (!heir) continue;

    const cost = Math.round(20 * Math.pow(1.3, heir.level) * (1 + heir.comfort));
    if (dyn.wealth < cost) continue;
    dyn.wealth -= cost;

    // Bolder, more ambitious houses temper; cautious ones shelter. Past the
    // plateau, sheltering does nothing, so growth REQUIRES accepting real risk.
    const mustTemper = heir.level >= L_SAFE;
    const temperPref = holder.drives.ambition * 0.6 - holder.drives.fear * 0.4;
    const temper = mustTemper || (temperPref > 0.2 && w.rng.chance(0.5));

    if (!temper) {
      // SHELTER: safe training. Cheap levels, but only below the plateau, and
      // it makes the heir soft.
      if (heir.level < L_SAFE) addXp(w, heir, 11 * capitalEff(w, heir));
      heir.comfort = clamp01(heir.comfort + 0.05);
    } else {
      // TEMPER: send them into real peril. Big growth, real mortality.
      const before = heir.level;
      const prov = w.province(heir.provinceId);
      const peril = prov ? provincePeril(w, prov) : 0.3;
      addXp(w, heir, 22 * (0.6 + peril));
      heir.comfort = clamp01(heir.comfort - 0.06);
      const death = clamp(0.1 - capital(w, heir) * 0.02, 0.03, 0.15);
      if (w.rng.chance(death)) {
        markDead(w, heir, "tempering"); // the gamble that fails
      } else if (heir.level > before) {
        w.log("HEIR_TEMPERED", {
          actorId: heir.id,
          provinceId: heir.provinceId,
          data: { level: heir.level, house: dyn.name },
        });
      }
    }
  }
}

function pickHeirToCultivate(w: World, holder: Character): Character | null {
  // The holder's children of cultivable age, least-developed first (you invest
  // where there's room to grow).
  const kids = w
    .children(holder)
    .filter((k) => k.alive && w.age(k) >= 10 && w.age(k) <= 28 && k.level < LEVEL_CAP);
  if (kids.length === 0) return null;
  kids.sort((a, b) => a.level - b.level);
  return kids[0];
}

// ───────────────────────────────────────────────────────────────────────────
// Wealth — houses earn from the lands they hold. A simple sink/source so that
// cultivation competes with itself (and, conceptually, with war).
// ───────────────────────────────────────────────────────────────────────────
function accrueWealth(w: World): void {
  for (const dyn of w.dynasties.values()) {
    if (dyn.extinctYear !== null) continue;
    let income = 0;
    for (const t of w.titles.values()) {
      const holder = w.char(t.holderId);
      if (!holder || holder.dynastyId !== dyn.id) continue;
      const prov = w.province(t.provinceId);
      if (prov) income += prov.population / 100;
      income += t.tier === "kingdom" ? 10 : t.tier === "duchy" ? 5 : 3;
      // Class-holder productivity multiplier — a [Master Trader] holding a
      // seat brings dramatically more silver into the treasury than a
      // battle-hardened knight; a necromancer holding a seat pushes tax-
      // payers to flee. Level tacks on a further scholar/administrator
      // bonus above the "just competent" threshold.
      const classMult = WEALTH_CLASS_MULT[holder.charClass] ?? 1.0;
      const levelMult = holder.level >= 15
        ? 1 + Math.min(0.5, (holder.level - 14) * 0.03)  // +3% per level past 15, cap +50%
        : 1;
      // Invention-driven economic bonus — held craft-secrets multiply dynastic
      // income (textiles + printing above; each contributes tier-scaled multipliers).
      const invBonus = 1 + economicBonus(w, dyn.id);
      // Dynasty specialization synergy — a house of merchants/scholars gets a
      // super-linear boost that grows with member count × specializationDepth.
      // Historical: Medici, Rothschilds, Fugger — multi-generational commercial houses.
      const synBonus = 1 + dynastyWealthSynergy(w, dyn.id);
      income *= classMult * levelMult * invBonus * synBonus;
    }
    dyn.wealth = Math.min(5000, dyn.wealth + income);
  }
  // Personal wealth for craftsmen (Factor 2). Scholars and merchants at level
  // 3+ earn a personal wealth stream that DIES WITH THEM (transferred to top
  // apprentice on death via transferOnDeath). Enables the "personal-mastery"
  // path that competes with codified invention when IP protection is weak.
  for (const c of w.characters.values()) {
    if (!c.alive) continue;
    if (c.charClass !== "scholar" && c.charClass !== "merchant") continue;
    if (c.level < 3) continue;
    const base = 1.2;
    const classMult = c.charClass === "merchant" ? 1.5 : 1.25;
    const levelMult = 1 + (c.level - 2) * 0.05;
    c.personalWealth = Math.min(2000, c.personalWealth + base * classMult * levelMult);
  }
}

// Class → wealth-accrual multiplier for a title-holder. Merchants and
// scholars grow the treasury; martial classes hold the line; necromancers
// actively cost the ledger (people flee their lands).
const WEALTH_CLASS_MULT: Record<string, number> = {
  merchant:    1.5,
  scholar:     1.25,
  hunter:      1.1,
  knight:      1.0,
  soldier:     0.95,
  warden:      0.95,
  stormcaller: 1.0,
  necromancer: 0.75,
  commoner:    1.0,
};

// ───────────────────────────────────────────────────────────────────────────
// Rites — a house's rare class-rite is its most precious capital. It survives
// only if there's a living master to pass it to; otherwise the art dies with
// the last bearer. This is the knowledge-leak: forgetting is the default, and
// a war or plague that takes the bearer can erase an art from the world.
// ───────────────────────────────────────────────────────────────────────────
function maintainRites(w: World): void {
  for (const dyn of w.dynasties.values()) {
    if (!dyn.rite) continue;
    const bearer = w.char(dyn.riteBearerId);
    if (bearer && bearer.alive) continue; // still held

    // The bearer is gone — find a successor able to receive the art: a living
    // adult of the house with enough standing (level) to master it. The bar is
    // modest, so an art survives a healthy house's ordinary successions — but a
    // house reduced to children and nobodies (war, plague) loses it for good.
    const candidates = w
      .dynastyMembers(dyn.id)
      .filter((m) => w.age(m) >= 16 && m.level >= 4)
      .sort((a, b) => b.level - a.level);

    if (candidates.length > 0) {
      const heir = candidates[0];
      dyn.riteBearerId = heir.id;
      if (heir.charClass !== dyn.rite) {
        heir.charClass = dyn.rite;
        w.log("CLASS_GAINED", {
          actorId: heir.id,
          provinceId: heir.provinceId,
          data: { class: dyn.rite, house: dyn.name },
        });
      }
    } else {
      // No one is worthy — the art is lost to history.
      w.log("ART_LOST", {
        data: { class: dyn.rite, house: dyn.name },
      });
      dyn.rite = null;
      dyn.riteBearerId = null;
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Class assignment. Rare classes are HARD-gated (rite only, granted via
// maintainRites/magicInit). Mid classes are capital-gated (landed houses).
// Common classes are soft — anyone perilous-and-hungry enough can take one.
// ───────────────────────────────────────────────────────────────────────────
function desiredClass(w: World, c: Character): CharClass {
  if (RARE.has(c.charClass)) return c.charClass; // never demote a master
  const dyn = w.dynasty(c.dynastyId);
  // House tradition — a member of a specialized house is DRAWN to the family
  // craft (nepotism, apprenticeship, upbringing). Historical: Bernoulli
  // mathematicians, Habsburg soldiers, Rothschild bankers. The pull is strong
  // when specialization depth is high, weak otherwise.
  if (dyn?.dominantClass && dyn.specializationDepth >= 0.3
      && dyn.dominantClass !== "commoner"
      && !RARE.has(dyn.dominantClass)) {
    // Higher depth = stronger pull; even at ceiling, ambition/greed/piety can
    // still overrule (a merchant house can still produce a mystic). The pull
    // is soft: prob = 0.4 + 0.5 * depth, so a very deep house has 90% pull.
    if (w.rng.chance(0.4 + 0.5 * dyn.specializationDepth)) return dyn.dominantClass;
  }
  const noble = !!dyn?.rite || houseHoldsTitle(w, dyn);
  if (noble) {
    if (c.drives.greed > 0.6) return "merchant";
    if (c.drives.piety > 0.6) return "scholar";
    return "knight";
  }
  const prov = w.province(c.provinceId);
  const peril = prov ? provincePeril(w, prov) : 0.3;
  if (c.drives.ambition > 0.55 && peril > 0.4) return w.rng.chance(0.5) ? "soldier" : "hunter";
  if (c.drives.ambition > 0.72) return "soldier";
  return "commoner";
}

// ───────────────────────────────────────────────────────────────────────────
// Small queries.
// ───────────────────────────────────────────────────────────────────────────
function houseHoldsTitle(w: World, dyn: Dynasty | undefined): boolean {
  if (!dyn) return false;
  for (const t of w.titles.values()) {
    const h = w.char(t.holderId);
    if (h && h.dynastyId === dyn.id) return true;
  }
  return false;
}

function landedHolder(w: World, dyn: Dynasty): Character | null {
  for (const t of w.titles.values()) {
    const h = w.char(t.holderId);
    if (h && h.dynastyId === dyn.id) return h;
  }
  return null;
}

function ruleOrEldest(w: World, dyn: Dynasty): Character | null {
  return landedHolder(w, dyn) ?? w.dynastyMembers(dyn.id)[0] ?? null;
}

// The living characters with the highest levels — "the mightiest of the age",
// used by the epilogue.
export function topHeroes(w: World, n: number): Character[] {
  return w
    .living()
    .filter((c) => c.level >= 2)
    .sort((a, b) => b.level - a.level)
    .slice(0, n);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function clamp01(x: number): number {
  return clamp(x, 0, 1);
}
