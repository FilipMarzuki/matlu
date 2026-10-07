/**
 * Legacy — the record of past runs, and what a Warden carries into the next
 * one (#1224). Part of the artificer sim core: pure, no Phaser, no storage.
 *
 * A run ends when Region 1 resolves (the thaw, or the body giving out). Its summary goes into
 * a short history, and the player can start again either fresh or *keeping
 * what they learned*: the recipes they worked out and the concepts they
 * ranked up. The body, stores, land and tools always start over — knowledge
 * is what travels, the way it would for a real artificer.
 */

import type { KitId } from './kit';
import type { Background } from './scout';
import type { Quirk } from './quirks';
import type { Region1State, SiteId, ShelterType, WallMaterial } from './region1';
import { ROUTE, type RoadState } from './road';
import { CONTACT_TRUST } from './villages';
import type { EndChoice, Grade as WinterGrade, Injury, OutcomeKind } from './winter';
import type { Stats } from './stats';
import type { Talent } from './talents';
import { carriedSkills, type SkillPractice } from './skills';
import type { Grade } from './crafting';
import type { Harm } from './injuries';

/** How a run can end: any Region 1 outcome, or the road's own ends (#1250). */
export type RunKind = OutcomeKind | 'arrived';

/** One finished run, as the history shows it. */
export interface RunRecord {
  /** This character's run number (1 = their first). */
  run: number;
  /** Whose run it was (#1242). Absent on history saved before character ids. */
  characterId?: string;
  characterName?: string;
  /** The day the run ended: the thaw, the day the body gave out, or (old records) the day of the exit. */
  day: number;
  choice: EndChoice;
  /** How the run ended: Region 1's outcome, or — for a run that rode on — how the road ended (#1250). */
  kind: RunKind;
  /** Where the run ended (#1250): in the Reach, or on the caravan road. Absent on older records (the Reach). */
  stage?: 'reach' | 'road';
  /** What the road came to (#1250), for a run that rode on: the villages reached, quests done, and marks at the end. */
  road?: { villages: string[]; quests: number; marks: number };
  /** How the Warden came through the winter (#1302), for a survived run. Absent on older records. */
  grade?: WinterGrade;
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
  /** Skill practice (#1236). Optional so older legacies still load. */
  skills?: SkillPractice;
  /** Techniques known (#1243). Manuals don't carry — they're possessions, left behind. */
  techniques?: string[];
  /** Base stats (#1256): the adult ones (#1399). Optional so older legacies still load. */
  stats?: Stats;
  /** Talents with their tiers and discoveries (#1263). Optional so older legacies still load. */
  talents?: Talent[];
  /** People who came to trust you on the road (#1250): trust 50+. They remember you next time. */
  contacts?: string[];
  /** Marks you ended the road with (#1250). */
  marks?: number;
  /** Encounters met and survived, by template id (#1360): experience that makes them look smaller. */
  met?: Record<string, number>;
  /** Quirks (#1362): who you are goes with you — the panic response, temperament, fears, and which you know. */
  quirks?: Quirk[];
  /** What they packed last time (#1400): the next run starts packing from it. */
  pack?: KitId[];
  /** How old they were (#1399); the next run is a year on. Absent: an adult. */
  age?: number;
  /** Who the character was before the Reach (#1398). */
  background?: Background;
  /** Lasting harms (#1392): an old injury goes with you. */
  harms?: Harm[];
}

export { CONTACT_TRUST } from './villages';

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
    ...(s.outcome.grade ? { grade: s.outcome.grade } : {}),
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

/** What a run carries, wherever it ended: the knowledge, and what the road earned (#1250). */
type Carrier = Pick<Region1State, 'known' | 'concepts' | 'skills' | 'techniques' | 'character' | 'marks' | 'contacts' | 'met'>;

/** The knowledge a Warden takes into the next run — and any marks and contacts from an earlier road. */
export function legacyOf(s: Carrier): Legacy {
  return {
    ...(s.marks ? { marks: s.marks } : {}),
    ...(s.contacts?.length ? { contacts: [...s.contacts] } : {}),
    ...(s.met && Object.keys(s.met).length ? { met: { ...s.met } } : {}),
    known: [...s.known],
    concepts: Object.fromEntries(Object.entries(s.concepts).filter(([, p]) => p.rank > 0).map(([id, p]) => [id, p.rank])),
    skills: carriedSkills(s.skills),
    techniques: [...s.techniques],
    // The adult stats (#1399): the current ones are worked out again from them and the age.
    stats: { ...(s.character.adult ?? s.character.stats) },
    ...(s.character.age !== undefined ? { age: s.character.age } : {}),
    talents: s.character.talents.map(t => ({ ...t })),
    ...(s.character.quirks ? { quirks: s.character.quirks.map(q => ({ ...q })) } : {}),
    ...(s.character.harms?.length ? { harms: [...s.character.harms] } : {}),
    ...(s.character.background ? { background: s.character.background } : {}),
    ...(s.character.pack ? { pack: [...s.character.pack] } : {}),
  };
}

/** What a run that rode the road carries (#1250): its knowledge, the marks in hand, and everyone who trusts you 50+. */
export function legacyOfRoad(r: RoadState): Legacy {
  const trusted = Object.entries(r.trust).filter(([, t]) => t >= CONTACT_TRUST).map(([id]) => id);
  const contacts = [...new Set([...r.contacts, ...trusted])];
  return { ...legacyOf(r), marks: r.marks, ...(contacts.length ? { contacts } : { contacts: [] }) };
}

/** The villages the road reached (#1250): every village leg up to where the caravan got to. */
export const villagesVisited = (r: RoadState): string[] =>
  ROUTE.slice(0, r.leg + 1).flatMap(l => (l.kind === 'village' ? [l.id] : []));

/**
 * Summarise a run that rode on (#1250): the Reach part as `summarizeRun`, then how the
 * road ended, the day it ended (counting on from the thaw), and what it came to.
 */
export function summarizeRoad(r: RoadState, reach: Region1State, run: number): RunRecord {
  if (!r.outcome) throw new Error('cannot summarise a road that has not resolved');
  return {
    ...summarizeRun(reach, run),
    stage: 'road',
    kind: r.outcome.kind,
    day: reach.day + r.day - 1,
    tools: r.tools.map(t => `${t.item}:${t.grade}`),
    recipes: r.known.length,
    road: { villages: villagesVisited(r), quests: Object.values(r.quests).filter(q => q === 'done').length, marks: r.marks },
  };
}

/**
 * Can this character go on into another run, carrying what they learned (#1242)?
 * Only a resolved run (in the Reach or on the road), and only if they lived: death
 * ends the character. Knowledge never passes to anyone else.
 */
export const canContinue = (s: { outcome: { kind: string } | null }): boolean => !!s.outcome && s.outcome.kind !== 'died';

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

/** How good each outcome is, for picking a best run. Surviving the winter beats any of the old exits. */
export const OUTCOME_RANK: Readonly<Record<RunKind, number>> = { arrived: 7, survived: 6, thrive: 5, crossed: 4, wintered: 4, ragged: 2, turnedBack: 1, grim: 0, collapsed: -1, died: -2 };

/** A run's rank: its outcome, and for a survived winter how well (hale over worn over broken). */
export const runRank = (r: Pick<RunRecord, 'kind' | 'grade'>): number =>
  OUTCOME_RANK[r.kind] + (r.grade === 'hale' ? 0.2 : r.grade === 'worn' ? 0.1 : 0);

/** The best run so far (ties go to the earlier run — you got there first). */
export function bestRun(history: readonly RunRecord[]): RunRecord | null {
  let best: RunRecord | null = null;
  for (const r of history) {
    if (!best || runRank(r) > runRank(best) || (runRank(r) === runRank(best) && r.run < best.run)) best = r;
  }
  return best;
}
