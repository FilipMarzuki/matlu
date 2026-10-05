/**
 * Talents (#1263, epic #1262): gifts a Warden is born with. They replace the
 * traits of #1237 and, unlike traits, have no cost — they are pure upsides.
 *
 * At creation you're offered 4 talents from a pool of 12 and pick 2; you
 * also have 1 hidden talent you don't know about. Every talent has a tier,
 * 1–4 (spark → knack → gift → mastery), that scales its effect. Tiers are
 * never shown to the player; growth (#1264) and discovery (#1265) build on
 * this module.
 *
 * Randomness without dice in the sim: the offer and the hidden talent come
 * from a seed made from the character id, so the same Warden always gets the
 * same ones — saves, carry-over and AI playtests stay deterministic.
 *
 * Like traits and stats, talents act only on drains, costs, yields and
 * bonuses — never on Vigor/Clarity caps (see the note in stats.ts).
 */

import type { ActionId } from './region1';
import type { SkillPractice } from './skills';

export type TalentId =
  | 'hardy' | 'sharp' | 'lightEater' | 'carefulHands' | 'quickLearner' | 'coldBlooded'
  | 'tough' | 'keenEye' | 'forager' | 'hunter' | 'waterfinder' | 'silverTongue';

/** A talent a Warden has: which, how strong (1–4), whether they know about it, and hours of growth toward the next tier (#1264). */
export interface Talent { id: TalentId; tier: number; known: boolean; growth?: number }

export const MIN_TIER = 1;
export const MAX_TIER = 4;
/** Names for the tiers — for design notes and reports, never shown in play. */
export const TIER_NAMES = ['', 'spark', 'knack', 'gift', 'mastery'] as const;

/** How many talents you pick at creation, and how many you're offered to pick from. */
export const TALENT_PICKS = 2;
export const OFFER_SIZE = 4;

/** Work that leans on the body — Hardy lightens it. */
export const PHYSICAL_ACTIONS: readonly ActionId[] = ['wood', 'quarry', 'build', 'hunt', 'gather', 'water'];

export interface TalentDef {
  name: string;
  /** What it does, without numbers (tiers are hidden). */
  blurb: string;
}

export const TALENTS: Readonly<Record<TalentId, TalentDef>> = {
  hardy: { name: 'Hardy', blurb: 'physical work tires the body less' },
  sharp: { name: 'Sharp-minded', blurb: 'all work tires the mind less' },
  lightEater: { name: 'Light Eater', blurb: 'hunger costs you less' },
  carefulHands: { name: 'Careful Hands', blurb: 'finer crafts, and more saved from a failed one' },
  quickLearner: { name: 'Quick Learner', blurb: 'skills improve faster' },
  coldBlooded: { name: 'Cold-blooded', blurb: 'cold nights cost you less' },
  tough: { name: 'Tough', blurb: 'hardship and overwork cost less Condition — and in time, you cling on when you should fall' },
  keenEye: { name: 'Keen Eye', blurb: 'a born scout: scouting tires you less, and you start with a little practice' },
  forager: { name: 'Forager', blurb: 'gathering trips bring back more' },
  hunter: { name: "Hunter's Patience", blurb: 'hunts bring back more, and tracking tires you less' },
  waterfinder: { name: 'Waterfinder', blurb: 'water trips bring back more' },
  silverTongue: { name: 'Silver Tongue', blurb: 'people warm to you and deal fairer (on the caravan road)' },
};
export const TALENT_IDS = Object.keys(TALENTS) as TalentId[];

/** Everything talents can touch. Multipliers default to 1, additions to 0. */
export interface TalentEffects {
  /** Vigor drain on physical work (Hardy). */
  physicalVigor: number;
  /** Clarity drain on all work (Sharp-minded). */
  clarityDrain: number;
  /** Drain (Vigor and Clarity) on particular actions (Keen Eye: scouting; Hunter: tracking). */
  actionDrain: Partial<Record<ActionId, number>>;
  /** Extra yield on particular actions (Forager, Hunter, Waterfinder). */
  yield: Partial<Record<ActionId, number>>;
  /** Hunger's cost (Light Eater). */
  hungerCost: number;
  /** A cold night's Condition cost (Cold-blooded; 0 = immune). */
  coldCost: number;
  /** Condition lost to hunger and thirst (Tough). */
  deprivationCondition: number;
  /** Condition lost to pushing past empty (Tough). */
  overexertCondition: number;
  /** Once per run, Condition 0 leaves you at 1 (Tough, from tier 3). */
  lastStand: boolean;
  /** Skill practice per hour worked (Quick Learner). */
  practice: number;
  /** Added to the craft-grade score (Careful Hands). */
  craftGrade: number;
  /** Added to the salvage fraction of a failed craft (Careful Hands). */
  salvage: number;
  /** Practice a new Warden starts with (Keen Eye) — from chosen talents only. */
  startSkills: SkillPractice;
  /** On the road: added to people's starting trust (Silver Tongue, #1246). */
  trust: number;
  /** On the road: multiplies what you pay (Silver Tongue, #1247). */
  priceFactor: number;
}

const clampTier = (t: number): number => Math.min(MAX_TIER, Math.max(MIN_TIER, Math.round(t)));

/** The combined effect of a set of talents at their tiers — hidden ones included (they work before you know them). */
export function talentEffects(talents: readonly Talent[]): TalentEffects {
  const e: TalentEffects = {
    physicalVigor: 1, clarityDrain: 1, actionDrain: {}, yield: {}, hungerCost: 1, coldCost: 1,
    deprivationCondition: 1, overexertCondition: 1, lastStand: false, practice: 1, craftGrade: 0, salvage: 0,
    startSkills: {}, trust: 0, priceFactor: 1,
  };
  const drain = (a: ActionId, m: number) => { e.actionDrain[a] = (e.actionDrain[a] ?? 1) * m; };
  const more = (a: ActionId, n: number) => { if (n) e.yield[a] = (e.yield[a] ?? 0) + n; };
  for (const { id, tier } of talents) {
    const t = clampTier(tier);
    switch (id) {
      case 'hardy': e.physicalVigor *= 1 - 0.04 * t; break;
      case 'sharp': e.clarityDrain *= 1 - 0.04 * t; break;
      case 'lightEater': e.hungerCost *= Math.max(0, 1 - 0.12 * t); break;
      case 'carefulHands': e.craftGrade += Math.floor(t / 2); e.salvage += 0.05 * t; break;
      case 'quickLearner': e.practice *= 1 + 0.12 * t; break;
      case 'coldBlooded': e.coldCost *= Math.max(0, 1 - 0.25 * t); break;
      case 'tough':
        e.deprivationCondition *= 1 - 0.05 * t;
        e.overexertCondition *= 1 - 0.05 * t;
        e.lastStand ||= t >= 3;
        break;
      case 'keenEye': for (const a of ['scout', 'survey', 'lookout'] as const) drain(a, 1 - 0.05 * t); break;
      case 'forager': more('gather', Math.floor(t / 2)); break;
      case 'hunter': more('hunt', Math.floor(t / 2)); drain('track', 1 - 0.05 * t); break;
      case 'waterfinder': more('water', Math.floor(t / 2)); break;
      case 'silverTongue': e.trust += 3 * t; e.priceFactor *= 1 - 0.02 * t; break;
    }
  }
  return e;
}

/** Drain multipliers from talents for one piece of work. */
export function talentDrain(talents: readonly Talent[], action: ActionId): { vigor: number; clarity: number } {
  const e = talentEffects(talents);
  const a = e.actionDrain[action] ?? 1;
  return { vigor: (PHYSICAL_ACTIONS.includes(action) ? e.physicalVigor : 1) * a, clarity: e.clarityDrain * a };
}

/** Practice a Warden starts with from the talents they chose (Keen Eye). */
export function startingPractice(chosen: readonly TalentId[]): SkillPractice {
  return chosen.includes('keenEye') ? { scouting: 5 } : {};
}

// ── Seeded choices ──────────────────────────────────────────────────────────

/** A stable 32-bit seed from a character id (FNV-1a). */
export function seedOf(characterId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < characterId.length; i++) {
    h ^= characterId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A small deterministic generator (mulberry32): the same seed gives the same sequence. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded shuffle (Fisher–Yates) of a copy. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The talents a Warden is offered at creation: 4 distinct, always the same for the same seed. */
export const talentOffer = (seed: number): TalentId[] => shuffled(TALENT_IDS, seed).slice(0, OFFER_SIZE);

/** The Warden's hidden talent: one they didn't choose, from a separate stream of the same seed. */
export function hiddenTalent(seed: number, chosen: readonly TalentId[]): TalentId {
  const pool = TALENT_IDS.filter(id => !chosen.includes(id));
  return shuffled(pool, seed ^ 0x9e3779b9)[0];
}

/** A Warden's starting talents: the chosen ones (known), plus — if they have an id to seed it — a hidden one. All at tier 1. */
export function startingTalents(chosen: readonly TalentId[], characterId: string): Talent[] {
  const known = chosen.map(id => ({ id, tier: MIN_TIER, known: true }));
  if (!characterId) return known;
  return [...known, { id: hiddenTalent(seedOf(characterId), chosen), tier: MIN_TIER, known: false }];
}

/** A valid creation pick: known ids, no repeats, exactly {@link TALENT_PICKS} (or none, for a quick start). */
export function validPick(ids: readonly string[]): ids is TalentId[] {
  return (ids.length === 0 || ids.length === TALENT_PICKS) && new Set(ids).size === ids.length && ids.every(id => id in TALENTS);
}

/** A well-formed talent list from a save (ids known, tiers 1–4, at most one of each). */
export function validTalents(x: unknown): x is Talent[] {
  if (!Array.isArray(x)) return false;
  const ids = x.map(t => (typeof t === 'object' && t !== null ? (t as Talent).id : undefined));
  return x.every(t => typeof t === 'object' && t !== null && (t as Talent).id in TALENTS
    && Number.isInteger((t as Talent).tier) && (t as Talent).tier >= MIN_TIER && (t as Talent).tier <= MAX_TIER
    && typeof (t as Talent).known === 'boolean'
    && ((t as Talent).growth === undefined || (typeof (t as Talent).growth === 'number' && (t as Talent).growth! >= 0))) && new Set(ids).size === ids.length;
}

// ── Growth (#1264) ──────────────────────────────────────────────────────────

/** Hours of growth at which each tier is reached (index = tier): tier 1 from the start, then 30, 150, 600. */
export const TIER_AT: readonly number[] = [0, 0, 30, 150, 600];

/** Something that happened that a talent may grow from. */
export type GrowthEvent =
  | { kind: 'work'; action: ActionId; hours: number; craft?: boolean; practised?: boolean }
  | { kind: 'night'; hungry: boolean; cold: boolean; condition: number };

/** Hours a night of hardship counts as (Light Eater, Cold-blooded, Tough). */
export const NIGHT_GROWTH = 4;

/** Hours of growth an event gives one talent (see the "grows with" column in #1262). */
export function growthFor(id: TalentId, e: GrowthEvent): number {
  if (e.kind === 'night') {
    if (id === 'lightEater') return e.hungry ? NIGHT_GROWTH : 0;
    if (id === 'coldBlooded') return e.cold ? NIGHT_GROWTH : 0;
    if (id === 'tough') return e.condition < 50 ? NIGHT_GROWTH : 0;
    return 0;
  }
  const { action: a, hours: h } = e;
  switch (id) {
    case 'hardy': return PHYSICAL_ACTIONS.includes(a) ? h : 0;
    case 'sharp': return a === 'study' || e.craft ? h : 0;
    case 'carefulHands': return e.craft ? h : 0;
    case 'quickLearner': return e.practised ? h : 0;
    case 'keenEye': return a === 'scout' || a === 'survey' || a === 'lookout' ? h : 0;
    case 'forager': return a === 'gather' ? h : 0;
    case 'hunter': return a === 'hunt' || a === 'track' ? h : 0;
    case 'waterfinder': return a === 'water' ? h : 0;
    // Grows from talking and trading on the road (#1246, #1247).
    default: return 0;
  }
}

/** The tier reached at this much growth (1–4). */
export const tierFor = (growth: number): number => TIER_AT.reduce((t, at, i) => (i >= MIN_TIER && growth >= at ? i : t), MIN_TIER);

/**
 * Grow every talent — known and hidden alike — from one event. Returns the new
 * list and how many tiers were gained, so the caller can let the Warden feel it
 * without saying what grew.
 */
export function growTalents(talents: readonly Talent[], e: GrowthEvent): { talents: Talent[]; tierUps: number } {
  let tierUps = 0;
  const next = talents.map(t => {
    const add = t.tier >= MAX_TIER ? 0 : growthFor(t.id, e);
    if (add <= 0) return t;
    const growth = (t.growth ?? 0) + add;
    const tier = Math.max(t.tier, tierFor(growth));
    tierUps += tier - t.tier;
    return { ...t, growth, tier };
  });
  return { talents: next, tierUps };
}

/** What a tier-up feels like: something settles, nothing is named. */
export const TIER_UP_LINE = 'Something in you has settled; it comes easier than it did.';
