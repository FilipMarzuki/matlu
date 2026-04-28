export type Lang = 'en' | 'sv';

/** Server-side string selector — returns the EN or SV string based on lang. */
export function t(lang: Lang, en: string, sv: string): string {
  return lang === 'sv' ? sv : en;
}
