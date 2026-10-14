/**
 * The road's words in the viewer's language (#1709, phase 3 of #1685): who someone is, how they
 * seem with you, a quest's needs and reward, a village's market. Like sim-words.ts, these read the
 * sim's ids and numbers and say them through the catalog; the sim keeps its English for the AI and
 * the API.
 */

import type { Key, T } from '../artificer/i18n';
import type { Person, Role } from '../artificer/villages';
import { personById, VILLAGES } from '../artificer/villages';
import type { QuestTemplate } from '../artificer/quests';
import type { Rapport } from '../artificer/rapport';
import { RAPPORT_WORDS } from '../artificer/rapport';
import type { LocalMarket } from '../artificer/economy';
import { en } from '../artificer/i18n/en';
import { techniqueById } from '../artificer/techniques';
import { conceptName, goodName, isKey } from './sim-words';

export const roleName = (r: Role, t: T): string => t(`role.${r}`);
export const peopleName = (p: Person['people'], t: T): string => t(`people.${p}`);
/** A culture id as words ("caravan-folk" → "caravan folk"); one the catalog doesn't have keeps its id as words. */
export const cultureName = (id: string, t: T): string => (isKey(`culture.${id}`) ? t(`culture.${id}` as Key) : id.replace(/-/g, ' '));
export const rapportName = (w: Rapport, t: T): string => t(`rapport.${w}`);
/** The rapport ladder in one line, coldest first (rapport.ts RAPPORT_LADDER). */
export const rapportLadder = (t: T): string => RAPPORT_WORDS.map(w => rapportName(w, t)).join(' → ');
/** A good by its id, as the road shows it ("rawFood" → "food", "stone-knife" → "stone knife"). */
export const itemText = (id: string, t: T): string => goodName(id, t) ?? id.replace(/-/g, ' ');
/** A technique's name, by id. */
export const techName = (id: string, t: T): string => (isKey(`tech.${id}`) ? t(`tech.${id}` as Key) : techniqueById(id)?.name ?? id);
/** Who someone is, by id: their name (names are the same in every language). */
export const nameOf = (id: string): string => personById(id)?.name ?? id;
export const villageName = (id: string): string => VILLAGES[id]?.name ?? id;

/** What a quest needs, in words. */
export function needsText(q: QuestTemplate, t: T): string {
  const n = q.needs;
  switch (n.kind) {
    case 'fetch': return t('need.fetch', { n: n.qty, item: itemText(n.item, t) });
    case 'craft': return t('need.craft', { grade: t(`grade.${n.grade}`), item: itemText(n.item, t) });
    case 'repair': return t('need.repair', { concept: conceptName(n.concept, t).toLowerCase(), n: n.rank, h: n.hours });
    case 'scout': return t(n.minScouting ? 'need.scoutPractised' : 'need.scout', { h: n.hours, walk: n.walk });
    case 'deliver': return t('need.deliver', { n: n.qty, item: itemText(n.item, t), who: nameOf(n.recipient), where: villageName(n.to) });
  }
}

/** What a quest pays, in words. */
export const rewardText = (q: QuestTemplate, t: T): string =>
  [t('reward.marks', { n: q.reward.marks }), q.reward.item && t('reward.item', { n: q.reward.item.qty, item: itemText(q.reward.item.item, t) }), q.reward.recipe && t('reward.recipe', { item: itemText(q.reward.recipe, t) })].filter(Boolean).join(', ');

/** A list joined the way the sim joins it ("a, b and c"), in the viewer's language. */
export const listText = (xs: readonly string[], t: T): string => (xs.length > 1 ? t('road.and', { a: xs.slice(0, -1).join(', '), b: xs[xs.length - 1] }) : xs[0] ?? '');

/** A scarce or plentiful thing's catalog key: a kind by its kind's words, a good by its own (economy.ts). */
const marketKey = (x: string): Key => (isKey(`kindword.${x}`) ? `kindword.${x}` : `goodword.${x}`) as Key;

/** A village's market (economy.ts marketLine): what's cheap here, what's dear and sells well. */
export function marketText(m: Pick<LocalMarket, 'plentiful' | 'scarce'>, t: T): string {
  // Plural as the English decides it (two things, or one whose name is: "tools", "hides"), so both languages agree.
  const many = (xs: readonly string[]): boolean => xs.length > 1 || /s$/.test(en[marketKey(xs[0])]);
  const said = (xs: readonly string[], one: Key, other: Key): string => (xs.length ? t(many(xs) ? other : one, { list: listText(xs.map(x => t(marketKey(x))), t) }) : '');
  const cheap = said(m.plentiful, 'market.cheap.one', 'market.cheap.other');
  const dear = said(m.scarce, 'market.dear.one', 'market.dear.other');
  const text = cheap && dear ? t('market.join', { a: cheap, b: dear }) : cheap || dear;
  return t('market.line', { text: text ? text[0].toUpperCase() + text.slice(1) : text });
}
