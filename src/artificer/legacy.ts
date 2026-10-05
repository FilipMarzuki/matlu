/**
 * Legacy — the record of past runs, and what a Warden carries into the next
 * one (#1224). Part of the artificer sim core: pure, no Phaser, no storage.
 *
 * A run ends when Region 1 resolves (an exit is taken). Its summary goes into
 * a short history, and the player can start again either fresh or *keeping
 * what they learned*: the recipes they worked out and the concepts they
 * ranked up. The body, stores, land and tools always start over — knowledge
 * is what travels, the way it would for a real artificer.
 */

import type { Region1State, SiteId, ShelterType, WallMaterial } from './region1';
import type { EndChoice, Injury, OutcomeKind } from './winter';
import { carriedSkills, type SkillPractice } from './skills';
import type { Grade } from './crafting';

/** One finished run, as the history shows it. */
export interface RunRecord {
  /** This character's run number (1 = their first). */
  run: number;
  /** Whose run it was (#1242). Absent on history saved before character ids. */
  characterId?: string;
  characterName?: string;
  /** The day the exit was taken. */
  day: number;
  choice: EndChoice;
  kind: OutcomeKind;
  injury: Injury | null;
  /** The day the Warden first became winter-ready, or null if never. */
  readyDay: number | null;
  site: SiteId | null;
  tier: number;
  shelterGrade: Grade | null;
  shelterType: ShelterType | null;
  walls: WallMaterial | null;
  /** Tools owned at the end, as `item:grade`. */
  tools: string[];
  recipes: number;
  milestones: number;
  /** The highest-ranked concept, if any were learned. */
  topConcept: { id: string; rank: number } | null;
}

/** What carries into a new run. */
export interface Legacy {
  known: string[];
  /** Concept id → rank (insight starts again from 0). */
  concepts: Record<string, number>;
  /** Skill practice at each skill's reached level (#1236). Optional so older legacies still load. */
  skills?: SkillPractice;
}

/** Summarise a resolved run. Throws on a run still in progress — there's nothing to record yet. */
export function summarizeRun(s: Region1State, run: number): RunRecord {
  if (!s.outcome) throw new Error('cannot summarise a run that has not resolved');
  // The journal knows when the "Winter-ready" milestone first landed.
  const ready = s.log.find(l => l.kind === 'milestone' && l.text === 'Milestone — Winter-ready');
  const top = Object.entries(s.concepts)
    .filter(([, p]) => p.rank > 0)
    .sort((a, b) => b[1].rank - a[1].rank || a[0].localeCompare(b[0]))[0];
  return {
    run,
    day: s.day,
    choice: s.outcome.choice,
    kind: s.outcome.kind,
    characterId: s.character.id,
    characterName: s.character.name,
    injury: s.outcome.injury ?? null,
    readyDay: ready ? ready.day : null,
    site: s.site,
    tier: s.tier,
    shelterGrade: s.shelterGrade,
    shelterType: s.shelter.type,
    walls: s.shelter.walls,
    tools: s.tools.map(t => `${t.item}:${t.grade}`),
    recipes: s.known.length,
    milestones: s.milestones.length,
    topConcept: top ? { id: top[0], rank: top[1].rank } : null,
  };
}

/** The knowledge a Warden takes into the next run. */
export function legacyOf(s: Region1State): Legacy {
  return {
    known: [...s.known],
    concepts: Object.fromEntries(Object.entries(s.concepts).filter(([, p]) => p.rank > 0).map(([id, p]) => [id, p.rank])),
    skills: carriedSkills(s.skills),
  };
}

/**
 * Can this character go on into another run, carrying what they learned (#1242)?
 * Only a resolved run, and only if they lived: death ends the character. Knowledge
 * never passes to anyone else.
 */
export const canContinue = (s: Region1State): boolean => !!s.outcome && s.outcome.kind !== 'died';

/** The next run number for a character: their own runs only, never anyone else's (#1242). */
export function runNumberFor(history: readonly RunRecord[], characterId: string): number {
  return history.filter(r => r.characterId === characterId).length + 1;
}

/** How many past runs the history keeps. */
export const HISTORY_CAP = 20;

/** Add a run to the history: newest first, oldest dropped past the cap. */
export function addRun(history: readonly RunRecord[], rec: RunRecord): RunRecord[] {
  return [rec, ...history].slice(0, HISTORY_CAP);
}

/** How good each outcome is, for picking a best run. */
export const OUTCOME_RANK: Readonly<Record<OutcomeKind, number>> = { thrive: 5, crossed: 4, wintered: 4, ragged: 2, turnedBack: 1, grim: 0, collapsed: -1, died: -2 };

/** The best run so far (ties go to the earlier run — you got there first). */
export function bestRun(history: readonly RunRecord[]): RunRecord | null {
  let best: RunRecord | null = null;
  for (const r of history) {
    if (!best || OUTCOME_RANK[r.kind] > OUTCOME_RANK[best.kind] || (OUTCOME_RANK[r.kind] === OUTCOME_RANK[best.kind] && r.run < best.run)) best = r;
  }
  return best;
}
