/**
 * The words only dev mode shows (#1735), as patterns to look for in any text an AI player reads.
 *
 * Dev mode lives only in the browser page (feature-choices.ts). The play API, the MCP server, the
 * text console and the AI benchmark have none, and src/artificer-play/dev-mode-ai.test.ts holds that
 * line by reading everything they send an AI and finding none of these. A new dev-only view adds
 * its catalog key to DEV_ONLY_KEYS, and the test covers it too.
 *
 * Built from the catalog itself, in every language, rather than copied out by hand, so a reworded
 * dev string is still found.
 */

import { CATALOGS, LANGS, type Key } from '../artificer/i18n';
import { KIT } from '../artificer/kit';

/**
 * Catalog keys only dev mode draws: the ⚙ gate and the features panel (`dev.*`, `head.features`,
 * `top.features`), the header's DEV chip and the DEV tags (`top.dev`, `tab.dev`), and the hidden
 * truths of `?dev=truths` (a skill's true level, a person's true trust, a pack item's rule).
 */
export const DEV_ONLY_KEYS: readonly Key[] = [
  'top.dev', 'top.devTip', 'tab.dev', 'top.features', 'head.features',
  'dev.label', 'dev.on', 'dev.leave', 'dev.password', 'dev.placeholder', 'dev.unlock', 'dev.wrong', 'dev.noHash',
  'dev.enter', 'dev.openNote', 'dev.featOn', 'dev.featOff', 'dev.thisRun', 'dev.runOn', 'dev.runOff', 'dev.rules', 'dev.looks',
  'dev.featuresNoteHtml',
  'warden.truth', 'warden.truthTip', 'road.true', 'road.trueTip', 'pack.rule', 'pack.ruleTip',
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const anyOf = (words: readonly string[]): string => `(?:${words.map(escapeRe).join('|')})`;

/** Shorter than this once its `{vars}` are taken out, a string is too plain to look for ("ON", "DEV"); the extras below cover those. */
const MIN_LITERAL = 6;
/**
 * A pack item's rule shorter than this reads like any game line ("+2 materials" is also what a day
 * of gathering says), so it isn't looked for on its own: with `?dev=truths` it shows as "rule: …"
 * (`pack.rule`, filled with every rule), which is looked for.
 */
const MIN_RULE = 18;

/**
 * Patterns for every dev-only string, in every language, plus what the views add without a key:
 * each pack item's rule (shown only with `?dev=truths`), an action's vital cost ("vigor + clarity",
 * dev mode only), the DEV tag itself, and any mention of dev mode or `?dev`.
 */
export function devOnlyPatterns(): { what: string; re: RegExp }[] {
  const levels = LANGS.flatMap(l => Array.from({ length: 10 }, (_, n) => CATALOGS[l]?.[`level.${n}` as Key] ?? '')).filter(Boolean);
  const rules = KIT.map(k => k.effect);
  // What a `{var}` can be: the real values where a var is a word from a short list, else any short run.
  const fill = (name: string): string =>
    name === 'n' ? '-?\\d+' : name === 'level' ? anyOf(levels) : name === 'rule' ? anyOf(rules) : '[^\\n]{1,60}?';
  const out: { what: string; re: RegExp }[] = [];
  for (const key of DEV_ONLY_KEYS) {
    for (const lang of LANGS) {
      const raw = CATALOGS[lang]?.[key];
      if (!raw) continue;
      // HTML goes: the API turns the page's HTML into plain text, so `<b>{state}</b>` reads `{state}`.
      const text = raw.replace(/<[^>]+>/g, '').trim();
      // A var filled from a short list ("rule: {rule}") makes even a short string distinctive.
      if (!/\{(?:level|rule)\}/.test(text) && text.replace(/\{\w+\}/g, '').trim().length < MIN_LITERAL) continue;
      const parts = text.split(/(\{\w+\})/).map(p => (/^\{\w+\}$/.test(p) ? fill(p.slice(1, -1)) : escapeRe(p)));
      out.push({ what: `${lang}:${key}`, re: new RegExp(parts.join('')) });
    }
  }
  for (const k of KIT) if (k.effect.length >= MIN_RULE) out.push({ what: `rule of ${k.id}`, re: new RegExp(escapeRe(k.effect)) });
  out.push(
    { what: 'a vital cost', re: /vigor \+ clarity/i },
    { what: 'the DEV tag', re: /\bDEV\b/ },
    { what: 'a mention of dev mode', re: /\bdev[ -]?(?:mode|läge|läget)\b|utvecklarläge|developer mode/i },
    { what: 'a mention of ?dev', re: /\?dev\b|\bdev=(?:truths|0|off)\b|artificer\.devUnlocked|artificer\.truths/i },
  );
  return out;
}

/** What in a text only dev mode shows: each pattern found, named, with what it matched. Empty when clean. */
export function devOnlyHits(text: string, patterns = devOnlyPatterns()): string[] {
  return patterns.flatMap(p => {
    const m = p.re.exec(text);
    return m ? [`${p.what}: "${m[0]}"`] : [];
  });
}
