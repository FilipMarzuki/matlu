import { describe, expect, it } from 'vitest';
import { duplicateKeys } from './index';
import { enAreas } from './en';
import { svAreas } from './sv';

// #1714: the catalogs are area files spread into one object, so a key two areas define keeps only
// the later one. The road's `end.died` hid the camp's that way; nothing may do it again.

describe('no key is defined in two area files (#1714)', () => {
  it('finds a planted duplicate', () => {
    const camp = { 'end.died': 'THE REACH TAKES YOU', 'end.grim': 'A GRIM WINTER' };
    const road = { 'end.died': 'The road was one hardship too many.' };
    const map = { 'map.title': 'THE MAP' };
    expect(duplicateKeys({ camp, road, map })).toEqual([{ key: 'end.died', areas: ['camp', 'road'] }]);
    expect(duplicateKeys({ camp, map })).toEqual([]);
  });

  it('has none in English', () => {
    expect(duplicateKeys(enAreas)).toEqual([]);
  });

  it('has none in Swedish', () => {
    expect(duplicateKeys(svAreas)).toEqual([]);
  });
});
