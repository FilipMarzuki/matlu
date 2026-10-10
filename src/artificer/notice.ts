/**
 * Noticing (#1496, epic #1493 — docs/focus-and-dialogue-design.md §3). Focus is attention: a
 * Warden turning a topic over notices who's tied to it. It's passive — no hours — and it happens in
 * a village, each morning there: once for each person with a **sign** for a topic, a seeded roll.
 *
 * Focus makes it likely; knowledge makes it possible. A topic you've learned about (heard named,
 * or been told about when you asked) can come to light at a lower chance even when it isn't your
 * focus: "a person seems tied to something you know about".
 *
 * What it gives: the sign in your journal, a mark on their card, and an ask about it opens one
 * trust gate early (you've shown you know). Pure: the signs, the chance, and the day's rolls.
 */

import { streamFor } from './rng';
import { reliability } from './focus';

/** The chance a focused Warden notices a sign, each morning, at a clear mind and ordinary INT. */
export const NOTICE_FOCUSED = 0.35;
/** The chance for a topic known but not focused on. */
export const NOTICE_KNOWN = 0.1;
/** Each point of INT above 10 (below, the reverse) adds this. */
export const NOTICE_INT = 0.03;
/** Trust an ask about a noticed topic is treated as having, on top of the real trust: one gate. */
export const NOTICE_TRUST = 25;

/**
 * Signs: what a person shows of a topic they're tied to, by person id and topic key. What the
 * journal says when you notice it. The first content (#1498): the Compact's seal tokens and maps
 * (worn by its goblins, who keep it close), Gate iron, and the foragers' pockets and boots.
 */
export const SIGNS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'hf-tobin': {
    'group:compact': 'A small stamped metal disc hangs on a thong inside Tobin\'s collar: a Compact-seal token, the kind goblin bands carry as a letter of introduction.',
  },
  'hf-isa': {
    'skill:foraging': 'Isa\'s apron pockets bulge with dried caps and roots, each one wrapped and labelled in a small, tidy hand.',
  },
  'sm-yrsa': {
    'material:iron': 'Yrsa\'s arrows are tipped with iron, not flint, and every point is stamped on the tang with a small kestrel.',
  },
  'kg-arvid': {
    'group:compact': 'Arvid\'s map case is goblin work, and the map in it shows the high pass with ruins marked that are on no Gate chart.',
  },
  'kg-sabine': {
    'material:iron': 'Sabine\'s forearms are freckled with small round burns, the kind a forge throws when the iron is worked hot.',
  },
  'kg-runa': {
    'skill:foraging': 'Runa\'s boots are stained yellow-green to the ankle. Feverfew grows thick on the high slopes, and she has walked through a lot of it.',
  },
};

export interface NoticeChanceInput {
  /** The topic is your focus. */
  focused: boolean;
  /** You've learned about the topic (heard it named, or been told about it). */
  known: boolean;
  clarity: number;
  /** Where focus turns unreliable for this Warden (Willpower moves it, #1256). */
  unreliableBelow: number;
  /** INT, 10 ordinary. */
  int: number;
}

/** The chance of noticing a sign this morning: 0 for a topic neither focused nor known. */
export function noticeChance(o: NoticeChanceInput): number {
  const base = o.focused ? NOTICE_FOCUSED * reliability(o.clarity, o.unreliableBelow) : o.known ? NOTICE_KNOWN : 0;
  if (base === 0) return 0;
  return Math.max(0, Math.min(0.95, base + NOTICE_INT * (o.int - 10)));
}

export interface Noticed { person: string; topic: string; sign: string }

/**
 * What comes to light this morning in `village`: for each person here with a sign not yet
 * noticed, a seeded roll (salt `notice:<village>:<person>:<topic>`, its own stream, so no other
 * roll in the run moves).
 */
export function noticesToday(o: {
  seed: number; day: number; village: string; people: readonly { id: string }[];
  focus: string | null; known: readonly string[]; noticed: Readonly<Record<string, readonly string[]>>;
  clarity: number; unreliableBelow: number; int: number;
}): Noticed[] {
  const found: Noticed[] = [];
  for (const p of o.people) {
    for (const [topic, sign] of Object.entries(SIGNS[p.id] ?? {})) {
      if ((o.noticed[p.id] ?? []).includes(topic)) continue;
      const chance = noticeChance({ focused: topic === o.focus, known: o.known.includes(topic), clarity: o.clarity, unreliableBelow: o.unreliableBelow, int: o.int });
      if (chance > 0 && streamFor(o.seed, o.day, `notice:${o.village}:${p.id}:${topic}`)() < chance) found.push({ person: p.id, topic, sign });
    }
  }
  return found;
}
