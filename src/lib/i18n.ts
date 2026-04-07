/**
 * Lightweight i18n helper for Matlu.
 *
 * String catalogs live in `src/i18n/<lang>.json` as flat key→string maps.
 * Language preference is stored in localStorage so it persists across sessions.
 *
 * @example
 * ```ts
 * import { t, setLanguage } from '../lib/i18n';
 *
 * setLanguage('sv');          // switch to Swedish
 * this.add.text(0, 0, t('hud.hp'));
 * ```
 */

type StringMap = Record<string, string>;

// Statically import all supported languages at build time.
// Vite bundles these JSON files inline — no runtime fetch needed.
import en from '../i18n/en.json';
import sv from '../i18n/sv.json';
import pl from '../i18n/pl.json';

const catalogs: Record<string, StringMap> = { en, sv, pl };

const STORAGE_KEY = 'matlu_lang';
const DEFAULT_LANG = 'sv';

/** Currently active language code. */
let activeLang: string = DEFAULT_LANG;

// Restore from localStorage on module load (runs once on startup).
if (typeof localStorage !== 'undefined') {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && stored in catalogs) {
    activeLang = stored;
  }
}

/**
 * Translate a key to the active language.
 * Falls back to the English catalog, then to the key itself if not found.
 */
export function t(key: string): string {
  const catalog = catalogs[activeLang] ?? catalogs[DEFAULT_LANG] ?? {};
  const fallback = catalogs['en']?.[key];
  return catalog[key] ?? fallback ?? key;
}

/** Change the active language. Persists to localStorage. */
export function setLanguage(lang: string): void {
  if (!(lang in catalogs)) {
    console.warn(`[i18n] Unknown language: "${lang}". Supported: ${Object.keys(catalogs).join(', ')}`);
    return;
  }
  activeLang = lang;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, lang);
  }
}

/** Returns the current active language code. */
export function getLanguage(): string {
  return activeLang;
}

/** All supported language codes. */
export const SUPPORTED_LANGUAGES = Object.keys(catalogs) as string[];
