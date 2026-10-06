/**
 * Panic, part 1 (#1360, epic #1366): how dangerous something *looks*, and whether you can hold.
 *
 * Two numbers matter when an encounter opens. Its **real threat** is the danger it truly holds:
 * it sets what can happen and never changes. Its **perceived threat** is how it looks to this
 * Warden, right now — the unknown looms, a foggy mind and a hurt body make everything worse,
 * while having met it before and knowing the field make it smaller. Panic follows perception,
 * not truth, so you can be terrified of a fox in the dark or walk calmly up to a bear — the same
 * gap between belief and fact as self-assessed skill (#1236).
 *
 * **Nerve** (from Willpower) is what you can hold. Perceived threat against nerve gives your state:
 * calm, shaken or panicked. Pure and deterministic: the same Warden meeting the same thing in
 * the same state always feels the same.
 */

import { skillLevel, LEVELS, type SkillId, type SkillPractice } from './skills';
import type { Stats } from './stats';
import type { Vitals } from './vitality';
import { fearId, type Quirk } from './quirks';
import { talentEffects, type Talent } from './talents';

/** Threat levels, 0–4. */
export type Threat = 0 | 1 | 2 | 3 | 4;
export const THREAT_WORDS: Readonly<Record<Threat, string>> = { 0: 'harmless', 1: 'uneasy', 2: 'frightening', 3: 'terrifying', 4: 'overwhelming' };

export type PanicState = 'calm' | 'shaken' | 'panicked';

/**
 * What a body does when panic takes over (#1361): lash out, run, lock up, or placate. Every
 * Warden has one, a hidden quirk (#1362); until that is known, the commonest — flight.
 */
export type Response = 'fight' | 'flight' | 'freeze' | 'fawn';
export const DEFAULT_RESPONSE: Response = 'flight';
/** The panic-response quirks (#1362), by the response each one is. */
export const RESPONSE_QUIRK: Readonly<Record<string, Response>> = { fighter: 'fight', runner: 'flight', freezer: 'freeze', appeaser: 'fawn' };
/** This Warden's panic response: their quirk's, or flight. */
export const responseOf = (w: { character: { quirks?: readonly { id: string }[] } }): Response =>
  w.character.quirks?.map(q => RESPONSE_QUIRK[q.id]).find(Boolean) ?? DEFAULT_RESPONSE;

/** Panicked: the chance instinct overrides your choice, per point of margin above 1 (#1361). */
export const OVERRIDE_PER_MARGIN = 0.35;
export const overrideChance = (margin: number): number => Math.min(1, Math.max(0, OVERRIDE_PER_MARGIN * (margin - 1)));
/** Freezing loses this many hours (#1361). */
export const FREEZE_HOURS = 2;
/** Adrenaline, shaken or panicked (#1361): STR and AGI count this much higher for the choice. */
export const ADRENALINE = 2;
/** The crash after a panic (#1361): what it costs, and how much worse the hands and the night are. */
export const CRASH_VIGOR = 10, CRASH_CLARITY = 10, SHAKING_GRADE = 1, SHAKING_SLEEP = 0.8;
/** What instinct does, in the journal: "You meant to <choice>. <this>" */
export const INSTINCT_LINE: Readonly<Record<Response, string>> = {
  fight: 'Your body went for it before you could stop it.',
  flight: 'Your legs ran.',
  freeze: 'You couldn\'t move.',
  fawn: 'Your hands were already holding something out.',
};

/** Below this Clarity a mind sees danger everywhere; below this Condition a body does. */
export const FOGGY_CLARITY = 30, HURT_CONDITION = 40;
/** Meetings survived before something stops looming (habituation). */
export const HABITUATED = 3;
/** The true skill level from which you read danger in your own field: Adept. */
export const FIELD_LEVEL = LEVELS.indexOf('Adept');
/** Ambient threat (the dark, a storm — #1367) from which anything you meet looks worse. */
export const AMBIENT_LOOMS = 2;
/** Shaken: careful options lose this much chance (one odds word), and the encounter costs this much Clarity. */
export const SHAKEN_PENALTY = 0.15, SHAKEN_CLARITY = 5;

/** What perception reads off the Warden. */
export interface Perceiver {
  vitals: Pick<Vitals, 'clarity' | 'condition'>;
  skills: SkillPractice;
  character: { stats: Stats; quirks?: readonly Quirk[]; talents?: readonly Talent[] };
  /** Encounters met and survived, by template id. */
  met?: Readonly<Record<string, number>>;
}

/** What perception reads off the thing met. */
export interface Threatening {
  id: string;
  threat: Threat;
  /** What kind of danger it is — what fears attach to (#1362). */
  tags?: readonly string[];
  /** The skill whose mastery makes it smaller (hunting for animals, scouting for the land). */
  field?: SkillId;
}

const clamp = (n: number): Threat => Math.max(0, Math.min(4, n)) as Threat;

/**
 * How dangerous it looks: the real threat, +1 each for the unknown, a looming hour (ambient
 * threat 2+), a foggy mind and a hurt body; −1 each for having met it often and for knowing
 * its field. Clamped to 0–4.
 */
export function perceivedThreat(w: Perceiver, t: Threatening, ambient = 0): Threat {
  const met = w.met?.[t.id] ?? 0;
  const te = talentEffects(w.character.talents ?? []);
  let p: number = t.threat;
  // The unknown looms — unless you read danger truly (Keen Eye, #1363).
  if (met === 0 && !te.readsTrue) p += 1;
  if (ambient >= AMBIENT_LOOMS) p += 1;
  if (w.vitals.clarity.current < FOGGY_CLARITY) p += 1;
  if (w.vitals.condition < HURT_CONDITION) p += 1;
  if (met >= HABITUATED) p -= 1;
  if (t.field && skillLevel(w.skills, t.field) >= FIELD_LEVEL) p -= 1;
  // Temperament and fears (#1362): the reckless see less, the jumpy more, and a fear makes its kind loom.
  const quirks = w.character.quirks ?? [];
  if (quirks.some(q => q.id === 'reckless')) p -= 1;
  if (quirks.some(q => q.id === 'jumpy')) p += 1;
  if ((t.tags ?? []).some(tag => quirks.some(q => q.id === fearId(tag)))) p += 1;
  // Talents that know a kind of danger make it smaller (Hunter's Patience: animals, #1363).
  for (const tag of t.tags ?? []) p -= te.calmAround[tag] ?? 0;
  return clamp(p);
}

/** What you can hold: 2 at WIL 10, one more for every 4 points above (one less for every 4 below). */
export const nerveOf = (w: Pick<Perceiver, 'character'>): number =>
  2 + Math.floor((w.character.stats.wil - 10) / 4) + talentEffects(w.character.talents ?? []).nerve;

/** Calm while the threat is within your nerve; shaken one past it; panicked beyond. */
export function panicState(perceived: number, nerve: number): PanicState {
  const margin = perceived - nerve;
  return margin <= 0 ? 'calm' : margin === 1 ? 'shaken' : 'panicked';
}

/** The whole read, for the encounter that opens: what it looks like, what you can hold, and how you stand. */
export function readThreat(w: Perceiver, t: Threatening, ambient = 0): { perceived: Threat; nerve: number; state: PanicState } {
  const perceived = perceivedThreat(w, t, ambient);
  const nerve = nerveOf(w);
  return { perceived, nerve, state: panicState(perceived, nerve) };
}

// ── The environment (#1367) ─────────────────────────────────────────────────
//
// The dark is frightening on its own, before anything appears in it: a whiteout, the distant
// ring at dusk, a winter night in a lean-to with the fire burning low. The environment has its
// own **ambient threat**, read against the same nerve. It can shake you on the land (the work
// wears the mind), spook you off it, keep you awake at night — and it makes anything you meet
// in it look worse (`perceivedThreat`'s `ambient`).

/** Light below which it is dusk, and below which it is full dark. */
export const DUSK_LIGHT = 0.5, DARK_LIGHT = 0.15;
/** A camp lived in this many days feels like home. */
export const HOME_DAYS = 10;
/** Shaken out on the land: the stretch drains this much more Clarity. */
export const UNEASE_CLARITY = 1.15;
/** Panicked on the land: the chance of a spook, by margin (2, then 3 or more). */
export const SPOOK_CHANCE: Readonly<Record<2 | 3, number>> = { 2: 0.5, 3: 0.9 };
/** A fearful night: what's left of Clarity (and Vigor) recovery — shaken, then panicked. */
export const UNEASY_NIGHT = { clarity: 0.8, vigor: 1 } as const;
export const SLEEPLESS_NIGHT = { clarity: 0.5, vigor: 0.8 } as const;
/** Calm dark nights or trips before a fear of the dark fades. */
export const DARK_FADES = 5;

/** What the weather adds: fog and storms +1, a blizzard +2. */
const weatherThreat = (weather: string, blizzard: boolean): number => (blizzard ? 2 : weather === 'fog' || weather === 'storm' ? 1 : 0);

/** A stretch of land work (#1367): the light, the weather, how far out, the season, and how well you know the ground. */
export interface LandScene { light: number; weather: string; blizzard: boolean; ring: 1 | 2 | 3; winter: boolean; knownGround: boolean }
/** Ambient threat out on the land, 0–4. */
export function landAmbient(x: LandScene): Threat {
  let a = x.light < DARK_LIGHT ? 2 : x.light < DUSK_LIGHT ? 1 : 0;
  a += weatherThreat(x.weather, x.blizzard);
  if (x.ring === 3) a += 1; // alone, hours from the fire
  if (x.winter && x.light < DUSK_LIGHT) a += 1; // the wolves are out
  if (x.knownGround) a -= 1;
  return clamp(a);
}

/** A night at camp (#1367): the weather, the season, the shelter and fire, and how long you've lived here. */
export interface NightScene { weather: string; blizzard: boolean; winter: boolean; sheltered: boolean; fire: boolean; fireKeptWarm: boolean; campDays: number }
/** Ambient threat of a night, 0–4. A tier-2 shelter with the fire kept in is the oldest comfort. */
export function nightAmbient(x: NightScene): Threat {
  let a = weatherThreat(x.weather, x.blizzard);
  if (x.winter) a += 1;
  if (!x.sheltered) a += 1;
  if (!x.fire) a += 1;
  if (x.campDays >= HOME_DAYS) a -= 1;
  if (x.fireKeptWarm) a -= 1;
  return clamp(a);
}

/**
 * How the environment's threat sits with this Warden: temperament moves it (reckless −1, jumpy
 * +1), a fear of the dark adds 1 in the dark, and nerve (Steady included) decides the state.
 */
export function frightOf(w: Perceiver, ambient: number, dark: boolean): { perceived: Threat; nerve: number; state: PanicState } {
  const quirks = w.character.quirks ?? [];
  let p = ambient;
  if (quirks.some(q => q.id === 'reckless')) p -= 1;
  if (quirks.some(q => q.id === 'jumpy')) p += 1;
  if (dark && quirks.some(q => q.id === fearId('dark'))) p += 1;
  const perceived = clamp(p);
  const nerve = nerveOf(w);
  return { perceived, nerve, state: panicState(perceived, nerve) };
}

/** The chance a panicked stretch on the land ends in a spook. */
export const spookChance = (margin: number): number => (margin >= 3 ? SPOOK_CHANCE[3] : margin >= 2 ? SPOOK_CHANCE[2] : 0);

/** Why a stretch on the land is frightening (#1364), in words — what raised it, and what calmed it. */
export function landReasons(x: LandScene): string[] {
  const out: string[] = [];
  if (x.light < DARK_LIGHT) out.push('dark'); else if (x.light < DUSK_LIGHT) out.push('dusk');
  if (x.blizzard) out.push('blizzard'); else if (x.weather === 'fog') out.push('fog'); else if (x.weather === 'storm') out.push('storm');
  if (x.ring === 3) out.push('the distant ring');
  if (x.winter && x.light < DUSK_LIGHT) out.push('wolves about');
  if (x.knownGround) out.push('ground you know');
  return out;
}

/** Why a night is frightening (#1364), in words. */
export function nightReasons(x: NightScene): string[] {
  const out: string[] = [];
  if (x.blizzard) out.push('blizzard'); else if (x.weather === 'fog') out.push('fog'); else if (x.weather === 'storm') out.push('storm');
  if (x.winter) out.push('wolves about');
  if (!x.sheltered) out.push('no shelter');
  if (!x.fire) out.push('no fire');
  if (x.fireKeptWarm) out.push('a warm shelter, the fire in');
  if (x.campDays >= HOME_DAYS) out.push('home');
  return out;
}

/** How you stand, in words (#1364): what the screen and the AI are told. */
export const STATE_WORDS: Readonly<Record<PanicState, string>> = {
  calm: 'You keep your head.',
  shaken: 'Your heart is hammering — you\'re shaken.',
  panicked: 'Panic. You can barely think.',
};

/**
 * When your read was badly wrong (#1364), the outcome shows the truth: something that looked two
 * or more steps worse than it was, or something that looked smaller than it was. Null otherwise.
 */
export function truthLine(perceived: number, real: number, kind: string): string | null {
  if (perceived - real >= 2) return kind === 'animal' ? 'Looking back, it was only ever bluffing.' : 'Looking back, it was never as bad as it looked.';
  if (perceived < real) return 'Only afterwards do you see how dangerous that was.';
  return null;
}
