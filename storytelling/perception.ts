// perception.ts — Layer 3c: subjective worldview, perceptual biases, and
// structured distortions.
//
// Two mechanisms run each tick (called from tick.ts):
//   decayBiases      — experience-acquired biases fade slowly; confirmation
//                      bias resists the decay, so unexamined worldviews persist.
//   maybeOnsetMadness — annual roll for acute distortion onset (paranoid /
//                      megalomaniac / zealot), weighted by inbreeding coeff,
//                      drives, and life events. Rare even at high risk.
//   applyPerception  — post-goal pass: modifies w.goals in-place, inserting
//                      phantom goals for distorted characters and scaling
//                      priorities for biased ones. Runs after regenerateGoals
//                      so it reads the clean logical goals first.
//
// Experience-trigger functions (onGrief, onBetrayal, etc.) are called from
// tick.ts / schemes.ts / phenomena.ts at the exact moment the triggering
// event fires.

import type { Character } from "./types.js";
import type { World } from "./world.js";

// ── Inbreeding coefficient ─────────────────────────────────────────────────
// Walk the family graph up to `depth` generations and collect ancestor IDs.
function ancestorSet(w: World, startId: string, depth: number): Set<string> {
  const out = new Set<string>();
  const queue: [string, number][] = [[startId, 0]];
  while (queue.length) {
    const [id, d] = queue.shift()!;
    if (d >= depth) continue;
    const ch = w.char(id);
    if (!ch) continue;
    if (ch.fatherId) { out.add(ch.fatherId); queue.push([ch.fatherId, d + 1]); }
    if (ch.motherId) { out.add(ch.motherId); queue.push([ch.motherId, d + 1]); }
  }
  return out;
}

// Count shared ancestors between the parents up to 4 generations. Multiplied
// by 0.1 to give a [0,1] coefficient. First cousins ≈ 0.2; siblings cap at 1.
export function computeInbreeding(w: World, fatherId: string, motherId: string): number {
  const pa = ancestorSet(w, fatherId, 4);
  const ma = ancestorSet(w, motherId, 4);
  let shared = 0;
  for (const a of pa) if (ma.has(a)) shared++;
  return Math.min(1, shared * 0.1);
}

// ── Distortion onset ──────────────────────────────────────────────────────
export function maybeOnsetMadness(w: World): void {
  for (const c of w.adults()) {
    if (c.psyche.distortion !== "none") continue;

    const age = w.age(c);
    // Base chance is small; inbreeding raises it meaningfully.
    let chance = 0.004 + c.psyche.inbreedingCoeff * 0.04;

    // Drive-based risk amplifiers for each distortion type.
    if (c.drives.fear > 0.6 && c.grudges.length > 0) chance += 0.006;
    if (c.drives.ambition > 0.75 && w.titlesHeldBy(c.id).length > 0) chance += 0.005;
    if (c.drives.piety > 0.7 && w.faiths.size > 1) chance += 0.004;

    // Accumulated bias can tip a character over the edge.
    chance += c.psyche.biases.confirmation * 0.008;
    chance += c.psyche.biases.grief_locked * 0.005;

    // Old age raises the risk.
    if (age > 45) chance += 0.002;
    if (age > 70) chance += 0.004;

    // Corruption in the home province amplifies distortion onset.
    const homeProv = w.province(c.provinceId);
    if (homeProv && homeProv.blightLevel > 0) {
      chance += homeProv.blightLevel * 0.015;
    }

    if (!w.rng.chance(chance)) continue;

    const type = pickDistortionType(w, c);
    c.psyche.distortion = type;
    c.psyche.distortionOnsetYear = w.year;
    w.log("MADNESS_ONSET", {
      actorId: c.id,
      provinceId: c.provinceId,
      data: { distortion: type, age, inbreeding: c.psyche.inbreedingCoeff },
    });
  }
}

function pickDistortionType(
  w: World,
  c: Character,
): "paranoid" | "megalomaniac" | "zealot" {
  const scores: Record<string, number> = {
    paranoid:
      c.drives.fear * 0.5 +
      c.drives.vengeance * 0.3 +
      c.psyche.biases.betrayal_scarred * 0.3 +
      c.psyche.inbreedingCoeff * 0.2,
    megalomaniac:
      c.drives.ambition * 0.65 +
      c.drives.greed * 0.2 +
      c.psyche.biases.conqueror_confident * 0.25 +
      c.psyche.inbreedingCoeff * 0.1,
  };
  // Zealot only possible where multiple faiths exist to conflict over.
  if (w.faiths.size > 1) {
    scores.zealot =
      c.drives.piety * 0.75 +
      c.psyche.biases.doctrinal * 0.3 +
      c.psyche.inbreedingCoeff * 0.15;
  }
  // Corruption type biases toward a matching distortion.
  const prov = w.province(c.provinceId);
  const bl = prov?.blightLevel ?? 0;
  const ct = prov?.corruptionType;
  if (bl > 0) {
    if (ct === "necrotic") scores.paranoid += bl * 0.3;
    if (ct === "void")     scores.megalomaniac += bl * 0.3;
    if (ct === "feral")    scores.zealot = (scores.zealot ?? 0) + bl * 0.3;
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  return best as "paranoid" | "megalomaniac" | "zealot";
}

// ── Experience-acquired bias triggers ─────────────────────────────────────
// Called from tick.ts / schemes.ts / phenomena.ts at the moment the event fires.

// A major war victory against a stronger opponent — confidence inflates.
export function onConquerorVictory(_w: World, c: Character): void {
  c.psyche.biases.conqueror_confident = clamp01(c.psyche.biases.conqueror_confident + 0.35);
  // Confirmation bias grows a little — victory confirms their worldview.
  c.psyche.biases.confirmation = clamp01(c.psyche.biases.confirmation + 0.1);
}

// A title loss (being dispossessed in war). Loss aversion deepens; high
// confirmation bias means they can't accept the loss → paranoid onset risk.
export function onTitleLost(w: World, c: Character): void {
  c.psyche.biases.loss_aversion = clamp01(c.psyche.biases.loss_aversion + 0.2);
  c.psyche.lastMajorLossYear = w.year;

  // Conqueror confidence takes a hit gated by how much confirmation resists it.
  if (c.psyche.biases.conqueror_confident > 0.1) {
    const decay = (1 - c.psyche.biases.confirmation * 0.7) * 0.4;
    c.psyche.biases.conqueror_confident = clamp01(c.psyche.biases.conqueror_confident - decay);

    // If confirmation is high and confidence persists, the ego needs an
    // external explanation for the defeat → paranoid onset spike.
    if (
      c.psyche.distortion === "none" &&
      c.psyche.biases.confirmation > 0.45 &&
      c.psyche.biases.conqueror_confident > 0.3
    ) {
      const panicChance =
        c.psyche.biases.confirmation * c.psyche.biases.conqueror_confident * 0.35;
      if (w.rng.chance(panicChance)) {
        c.psyche.distortion = "paranoid";
        c.psyche.distortionOnsetYear = w.year;
        w.log("MADNESS_ONSET", {
          actorId: c.id,
          provinceId: c.provinceId,
          data: { distortion: "paranoid", age: w.age(c), trigger: "defeat_unaccepted" },
        });
      }
    }
  }
}

// Being the target of a discovered scheme — trust shattered.
export function onBetrayal(c: Character): void {
  c.psyche.biases.betrayal_scarred = clamp01(c.psyche.biases.betrayal_scarred + 0.3);
  // Paradoxical: betrayed people sometimes become more wishful (seeking
  // reassurance), and the wishful lens makes them miss the next betrayal.
  c.psyche.biases.wishful = clamp01(c.psyche.biases.wishful + 0.12);
}

// Death of a spouse, child, or parent — grief warps the lens.
export function onGrief(c: Character): void {
  c.psyche.biases.grief_locked = clamp01(c.psyche.biases.grief_locked + 0.22);
  // Grief often deepens confirmation bias — the mind clings to the
  // meaning it assigned to the loss.
  c.psyche.biases.confirmation = clamp01(c.psyche.biases.confirmation + 0.08);
}

// ── Bias decay (annual) ──────────────────────────────────────────────────
// Experience-acquired biases fade slowly. Confirmation bias resists decay
// (high confirmation means the worldview self-reinforces). Cultural and
// universal biases (honor_bound, fatalist, mercantile, sunk_cost,
// loss_aversion, providential, doctrinal) are structural and don't decay.
export function decayBiases(w: World): void {
  for (const c of w.living()) {
    const b = c.psyche.biases;
    const resistance = b.confirmation * 0.5; // 0..0.5 friction on all decay

    // conqueror_confident fades ~3%/year; battles that update it are faster.
    b.conqueror_confident = clamp01(b.conqueror_confident - 0.03 * (1 - resistance));
    // grief_locked lifts ~1.5%/year; high confirmation prolongs mourning.
    b.grief_locked = clamp01(b.grief_locked - 0.015 * (1 - resistance));
    // betrayal_scarred fades ~1%/year in safe environments.
    b.betrayal_scarred = clamp01(b.betrayal_scarred - 0.01);
    // wishful drifts down very slowly — it's self-reinforcing when it works.
    b.wishful = clamp01(b.wishful - 0.006 * (1 - resistance));
  }
}

// ── Perception pass ───────────────────────────────────────────────────────
// Called AFTER regenerateGoals() each tick. Mutates w.goals in-place.
export function applyPerception(w: World): void {
  const additions: typeof w.goals = [];

  for (const c of w.adults()) {
    const b = c.psyche.biases;
    const d = c.psyche.distortion;

    // ── Acute distortion layer ──
    if (d === "paranoid") {
      // Phantom enemy: a random living adult is perceived as a threat.
      if (w.rng.chance(0.35)) {
        const others = w.adults().filter((x) => x.id !== c.id);
        if (others.length > 0) {
          const phantom = w.rng.pick(others);
          additions.push({
            id: w.freshId("g"),
            actorId: c.id,
            type: "ELIMINATE_RIVAL",
            targetTitleId: null,
            targetCharId: phantom.id,
            priority: clamp01(0.4 + c.drives.fear * 0.4),
          });
          // The paranoid lord sours on the perceived threat.
          w.adjustOpinion(c, phantom.id, -10);
        }
      }
      // Existing grudges feel more urgent under paranoia.
      for (const g of w.goals) {
        if (g.actorId === c.id && g.type === "REVENGE") {
          g.priority = clamp01(g.priority + 0.2);
        }
      }
    }

    if (d === "megalomaniac") {
      // All territorial goals inflated — they genuinely believe they'll win.
      for (const g of w.goals) {
        if (g.actorId !== c.id) continue;
        if (g.type === "SEIZE_TITLE" || g.type === "EXPAND") {
          g.priority = clamp01(g.priority + 0.25);
        }
      }
      // Unprompted expansion even without scarcity: ambition needs no trigger.
      if (w.rng.chance(0.25)) {
        const held = w.titlesHeldBy(c.id);
        if (held.length > 0) {
          const seat = w.province(held[0].provinceId);
          if (seat) {
            for (const nId of seat.neighbors) {
              const np = w.province(nId);
              if (!np) continue;
              const nt = w.title(np.titleId);
              if (!nt || nt.holderId === c.id) continue;
              additions.push({
                id: w.freshId("g"),
                actorId: c.id,
                type: "EXPAND",
                targetTitleId: nt.id,
                targetCharId: nt.holderId,
                priority: clamp01(0.5 + c.drives.ambition * 0.35),
              });
              break;
            }
          }
        }
      }
    }

    if (d === "zealot") {
      // Faith-based elimination: the zealot identifies heretics to purge.
      if (w.rng.chance(0.3)) {
        const faithId = w.faithIdOf(c);
        if (faithId) {
          const heretics = w.adults().filter(
            (x) => x.id !== c.id && w.faithIdOf(x) !== faithId,
          );
          if (heretics.length > 0) {
            const target = w.rng.pick(heretics);
            additions.push({
              id: w.freshId("g"),
              actorId: c.id,
              type: "ELIMINATE_RIVAL",
              targetTitleId: null,
              targetCharId: target.id,
              priority: clamp01(0.45 + c.drives.piety * 0.4),
            });
            w.adjustOpinion(c, target.id, -15);
          }
        }
      }
    }

    // ── Chronic bias layer ──

    // honor_bound: any opinion below -20 is a slight demanding satisfaction.
    if (b.honor_bound > 0.1) {
      for (const [otherId, opinion] of Object.entries(c.opinion)) {
        if (opinion >= -20) continue;
        if (!w.rng.chance(b.honor_bound * 0.25)) continue;
        const other = w.char(otherId);
        if (!other?.alive || other.id === c.id) continue;
        additions.push({
          id: w.freshId("g"),
          actorId: c.id,
          type: "REVENGE",
          targetTitleId: null,
          targetCharId: otherId,
          priority: clamp01(b.honor_bound * 0.55 + c.drives.vengeance * 0.3),
        });
      }
    }

    // doctrinal: enforces an opinion floor against characters of a different faith.
    if (b.doctrinal > 0.1) {
      const myFaith = w.faithIdOf(c);
      if (myFaith) {
        const floor = -Math.round(b.doctrinal * 40);
        for (const other of w.adults()) {
          if (other.id === c.id) continue;
          if (w.faithIdOf(other) !== myFaith) {
            const cur = c.opinion[other.id];
            if (cur === undefined || cur > floor) c.opinion[other.id] = floor;
          }
        }
      }
    }

    // confirmation: inflates ALL existing goal priorities — they hear what
    // they want and pursue it more eagerly.
    if (b.confirmation > 0.1) {
      for (const g of w.goals) {
        if (g.actorId !== c.id) continue;
        g.priority = clamp01(g.priority + b.confirmation * 0.15);
      }
    }

    // sunk_cost: claim age (years carried unfulfilled) inflates SEIZE_TITLE.
    if (b.sunk_cost > 0.05) {
      for (const g of w.goals) {
        if (g.actorId !== c.id || g.type !== "SEIZE_TITLE") continue;
        const claim = c.claims.find((cl) => cl.titleId === g.targetTitleId);
        if (!claim) continue;
        const age = Math.min(50, w.year - claim.year);
        g.priority = clamp01(g.priority + b.sunk_cost * age * 0.004);
      }
    }

    // loss_aversion: dispossessed claims get extra priority (recovering a loss
    // matters more than gaining an equivalent new title). Also inflates defence
    // (handled in resolveWars in tick.ts, not here — that touches power calc).
    if (b.loss_aversion > 0.05) {
      for (const g of w.goals) {
        if (g.actorId !== c.id || g.type !== "SEIZE_TITLE") continue;
        const claim = c.claims.find((cl) => cl.titleId === g.targetTitleId);
        if (claim?.basis?.includes("dispossessed")) {
          g.priority = clamp01(g.priority + b.loss_aversion * 0.3);
        }
      }
    }

    // grief_locked: vengeance goals feel more urgent; marriage desire fades.
    if (b.grief_locked > 0.05) {
      for (const g of w.goals) {
        if (g.actorId !== c.id) continue;
        if (g.type === "REVENGE") g.priority = clamp01(g.priority + b.grief_locked * 0.25);
        if (g.type === "MARRY") g.priority = clamp01(g.priority - b.grief_locked * 0.3);
      }
    }

    // conqueror_confident: war goals inflated; they underestimate resistance.
    if (b.conqueror_confident > 0.1) {
      for (const g of w.goals) {
        if (g.actorId !== c.id) continue;
        if (g.type === "SEIZE_TITLE" || g.type === "EXPAND") {
          g.priority = clamp01(g.priority + b.conqueror_confident * 0.2);
        }
      }
    }

    // providential: divine mandate on top of a recent victory — crusade mode.
    if (b.providential > 0.15 && b.conqueror_confident > 0.2) {
      for (const g of w.goals) {
        if (g.actorId !== c.id || g.type !== "EXPAND") continue;
        g.priority = clamp01(g.priority + b.providential * 0.15);
      }
    }
  }

  w.goals.push(...additions);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
