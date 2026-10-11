/**
 * Ties between the road's people (#1588, knowledge slice D; design in
 * docs/knowledge-model-design.md §5).
 *
 * People are people partly because of who they know. A **tie** joins two people: kin, friends,
 * rivals, a debt, or work done side by side. Each side holds its own **opinion** of the other,
 * from -100 to 100 (the story engine's `Character.opinion` uses the same scale, so road people
 * drawn from the engine's characters later, #1586, can bring theirs along). An opinion can come
 * with words, what they say about the other when you ask, and those words are a **claim**: a
 * person-scope fact with a truth. Maren thinks Tobin cheats her; he doesn't. She says it with
 * full confidence, and the game knows it's false (the knowledge model's `truth`, ready for the
 * journal and lies of #1580, where two accounts that clash are how a wrong one is caught).
 *
 * A tie also **carries word**. Help someone, and their friends hear of it from them: when the
 * Warden first meets someone, a friend they've helped earns them a warmer start (`tieWord`), as
 * the village-to-village word does (villages.ts `wordFrom`). People elsewhere count too: the old
 * scholar under the rock writes to the book Anselm reads, so warming the scholar warms Anselm.
 *
 * Here: the graph as written (content/ties.json, every entry a placeholder for the owner),
 * the facts it gives the knowledge model, who the Warden has helped, and the word that follows.
 * Behind the `ties` rule switch: facts.ts `factsFor` adds the facts, road.ts the word.
 *
 * Pure and deterministic: data built once from other data, no randomness.
 */

import type { Fact, Sensitivity, Truth } from './knowledge';
import { QUESTS } from './quests';
import tiesFile from './content/ties.json';

/** What joins two people. Plain kinds to start; the game reads only the opinions, never the kind. */
export type TieKind = 'kin' | 'friend' | 'rival' | 'debt' | 'colleague';

/** One side's view of the other: how they feel, and (if anything) what they say about them. */
export interface TieView {
  /** -100 loathes, 0 indifferent, 100 loves (the story engine's scale). */
  opinion: number;
  /** What they tell you about the other, asked: a person-scope fact. None, and they keep it to themself. */
  says?: string;
  /** How guarded they are about it; public unless written. */
  sensitivity?: Sensitivity;
  /** Whether it's so; true unless written. An opinion can be wrong (the owner's answer 1: about 1 in 5 is). */
  truth?: Truth;
}

/** A tie as written: two people (the second may be someone elsewhere), its kind, and each side's view. */
export interface TieEntry {
  id: string;
  kind: TieKind;
  between: readonly [string, string];
  /** By who holds them. Only someone on the road holds a view the game reads. */
  views: Readonly<Record<string, TieView>>;
  placeholder?: boolean;
  /** The canon it rests on (`file › label`). */
  source: string;
}

/** Someone off the road a tie reaches: met in the Reach, or known to someone on the road. */
export interface ElsewhereEntry {
  id: string;
  name: string;
  who: string;
  /** The deed (encounters.ts) that helped them, if the Warden can have. */
  helpedBy?: string;
  placeholder?: boolean;
  source: string;
}

// A JSON import types every string as `string` (so `kind` isn't a TieKind); `as unknown as`
// trusts the interfaces instead, and ties.test.ts checks the data really has those shapes.
const TIE_ENTRIES: readonly TieEntry[] = tiesFile.ties as unknown as readonly TieEntry[];
const ELSEWHERE_ENTRIES: readonly ElsewhereEntry[] = tiesFile.elsewhere as unknown as readonly ElsewhereEntry[];

/** Every tie as written. */
export const tieEntries = (): readonly TieEntry[] => TIE_ENTRIES;
/** Everyone elsewhere a tie reaches, as written. */
export const elsewhereEntries = (): readonly ElsewhereEntry[] => ELSEWHERE_ENTRIES;

/** One of `personId`'s ties, from their side: who to, what kind, and their view. */
export interface Tie extends TieView { id: string; kind: TieKind; other: string }

/** `personId`'s ties, as they see them (a tie they hold no view in isn't theirs to speak of). What a person sheet lists. */
export function tiesOf(personId: string): Tie[] {
  return TIE_ENTRIES.flatMap(t => {
    const v = t.views[personId];
    if (!v || !t.between.includes(personId)) return [];
    const other = t.between[0] === personId ? t.between[1] : t.between[0];
    return [{ id: t.id, kind: t.kind, other, ...v }];
  });
}

const ELSEWHERE_IDS = new Set(ELSEWHERE_ENTRIES.map(e => e.id));

/**
 * What the ties give the knowledge model: each view with words, about someone on the road, is a
 * fact in the holder's own scope (`person:<holder>`) about the other (`person:<other>`). Being a
 * person's own, it's the most specific thing they know about the other, so it comes before what
 * their village or the road says of them. Ids are `tie:<tie>:<holder>`, as scope facts are
 * `scope:` and organisations' `org:`, so a fact says where it came from.
 *
 * Someone elsewhere has no topic to ask about yet (topics.ts knows only the road's people), so
 * views of them stay in the graph, for word and the person sheet, and give no fact.
 */
export const TIE_FACTS: readonly Fact[] = TIE_ENTRIES.flatMap(t => Object.entries(t.views).flatMap(([holder, v]) => {
  const other = t.between[0] === holder ? t.between[1] : t.between[0];
  if (!v.says || ELSEWHERE_IDS.has(other)) return [];
  return [{
    id: `tie:${t.id}:${holder}`,
    about: [`person:${other}`],
    text: v.says,
    scope: { kind: 'person' as const, id: holder },
    sensitivity: v.sensitivity ?? 'public',
    truth: v.truth ?? 'true',
  }];
}));

/**
 * Who the Warden has helped: the giver of each quest done (#1248), and anyone elsewhere whose
 * deed is among the Warden's (#1499). Read off what the road already keeps, so a save carries
 * nothing new.
 */
export function helpedBy(quests: Readonly<Record<string, string>>, deeds: readonly string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const q of QUESTS) if (quests[q.id] === 'done') out.add(q.giver);
  for (const e of ELSEWHERE_ENTRIES) if (e.helpedBy && (deeds ?? []).includes(e.helpedBy)) out.add(e.id);
  return out;
}

/** The most word one tie carries, from someone its hearer loves (opinion 100); less as they like them less. */
export const TIE_WORD = 15;

/**
 * The word that reaches `personId` through their ties, before they've met the Warden: from each
 * person they think well of (opinion above 0) whom the Warden has helped, TIE_WORD scaled by
 * that opinion; the warmest one counts, not the sum, so a well-connected person isn't won over
 * by the Warden's errands alone. Someone they dislike praising you moves them not at all (a
 * grudge, not a reference); turning it against you is left for later.
 */
export function tieWord(personId: string, helped: ReadonlySet<string>): number {
  let best = 0;
  for (const t of tiesOf(personId)) if (t.opinion > 0 && helped.has(t.other)) best = Math.max(best, Math.round(TIE_WORD * t.opinion / 100));
  return best;
}
