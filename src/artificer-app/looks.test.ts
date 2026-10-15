/**
 * Era looks (#1719): the nine token sets are complete, only colours, backgrounds, border colours
 * and shadows differ between them (never layout), every look's text is readable (WCAG AA), and the
 * look stays presentation: it isn't in the save.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  COLOR_TOKENS, IMAGE_TOKENS, SHADOW_TOKENS, ERAS, LOOKS, LOOK_IDS, FADE_MS, contrast, eraOf, stepOf, hexRgb,
  isLookId, lookFromQuery, lookOfGame, looksCss, shownLook, loadLookChoice, saveLookChoice, stepLook, LOOK_SWITCHER_FEATURE, type LookId,
} from './looks';
import { featureById, ruleFeatures, uiFeatureOn } from '../artificer/features';
import { newGame, serialize } from './controller';

const ALL_TOKENS: readonly string[] = [...COLOR_TOKENS, ...IMAGE_TOKENS, ...SHADOW_TOKENS];
const HERE = __dirname;

/** Split at commas outside parentheses: the layers of a background, the shadows of a box-shadow. */
const topLevel = (v: string): string[] => {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const c of v) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  out.push(cur.trim());
  return out;
};

/** CSS as declarations: each `prop: value` with the selector (and at-rule) it sits under. */
function declarations(css: string): { selector: string; prop: string; value: string }[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { selector: string; prop: string; value: string }[] = [];
  const stack: string[] = [];
  let buf = '';
  for (const c of src) {
    if (c === '{') { stack.push(buf.trim()); buf = ''; }
    else if (c === ';' || c === '}') {
      const d = buf.trim();
      const i = d.indexOf(':');
      if (d && i > 0 && stack.length) out.push({ selector: stack[stack.length - 1], prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim() });
      buf = '';
      if (c === '}') stack.pop();
    } else buf += c;
  }
  return out;
}

/** Properties that only paint: they can't move or resize anything. */
const PAINT = /^(color|color-scheme|background(-color|-image)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|box-shadow|text-shadow|text-decoration(-color)?|caret-color|accent-color|fill|stroke|column-rule(-color)?)$/;

/** Look tokens a CSS value reads. */
const tokensIn = (value: string): string[] => [...value.matchAll(/var\(--([a-z0-9-]+)/g)].map(m => m[1]).filter(n => ALL_TOKENS.includes(n));

/**
 * Where a stylesheet lets a look change more than paint: a look token read by a property that isn't
 * paint (a width, a padding), or a rule for one look (`[data-look…]`) that sets one, or sets a
 * custom property that isn't a look token.
 */
function layoutLeaks(css: string): string[] {
  const bad: string[] = [];
  for (const d of declarations(css)) {
    const custom = d.prop.startsWith('--');
    const forOneLook = d.selector.includes('data-look');
    if (forOneLook && (custom ? !ALL_TOKENS.includes(d.prop.slice(2)) : !PAINT.test(d.prop))) bad.push(`${d.selector} { ${d.prop}: ${d.value} }`);
    else if (!custom && tokensIn(d.value).length && !PAINT.test(d.prop)) bad.push(`${d.selector} { ${d.prop}: ${d.value} }`);
  }
  return bad;
}

describe('the nine looks (#1719)', () => {
  it('are the three eras times three steps, each once', () => {
    expect(LOOK_IDS).toHaveLength(9);
    expect(new Set(LOOK_IDS).size).toBe(9);
    for (const era of ERAS) expect(LOOK_IDS.filter(id => eraOf(id) === era).map(stepOf)).toEqual([1, 2, 3]);
    expect(isLookId('rune-3')).toBe(true);
    expect(isLookId('rune-4')).toBe(false);
    expect(isLookId(null)).toBe(false);
  });

  it('each set every token, and only those', () => {
    for (const id of LOOK_IDS) {
      expect(Object.keys(LOOKS[id].tokens).sort(), id).toEqual([...ALL_TOKENS].sort());
      for (const k of ALL_TOKENS) expect(LOOKS[id].tokens[k as keyof (typeof LOOKS)[LookId]['tokens']].trim(), `${id} ${k}`).not.toBe('');
    }
  });

  it('hold colours, gradient images and shadows only: nothing that takes up space', () => {
    const colour = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/i;
    const gradient = /^(repeating-)?(linear|radial|conic)-gradient\(.*\)$/;
    for (const id of LOOK_IDS) {
      const t = LOOKS[id].tokens;
      for (const k of COLOR_TOKENS) expect(t[k], `${id} ${k}`).toMatch(colour);
      for (const k of IMAGE_TOKENS) {
        if (t[k] === 'none') continue;
        for (const layer of topLevel(t[k])) expect(layer, `${id} ${k}`).toMatch(gradient);
      }
      for (const k of SHADOW_TOKENS) {
        if (t[k] === 'none') continue;
        // A shadow: optional inset, two to four lengths, a colour. No spread can move a box: shadows don't take space.
        for (const s of topLevel(t[k])) expect(s, `${id} ${k}`).toMatch(/^(inset )?(-?\d*\.?\d+(px)? ){2,4}rgba?\([^)]*\)$/);
      }
      // Images and shadows may only read the look's own colour tokens.
      for (const k of [...IMAGE_TOKENS, ...SHADOW_TOKENS]) {
        for (const [, name] of t[k].matchAll(/var\(--([a-z0-9-]+)\)/g)) expect(COLOR_TOKENS as readonly string[], `${id} ${k}`).toContain(name);
      }
    }
  });

  it('differ in the CSS only in their tokens and colour scheme, the same declarations in every look', () => {
    const css = looksCss();
    const byLook = new Map<string, string[]>();
    for (const d of declarations(css)) {
      const m = /^:root\[data-look="([a-z0-9-]+)"\]$/.exec(d.selector);
      if (!m) continue;
      expect(d.prop === 'color-scheme' || ALL_TOKENS.includes(d.prop.replace(/^--/, '')), `${m[1]}: ${d.prop}`).toBe(true);
      byLook.set(m[1], [...(byLook.get(m[1]) ?? []), d.prop]);
    }
    expect([...byLook.keys()]).toEqual([...LOOK_IDS]);
    // The opening keeps its night-sky colours in every look: tokens only there too.
    const night = declarations(css).filter(d => d.selector === ':root[data-look] .intro');
    expect(night.length).toBeGreaterThan(0);
    for (const d of night) expect(d.prop === 'color-scheme' || ALL_TOKENS.includes(d.prop.replace(/^--/, '')), d.prop).toBe(true);
    const first = byLook.get(LOOK_IDS[0])!.slice().sort();
    for (const id of LOOK_IDS) expect(byLook.get(id)!.slice().sort(), id).toEqual(first);
  });

  it('are read by style.css (and the views\' inline styles) only in properties that paint', () => {
    expect(layoutLeaks(readFileSync(join(HERE, 'style.css'), 'utf8'))).toEqual([]);
    // The views draw some styles inline (style="color:var(--faint);…").
    const bad: string[] = [];
    for (const f of readdirSync(HERE).filter(n => n.endsWith('.ts') && !n.endsWith('.test.ts') && n !== 'looks.ts')) {
      const src = readFileSync(join(HERE, f), 'utf8');
      for (const [, prop, value] of src.matchAll(/([a-z-]+)\s*:\s*([^;"`]*var\(--[a-z0-9-]+\)[^;"`]*)/g)) {
        if (tokensIn(value).length && !PAINT.test(prop)) bad.push(`${f}: ${prop}: ${value}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the check catches a look that would move a box', () => {
    expect(layoutLeaks('.box { width: var(--panel); color: var(--ink); }')).toEqual(['.box { width: var(--panel) }']);
    expect(layoutLeaks('@media (x) { :root[data-look="rune-1"] .box { padding: 4px; border-color: red; } }')).toEqual([':root[data-look="rune-1"] .box { padding: 4px }']);
    expect(layoutLeaks(':root[data-look="rune-1"] { --gap: 4px; --panel: #000; }')).toEqual([':root[data-look="rune-1"] { --gap: 4px }']);
    expect(layoutLeaks('.box { border: 1px solid var(--border); box-shadow: var(--box-glow); }')).toEqual([]);
  });

  it('cross-fade their colours over about a second, and not at all with reduced motion', () => {
    const css = looksCss();
    for (const n of COLOR_TOKENS) {
      expect(css).toContain(`@property --${n} { syntax: '<color>'; inherits: true;`);
      expect(css).toContain(`--${n} ${FADE_MS}ms`);
    }
    expect(FADE_MS).toBeGreaterThanOrEqual(700);
    expect(FADE_MS).toBeLessThanOrEqual(1500);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ :root\[data-look-fade\] \{ transition: none; \} \}/);
  });
});

describe('every look is readable: WCAG AA (#1719)', () => {
  const SURFACES = ['bg', 'panel', 'sub', 'sub2'] as const;
  // Text drawn on those surfaces: body text, muted text, the accents (headings, numbers) and the status colours.
  const TEXT = ['ink', 'dim', 'gold', 'teal', 'green', 'warn', 'danger', 'ice', 'lilac', 'amber'] as const;

  it('text and surfaces are opaque colours, so contrast can be computed', () => {
    for (const id of LOOK_IDS) for (const k of [...SURFACES, ...TEXT, 'faint'] as const) expect(hexRgb(LOOKS[id].tokens[k]), `${id} ${k}`).not.toBeNull();
  });

  it('text, muted text, accents and status colours reach 4.5:1 on the background and every panel shade', () => {
    const fails: string[] = [];
    for (const id of LOOK_IDS) {
      const t = LOOKS[id].tokens;
      for (const fg of TEXT) for (const bg of SURFACES) {
        const r = contrast(t[fg], t[bg]);
        if (r < 4.5) fails.push(`${id}: ${fg} on ${bg} ${r.toFixed(2)}`);
      }
    }
    expect(fails).toEqual([]);
  });

  it('the faintest text (hints, meta) still reaches 3:1 on the background and panels', () => {
    for (const id of LOOK_IDS) for (const bg of SURFACES) expect(contrast(LOOKS[id].tokens.faint, LOOKS[id].tokens[bg]), `${id} faint on ${bg}`).toBeGreaterThanOrEqual(3);
  });

  it('computes contrast the WCAG way', () => {
    expect(contrast('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrast('#abc', '#abc')).toBe(1);
  });
});

describe('the look is presentation only (#1719)', () => {
  it('a game is in the field journal until #1723 decides from what the Warden makes', () => {
    expect(lookOfGame(newGame())).toBe('scout-1');
  });

  it('a dev preview is shown over the game\'s look, and nothing else changes', () => {
    const game = newGame();
    const before = serialize(game);
    expect(shownLook(lookOfGame(game), 'rune-2')).toBe('rune-2');
    expect(shownLook(lookOfGame(game), null)).toBe('scout-1');
    expect(serialize(game)).toBe(before);
    // No look id is in the save.
    for (const id of LOOK_IDS) expect(before).not.toContain(id);
  });

  it('the look switcher (#1736) is a ui feature, on by default, that no run saves', () => {
    const f = featureById(LOOK_SWITCHER_FEATURE);
    expect(f?.kind).toBe('ui');
    expect(uiFeatureOn({}, LOOK_SWITCHER_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [LOOK_SWITCHER_FEATURE]: false }, LOOK_SWITCHER_FEATURE)).toBe(false);
    expect(Object.keys(ruleFeatures())).not.toContain(LOOK_SWITCHER_FEATURE);
  });

  it('reads the switcher\'s stored choice back safely', () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    expect(loadLookChoice(store)).toBeNull();
    saveLookChoice('steampunk-2', store);
    expect(loadLookChoice(store)).toBe('steampunk-2');
    m.set('artificer.look', 'not-a-look');
    expect(loadLookChoice(store)).toBeNull();
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(loadLookChoice(broken)).toBeNull();
    expect(() => saveLookChoice('rune-1', broken)).not.toThrow();
    expect(loadLookChoice(null)).toBeNull();
  });

  it('the switcher\'s choice overrides the game\'s look, and clearing it brings the game\'s back', () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    const game = newGame();
    const before = serialize(game);
    saveLookChoice('rune-3', store);
    expect(shownLook(lookOfGame(game), loadLookChoice(store))).toBe('rune-3');
    saveLookChoice(null, store);
    expect(m.has('artificer.look')).toBe(false);
    expect(shownLook(lookOfGame(game), loadLookChoice(store))).toBe('scout-1');
    expect(serialize(game)).toBe(before);
  });

  it('steps round the game\'s look and the nine, both ways', () => {
    expect(stepLook(null, 1)).toBe('scout-1');
    expect(stepLook('scout-1', -1)).toBeNull();
    expect(stepLook(null, -1)).toBe('rune-3');
    expect(stepLook('rune-3', 1)).toBeNull();
    let at: LookId | null = null;
    const seen: (LookId | null)[] = [];
    for (let i = 0; i < 10; i++) { at = stepLook(at, 1); seen.push(at); }
    expect(seen).toEqual([...LOOK_IDS, null]);
  });

  it('?look= previews a look only where allowed (dev mode, a local dev server)', () => {
    expect(lookFromQuery('?look=steampunk-2', true)).toBe('steampunk-2');
    expect(lookFromQuery('?look=steampunk-2', false)).toBeNull();
    expect(lookFromQuery('?look=gold-9', true)).toBeNull();
    expect(lookFromQuery('', true)).toBeNull();
  });
});
