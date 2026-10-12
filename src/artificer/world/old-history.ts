/**
 * Old history bends with age (#1650), the way rumours bend with distance (claims.ts, #1589).
 *
 * The owner (2026-10-12): "places with mostly short lived races, forget faster while say elf like
 * people or dvergar live a lot longer and the same people might actually remember." So an old
 * event drifts by **who remembers it**:
 *
 * - **Living memory is measured in the holders' lifetimes.** The chronicle's LIVING_MEMORY (40
 *   years) is a human figure; a People's is scaled by its lifespan against the human 75
 *   (`livingMemoryOf`). A Bergfolk hold (240 years) still has eyewitnesses to the whole of the
 *   Reach's 150 years but its oldest few; the Lövfolk (500) and the Peoples canon gives no end
 *   (Dragons, Fae, Everstill…) to all of it. An eyewitness tells it as it was: no drift at all.
 * - **Drift grows with the retellings** (`retellingsOf`): one for the first generation of tellers
 *   after the last eyewitness, one more for every generation after that (a generation scaled by
 *   lifespan too: 20 years for humans, as `GENERATION`). Each retelling is one hop of a rumour.
 * - **The teller's culture sets the direction** (claims.ts `tellingOf`, the story engine's
 *   `PerceptualBias` words read through TELLING_BENDS): a loss-averse village grows the dead of
 *   an old plague more, a fatalist one less, and one that holds to what it first heard (sunk
 *   cost) keeps the place where it was. Lifespan sets how much, culture which way.
 * - **A place's memory follows who lives there** (`oldTellings`): one telling per People and
 *   culture among its holders, weighted by how many hold it, so a mixed village keeps a garbled
 *   human telling beside an accurate Bergfolk one, and the two can contradict each other.
 *
 * Lifespans come from canon (content/lifespans.json, each citing its source; a People canon gives
 * no figure for takes the engine's human baseline and is listed there).
 *
 * ## Slots, and why years never move
 *
 * The engine writes its events as finished sentences, and the numbers in them are of every kind:
 * "killing 222", "3 years in the cold", "founded in 31", "at the age of 79", "2 of its 5 lands".
 * Rather than change the engine's renderer (storytelling/, golden hashes, HISTORY_VERSION) or what
 * a kept history holds, the slots are read out of the told words here, at read time (`slotsOf`):
 * - `{n}`: a number in figures that **counts people**, known by the word after it (`COUNTED`:
 *   riders, souls, humans, "of noble blood"…) or the word before ("killing"). Nothing else is a
 *   count: years, ages, durations, prices, levels, and counts of lands or seats stay as told, so
 *   a year can never be mistaken for a count. A number we don't recognise is left alone: the rule
 *   errs towards telling too exactly, never towards moving a year. And the "N years ago, in year
 *   Y:" a fact opens with is put on after the bend, so it's never in the template at all.
 * - `{place}`: a province of the region, named standing alone. Not in a title ("Hundred of
 *   Ravenford") or a person's name ("Ivar of Ravenford", a house named for its seat), and not in a
 *   region's name ("the Ravenford country"): a lordship and a house keep their names.
 * - `{who}`: a named person, "Given[ II] of House", where Given is one of the Reach cultures'
 *   names. It swaps for another name of the same culture's list in the same house ("someone of the
 *   same house"); the regnal number goes, since it was the first one's.
 *
 * Pure and deterministic. Each retelling draws from a generator seeded by the event's fact id, the
 * holder's People and the retelling (rng.ts, `old-history|…`), never from a sim stream or the
 * engine's: the same event told twice reads the same, and two cultures of one People roll the
 * same dice and differ only in their bend, so the direction always shows.
 */

import type { People } from '../villages';
import { asPlayed, VILLAGES } from '../villages';
import type { FeatureSwitches } from '../features';
import { DRIFT_GROWTH, NAME_SWAP, PLACE_SHIFT, tellingOf } from '../claims';
import { generator, seedOf } from '../rng';
import { REACH_CULTURES, PEOPLES_OF, type ReachCulture } from './peoples';
import { LIVING_MEMORY, type ReachHistory } from './history-format';
import lifespanFile from '../content/lifespans.json';

/** Every People with a lifespan: the road's (villages.ts `People`) and the Wildkin, the 18th. */
export type Kin = People | 'Wildkin';

/** A People's lifespan as content/lifespans.json gives it, with the canon it rests on. */
export interface LifespanEntry {
  people: Kin;
  /** Years, the middle of canon's range; null when canon gives it no end (`unbounded`). */
  years: number | null;
  unbounded?: boolean;
  /** Canon gives no figure: the engine's human baseline stands in. */
  default?: boolean;
  /** `file › field` the figure is read from. */
  source: string;
  /** The words in that file it's read from (old-history.test.ts checks they're there). */
  quote: string;
  note?: string;
}

// As in claims.ts: a JSON import types `people` as `string`; the test checks the data's shape.
const ENTRIES = lifespanFile.peoples as unknown as readonly LifespanEntry[];
const BY_PEOPLE: ReadonlyMap<string, LifespanEntry> = new Map(ENTRIES.map(e => [e.people, e]));

/** Every People's lifespan entry, as written: what a reviewer checks against canon. */
export const lifespanEntries = (): readonly LifespanEntry[] => ENTRIES;

/**
 * The human lifespan the chronicle's LIVING_MEMORY was set against: the story engine's baseline
 * (storytelling/biology.ts NEUTRAL_BIOLOGY.lifespan, which a test keeps this equal to). Not
 * imported, so reading old history never loads the engine.
 */
export const HUMAN_LIFESPAN = lifespanFile.baseline.years;

/** A People's lifespan in years, or null for one canon gives no end. A People not listed gets the baseline. */
export function lifespanOf(people: string): number | null {
  const e = BY_PEOPLE.get(people);
  return e ? (e.unbounded ? null : e.years) : HUMAN_LIFESPAN;
}

/**
 * How long a People's eyewitnesses last: LIVING_MEMORY for humans (75 years), scaled by lifespan
 * for everyone else. Infinite for a People that doesn't die of age.
 */
export function livingMemoryOf(people: string): number {
  const years = lifespanOf(people);
  return years === null ? Infinity : LIVING_MEMORY * years / HUMAN_LIFESPAN;
}

/** A generation of a People's tellers: half its living memory (20 years for humans, as regional-facts.ts `GENERATION`). */
export function generationOf(people: string): number {
  return livingMemoryOf(people) / 2;
}

/**
 * How many times an event `ago` years old has been retold among a People: none while its
 * eyewitnesses live; then one for the first generation of tellers who only heard it, and one more
 * for each generation after. Humans: 41 to 60 years, once; 150 years, six times.
 */
export function retellingsOf(ago: number, people: string): number {
  const living = livingMemoryOf(people);
  // Generation k of tellers covers (living + (k-1)·generation, living + k·generation]: a ceiling.
  return ago <= living ? 0 : Math.ceil((ago - living) / generationOf(people));
}

// ── Slots ──────────────────────────────────────────────────────────────────

/** One blank in a told event: a count of people, a place, or a named person. */
export type Slot =
  | { kind: 'n'; value: number; grouped: boolean }
  | { kind: 'place'; value: string }
  | { kind: 'who'; given: string; numeral: string | null; house: string };

/**
 * A told event with its blanks taken out: `parts` are the words between them (one more than the
 * slots), so `parts[0] + slot 0 + parts[1] + …` is the text again. `template` is the same with
 * `{n}`, `{place}` and `{who}` written in, for reading.
 */
export interface Template { parts: string[]; slots: Slot[]; template: string }

/** The words that say a number counts people: "riders", "souls", "of noble blood"… */
const COUNTED = ['humans', 'men', 'women', 'riders', 'warriors', 'soldiers', 'sailors', 'souls', 'dead', 'people', 'folk', 'families',
  'refugees', 'settlers', 'strangers', 'rebels', 'bandits', 'outlaws', 'pilgrims', 'survivors', 'followers', 'retainers', 'knights',
  'of noble blood', 'more of name'];
const COUNT = new RegExp(`(\\bkilling )(\\d[\\d,]*)\\b|\\b(\\d[\\d,]*)(?= (?:${COUNTED.join('|')})\\b)`, 'g');
/** However a number is found, these around it make it a year, an age or a span, never a count. */
const TIME_BEFORE = /\b(?:year|years|in|since|until|age of|level)\s$/i;
const TIME_AFTER = /^\s(?:years?|winters?|summers?|months?|days?|seasons?|generations?)\b/i;

/** Every given name the Reach's cultures give, with the list it's from (a culture's male or female names). */
const NAME_LISTS: ReadonlyMap<string, readonly string[]> = new Map(REACH_CULTURES.flatMap(c =>
  [c.namesMale ?? [], c.namesFemale ?? []].flatMap(list => list.map(n => [n, list] as const))).reverse());
const WHO = new RegExp(`(${[...NAME_LISTS.keys()].sort((a, b) => b.length - a.length).join('|')})(?: ([IVXLC]+))? of ([A-ZÅÄÖ][\\p{L}']*)`, 'gu');
const LETTER = /[\p{L}\d]/u;

interface Found { at: number; end: number; slot: Slot }

/** The blanks in `text`: people-counts, any of `places` standing alone, and named people. */
export function slotsOf(text: string, places: readonly string[]): Template {
  const found: Found[] = [];
  for (const m of text.matchAll(WHO)) {
    const at = m.index!;
    if (at > 0 && LETTER.test(text[at - 1])) continue;
    found.push({ at, end: at + m[0].length, slot: { kind: 'who', given: m[1], numeral: m[2] ?? null, house: m[3] } });
  }
  for (const place of [...places].sort((a, b) => b.length - a.length)) {
    for (let at = text.indexOf(place); at >= 0; at = text.indexOf(place, at + 1)) {
      const end = at + place.length;
      if ((at > 0 && LETTER.test(text[at - 1])) || (end < text.length && LETTER.test(text[end]))) continue;
      if (/\bof $/.test(text.slice(0, at)) || /^(?: country|'s)/.test(text.slice(end))) continue;
      found.push({ at, end, slot: { kind: 'place', value: place } });
    }
  }
  for (const m of text.matchAll(COUNT)) {
    const digits = m[2] ?? m[3];
    const at = m.index! + (m[1]?.length ?? 0);
    const end = at + digits.length;
    if ((!m[1] && TIME_BEFORE.test(text.slice(0, at))) || TIME_AFTER.test(text.slice(end))) continue;
    found.push({ at, end, slot: { kind: 'n', value: Number(digits.replace(/,/g, '')), grouped: digits.includes(',') } });
  }
  // In order, and never two over the same words (a name first, then a place, then a count).
  const kept: Found[] = [];
  for (const f of found) if (!kept.some(k => f.at < k.end && k.at < f.end)) kept.push(f);
  kept.sort((a, b) => a.at - b.at);
  const parts: string[] = [];
  let from = 0;
  for (const k of kept) { parts.push(text.slice(from, k.at)); from = k.end; }
  parts.push(text.slice(from));
  const slots = kept.map(k => k.slot);
  return { parts, slots, template: parts.map((p, i) => (i < slots.length ? `${p}{${slots[i].kind}}` : p)).join('') };
}

const say = (s: Slot): string =>
  s.kind === 'n' ? (s.grouped ? s.value.toLocaleString('en') : String(s.value))
    : s.kind === 'place' ? s.value
      : `${s.given}${s.numeral ? ` ${s.numeral}` : ''} of ${s.house}`;

/** The text again, with the slots as they now stand. */
export const fill = (t: Pick<Template, 'parts'>, slots: readonly Slot[]): string =>
  t.parts.map((p, i) => (i < slots.length ? p + say(slots[i]) : p)).join('');

// ── Bending ────────────────────────────────────────────────────────────────

/** Who holds a telling: a People (how long they remember), a culture (which way they bend it), and their share of the place. */
export interface Holder { people: Kin; culture: string; share: number }

/**
 * An old event as one holder tells it: retold `retellingsOf` times, each retelling a hop of a
 * rumour (claims.ts), bent by the holder's culture (`tellingOf`). At each, seven draws, always all
 * taken, so one bend never changes the next draw:
 * - every people-count grows by up to DRIFT_GROWTH of itself, by the culture's `growth`, and by
 *   at least one (nobody tells an old disaster smaller than they heard it);
 * - with chance PLACE_SHIFT, by the culture's `shift`, one place moves to another of `places`
 *   (one the line doesn't already name);
 * - with chance NAME_SWAP one named person becomes someone else of the same house.
 * The frames TELLING_BENDS writes ("worse by the time it reaches us") are for news on its way and
 * aren't added: an old story isn't on its way anywhere.
 */
export function bendOld(eventId: string, text: string, ago: number, holder: Pick<Holder, 'people' | 'culture'>, places: readonly string[]): { text: string; retellings: number } {
  const retellings = retellingsOf(ago, holder.people);
  if (!retellings) return { text, retellings };
  const t = slotsOf(text, places);
  if (!t.slots.length) return { text, retellings };
  const telling = tellingOf(holder.culture);
  const slots = [...t.slots];
  const where = slots.flatMap((s, i) => (s.kind === 'place' ? [i] : []));
  const named = slots.flatMap((s, i) => (s.kind === 'who' ? [i] : []));
  for (let i = 1; i <= retellings; i++) {
    const rand = generator(seedOf(`old-history|${eventId}|${holder.people}|${i}`));
    const grow = rand(), moves = rand(), whichPlace = rand(), pick = rand(), swaps = rand(), whichName = rand(), whom = rand();
    slots.forEach((s, j) => {
      if (s.kind === 'n') slots[j] = { ...s, value: s.value + Math.max(1, Math.round(s.value * grow * DRIFT_GROWTH * telling.growth)) };
    });
    if (where.length && moves < PLACE_SHIFT * telling.shift) {
      const j = where[Math.floor(whichPlace * where.length)];
      const told = new Set(where.map(k => (slots[k] as { value: string }).value));
      const others = places.filter(p => !told.has(p));
      if (others.length) slots[j] = { kind: 'place', value: others[Math.floor(pick * others.length)] };
    }
    if (named.length && swaps < NAME_SWAP) {
      const j = named[Math.floor(whichName * named.length)];
      const s = slots[j] as Extract<Slot, { kind: 'who' }>;
      const taken = new Set(named.map(k => (slots[k] as Extract<Slot, { kind: 'who' }>).given));
      const pool = (NAME_LISTS.get(s.given) ?? []).filter(n => !taken.has(n));
      if (pool.length) slots[j] = { ...s, given: pool[Math.floor(whom * pool.length)], numeral: null };
    }
  }
  return { text: fill(t, slots), retellings };
}

/** One of a holder group's tellings, and how many retellings it's been through among them. */
export interface HeldBy { people: Kin; culture: string; share: number; retellings: number }

/** One way a place tells an old event, and who tells it so. */
export interface OldTelling {
  text: string;
  /** `true` if someone who saw it tells it (their People's eyewitnesses still live), else `rumour`. */
  truth: 'true' | 'rumour';
  /** For an eyewitness telling: whether it's within one of its witnesses' People's first generation (depth 1 if so). */
  recent: boolean;
  heldBy: HeldBy[];
}

/**
 * How a place's holders tell an event `ago` years old: one telling per holder group (`bendOld`),
 * those that read the same as one, the most widely held first (ties in the holders' order). Null
 * when every holder saw it and it's within LIVING_MEMORY, or there are no holders: then it's told
 * exactly as before the switch, truth, depth and all, so nothing within living memory changes.
 */
export function oldTellings(eventId: string, text: string, ago: number, holders: readonly Holder[], places: readonly string[]): OldTelling[] | null {
  // Nobody to tell it (a place with no people we know of) also keeps the history's own telling.
  if (!holders.length || (ago <= LIVING_MEMORY && holders.every(h => ago <= livingMemoryOf(h.people)))) return null;
  const out: OldTelling[] = [];
  for (const h of holders) {
    const bent = bendOld(eventId, text, ago, h, places);
    const held: HeldBy = { people: h.people, culture: h.culture, share: h.share, retellings: bent.retellings };
    const same = out.find(t => t.text === bent.text);
    if (same) same.heldBy.push(held);
    else out.push({ text: bent.text, truth: 'rumour', recent: false, heldBy: [held] });
  }
  for (const t of out) {
    const witnesses = t.heldBy.filter(x => x.retellings === 0);
    t.truth = witnesses.length ? 'true' : 'rumour';
    t.recent = witnesses.some(x => ago <= generationOf(x.people));
  }
  const share = (t: OldTelling) => t.heldBy.reduce((s, x) => s + x.share, 0);
  // A stable sort keeps the holders' order on a tie.
  return out.sort((a, b) => share(b) - share(a));
}

/** The id a telling other than the main one is told under: the event's, and who tells it (its first holder). */
export const tellingId = (eventId: string, t: OldTelling): string => `${eventId}:told-by:${t.heldBy[0].people}:${t.heldBy[0].culture}`;

// ── Who holds a place's memory ─────────────────────────────────────────────

/** Holders from (People, culture, weight) triples: grouped, normalised, the largest first (ties in the order met). */
function grouped(triples: readonly [Kin, string, number][]): Holder[] {
  const by = new Map<string, Holder>();
  for (const [people, culture, w] of triples) {
    const k = `${people}|${culture}`;
    const h = by.get(k);
    if (h) h.share += w; else by.set(k, { people, culture, share: w });
  }
  const total = [...by.values()].reduce((s, h) => s + h.share, 0) || 1;
  return [...by.values()].map(h => ({ ...h, share: h.share / total })).sort((a, b) => b.share - a.share);
}

/**
 * Who holds a road village's memory: its people, each one share, by People (as the run plays them,
 * villages.ts `asPlayed`: Maren is Riksfolk with humans on the road) and culture.
 */
export function villageHolders(village: string, features: FeatureSwitches | undefined): Holder[] {
  return grouped((VILLAGES[village]?.people ?? []).map(p => {
    const played = asPlayed(p, features);
    return [played.people, played.culture, 1] as [Kin, string, number];
  }));
}

/**
 * Who holds a generated region's memory: each of its lands an equal share, split among the
 * Peoples its culture is followed by (peoples.ts PEOPLES_OF, cultures.json's demographics). The
 * odd patches of humans are left out: rare, and nobody's demographics.
 */
export function regionHolders(history: ReachHistory, regionId: string): Holder[] {
  const r = history.regions.find(x => x.id === regionId);
  if (!r) return [];
  return grouped(r.provinces.flatMap(rp => {
    const name = history.provinces.find(p => p.id === rp.id)?.culture;
    const culture = REACH_CULTURES.find(c => c.name === name)?.id as ReachCulture | undefined;
    return culture ? PEOPLES_OF[culture].map(([people, w]) => [people, culture, w] as [Kin, string, number]) : [];
  }));
}
