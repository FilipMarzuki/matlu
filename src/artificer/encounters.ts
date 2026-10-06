/**
 * Encounters (#1343, epic #1342): things that happen while you work — an animal, a find, a
 * person — that pause the day and ask you to choose.
 *
 * Like trip luck (#1314) and accidents (#1285), they are seeded and fair: whether one happens
 * comes from a fixed roll for the day and hour, and how an option turns out from a fixed roll for
 * that encounter and choice. The same plan meets the same thing; reloading changes nothing.
 *
 * Options carry requirements (a skill level, a talent, a stat, something in stores or tools),
 * a cost, and odds that stats, skills, talents and tools move. The odds are shown in words —
 * safe, likely, risky, desperate — never as numbers, to a person and to the AI alike.
 *
 * Pure data and pure helpers; region1.ts pauses the day and applies the outcome. The templates
 * here are a first pair for the engine; animals, finds and people come in #1344–#1346.
 */

import type { Ring } from './exploration';
import type { Season } from './winter';
import type { Stores } from './region1';
import type { Tool } from './crafting';
import type { Stats, StatId } from './stats';
import type { Talent, TalentId } from './talents';
import { skillLevel, type SkillId, type SkillPractice } from './skills';
import { streamFor } from './rng';
import { ADRENALINE, SHAKEN_PENALTY, type PanicState, type Response, type Threat } from './panic';
import { JUMPY_FLIGHT, type Quirk } from './quirks';
import { talentEffects } from './talents';

export type EncounterKind = 'animal' | 'find' | 'person';

/** What an option needs before it can be chosen. All listed must hold. */
export interface Requirement {
  skill?: { id: SkillId; level: number };
  talent?: TalentId;
  stat?: { id: StatId; min: number };
  /** Goods in stores (also what the option costs, if `cost` repeats them). */
  stores?: Partial<Record<keyof Stores, number>>;
  /** An item among your tools. */
  tool?: string;
}

/** What an outcome does. Numbers are changes (negative costs). */
export interface Effect {
  text: string;
  condition?: number;
  vigor?: number;
  clarity?: number;
  stores?: Partial<Record<keyof Stores, number>>;
  /** Extra hours it takes. */
  hours?: number;
  /** If this takes Condition to 0, what the journal says killed you. */
  killedBy?: string;
}

/** How stats, skills, talents and tools move an option's chance of success. */
export interface OddsMods {
  /** Per point of the stat above 10 (negative below). */
  stats?: Partial<Record<StatId, number>>;
  /** Per true level of the skill. */
  skills?: Partial<Record<SkillId, number>>;
  /** If you have the talent (known or not — talents work before you know them). */
  talents?: Partial<Record<TalentId, number>>;
  /** If you carry the tool. */
  tools?: Readonly<Record<string, number>>;
}

export interface EncounterOption {
  id: string;
  label: string;
  requires?: Requirement;
  /** Paid when chosen, whatever the outcome. */
  cost?: { stores?: Partial<Record<keyof Stores, number>>; hours?: number };
  /** Base chance of success, 0–1. */
  odds: number;
  mods?: OddsMods;
  /** Needs a clear head (#1360): fine judgement, talking, stalking. Shaken, it goes one odds word worse; panicked, it's closed. */
  careful?: boolean;
  /** Which panic response this option is (#1361): what instinct reaches for when it takes over. */
  response?: Response;
  success: Effect;
  /** Between success and failure: half the misses land here, if given. */
  mixed?: Effect;
  fail: Effect;
}

export interface EncounterTemplate {
  id: string;
  kind: EncounterKind;
  /** What you see. */
  text: string;
  /** Where and when it can happen. Absent means anywhere / any time. */
  rings?: readonly Ring[];
  seasons?: readonly Season[];
  /** Only in the dark (light under 0.5), or only by day. */
  dark?: boolean;
  /** Relative weight among the encounters that fit. */
  weight: number;
  /** The danger it truly holds, 0–4 (#1360). What it *looks* like is panic.ts's `perceivedThreat`. */
  threat: Threat;
  /** What kind of danger it is (`animal`, `heights`, `person`…) — what fears attach to (#1362). */
  tags: readonly string[];
  /** The skill whose mastery makes it look smaller. */
  field?: SkillId;
  /** What happens if you freeze (#1361): you lose hours, and the danger decides. */
  freeze: Effect;
  options: readonly EncounterOption[];
}

/** An encounter waiting for your choice. */
export interface PendingEncounter {
  id: string; day: number; hour: number; ring: Ring; action: string;
  /** How it looked, and how you stood, when it opened (#1360). Absent (an older save) reads as calm. */
  perceived?: Threat;
  state?: PanicState;
  /** Perceived threat minus nerve, when it opened: how far past holding you were (#1361). */
  margin?: number;
}

/** The odds in words: what a person (and the AI) is told. */
export type OddsWord = 'safe' | 'likely' | 'risky' | 'desperate';

/** Chance per land trip, by ring; darkness multiplies it. At most one encounter a day. */
export const ENCOUNTER_CHANCE: Readonly<Record<Ring, number>> = { 1: 0.03, 2: 0.07, 3: 0.12 };
export const DARK_ENCOUNTER = 1.5;

/** The first templates: a gentle one and a deadly one, enough to exercise the engine. */
export const ENCOUNTERS: readonly EncounterTemplate[] = [
  {
    id: 'fox-at-the-treeline', kind: 'animal', weight: 3, threat: 1, tags: ['animal'], field: 'hunting',
    text: 'A fox stops at the treeline and looks straight at you, a hare hanging from its jaws.',
    freeze: { text: 'You stand rooted to the spot. The fox looks at you for a long moment, then trots off with its hare.' },
    options: [
      { id: 'back-away', label: 'Back away slowly', odds: 1, response: 'flight', success: { text: 'You back off until the trees close between you.' }, fail: { text: 'You back off until the trees close between you.' } },
      { id: 'watch', label: 'Stand still and watch', odds: 1, response: 'freeze', success: { text: 'It weighs you up, then trots off into the trees. You learn something about where the hares run.' }, fail: { text: 'It is gone before you blink.' } },
      { id: 'chase', label: 'Chase it for the hare', odds: 0.35, response: 'fight', mods: { stats: { agi: 0.04 } },
        success: { text: 'It drops the hare and bolts. Supper.', stores: { rawFood: 2 } },
        mixed: { text: 'You get close enough to scare it, and no closer.', vigor: -6 },
        fail: { text: 'You go down hard on the roots, and the fox is long gone.', condition: -6, vigor: -6 } },
      { id: 'stalk', label: 'Follow it home', requires: { skill: { id: 'hunting', level: 3 } }, odds: 0.75, careful: true, mods: { talents: { hunter: 0.15 } },
        success: { text: 'It leads you to a warren no one has touched.', stores: { rawFood: 3 }, hours: 1 },
        fail: { text: 'It doubles back and loses you in the brush.', hours: 1 } },
    ],
  },
  {
    id: 'crumbling-ledge', kind: 'find', weight: 1, rings: [2, 3], threat: 2, tags: ['heights'], field: 'scouting',
    text: 'Below a crumbling ledge, something glints — an old pack, wedged in the rocks.',
    freeze: { text: 'You stand frozen at the edge, staring down, until the fear drains out of your legs and you can step back.' },
    options: [
      { id: 'leave', label: 'Leave it', odds: 1, response: 'flight', success: { text: 'Whatever it was, it stays there.' }, fail: { text: 'Whatever it was, it stays there.' } },
      { id: 'go-around', label: 'Go the long way round to it', odds: 0.8, cost: { hours: 2 }, careful: true, mods: { skills: { scouting: 0.04 } },
        success: { text: 'An old trapper\'s pack: cord, a little salt, good leather.', stores: { materials: 3, hides: 1 } },
        fail: { text: 'There is no way down from this side. Two hours for nothing.' } },
      { id: 'climb-down', label: 'Climb straight down', odds: 0.6, response: 'fight', mods: { stats: { agi: 0.05, str: 0.02 } },
        success: { text: 'Quick and clean. An old trapper\'s pack: cord, a little salt, good leather.', stores: { materials: 3, hides: 1 } },
        mixed: { text: 'You slide the last stretch and land badly, but you have the pack.', condition: -12, stores: { materials: 3, hides: 1 } },
        fail: { text: 'The ledge gives way.', condition: -60, killedBy: 'a fall from a crumbling ledge' } },
    ],
  },
];

export const encounterById = (id: string): EncounterTemplate | undefined => ENCOUNTERS.find(e => e.id === id);

/** The Warden as encounters see them. */
export interface Encounterer {
  stores: Stores;
  tools: readonly Tool[];
  skills: SkillPractice;
  character: { stats: Stats; talents: readonly Talent[]; quirks?: readonly Quirk[] };
  /** The encounter in front of you, with how you stand (#1360): a shaken mind makes careful options harder. */
  pending?: PendingEncounter | null;
}

/** Why you can't choose an option, or null if you can. */
export function unmet(w: Encounterer, o: EncounterOption): string | null {
  // Tunnel vision (#1361): panicked, fine judgement is gone.
  if (o.careful && w.pending?.state === 'panicked') return "you can't think straight";
  const r = o.requires;
  const needs: Partial<Record<keyof Stores, number>> = { ...(r?.stores ?? {}) };
  for (const [k, n] of Object.entries(o.cost?.stores ?? {})) needs[k as keyof Stores] = Math.max(needs[k as keyof Stores] ?? 0, n ?? 0);
  if (r?.skill && skillLevel(w.skills, r.skill.id) < r.skill.level) return `needs ${r.skill.id} ${r.skill.level}`;
  if (r?.talent && !w.character.talents.some(t => t.id === r.talent)) return 'needs a gift you don\'t have';
  if (r?.stat && w.character.stats[r.stat.id] < r.stat.min) return `needs ${r.stat.id.toUpperCase()} ${r.stat.min}`;
  if (r?.tool && !w.tools.some(t => t.item === r.tool)) return `needs a ${r.tool.replace(/-/g, ' ')}`;
  for (const [k, n] of Object.entries(needs)) if (w.stores[k as keyof Stores] < (n ?? 0)) return `needs ${n} ${k}`;
  return null;
}

/**
 * An option's chance of success for this Warden, 0.02–0.98 (1 stays 1: a sure thing is sure).
 * Shaken or worse (#1360), a careful option loses one odds word.
 */
export function chanceOf(w: Encounterer, o: EncounterOption): number {
  if (o.odds >= 1) return 1;
  const rattled = o.careful && (w.pending?.state === 'shaken' || w.pending?.state === 'panicked');
  const m = o.mods ?? {};
  let p = o.odds;
  // Adrenaline (#1361): shaken or panicked, the body is stronger and faster for a moment.
  // Surge (#1363) doubles it.
  const surge = w.pending?.state === 'shaken' || w.pending?.state === 'panicked' ? ADRENALINE * talentEffects(w.character.talents).adrenaline : 0;
  for (const [id, per] of Object.entries(m.stats ?? {})) p += (per ?? 0) * (w.character.stats[id as StatId] - 10 + (id === 'str' || id === 'agi' ? surge : 0));
  for (const [id, per] of Object.entries(m.skills ?? {})) p += (per ?? 0) * skillLevel(w.skills, id as SkillId);
  for (const [id, add] of Object.entries(m.talents ?? {})) if (w.character.talents.some(t => t.id === id)) p += add ?? 0;
  for (const [id, add] of Object.entries(m.tools ?? {})) if (w.tools.some(t => t.item === id)) p += add;
  // Jumpy (#1362): the startle reflex gets you away fast.
  if (o.response === 'flight' && w.character.quirks?.some(q => q.id === 'jumpy')) p += JUMPY_FLIGHT;
  p = Math.max(0.02, Math.min(0.98, p));
  return rattled ? shakenChance(p) : p;
}

/** Where each odds word starts. */
const WORD_FLOOR: Readonly<Record<OddsWord, number>> = { safe: 0.95, likely: 0.7, risky: 0.4, desperate: 0 };

/**
 * A careful option, shaken (#1360): at least SHAKEN_PENALTY worse, and always at least one odds
 * word worse — "likely" becomes "risky" — since the word is what the Warden sees.
 */
function shakenChance(p: number): number {
  const floor = WORD_FLOOR[oddsWord(p)];
  return Math.max(0.02, Math.min(p - SHAKEN_PENALTY, floor > 0 ? floor - 0.05 : p - SHAKEN_PENALTY));
}

/** The odds as words. */
export function oddsWord(p: number): OddsWord {
  return p >= 0.95 ? 'safe' : p >= 0.7 ? 'likely' : p >= 0.4 ? 'risky' : 'desperate';
}

/** The options as a Warden sees them: availability, the reason if not, and the odds in words. */
export function optionsFor(w: Encounterer, t: EncounterTemplate): { option: EncounterOption; unmet: string | null; odds: OddsWord }[] {
  return t.options.map(option => ({ option, unmet: unmet(w, option), odds: oddsWord(chanceOf(w, option)) }));
}

/** What an option costs, as one number for breaking ties: its hours plus the goods it uses. */
export const costOf = (o: EncounterOption): number =>
  (o.cost?.hours ?? 0) + Object.values(o.cost?.stores ?? {}).reduce<number>((n, x) => n + (x ?? 0), 0);

/**
 * The safest option you can take (#1348): the best odds, ties going to the cheapest. What a
 * careful player picks, and what the AI harness falls back on when a reply never names a valid
 * choice. Every encounter has a sure, free option, so there is always one.
 */
export function safestOption(w: Encounterer, t: EncounterTemplate): EncounterOption {
  const open = t.options.filter(o => !unmet(w, o));
  return open.reduce((best, o) => {
    const d = chanceOf(w, o) - chanceOf(w, best);
    return d > 0 || (d === 0 && costOf(o) < costOf(best)) ? o : best;
  }, open[0] ?? t.options[0]);
}

/**
 * Does an encounter happen on this trip? A seeded roll for the day and hour against the ring's
 * chance (×1.5 in the dark), then a seeded, weighted pick among the encounters that fit.
 */
export function encounterFor(seed: number, day: number, hour: number, ring: Ring, season: Season, dark: boolean): EncounterTemplate | null {
  const roll = streamFor(seed, day, `encounter@${hour}`);
  if (roll() >= ENCOUNTER_CHANCE[ring] * (dark ? DARK_ENCOUNTER : 1)) return null;
  const fits = ENCOUNTERS.filter(e => (!e.rings || e.rings.includes(ring)) && (!e.seasons || e.seasons.includes(season)) && (e.dark === undefined || e.dark === dark));
  const total = fits.reduce((n, e) => n + e.weight, 0);
  let pick = roll() * total;
  for (const e of fits) { pick -= e.weight; if (pick < 0) return e; }
  return null;
}

/** How a chosen option turns out: a seeded roll for this encounter, day and choice. */
export function rollOutcome(seed: number, pending: PendingEncounter, o: EncounterOption, p: number): { tier: 'success' | 'mixed' | 'fail'; effect: Effect } {
  const u = streamFor(seed, pending.day, `encounter:${pending.id}:${o.id}`)();
  if (u < p) return { tier: 'success', effect: o.success };
  if (o.mixed && u < p + (1 - p) / 2) return { tier: 'mixed', effect: o.mixed };
  return { tier: 'fail', effect: o.fail };
}
