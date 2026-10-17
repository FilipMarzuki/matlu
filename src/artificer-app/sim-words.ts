/**
 * The sim's words in the viewer's language (#1707, phase 2 of #1685).
 *
 * The sim names things and explains itself in English: a ring is "Near", a greyed action says
 * "the far ring isn't known yet — scout it first", an option says "up to 90% warm". That English
 * is also what the AI player and the play API read, and their tests pin it, so the sim keeps
 * producing it. The page instead looks each thing up in the catalog here:
 *
 * - **Names by id**: a ring, an action, a site, a store, a rank, a focus, a talent, a stat, a pack
 *   item and the weather all have an id, so the page asks for `ring.2`, `act.hunt`, `kit.kasa`...
 * - **Sentences by template** (`simLine`): a reason or an option's note arrives as finished
 *   English. Each one the sim can say is a template in the English catalog (`reason.*`, `opt.*`);
 *   `simLine` finds the template it matches, reads back the parts that vary (a ring, a recipe, a
 *   number), says each part in the viewer's language and fills that language's template. A line no
 *   template matches is shown as it came, in English, rather than guessed at. sim-words.test.ts
 *   checks that every reason the sim gives in a range of states has a template, and that filling
 *   a template with English gives back exactly what the sim said, so the two can't drift apart.
 * - **The land described** (`landLines`): the sim hands over places as parts (a kind, a bearing
 *   index, a band of walking time), which the page puts into words.
 *
 * Presentation only, like the rest of the catalog: nothing here feeds back into the sim.
 */

import { en } from '../artificer/i18n/en';
import { fill, localNum, type Key, type T } from '../artificer/i18n';
import type { Ring } from '../artificer/exploration';
import { ACTIONS, SITES, type ActionId, type OptionChoice, type OptionGroup, type Region1State, type SiteId } from '../artificer/region1';
import { focusInline, focusKey, focusLabel, parseFocus, FOCUS_KEYS, type Focus } from '../artificer/focus';
import { seasonOf, type Calendar } from '../artificer/winter';
import { statEffects, DEFAULT_STATS, type StatId } from '../artificer/stats';
import type { KitId } from '../artificer/kit';
import type { RankName } from '../rank-names';
import type { WeatherId } from '../artificer/world';
import { weatherReport } from '../artificer/weather-words';
import { campBiome, descriptiveMapOn, knownPlaces, type KnownPlace, type TimeWord } from '../artificer/descriptive-map';
import { mapLearningOn, mapNeedsFor, mapProgress, MAP_NIGHTS, MAP_PLACES, MAP_DIRECTIONS } from '../artificer/map-learning';
import { BIOME_NAME, YIELDS, ringOfHours, type Reach } from '../artificer/world/reach';
import { TOPICS, TOPIC_KINDS } from '../artificer/topics';
import { VILLAGES, TRAVELLERS } from '../artificer/villages';
import { QUESTS } from '../artificer/quests';
import { LEVELS } from '../artificer/skills';
import { NUMBER_WORDS } from '../artificer/claims';
import { HIST_PATTERN, cultureText, histPart, regionText } from './history-words';
import { questionAbout } from '../artificer/knowledge-questions';
import { allCultureLore } from '../artificer/culture-lore';
import { knownSpot, parseSpotId, siteKnowledge, siteRating, siteRatingsOn, type CampSpot, type SiteFact } from '../artificer/camp-sites';
import { buildsPerSiteOn, moveNotes, pitFoodChoice, type BuildItem } from '../artificer/camp-builds';
import { distanceOn } from '../artificer/distance-words';
import { builtWarmthOn } from '../artificer/built-warmth';

/** Whether a string is a catalog key (for ids that may have no entry: a concept from the wider web, a modded tool). */
export const isKey = (k: string): k is Key => Object.hasOwn(en, k);

/** `t(key)` when the key exists, else the fallback (the sim's own English). */
const tOr = (t: T, key: string, fallback: string): string => (isKey(key) ? t(key) : fallback);

// ── Distance, not rings (#1752) ─────────────────────────────────────────────

/** The `t`s that ask for a key's `.dist` version first, by the `t` they wrap: one each, so `simLine`'s cache keeps working. */
const DIST_T = new WeakMap<T, T>();

/**
 * The `t` a run's page draws with: with `distance-not-rings` on, any key that has a `.dist` version
 * (i18n/en/distance.ts: the same string with its rings said as distances, the same `{vars}`) is said
 * that way; with it off, `t` itself, so nothing changes.
 */
export function distanceT(s: Pick<Region1State, 'config'>, t: T): T {
  if (!distanceOn(s)) return t;
  let d = DIST_T.get(t);
  if (!d) {
    d = (key, vars) => (isKey(`${key}.dist`) ? t(`${key}.dist` as Key, vars) : t(key, vars));
    DIST_T.set(t, d);
  }
  return d;
}

// ── Names by id ─────────────────────────────────────────────────────────────

export const ringName = (r: Ring, t: T): string => t(`ring.${r}`);
export const actionName = (id: ActionId, t: T): string => t(`act.${id}`);
export const siteName = (id: SiteId, t: T): string => t(`site.${id}`);
/** A recipe or the tool it makes, by id; an id with no entry keeps the given English name. */
export const recipeName = (id: string, t: T, fallback = id): string => tOr(t, `recipe.${id}`, fallback);
export const rankName = (r: RankName, t: T): string => t(`rank.${r}`);
export const gradeWord = (g: string, t: T): string => tOr(t, `grade.${g}`, g);
export const kitName = (id: KitId, t: T): string => t(`kit.${id}`);

/** A concept by id: one of the six a Warden starts among has a catalog name; the wider web keeps the registry's for now. */
export const conceptName = (id: string, t: T): string => tOr(t, `concept.${id}`, focusLabel({ kind: 'concept', id }));

/**
 * A topic the mind can be on (topics.ts, #1494), by its key (`material:iron`, `person:hf-maren`):
 * on its own (`inline` false: a chip, a heading) or mid-sentence. People and places are names; a
 * quest is its title; a People is its name (#1709).
 */
export function topicText(key: string, t: T, inline = false): string {
  const at = key.indexOf(':');
  const kind = key.slice(0, at), id = key.slice(at + 1);
  const f = parseFocus(key);
  const english = f ? (inline ? focusInline(f) : focusLabel(f)) : id;
  if (kind === 'quest') return tOr(t, `quest.${id}.title`, english);
  if (kind === 'group' && isKey(`people.${id}`)) return t(`people.${id}` as Key);
  return tOr(t, `topic.${kind}.${id}${inline ? '.in' : ''}`, english);
}

/** What the mind is on, as the status chip and the picker name it. */
export function focusName(f: Focus | null, t: T): string {
  if (!f) return t('focus.noneShort');
  if (f.kind === 'goal') return t(`goal.${f.id}`);
  if (f.kind === 'skill') return t(`skill.${f.id}`);
  if (f.kind === 'concept') return conceptName(f.id, t);
  return topicText(focusKey(f), t);
}

/** A focus mid-sentence (focus.ts focusInline): "iron", "the Compact"; a skill or concept by its name, lowercased. */
export function focusInlineText(f: Focus, t: T): string {
  if (f.kind === 'skill') return t(`skill.${f.id}`).toLowerCase();
  if (f.kind === 'concept') return conceptName(f.id, t).toLowerCase();
  if (f.kind === 'goal') return t(`goal.${f.id}`).toLowerCase();
  return topicText(focusKey(f), t, true);
}

/** A focus key mid-sentence, or the key itself if it doesn't parse. */
export const aboutKeyText = (key: string, t: T): string => { const f = parseFocus(key); return f ? focusInlineText(f, t) : key; };

/** The weather's name on a day: snow and storms take their winter names once winter comes (as weather.ts weatherName). */
export function weatherWord(w: WeatherId, day: number, cal: Calendar, t: T): string {
  const winter = seasonOf(day, cal) !== 'autumn';
  return winter && (w === 'storm' || w === 'snow') ? t(`weather.${w}.winter`) : t(`weather.${w}`);
}

/** A stat's note for a score (stats.ts statNote), in words. */
export function statNoteText(id: StatId, score: number, t: T): string {
  const d = score - 10;
  if (d === 0) return t('statnote.average');
  const e = statEffects({ ...DEFAULT_STATS, [id]: score });
  // The same sign the sim writes: +3, −3 (a real minus), ±0.
  const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');
  switch (id) {
    case 'str': return t('statnote.str', { n: signed(-3 * d) });
    case 'con': return t('statnote.con', { n: signed(-3 * d), m: signed(3 * d) });
    case 'agi': return t('statnote.agi', { n: signed(-3 * d) });
    case 'int': return e.craftGrade ? t('statnote.intGrade', { n: signed(5 * d), m: signed(e.craftGrade) }) : t('statnote.int', { n: signed(5 * d) });
    case 'wil': return t('statnote.wil', { n: signed(-2 * d), m: e.unreliableBelow });
    case 'cha': return t(d > 0 ? 'statnote.chaUp' : 'statnote.chaDown', { n: signed(-2 * d) });
  }
}

/** Why survival has taken over the mind (focus.ts survivalLock: "thirsty", "winter is close"...). */
export const lockText = (lock: string, t: T): string => tOr(t, `lock.${lock}`, lock);

// ── Sentences by template ───────────────────────────────────────────────────

/** The store keys, and the English words the sim uses for each (region1.ts STORE_WORD). */
const STORES = ['rawFood', 'water', 'firewood', 'materials', 'rations', 'stone', 'hides'] as const;
type StoreKey = (typeof STORES)[number];
/** A store from its key ("materials") or its English word ("food"). */
const storeOf = (v: string): StoreKey | undefined =>
  STORES.find(k => k === v) ?? STORES.find(k => en[`storeword.${k}`] === v);

/** A recipe id from its English name, as the sim writes it mid-sentence ("stone knife", "lean-to"). */
const recipeOf = (v: string): string | undefined =>
  (Object.keys(en) as Key[]).find(k => k.startsWith('recipe.') && en[k].toLowerCase() === v.toLowerCase())?.slice('recipe.'.length);

const NUMBER = /^[−+-]?\d+(\.\d+)?$/;

/** A good as the road names it (#1709): a store by its key or word ("rawFood", "food"), a tool by its id or name ("stone-knife", "stone knife"). */
export function goodName(v: string, t: T): string | undefined {
  const k = storeOf(v);
  if (k) return t(`storeword.${k}`);
  const dashed = v.replace(/ /g, '-');
  const id = isKey(`recipe.${v}`) ? v : isKey(`recipe.${dashed}`) ? dashed : recipeOf(v) ?? recipeOf(v.replace(/-/g, ' '));
  return id ? recipeName(id, t).toLowerCase() : undefined;
}

/** A technique by its English name, mid-sentence ("reading the grain"). */
const techOf = (v: string): string | undefined =>
  (Object.keys(en) as Key[]).find(k => /^tech\.[^.]+$/.test(k) && en[k].toLowerCase() === v.toLowerCase())?.slice('tech.'.length);
/** A skill by its English name, mid-sentence ("foraging", "first aid"). */
const skillOf = (v: string): Key | undefined =>
  (Object.keys(en) as Key[]).find(k => k.startsWith('skill.') && en[k].toLowerCase() === v.toLowerCase());
/** A topic by how it reads mid-sentence in English ("iron", "the Compact", "Kestrel Gate"). */
const aboutOf = (v: string): string | undefined => {
  for (const kind of TOPIC_KINDS) for (const [id, d] of Object.entries(TOPICS[kind])) if (d.inline === v) return `${kind}:${id}`;
  return undefined;
};
/** A list of names as the sim joins them ("Orrin, Tobin and Maren"), joined again in the viewer's language. */
const namesText = (v: string, t: T): string => {
  const names = v.split(/, | and /);
  return names.length > 1 ? t('road.and', { a: names.slice(0, -1).join(', '), b: names.at(-1)! }) : v;
};

/** Everyone on the road, by name: a `{who}` must be one of them. */
const ROAD_NAMES: ReadonlySet<string> = new Set([...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS].map(p => p.name));

/** The small words a template picks among (`{w}`, the `w.*` keys), by their English. */
const WORDS: ReadonlyMap<string, Key> = new Map((Object.keys(en) as Key[]).filter(k => k.startsWith('w.')).reverse().map(k => [en[k] as string, k]));
const WORD_TEXTS: readonly string[] = [...WORDS.keys()];
/** What an experiment can work with (experiment.ts WORD), as the `w.stuff.*` words. */
const STORE_WORDS: readonly string[] = STORES.map(k => en[`storeword.${k}`]);
const STUFF_TEXTS: readonly string[] = (Object.keys(en) as Key[]).filter(k => k.startsWith('w.stuff.')).map(k => en[k]);
/** A regular expression that matches exactly one of `texts`, longest first. */
function alternation(texts: readonly string[]): string {
  return [...texts].sort((a, b) => b.length - a.length).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
}
/** A word by its English, in the viewer's language (keeping a capital the English had). */
export const wordText = (v: string, t: T): string | undefined => {
  const k = WORDS.get(v) ?? WORDS.get(v[0]?.toLowerCase() + v.slice(1));
  if (!k) return undefined;
  const said = t(k);
  return WORDS.has(v) ? said : said[0].toUpperCase() + said.slice(1);
};
/** The things an experiment worked with, said again: each known phrase in turn, joined the viewer's way. */
const stuffText = (v: string, t: T): string => {
  const bits: string[] = [];
  let rest = v;
  while (rest) {
    const hit = [...STUFF_TEXTS].sort((a, b) => b.length - a.length).find(s => rest.startsWith(s));
    if (!hit) return v;
    bits.push(wordText(hit, t)!);
    rest = rest.slice(hit.length).replace(/^(, | and )/, '');
  }
  return bits.length > 1 ? t('road.and', { a: bits.slice(0, -1).join(', '), b: bits.at(-1)! }) : bits[0] ?? v;
};
/** An action by its name as the sim writes it ("Craft basket", "Gather food"): the catalog's name for it. */
const actionOf = (v: string): ActionId | undefined => (Object.keys(ACTIONS) as ActionId[]).find(id => ACTIONS[id].name === v);
/** What survival has locked the mind on, or a focus, by its English name: goal, skill, concept or topic. */
const focusOfName = (v: string): Focus | undefined => {
  for (const key of FOCUS_KEYS) { const f = parseFocus(key); if (f && focusLabel(f) === v) return f; }
  return undefined;
};

/**
 * What a part may look like, when that's narrower than "anything": a number, an ordinal, or the
 * optional " in the far ring" a trip's line carries (#1709). Narrow patterns let a template with
 * several parts in a row match the one way it was meant to.
 */
/** A number as the sim writes one: a sign (a real minus, or a hyphen in "-5 °C"), digits, maybe a decimal. */
const NUM = '[−+-]?\\d+(?:\\.\\d+)?';
const PATTERN: Readonly<Record<string, string>> = {
  n: NUM, m: NUM, h: NUM, have: NUM,
  nth: '\\d+(?:st|nd|rd|th)',
  // With `distance-not-rings` on (#1752) the sim says the distance instead: " half a day out".
  where: '(?: in the (?:near|far|distant) ring| close by| half a day out| a day out)?',
  // What's left of a line after its first part: possibly nothing (a plan with no more to say).
  rest: '.*?',
  // Amounts of stores, one or more ("14 firewood and 6 materials").
  amounts: `\\d+ (?:${alternation(STORE_WORDS)})(?:(?:, | and )\\d+ (?:${alternation(STORE_WORDS)}))*`,
  // One of the `w.*` words, and nothing else: so "{w} ({w2})" can only split where the words are.
  w: alternation(WORD_TEXTS),
  // What an experiment works with ("the hide and cord and sticks"): the words, joined.
  stuff: `(?:${alternation(STUFF_TEXTS)})(?:(?:, | and )(?:${alternation(STUFF_TEXTS)}))*`,
  // A number as people say it (claims.ts NUMBER_WORDS): in words up to twenty, then in figures.
  num: `(?:${alternation(NUMBER_WORDS)}|\\d+)`,
  // A quest by its title, and nothing else: "{quest} {why}" splits where the title ends.
  quest: alternation(QUESTS.map(q => q.title)),
  // One of the small words at the head of a sentence, said with its capital (#1711: "The ford-moot" → "Vadtinget").
  W: alternation(WORD_TEXTS),
  // A number as a rumour of the past says it (#1711): in words up to twenty, then in figures, grouped past a thousand.
  numc: `(?:${alternation(NUMBER_WORDS)}|\\d[\\d,]*)`,
  // The history's own parts (#1711): someone as the chronicle names them, a lordship, a region... (history-words.ts).
  ...HIST_PATTERN,
};
/** A part's name without a trailing digit: `say2` is a `say`, `n2` a number. */
const baseOf = (name: string): string => name.replace(/\d+$/, '');

/**
 * One varying part of a sim sentence, said in the viewer's language — or undefined when it isn't
 * a value this part can be (then the template doesn't match after all, and the next is tried).
 */
function part(name: string, v: string, t: T): string | undefined {
  // The history's parts first (#1711): their names are their own, so nothing else is read this way.
  const hist = histPart(baseOf(name), v, t);
  if (hist !== null) return hist;
  switch (baseOf(name)) {
    // A decimal in the viewer's way (#1711): "1,5" in Swedish.
    case 'n': case 'm': case 'h': case 't': case 'have': return NUMBER.test(v) ? localNum(v, t) : undefined;
    // "2nd night running": the ordinal's own ending in each language.
    case 'nth': { const m = v.match(/^(\d+)(st|nd|rd|th)$/); return m ? t(`ord.${m[2] as 'st'}`, { n: m[1] }) : undefined; }
    // " in the far ring", or nothing: where a trip went.
    case 'where': {
      if (v === '') return '';
      const r = ([1, 2, 3] as const).find(x => ` in ${en[`ring.the.${x}`]}` === v);
      if (r) return ` ${t('ring.in', { ring: t(`ring.the.${r}`) })}`;
      // A distance (#1752): " half a day out".
      const d = ([1, 2, 3] as const).find(x => ` ${en[`ring.at.${x}`]}` === v);
      return d ? ` ${t(`ring.at.${d}`)}` : undefined;
    }
    case 'theRing': {
      const r = ([1, 2, 3] as const).find(x => en[`ring.the.${x}`] === v);
      if (r) return t(`ring.the.${r}`);
      const d = ([1, 2, 3] as const).find(x => en[`ring.the.${x}.dist`] === v);
      return d ? t(`ring.the.${d}.dist`) : undefined;
    }
    case 'verb': return v === 'explore' || v === 'scout' ? t(`verb.${v}`) : undefined;
    case 'grade': return isKey(`grade.${v}`) ? t(`grade.${v}` as Key) : undefined;
    case 'recipe': { const id = recipeOf(v); return id ? recipeName(id, t).toLowerCase() : undefined; }
    // A recipe by name at the head of a line ("Worked out: Brush hut"), with its capital.
    case 'Recipe': { const id = recipeOf(v); return id ? recipeName(id, t) : undefined; }
    case 'store': case 'item': { const k = storeOf(v); return k ? t(`storeword.${k}`) : undefined; }
    case 'good': return goodName(v, t);
    // The sim names the action by its id here ("explore isn't part of this game's rules").
    case 'action': return isKey(`act.${v}`) ? t(`act.${v}` as Key).toLowerCase() : undefined;
    // An action by its English name, as it heads a refusal ("Craft basket: skipped — ...").
    case 'act': { const k = (Object.keys(en) as Key[]).find(x => x.startsWith('act.') && en[x] === v); return k ? t(k) : undefined; }
    // The sim names a concept by its id ("weaving"); read back in English, it stays the id.
    case 'concept': return !/^[a-z][a-z-]*$/.test(v) ? undefined : t === enT ? v : conceptName(v, t).toLowerCase();
    case 'skill': { const k = skillOf(v); return k ? t(k).toLowerCase() : undefined; }
    case 'Skill': { const k = skillOf(v); return k ? t(k) : undefined; }
    case 'tech': { const id = techOf(v); return id ? t(`tech.${id}` as Key).toLowerCase() : undefined; }
    case 'about': {
      const key = aboutOf(v);
      if (key) return topicText(key, t, true);
      const sk = skillOf(v);
      if (sk) return t(sk).toLowerCase();
      // A concept by its id: one of the six by the catalog's name, one from the wider web by the registry's.
      if (isKey(`concept.${v}`) || parseFocus(`concept:${v}`)) return conceptName(v, t).toLowerCase();
      // A people's ways or the village's past (#1711: "I don't know much about the plague.").
      return questionAboutWords(v, t);
    }
    case 'injury': { const k = (['sprain', 'hand', 'cut'] as const).find(x => en[`injury.${x}`] === v); return k ? t(`injury.${k}`) : undefined; }
    case 'names': return namesText(v, t);
    // Amounts of stores ("14 firewood and 6 materials"): each in turn, joined the viewer's way.
    case 'amounts': {
      const bits = v.split(/, | and /).map(b => { const m = b.match(/^(\d+) (.+)$/); const k = m && storeOf(m[2]); return m && k ? `${m[1]} ${t(`storeword.${k}`)}` : undefined; });
      return bits.every(Boolean) ? (bits.length > 1 ? t('road.and', { a: bits.slice(0, -1).join(', '), b: bits.at(-1)! }) : bits[0]) : undefined;
    }
    case 'num': { const i = NUMBER_WORDS.indexOf(v); return i >= 0 ? t(`num.${i}` as Key) : /^\d+$/.test(v) ? v : undefined; }
    // "2 materials + 4 stone": each amount in turn.
    case 'cost': {
      // A recipe's cost may carry its hours after it ("3 materials · 5h"), which read the same in any language.
      const [, amounts, hours] = v.match(/^(.*?)((?: · [\d.]+h)?)$/s)!;
      const bits = amounts.split(' + ').map(b => { const m = b.match(/^(\d+) (\w+)$/); const k = m && storeOf(m[2]); return m && k ? `${m[1]} ${t(`storeword.${k}`)}` : undefined; });
      return bits.every(Boolean) ? bits.join(' + ') + localNum(hours, t) : undefined;
    }
    // A list of recipes or concepts ("snare, brush hut"; "tension or leverage"): each word that has a name gets it.
    case 'list': return v.split(/(, | or )/).map(w => (w === ', ' || w === ' or ' ? w : recipeOf(w) ? recipeName(recipeOf(w)!, t).toLowerCase() : conceptName(w, t).toLowerCase())).join('');
    // Something said in full (a person's line, an encounter's outcome): its own words, else read as a sentence of its own.
    case 'say': {
      const k = BY_TEXT.get(v);
      if (k) return t(k);
      // A line the catalog has in quotes (the caravan meeting's), quoted again by the journal: without its own quotes.
      const q = BY_TEXT.get(`"${v}"`);
      return q ? t(q).replace(/^"|"$/g, '') : simLine(v, t);
    }
    // A whole sentence inside another ("Craft basket: skipped — {why}."), or the rest of one: read on its own.
    case 'line': case 'why': case 'rest': return simLine(v, t);
    // One of the small words (`w.*`): an accident's ground, an injury's name, a luck's reason...
    case 'w': return wordText(v, t);
    case 'W': { const s = wordText(v, t); return s && s[0].toUpperCase() + s.slice(1); }
    case 'numc': { const i = NUMBER_WORDS.indexOf(v); return i >= 0 ? t(`num.${i}` as Key) : /^\d[\d,]*$/.test(v) ? localNum(v, t) : undefined; }
    case 'stuff': return stuffText(v, t);
    // What heads a refusal or an outcome: an action ("Craft basket"), a road verb ("Sell"), or an option said whole.
    case 'head': {
      const id = actionOf(v);
      if (id) return t(`act.${id}`);
      const k = BY_TEXT.get(v);
      return k ? t(k) : wordText(v, t);
    }
    // An option's label mid-sentence ("You meant to climb a tree"): said whole, its first letter down.
    case 'opt': { const k = BY_TEXT.get(v[0]?.toUpperCase() + v.slice(1)); if (!k) return undefined; const s = t(k); return s[0].toLowerCase() + s.slice(1); }
    case 'fear': return wordText(v, t);
    case 'how': { const k = BY_TEXT.get(v); return k ? t(k) : undefined; }
    case 'lock': return lockText(v, t);
    case 'focus': { const f = focusOfName(v); return f ? focusName(f, t) : undefined; }
    case 'talent': { const k = (Object.keys(en) as Key[]).find(x => /^talent\.[^.]+$/.test(x) && en[x] === v); return k ? t(k) : undefined; }
    case 'stat': { const k = (Object.keys(en) as Key[]).find(x => /^stat\.[^.]+$/.test(x) && en[x] === v); return k ? t(k) : undefined; }
    case 'weather': { const k = (Object.keys(en) as Key[]).find(x => x.startsWith('weather.') && en[x].toLowerCase() === v); return k ? t(k).toLowerCase() : undefined; }
    case 'site': { const k = (Object.keys(en) as Key[]).find(x => /^site\.[a-z]+$/.test(x) && en[x].toLowerCase() === v); return k ? t(k).toLowerCase() : undefined; }
    case 'ringword': { const r = ([1, 2, 3] as const).find(x => en[`ring.${x}`].toLowerCase() === v); return r ? t(`ring.${r}`).toLowerCase() : undefined; }
    // What's left behind ("3 stone and 1 hide"): each amount, by the load's names.
    case 'loads': {
      const bits = v.split(/, | and /).map(b => { const m = b.match(/^(\d+) (.+)$/); const k = m && WORDS.get(m[2]); return m && k?.startsWith('w.load.') ? `${m[1]} ${t(k)}` : undefined; });
      return bits.every(Boolean) ? (bits.length > 1 ? t('road.and', { a: bits.slice(0, -1).join(', '), b: bits.at(-1)! }) : bits[0]) : undefined;
    }
    // What the last Warden left ("a fine stone-knife, a sound basket"): each tool and its grade.
    case 'tools': {
      const bits = v.split(', ').map(b => { const m = b.match(/^a (\w+) (.+)$/); const name = m && goodName(m[2], t); return m && name && isKey(`grade.${m[1]}`) ? `${name} (${t(`grade.${m[1]}` as Key)})` : undefined; });
      return bits.every(Boolean) ? bits.join(', ') : undefined;
    }
    // Someone on the road, by name (names are the same in every language), or a list of them.
    case 'who': return ROAD_NAMES.has(v) ? v : undefined;
    // A quest by its title.
    case 'quest': { const q = QUESTS.find(x => x.title === v); return q ? t(`quest.${q.id}.title` as Key) : undefined; }
    // What a quest paid ("6 marks, 2 rations, the hide-parka recipe").
    case 'rewards': {
      const bits = v.split(', ').map(b => {
        let m = b.match(/^(\d+) marks$/);
        if (m) return t('reward.marks', { n: m[1] });
        m = b.match(/^the (.+) recipe$/);
        if (m) { const g = goodName(m[1], t); return g ? t('reward.recipe', { item: g }) : undefined; }
        m = b.match(/^(\d+) (.+)$/);
        const g = m && goodName(m[2], t);
        return m && g ? t('reward.item', { n: m[1], item: g }) : undefined;
      });
      return bits.every(Boolean) ? bits.join(', ') : undefined;
    }
    // What a free question was about: a topic, a skill or a concept, said as a focus is; else (a people's
    // ways, the village's past: #1709 leaves those for a follow-up and phase 4) as the sim said it.
    // A people's ways and the village's past are said too (#1711); a place's name stays as it is.
    case 'qabout': return part('about', v, t) ?? questionAboutWords(v, t) ?? v;
    case 'level': { const i = LEVELS.indexOf(v as (typeof LEVELS)[number]); return i >= 0 ? t(`level.${i}` as Key) : undefined; }
    case 'talentlow': { const k = (Object.keys(en) as Key[]).find(x => /^talent\.[^.]+$/.test(x) && en[x].toLowerCase() === v); return k ? t(k).toLowerCase() : undefined; }
    // A skill by its id, as an encounter's requirement names it ("needs hunting 3").
    case 'skillid': return isKey(`skill.${v}`) ? t(`skill.${v}` as Key).toLowerCase() : undefined;
    case 'statshort': { const k = (Object.keys(en) as Key[]).find(x => /^stat\.[a-z]+\.short$/.test(x) && en[x] === v); return k ? t(k) : undefined; }
    case 'kitlow': { const k = (Object.keys(en) as Key[]).find(x => /^kit\.[a-z-]+$/.test(x) && en[x].toLowerCase() === v); return k ? t(k).toLowerCase() : undefined; }
    // A topic as an encounter's requirement words it (`place:kestrel-gate` → "kestrel gate").
    case 'keywords': {
      for (const kind of TOPIC_KINDS) for (const id of Object.keys(TOPICS[kind])) if (id.replace(/-/g, ' ') === v) return topicText(`${kind}:${id}`, t, true);
      const sk = skillOf(v);
      return sk ? t(sk).toLowerCase() : undefined;
    }
    // Concept ranks a new run carries ("joinery 2, tension 1").
    case 'ranks': return v.split(', ').map(b => { const m = b.match(/^(\S+) (\d+)$/); return m ? `${conceptName(m[1], t).toLowerCase()} ${m[2]}` : b; }).join(', ');
    // Anything else (a person's or a station's name) is a name, and stays as written.
    default: return v;
  }
}

// ── Lines said in full (#1709): what people say, encounters, techniques ─────

/** The catalog areas whose English is a whole line the sim hands over as it is (a lore line, an encounter's text). */
const PHRASE_AREAS = ['lore.', 'hist.lhc.', 'person.', 'quest.', 'ans.', 'tell.', 'sign.', 'tech.', 'econ.', 'harmlore.', 'deflect.', 'phr.', 'enc.', 'meet.', 'say.', 'fact.', 'claim.'];
/** Each such line by its English (the first key wins when two areas say the same thing). */
const BY_TEXT: ReadonlyMap<string, Key> = new Map((Object.keys(en) as Key[]).filter(k => PHRASE_AREAS.some(a => k.startsWith(a))).reverse().map(k => [en[k] as string, k]));

/** The catalog key of a line the sim hands over whole (a person's lore line, an encounter's outcome), if it has one. */
export const phraseKey = (text: string): Key | undefined => BY_TEXT.get(text);

/** A line the sim hands over whole, in the viewer's language; as it came when the catalog doesn't have it. */
export const phrase = (text: string, t: T): string => { const k = BY_TEXT.get(text); return k ? t(k) : text; };

/**
 * The templates `simLine` knows: every reason, option note and label the sim writes as English
 * (#1707), and every journal line it writes (`log.*`, #1709).
 */
/** The history's sentences (#1711, i18n/en/history.ts): every `hist.*` key but its words and fragments. */
const HIST_TEMPLATE = /^hist\.(?:ev|reg|say|arc|fact|label|rum|lh|lhc|head)\.|^hist\.legendCentury$|^loreq\.(?:hedged|close)$/;
const HIST_FRAGMENT: ReadonlySet<string> = new Set(['hist.fact.besides']);
const TEMPLATE_KEYS = (Object.keys(en) as Key[]).filter(k => k.startsWith('reason.') || k.startsWith('log.') || (k.startsWith('opt.') && /\{|\s/.test(en[k]))
  || (HIST_TEMPLATE.test(k) && !HIST_FRAGMENT.has(k)));

interface Template { key: Key; re: RegExp; vars: string[] }
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Each template as a regular expression, its `{vars}` as groups (lazy, or a part's own pattern).
 * The ones with more fixed words go first, so "you already have sound cold gear" is tried before
 * "you already have {n} {store}".
 */
const TEMPLATES: readonly Template[] = TEMPLATE_KEYS.map(key => {
  const vars: string[] = [];
  const src = en[key].split(/(\{\w+\})/).map(bit => {
    const v = bit.match(/^\{(\w+)\}$/);
    if (v) { vars.push(v[1]); return `(${PATTERN[baseOf(v[1])] ?? '.+?'})`; }
    return escapeRe(bit);
  }).join('');
  return { key, re: new RegExp(`^${src}$`, 'su'), vars };
}).sort((a, b) => en[b.key].replace(/\{\w+\}/g, '').length - en[a.key].replace(/\{\w+\}/g, '').length);

/** English straight from the catalog, for checking a part's value without saying it in any language. */
const enT: T = (key, vars) => fill(en[key], vars);

/** The template an English sim line matches, with its parts as the sim wrote them; null when none does. */
export function matchSimLine(line: string): { key: Key; vars: Record<string, string> } | null {
  for (const tpl of TEMPLATES) {
    const m = line.match(tpl.re);
    if (!m) continue;
    const vars = Object.fromEntries(tpl.vars.map((v, i) => [v, m[i + 1]]));
    // Every part must be a value it can be (a number where a number goes, a known ring...).
    if (tpl.vars.every(v => part(v, vars[v], enT) !== undefined)) return { key: tpl.key, vars };
  }
  return null;
}

/** What's been read already, per `t`: a journal is drawn again on every tap, and its lines don't change. */
const READ = new WeakMap<T, Map<string, string>>();

/** A line read through its template (or found whole) and said with `t`; the line itself when neither. */
function readLine(line: string, t: T): string {
  const k = BY_TEXT.get(line);
  if (k) return t(k);
  const lore = loreAnswer(line, t);
  if (lore !== undefined) return lore;
  const m = matchSimLine(line);
  if (m) return t(m.key, Object.fromEntries(Object.entries(m.vars).map(([name, v]) => [name, part(name, v, t) ?? v])));
  return namedRegion(line, t) ?? line;
}

// ── A people's or a culture's ways, and what a question was about (#1711) ───

/** Every lore claim the road's people can voice, by its English (i18n/en/lore.ts), longest first. */
const LORE_TEXTS: readonly [string, Key][] = (Object.keys(en) as Key[]).filter(k => k.startsWith('lore.')).map(k => [en[k] as string, k] as [string, Key]).sort((a, b) => b[0].length - a[0].length);
const LORE_FRAMES: readonly [string, Key][] = [['Between us: ', 'loreq.hedged'], ["Since it's you: ", 'loreq.close']];

/**
 * A lore answer (knowledge-questions.ts: up to two claims, each maybe "Between us: "), claim by
 * claim. Undefined unless it's made of nothing but known claims (then it's read some other way).
 */
function loreAnswer(text: string, t: T): string | undefined {
  const said: string[] = [];
  let rest = text;
  while (rest) {
    const frame = LORE_FRAMES.find(([f]) => rest.startsWith(f));
    if (frame) rest = rest.slice(frame[0].length);
    const hit = LORE_TEXTS.find(([c]) => rest === c || rest.startsWith(`${c} `));
    if (!hit) return undefined;
    said.push(frame ? t(frame[1], { line: t(hit[1]) }) : t(hit[1]));
    rest = rest.slice(hit[0].length).replace(/^ /, '');
  }
  return said.length ? said.join(' ') : undefined;
}

/** How each lore topic reads (knowledge-questions.ts LORE_ABOUT), by its English. */
const LORE_ABOUT_KEYS: ReadonlyMap<string, Key> = new Map((Object.keys(en) as Key[]).filter(k => k.startsWith('loreq.about.')).map(k => [en[k] as string, k]));
/** How each fixed past topic reads (past-topics.ts pastAbout), by its English. */
const PAST_ABOUT_KEYS: ReadonlyMap<string, Key> = new Map((['here', 'around', 'plague', 'famine', 'war', 'lord', 'murder'] as const).map(k => [en[`pastq.${k}`], `pastq.${k}` as Key]));

/** A People or a culture as a question names it ("the Goblins", "the Fieldborn"), said. */
const groupText = (v: string, t: T): string | undefined => {
  const m = v.match(/^the (.+)$/);
  if (!m) return undefined;
  // A People by its id; a culture by the lore's name for it ("Bergfolk Holds" is mountainhold), as the road names it.
  const culture = allCultureLore().find(c => c.name === m[1]);
  const name = isKey(`people.${m[1]}`) ? t(`people.${m[1]}` as Key) : culture && isKey(`culture.${culture.id}`) ? t(`culture.${culture.id}` as Key) : cultureText(m[1], t);
  return name === undefined ? undefined : t('loreq.group', { name });
};

/**
 * What a free question was about, as the sim words it (knowledge-questions.ts questionAbout): a
 * topic, a people's ways ("how their people mourn", "what their people think of the Goblins"), or
 * the past ("what happened here", "the house of Crowhelm", a place's name). Undefined when it's none.
 */
export function questionAboutWords(v: string, t: T): string | undefined {
  const lore = LORE_ABOUT_KEYS.get(v);
  if (lore) return t(lore);
  const view = en['loreq.about.view'];
  if (v.startsWith(`${view} `)) {
    const groups = v.slice(view.length + 1).split(' and ').map(g => groupText(g, t));
    if (!groups.every(Boolean)) return undefined;
    const list = groups.length > 1 ? t('road.and', { a: groups.slice(0, -1).join(', '), b: groups.at(-1)! }) : groups[0]!;
    return `${t('loreq.about.view')} ${list}`;
  }
  const past = PAST_ABOUT_KEYS.get(v);
  if (past) return t(past);
  const house = v.match(/^the house of (.+)$/);
  if (house) return t('pastq.house', { house: house[1] });
  return undefined;
}

/** What a free question's topic key was about, in the viewer's language (road-view.ts: what they told you, and when). */
export function questionAboutText(topic: string, t: T): string {
  const english = questionAbout(topic);
  if (t('lang.name') === en['lang.name']) return english;
  const f = parseFocus(topic);
  if (f) return focusInlineText(f, t);
  return questionAboutWords(english, t) ?? english;
}

/**
 * A country's news told on its own (#1711), which names its country after the first sentence
 * (storytelling/render.ts renderRegionalEventNamed: "Famine struck Ravenford, in the Hollowford
 * country."): the sentence without the country is read as any other, and the country goes back in
 * after its first sentence. Undefined when it isn't one, or the sentence itself doesn't read.
 */
function namedRegion(line: string, t: T): string | undefined {
  const m = line.match(/^(.*?), in ([^,.]*?)\.(\s.*)?$/s);
  if (!m) return undefined;
  const region = regionText(m[2], t);
  if (region === undefined) return undefined;
  const base = `${m[1]}.${m[3] ?? ''}`;
  const said = readLine(base, t);
  if (said === base) return undefined;
  // After the first sentence of what was said, as the English puts it after its own.
  return said.replace(/\.(\s|$)/, `${t('hist.inRegion', { region })}.$1`);
}

/**
 * A line read back into English: its template filled with the parts exactly as the sim wrote them
 * (or the line found whole). What sim-words.test.ts compares with the line itself, so a template's
 * fixed words can't drift from what the sim writes. Null when nothing reads it.
 */
export function readBack(line: string): string | null {
  const k = BY_TEXT.get(line);
  if (k) return en[k];
  const m = matchSimLine(line);
  return m ? fill(en[m.key], m.vars) : null;
}

/**
 * A sentence the sim wrote in English, in the viewer's language; as it came when no template
 * matches. A line said whole (a person's, an encounter's) is looked up first, then the templates.
 * In English it's the sim's own line, untouched: the page shows exactly what the AI and the API read.
 */
export function simLine(line: string, t: T): string {
  if (t('lang.name') === en['lang.name']) return line;
  let seen = READ.get(t);
  if (!seen) READ.set(t, (seen = new Map()));
  const known = seen.get(line);
  if (known !== undefined) return known;
  const out = readLine(line, t);
  seen.set(line, out);
  return out;
}

// ── A queued action's options ───────────────────────────────────────────────

/** Choice values with a name of their own, per group (the rest are said through `simLine`). */
const CHOICE_KEY: Readonly<Record<string, Readonly<Record<string, Key>>>> = {
  target: { deer: 'opt.deer', small: 'opt.small' },
  method: { smoke: 'opt.smoke', dry: 'opt.dry' },
  material: { fiber: 'opt.fiber', hide: 'opt.hide' },
  hours: { day: 'opt.restOfDay' },
  until: { none: 'opt.noTarget' },
  with: { any: 'opt.anything' },
  pitFood: { take: 'opt.pitFood.take', leave: 'opt.pitFood.leave' },
};
const SHELTER_RECIPE: Readonly<Record<string, string>> = { leanto: 'shelter-leanto', hut: 'shelter-hut', timber: 'shelter-timber', stone: 'shelter-stone' };

/** An option group's heading. */
export const optionGroupLabel = (g: OptionGroup, t: T): string => tOr(t, `opt.${g.key}`, g.label);

/** A choice's label, in the viewer's language. */
export function optionLabel(g: OptionGroup, c: OptionChoice, t: T): string {
  const named = CHOICE_KEY[g.key]?.[c.value];
  if (named) return t(named);
  if (g.key === 'site') return siteName(c.value as SiteId, t);
  // A camp site (#1732): its kind's name; the page says where it is and what you can tell of it (spotNote).
  if (g.key === 'spot') { const p = parseSpotId(c.value); return p ? siteName(p.kind, t) : c.label; }
  if (g.key === 'type' || g.key === 'walls') return recipeName(SHELTER_RECIPE[c.value] ?? c.value, t, c.label);
  if (g.key === 'concept') return conceptName(c.value, t);
  if (g.key === 'with') { const k = storeOf(c.value); return k ? t(`store.${k}`) : c.label; }
  if (c.label === en['opt.usual']) return t('opt.usual');
  return simLine(c.label, t);
}

// ── The land described (descriptive-map.ts) ─────────────────────────────────

const timeText = (w: TimeWord, t: T): string => ('n' in w ? t(`map.time.${w.band}`, { n: w.n }) : t(`map.time.${w.band}`));

/** One place as a scout would say it. */
export function placeLine(p: KnownPlace, t: T): string {
  const place = t(`map.place.${p.kind}`);
  const dir = p.dir.exact ? t(`map.dir.${p.dir.i}` as Key) : t(`map.vague.${p.dir.i}` as Key);
  return p.horizon ? t('map.horizon', { place, dir }) : t('map.seen', { place, dir, time: timeText(p.time, t) });
}

// ── Camp sites (#1732, camp-sites.ts) ───────────────────────────────────────

/** Where a camp site is from where you are: "due west, about 45 minutes", or "where you are". */
export const spotWhere = (p: CampSpot, t: T): string => (p.atYou ? t('campsite.here')
  : t('campsite.where', { dir: p.dir.exact ? t(`map.dir.${p.dir.i}` as Key) : t(`map.vague.${p.dir.i}` as Key), time: timeText(p.time, t) }));

const factWords = (f: SiteFact, t: T): string => t(`campsite.fact.${f.key}` as Key, f.n !== undefined ? { n: f.n } : undefined);

/** What you can tell about a camp site, in the viewer's language: how sure the reading is, then the facts. */
export function spotReading(s: Parameters<typeof siteKnowledge>[0], p: CampSpot, t: T): string {
  const k = siteKnowledge(s, p);
  return t('campsite.reading', { band: t(`campsite.band.${k.band}`), facts: k.facts.map(f => factWords(f, t)).join(' ') });
}

/**
 * How good a place to camp you believe a site is (#1756, `camp-site-ratings`): "★ great place to
 * camp" or "✓ good place to camp"; '' for a poor one, which isn't marked, or with the switch off.
 */
export function spotRated(s: Parameters<typeof siteRating>[0], p: CampSpot, t: T): string {
  if (!siteRatingsOn(s)) return '';
  const r = siteRating(s, p);
  return r === 'poor' ? '' : t(`campsite.rated.${r}`);
}

/** What's built at a camp site (#1753), in the viewer's language: "lean-to, timber walls, cold pit (5 raw food)"; '' when none. */
export const buildsWords = (items: readonly BuildItem[], t: T): string =>
  items.map(i => (i.n ? t('campsite.build.pitFood', { n: i.n }) : t(`campsite.build.${i.key}`))).join(', ');

/**
 * A site's natural shelter and what building it needs (#1763, `built-warmth`), in the viewer's
 * language: "sheltered: rock at your back · a bed and a fire make it warm" (built-warmth.ts siteShelterText).
 */
export const shelterWords = (site: SiteId, t: T): string => `${t(`shelter.word.${site}`)}: ${t(`shelter.why.${site}`)} · ${t(`shelter.needs.${site}`)}`;

/** How warm a site can get, as an option note says it: its natural shelter with `built-warmth`, else its ceiling. */
const siteWarmthWords = (s: Pick<Region1State, 'config'>, site: SiteId, t: T): string =>
  (builtWarmthOn(s) ? shelterWords(site, t) : t('campsite.warm', { n: Math.round(SITES[site].warmth * 100) }));

/** A camp site's note under the Make camp action, as the sim's English one says it (region1.ts campOptions). */
export function spotNote(s: Region1State, p: CampSpot, t: T): string {
  const rated = spotRated(s, p, t);
  // What's built there and what stays here (#1753); with the switch off, the shelter is left behind for good.
  const kept = buildsPerSiteOn(s) ? moveNotes(s, p).map(n => t(`campsite.${n.key}`, { list: buildsWords(n.items ?? [], t) }))
    : !p.here && s.tier > 0 ? [t('campsite.leaves')] : [];
  return [spotWhere(p, t), siteWarmthWords(s, p.kind, t), ...kept, spotReading(s, p, t), ...(rated ? [rated] : [])].join(' · ');
}

/** A choice's note in the viewer's language: a camp site's from the state it would run in, any other read back from the sim's English. */
export function choiceNote(s: Region1State, g: OptionGroup, c: OptionChoice, t: T): string {
  if (c.blocked) return simLine(c.blocked, t);
  // The cold pit's food (#1753): from the state, as the sim's English says it (campOptions).
  if (g.key === 'pitFood') {
    const pit = pitFoodChoice(s);
    if (pit) return c.value === 'leave' ? t('campsite.pitFood.leave', { n: pit.n, site: t(`campsite.at.${pit.site}`) }) : t('campsite.pitFood.take');
  }
  // A build's Location (camp as an action off) with `built-warmth` (#1763): the site's natural shelter, from the state (region1.ts buildOptions).
  if (g.key === 'site' && builtWarmthOn(s) && c.value in SITES) {
    const id = c.value as SiteId;
    const tail = s.site && id !== s.site && s.tier > 0 ? [t('campsite.leaves')] : id === s.site ? [t('campsite.yourCampNote')] : [];
    return [shelterWords(id, t), ...tail].join(' · ');
  }
  const p = g.key === 'spot' ? knownSpot(s, c.value) : undefined;
  return p ? spotNote(s, p, t) : simLine(c.note, t);
}

/** What you know of the land, as lines (descriptive-map.ts describeLand): where camp is, then each place. */
export function landLines(s: Parameters<typeof knownPlaces>[0], t: T): string[] {
  if (!descriptiveMapOn(s)) return [];
  return [t(`map.camp.${campBiome(s)}`), ...knownPlaces(s).map(p => placeLine(p, t))];
}

/**
 * The weather and the season in words (#1729, weather-words.ts): the sim's bands in the viewer's
 * language, the same lines the AI reads in English. Empty with the switch off.
 */
export function weatherLines(s: Parameters<typeof weatherReport>[0], t: T): string[] {
  const r = weatherReport(s);
  if (r.view === 'numbers') return [];
  return [
    ...(r.sky ? [t(`wx.sky.${r.sky}`)] : []),
    ...(r.felt ? [t(`wx.felt.${r.felt}`)] : []),
    ...(r.ground ? [t(`wx.ground.${r.ground}`)] : []),
    t(`wx.season.${r.season}`),
    // Before a tally, nothing about the date (the owner, #1729 follow-up): the lost-count line is left out for now.
    ...(r.tally ? [t(`wx.tally.${r.tally}`, { n: s.day })] : []),
    ...(r.toSnow !== null ? [t(r.toSnow === 1 ? 'wx.toSnow.one' : 'wx.toSnow.other', { n: r.toSnow })] : []),
    ...(r.toThaw !== null ? [t(r.toThaw === 1 ? 'wx.toThaw.one' : 'wx.toThaw.other', { n: r.toThaw })] : []),
  ];
}

/**
 * What's still needed to draw a map, as a phrase ("x and y", "x, y and z"), or '' when nothing is:
 * #1686's needs, or with `map-learning` (#1754) the unlock's, with how far along each is.
 */
export function mapNeedsText(s: Parameters<typeof mapNeedsFor>[0], t: T): string {
  const p = mapLearningOn(s) ? mapProgress(s) : null;
  const so = { nights: [MAP_NIGHTS, p?.nights], places: [MAP_PLACES, p?.places], directions: [MAP_DIRECTIONS, p?.directions] } as const;
  const needs = mapNeedsFor(s).map(n => (n === 'home' || n === 'surface' ? t(`map.need.${n}`) : t(`map.need.${n}`, { m: so[n][0], n: so[n][1] ?? 0 })));
  if (needs.length < 2) return needs[0] ?? '';
  return t('map.needsAnd', { a: needs.slice(0, -1).join(t('map.needsSep')), b: needs[needs.length - 1] });
}

/** A square's line (world/reach.ts describeCell): what it is, how far, and what it gives. */
export function cellText(reach: Reach, x: number, y: number, t: T): string {
  const i = y * reach.w + x;
  const c = reach.cells[i];
  const hrs = reach.hours[i];
  const where = x === reach.camp.x && y === reach.camp.y ? t('map.cell.camp') : Number.isFinite(hrs) ? t('map.cell.hours', { n: Math.round(hrs * 2) / 2 }) : t('map.cell.water');
  const ring = ringOfHours(hrs);
  const band = ring === 1 ? t('map.cell.home') : ring ? t(`ring.the.${ring}`) : t('map.cell.beyond');
  const yields = YIELDS[c.biome].length ? YIELDS[c.biome].map(d => t(`domain.${d}`)).join(', ') : t('map.cell.nothing');
  return t('map.cell', { biome: isKey(`biome.${c.biome}`) ? t(`biome.${c.biome}`) : BIOME_NAME[c.biome], where, band, yields });
}
