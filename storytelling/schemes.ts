// schemes.ts — Layer 3b: blocked goals become multi-tick, discoverable SCHEMES.
//
// A goal says "I want X and person Y is in the way." A scheme is the covert
// project to remove Y. Schemes take years, need conspirators (more power but
// they leak faster), and can be DISCOVERED — which mints a grudge and poisons
// the schemer's reputation, so the social fabric remembers. Discovery is the
// seed of the next vengeance cycle.

import { markDead } from "./phenomena.js";
import { onBetrayal } from "./perception.js";
import type { Character, Scheme, SuccessionLaw } from "./types.js";
import type { World } from "./world.js";

// ---- spawning ------------------------------------------------------------
// Each tick, the highest-priority lethal / reformist goals that don't already
// have a scheme in flight may hatch one.
export function spawnSchemes(w: World): void {
  // Murder schemes: ELIMINATE_RIVAL and REVENGE goals.
  const lethal = w.goals.filter(
    (g) => g.type === "ELIMINATE_RIVAL" || g.type === "REVENGE",
  );
  lethal.sort((a, b) => b.priority - a.priority);

  for (const g of lethal) {
    const owner = w.char(g.actorId);
    const target = w.char(g.targetCharId);
    if (!owner || !target || !target.alive) continue;

    // One active murder scheme per owner.
    if (w.schemes.some((s) => s.ownerId === owner.id && !s.discovered)) continue;
    // Don't re-target someone you're already plotting against.
    if (w.schemes.some((s) => s.ownerId === owner.id && s.targetCharId === target.id)) continue;

    const hatchChance = 0.25 + g.priority * 0.4 - owner.drives.piety * 0.2;
    if (!w.rng.chance(clamp01(hatchChance))) continue;

    const scheme: Scheme = {
      id: w.freshId("s"),
      type: "MURDER",
      ownerId: owner.id,
      targetCharId: target.id,
      targetTitleId: g.targetTitleId,
      conspirators: [],
      progress: 0,
      secrecy: clamp01(0.85 - owner.reputation.schemer * 0.4),
      discovered: false,
      startYear: w.year,
    };
    w.schemes.push(scheme);
    w.log("SCHEME_HATCHED", {
      actorId: owner.id,
      targetId: target.id,
      titleId: g.targetTitleId,
      data: { scheme: scheme.type },
    });
  }

  // Reform schemes: REFORM_LAW goals hatch into quiet lobbying campaigns.
  // Secrecy starts lower than murder — law-pushing is quasi-public and
  // leaks through the baronial grapevine rather than a conspiracy cell.
  const reformGoals = w.goals.filter((g) => g.type === "REFORM_LAW");
  reformGoals.sort((a, b) => b.priority - a.priority);
  for (const g of reformGoals) {
    const owner = w.char(g.actorId);
    if (!owner) continue;
    const title = w.title(g.targetTitleId);
    if (!title || title.holderId !== owner.id) continue;
    // One active reform scheme per title (not per owner — a ruler can lobby for
    // multiple titles, but can't run two campaigns on the same title at once).
    if (w.schemes.some((s) => s.type === "REFORM" && s.targetTitleId === title.id && !s.discovered)) continue;

    if (!w.rng.chance(clamp01(0.15 + g.priority * 0.3))) continue;

    w.schemes.push({
      id: w.freshId("s"),
      type: "REFORM",
      ownerId: owner.id,
      targetCharId: null,
      targetTitleId: title.id,
      conspirators: [],
      progress: 0,
      secrecy: 0.7,
      discovered: false,
      startYear: w.year,
    });
    w.log("SCHEME_HATCHED", {
      actorId: owner.id,
      titleId: title.id,
      data: { scheme: "REFORM", targetLaw: preferredLaw(owner) },
    });
  }
}

// ---- advancing -----------------------------------------------------------
export function advanceSchemes(w: World): void {
  const survivors: Scheme[] = [];

  for (const s of w.schemes) {
    const owner = w.char(s.ownerId);
    if (!owner || !owner.alive) continue;

    if (s.type === "REFORM") {
      if (!advanceReform(w, s, owner)) survivors.push(s);
    } else {
      // MURDER (and future USURP): needs a live target.
      const target = w.char(s.targetCharId);
      if (!target || !target.alive) continue;
      if (!advanceMurder(w, s, owner, target)) survivors.push(s);
    }
  }

  w.schemes = survivors;
}

// Returns true when the scheme is resolved (executed or discovered).
function advanceMurder(w: World, s: Scheme, owner: Character, target: Character): boolean {
  maybeRecruit(w, s, owner, target);

  const speed = 0.2 + s.conspirators.length * 0.1 + owner.drives.ambition * 0.1;
  s.progress = clamp01(s.progress + speed);
  s.secrecy = clamp01(s.secrecy - 0.05 - s.conspirators.length * 0.06);

  const exposure = (1 - s.secrecy) * (0.4 + s.conspirators.length * 0.2);
  if (w.rng.chance(clamp01(exposure))) {
    discoverScheme(w, s, owner, target);
    return true;
  }
  if (s.progress >= 1) {
    executeScheme(w, s, owner, target);
    return true;
  }
  return false;
}

// Reform campaigns advance more slowly and leak more quietly than murder plots.
function advanceReform(w: World, s: Scheme, owner: Character): boolean {
  const speed = 0.15 + owner.drives.ambition * 0.1;
  s.progress = clamp01(s.progress + speed);
  s.secrecy = clamp01(s.secrecy - 0.03);

  // Exposure is gentler — law-pushing is covert pressure, not a clandestine cell.
  const exposure = (1 - s.secrecy) * 0.25;
  if (w.rng.chance(clamp01(exposure))) {
    discoverReformScheme(w, s, owner);
    return true;
  }
  if (s.progress >= 1) {
    executeReformScheme(w, s, owner);
    return true;
  }
  return false;
}

function maybeRecruit(
  w: World,
  s: Scheme,
  owner: Character,
  target: Character,
): void {
  if (s.conspirators.length >= 3) return;
  // A deeply betrayal-scarred schemer goes it alone — burned too many times to
  // bring anyone into their confidence.
  if (owner.psyche.biases.betrayal_scarred > 0.5) return;
  if (!w.rng.chance(0.3)) return;

  // Candidate pool: adults who dislike the target and aren't the owner/target.
  const candidates = w.adults().filter((c) => {
    if (c.id === owner.id || c.id === target.id) return false;
    if (s.conspirators.includes(c.id)) return false;
    return w.opinionOf(c, target.id) < -10;
  });
  if (candidates.length === 0) return;

  const recruit = w.rng.pick(candidates);
  // A known schemer struggles to find willing hands — social adaptation in
  // miniature. Reputation gates recruitment.
  const willing = w.opinionOf(recruit, owner.id) / 100 + 0.3 - owner.reputation.schemer * 0.5;
  if (w.rng.chance(clamp01(willing))) {
    s.conspirators.push(recruit.id);
  }
}

function discoverScheme(
  w: World,
  s: Scheme,
  owner: Character,
  target: Character,
): void {
  s.discovered = true;
  // The psychic wound of betrayal — hardens the target's lone-wolf tendencies.
  onBetrayal(target);
  // The mark now bears a grudge — a future REVENGE goal, possibly a counter-plot.
  target.grudges.push({
    targetId: owner.id,
    reason: `plotted my death in ${w.year}`,
    year: w.year,
  });
  w.adjustOpinion(target, owner.id, -60);
  // Everyone who hears of it trusts the schemer less; reputation hardens.
  owner.reputation.schemer = clamp01(owner.reputation.schemer + 0.25);
  for (const other of w.adults()) {
    if (other.id === owner.id) continue;
    w.adjustOpinion(other, owner.id, -10);
  }
  w.log("SCHEME_DISCOVERED", {
    actorId: owner.id,
    targetId: target.id,
    titleId: s.targetTitleId,
    data: { conspirators: s.conspirators.length, scheme: s.type },
  });
  w.log("GRUDGE_FORMED", {
    actorId: target.id,
    targetId: owner.id,
    data: { reason: "uncovered plot" },
  });
}

function executeScheme(
  w: World,
  s: Scheme,
  owner: Character,
  target: Character,
): void {
  // The murder lands. The DEATH itself is logged by markDead; we add a MURDER
  // event carrying the culprit so the sifter can connect motive to corpse.
  markDead(w, target, "murder");
  w.log("MURDER", {
    actorId: owner.id,
    targetId: target.id,
    titleId: s.targetTitleId,
    provinceId: target.provinceId,
    data: { conspirators: s.conspirators.length },
  });
  // Murderers, even undiscovered, accrue a faint dark reputation (rumour).
  owner.reputation.schemer = clamp01(owner.reputation.schemer + 0.1);
}

function discoverReformScheme(w: World, s: Scheme, owner: Character): void {
  s.discovered = true;
  // The lobbying was exposed. Conservative lords harden against the reformer
  // and some develop lasting resentment (a future REVENGE cycle).
  owner.reputation.schemer = clamp01(owner.reputation.schemer + 0.1);
  const opponents = w
    .adults()
    .filter((c) => c.id !== owner.id && w.titlesHeldBy(c.id).length > 0);
  for (const opp of opponents) {
    w.adjustOpinion(opp, owner.id, -15);
    if (w.opinionOf(opp, owner.id) < -20 && w.rng.chance(0.3)) {
      opp.grudges.push({
        targetId: owner.id,
        reason: `tried to change succession in ${w.year}`,
        year: w.year,
      });
      w.log("GRUDGE_FORMED", {
        actorId: opp.id,
        targetId: owner.id,
        data: { reason: "reform attempt" },
      });
    }
  }
  w.log("SCHEME_DISCOVERED", {
    actorId: owner.id,
    titleId: s.targetTitleId,
    data: { conspirators: 0, scheme: s.type },
  });
}

function executeReformScheme(w: World, s: Scheme, owner: Character): void {
  const title = w.title(s.targetTitleId);
  // Bail if the ruler lost their title while plotting.
  if (!title || title.holderId !== owner.id) return;
  const newLaw = preferredLaw(owner);
  if (newLaw === title.law) return;
  const oldLaw = title.law;
  title.law = newLaw;
  w.log("REFORM", {
    actorId: owner.id,
    titleId: title.id,
    data: { law: newLaw, old_law: oldLaw },
  });
}

// The law a character would most prefer to rule under, purely from drives.
function preferredLaw(c: Character): SuccessionLaw {
  if (c.drives.piety > 0.6) return "primogeniture";
  if (c.drives.ambition > 0.65) return "elective";
  if (c.drives.fear > 0.55) return "seniority";
  return "primogeniture";
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
