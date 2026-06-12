// inheritance.ts — succession laws, claims, and succession crises.
//
// Layer 4 of the causal stack and the engine of multigenerational war. When a
// title-holder dies, resolveSuccession transfers the title under its law AND
// mints WEAKER claims in the people who were passed over. Those claims become
// the next generation's SEIZE_TITLE goals — so a grandfather's snub is a
// grandson's casus belli. No heir at all = a succession crisis, the richest
// story generator in the engine.

import type { Character, Claim, Title } from "./types.js";
import type { World } from "./world.js";

// Give a character a claim, de-duplicating on title. A strong claim always
// wins over a weak one already held.
export function addClaim(c: Character, claim: Claim): void {
  const existing = c.claims.find((cl) => cl.titleId === claim.titleId);
  if (existing) {
    if (claim.strength === "strong") existing.strength = "strong";
    return;
  }
  c.claims.push(claim);
}

// Choose the rightful heir for a title under its succession law. Returns null
// when there is genuinely no candidate — that's a succession crisis.
function selectHeir(w: World, title: Title, deceased: Character): Character | null {
  switch (title.law) {
    case "primogeniture": {
      // Eldest living legitimate child (males favoured in v1 for period flavour,
      // but a daughter inherits if there are no sons — which itself produces
      // disputed, claim-rich successions).
      const kids = w.livingChildren(deceased);
      const sons = kids.filter((k) => k.sex === "male");
      const pool = sons.length > 0 ? sons : kids;
      return pool.length > 0 ? pool[0] : null;
    }
    case "gavelkind": {
      // True partition needs multiple titles; with one seat we approximate:
      // the eldest child inherits the seat, every other child is minted a
      // strong claim (handled by the caller). Still produces fractious heirs.
      const kids = w.livingChildren(deceased);
      return kids.length > 0 ? kids[0] : null;
    }
    case "seniority": {
      // Eldest living member of the dynasty (not necessarily a descendant) —
      // brothers and uncles inherit before sons. Famous for sidelining the
      // late ruler's children, who then carry claims.
      const members = w
        .dynastyMembers(deceased.dynastyId)
        .filter((m) => m.id !== deceased.id);
      return members.length > 0 ? members[0] : null;
    }
    case "elective": {
      // The realm picks the strongest eligible dynast. "Strongest" = most
      // power already, so elective tends to entrench whoever's winning —
      // and infuriate the runners-up, who leave with claims.
      const candidates = w
        .living()
        .filter((m) => m.dynastyId === deceased.dynastyId && m.id !== deceased.id);
      if (candidates.length === 0) return null;
      return candidates.sort((a, b) => w.power(b) - w.power(a))[0];
    }
  }
}

// Resolve succession for one newly-dead holder. Called by the tick for every
// title whose holder died this year.
export function resolveSuccession(w: World, title: Title, deceased: Character): void {
  const heir = selectHeir(w, title, deceased);

  if (!heir) {
    // No heir: the title goes vacant and a crisis opens. Anyone with even a
    // weak claim now has a live target; the strongest grabber will press it
    // (handled in goals/schemes/war). We surface it loudly for the chronicle.
    title.holderId = null;
    w.log("SUCCESSION_CRISIS", {
      titleId: title.id,
      targetId: deceased.id,
      provinceId: title.provinceId,
      data: { title: title.name, law: title.law },
    });
    return;
  }

  // Transfer the title.
  title.holderId = heir.id;
  // The heir now resides at the seat (matters for plague/famine exposure).
  heir.provinceId = title.provinceId;

  w.log("SUCCESSION", {
    actorId: heir.id,
    targetId: deceased.id,
    titleId: title.id,
    provinceId: title.provinceId,
    data: {
      title: title.name,
      law: title.law,
      heir_age: w.year - heir.birthYear,
      same_dynasty: heir.dynastyId === deceased.dynastyId,
    },
  });

  // Mint claims in the losers — this is the part that propagates conflict
  // across generations. Who got passed over depends on the law.
  mintLoserClaims(w, title, deceased, heir);
}

function mintLoserClaims(
  w: World,
  title: Title,
  deceased: Character,
  heir: Character,
): void {
  const basisYear = w.year;
  const losers: Character[] = [];

  if (title.law === "gavelkind") {
    // Every child other than the heir feels robbed — STRONG claims.
    for (const k of w.livingChildren(deceased)) {
      if (k.id !== heir.id) {
        addClaim(k, {
          titleId: title.id,
          strength: "strong",
          basis: `partition denied in ${basisYear}`,
          year: basisYear,
        });
        losers.push(k);
      }
    }
  } else {
    // Other laws: the late ruler's children who didn't inherit get WEAK claims
    // (a son passed over by a seniority uncle, a younger brother under
    // primogeniture, etc.).
    for (const k of w.livingChildren(deceased)) {
      if (k.id !== heir.id) {
        addClaim(k, {
          titleId: title.id,
          strength: "weak",
          basis: `passed over in ${basisYear}`,
          year: basisYear,
        });
        losers.push(k);
      }
    }
  }

  if (losers.length > 0) {
    for (const l of losers) {
      // Being disinherited sours the loser on the heir — fuel for later
      // schemes and revenge.
      w.adjustOpinion(l, heir.id, -25);
    }
  }
}
