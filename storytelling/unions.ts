// unions.ts — persistent dynastic unions between houses.
//
// Marriages fire as one-shot MARRIAGE events. A UNION is an upgrade: when
// two title-holding houses intermarry, a persistent compact is minted. That
// compact has three shapes:
//
//   marriage_alliance — mutual-aid pact; suppresses war between the two
//   personal_union    — the heir of a prior alliance inherits BOTH crowns
//                       (Habsburg 1519, Iberian 1580, Poland-Lithuania 1569)
//   cadet_branch      — a scion of house A weds into a distant realm and
//                       founds a related-but-distinct sub-house
//
// Strength drifts down by ~1% per year of peace and jumps down on death of
// either founding spouse. Wars between the paired houses BREAK the union.
//
// Not guarded on any flag — political unions happen in every world. This
// means the base golden hashes will move (marriages already fire in every
// world, and adding a union check consumes RNG on marriage events).

import type { Character, DynasticUnion, DynastyId, UnionId } from "./types.js";
import type { World } from "./world.js";

// ---- tuning constants ------------------------------------------------------
const NEW_UNION_PROB = 0.35;            // per marriage between two title-holders
const CADET_BRANCH_PROB = 0.008;        // per year per marriage_alliance
const STRENGTH_DECAY_PER_YEAR = 0.008;
const STRENGTH_DECAY_ON_DEATH = 0.15;
const MIN_STRENGTH_TO_KEEP = 0.05;

// Called from tick.ts once per year, AFTER births + deaths so this tick's
// weddings and orphaned unions are visible in one pass.
export function runUnions(w: World): void {
  detectNewUnions(w);
  detectPersonalUnions(w);
  ageUnions(w);
  breakOnWar(w);
  maybeCadetBranch(w);
}

// ---------------------------------------------------------------------------
// Detect new unions. Scan this tick's MARRIAGE events; if both sides belong
// to title-holding dynasties, mint a marriage_alliance (with probability, so
// small courtships don't upgrade every peasant match).
// ---------------------------------------------------------------------------
function detectNewUnions(w: World): void {
  const fresh = w.events.filter(
    (e) => e.type === "MARRIAGE" && e.year === w.year,
  );
  for (const ev of fresh) {
    const a = w.char(ev.actorId);
    const b = w.char(ev.targetId);
    if (!a || !b) continue;
    if (a.dynastyId === b.dynastyId) continue;
    // Both sides' houses must hold a titled seat somewhere.
    if (!houseHoldsAnyTitle(w, a.dynastyId)) continue;
    if (!houseHoldsAnyTitle(w, b.dynastyId)) continue;
    // Already have a union between these two houses? Skip.
    if (w.unionBetween(a.dynastyId, b.dynastyId)) continue;
    if (!w.rng.chance(NEW_UNION_PROB)) continue;

    const id: UnionId = w.freshId("un");
    const union: DynasticUnion = {
      id,
      kind: "marriage_alliance",
      dynastyAId: a.dynastyId,
      dynastyBId: b.dynastyId,
      formedYear: w.year,
      originMarriageA: a.id,
      originMarriageB: b.id,
      currentHolderId: null,
      strength: 0.75,
      dissolvedYear: null,
      dissolvedReason: null,
    };
    w.unions.set(id, union);
    w.log("DYNASTIC_UNION_FORMED", {
      actorId: a.id,
      targetId: b.id,
      data: {
        unionId: id,
        dynastyA: w.dynasty(a.dynastyId)?.name ?? a.dynastyId,
        dynastyB: w.dynasty(b.dynastyId)?.name ?? b.dynastyId,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Detect personal unions. A character holding titles from TWO different
// dynastic streams simultaneously (i.e. bloodlines) becomes a personal-union
// carrier. We identify them by scanning title-holders and checking if their
// father AND mother came from title-holding houses that already share an
// active marriage_alliance.
// ---------------------------------------------------------------------------
function detectPersonalUnions(w: World): void {
  for (const t of w.titles.values()) {
    if (t.tier !== "kingdom" && t.tier !== "duchy") continue;
    const holder = w.char(t.holderId);
    if (!holder) continue;
    // Skip if holder wasn't newly enthroned this year — otherwise every year
    // reports the same personal union. Detect enthronement by checking
    // whether a SUCCESSION event for this title fired this year.
    const succeeded = w.events.some(
      (e) => e.type === "SUCCESSION" && e.year === w.year && e.titleId === t.id,
    );
    if (!succeeded) continue;

    const father = w.char(holder.fatherId);
    const mother = w.char(holder.motherId);
    if (!father || !mother) continue;
    if (father.dynastyId === mother.dynastyId) continue;
    const union = w.unionBetween(father.dynastyId, mother.dynastyId);
    if (!union) continue;
    if (union.kind === "personal_union" && union.currentHolderId === holder.id) continue;
    // Also require that the holder actually holds titles from BOTH bloodlines.
    // Simplest proxy: holder's dynastyId matches ONE parent; we consider them
    // to be inheriting the OTHER parent's line via marriage claim.
    union.kind = "personal_union";
    union.currentHolderId = holder.id;
    union.strength = Math.min(1, union.strength + 0.1);
    w.log("PERSONAL_UNION_ESTABLISHED", {
      actorId: holder.id,
      titleId: t.id,
      data: {
        unionId: union.id,
        dynastyA: w.dynasty(union.dynastyAId)?.name ?? union.dynastyAId,
        dynastyB: w.dynasty(union.dynastyBId)?.name ?? union.dynastyBId,
        title: t.name,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Age unions. Strength decays; personal_union losing its holder drops back to
// alliance or dissolves. Below MIN_STRENGTH_TO_KEEP → dissolved (drift apart).
// ---------------------------------------------------------------------------
function ageUnions(w: World): void {
  for (const u of w.unions.values()) {
    if (u.dissolvedYear !== null) continue;

    // Death of founding spouses jumps the strength down.
    const a: Character | undefined = w.char(u.originMarriageA);
    const b: Character | undefined = w.char(u.originMarriageB);
    let decay = STRENGTH_DECAY_PER_YEAR;
    if (a && !a.alive && a.deathYear === w.year) decay += STRENGTH_DECAY_ON_DEATH;
    if (b && !b.alive && b.deathYear === w.year) decay += STRENGTH_DECAY_ON_DEATH;

    u.strength = Math.max(0, u.strength - decay);

    if (u.kind === "personal_union") {
      const h = w.char(u.currentHolderId);
      if (!h || !h.alive) {
        // Holder died — the personal union either passes to a joint heir or dissolves.
        // We conservatively demote to alliance and clear the holder.
        u.currentHolderId = null;
        u.kind = "marriage_alliance";
        w.log("PERSONAL_UNION_DISSOLVED", {
          data: {
            unionId: u.id,
            dynastyA: w.dynasty(u.dynastyAId)?.name ?? u.dynastyAId,
            dynastyB: w.dynasty(u.dynastyBId)?.name ?? u.dynastyBId,
          },
        });
      }
    }

    if (u.strength < MIN_STRENGTH_TO_KEEP) {
      u.dissolvedYear = w.year;
      u.dissolvedReason = "drifted apart";
      // No event — most political marriages just fade. Rendering the fade
      // would clog the chronicle. UNION_BROKEN_BY_WAR is the loud path.
    }
  }
}

// ---------------------------------------------------------------------------
// Wars between paired houses break the union outright.
// ---------------------------------------------------------------------------
function breakOnWar(w: World): void {
  const warsThisYear = w.events.filter((e) => e.type === "WAR" && e.year === w.year);
  for (const ev of warsThisYear) {
    const a = w.char(ev.actorId);
    const b = w.char(ev.targetId);
    if (!a || !b) continue;
    const u = w.unionBetween(a.dynastyId, b.dynastyId);
    if (!u || u.dissolvedYear !== null) continue;
    u.dissolvedYear = w.year;
    u.dissolvedReason = "war";
    w.log("UNION_BROKEN_BY_WAR", {
      actorId: a.id,
      targetId: b.id,
      data: {
        unionId: u.id,
        dynastyA: w.dynasty(u.dynastyAId)?.name ?? u.dynastyAId,
        dynastyB: w.dynasty(u.dynastyBId)?.name ?? u.dynastyBId,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Cadet branch — every so often an active marriage-alliance spawns a
// procedurally-named sub-dynasty (Bourbon-Anjou pattern). Requires a scion:
// a non-heir adult from either house who isn't a title-holder.
// ---------------------------------------------------------------------------
function maybeCadetBranch(w: World): void {
  for (const u of w.activeUnions()) {
    if (u.kind !== "marriage_alliance") continue;
    if (!w.rng.chance(CADET_BRANCH_PROB)) continue;
    const parentDyn = w.dynasty(u.dynastyAId);
    if (!parentDyn) continue;
    const scions = [...w.characters.values()].filter(
      (c) => c.alive && c.dynastyId === u.dynastyAId
          && w.age(c) >= 20 && w.age(c) <= 45
          && w.titlesHeldBy(c.id).length === 0,
    );
    if (scions.length === 0) continue;
    const founder = scions[Math.floor(w.rng.next() * scions.length)];
    const cadetName = `${parentDyn.name}-${w.dynasty(u.dynastyBId)?.name ?? "Cadet"}`;
    // Mint the cadet-branch union record (a distinct new union — the branch
    // itself isn't a new dynasty, since the character can't have their
    // dynastyId reassigned safely mid-run; we track the branch as an
    // ancillary compact instead).
    const cadetUnion: DynasticUnion = {
      id: w.freshId("un"),
      kind: "cadet_branch",
      dynastyAId: u.dynastyAId,
      dynastyBId: u.dynastyBId,
      formedYear: w.year,
      originMarriageA: founder.id,
      originMarriageB: null,
      currentHolderId: founder.id,
      strength: 0.6,
      dissolvedYear: null,
      dissolvedReason: null,
    };
    w.unions.set(cadetUnion.id, cadetUnion);
    w.log("CADET_BRANCH_ESTABLISHED", {
      actorId: founder.id,
      data: {
        parentDynasty: parentDyn.name,
        cadetName,
        unionId: cadetUnion.id,
      },
    });
  }
}

// ---- helpers ---------------------------------------------------------------
function houseHoldsAnyTitle(w: World, dynId: DynastyId): boolean {
  for (const t of w.titles.values()) {
    const holder = w.char(t.holderId);
    if (holder && holder.dynastyId === dynId) return true;
  }
  return false;
}
