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
import type { Key, T } from '../artificer/i18n';
import type { Ring } from '../artificer/exploration';
import type { ActionId, OptionChoice, OptionGroup, SiteId } from '../artificer/region1';
import { focusLabel, type Focus } from '../artificer/focus';
import { seasonOf, type Calendar } from '../artificer/winter';
import { statEffects, DEFAULT_STATS, type StatId } from '../artificer/stats';
import type { KitId } from '../artificer/kit';
import type { RankName } from '../rank-names';
import type { WeatherId } from '../artificer/world';
import { campBiome, descriptiveMapOn, knownPlaces, mapNeedIds, type KnownPlace, type TimeWord } from '../artificer/descriptive-map';
import { BIOME_NAME, YIELDS, ringOfHours, type Reach } from '../artificer/world/reach';

/** Whether a string is a catalog key (for ids that may have no entry: a concept from the wider web, a modded tool). */
export const isKey = (k: string): k is Key => Object.hasOwn(en, k);

/** `t(key)` when the key exists, else the fallback (the sim's own English). */
const tOr = (t: T, key: string, fallback: string): string => (isKey(key) ? t(key) : fallback);

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

/** What the mind is on, as the status chip and the picker name it. Topics (the road's) keep the sim's words until phase 3. */
export function focusName(f: Focus | null, t: T): string {
  if (!f) return t('focus.noneShort');
  if (f.kind === 'goal') return t(`goal.${f.id}`);
  if (f.kind === 'skill') return t(`skill.${f.id}`);
  if (f.kind === 'concept') return conceptName(f.id, t);
  return focusLabel(f);
}

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

const NUMBER = /^[−+]?\d+(\.\d+)?$/;

/**
 * One varying part of a sim sentence, said in the viewer's language — or undefined when it isn't
 * a value this part can be (then the template doesn't match after all, and the next is tried).
 */
function part(name: string, v: string, t: T): string | undefined {
  switch (name) {
    case 'n': case 'm': case 'h': case 't': case 'have': return NUMBER.test(v) ? v : undefined;
    case 'theRing': { const r = ([1, 2, 3] as const).find(x => en[`ring.the.${x}`] === v); return r ? t(`ring.the.${r}`) : undefined; }
    case 'verb': return v === 'explore' || v === 'scout' ? t(`verb.${v}`) : undefined;
    case 'grade': return isKey(`grade.${v}`) ? t(`grade.${v}` as Key) : undefined;
    case 'recipe': { const id = recipeOf(v); return id ? recipeName(id, t).toLowerCase() : undefined; }
    case 'store': case 'item': { const k = storeOf(v); return k ? t(`storeword.${k}`) : undefined; }
    // The sim names the action by its id here ("explore isn't part of this game's rules").
    case 'action': return isKey(`act.${v}`) ? t(`act.${v}` as Key).toLowerCase() : undefined;
    case 'concept': return conceptName(v, t).toLowerCase();
    // "2 materials + 4 stone": each amount in turn.
    case 'cost': {
      // A recipe's cost may carry its hours after it ("3 materials · 5h"), which read the same in any language.
      const [, amounts, hours] = v.match(/^(.*?)((?: · [\d.]+h)?)$/)!;
      const bits = amounts.split(' + ').map(b => { const m = b.match(/^(\d+) (\w+)$/); const k = m && storeOf(m[2]); return m && k ? `${m[1]} ${t(`storeword.${k}`)}` : undefined; });
      return bits.every(Boolean) ? bits.join(' + ') + hours : undefined;
    }
    // A list of recipes or concepts ("snare, brush hut"; "tension or leverage"): each word that has a name gets it.
    case 'list': return v.split(/(, | or )/).map(w => (w === ', ' || w === ' or ' ? w : recipeOf(w) ? recipeName(recipeOf(w)!, t).toLowerCase() : conceptName(w, t).toLowerCase())).join('');
    // Anything else (a station's name) is a name, and stays as written.
    default: return v;
  }
}

/** The templates `simLine` knows: every reason, option note and label the sim writes as English. */
const TEMPLATE_KEYS = (Object.keys(en) as Key[]).filter(k => k.startsWith('reason.') || (k.startsWith('opt.') && /\{|\s/.test(en[k])));

interface Template { key: Key; re: RegExp; vars: string[] }
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Each template as a regular expression, its `{vars}` as lazy groups. The ones with more fixed
 * words go first, so "you already have sound cold gear" is tried before "you already have {n} {store}".
 */
const TEMPLATES: readonly Template[] = TEMPLATE_KEYS.map(key => {
  const vars: string[] = [];
  const src = en[key].split(/(\{\w+\})/).map(bit => {
    const v = bit.match(/^\{(\w+)\}$/);
    if (v) { vars.push(v[1]); return '(.+?)'; }
    return escapeRe(bit);
  }).join('');
  return { key, re: new RegExp(`^${src}$`), vars };
}).sort((a, b) => en[b.key].replace(/\{\w+\}/g, '').length - en[a.key].replace(/\{\w+\}/g, '').length);

/** English straight from the catalog, for checking a part's value without saying it in any language. */
const enT: T = key => en[key];

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

/** A sentence the sim wrote in English, in the viewer's language; as it came when no template matches. */
export function simLine(line: string, t: T): string {
  const m = matchSimLine(line);
  if (!m) return line;
  const vars = Object.fromEntries(Object.entries(m.vars).map(([k, v]) => [k, part(k, v, t) ?? v]));
  return t(m.key, vars);
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
};
const SHELTER_RECIPE: Readonly<Record<string, string>> = { leanto: 'shelter-leanto', hut: 'shelter-hut', timber: 'shelter-timber', stone: 'shelter-stone' };

/** An option group's heading. */
export const optionGroupLabel = (g: OptionGroup, t: T): string => tOr(t, `opt.${g.key}`, g.label);

/** A choice's label, in the viewer's language. */
export function optionLabel(g: OptionGroup, c: OptionChoice, t: T): string {
  const named = CHOICE_KEY[g.key]?.[c.value];
  if (named) return t(named);
  if (g.key === 'site') return siteName(c.value as SiteId, t);
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

/** What you know of the land, as lines (descriptive-map.ts describeLand): where camp is, then each place. */
export function landLines(s: Parameters<typeof knownPlaces>[0], t: T): string[] {
  if (!descriptiveMapOn(s)) return [];
  return [t(`map.camp.${campBiome(s)}`), ...knownPlaces(s).map(p => placeLine(p, t))];
}

/** What's still needed to draw a map, as a phrase ("x and y"), or '' when nothing is. */
export function mapNeedsText(s: Parameters<typeof mapNeedIds>[0], t: T): string {
  const needs = mapNeedIds(s).map(n => t(`map.need.${n}`));
  return needs.length === 2 ? t('map.needsAnd', { a: needs[0], b: needs[1] }) : needs[0] ?? '';
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
