/**
 * Item icons in the app (#1675, epic #1672): the 32 px pixel-art icon for an item id, read from the
 * art briefs (`src/artificer/content/art-briefs.json`, each brief's `icon`), and the `<img>` that
 * shows it, or the old emoji/text when an item has no icon yet.
 *
 * Presentation only: nothing here touches the sim. The briefs file is the one place an icon is
 * recorded (docs/art-pipeline.md, step 5), so a newly burnt icon shows up here with no second list.
 *
 * How the icons reach production: the Artificer's own build (scripts/build-artificer.mjs) doesn't
 * copy public/ wholesale; it scans the Artificer's .ts and .json sources for "/assets/…" strings
 * and copies those files. The briefs file is one of those sources, so every icon it names ships.
 */

import briefs from '../artificer/content/art-briefs.json';

/** The icons are drawn at 32 px; shown at exactly that size so every art pixel is one CSS pixel. */
export const ICON_SIZE = 32;

const ICONS: Readonly<Record<string, string | undefined>> = Object.fromEntries(
  Object.entries(briefs.items as Record<string, { icon?: string }>).flatMap(([id, b]) => (b.icon ? [[id, b.icon]] : [])),
);

/** The icon URL for an item id (e.g. "/assets/sprites/icons/items/bedroll.png"), or null when it has none yet. */
export function iconFor(id: string): string | null {
  // hasOwn, not ICONS[id]: an id like "constructor" mustn't find Object.prototype's.
  return Object.hasOwn(ICONS, id) ? ICONS[id] ?? null : null;
}

const esc = (t: string): string => t.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/**
 * The icon as HTML, or `fallback` (today's emoji, or '' for text-only places) when there's none.
 *
 * `alt` is '' by default: almost everywhere the item's name is printed right beside the icon, so
 * the picture is decorative and a screen reader should read the name once, not "Water, water".
 * Pass the name as `alt` where the icon stands alone (the compact status bar).
 *
 * width/height attributes and the `.iicon` box reserve the space before the PNG arrives, so
 * nothing jumps as icons load (no layout shift); `image-rendering: pixelated` in style.css keeps
 * the pixels crisp.
 */
export function itemIcon(id: string, opts: { alt?: string; fallback?: string } = {}): string {
  const url = iconFor(id);
  if (!url) return opts.fallback ?? '';
  return `<img class="iicon" src="${esc(url)}" width="${ICON_SIZE}" height="${ICON_SIZE}" alt="${esc(opts.alt ?? '')}" decoding="async">`;
}
