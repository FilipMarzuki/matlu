/**
 * Focus (#1238): what the Warden's mind is working on — a concept, a goal, a
 * skill, or a topic (#1494: a material, place, group, person, quest or job) —
 * and the survival lock that overrides it when needs are critical.
 * See docs/character-skills-design.md §3.
 *
 * Pure. Region 1 reads the lock off its state (survivalLockOf) and applies the
 * effects to actions and the night; this module holds the rules and numbers.
 */

import type { ActionId } from './region1';
import { SKILLS, SKILL_IDS, type SkillId } from './skills';
import conceptsRegistry from '../../public/macro-world/concepts.json';
import { isTopicKind, topicDef, type TopicKind } from './topics';

export type GoalId = 'shelter' | 'larder' | 'explore';

export type Focus =
  | { kind: 'concept'; id: string }
  | { kind: 'goal'; id: GoalId }
  | { kind: 'skill'; id: SkillId }
  /** A topic (#1494): something to ask people about and notice signs of — not work. */
  | { kind: TopicKind; id: string };

export type TopicFocus = Extract<Focus, { kind: TopicKind }>;
export const isTopic = (f: Focus | null | undefined): f is TopicFocus => !!f && isTopicKind(f.kind);

export const GOALS: Readonly<Record<GoalId, { name: string; actions: readonly ActionId[] }>> = {
  shelter: { name: 'Shelter', actions: ['build', 'wood'] },
  larder: { name: 'Larder', actions: ['hunt', 'gather', 'preserve'] },
  explore: { name: 'Explore', actions: ['scout', 'survey', 'lookout', 'track'] },
};
export const GOAL_IDS = Object.keys(GOALS) as GoalId[];

/**
 * Every concept in the registry (#1478): any can be named as a focus. Whether this Warden can turn
 * it over yet — one of the Region 1 six, one they have a grasp of, or one whose prerequisites
 * they've met — is checked when focus is set (`setFocus`), by the same rule as study.
 */
export const FOCUS_CONCEPTS: readonly string[] = conceptsRegistry.concepts.map(c => c.id);
/** Concept names as the registry gives them ("Gear Train", not "Gear-train"). */
const CONCEPT_NAMES: Readonly<Record<string, string>> = Object.fromEntries(conceptsRegistry.concepts.map(c => [c.id, c.name]));

/** What the locked mind works on instead: staying alive. */
export const SURVIVAL_ACTIONS: readonly ActionId[] = ['water', 'gather', 'hunt', 'wood', 'build', 'preserve'];

/** Clarity a focus costs each night. */
export const FOCUS_COST = 4;
/** Below this Clarity, focus is unreliable: its effects are halved. */
export const UNRELIABLE_BELOW = 30;
/** Insight a focused concept gains per hour worked that day. */
export const CONCEPT_PER_HOUR = 0.3;
/** Practice multiplier on a focused skill: deliberate practice — intent matters a lot (#1241). */
export const SKILL_PRACTICE = 3;
/** Goal and survival work: drain multiplier and extra yield. */
export const FOCUS_DRAIN = 0.9;
export const FOCUS_YIELD = 1;
/**
 * Better work (#1490): a craft whose skill, or one of whose concepts, is the focus scores this much
 * more on the grade scale (the scale bench, tools and concepts add to), halved when focus is
 * unreliable. Focus never makes work faster; it makes it better.
 */
export const FOCUS_GRADE = 1;

/** Why focus is locked to survival, or null. The thresholds are the issue's lock triggers. */
export function survivalLock(i: { thirsty: number; hungry: number; condition: number; daysToWinter: number; winterReady: boolean }): string | null {
  if (i.thirsty >= 1) return 'thirsty';
  if (i.hungry >= 2) return 'starving';
  if (i.condition < 40) return 'worn down';
  // The last three days of autumn (#1302) — once the snow falls, it's simply winter.
  if (i.daysToWinter >= 1 && i.daysToWinter <= 3 && !i.winterReady) return 'winter is close';
  return null;
}

/** "goal:larder" → a Focus (null for "none" or anything unknown). Used by saves and the AI. */
export function parseFocus(key: string | null | undefined): Focus | null {
  if (!key) return null;
  const at = key.indexOf(':');
  const kind = key.slice(0, at), id = key.slice(at + 1);
  if (kind === 'concept' && FOCUS_CONCEPTS.includes(id)) return { kind, id };
  if (kind === 'goal' && (GOAL_IDS as string[]).includes(id)) return { kind, id: id as GoalId };
  if (kind === 'skill' && (SKILL_IDS as string[]).includes(id)) return { kind, id: id as SkillId };
  if (isTopicKind(kind) && topicDef(kind, id)) return { kind, id };
  return null;
}
export const focusKey = (f: Focus | null): string => (f ? `${f.kind}:${f.id}` : 'none');
/** Every valid focus key, plus "none" (for the AI's schema). */
export const FOCUS_KEYS: readonly string[] = [
  'none',
  ...FOCUS_CONCEPTS.map(c => `concept:${c}`),
  ...GOAL_IDS.map(g => `goal:${g}`),
  ...SKILL_IDS.map(k => `skill:${k}`),
];

export function focusLabel(f: Focus | null): string {
  if (!f) return 'None';
  if (f.kind === 'goal') return GOALS[f.id as GoalId].name;
  if (f.kind === 'skill') return SKILLS[f.id as SkillId].name;
  if (isTopic(f)) return topicDef(f.kind, f.id)?.label ?? f.id;
  return CONCEPT_NAMES[f.id] ?? f.id[0].toUpperCase() + f.id.slice(1);
}

/** A focus as it reads mid-sentence: "the Compact", "iron", "smiths"; a concept or skill by its id. */
export const focusInline = (f: Focus): string => (isTopic(f) ? topicDef(f.kind, f.id)?.inline ?? f.id : f.id);

/** 1 when the mind is clear enough to hold focus; 0.5 when frayed. Willpower moves the threshold (#1256). */
export const reliability = (clarity: number, unreliableBelow = UNRELIABLE_BELOW): number => (clarity < unreliableBelow ? 0.5 : 1);

/** Move a multiplier halfway back toward 1 when focus is unreliable (×0.9 → ×0.95; ×2 → ×1.5). */
const scaled = (mult: number, rel: number): number => 1 + (mult - 1) * rel;

/**
 * What a focus adds to a craft's grade score (#1490): FOCUS_GRADE when the craft's skill or one of
 * its concepts is the focus, half that when focus is unreliable, nothing otherwise.
 */
export function focusGrade(focus: Focus | null, skill: SkillId | null, concepts: readonly string[], clarity: number, unreliableBelow = UNRELIABLE_BELOW): number {
  const on = (focus?.kind === 'skill' && skill !== null && focus.id === skill) || (focus?.kind === 'concept' && concepts.includes(focus.id));
  return on ? FOCUS_GRADE * reliability(clarity, unreliableBelow) : 0;
}

/**
 * What focus does to one piece of work. `locked` is the survival-lock reason
 * (or null). Yield is all-or-nothing: an unreliable focus gives no extra.
 */
export function workEffects(focus: Focus | null, locked: string | null, action: ActionId, skill: SkillId | null, clarity: number, unreliableBelow = UNRELIABLE_BELOW): { drain: number; yield: number; practice: number } {
  const rel = reliability(clarity, unreliableBelow);
  const none = { drain: 1, yield: 0, practice: 1 };
  if (locked) {
    return SURVIVAL_ACTIONS.includes(action) ? { drain: scaled(FOCUS_DRAIN, rel), yield: rel === 1 ? FOCUS_YIELD : 0, practice: 1 } : none;
  }
  if (!focus) return none;
  if (focus.kind === 'goal' && GOALS[focus.id].actions.includes(action)) return { drain: scaled(FOCUS_DRAIN, rel), yield: rel === 1 ? FOCUS_YIELD : 0, practice: 1 };
  if (focus.kind === 'skill' && skill === focus.id) return { drain: 1, yield: 0, practice: scaled(SKILL_PRACTICE, rel) };
  return none;
}
