/**
 * The owner's content decisions, kept as tests so they change on purpose, not by drift.
 *
 * #1523 (2026-10-10): "Just use raw meat, for now. Let's keep it simple; we can diversify later.
 * Same for items and resources. Let's try to polish the mechanics before expanding too much."
 * When it's time to diversify, change the expectation here along with the registry.
 */

import { describe, it, expect } from 'vitest';
import itemRegistry from '../../macro-world/item-registry.json';

const items = itemRegistry.items as { id: string; name: string; category: string }[];

describe('Content scope (#1523)', () => {
  it('has one raw meat item, raw-meat, and no game-meat', () => {
    const rawMeats = items.filter(i => i.category === 'raw' && /meat/i.test(`${i.id} ${i.name}`)).map(i => i.id);
    expect(rawMeats).toEqual(['raw-meat']);
    expect(items.some(i => i.id === 'game-meat')).toBe(false);
  });
});
