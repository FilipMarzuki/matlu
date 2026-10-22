/**
 * Era looks (#1719, epic #1717): nine looks, three eras of three steps each, that change only the
 * page's colours and ornaments, never its layout.
 *
 * | Era        | 1                 | 2                | 3               |
 * |------------|-------------------|------------------|-----------------|
 * | scout      | field journal     | cartographer     | surveyor        |
 * | steampunk  | tinkerer's bench  | brass engine     | soot and steam  |
 * | rune       | etched slate      | waking runes     | full rune tech  |
 *
 * How it works: each look is one set of values for the app's existing CSS tokens (style.css's
 * `:root`), written here in TypeScript so the tests can check them (every token present, text
 * readable) without a browser. `looksCss()` turns them into `:root[data-look="…"] { --bg: … }`
 * blocks, and the page puts the shown look's id on `<html data-look="…">`. Nothing else in the CSS
 * knows about looks: a rule reads `var(--panel)` and gets whichever look is on.
 *
 * Why only tokens can differ: players should never relearn where things are (the epic's rule 4), so
 * a look may change colours, backgrounds, border colours and shadows, nothing that moves a box. The
 * tokens hold colours, gradient images and shadows only, and looks.test.ts checks that, and that
 * style.css only feeds tokens into paint properties. So fonts aren't per look either (type moves
 * boxes): `--display` and `--body` are style.css's, the same in every look, and the `readable-type`
 * ui switch (#1923, readable-type.css) changes the type for all nine at once.
 *
 * Presentation only: the look is worked out when the page is drawn (`lookOfGame`), never saved in
 * the sim, the save or the run log. Dev mode can preview any look on top (`shownLook`).
 *
 * The values are placeholders from the epic's descriptions; the era issues (#1693, #1720–#1722)
 * refine them.
 */

import type { AppState } from './controller';

export const ERAS = ['scout', 'steampunk', 'rune'] as const;
export type Era = (typeof ERAS)[number];

export const LOOK_IDS = ['scout-1', 'scout-2', 'scout-3', 'steampunk-1', 'steampunk-2', 'steampunk-3', 'rune-1', 'rune-2', 'rune-3'] as const;
export type LookId = (typeof LOOK_IDS)[number];

export const isLookId = (x: unknown): x is LookId => typeof x === 'string' && (LOOK_IDS as readonly string[]).includes(x);

export const eraOf = (id: LookId): Era => id.slice(0, id.indexOf('-')) as Era;
export const stepOf = (id: LookId): 1 | 2 | 3 => Number(id.slice(id.indexOf('-') + 1)) as 1 | 2 | 3;

/**
 * The tokens a look sets, by CSS custom property name (without the `--`). The issue's eight, and
 * the app tokens they map onto:
 *
 * | Issue's token  | App token(s)                                  | Used for                          |
 * |----------------|-----------------------------------------------|-----------------------------------|
 * | background     | `bg`, `page-texture`                          | the page behind everything        |
 * | panel          | `panel`, `sub`, `sub2`                        | boxes; cards and wells inside them |
 * | panel border   | `border`, `border2`                           | every box, card and track edge    |
 * | accent         | `gold`, `teal`                                | headings, numbers; eyebrows, hover |
 * | text           | `ink`                                         | body text                         |
 * | muted text     | `dim`, `faint`                                | secondary text; hints and meta    |
 * | icon plate     | `plate` (new)                                 | the slot behind an item icon      |
 * | ornament       | `ornament`, `grain` (new); `box-ornament`, `box-glow` | corner marks, textures, rims |
 *
 * The status colours (`green`, `warn`, `danger`, `ice`, `lilac`, `amber`) are in every look too:
 * they're text on panels, so a light paper look needs darker ones.
 *
 * `plate` is fully transparent in the paper looks (#1749): the icons' dark outlines read on paper by
 * themselves, and a tile behind them looked like a dirty square. The dark looks keep a faint plate,
 * because some icons (the fire steel, the sleeping bag) are drawn dark and would sink into slate.
 */
export const COLOR_TOKENS = [
  'bg', 'panel', 'sub', 'sub2', 'border', 'border2', 'ink', 'dim', 'faint', 'gold', 'teal',
  'amber', 'green', 'warn', 'danger', 'ice', 'lilac', 'plate', 'ornament', 'grain',
] as const;
/** Background images (gradients, or `none`): the page's texture and each box's ornament. */
export const IMAGE_TOKENS = ['page-texture', 'box-ornament'] as const;
/** A box-shadow list (or `none`): rims and glows on each box. */
export const SHADOW_TOKENS = ['box-glow'] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];
export type ImageToken = (typeof IMAGE_TOKENS)[number];
export type ShadowToken = (typeof SHADOW_TOKENS)[number];
export type LookTokens = Record<ColorToken | ImageToken | ShadowToken, string>;

export interface Look {
  /** `light` for paper looks: form controls and scrollbars follow. */
  scheme: 'light' | 'dark';
  tokens: LookTokens;
}

// ── Ornaments: gradients only, so they paint and never take up space ──────────
// Each is a full-size background layer, positioned by its own geometry (a gradient's angle, a
// radial gradient's `at`), so no background-size or position is needed, and the winter frost
// (style.css) can stack on top as one more layer.

/**
 * A rule across each corner, inside the 13 px rounded edge: a cartographer's corner mark. `double`
 * draws two rules, like the ring of a compass rose.
 */
const cornerRules = (double: boolean): string => {
  const rule = double
    ? 'transparent 0 7px, var(--ornament) 7px 8.5px, transparent 8.5px 11px, var(--ornament) 11px 12px, transparent 12px'
    : 'transparent 0 8px, var(--ornament) 8px 9.5px, transparent 9.5px';
  // 135deg starts at the top-left corner, 225deg the top-right, 315deg bottom-right, 45deg bottom-left.
  return [135, 225, 315, 45].map(a => `linear-gradient(${a}deg, ${rule})`).join(', ');
};

/** A rivet in each corner (steampunk): a small dot with a darker edge. */
const rivets = (): string =>
  ['9px 9px', 'calc(100% - 9px) 9px', 'calc(100% - 9px) calc(100% - 9px)', '9px calc(100% - 9px)']
    .map(at => `radial-gradient(circle at ${at}, var(--ornament) 0 2px, rgba(0,0,0,.45) 2.5px 3px, transparent 3.5px)`).join(', ');

/** Faint ruled lines, like a notebook page. */
const ruled = 'repeating-linear-gradient(0deg, transparent 0 27px, var(--grain) 27px 28px)';
/** A faint survey grid. */
const grid = 'repeating-linear-gradient(0deg, var(--grain) 0 1px, transparent 1px 56px), repeating-linear-gradient(90deg, var(--grain) 0 1px, transparent 1px 56px)';
/** Wood grain, running across the bench. */
const woodGrain = 'repeating-linear-gradient(0deg, var(--grain) 0 2px, transparent 2px 9px, var(--grain) 9px 10px, transparent 10px 17px)';
/** Slate: fine diagonal striation. */
const slate = 'repeating-linear-gradient(45deg, var(--grain) 0 1px, transparent 1px 7px)';
/**
 * Aged parchment (#1749): a few faint warm stains at fixed spots (so every page load looks the same),
 * a hint of fibre, and edges a shade darker, like an old map that has been handled. `rgb` is the stain
 * colour as `r,g,b`; `a` scales every layer, and all of it stays barely visible behind the text.
 */
const parchment = (rgb: string, a: number): string => {
  const c = (alpha: number): string => `rgba(${rgb},${+(alpha * a).toFixed(3)})`;
  return [
    // Fibre: fine, slightly slanted strands.
    `repeating-linear-gradient(97deg, ${c(0.012)} 0 1px, transparent 1px 5px)`,
    // Stains: large, soft and few.
    `radial-gradient(520px 340px at 18% 22%, ${c(0.05)}, transparent 70%)`,
    `radial-gradient(640px 420px at 82% 58%, ${c(0.04)}, transparent 70%)`,
    `radial-gradient(380px 260px at 46% 88%, ${c(0.045)}, transparent 70%)`,
    // The handled edges.
    `radial-gradient(ellipse 120% 100% at 50% 40%, transparent 55%, ${c(0.10)})`,
  ].join(', ');
};
/** A box's edges, a touch darker than its middle: the same wear, on each panel. */
const wornEdge = (rgb: string, alpha: number): string => `radial-gradient(farthest-corner at 50% 45%, transparent 62%, rgba(${rgb},${alpha}))`;

/** A soft light over the page, like the original dark look's two glows. */
const glow = (a: string, b: string): string => `radial-gradient(1100px 520px at 70% -10%, ${a}, transparent), radial-gradient(900px 500px at 10% 110%, ${b}, transparent)`;

/** The nine looks. Placeholders, readable (looks.test.ts checks AA contrast), refined by the era issues. */
export const LOOKS: Readonly<Record<LookId, Look>> = {
  // Field journal: pencil on aged paper, muted greens (#1749: a step darker and warmer than fresh cream).
  'scout-1': {
    scheme: 'light',
    tokens: {
      bg: '#e2d6bb', panel: '#efe5cd', sub: '#e8ddc3', sub2: '#ded1b4', border: '#c0ae8a', border2: '#a99672',
      ink: '#2a2219', dim: '#554838', faint: '#756550', gold: '#465b34', teal: '#3c5a4c',
      amber: '#7a5016', green: '#335f29', warn: '#864a0a', danger: '#9a2c24', ice: '#2c566e', lilac: '#5f4586',
      plate: 'rgba(0,0,0,0)', ornament: 'rgba(72,52,28,.30)', grain: 'rgba(80,56,26,.065)',
      'page-texture': `${ruled}, ${parchment('110,74,30', 1)}`,
      'box-ornament': `linear-gradient(90deg, transparent 0 7px, var(--grain) 7px 8px, transparent 8px), ${wornEdge('110,74,30', 0.05)}`,
      'box-glow': 'none',
    },
  },
  // Cartographer: inked lines, compass-rose corner marks, warmer, older paper.
  'scout-2': {
    scheme: 'light',
    tokens: {
      bg: '#e2cda5', panel: '#efdfbe', sub: '#e8d5b0', sub2: '#dfc8a0', border: '#a3855a', border2: '#876a42',
      ink: '#22180d', dim: '#54422c', faint: '#715b39', gold: '#6a3f10', teal: '#2a5252',
      amber: '#70470e', green: '#305c27', warn: '#784206', danger: '#93291f', ice: '#29526b', lilac: '#5a4181',
      plate: 'rgba(0,0,0,0)', ornament: 'rgba(70,45,20,.55)', grain: 'rgba(90,60,25,.07)',
      'page-texture': `${grid}, ${parchment('105,66,24', 1.1)}`,
      'box-ornament': `${cornerRules(true)}, ${wornEdge('105,66,24', 0.06)}`,
      'box-glow': 'none',
    },
  },
  // Surveyor: richer colour on tanned, leathery paper, the first hint of brass.
  'scout-3': {
    scheme: 'light',
    tokens: {
      bg: '#dbc59b', panel: '#ecd9b2', sub: '#e4cfa5', sub2: '#d9c294', border: '#9b7b4a', border2: '#806236',
      ink: '#1f160b', dim: '#513f29', faint: '#6c5633', gold: '#66440b', teal: '#205546',
      amber: '#6a430b', green: '#285622', warn: '#753f05', danger: '#872317', ice: '#22506a', lilac: '#563f7e',
      plate: 'rgba(0,0,0,0)', ornament: 'rgba(150,108,30,.70)', grain: 'rgba(110,80,25,.07)',
      'page-texture': `${grid}, ${parchment('100,62,20', 1.2)}`,
      'box-ornament': `${cornerRules(true)}, ${wornEdge('100,62,20', 0.07)}`,
      'box-glow': 'inset 0 1px 0 rgba(170,125,40,.35)',
    },
  },
  // Tinkerer's bench: dark wood, the first copper.
  'steampunk-1': {
    scheme: 'dark',
    tokens: {
      bg: '#1d1510', panel: '#2a1f17', sub: '#241a13', sub2: '#1c140e', border: '#4b3727', border2: '#5e4532',
      ink: '#f0e4d2', dim: '#bba78d', faint: '#94806a', gold: '#e09460', teal: '#d2ac74',
      amber: '#d69a3a', green: '#9fd082', warn: '#f2a64a', danger: '#ff7a68', ice: '#a6d3e0', lilac: '#cdb8f2',
      plate: '#3b2b1f', ornament: 'rgba(224,148,96,.40)', grain: 'rgba(255,220,180,.025)',
      'page-texture': woodGrain,
      'box-ornament': 'none',
      'box-glow': 'inset 0 1px 0 rgba(224,148,96,.28)',
    },
  },
  // Brass engine: brass rims, rivets, gauges.
  'steampunk-2': {
    scheme: 'dark',
    tokens: {
      bg: '#1a1611', panel: '#27211a', sub: '#211c16', sub2: '#1a1611', border: '#6a5733', border2: '#80693c',
      ink: '#f2e8d4', dim: '#c0ad8c', faint: '#988567', gold: '#e6c050', teal: '#e09460',
      amber: '#d9a03c', green: '#a3d184', warn: '#f2a64a', danger: '#ff7a68', ice: '#a6d3e0', lilac: '#cdb8f2',
      plate: '#3a3122', ornament: 'rgba(230,192,80,.75)', grain: 'rgba(255,230,170,.025)',
      'page-texture': glow('rgba(230,192,80,.06)', 'rgba(224,148,96,.05)'),
      'box-ornament': rivets(),
      'box-glow': 'inset 0 0 0 1px rgba(230,192,80,.16), 0 2px 0 rgba(0,0,0,.35)',
    },
  },
  // Soot and steam: darker, a faint rune glint (the next era, foreshadowed).
  'steampunk-3': {
    scheme: 'dark',
    tokens: {
      bg: '#111010', panel: '#1c1a18', sub: '#181614', sub2: '#121110', border: '#3d3730', border2: '#4d453b',
      ink: '#ece6dc', dim: '#b2a998', faint: '#8a8173', gold: '#d2ad4e', teal: '#86cfcf',
      amber: '#cf9a3e', green: '#9ccc80', warn: '#eda24a', danger: '#ff7766', ice: '#a2d4e2', lilac: '#c8b6f0',
      plate: '#2e2a25', ornament: 'rgba(210,173,78,.45)', grain: 'rgba(134,207,207,.06)',
      'page-texture': glow('rgba(200,200,200,.05)', 'rgba(134,207,207,.04)'),
      'box-ornament': `linear-gradient(180deg, rgba(0,0,0,.22), transparent 45%), radial-gradient(160px 60px at 100% 0, var(--grain), transparent), ${rivets()}`,
      'box-glow': 'inset 0 0 0 1px rgba(210,173,78,.08)',
    },
  },
  // Etched slate: runes carved, not lit.
  'rune-1': {
    scheme: 'dark',
    tokens: {
      bg: '#15181c', panel: '#20252b', sub: '#1b1f24', sub2: '#16191e', border: '#363d46', border2: '#444c57',
      ink: '#e6e9ec', dim: '#a6aeb8', faint: '#7f8893', gold: '#c2ccd6', teal: '#9db0c2',
      amber: '#c9a05a', green: '#9cc98e', warn: '#e8a65a', danger: '#f27a70', ice: '#a9cde0', lilac: '#c4b8e6',
      plate: '#2c323a', ornament: 'rgba(180,195,210,.30)', grain: 'rgba(200,210,220,.025)',
      'page-texture': slate,
      'box-ornament': cornerRules(false),
      'box-glow': 'inset 0 1px 0 rgba(0,0,0,.4)',
    },
  },
  // Waking runes: cyan glow in the edges.
  'rune-2': {
    scheme: 'dark',
    tokens: {
      bg: '#10141a', panel: '#1a2029', sub: '#161b23', sub2: '#12161d', border: '#2c4352', border2: '#355466',
      ink: '#e8eef2', dim: '#a5b2bd', faint: '#7d8b97', gold: '#7fe0f0', teal: '#56d0ea',
      amber: '#d0a258', green: '#94dca0', warn: '#f0a85a', danger: '#ff7a74', ice: '#a8dcf0', lilac: '#c6b8f4',
      plate: '#24303c', ornament: 'rgba(86,208,234,.45)', grain: 'rgba(86,208,234,.03)',
      'page-texture': `${glow('rgba(86,208,234,.06)', 'rgba(86,208,234,.03)')}, ${slate}`,
      'box-ornament': cornerRules(false),
      'box-glow': 'inset 0 0 12px rgba(86,208,234,.10), 0 0 0 1px rgba(86,208,234,.05)',
    },
  },
  // Full rune tech: violet and cyan glow on dark.
  'rune-3': {
    scheme: 'dark',
    tokens: {
      bg: '#0d0e1a', panel: '#1a1c2e', sub: '#151628', sub2: '#12131f', border: '#33305a', border2: '#423d70',
      ink: '#f0f0f6', dim: '#a8a6c6', faint: '#7f7da0', gold: '#cdb2ff', teal: '#4dd4f0',
      amber: '#d6a050', green: '#8ff0a0', warn: '#ffaa44', danger: '#ff6a6a', ice: '#9fd8ff', lilac: '#d6c4ff',
      plate: '#26284a', ornament: 'rgba(160,120,255,.55)', grain: 'rgba(77,212,240,.04)',
      'page-texture': glow('rgba(140,100,255,.09)', 'rgba(77,212,240,.06)'),
      'box-ornament': `${cornerRules(true)}, radial-gradient(240px 90px at 0 0, var(--grain), transparent)`,
      'box-glow': '0 0 16px rgba(140,100,255,.14), inset 0 0 12px rgba(77,212,240,.07)',
    },
  },
};

// ── Which look is on ────────────────────────────────────────────────────────

/**
 * The look the game is in, from its state: the one hook point for #1723 (triggers: brass appears
 * with the first brass part, runes glow when the first rune works). Until then every game is in
 * the field journal. Read when the page is drawn, never stored: the sim, the save and the run log
 * don't know looks exist.
 */
export function lookOfGame(_game: Readonly<AppState>): LookId {
  return 'scout-1';
}

/** The look on screen: a dev preview if there is one, else the game's own. */
export const shownLook = (game: LookId, preview: LookId | null): LookId => preview ?? game;

// ── The look switcher (#1736): temporary, for reviewing era looks ─────────────
// A small control in the header that anyone can use to show any of the nine looks, while the dev
// password isn't deployed. It's the `look-switcher` ui feature (features.ts): switch it off there, or
// delete the feature, this block and `lookSwitcher` in main.ts, once #1723 decides the look from the game.

/** The ui feature that shows the switcher. */
export const LOOK_SWITCHER_FEATURE = 'look-switcher';

/** Where the viewer's chosen look is kept: this browser only, never the save. */
const LOOK_KEY = 'artificer.look';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storage = (): Store | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** The look this viewer chose with the switcher, or null for the game's own (none kept, junk, or storage refused). */
export function loadLookChoice(store: Store | null = storage()): LookId | null {
  try {
    const v = store?.getItem(LOOK_KEY);
    return isLookId(v) ? v : null;
  } catch {
    return null;
  }
}

/** Keep the viewer's choice; null forgets it, so the game's look shows again. */
export function saveLookChoice(id: LookId | null, store: Store | null = storage()): void {
  try {
    if (id) store?.setItem(LOOK_KEY, id);
    else store?.removeItem(LOOK_KEY);
  } catch {
    // Not remembered; the choice still holds until the page reloads.
  }
}

/**
 * The switcher's previous/next: round the ring "the game's look" (null), scout-1 … rune-3, and back.
 */
export function stepLook(current: LookId | null, dir: 1 | -1): LookId | null {
  const ring: (LookId | null)[] = [null, ...LOOK_IDS];
  const i = ring.indexOf(current);
  return ring[(i + dir + ring.length) % ring.length];
}

/**
 * A preview asked for in the address: `?look=rune-2`. Honoured only where `allowed` (dev mode, or a
 * local dev server, for screenshots); anything else, or a look that doesn't exist, is no preview.
 */
export function lookFromQuery(search: string, allowed: boolean): LookId | null {
  if (!allowed) return null;
  const v = new URLSearchParams(search).get('look');
  return isLookId(v) ? v : null;
}

// ── The CSS ─────────────────────────────────────────────────────────────────

/** How long a look change cross-fades. `prefers-reduced-motion` makes it instant. */
export const FADE_MS = 1000;

/**
 * The looks as CSS:
 * - `@property` registers each colour token as a `<color>`, so a change can be animated (an
 *   unregistered custom property is just text and would jump);
 * - one `:root[data-look="…"]` block per look, setting every token;
 * - the cross-fade, only once `data-look-fade` is on `<html>` (the page adds it after the first
 *   look is shown, so a page load doesn't fade in from the old dark look), and never with reduced motion.
 *
 * The defaults (`initial-value`) are style.css's own `:root` values: the page without a look (the
 * records page, the console) keeps them.
 */
export function looksCss(looks: Readonly<Record<LookId, Look>> = LOOKS, defaults: Readonly<Partial<Record<ColorToken, string>>> = DEFAULT_COLORS): string {
  const props = COLOR_TOKENS.map(n => `@property --${n} { syntax: '<color>'; inherits: true; initial-value: ${defaults[n] ?? 'transparent'}; }`);
  const blocks = LOOK_IDS.map(id => {
    const l = looks[id];
    const decls = (Object.keys(l.tokens) as (keyof LookTokens)[]).map(k => `--${k}: ${l.tokens[k]};`);
    return `:root[data-look="${id}"] { color-scheme: ${l.scheme}; ${decls.join(' ')} }`;
  });
  // The opening (the language picker and the intro, `.intro`) is its own dark night sky whatever the
  // era: it keeps the default colours, so its light text stays light on a paper look.
  const night = `:root[data-look] .intro { color-scheme: dark; ${COLOR_TOKENS.filter(n => defaults[n]).map(n => `--${n}: ${defaults[n]};`).join(' ')} }`;
  const fade = `:root[data-look-fade] { transition: ${COLOR_TOKENS.map(n => `--${n} ${FADE_MS}ms ease`).join(', ')}; }`;
  const still = '@media (prefers-reduced-motion: reduce) { :root[data-look-fade] { transition: none; } }';
  return [...props, ...blocks, night, fade, still].join('\n');
}

/** style.css's `:root` colours, the page's look before (or without) a look. */
const DEFAULT_COLORS: Readonly<Partial<Record<ColorToken, string>>> = {
  bg: '#0d0e1a', panel: '#1a1c2e', sub: '#151628', sub2: '#12131f', border: '#2a2c3e', border2: '#33344a',
  ink: '#f0f0e8', dim: '#9aa0b4', faint: '#5c6076', gold: '#ffe066', teal: '#4dd4f0', amber: '#c8922a',
  green: '#88ff88', warn: '#ffaa33', danger: '#ff5a5a', ice: '#9fd8ff', lilac: '#c9b4ff',
  plate: '#22243a', ornament: 'rgba(159,216,255,.18)', grain: 'rgba(159,216,255,.03)',
};

/** Put the looks' CSS in the page, once. */
export function installLooks(doc: Document = document): void {
  if (doc.getElementById('artificer-looks')) return;
  const el = doc.createElement('style');
  el.id = 'artificer-looks';
  el.textContent = looksCss();
  doc.head.appendChild(el);
}

/**
 * Show a look: its id on `<html>`. The first call shows it at once; after that a change cross-fades
 * (`data-look-fade` goes on two frames later, once the first look has been painted).
 */
export function applyLook(id: LookId, doc: Document = document): void {
  const html = doc.documentElement;
  if (html.dataset.look === id) return;
  const first = !html.dataset.look;
  html.dataset.look = id;
  if (first) requestAnimationFrame(() => requestAnimationFrame(() => { html.dataset.lookFade = ''; }));
}

// ── Contrast (WCAG 2.x), for the tests and for whoever tunes the values ───────

/** `#rgb` or `#rrggbb` as 0–255 channels; null for anything else (an rgba, a name). */
export function hexRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1];
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Relative luminance (WCAG 2.x). */
export function luminance([r, g, b]: readonly [number, number, number]): number {
  const lin = (c: number): number => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The contrast ratio of two opaque hex colours, 1–21. AA body text needs 4.5. */
export function contrast(a: string, b: string): number {
  const x = hexRgb(a), y = hexRgb(b);
  if (!x || !y) throw new Error(`contrast needs opaque hex colours: ${a}, ${b}`);
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}
