/**
 * Topics (#1494, epic #1493 — docs/focus-and-dialogue-design.md §1): what a Warden can focus on
 * beyond goals, skills and concepts — a material, a place, a group, a person, a quest or a job.
 * Focus is attention: a topic is something you can ask people about (#1495) and notice signs of
 * (#1496).
 *
 * A topic can be focused on once the Warden has **come across** it, the rule concepts follow
 * (#1478). Most of that is read off what the run already keeps — the people you've met (their
 * trust), and through them their jobs, their People and their village; the quests you've taken;
 * the materials you hold. The rest is what you've heard named: `heard`, filled from the lore lines
 * people tell you (`mentionsIn`).
 *
 * Pure. Keys are `kind:id` — the same shape as every focus key (`material:iron`, `group:compact`).
 */

import { VILLAGES, TRAVELLERS, type Person } from './villages';
import { QUESTS } from './quests';

export type TopicKind = 'material' | 'place' | 'group' | 'person' | 'quest' | 'role';
export const TOPIC_KINDS: readonly TopicKind[] = ['material', 'place', 'group', 'person', 'quest', 'role'];
export const isTopicKind = (k: string): k is TopicKind => (TOPIC_KINDS as readonly string[]).includes(k);

export interface TopicDef {
  /** How the topic reads on its own: a chip, a heading ("The Compact", "Iron", "Smiths"). */
  label: string;
  /** How it reads mid-sentence ("the Compact", "iron", "smiths"). */
  inline: string;
  /** How people name it when they talk; null for a topic that's never simply named (a quest). */
  named: RegExp | null;
}

const def = (label: string, named: RegExp | null, inline = label): TopicDef => ({ label, inline, named });
/** A word on its own: `\b` both sides, so "ironborne" isn't iron. */
const word = (w: string, flags = 'i') => new RegExp(`\\b(?:${w})\\b`, flags);

/** Everyone on the road: the villages' people and the caravan's own (TRAVELLERS). */
const EVERYONE: readonly Person[] = [...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS];
/** The village each person lives in; travellers have none. */
const HOME: Readonly<Record<string, string>> = Object.fromEntries(Object.values(VILLAGES).flatMap(v => v.people.map(p => [p.id, v.id])));

/** The 15 Mistheim Peoples (villages.ts `People`), as groups. */
const PEOPLES = ['Bergfolk', 'Lövfolk', 'Markfolk', 'Viddfolk', 'Steinfolk', 'Pandor', 'Deepwalkers', 'Merfolk', 'Goblins', 'Fae', 'Giants', 'Dragons', 'Everstill', 'Constructs', 'Remnants'] as const;

/** A name two people share ("Runa") can't open either one: it isn't clear who was meant. */
const nameCount = EVERYONE.reduce<Record<string, number>>((n, p) => ({ ...n, [p.name]: (n[p.name] ?? 0) + 1 }), {});

export const TOPICS: Readonly<Record<TopicKind, Readonly<Record<string, TopicDef>>>> = {
  material: {
    iron: def('Iron', word('iron'), 'iron'),
    copper: def('Copper', word('copper'), 'copper'),
    stone: def('Stone', word('stones?'), 'stone'),
    hides: def('Hides', word('hides?'), 'hides'),
    salt: def('Salt', word('salt'), 'salt'),
    wood: def('Wood', word('wood|timber'), 'wood'),
    'mana-granite': def('Mana-granite', word('mana-granite'), 'mana-granite'),
  },
  place: {
    ...Object.fromEntries(Object.values(VILLAGES).map(v => [v.id, def(v.name, word(v.name, ''))])),
    mistheim: def('Mistheim', word('Mistheim', '')),
    reach: def('The Reach', word('the Reach', ''), 'the Reach'),
  },
  group: {
    compact: def('The Compact', word('Compact', ''), 'the Compact'),
    'vidde-accords': def('The Vidde Accords', word('Vidde Accords', ''), 'the Vidde Accords'),
    dyprike: def('The Dyprike', word('Dyprike', ''), 'the Dyprike'),
    ...Object.fromEntries(PEOPLES.map(p => [p, def(p, word(p, ''))])),
  },
  person: Object.fromEntries(EVERYONE.map(p => [p.id, def(p.name, nameCount[p.name] === 1 ? word(p.name, '') : null)])),
  quest: Object.fromEntries(QUESTS.map(q => [q.id, def(q.title, null)])),
  role: {
    trader: def('Traders', word('traders?'), 'traders'),
    teacher: def('Teachers', word('teachers?'), 'teachers'),
    healer: def('Healers', word('healers?|healing'), 'healers'),
    elder: def('Elders', word('elders?'), 'elders'),
    smith: def('Smiths', word('smiths?|smithing|blacksmiths?'), 'smiths'),
    hunter: def('Hunters', word('hunters?'), 'hunters'),
    caravaneer: def('Caravaneers', word('caravaneers?'), 'caravaneers'),
    tinker: def('Tinkers', word('tinkers?'), 'tinkers'),
    artificer: def('Artificers', word('artificers?'), 'artificers'),
  },
};

export const topicDef = (kind: TopicKind, id: string): TopicDef | undefined => TOPICS[kind][id];
const isKey = (key: string): boolean => {
  const i = key.indexOf(':');
  const kind = key.slice(0, i);
  return i > 0 && isTopicKind(kind) && topicDef(kind, key.slice(i + 1)) !== undefined;
};

/** Every topic named in a line of talk, as keys. */
export function mentionsIn(text: string): string[] {
  const found: string[] = [];
  for (const kind of TOPIC_KINDS) {
    for (const [id, d] of Object.entries(TOPICS[kind])) if (d.named?.test(text)) found.push(`${kind}:${id}`);
  }
  return found;
}

/** The stores a material topic is read from: hold some and you've come across it. */
const HELD = { stone: 'stone', hides: 'hides', firewood: 'wood' } as const;

/** What the come-across rule reads (a Region 1 state or a road state has these). */
export interface Acquaintance {
  /** Topics heard named (the road: lore lines told). */
  heard?: readonly string[];
  stores: { readonly [K in keyof typeof HELD]?: number };
  /** Who you've met: everyone with a trust entry (the road). */
  trust?: Readonly<Record<string, number>>;
  /** The quests you've taken, done or failed (the road). */
  quests?: Readonly<Record<string, unknown>>;
  /** People answers have sent you to, and where (the road, #1497). */
  leads?: readonly { who: string; where?: string }[];
}

/**
 * The topics this Warden has come across, as sorted keys: heard named, held, met (and through
 * the people met, their jobs, their People and their village), and quests taken.
 */
export function topicsOpen(s: Acquaintance): string[] {
  const open = new Set<string>((s.heard ?? []).filter(isKey));
  for (const store of Object.keys(HELD) as (keyof typeof HELD)[]) if ((s.stores[store] ?? 0) > 0) open.add(`material:${HELD[store]}`);
  for (const id of Object.keys(s.trust ?? {})) {
    const p = EVERYONE.find(x => x.id === id);
    if (!p) continue;
    open.add(`person:${p.id}`).add(`role:${p.role}`).add(`group:${p.people}`);
    if (HOME[p.id]) open.add(`place:${HOME[p.id]}`);
  }
  for (const id of Object.keys(s.quests ?? {})) if (topicDef('quest', id)) open.add(`quest:${id}`);
  // A lead opens its person, and where they are (#1497): you can ask after them before you meet them.
  for (const l of s.leads ?? []) {
    if (topicDef('person', l.who)) open.add(`person:${l.who}`);
    if (l.where && topicDef('place', l.where)) open.add(`place:${l.where}`);
  }
  return [...open].sort();
}
