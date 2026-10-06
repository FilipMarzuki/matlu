/**
 * Region 1.5 village quests (#1248, epic #1235).
 *
 * Small, concrete jobs that need what Region 1 taught — a store of firewood, a
 * well-made waterskin, a concept you understand, a day on your feet. They're
 * how trust grows fastest, and they give concepts and skills a reason to exist
 * on the road.
 *
 * Each quest is one person's *need* (villages.ts), offered once their trust in
 * you reaches 15. Five templates, with hand-written text in the data:
 *
 *   - `fetch`   — bring N of a store good
 *   - `craft`   — hand over an item at a grade or better
 *   - `repair`  — a concept rank and some hours of work
 *   - `scout`   — hours out of the village, plus the walk there and back
 *   - `deliver` — carry something to the next village; it completes on arrival
 *
 * The deadline is the caravan: a quest still open when it rolls out expires
 * (a `deliver` instead resolves on arrival at the next village).
 *
 * Pure data plus pure helpers; road.ts holds the state and runs the actions.
 * Quest text was written with the villages in the lore pass (#1253).
 */

import { GRADES, type ConceptProgress, type Grade, type Tool } from './crafting';
import type { Stores } from './region1';
import { skillLevel, type SkillPractice } from './skills';

export type QuestKind = 'fetch' | 'craft' | 'repair' | 'scout' | 'deliver';

export type QuestNeeds =
  | { kind: 'fetch'; item: keyof Stores; qty: number }
  | { kind: 'craft'; item: string; grade: Grade }
  | { kind: 'repair'; concept: string; rank: number; hours: number }
  | { kind: 'scout'; hours: number; walk: number; minScouting?: number }
  /** You're handed `qty` of `item` on accepting, and must still have them when the caravan reaches `to`. */
  | { kind: 'deliver'; item: keyof Stores; qty: number; to: string; recipient: string };

export interface QuestReward {
  marks: number;
  item?: { item: keyof Stores; qty: number };
  /** A recipe the giver shows you, if you don't know it yet. */
  recipe?: string;
}

export interface QuestTemplate {
  id: string;
  /** Person id (villages.ts) whose need this is. */
  giver: string;
  /** Village id the giver lives in. */
  village: string;
  title: string;
  /** What the giver says when offering it. */
  offer: string;
  /** What the giver says when it's done. */
  thanks: string;
  needs: QuestNeeds;
  reward: QuestReward;
}

/** Trust a giver needs before they'll ask you for anything. */
export const OFFER_TRUST = 15;
/** Trust a finished quest earns with the giver, and with everyone else in their village. */
export const QUEST_TRUST = 20, QUEST_TRUST_VILLAGE = 5;
/** Trust lost with the giver when a quest expires unfinished, and when a delivery fails. */
export const EXPIRE_TRUST = 5, DELIVER_FAIL_TRUST = 10;
/** Handing over goods (fetch, craft) takes this long. */
export const HAND_OVER_HOURS = 1;
/** Insight a repair earns in the concept it used. */
export const REPAIR_INSIGHT = 3;
/** Drain rates for repair work and for scouting (scouting matches Region 1's Scout). */
export const REPAIR_RATES = { vigorRate: -2.5, clarityRate: -1.5 } as const;
export const SCOUT_RATES = { vigorRate: -3.5, clarityRate: -1 } as const;

const q = (t: QuestTemplate): QuestTemplate => t;

/** Two or three quests per village, one per giver. Ids are unique across the road. */
export const QUESTS: readonly QuestTemplate[] = [
  // ── Hollowford ──
  q({
    id: 'hf-forge-wood', giver: 'hf-orrin', village: 'hollowford', title: 'Wood for the forge',
    offer: 'The forge eats wood faster than I can cut it. Four good armfuls would see me through the week.',
    thanks: 'That\'s a proper fire. Here — for your trouble.',
    needs: { kind: 'fetch', item: 'firewood', qty: 4 }, reward: { marks: 5 },
  }),
  q({
    id: 'hf-ford-stones', giver: 'hf-maren', village: 'hollowford', title: 'Mend the ford stones',
    offer: 'The spring flood rolled two of the ford stones. It wants someone who knows how to shift weight without breaking their back.',
    thanks: 'Steady as the day they were laid. The ford thanks you, and so do I.',
    needs: { kind: 'repair', concept: 'leverage', rank: 1, hours: 4 }, reward: { marks: 6 },
  }),
  q({
    id: 'hf-hides-saltmere', giver: 'hf-tobin', village: 'hollowford', title: 'Hides for Hedda',
    offer: 'Hedda in Saltmere is owed two hides. Carry them for me and she\'ll pay you — and I won\'t forget it.',
    thanks: 'Hedda sent word you came through. Good — that\'s a debt settled.',
    needs: { kind: 'deliver', item: 'hides', qty: 2, to: 'saltmere', recipient: 'sm-hedda' }, reward: { marks: 8 },
  }),
  // ── Saltmere ──
  q({
    id: 'sm-waterskin', giver: 'sm-liv', village: 'saltmere', title: 'A waterskin that holds',
    offer: 'Our waterskins leak at every seam. I need one that holds — sound work or better.',
    thanks: 'Not a drop lost. The sick-room will use this every day.',
    needs: { kind: 'craft', item: 'waterskin', grade: 'sound' }, reward: { marks: 10 },
  }),
  q({
    id: 'sm-sluice', giver: 'sm-gunnar', village: 'saltmere', title: 'Clear the sluice',
    offer: 'The sluice gate is jammed and the rope\'s gone slack. Someone who understands tension could have it running by dusk.',
    thanks: 'Hear that? Water moving. Take some salt fish for the road.',
    needs: { kind: 'repair', concept: 'tension', rank: 1, hours: 4 }, reward: { marks: 6, item: { item: 'rations', qty: 2 } },
  }),
  q({
    id: 'sm-shore', giver: 'sm-yrsa', village: 'saltmere', title: 'Scout the mere shore',
    offer: 'The birds have left the north end of the mere. Walk the shore and tell me what you see — and don\'t drink there, however clear it looks.',
    thanks: 'No tracks for a mile, and the water as still as glass. I will tell Gunnar. He will not be surprised.',
    needs: { kind: 'scout', hours: 4, walk: 2 }, reward: { marks: 6 },
  }),
  // ── Kestrel Gate ──
  q({
    id: 'kg-hinges', giver: 'kg-sabine', village: 'kestrel-gate', title: 'Stock for the hinges',
    offer: 'The gate hinges want new pins and I\'m out of good stock. Five lengths of material would do it.',
    thanks: 'Good stock. The gate will swing true another year.',
    needs: { kind: 'fetch', item: 'materials', qty: 5 }, reward: { marks: 6 },
  }),
  q({
    id: 'kg-herbs', giver: 'kg-runa', village: 'kestrel-gate', title: 'Mountain herbs',
    offer: 'The hold\'s healers want feverfew from the high slopes. It\'s a long walk, and the path is easy to lose.',
    thanks: 'Feverfew, and not a stem bruised. Let me show you how the hold makes a parka.',
    needs: { kind: 'scout', hours: 5, walk: 3, minScouting: 1 }, reward: { marks: 8, recipe: 'hide-parka' },
  }),
];

export const questById = (id: string): QuestTemplate | undefined => QUESTS.find(x => x.id === id);

/** Where a quest stands. Absent from the map: not taken. */
export type QuestStatus = 'active' | 'done' | 'failed' | 'expired';

/** The quests offered in a village right now: givers trust you enough, and you haven't taken them. */
export function availableQuests(village: string | null, trust: Readonly<Record<string, number>>, status: Readonly<Record<string, QuestStatus>>): QuestTemplate[] {
  return QUESTS.filter(x => x.village === village && status[x.id] === undefined && (trust[x.giver] ?? 0) >= OFFER_TRUST);
}

/** What `canComplete` looks at. */
export interface QuestHolder {
  stores: Stores;
  tools: readonly Tool[];
  concepts: Readonly<Record<string, ConceptProgress>>;
  skills: SkillPractice;
}

/** Your best-graded copy of `item` that meets `grade`, as an index into tools, or -1. */
export function toolFor(tools: readonly Tool[], item: string, grade: Grade): number {
  let at = -1;
  tools.forEach((t, i) => {
    if (t.item !== item || GRADES.indexOf(t.grade) < GRADES.indexOf(grade)) return;
    // Hand over the worst copy that still meets the bar — keep the best for yourself.
    if (at < 0 || GRADES.indexOf(t.grade) < GRADES.indexOf(tools[at].grade)) at = i;
  });
  return at;
}

/** Why you can't finish this quest now (what's needed), or null if you can. Deliveries finish on arrival, not by hand. */
export function canComplete(quest: QuestTemplate, h: QuestHolder): string | null {
  const n = quest.needs;
  switch (n.kind) {
    case 'fetch':
      return h.stores[n.item] >= n.qty ? null : `needs ${n.qty} ${n.item} — you have ${h.stores[n.item]}`;
    case 'craft':
      return toolFor(h.tools, n.item, n.grade) >= 0 ? null : `needs a ${n.grade} or better ${n.item}`;
    case 'repair':
      return (h.concepts[n.concept]?.rank ?? 0) >= n.rank ? null : `needs ${n.concept} rank ${n.rank}`;
    case 'scout':
      return skillLevel(h.skills, 'scouting') >= (n.minScouting ?? 0) ? null : `needs scouting level ${n.minScouting}`;
    case 'deliver':
      return 'it completes when the caravan reaches the next village';
  }
}
