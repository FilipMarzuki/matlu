import { ui } from './ui';
import type { Locale, UiKey } from './ui';

export type { Locale, UiKey };

/**
 * Look up a UI string for the given locale.
 * Falls back to EN if the SV string is somehow undefined at runtime.
 * Using an invalid `key` is a TypeScript error.
 */
export function t(lang: Locale, key: UiKey): string {
  return (ui[lang] as Record<UiKey, string>)[key] ?? ui.en[key];
}

/**
 * Derive the active locale from a page URL.
 *
 * With Astro i18n routing (prefixDefaultLocale: false):
 *   /           → 'en'
 *   /creatures  → 'en'
 *   /sv/        → 'sv'
 *   /sv/creatures → 'sv'
 *
 * Falls back to 'en' for any unrecognised segment.
 */
export function getLangFromUrl(url: URL): Locale {
  const [, first] = url.pathname.split('/');
  if (first === 'sv') return 'sv';
  return 'en';
}
