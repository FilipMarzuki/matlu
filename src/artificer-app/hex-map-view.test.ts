/**
 * The drawn hex overview and current-hex cell map (#1903, hex world step 10 of 17, #1873), on the
 * LAND tab: map-view.ts's `hexOverviewBlock`, `hexCellMapBlock` and `hexDrawnMapBlock`, and
 * land-view.ts's "Further off" fold. A visual/exploration issue (ui-hud): these are smoke tests
 * that the pieces wire together and read right in both languages, not acceptance tests.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { ruleFeatures } from '../artificer/features';
import { HEX_WORLD, landOfRun, toWorld } from '../artificer/world/hex-window';
import { hexOfCell, hexKey, type Hex } from '../../worldmap/coords';
import { makeT } from '../artificer/i18n';
import { hexDrawnMapBlock, hexOverviewBlock, hexCellMapBlock } from './map-view';
import { landTab } from './land-view';

const en = makeT('en');
const sv = makeT('sv');

const runWith = (id: string): Region1State =>
  createRegion1({ world: { ...FULL_WORLD, features: { ...ruleFeatures(), [HEX_WORLD]: true } } }, undefined, { id });

/** The hex the run's camp sits in, found the same way hex-words.ts's `furtherOff` does. */
function campHexOf(s: Region1State): Hex {
  const land = landOfRun(s);
  return hexOfCell(toWorld(land, land.camp.x, land.camp.y));
}

describe('The drawn hex map (#1903)', () => {
  it('before a map is made: no overview or cell map, only "Further off" once a hex is known', () => {
    const s = runWith('w-hexmap-1');
    const target: Hex = { q: campHexOf(s).q, r: campHexOf(s).r + 1 };
    s.heardHexes = [hexKey(target)];
    const tab = landTab(s, en);
    expect(tab).not.toContain('hexoverview');
    expect(tab).toContain('Further off:');
  });

  it('with hex-world off: no "Further off", and the old drawn map once learned, unchanged', () => {
    const s = createRegion1({ world: { ...FULL_WORLD, features: { ...ruleFeatures(), [HEX_WORLD]: false } } }, undefined, { id: 'w-hexmap-2' });
    const tab = landTab({ ...s, mapLearned: true }, en);
    expect(tab).not.toContain('Further off');
    expect(tab).not.toContain('hexoverview');
    expect(tab).not.toContain('data-hex=');
  });

  it('once the map is learned: the overview marks your own hex @, and the cell map draws its ground', () => {
    const s = runWith('w-hexmap-3');
    const html = hexDrawnMapBlock({ ...s, mapLearned: true }, en);
    expect(html).toContain('hexoverview');
    expect(html).toContain('m-camp');
    expect(html.match(/<pre class="reachmap[^>]*>/g)).toHaveLength(2);
  });

  it('tapping a hex "Further off" knows of shows its name and that line, in the viewer\'s language', () => {
    const s = runWith('w-hexmap-4');
    const target: Hex = { q: campHexOf(s).q, r: campHexOf(s).r + 1 };
    s.heardHexes = [hexKey(target)];
    const drawn: Region1State = { ...s, mapLearned: true };
    const html = hexOverviewBlock(drawn, en, { hex: { q: target.q, r: target.r } }, 'en');
    expect(html).toContain(`data-hex="${target.q},${target.r}"`);
    expect(html).toMatch(/<p class="mapinfo"><b>[^<]+<\/b><\/p>/);
    expect(html).toContain('heard of');
  });

  it('a hex nothing is known of shows no tap target, and the untapped overview invites a tap', () => {
    const s = runWith('w-hexmap-5');
    const html = hexOverviewBlock({ ...s, mapLearned: true }, en);
    expect(html).toContain('Tap a hex to see what');
  });

  it('the current hex\'s cell map has some fog (a neighbouring hex\'s unseen corner) around the camp it marks', () => {
    const s = runWith('w-hexmap-6');
    const html = hexCellMapBlock({ ...s, mapLearned: true }, en);
    expect(html).toContain('m-camp');
    expect(html).toContain('m-fog');
  });

  it('the overview and "Further off" read in Swedish, with Swedish words for "heard of" and the fold\'s title', () => {
    const s = runWith('w-hexmap-7');
    const target: Hex = { q: campHexOf(s).q, r: campHexOf(s).r + 1 };
    s.heardHexes = [hexKey(target)];
    const overview = hexOverviewBlock({ ...s, mapLearned: true }, sv, { hex: { q: target.q, r: target.r } }, 'sv');
    expect(overview).toContain('hört talas om');
    const tab = landTab(s, sv);
    expect(tab).toContain('Längre bort:');
  });
});
