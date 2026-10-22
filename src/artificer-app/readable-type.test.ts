/**
 * Readable type (#1923, ui feature `readable-type`). The look itself is exempt (screenshots, ui-hud),
 * but two things can be checked without a browser: the switch is registered like every ui switch,
 * and readable-type.css covers every rule in style.css that sets a font under 12 px or the pixel
 * font under 16 px — so a tiny label added to style.css later fails here until it gets a line in
 * readable-type.css — and does so only while the switch is on, changing nothing but the type.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FEATURES, featureById, ruleFeatures, uiFeatureOn } from '../artificer/features';
import { READABLE_TYPE_CLASS, READABLE_TYPE_FEATURE, applyReadableType } from './readable-type';

const HERE = __dirname;
const STYLE = readFileSync(join(HERE, 'style.css'), 'utf8');
const READABLE = readFileSync(join(HERE, 'readable-type.css'), 'utf8');

/** The switch's prefix on every rule in readable-type.css. */
const PREFIX = `:where(.${READABLE_TYPE_CLASS}) `;

/**
 * Left as they are, on purpose. The Reach map is a picture drawn in characters, one per square:
 * its size follows the screen's width so the whole map fits (and `.mapwrap` scrolls it if not);
 * at 12 px a phone would see a third of it.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  '.reachmap': 'the map is drawn in characters sized to fit the screen',
};

/**
 * The only properties beyond the type that readable-type.css may set, each because a bigger text
 * wouldn't fit where the smaller did: heights measured in rows of text, and the road's two end
 * labels nudged inside their box.
 */
const NON_TYPE: Readonly<Record<string, readonly string[]>> = {
  '.qschips': ['max-height'],
  '.miles': ['max-height'],
  '.routeline': ['height'],
  '.rl-done + .rl-stop .nm': ['transform'],
  '.rl-stop:has(+ .rl-wagon) .nm': ['transform'],
};

interface Rule { selectors: string[]; decls: Record<string, string> }

/** CSS as rules: each rule's selectors (split at top-level commas) and its declarations. At-rules are looked through. */
function rules(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  const stack: (Rule | null)[] = [];
  let buf = '';
  for (const c of src) {
    if (c === '{') {
      const head = buf.trim();
      buf = '';
      const rule = head.startsWith('@') ? null : { selectors: splitTop(head), decls: {} };
      if (rule) out.push(rule);
      stack.push(rule);
    } else if (c === ';' || c === '}') {
      const d = buf.trim();
      const i = d.indexOf(':');
      const top = stack[stack.length - 1];
      if (top && d && i > 0) top.decls[d.slice(0, i).trim()] = d.slice(i + 1).trim();
      buf = '';
      if (c === '}') stack.pop();
    } else buf += c;
  }
  return out;
}

/** Split at commas outside parentheses and brackets. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A rule's font size in px (a clamp's smallest), and whether it sets the display font (Silkscreen). */
function fontOf(decls: Record<string, string>): { px: number | null; display: boolean } {
  let size = decls['font-size'] ?? '';
  let family = decls['font-family'] ?? '';
  if (decls.font) {
    const m = /(?:^|\s)(\d*\.?\d+px)(?:\/\S+)?\s+(.+)$/.exec(decls.font);
    if (m) { size = m[1]; family = m[2]; } else family = decls.font;
  }
  const n = /(\d*\.?\d+)px/.exec(size);
  return { px: n ? Number(n[1]) : null, display: /--display|Silkscreen/.test(family) };
}

/** Selectors in style.css whose text would be under 12 px, or Silkscreen under 16 px. */
function tinySelectors(css: string): string[] {
  const found = new Set<string>();
  for (const r of rules(css)) {
    const { px, display } = fontOf(r.decls);
    if ((px !== null && px < 12) || (display && (px === null || px < 16))) for (const s of r.selectors) found.add(s);
  }
  return [...found];
}

describe('the readable-type ui feature (#1923)', () => {
  it('is a ui feature, experimental, on by default, registered last after the finds, and no run saves it', () => {
    expect(featureById(READABLE_TYPE_FEATURE)).toMatchObject({ kind: 'ui', stage: 'experimental', default: true, absent: false, issue: 1923 });
    expect(uiFeatureOn({}, READABLE_TYPE_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [READABLE_TYPE_FEATURE]: false }, READABLE_TYPE_FEATURE)).toBe(false);
    expect(FEATURES.findIndex(f => f.id === READABLE_TYPE_FEATURE)).toBe(FEATURES.findIndex(f => f.id === 'explore-finds') + 1);
    expect(READABLE_TYPE_FEATURE in ruleFeatures()).toBe(false);
    expect(ruleFeatures({ [READABLE_TYPE_FEATURE]: false })).toEqual(ruleFeatures());
  });

  it('puts its class on <html> when on, and takes it off when off', () => {
    const classes = new Set<string>();
    const doc = { documentElement: { classList: { toggle: (c: string, on?: boolean) => { if (on) classes.add(c); else classes.delete(c); return !!on; } } } } as unknown as Pick<Document, 'documentElement'>;
    applyReadableType(true, doc);
    expect([...classes]).toEqual([READABLE_TYPE_CLASS]);
    applyReadableType(false, doc);
    expect([...classes]).toEqual([]);
  });
});

describe('readable-type.css (#1923)', () => {
  const overrides = rules(READABLE);

  it('acts only with the switch on: every rule is under the class', () => {
    for (const r of overrides) for (const s of r.selectors) {
      expect(s === `:root.${READABLE_TYPE_CLASS}` || s.startsWith(PREFIX), s).toBe(true);
    }
  });

  it('covers every style.css rule with text under 12 px or Silkscreen under 16 px (bar the map)', () => {
    const covered = new Set(overrides.flatMap(r => r.selectors).filter(s => s.startsWith(PREFIX)).map(s => s.slice(PREFIX.length)));
    const missing = tinySelectors(STYLE).filter(s => !covered.has(s) && !(s in EXEMPT));
    // A selector listed here needs a line in readable-type.css: its group sets the body font at 12–15 px.
    expect(missing).toEqual([]);
    // And nothing is exempt that no longer needs to be.
    for (const s of Object.keys(EXEMPT)) expect(tinySelectors(STYLE)).toContain(s);
  });

  it('sets no size under 12 px and never the pixel font, and changes only the type (no layout)', () => {
    const vars = Object.fromEntries(overrides.filter(r => r.selectors.includes(`:root.${READABLE_TYPE_CLASS}`)).flatMap(r => Object.entries(r.decls)));
    const TYPE = /^(font-family|font-size|font-weight|letter-spacing|line-height)$/;
    for (const r of overrides) {
      if (r.selectors.includes(`:root.${READABLE_TYPE_CLASS}`)) continue;
      for (const [prop, value] of Object.entries(r.decls)) {
        // The few sizes and offsets that follow the text, each said in readable-type.css.
        const allowed = NON_TYPE[r.selectors.map(s => s.slice(PREFIX.length)).join(', ')];
        if (allowed?.includes(prop)) continue;
        expect(prop, `${r.selectors[0]} { ${prop} }`).toMatch(TYPE);
        if (prop === 'font-family') expect(value).toBe('var(--body)');
        if (prop === 'font-size') {
          const resolved = value.replace(/var\((--[a-z-]+)\)/g, (_, v: string) => vars[v] ?? v);
          for (const [, n] of resolved.matchAll(/(\d*\.?\d+)px/g)) expect(Number(n), `${r.selectors[0]}: ${value}`).toBeGreaterThanOrEqual(12);
        }
      }
    }
    // The names the issue lists, in the body font at 14–16 px.
    for (const s of ['.act .t', '.tabbtn', '.statusbar .tag', '.mini .ml', '.vital .vl', '.miles li .mn', '.phase']) {
      const r = overrides.find(x => x.selectors.includes(PREFIX + s));
      expect(r?.decls['font-family'], s).toBe('var(--body)');
      const px = Number(/(\d+)px/.exec(vars[/var\((--[a-z-]+)\)/.exec(r!.decls['font-size'])![1]])![1]);
      expect(px, s).toBeGreaterThanOrEqual(14);
      expect(px, s).toBeLessThanOrEqual(16);
    }
  });
});
