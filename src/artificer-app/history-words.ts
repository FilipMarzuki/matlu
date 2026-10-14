/**
 * The parts of the Reach's history in the viewer's language (#1711, phase 4 of #1685).
 *
 * The story engine (storytelling/) and the Artificer's readers of it (world/remembered.ts,
 * regional-facts.ts, local-history.ts, run-rumours.ts) write finished English. The page reads each
 * sentence back through a template (`hist.*` in i18n/en/history.ts, matched by sim-words.ts
 * `simLine` like every other sentence the sim writes) and says it again; this module is how the
 * history's own parts are recognised and said: someone as the chronicle names them, a lordship, a
 * region, a cause of death, a venture...
 *
 * - **Names stay names**: people, houses, places and regions' own names are the same in every
 *   language. Only the words around them change: "Ivar II of Hedlund" is "Ivar II av Hedlund",
 *   "the Hundred of Ravenford" is "häradet Ravenford", "the Hollowford country" is "Hollowfordbygden".
 * - **Narrow patterns**: each part only matches what it can be (a person has a capital and " of ", a
 *   lordship starts with a title word), so a template with several parts in a row splits the one way
 *   it was meant to, and a sentence that isn't history never matches a history template.
 * - **Never guessed**: a value a part doesn't know (a cause of death no key has) makes the template
 *   not match, and the sentence stays English (history-i18n.test.ts lists any that do).
 *
 * A leaf module: it imports no view code, so sim-words.ts can import it without a cycle.
 * Presentation only: nothing here feeds back into the sim, the engine or its random streams.
 */

import { en } from '../artificer/i18n/en';
import { localNum, type Key, type T } from '../artificer/i18n';
import { TITLE_WORDS } from '../artificer/world/peoples';
import { EVENT_NOUNS } from '../artificer/past-topics';
import { TRADE_WORDS, FOUNDING_WORDS } from '../artificer/economy';

const isKey = (k: string): k is Key => Object.hasOwn(en, k);
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A regular expression matching exactly one of `texts`, longest first. */
const alt = (texts: readonly string[]): string => [...texts].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** Whether `t` says English: English is never read back, it's shown as the sim wrote it. */
export const isEnglish = (t: T): boolean => t('lang.name') === en['lang.name'];

// ── Patterns ────────────────────────────────────────────────────────────────

/** One capitalised word of a name ("Hedlund", "Åsa", "Anvilsong-Bergqvist"). */
const WORD = "[A-ZÅÄÖ][\\p{L}'’-]*";
/** A name of one or more capitalised words ("Willow Bridge"). */
const NAME = `${WORD}(?: ${WORD})*`;
const ROMAN = '[IVXLC]+';
const UNKNOWN = ['an unknown figure', 'an unknown lord', 'someone'];
/** Someone as the chronicle names them: "Ivar II of Hedlund", a bare given name, or "an unknown figure". */
const PERSON = `(?:${NAME}(?: ${ROMAN})? of ${NAME}|${WORD}(?: ${ROMAN})?|${alt(UNKNOWN)})`;
const TITLE_WORD_LIST = [...new Set(Object.values(TITLE_WORDS).flatMap(w => Object.values(w)))];
/** A lordship: "Hundred of Ravenford", "High Hold of Greywater"; "a title" when the engine has lost it. */
const TITLE = `(?:(?:${alt(TITLE_WORD_LIST)}) of ${NAME}|a title)`;
const LANDS = ['Meads', 'Fields', 'Hills', 'Woods', 'Fens', 'Fells', 'Downs', 'Shore', 'Sands', 'Wilds', 'Lands'];
const TRADE_NAME = ['Ironvein', 'Timberwold', 'Netwater', 'Sheepwalks', 'Peatmoors', 'Golden Fields'];
const TRADE_SUFFIX = ['Vein', 'Wold', 'Water', 'Walks', 'Moors', 'Fields'];
/** A region as the history names it (storytelling/regions.ts): by its market town, a hero, a quarrel, a hardship or its trade. */
const REGION = `(?:[Tt]he (?:Marches of Old Feud|Feuding March|(?:Lean|Hungry|Pale|Fever) (?:${LANDS.join('|')})|${alt(TRADE_NAME)}|Land of ${WORD}|${NAME} (?:${TRADE_SUFFIX.join('|')})|${NAME} country)|${WORD}'s Land|the (?:next )?country)`;
/** A place: a province, a region, or "the land" (a line about no one place). */
const PLACE = `(?:${REGION}|${NAME}|the land|the province)`;

/** The words a part picks among, by its key area: `hist.cause.old age` → "old age". */
const wordsOf = (area: string): string[] => (Object.keys(en) as Key[]).filter(k => k.startsWith(`hist.${area}.`)).map(k => en[k]);
const TRAIT_LABELS = wordsOf('trait');

/** How each history part may look, by its name (a trailing digit allowed: `lord2` is a `lord`). */
export const HIST_PATTERN: Readonly<Record<string, string>> = {
  lord: PERSON,
  given: `${WORD}(?: ${ROMAN})?`,
  fam: WORD,
  fams: WORD,
  house: NAME,
  place: PLACE,
  title: TITLE,
  // A lordship heading a sentence, its "The" with it: "The Hundred of Ravenford is held by…".
  Title: `The ${TITLE}`,
  seats: `${TITLE}(?: and another seat| and \\d+ other seats)?`,
  region: REGION,
  Region: REGION,
  count: '\\d[\\d,]*',
  year: '\\d+',
  cause: alt(wordsOf('cause')),
  madness: alt(wordsOf('madness')),
  law: alt(wordsOf('law')),
  venture: alt(wordsOf('venture')),
  nventure: alt(wordsOf('nventure')),
  fled: alt(wordsOf('fled')),
  share: alt(wordsOf('share')),
  setting: alt(wordsOf('setting')),
  custom: alt(wordsOf('custom')),
  trait: `(?:${alt(TRAIT_LABELS)}|A change in custom \\([a-z_]+\\))`,
  traitlow: `(?:${alt(TRAIT_LABELS.map(l => l.toLowerCase()))}|a change in custom \\([a-z_]+\\))`,
  tier: alt(wordsOf('tier')),
  tier2: alt(wordsOf('tier2')),
  drift: alt([...wordsOf('why'), ...wordsOf('why2')]),
  people: `(?:${alt(wordsOf('kind'))}|${WORD})`,
  People: `(?:${alt(wordsOf('kind'))}|${WORD})`,
  culture: `(?:${NAME}|people)`,
  guild: '(?:(?:Guild|Academy) of .+?|a guild)',
  // An event's name: the game's own (EVENT_NOUNS), or the engine's kind as words ("the solar eclipse").
  noun: `(?:${alt(Object.values(EVENT_NOUNS))}|the [a-z][a-z ]*?)`,
  Noun: `(?:${alt(Object.values(EVENT_NOUNS).map(cap))}|The [a-z][a-z ]*?)`,
  trade: alt(Object.values(TRADE_WORDS)),
  founded: alt(Object.values(FOUNDING_WORDS)),
  besides: `(?:, and on (?:${alt(Object.values(TRADE_WORDS))})(?: and (?:${alt(Object.values(TRADE_WORDS))}))* besides)?`,
};

// ── Saying each part ────────────────────────────────────────────────────────

/** The key whose English is `v` among `hist.<area>.*`, said; undefined when none is. */
function byWord(area: string, v: string, t: T): string | undefined {
  const k = (Object.keys(en) as Key[]).find(x => x.startsWith(`hist.${area}.`) && en[x] === v);
  return k ? t(k) : undefined;
}

/** Someone as the chronicle names them, in the viewer's language: only "of" (and "an unknown figure") change. */
export function personText(v: string, t: T): string | undefined {
  if (!new RegExp(`^${PERSON}$`, 'u').test(v)) return undefined;
  if (isEnglish(t)) return v;
  if (v === 'an unknown figure') return t('hist.unknown');
  if (v === 'an unknown lord') return t('hist.unknownLord');
  if (v === 'someone') return t('hist.someone');
  return v.replace(/ of /, ` ${t('hist.of')} `);
}

/** A lordship ("Hundred of Ravenford"): its title word, said, before its name ("häradet Ravenford"). */
export function titleText(v: string, t: T): string | undefined {
  if (v === 'a title') return t('hist.aTitle');
  const m = v.match(new RegExp(`^(${alt(TITLE_WORD_LIST)}) of (${NAME})$`, 'u'));
  if (!m) return undefined;
  if (isEnglish(t)) return v;
  return `${t(`hist.tw.${m[1].replace(/ /g, '')}` as Key)} ${m[2]}`;
}

/** A name before a Swedish ending: one word joins it ("Hollowfordbygden"), several take a hyphen ("Willow Bridge-bygden"). */
const joined = (name: string): string => (name.includes(' ') ? `${name}-` : name);
/** A name in the genitive: "Leorics", and "Magnus" stays "Magnus". */
const genitive = (name: string): string => (/[sxz]$/.test(name) ? name : `${name}s`);

/**
 * A region as the history names it, in the viewer's language: always with a capital in Swedish,
 * since it's a name there ("Hollowfordbygden", "Timmerskogen", "Leorics land").
 */
export function regionText(v: string, t: T): string | undefined {
  if (!new RegExp(`^${REGION}$`, 'u').test(v)) return undefined;
  if (isEnglish(t)) return v;
  const lower = v.replace(/^The /, 'the ');
  let m: RegExpMatchArray | null;
  if (lower === 'the country') return t('hist.rname.here');
  if (lower === 'the next country') return t('hist.rname.next');
  if ((m = lower.match(/^the (.+) country$/))) return t('hist.rname.country', { name: joined(m[1]) });
  if ((m = lower.match(/^(.+)'s Land$/)) || (m = lower.match(/^the Land of (.+)$/))) return t('hist.rname.land', { name: genitive(m[1]) });
  if (lower === 'the Marches of Old Feud') return t('hist.rname.oldFeud');
  if (lower === 'the Feuding March') return t('hist.rname.feuding');
  if ((m = lower.match(/^the (Lean|Hungry|Pale|Fever) (\w+)$/))) return t(`hist.rname.${m[1].toLowerCase()}` as Key, { land: t(`hist.land.${m[2]}` as Key) });
  if ((m = lower.match(new RegExp(`^the (${alt(TRADE_NAME)})$`)))) return t(`hist.rname.${m[1].replace(/ /g, '')}` as Key);
  if ((m = lower.match(new RegExp(`^the (.+) (${TRADE_SUFFIX.join('|')})$`)))) return t(`hist.rname.${m[2]}` as Key, { name: joined(m[1]) });
  return undefined;
}

/** A place: a region by its name, "the land", or a province's name (which stays as it is). */
export function placeText(v: string, t: T): string | undefined {
  const r = regionText(v, t);
  if (r !== undefined) return r;
  if (v === 'the land' || v === 'the province') return isEnglish(t) ? v : t('hist.theLand');
  return new RegExp(`^${NAME}$`, 'u').test(v) ? v : undefined;
}

/** A lordship and the seats that came with it ("Hundred of Ravenford and 2 other seats"). */
export function seatsText(v: string, t: T): string | undefined {
  const m = v.match(/^(.*?)(?: and (another seat|(\d+) other seats))?$/s)!;
  const title = titleText(m[1], t);
  if (title === undefined) return undefined;
  if (!m[2]) return title;
  return m[3] ? t('hist.otherSeats', { title, count: m[3] }) : t('hist.otherSeat', { title });
}

/**
 * A culture as the history names it ("Fieldborn", world/peoples.ts): by the road's word for it
 * (`culture.fieldborn`, as a person's card names their culture), its own name if the catalog has none.
 */
export function cultureText(v: string, t: T): string | undefined {
  if (!new RegExp(`^${NAME}$`, 'u').test(v)) return undefined;
  const k = `culture.${v.toLowerCase().replace(/ /g, '-')}`;
  return isKey(k) ? t(k) : v;
}

/** "the plague", "the hard winter": an event's name, by the engine's kind (past-topics.ts EVENT_NOUNS). */
export function nounText(v: string, t: T): string | undefined {
  const k = Object.keys(EVENT_NOUNS).find(x => EVENT_NOUNS[x] === v);
  if (k) return t(`hist.noun.${k}` as Key);
  // A kind named from its own words (past-topics.ts eventNoun): read the kind back, if the catalog names it.
  const m = v.match(/^the ([a-z][a-z ]*)$/);
  const key = m ? `hist.noun.${m[1].toUpperCase().replace(/ /g, '_')}` : '';
  return isKey(key) ? t(key) : undefined;
}

/** A village family by its plural ("the Brekkes" → "Brekke"): the name, without its English plural. */
const familyOf = (v: string): string | undefined => (/^[A-ZÅÄÖ][\p{L}'’-]*s$/u.test(v) ? v.slice(0, -1) : undefined);

/** "its fields", "timber": what a place lives on (economy.ts TRADE_WORDS), said. */
const tradeText = (v: string, t: T): string | undefined => { const k = Object.keys(TRADE_WORDS).find(x => TRADE_WORDS[x] === v); return k ? t(`hist.trade.${k}` as Key) : undefined; };

/**
 * One history part, said in the viewer's language; undefined when `v` isn't a value it can be
 * (then the template doesn't match after all); null when `name` isn't a history part.
 */
export function histPart(name: string, v: string, t: T): string | null | undefined {
  switch (name) {
    case 'lord': return personText(v, t);
    case 'given': case 'fam': case 'house': return new RegExp(`^${HIST_PATTERN[name]}$`, 'u').test(v) ? v : undefined;
    case 'fams': return familyOf(v);
    case 'place': return placeText(v, t);
    case 'title': return titleText(v, t);
    case 'Title': { if (!v.startsWith('The ')) return undefined; const s = titleText(v.slice(4), t); return s === undefined ? s : isEnglish(t) ? v : cap(s); }
    case 'seats': return seatsText(v, t);
    case 'region': return regionText(v, t);
    case 'Region': { const r = regionText(v, t); return r === undefined ? r : cap(r); }
    case 'count': return /^\d[\d,]*$/.test(v) ? localNum(v, t) : undefined;
    case 'year': return /^\d+$/.test(v) ? v : undefined;
    case 'cause': case 'madness': case 'law': case 'venture': case 'nventure': case 'fled': case 'share': case 'setting': case 'custom': case 'tier': case 'tier2':
      return byWord(name, v, t);
    case 'drift': return byWord('why', v, t) ?? byWord('why2', v, t);
    case 'trait': {
      const k = byWord('trait', v, t);
      if (k !== undefined) return k;
      const m = v.match(/^A change in custom \(([a-z_]+)\)$/);
      return m ? t('hist.changeOfCustom', { trait: m[1] }) : undefined;
    }
    case 'traitlow': {
      const label = TRAIT_LABELS.find(l => l.toLowerCase() === v);
      if (label) { const s = byWord('trait', label, t)!; return s[0].toLowerCase() + s.slice(1); }
      const m = v.match(/^a change in custom \(([a-z_]+)\)$/);
      return m ? t('hist.changeOfCustom', { trait: m[1] }).toLowerCase() : undefined;
    }
    case 'people': return byWord('kind', v, t) ?? (/^[A-ZÅÄÖ][\p{L}]+$/u.test(v) ? v : undefined);
    case 'People': { const k = byWord('kind', v, t); return k !== undefined ? cap(k) : /^[A-ZÅÄÖ][\p{L}]+$/u.test(v) ? v : undefined; }
    case 'culture': return v === 'people' ? t('hist.thePeople') : cultureText(v, t);
    // An organisation's name is a name (the road's bridge, organisations.ts, names it the same way).
    case 'guild': {
      if (v === 'a guild') return t('hist.aGuild');
      let m = v.match(/^Guild of (.+) (Blades|Scholars|Merchants|Craftsmen)$/);
      if (m) return t(`hist.guild.${m[2]}` as Key, { place: m[1] });
      m = v.match(/^Academy of (.+)$/);
      if (m) return t('hist.guild.academy', { place: m[1] });
      return undefined;
    }
    case 'noun': return nounText(v, t);
    case 'Noun': { const s = nounText(v[0].toLowerCase() + v.slice(1), t); return s === undefined ? undefined : cap(s); }
    case 'trade': return tradeText(v, t);
    case 'founded': { const k = Object.keys(FOUNDING_WORDS).find(x => FOUNDING_WORDS[x] === v); return k ? t(`hist.founded.${k}` as Key) : undefined; }
    case 'besides': {
      if (v === '') return '';
      const m = v.match(/^, and on (.+) besides$/);
      if (!m) return undefined;
      // The trades one by one, longest first: "peat and reed" is one trade, though it has an "and" in it.
      const bits: (string | undefined)[] = [];
      let rest = m[1];
      const trades = Object.values(TRADE_WORDS).sort((a, b) => b.length - a.length);
      while (rest) {
        const hit = trades.find(x => rest === x || rest.startsWith(`${x} and `));
        if (!hit) return undefined;
        bits.push(tradeText(hit, t));
        rest = rest.slice(hit.length).replace(/^ and /, '');
      }
      if (!bits.every(Boolean)) return undefined;
      const list = bits.length > 1 ? t('road.and', { a: bits.slice(0, -1).join(', '), b: bits.at(-1)! }) : bits[0]!;
      return t('hist.fact.besides', { list });
    }
    default: return null;
  }
}

/** Whether a catalog key is one of the history's templates or words. */
export const isHistKey = (k: string): boolean => k.startsWith('hist.') && isKey(k);
