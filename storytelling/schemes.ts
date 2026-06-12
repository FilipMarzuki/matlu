// schemes.ts — Layer 3b: blocked goals become multi-tick, discoverable SCHEMES.
//
// A goal says "I want X and person Y is in the way." A scheme is the covert
// project to remove Y. Schemes take years, need conspirators (more power but
// they leak faster), and can be DISCOVERED — which mints a grudge and poisons
// the schemer's reputation, so the social fabric remembers. Discovery is the
// seed of the next vengeance cycle.

import { markDead } from "./phenomena.js";
import type { Character, Scheme } from "./types.js";
import type { World } from "./world.js";

// ---- spawning ------------------------------------------------------------
// Each tick, the highest-priority lethal goals that don't already have a scheme
// in flight may hatch one. We cap how many schemes a single character runs so
// the world doesn't dissolve into pure murder.
export function spawnSchemes(w: World): void {
  const lethal = w.goals.filter(
    (g) => g.type === "ELIMINATE_RIVAL" || g.type === "REVENGE",
  );
  // Highest priority first — the most motivated plots form.
  lethal.sort((a, b) => b.priority - a.priority);

  for (const g of lethal) {
    const owner = w.char(g.actorId);
    const target = w.char(g.targetCharId);
    if (!owner || !target || !target.alive) continue;

    // One active murder scheme per owner.
    if (w.schemes.some((s) => s.ownerId === owner.id && !s.discovered)) continue;
    // Don't re-target someone you're already plotting against.
    if (
      w.schemes.some(
        (s) => s.ownerId === owner.id && s.targetCharId === target.id,
      )
    )
      continue;

    // Hatching probability gates on priority and a steady disposition to plot.
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
      // Known schemers start with thinner cover — reputation precedes them.
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
}

// ---- advancing -----------------------------------------------------------
export function advanceSchemes(w: World): void {
  const survivors: Scheme[] = [];

  for (const s of w.schemes) {
    const owner = w.char(s.ownerId);
    const target = w.char(s.targetCharId);

    // Plot collapses if a principal is already gone.
    if (!owner || !owner.alive || !target || !target.alive) continue;

    // Optionally recruit a conspirator: someone who ALSO dislikes the target
    // and isn't put off by the owner's reputation. Conspirators add muscle but
    // each one is another mouth that can talk.
    maybeRecruit(w, s, owner, target);

    // Advance. More conspirators = faster, but bigger plots erode secrecy.
    const speed = 0.2 + s.conspirators.length * 0.1 + owner.drives.ambition * 0.1;
    s.progress = clamp01(s.progress + speed);
    s.secrecy = clamp01(s.secrecy - 0.05 - s.conspirators.length * 0.06);

    // Discovery check: the leakier the plot and the more people in it, the more
    // likely it surfaces. A discovered plot fails loudly.
    const exposure = (1 - s.secrecy) * (0.4 + s.conspirators.length * 0.2);
    if (w.rng.chance(clamp01(exposure))) {
      discoverScheme(w, s, owner, target);
      continue; // not a survivor
    }

    // Success: the deed is done before anyone catches on.
    if (s.progress >= 1) {
      executeScheme(w, s, owner, target);
      continue;
    }

    survivors.push(s);
  }

  w.schemes = survivors;
}

function maybeRecruit(
  w: World,
  s: Scheme,
  owner: Character,
  target: Character,
): void {
  if (s.conspirators.length >= 3) return;
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

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
