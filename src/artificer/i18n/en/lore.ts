/**
 * A people's and a culture's ways in English (#1711, phase 4 of #1685): what someone on the road says
 * when a free question asks about their People's or culture's values, taboos, customs, or what they
 * think of others (knowledge-questions.ts, from content/peoples-lore.json and cultures-lore.json via
 * culture-lore.ts), how such a question's topic reads ("how their people mourn"), and how a question
 * about the past reads ("what happened here", "the house of Crowhelm", past-topics.ts).
 *
 * Only what can be said: a person answers from their own People's and culture's lore alone
 * (knowledge-questions.ts `loreClaims`), so the claims here are those of the Peoples and cultures of
 * the road's people, as any run plays them (villages.ts, with `humans-on-the-road`'s Peoples too).
 * Keyed by the claim's own id (`lore.people:Bergfolk/view:Goblins/0`), never by its English; the page
 * finds a claim by its English when an answer hands it over as words (artificer-app/lore-words.ts).
 */

import { HUMANS_ON_THE_ROAD, TRAVELLERS, VILLAGES } from '../../villages';
import { scopedClaims } from '../../culture-lore';
import { LORE_ABOUT } from '../../knowledge-questions';
import { pastAbout } from '../../past-topics';

export type LoreKey = `lore.${string}`;

const ROAD = [...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS];
/** The Peoples the road's people belong to, in any run. */
export const ROAD_PEOPLES: readonly string[] = [...new Set([...ROAD.map(p => p.people), ...Object.values(HUMANS_ON_THE_ROAD)])];
/** The cultures the road's people belong to. */
export const ROAD_CULTURES: readonly string[] = [...new Set(ROAD.map(p => p.culture))];

const derived = Object.fromEntries([
  ...ROAD_PEOPLES.flatMap(id => scopedClaims({ kind: 'people', id })),
  ...ROAD_CULTURES.flatMap(id => scopedClaims({ kind: 'culture', id })),
].map(c => [`lore.${c.id}`, c.text])) as Record<LoreKey, string>;

export const lore = {
  ...derived,

  // How a lore question's topic reads mid-sentence (knowledge-questions.ts LORE_ABOUT, questionAbout).
  'loreq.about.values': LORE_ABOUT.values,
  'loreq.about.taboos': LORE_ABOUT.taboos,
  'loreq.about.greeting': LORE_ABOUT.greeting,
  'loreq.about.trade': LORE_ABOUT.trade,
  'loreq.about.mourning': LORE_ABOUT.mourning,
  'loreq.about.debt': LORE_ABOUT.debt,
  'loreq.about.view': LORE_ABOUT.view,
  // A group a view is of: "the Goblins", "the Fieldborn".
  'loreq.group': 'the {name}',
  // A claim said carefully, or said only because you're a close friend (knowledge-questions.ts sayClaim).
  'loreq.hedged': 'Between us: {line}',
  'loreq.close': "Since it's you: {line}",

  // How a question about the past reads (past-topics.ts pastAbout).
  'pastq.here': pastAbout('past:here')!,
  'pastq.around': pastAbout('past:around')!,
  'pastq.plague': pastAbout('past:plague')!,
  'pastq.famine': pastAbout('past:famine')!,
  'pastq.war': pastAbout('past:war')!,
  'pastq.lord': pastAbout('past:lord')!,
  'pastq.murder': pastAbout('past:murder')!,
  'pastq.house': 'the house of {house}',
} as const satisfies Record<string, string>;

export type LoreCatalogKey = keyof typeof lore | LoreKey;
