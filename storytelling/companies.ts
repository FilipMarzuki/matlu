// companies.ts — persistent piracy fleets and mercenary companies.
//
// One-shot events for these already exist as spec triggers
// (MERCENARY_COMPANY_RAISED / PIRATE_CONFEDERATION). This module upgrades a
// subset of them into persistent entities that:
//
//   mercenary — signs contracts, marches for gold, and if left unpaid too
//               long can turn CONDOTTIERE and seize a province they were
//               supposed to protect (Francesco Sforza 1450 pattern).
//   pirate    — operates from a coastal hub. Raids other coastal provinces;
//               can be busted in a naval battle; crown a captain to rule.
//
// Not guarded on any flag — companies happen everywhere. Base hashes will
// move.

import type {
  Character,
  Company,
  CompanyId,
  CompanyKind,
} from "./types.js";
import type { World } from "./world.js";

// ---- tuning constants ------------------------------------------------------
const MERC_FORMATION_PROB = 0.015;   // per year — a war-hardened knight/warlord raises a company
const PIRATE_FORMATION_PROB = 0.008; // per year — a coastal captain launches a fleet
const MAX_ACTIVE_COMPANIES = 8;
const HIRE_PROB = 0.15;              // per active merc per idle year
const CONDOTTIERE_YEARS = 6;         // years unpaid before seizure attempt
const CONDOTTIERE_PROB = 0.35;       // per eligible year
const PIRATE_RAID_PROB = 0.20;       // per active pirate per year
const PIRATE_BUST_PROB = 0.06;       // per active pirate per year
const CAPTAIN_DEATH_DISBAND = 0.35;  // chance a captain-loss disbands company

// Called from tick.ts once per year, AFTER resolveWars so mercenary spawns
// key off this year's fighting.
export function runCompanies(w: World): void {
  detectNewCompanies(w);
  ageCompanies(w);
  disbandOnCaptainDeath(w);
}

// ---------------------------------------------------------------------------
// Detect new companies. Mercenary formation: a level-10+ knight/soldier with
// a WAR event this year, in a wealthy province. Pirate formation: a coastal
// province with recent PIRATE_RAID activity.
// ---------------------------------------------------------------------------
function detectNewCompanies(w: World): void {
  if (w.activeCompanies().length >= MAX_ACTIVE_COMPANIES) return;

  // Mercenary company: war-hardened officer raises the flag.
  if (w.rng.chance(MERC_FORMATION_PROB)) {
    const captain = pickMercenaryCaptain(w);
    if (captain) mintCompany(w, "mercenary", captain);
  }

  // Pirate fleet: coastal hub with active raid history.
  if (w.rng.chance(PIRATE_FORMATION_PROB)) {
    const captain = pickPirateCaptain(w);
    if (captain) mintCompany(w, "pirate", captain);
  }
}

function pickMercenaryCaptain(w: World): Character | null {
  // A war within the last 5 years puts a knight/soldier into "battle-hardened"
  // territory. We don't insist the war just happened; the company can rise
  // in its aftermath.
  const warActors = new Set<string>();
  for (const ev of w.events) {
    if (ev.type !== "WAR" || w.year - ev.year > 5) continue;
    if (ev.actorId) warActors.add(ev.actorId);
  }
  const candidates: Character[] = [];
  for (const cid of warActors) {
    const c = w.char(cid);
    if (!c || !c.alive) continue;
    if (c.level < 8) continue;
    if (c.charClass !== "knight" && c.charClass !== "soldier") continue;
    if ([...w.companies.values()].some((co) => co.captainId === c.id && co.disbandedYear === null)) continue;
    candidates.push(c);
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(w.rng.next() * candidates.length)];
}

function pickPirateCaptain(w: World): Character | null {
  // Piracy needs a maritime backdrop — either recent PIRATE_RAID activity
  // OR any active PIRATE_CONFEDERATION events in the last 20y. The captain
  // themselves lives in a coastal province with a martial class.
  const anyMaritimePriors = w.events.some(
    (e) => (e.type === "PIRATE_RAID" || e.type === "PIRATE_CONFEDERATION" || e.type === "PIRATE_BLACK_FLAG")
        && w.year - e.year <= 20,
  );
  if (!anyMaritimePriors) return null;
  const candidates: Character[] = [];
  for (const c of w.living()) {
    if (c.level < 6) continue;
    if (c.charClass !== "soldier" && c.charClass !== "hunter" && c.charClass !== "knight" && c.charClass !== "commoner") continue;
    const prov = w.province(c.provinceId);
    if (!prov?.coastal) continue;
    if ([...w.companies.values()].some((co) => co.captainId === c.id && co.disbandedYear === null)) continue;
    candidates.push(c);
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(w.rng.next() * candidates.length)];
}

function mintCompany(w: World, kind: CompanyKind, captain: Character): void {
  const id: CompanyId = w.freshId("co");
  const name = procedurallyName(w, kind, captain);
  const company: Company = {
    id,
    name,
    kind,
    captainId: captain.id,
    homeProvinceId: captain.provinceId,
    memberCount: 60 + Math.floor(w.rng.next() * 140),
    wealth: 0.3,
    prestige: kind === "mercenary" ? 0.4 : 0.3,
    formedYear: w.year,
    disbandedYear: null,
    disbandedReason: null,
    contractHolderId: null,
    yearsUnpaid: 0,
    raidTargetProvinceIds: [],
    lastActionYear: w.year,
  };
  w.companies.set(id, company);
  w.log("COMPANY_FORMED", {
    actorId: captain.id,
    provinceId: captain.provinceId,
    data: {
      companyId: id,
      company: name,
      kind,
      captain: captain.name,
      memberCount: company.memberCount,
    },
  });
}

const MERC_NAME_ROOTS = [
  "the Black Company", "the White Wolves", "the Iron Crows", "the Grey Sword",
  "the Ninth Legion", "the Red Feathers", "the Long Vigil", "the Wild Boars",
  "the Ashen Hand", "the Broken Lance",
];
const PIRATE_NAME_ROOTS = [
  "the Salt Fleet", "the Red Sail Company", "the Grey Gull", "the Nine Kings' Fleet",
  "the Broken Anchor Brotherhood", "the Deep-Chorus", "the Ember Wake",
  "the Twin-Fang Fleet", "the Star-Bound Fleet",
];

function procedurallyName(w: World, kind: CompanyKind, captain: Character): string {
  const pool = kind === "mercenary" ? MERC_NAME_ROOTS : PIRATE_NAME_ROOTS;
  const base = pool[Math.floor(w.rng.next() * pool.length)];
  // 20% of the time, name after the captain — "Sforza's Company", "Blackbeard's Fleet".
  if (w.rng.chance(0.2)) {
    return kind === "mercenary" ? `${captain.name}'s Company` : `${captain.name}'s Fleet`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Age active companies. Mercenaries: idle → try to get hired; long-idle →
// turn condottiere; contracted → age contract, occasional payment issue.
// Pirates: raid targets, get busted sometimes.
// ---------------------------------------------------------------------------
function ageCompanies(w: World): void {
  for (const co of w.activeCompanies()) {
    // Captain still alive?
    const captain = w.char(co.captainId);
    if (!captain || !captain.alive) continue; // handled in disbandOnCaptainDeath

    if (co.kind === "mercenary") ageMercenary(w, co);
    else agePirate(w, co, captain);
  }
}

function ageMercenary(w: World, co: Company): void {
  if (co.contractHolderId) {
    // Contract active — decay slowly; occasional payment lapses.
    co.wealth = Math.min(1, co.wealth + 0.02);
    // 10% chance per year the paying holder fails to pay this year.
    if (w.rng.chance(0.1)) co.yearsUnpaid++;
    else co.yearsUnpaid = 0;
    // Contract may end — either the war it was hired for concludes, or the
    // patron stops paying. Simple model: 20% chance per year the contract ends.
    if (w.rng.chance(0.2)) {
      co.contractHolderId = null;
    }
  } else {
    // Idle — try to get hired.
    co.wealth = Math.max(0, co.wealth - 0.01);
    co.yearsUnpaid++;
    if (w.rng.chance(HIRE_PROB)) {
      // Pick a random title-holder with an active war.
      const wars = w.events.filter((e) => e.type === "WAR" && w.year - e.year <= 2);
      const potentialPatrons = wars
        .map((e) => w.char(e.actorId))
        .filter((c): c is Character => !!c && c.alive);
      if (potentialPatrons.length > 0) {
        const patron = potentialPatrons[Math.floor(w.rng.next() * potentialPatrons.length)];
        co.contractHolderId = patron.id;
        co.yearsUnpaid = 0;
        w.log("COMPANY_HIRED", {
          actorId: patron.id,
          provinceId: patron.provinceId,
          data: {
            companyId: co.id,
            company: co.name,
            patron: patron.name,
          },
        });
      }
    }
  }

  // Condottiere strike: unpaid too long AND at the paying holder's province.
  if (co.yearsUnpaid >= CONDOTTIERE_YEARS && w.rng.chance(CONDOTTIERE_PROB)) {
    tryCondottiere(w, co);
  }
}

function tryCondottiere(w: World, co: Company): void {
  // Find a province the company's captain occupies; seize the title if any.
  const captain = w.char(co.captainId);
  if (!captain) return;
  const provTitle = [...w.titles.values()].find((t) => t.provinceId === captain.provinceId);
  if (!provTitle) return;
  const oldHolder = w.char(provTitle.holderId);
  // Don't seize your OWN company's contract-holder's title (that'd be
  // self-cannibalising politics; interesting later, but too messy now).
  if (oldHolder && co.contractHolderId === oldHolder.id) return;

  // Transfer.
  provTitle.holderId = captain.id;
  co.yearsUnpaid = 0;
  co.contractHolderId = null;
  co.prestige = Math.min(1, co.prestige + 0.2);
  w.log("COMPANY_TURNS_CONDOTTIERE", {
    actorId: captain.id,
    titleId: provTitle.id,
    provinceId: captain.provinceId,
    data: {
      companyId: co.id,
      company: co.name,
      captain: captain.name,
      title: provTitle.name,
      formerHolder: oldHolder?.name ?? "vacant",
    },
  });
}

function agePirate(w: World, co: Company, captain: Character): void {
  if (w.rng.chance(PIRATE_RAID_PROB)) {
    // Raid a nearby coastal province.
    const homeProv = w.province(co.homeProvinceId);
    if (!homeProv) return;
    const coastalNeighbors = homeProv.neighbors
      .map((id) => w.province(id))
      .filter((p): p is NonNullable<typeof p> => !!p && p.coastal && !p.subsurface);
    if (coastalNeighbors.length === 0) return;
    const target = coastalNeighbors[Math.floor(w.rng.next() * coastalNeighbors.length)];
    // Damage.
    target.population = Math.max(50, Math.floor(target.population * 0.94));
    co.wealth = Math.min(1, co.wealth + 0.05);
    co.raidTargetProvinceIds.push(target.id);
    co.lastActionYear = w.year;
    w.log("COMPANY_RAIDS", {
      actorId: captain.id,
      provinceId: target.id,
      data: {
        companyId: co.id,
        company: co.name,
        target: target.name,
      },
    });
  }
  // Busted?
  if (w.rng.chance(PIRATE_BUST_PROB)) {
    co.disbandedYear = w.year;
    co.disbandedReason = "sunk in a naval battle";
    w.log("COMPANY_BUSTED", {
      actorId: captain.id,
      provinceId: co.homeProvinceId,
      data: {
        companyId: co.id,
        company: co.name,
        raidCount: co.raidTargetProvinceIds.length,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// If the captain died and no replacement is elected, chance to disband.
// ---------------------------------------------------------------------------
function disbandOnCaptainDeath(w: World): void {
  for (const co of w.activeCompanies()) {
    const captain = w.char(co.captainId);
    if (captain && captain.alive) continue;
    // Try to elect a successor from same-province candidates first.
    const successors = w.living().filter(
      (c) => c.provinceId === co.homeProvinceId && c.level >= 8
          && (c.charClass === "knight" || c.charClass === "soldier" || c.charClass === "hunter"),
    );
    if (successors.length > 0 && !w.rng.chance(CAPTAIN_DEATH_DISBAND)) {
      co.captainId = successors[0].id;
      continue;
    }
    co.disbandedYear = w.year;
    co.disbandedReason = "captain slain, no successor rallied";
    w.log("COMPANY_DISBANDED", {
      provinceId: co.homeProvinceId,
      data: {
        companyId: co.id,
        company: co.name,
        agedYears: w.year - co.formedYear,
      },
    });
  }
}
