/**
 * Item icons in the app (#1675): `iconFor` finds an item's 32 px icon from the art briefs, or null,
 * and `itemIcon` draws it (or the fallback). Pure, no DOM: it only builds strings.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import briefsFile from '../artificer/content/art-briefs.json';
import { iconFor, itemIcon, ICON_SIZE } from './item-icons';

const publicFile = (url: string): string => join(__dirname, '..', '..', 'public', url);

describe('iconFor (#1675)', () => {
  it('gives known items a path that exists on disk', () => {
    for (const id of ['water', 'rawFood', 'materials', 'hides', 'stone-knife', 'mora-knife', 'sleeping-bag']) {
      const url = iconFor(id);
      expect(url, id).toMatch(/^\/assets\/sprites\/icons\/items\/.+\.png$/);
      expect(existsSync(publicFile(url!)), `${id}: ${url}`).toBe(true);
    }
  });

  it('returns null for an item with no icon', () => {
    expect(iconFor('no-such-item')).toBeNull();
    expect(iconFor('')).toBeNull();
    // Not fooled by Object.prototype's keys.
    expect(iconFor('constructor')).toBeNull();
    expect(iconFor('toString')).toBeNull();
  });

  it('finds every icon the art briefs name, and each one exists', () => {
    for (const [id, b] of Object.entries(briefsFile.items as Record<string, { icon?: string }>)) {
      if (!b.icon) { expect(iconFor(id), id).toBeNull(); continue; }
      expect(iconFor(id), id).toBe(b.icon);
      expect(existsSync(publicFile(b.icon)), `${id}: ${b.icon}`).toBe(true);
    }
  });

  it('names each icon whole, so the Artificer build finds and ships it', () => {
    // scripts/build-artificer.mjs copies only the public/ files its sources (src/artificer/**, .ts
    // and .json) name as whole quoted "/assets/…" strings; this is its pattern. The briefs file
    // lives under src/artificer/, so an icon written whole there is copied into artificer/dist/.
    const raw = readFileSync(join(__dirname, '..', 'artificer', 'content', 'art-briefs.json'), 'utf8');
    const scanned = new Set([...raw.matchAll(/['"`](\/assets\/[^'"`$]+\.(?:png|jpg|webp|svg|gif|json|ogg|mp3))['"`]/g)].map(m => m[1]));
    for (const b of Object.values(briefsFile.items as Record<string, { icon?: string }>)) {
      if (b.icon) expect(scanned.has(b.icon), b.icon).toBe(true);
    }
  });
});

describe('itemIcon (#1675)', () => {
  it('draws a fixed-size img with empty alt by default (the name is printed beside it)', () => {
    const html = itemIcon('water');
    expect(html).toContain(`src="${iconFor('water')}"`);
    expect(html).toContain(`width="${ICON_SIZE}" height="${ICON_SIZE}"`);
    expect(html).toContain('alt=""');
    expect(html).toContain('class="iicon"');
  });

  it('uses the alt it is given where the icon stands alone', () => {
    expect(itemIcon('water', { alt: 'Water' })).toContain('alt="Water"');
    expect(itemIcon('water', { alt: '"x"' })).toContain('alt="&#34;x&#34;"');
  });

  it('falls back to the emoji or text when an item has no icon', () => {
    expect(itemIcon('no-such-item', { fallback: '🧺' })).toBe('🧺');
    expect(itemIcon('no-such-item')).toBe('');
  });
});
