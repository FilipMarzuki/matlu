// challenges.ts — discrete, high-risk opportunities for character growth.
//
// The base magic layer models risk as a scalar peril per province. That works
// for background XP, but great heroes don't emerge because the mountain "has
// high average danger" — they emerge because they SLEW THE DRAGON of that
// mountain. Challenges make that concrete: a wyrm, a wraith-host, an abyssal
// gate, an ancient tomb exists in the world as an object, and a specific
// character attempts it, and either they grow into legend or the challenge
// kills them and remains for the next brave fool.
//
// Rules:
// - Challenges spawn from catastrophe events (ERUPTION → fire-wyrm) or as
//   ambient world-state matches (mountain + mana-rich → dragon).
// - Each tick, eligible nearby characters roll a willingness × opportunity
//   attempt. Willingness gates who dares. Level + capital gates who survives.
// - Winning grants XP proportional to tier with a first-mover bonus (the tenth
//   dragon-slayer's story is thinner than the first), plus a class/skill
//   unlock outside the rite path.
// - Losing kills the challenger and leaves the challenge for the next attempt.
// - All events magic-gated; base sim untouched.

import { markDead } from "./phenomena.js";
import type { CharClass, Challenge, Character, EventType, WorldEvent } from "./types.js";
import type { World } from "./world.js";

// ---------------------------------------------------------------------------
// Kind catalog — every challenge type in the world. Add entries here, wire
// once, and they participate in spawning + attempts automatically.
// ---------------------------------------------------------------------------

interface ChallengeKindSpec {
  kind: string;
  tier: number;                     // 1..5
  unlocksClass: CharClass | null;
  unlocksSkill: string | null;
  spawnFromEvent?: EventType;       // reactive: catastrophe X may spawn this
  spawnProbFromEvent?: number;      // 0..1
  ambient?: {
    // Predicate over the province: is this province ELIGIBLE to spawn one?
    eligible: (w: World, provinceId: string) => boolean;
    prob: number;                   // per-tick per-eligible-province chance
  };
}

const KINDS: ChallengeKindSpec[] = [
  // Reactive spawns: catastrophes birth monsters
  { kind: "fire_wyrm",       tier: 4, unlocksClass: null,        unlocksSkill: "wyrm_slayer",
    spawnFromEvent: "ERUPTION", spawnProbFromEvent: 0.4 },
  { kind: "wraith_host",     tier: 3, unlocksClass: "warden",    unlocksSkill: null,
    spawnFromEvent: "DEAD_ZONE_FORMS", spawnProbFromEvent: 0.6 },
  { kind: "abyssal_gate",    tier: 5, unlocksClass: null,        unlocksSkill: "void_walker",
    spawnFromEvent: "MANA_RUPTURE", spawnProbFromEvent: 0.3 },
  { kind: "demon",           tier: 4, unlocksClass: "warden",    unlocksSkill: null,
    spawnFromEvent: "PORTAL_OPENS", spawnProbFromEvent: 0.5 },
  { kind: "corruption_lord", tier: 4, unlocksClass: null,        unlocksSkill: "corruption_purger",
    spawnFromEvent: "BLIGHT_LOCKED", spawnProbFromEvent: 0.4 },
  { kind: "undead_champion", tier: 4, unlocksClass: "necromancer", unlocksSkill: null,
    spawnFromEvent: "UNDEAD_RAID", spawnProbFromEvent: 0.15 },

  // Ambient spawns: state matches, low per-year probability
  { kind: "ancient_dragon",  tier: 5, unlocksClass: null,        unlocksSkill: "dragon_slayer",
    ambient: {
      eligible: (w, pid) => {
        const p = w.province(pid);
        return !!p && !p.subsurface && p.terrain === "mountain" && p.manaDensity > 0.6 && w.year > 60;
      },
      prob: 0.0015,
    },
  },
  { kind: "cursed_grove",    tier: 2, unlocksClass: null,        unlocksSkill: "grove_cleanser",
    ambient: {
      eligible: (w, pid) => {
        const p = w.province(pid);
        return !!p && !p.subsurface && (p.terrain === "forest" || p.terrain === "jungle") && p.manaDensity > 0.45;
      },
      prob: 0.008,
    },
  },
  { kind: "ancient_tomb",    tier: 3, unlocksClass: "necromancer", unlocksSkill: null,
    ambient: {
      eligible: (w, pid) => {
        const p = w.province(pid);
        return !!p && p.subsurface && p.mineralWealth > 0.6 && w.year > 40;
      },
      prob: 0.005,
    },
  },
  { kind: "feral_beast",     tier: 2, unlocksClass: null,        unlocksSkill: "beast_master",
    ambient: {
      eligible: (w, pid) => {
        const p = w.province(pid);
        return !!p && !p.subsurface && p.population < 150 && (p.terrain === "steppe" || p.terrain === "hills" || p.terrain === "forest");
      },
      prob: 0.006,
    },
  },
];

// Hard cap on active ambient challenges — prevents runaway spawn from swamping
// the log. Reactive (catastrophe-driven) spawns are uncapped because each
// requires a rare catastrophe event of its own.
const AMBIENT_ACTIVE_CAP = 8;
// Hard cap on attempt events per tick — keeps the chronicle legible.
const MAX_ATTEMPTS_PER_TICK = 4;

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export function runChallenges(w: World): void {
  if (!w.magicEnabled) return;
  spawnFromRecentEvents(w);
  spawnAmbient(w);
  runAttempts(w);
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

// Walk THIS year's events; when a catastrophe fires, roll to spawn its
// associated challenge kinds at the same province.
function spawnFromRecentEvents(w: World): void {
  for (let i = w.events.length - 1; i >= 0; i--) {
    const e = w.events[i];
    if (e.year !== w.year) break; // this-year events are at the tail
    if (!e.provinceId) continue;
    for (const k of KINDS) {
      if (k.spawnFromEvent !== e.type) continue;
      // Don't double-spawn from the same event.
      const alreadySpawned = [...w.challenges.values()].some(
        (c) => c.bornFromEventId === e.id && c.kind === k.kind,
      );
      if (alreadySpawned) continue;
      if (!w.rng.chance(k.spawnProbFromEvent ?? 0)) continue;
      createChallenge(w, k, e.provinceId, e.id);
    }
  }
}

function spawnAmbient(w: World): void {
  const activeAmbient = [...w.challenges.values()].filter(
    (c) => c.vanquishedBy === null && c.bornFromEventId === null,
  ).length;
  if (activeAmbient >= AMBIENT_ACTIVE_CAP) return;
  for (const k of KINDS) {
    if (!k.ambient) continue;
    for (const p of w.provinces.values()) {
      if (!k.ambient.eligible(w, p.id)) continue;
      // Only ONE active challenge of THIS kind per province at a time.
      const already = [...w.challenges.values()].some(
        (c) => c.vanquishedBy === null && c.kind === k.kind && c.provinceId === p.id,
      );
      if (already) continue;
      if (!w.rng.chance(k.ambient.prob)) continue;
      createChallenge(w, k, p.id, null);
      return; // one ambient spawn per year — keep the log clean
    }
  }
}

function createChallenge(
  w: World,
  spec: ChallengeKindSpec,
  provinceId: string,
  bornFromEventId: number | null,
): void {
  const id = w.freshId("chal_");
  const ch: Challenge = {
    id,
    provinceId,
    kind: spec.kind,
    tier: spec.tier,
    bornYear: w.year,
    bornFromEventId,
    vanquishedBy: null,
    vanquishedYear: null,
    unlocksClass: spec.unlocksClass,
    unlocksSkill: spec.unlocksSkill,
  };
  w.challenges.set(id, ch);
  w.log("CHALLENGE_SPAWNED", {
    provinceId,
    data: {
      challengeId: id,
      kind: spec.kind,
      tier: spec.tier,
      bornFromEventId: bornFromEventId ?? 0,
    },
  });
}

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

function runAttempts(w: World): void {
  let attempts = 0;
  for (const ch of w.challenges.values()) {
    if (ch.vanquishedBy !== null) continue;
    if (attempts >= MAX_ATTEMPTS_PER_TICK) break;
    // Only one attempt per challenge per tick.
    const candidate = pickCandidate(w, ch);
    if (!candidate) continue;
    attempts++;
    resolveAttempt(w, ch, candidate);
  }
}

// Find a viable challenger for this challenge: alive adult, in the same
// province or an adjacent one, with sufficient will to try.
function pickCandidate(w: World, ch: Challenge): Character | null {
  const prov = w.province(ch.provinceId);
  if (!prov) return null;
  const provinceSet = new Set([ch.provinceId, ...prov.neighbors]);
  let best: Character | null = null;
  let bestScore = -1;
  for (const c of w.living()) {
    if (w.age(c) < 16 || w.age(c) > 60) continue;
    if (!provinceSet.has(c.provinceId)) continue;
    const w_ = challengeWillingness(c, ch.tier);
    if (w_ < 0.45) continue;
    // Roll: base 5% + 15% * willingness, per candidate per year.
    if (!w.rng.chance(0.05 + w_ * 0.15)) continue;
    // Pick the one with highest willingness score to give them the spot.
    if (w_ > bestScore) {
      bestScore = w_;
      best = c;
    }
  }
  return best;
}

// Character-side willingness to attempt a challenge of this tier. The base sim's
// venture willingness is a good template: ambition + discomfort + grievance push
// forward, fear pulls back — with tier-weighted intimidation (tier 5 = a dragon,
// only the truly bold or truly desperate attempt).
function challengeWillingness(c: Character, tier: number): number {
  const grievance = c.claims.length > 0 || c.grudges.length > 0 ? 0.15 : 0;
  const conquerorBias = c.psyche.biases.conqueror_confident * 0.2;
  const honorBias = c.psyche.biases.honor_bound * 0.15;
  const wishful = c.psyche.biases.wishful * 0.1;
  const base =
    c.drives.ambition * 0.35 +
    (1 - c.comfort) * 0.25 +
    grievance +
    conquerorBias +
    honorBias +
    wishful -
    c.drives.fear * 0.35;
  // Intimidation: a tier-5 dragon deters weaker adventurers.
  const intimidation = Math.max(0, tier - Math.max(1, c.level) / 5) * 0.06;
  return base - intimidation;
}

function resolveAttempt(w: World, ch: Challenge, c: Character): void {
  // Count how many of THIS kind have already been vanquished — first-mover
  // bonus falls off as the story becomes familiar.
  let vanquishedBefore = 0;
  for (const other of w.challenges.values()) {
    if (other.kind === ch.kind && other.vanquishedBy !== null) vanquishedBefore++;
  }
  // Log the attempt itself (present tense — outcome comes next).
  w.log("CHALLENGE_ATTEMPTED", {
    actorId: c.id,
    provinceId: ch.provinceId,
    data: {
      challengeId: ch.id,
      kind: ch.kind,
      tier: ch.tier,
      challengerLevel: c.level,
    },
  });
  // Outcome roll: level + capital vs tier. Wealth partially buys down the
  // fight, but no capital carries you against a tier-5 gate.
  const dyn = w.dynasty(c.dynastyId);
  const wealth01 = dyn ? Math.min(1, dyn.wealth / 1000) : 0;
  const capital = wealth01 + (dyn?.rite ? 0.4 : 0);
  const pWin = clamp((c.level + capital * 3) / (ch.tier * 6), 0.05, 0.9);
  if (w.rng.chance(pWin)) {
    // Victory — a hero is made.
    ch.vanquishedBy = c.id;
    ch.vanquishedYear = w.year;
    const xpBase = 12 * ch.tier;
    const firstMoverMult = Math.max(0.8, 2 - vanquishedBefore * 0.3);
    const xpGain = Math.round(xpBase * firstMoverMult);
    // Add XP directly (bypass comfort throttle — the trial was real).
    c.lifeXp += xpGain;
    // Rough level advance: pop levels while XP exceeds cost curve.
    while (c.lifeXp >= levelCost(c.level)) {
      c.lifeXp -= levelCost(c.level);
      c.level++;
    }
    w.log("CHALLENGE_VANQUISHED", {
      actorId: c.id,
      provinceId: ch.provinceId,
      data: {
        challengeId: ch.id,
        kind: ch.kind,
        tier: ch.tier,
        xpGain,
        firstMoverMult,
        vanquishedBefore,
        newLevel: c.level,
      },
    });
    // Class unlock via trial — bypasses the dynastic rite path entirely.
    if (ch.unlocksClass) {
      const commonPath = c.charClass === "commoner" || c.charClass === "soldier" || c.charClass === "hunter" || c.charClass === "knight";
      if (commonPath && c.charClass !== ch.unlocksClass) {
        const oldClass = c.charClass;
        c.charClass = ch.unlocksClass;
        w.log("CLASS_UNLOCKED_BY_TRIAL", {
          actorId: c.id,
          provinceId: c.provinceId,
          data: {
            challengeId: ch.id,
            newClass: ch.unlocksClass,
            oldClass,
            kind: ch.kind,
          },
        });
      }
    }
    // Skill from trial — always logged if the challenge offers one.
    if (ch.unlocksSkill) {
      if (!c.skills) c.skills = [];
      if (!c.skills.includes(ch.unlocksSkill)) {
        c.skills.push(ch.unlocksSkill);
        w.log("SKILL_LEARNED_FROM_TRIAL", {
          actorId: c.id,
          provinceId: c.provinceId,
          data: {
            challengeId: ch.id,
            skill: ch.unlocksSkill,
            kind: ch.kind,
            firstOfKind: vanquishedBefore === 0,
          },
        });
      }
    }
  } else {
    // Defeat — the challenge remains, and the challenger often dies.
    const deathP = clamp(0.15 + ch.tier * 0.08 - capital * 0.02, 0.05, 0.7);
    if (w.rng.chance(deathP)) {
      w.log("CHALLENGE_SLAYS_CHALLENGER", {
        actorId: c.id,
        provinceId: ch.provinceId,
        data: {
          challengeId: ch.id,
          kind: ch.kind,
          tier: ch.tier,
        },
      });
      markDead(w, c, `slain by ${ch.kind}`);
    }
    // If they survived defeat, they still gain a taste of experience — the
    // survivor of a lost fight has learned something. No log for this; it's
    // ordinary XP that shows up in a later LEVELED event if it matters.
    else {
      c.lifeXp += Math.round(ch.tier * 2);
    }
  }
}

// ---------------------------------------------------------------------------
// Small helpers (local so this file has no cyclic dep on magic.ts internals)
// ---------------------------------------------------------------------------

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// Same curve as magic.ts — a level-N advance costs 5 * 1.16^N XP. Kept local
// to avoid coupling this module to magic.ts's private helper.
function levelCost(level: number): number {
  return Math.round(5 * Math.pow(1.16, level));
}

// Exported for external inspection / tests.
export function summariseChallenges(w: World): Record<string, number> {
  const out: Record<string, number> = {
    active: 0,
    vanquished: 0,
  };
  for (const c of w.challenges.values()) {
    if (c.vanquishedBy === null) out.active++;
    else out.vanquished++;
    out[`kind_${c.kind}`] = (out[`kind_${c.kind}`] ?? 0) + 1;
  }
  for (const e of w.events as WorldEvent[]) {
    if (e.type === "CHALLENGE_ATTEMPTED") out.attempts = (out.attempts ?? 0) + 1;
    if (e.type === "SKILL_LEARNED_FROM_TRIAL") out.skillsLearned = (out.skillsLearned ?? 0) + 1;
    if (e.type === "CLASS_UNLOCKED_BY_TRIAL") out.classUnlocks = (out.classUnlocks ?? 0) + 1;
  }
  return out;
}
