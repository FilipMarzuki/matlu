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
import { seedOf, shuffled } from './rng';

export type TalentId =
  | 'hardy' | 'sharp' | 'lightEater' | 'carefulHands' | 'quickLearner' | 'coldBlooded'
  | 'tough' | 'keenEye' | 'forager' | 'hunter' | 'waterfinder' | 'silverTongue'
  // The nerve (#1363): holding when others shake, and fear that makes you faster.
  | 'steady' | 'surge';

/** A talent a Warden has: which, how strong (1–4), whether they know about it, and hours of growth toward the next tier (#1264). */
export interface Talent { id: TalentId; tier: number; known: boolean; growth?: number; signs?: number }

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
  steady: { name: 'Steady', blurb: 'your hands stay still when everyone else\'s shake' },
  surge: { name: 'Surge', blurb: 'fear makes you faster, not smaller — and the shaking after costs you less' },
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
  /** Added to nerve (Steady, #1363). */
  nerve: number;
  /** Multiplies adrenaline's lift (Surge). */
  adrenaline: number;
  /** Multiplies the crash's Vigor cost (Surge: none). */
  crashVigor: number;
  /** You read danger truly: the unknown doesn't loom (Keen Eye). */
  readsTrue: boolean;
  /** Encounters with these tags look this much smaller (Hunter's Patience: animals −1). */
  calmAround: Partial<Record<string, number>>;
}

const clampTier = (t: number): number => Math.min(MAX_TIER, Math.max(MIN_TIER, Math.round(t)));

/** The combined effect of a set of talents at their tiers — hidden ones included (they work before you know them). */
export function talentEffects(talents: readonly Talent[]): TalentEffects {
  const e: TalentEffects = {
    physicalVigor: 1, clarityDrain: 1, actionDrain: {}, yield: {}, hungerCost: 1, coldCost: 1,
    deprivationCondition: 1, overexertCondition: 1, lastStand: false, practice: 1, craftGrade: 0, salvage: 0,
    startSkills: {}, trust: 0, priceFactor: 1, nerve: 0, adrenaline: 1, crashVigor: 1, readsTrue: false, calmAround: {},
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
      case 'keenEye': for (const a of ['scout', 'survey', 'lookout'] as const) drain(a, 1 - 0.05 * t); e.readsTrue = true; break;
      case 'forager': more('gather', Math.floor(t / 2)); break;
      case 'hunter': more('hunt', Math.floor(t / 2)); drain('track', 1 - 0.05 * t); e.calmAround.animal = (e.calmAround.animal ?? 0) + 1; break;
      case 'waterfinder': more('water', Math.floor(t / 2)); break;
      case 'silverTongue': e.trust += 3 * t; e.priceFactor *= 1 - 0.02 * t; break;
      case 'steady': e.nerve += t >= 3 ? 2 : 1; break;
      case 'surge': e.adrenaline *= 2; e.crashVigor = 0; break;
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

// The seeded generator lives in rng.ts (#1279); `seedOf` is re-exported for existing callers.
export { seedOf } from './rng';

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
    && ((t as Talent).growth === undefined || (typeof (t as Talent).growth === 'number' && (t as Talent).growth! >= 0))
    && ((t as Talent).signs === undefined || (Number.isInteger((t as Talent).signs) && (t as Talent).signs! >= 0))) && new Set(ids).size === ids.length;
}

// ── Growth (#1264) ──────────────────────────────────────────────────────────

/** Hours of growth at which each tier is reached (index = tier): tier 1 from the start, then 30, 150, 600. */
export const TIER_AT: readonly number[] = [0, 0, 30, 150, 600];

/** Something that happened that a talent may grow from. */
export type GrowthEvent =
  | { kind: 'work'; action: ActionId; hours: number; craft?: boolean; practised?: boolean }
  | { kind: 'night'; hungry: boolean; cold: boolean; condition: number; strained?: boolean }
  /** Facing something frightening (#1363): shaken or panicked, and you came through it. */
  | { kind: 'fright'; panicked: boolean };

/** Hours a night of hardship counts as (Light Eater, Cold-blooded, Tough). */
export const NIGHT_GROWTH = 4;

/** Hours of growth an event gives one talent (see the "grows with" column in #1262). */
export function growthFor(id: TalentId, e: GrowthEvent): number {
  // The nerve grows from being frightened and coming through (#1363): Steady from any fright, Surge from panic.
  if (e.kind === 'fright') return id === 'steady' ? NIGHT_GROWTH : id === 'surge' && e.panicked ? NIGHT_GROWTH : 0;
  if (e.kind === 'night') {
    if (id === 'lightEater') return e.hungry ? NIGHT_GROWTH : 0;
    if (id === 'coldBlooded') return e.cold ? NIGHT_GROWTH : 0;
    // Worn down: low Condition, or strained from the loads (#1293).
    if (id === 'tough') return e.condition < 50 || e.strained ? NIGHT_GROWTH : 0;
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

// ── Picking from an offer (AI parity, #1267) ────────────────────────────────

/**
 * The two talents a player takes from their offer: the requested pair if both
 * were offered, otherwise the first two offered. AI players go through this so
 * they can never pick outside their offer — the same rule a person plays by.
 */
export function chooseFromOffer(offer: readonly TalentId[], requested: readonly TalentId[] = []): TalentId[] {
  return requested.length === TALENT_PICKS && requested.every(id => offer.includes(id)) && new Set(requested).size === TALENT_PICKS
    ? [...requested]
    : offer.slice(0, TALENT_PICKS);
}

/** A seeded random pick of two from an offer (the random baseline's choice). */
export const pickRandomFromOffer = (offer: readonly TalentId[], seed: number): TalentId[] => shuffled(offer, seed).slice(0, TALENT_PICKS);

// ── Discovery (#1265) ───────────────────────────────────────────────────────
// A hidden talent works before you know it. When it makes a real difference — something
// you'd notice — that's a sign. Enough signs and the journal starts to hint, then hints
// closer, then you know. The ladder (signs → hints → reveal) is shared with the hidden
// quirk (#1268), which keeps its own counter and its own words.

/** The hint lines for a hidden gift: a vague one, a closer one, and the moment it's clear. Never the name before the reveal. */
export interface Hints { vague: string; closer: string; reveal: string }

export const HINTS: Readonly<Record<TalentId, Hints>> = {
  hardy: { vague: 'Your back took that better than you expected.', closer: 'Heavy work leaves you less spent than it should — your body seems built for it.', reveal: 'You\'ve stopped being surprised by how much your body can take.' },
  sharp: { vague: 'Your head stayed clearer than you\'d think after all that.', closer: 'Hours of work, and your thoughts keep their edge — your mind tires more slowly than most.', reveal: 'Your mind stays clear when other people\'s fog over.' },
  lightEater: { vague: 'You went without, and it barely touched you.', closer: 'Hunger gnaws at you less than it should — you get by on very little.', reveal: 'You need less food than anyone you know.' },
  carefulHands: { vague: 'That came out finer than you meant it to.', closer: 'Your hands seem to know the work better than you do.', reveal: 'Your hands are steady and sure at the bench, and it shows in everything you make.' },
  quickLearner: { vague: 'You picked that up quickly.', closer: 'Whatever you practise comes to you faster than it should.', reveal: 'You learn by doing, and you learn fast.' },
  coldBlooded: { vague: 'The cold bit less than you braced for.', closer: 'Nights that should have frozen you leave you only stiff.', reveal: 'The cold just doesn\'t reach you the way it reaches others.' },
  tough: { vague: 'You should feel worse than you do.', closer: 'Hardship takes less out of you than it should — something in you holds.', reveal: 'You can take a beating, and get up again.' },
  keenEye: { vague: 'Out on the land, your eyes find the way easily.', closer: 'You read the ground as if you\'d been here before.', reveal: 'You see what others walk past.' },
  forager: { vague: 'There was more to find than you expected.', closer: 'Wherever you gather, your hands find the good patches.', reveal: 'The land always seems to have a little more for you.' },
  hunter: { vague: 'The game came to you more easily than it should have.', closer: 'You wait where others would fidget, and the animals walk right to you.', reveal: 'You have a hunter\'s stillness, and the hunts show it.' },
  waterfinder: { vague: 'You found more water than you expected.', closer: 'Water seems to find you — the springs are always where you look.', reveal: 'You can smell water before you see it.' },
  silverTongue: { vague: 'They warmed to you quickly.', closer: 'People open up to you, and deal more fairly than you\'d expect.', reveal: 'People like you, and it makes everything easier.' },
  steady: { vague: 'Your hands were still when they should have shaken.', closer: 'Fear passes over you and leaves you level.', reveal: 'When everyone else shakes, you don\'t.' },
  surge: { vague: 'The fright sharpened you instead of shrinking you.', closer: 'When fear comes you get faster — and the crash after is lighter.', reveal: 'Fear makes you quick, not small.' },
};

/** Signs at which the journal hints, hints closer, and the talent is revealed. */
export const SIGNS_VAGUE = 2, SIGNS_CLOSER = 4, SIGNS_REVEAL = 6;

/** What a hidden talent changed this time, measured against the same moment without it. */
export interface Difference {
  /** Vigor, Clarity and Condition saved (or kept). */
  vigor: number; clarity: number; condition: number;
  /** Extra goods brought home, and extra skill practice (hours). */
  yield: number; practice: number;
  /** A better grade off the bench. */
  grade: number;
  /** Marks saved, and trust gained, on the road. */
  marks: number; trust: number;
  /** Clung on at Condition 0 (Tough's last stand) — or came through a night you otherwise wouldn't have. */
  clung: boolean;
}

/** Whether a difference is big enough to notice: a little more brought home, 2+ points saved, or a last stand. */
export const signOf = (d: Partial<Difference>): boolean =>
  (d.yield ?? 0) >= 1 || (d.practice ?? 0) >= 1 || (d.grade ?? 0) > 0 || (d.marks ?? 0) >= 1 || (d.trust ?? 0) >= 2
  || (d.vigor ?? 0) >= 2 || (d.clarity ?? 0) >= 2 || (d.condition ?? 0) >= 2 || !!d.clung;

/** What a sign means on the ladder: nothing yet, a vague hint, a closer one, or the reveal. Shared with quirks (#1268). */
export function signStep(signs: number): 'vague' | 'closer' | 'reveal' | null {
  return signs === SIGNS_VAGUE ? 'vague' : signs === SIGNS_CLOSER ? 'closer' : signs >= SIGNS_REVEAL ? 'reveal' : null;
}

/** The line that names a revealed gift. */
export const giftLine = (id: TalentId): string => `You have a gift: ${TALENTS[id].name}.`;

/**
 * A sign of the hidden talent (pure): count it, and return the journal lines it earns —
 * a hint at 2 and 4, and at 6 the reveal (the talent becomes known). A known talent gives none.
 */
export function noticeTalent(talents: readonly Talent[]): { talents: Talent[]; lines: { text: string; reveal: boolean }[] } {
  const lines: { text: string; reveal: boolean }[] = [];
  const next = talents.map(t => {
    if (t.known) return t;
    const signs = (t.signs ?? 0) + 1;
    const step = signStep(signs);
    if (step === 'reveal') {
      lines.push({ text: HINTS[t.id].reveal, reveal: true }, { text: giftLine(t.id), reveal: true });
      return { ...t, signs, known: true };
    }
    if (step) lines.push({ text: HINTS[t.id][step], reveal: false });
    return { ...t, signs };
  });
  return { talents: next, lines };
}

/** The talents without the hidden ones — the counterfactual a sign is measured against. */
export const withoutHidden = (talents: readonly Talent[]): Talent[] => talents.filter(t => t.known);
/** Whether there's a hidden talent still to find. */
export const hasHidden = (talents: readonly Talent[]): boolean => talents.some(t => !t.known);
