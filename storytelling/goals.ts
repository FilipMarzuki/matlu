// goals.ts — Layer 3a: turn drives + circumstances into GOALS, each with an
// OBSTACLE. The obstacle is the story. Goals are regenerated from scratch every
// year (cheap, and keeps them honest as the world changes). The key emergent
// move: if one person is the obstacle to MANY goals, an ELIMINATE_RIVAL goal
// crystallises against them — nobody scripted the murder, the structure did.

import { hasTruce } from "./diplomacy.js";
import { scarcity } from "./geography.js";
import type { World } from "./world.js";

export function regenerateGoals(w: World): void {
  w.goals = [];

  // First pass: everyone's "constructive" goals (claims, expansion, marriage,
  // revenge). We record, per character, how many goals THEY obstruct.
  const obstructionCount = new Map<string, number>();
  const bump = (id: string | null) => {
    if (!id) return;
    obstructionCount.set(id, (obstructionCount.get(id) ?? 0) + 1);
  };

  for (const c of w.adults()) {
    // SEIZE_TITLE — for every claim the character holds whose title is held by
    // someone else (or vacant). Strong claims and high ambition raise priority.
    for (const claim of c.claims) {
      const title = w.title(claim.titleId);
      if (!title) continue;
      if (title.holderId === c.id) continue; // already theirs
      const holderId = title.holderId; // may be null (vacant = crisis)
      // Honour truces — don't press a claim against a sworn peace partner.
      if (holderId && hasTruce(w, c.id, holderId)) continue;
      const priority =
        (claim.strength === "strong" ? 0.6 : 0.35) +
        c.drives.ambition * 0.4 -
        c.drives.piety * 0.15;
      w.goals.push({
        id: w.freshId("g"),
        actorId: c.id,
        type: "SEIZE_TITLE",
        targetTitleId: title.id,
        targetCharId: holderId,
        priority: clamp01(priority),
      });
      bump(holderId);
    }

    // EXPAND — ambitious, landed characters eye a hungry neighbour. Scarcity is
    // the trigger: overpopulated land makes a lord look outward for relief.
    const held = w.titlesHeldBy(c.id);
    if (held.length > 0 && c.drives.ambition > 0.5) {
      const seat = w.province(held[0].provinceId);
      if (seat && scarcity(seat) > 0.9) {
        // Pick the most appealing neighbour: another lord's province.
        for (const nId of seat.neighbors) {
          const np = w.province(nId);
          if (!np) continue;
          const neighbourTitle = w.title(np.titleId);
          if (!neighbourTitle || neighbourTitle.holderId === c.id) continue;
          // Honour truces — don't expand into a peace partner's land.
          if (neighbourTitle.holderId && hasTruce(w, c.id, neighbourTitle.holderId)) continue;
          const priority =
            0.25 + c.drives.ambition * 0.35 + (scarcity(seat) - 0.9) * 0.5;
          w.goals.push({
            id: w.freshId("g"),
            actorId: c.id,
            type: "EXPAND",
            targetTitleId: neighbourTitle.id,
            targetCharId: neighbourTitle.holderId,
            priority: clamp01(priority),
          });
          bump(neighbourTitle.holderId);
          break; // one expansion ambition at a time
        }
      }
    }

    // MARRY — unmarried adults of childbearing relevance want an heir/alliance.
    // No human obstacle, so it never feeds rivalry; it's here because heirs (or
    // the lack of them) drive the succession engine.
    if (!c.spouseId && w.age(c) <= 45) {
      w.goals.push({
        id: w.freshId("g"),
        actorId: c.id,
        type: "MARRY",
        targetTitleId: null,
        targetCharId: null,
        priority: 0.3 + c.drives.lust * 0.3,
      });
    }

    // REVENGE — an active grudge plus a vengeful disposition makes the grudge's
    // target an obstacle in its own right.
    for (const grudge of c.grudges) {
      const target = w.char(grudge.targetId);
      if (!target || !target.alive) continue;
      if (c.drives.vengeance < 0.4) continue;
      w.goals.push({
        id: w.freshId("g"),
        actorId: c.id,
        type: "REVENGE",
        targetTitleId: null,
        targetCharId: target.id,
        priority: clamp01(0.3 + c.drives.vengeance * 0.5),
      });
      bump(target.id);
    }

    // REFORM_LAW — a landed ruler who wants a different succession law.
    // Preferred law is drive-derived: piety → primogeniture (stable / God-ordained),
    // ambition → elective (can engineer the outcome), fear → seniority (age, not sword).
    // No human obstacle: tradition and conservative lords resist, not a named rival,
    // so REFORM_LAW goals never feed the ELIMINATE_RIVAL counter.
    for (const t of held) {
      const want =
        c.drives.piety > 0.6 ? "primogeniture" :
        c.drives.ambition > 0.65 ? "elective" :
        c.drives.fear > 0.55 ? "seniority" : "primogeniture";
      if (t.law === want) continue;
      w.goals.push({
        id: w.freshId("g"),
        actorId: c.id,
        type: "REFORM_LAW",
        targetTitleId: t.id,
        targetCharId: null,
        priority: clamp01(0.2 + c.drives.ambition * 0.25 + c.drives.piety * 0.15),
      });
    }
  }

  // Second pass: emergent ELIMINATE_RIVAL. If a character is the obstacle to
  // two or more goals, the most ambitious/fearful of the people they block may
  // decide the simplest path is through them. This is the structural origin of
  // assassination — read out of the goal graph, never hand-placed.
  for (const [rivalId, count] of obstructionCount) {
    if (count < 2) continue;
    const rival = w.char(rivalId);
    if (!rival || !rival.alive) continue;

    // Everyone blocked by this rival is a candidate to want them gone.
    const blocked = w.goals.filter(
      (g) => g.targetCharId === rivalId && g.actorId !== rivalId,
    );
    for (const g of blocked) {
      const actor = w.char(g.actorId);
      if (!actor) continue;
      // Willingness scales with ambition + vengeance + fear, damped by piety
      // and by how much they actually like the rival.
      const opinion = w.opinionOf(actor, rivalId);
      const willingness =
        actor.drives.ambition * 0.4 +
        actor.drives.vengeance * 0.3 +
        actor.drives.fear * 0.2 -
        actor.drives.piety * 0.3 -
        opinion / 200;
      if (willingness > 0.45 && count >= 2) {
        w.goals.push({
          id: w.freshId("g"),
          actorId: actor.id,
          type: "ELIMINATE_RIVAL",
          targetTitleId: g.targetTitleId,
          targetCharId: rivalId,
          priority: clamp01(willingness + 0.1 * count),
        });
      }
    }
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
