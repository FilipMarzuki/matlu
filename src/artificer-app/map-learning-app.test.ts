/**
 * #1754 on the page: the Draw your map action, the LAND tab's way into the session, and the
 * session itself (a list of finds, a blank grid, hints), in both languages. The Swedish has no
 * English left in it; the English of what the map still needs is the sim's own, word for word.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { createRegion1, runAction, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { createExploration, scout, survey } from '../artificer/exploration';
import { SUGGESTED_PACK } from '../artificer/kit';
import { MAP_LEARNING, MAP_NIGHTS, GRID, CENTRE, NEW_SESSION, mapPlaces, mapUnlockNeedTexts, placeOn, trueCell, judgePlacement, placementTolerance, type Hint } from '../artificer/map-learning';
import { mapSessionModal, mapSessionInvite, newSessionUi, hintText } from './map-session-view';
import { landTab } from './land-view';
import { paletteBlock, GROUPS } from './camp-blocks';
import { mapNeedsText, simLine } from './sim-words';
import { previewQueue, makeWarden, type AppState } from './controller';
import { viewText } from '../artificer-play/view-words';

const sv = makeT('sv');
const en = makeT('en');

const ENGLISH_RE = /(?<![\p{L}])(the|you|your|and|with|of|not|yet|first|about|minutes|north|south|east|west|camp|map|place|placed|stream|ground|wood|draw|later|tap|square|found)(?![\p{L}])/giu;
const shown = (html: string): string => html.replace(/\bdata-[\w-]+="[^"]*"/g, '').replace(/\b(class|style|role|id|tabindex|aria-[\w-]+)="[^"]*"/g, (m, k) => (k === 'aria-label' ? m.replace(/^aria-label="|"$/g, ' ') : '')).replace(/<[^>]*>/g, ' ');
const englishIn = (html: string): string[] => [...shown(html).matchAll(ENGLISH_RE)].map(m => m[0]);

const FEATURES = { 'descriptive-map': true, [MAP_LEARNING]: true, 'camp-as-action': true, 'distance-not-rings': true };
function ready(day = MAP_NIGHTS + 1): Region1State {
  const s = createRegion1({ world: { ...FULL_WORLD, encounters: false, features: FEATURES } }, undefined, { id: 'w-astrid', pack: [...SUGGESTED_PACK, 'notebook'] });
  return { ...s, day, explore: scout(survey(createExploration(), 1), 2) };
}
const app = (sim: Region1State): AppState => ({ ...makeWarden({ id: 'w-astrid' }), sim, queue: [] });

describe('Drawing your map on the page (#1754)', () => {
  it('the action sits with the thinking work, opens with the session, and is greyed with why before', () => {
    expect(GROUPS.find(g => g.key === 'think')?.ids).toContain('drawmap');
    const open = paletteBlock(app(ready()), previewQueue(app(ready())), { ring: 1, dev: false, t: sv });
    expect(open).toContain('data-q="drawmap"');
    expect(open).toContain('RITA DIN KARTA');
    const shut = paletteBlock(app(ready(2)), previewQueue(app(ready(2))), { ring: 1, dev: false, t: sv });
    expect(shut).toMatch(/class="act soft [^"]*" data-q="drawmap"/);
    expect(shut).toContain('inte än');
  });

  it('the LAND tab says what the map still needs, then offers the session; the English is the sim\'s', () => {
    const shut = ready(2);
    expect(mapNeedsText(shut, en)).toBe(mapUnlockNeedTexts(shut).join(' and '));
    const tab = landTab(shut, en);
    expect(tab).toContain(`a few nights here first (${MAP_NIGHTS}; 1 so far)`);
    expect(tab).not.toContain('data-cmd="mapsession"');
    expect(englishIn(landTab(shut, sv))).toEqual([]);
    const open = landTab(ready(), sv);
    expect(open).toContain('data-cmd="mapsession"');
    expect(open).toContain(mapSessionInvite(sv));
    expect(englishIn(open)).toEqual([]);
    // Once drawn the session isn't offered again, and the drawn map is at the top.
    expect(landTab({ ...ready(), mapLearned: true }, en)).not.toContain('data-cmd="mapsession"');
  });

  it('the session: every place in the list, an 11 × 11 grid with camp in the middle, in both languages', () => {
    const s = ready();
    const places = mapPlaces(s);
    for (const t of [en, sv]) {
      const html = mapSessionModal(s, newSessionUi(NEW_SESSION), t);
      for (const p of places) expect(html).toContain(`data-mapsel="${p.id}"`);
      expect(html.match(/data-mapcell="/g)).toHaveLength(GRID * GRID);
      expect(html).toContain(`data-mapcell="${CENTRE},${CENTRE}" tabindex="0"`);
      expect(html.match(/tabindex="0"/g)).toHaveLength(1);
      expect(html).toContain('role="dialog"');
      expect(html).not.toContain('data-cmd="mapdraw"');
    }
    expect(englishIn(mapSessionModal(s, newSessionUi(NEW_SESSION), sv))).toEqual([]);
    expect(mapSessionModal(s, null, en)).toBe('');
    // Everything placed: "Draw it" queues the action.
    const done = places.reduce((acc, p) => placeOn(s, acc, p.id, trueCell(p)).session, NEW_SESSION);
    const html = mapSessionModal(s, newSessionUi(done), sv);
    expect(html).toContain('data-cmd="mapdraw"');
    expect(html).toContain('RITA DEN (2 h)');
    expect(englishIn(html)).toEqual([]);
  });

  it('a wrong placement gets a hint from what the Warden knows, in both languages', () => {
    const s = ready();
    const tol = placementTolerance(s);
    const p = mapPlaces(s).find(q => q.kind === 'stream')!;
    const t0 = trueCell(p);
    const opposite = { x: 2 * CENTRE - t0.x, y: 2 * CENTRE - t0.y };
    const j = judgePlacement(p, opposite, tol);
    expect(j.ok).toBe(false);
    const hint = (j as { hint: Hint }).hint;
    expect(hintText(hint, p, en)).toMatch(/^Not there: the stream was due \w+ of camp, not due \w+\.$/);
    expect(englishIn(hintText(hint, p, sv))).toEqual([]);
    const html = mapSessionModal(s, { ...newSessionUi(NEW_SESSION), selected: p.id, note: { kind: 'hint', hint } }, sv);
    expect(html).toContain(hintText(hint, p, sv));
    // The distance hint, and the sharp Warden's.
    expect(hintText({ ...hint, dirWrong: false, distance: 'further' }, p, en)).toMatch(/^The stream is further from camp than that: about \d+ minutes\.$/);
    expect(hintText({ ...hint, full: true }, p, en)).toMatch(/^Not quite\. You remember the stream clearly: due \w+, about \d+ minutes\.$/);
  });

  it('the journal\'s lines from drawing (and from trying too soon) read in Swedish with no English', () => {
    const drawn = runAction(ready(), 'drawmap');
    const tooSoon = runAction(ready(2), 'drawmap');
    const lines = [...drawn.log.slice(ready().log.length), ...tooSoon.log.slice(ready(2).log.length)].map(l => l.text);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const l of lines) expect(englishIn(simLine(l, sv)), l).toEqual([]);
  });

  it('the play API\'s text view offers the action as a move once it\'s open', () => {
    const a = app(ready());
    expect(viewText(a, 'day', en)).toMatch(/do: drawmap/);
  });
});
