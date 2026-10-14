/**
 * The Artificer's string catalog (#1704, epic #1685): every text the player sees, in English and
 * Swedish, looked up by key.
 *
 * Language is presentation only. Nothing in the sim reads this module, the save doesn't hold the
 * language, and the same seed plays the same game in either language: only the words on screen
 * change. That is why it lives beside the sim (so the console, records page and later the API can
 * share one catalog) but is imported only by code that draws text.
 *
 * - `en.ts` is the master: it defines every key, and its type (`Key`) is what `t` accepts, so a
 *   typo'd key is a compile error rather than a blank on screen.
 * - `sv.ts` is `Partial` on purpose: a key it hasn't got yet falls back to English instead of
 *   breaking the page. A test (i18n.test.ts) holds the line that every key is there anyway, with
 *   the same `{vars}`.
 * - `{name}` in a string is a placeholder, filled from `vars`. A var with no value is left as
 *   `{name}`, so a mistake shows up on screen instead of silently vanishing.
 */

import { en } from './en';
import { sv } from './sv';

/** The languages there are. Add one here, give it a catalog, and the picker offers it. */
export const LANGS = ['sv', 'en'] as const;
export type Lang = (typeof LANGS)[number];

/** Every key there is: the English catalog's. */
export type Key = keyof typeof en;
/** A catalog: English must have everything; any other language may lack keys while it's being written. */
export type Catalog = Partial<Record<Key, string>>;
export type Catalogs = { en: Record<Key, string> } & Partial<Record<Lang, Catalog>>;

/** Values for a string's `{placeholders}`. */
export type Vars = Record<string, string | number>;

/** The translate function the page calls: `t('tab.plan')`, `t('top.day', { n: 3 })`. */
export type T = (key: Key, vars?: Vars) => string;

export const CATALOGS: Catalogs = { en, sv };

/** A stored or requested value as a language, or null when it isn't one we have. */
export function parseLang(v: unknown): Lang | null {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v) ? (v as Lang) : null;
}

/** Fill `{name}` placeholders; a missing var stays visible as `{name}`. */
export function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** The `{vars}` a string uses (sorted, each once): what the catalog test compares between languages. */
export function varsOf(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort();
}

/**
 * One lookup: the language's string, else English, else the key itself (a key that isn't in any
 * catalog can only come from a cast, but it shouldn't crash the page either).
 */
export function translate(lang: Lang, key: Key, vars?: Vars, catalogs: Catalogs = CATALOGS): string {
  const text = catalogs[lang]?.[key] ?? catalogs.en[key] ?? key;
  return fill(text, vars);
}

/** A `t` bound to one language (and, for tests, to other catalogs). */
export function makeT(lang: Lang, catalogs: Catalogs = CATALOGS): T {
  return (key, vars) => translate(lang, key, vars, catalogs);
}
