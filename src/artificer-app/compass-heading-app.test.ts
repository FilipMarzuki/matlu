/**
 * #1868 on the page, for the AI and through the API: with nothing to keep a heading by, Explore's
 * compass greys its eight ways and says what's missing; the needle compass is a card of its own;
 * everything new reads in Swedish as well as English; and the needle compass survives a save (and is
 * dropped with the switch off).
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { createRegion1, runAction, type Region1State } from '../artificer/region1';
import { FULL_WORLD, type WeatherId } from '../artificer/world';
import { ruleFeatures } from '../artificer/features';
import type { KitId } from '../artificer/kit';
import { COMPASS_HEADING, headingLock } from '../artificer/compass-heading';
import { DIRS } from '../artificer/directed-explore';
import { observe } from '../artificer-ai/observe';
import { viewText } from '../artificer-play/view-words';
import { compassBlock, paletteBlock } from './camp-blocks';
import { previewQueue, makeWarden, serialize, deserialize, type AppState } from './controller';
import { simLine } from './sim-words';

const enT = makeT('en');
const sv = makeT('sv');

const warden = (o: { pack?: KitId[]; weather?: WeatherId; on?: boolean; id?: string } = {}): Region1State => {
  const features = { ...ruleFeatures(), [COMPASS_HEADING]: o.on ?? true };
  return createRegion1({ world: { ...FULL_WORLD, encounters: false, luck: false, accidents: false, darkness: false, weather: o.weather ?? 'overcast', features } }, undefined, { id: o.id ?? 'w-astrid', ...(o.pack ? { pack: o.pack } : {}) });
};
const app = (sim: Region1State): AppState => ({ ...makeWarden({ id: sim.character.id }), sim, queue: [] });
const palette = (sim: Region1State, t = enT): string => {
  const a = app(sim);
  return paletteBlock(a, previewQueue(a), { dev: false, t, chooser: 'explore' });
};

describe('#1868 keeping a heading, on the page', () => {
  it('greys the eight ways when nothing keeps a heading, and says what’s missing', () => {
    const s = warden({ pack: ['sewing-kit'] });
    const html = compassBlock(s, 'here', enT);
    for (const d of DIRS) expect(html).toMatch(new RegExp(`class="cpb locked" data-way="${d}"[^>]*disabled`));
    expect(html).not.toMatch(/data-way="here"[^>]*disabled/);
    expect(html).toContain('class="cpnote"');
    expect(html).toContain('you need something to keep a heading: a compass, or a needle you can magnetise — you have the needle from your sewing kit (Make a needle compass); on a clear day the sun can do');
    // In Swedish, the same note in Swedish.
    const sw = compassBlock(s, 'here', sv);
    expect(sw).toContain('du behöver något att hålla kursen med');
    expect(sw).toContain('nålen ur ditt sykit');
    // With the compass packed, or on a sunny day, nothing is greyed.
    for (const open of [warden({ pack: ['map-compass'] }), warden({ weather: 'clear' })]) {
      const ok = compassBlock(open, 'here', enT);
      expect(ok).not.toContain('locked');
      expect(ok).not.toContain('cpnote');
    }
    // The chooser in the palette carries it.
    expect(palette(s)).toContain('class="compass nohead"');
  });

  it('shows Make a needle compass as a card, and its words in Swedish', () => {
    const s = warden({ pack: ['sewing-kit', 'hat-mittens'] });
    expect(palette(s)).toContain('data-q="needlecompass"');
    expect(palette(s, sv)).toContain('GÖR EN NÅLKOMPASS');
    // Hidden with the compass packed, or the switch off.
    expect(palette(warden({ pack: ['map-compass', 'sewing-kit'] }))).not.toContain('data-q="needlecompass"');
    expect(palette(warden({ on: false, pack: ['sewing-kit'] }))).not.toContain('data-q="needlecompass"');
  });

  it('says the refusals and the journal’s new lines in Swedish', () => {
    const reasons = [
      headingLock(warden({ pack: ['sewing-kit'] }))!,
      headingLock(warden({ pack: [] }))!,
      headingLock({ ...warden({ pack: ['sewing-kit'] }), needleCompass: { made: 1, tool: 'needle' }, day: 9 })!,
    ];
    const made = runAction(warden({ pack: ['sewing-kit', 'hat-mittens', 'kasa'] }), 'needlecompass');
    const refreshed = runAction({ ...made, day: 9 }, 'needlecompass');
    const sunny = runAction(warden({ weather: 'clear' }), { q: 'explore', opts: { way: 'n' } });
    const skipped = runAction(warden({ pack: ['sewing-kit'] }), { q: 'explore', opts: { way: 'n' } });
    const tooSoon = runAction(made, 'needlecompass');
    // A drifted trip: the needle's line and the shadow's.
    const drift = (sun: boolean): string | undefined => {
      for (let i = 0; i < 60; i++) {
        const base = warden({ id: `w-sv-${i}`, weather: sun ? 'clear' : 'overcast' });
        const s = sun ? base : { ...base, needleCompass: { made: 1, tool: 'needle' as const } };
        const l = runAction(s, { q: 'explore', opts: { way: 'e' } }).log.find(x => /^The (needle wandered|shadow line was rough)/.test(x.text));
        if (l) return l.text;
      }
      return undefined;
    };
    const lines = [
      ...reasons,
      made.log.at(-1)!.text, refreshed.log.at(-1)!.text, skipped.log.at(-1)!.text, tooSoon.log.at(-1)!.text,
      sunny.log.find(l => l.text.startsWith('Marked the tip'))!.text,
      drift(false)!, drift(true)!,
    ];
    for (const l of lines) {
      const said = simLine(l, sv);
      expect(said, l).not.toBe(l);
      expect(said, l).not.toMatch(/\b(needle|compass|hook|wool|mittens|hair|still pool|shadow|north|east|you)\b/i);
      // In English, exactly the sim's words.
      expect(simLine(l, enT)).toBe(l);
    }
  });

  it('tells the AI and the API what heading out needs and what the Warden has', () => {
    const s = warden({ pack: ['sewing-kit'] });
    const seen = observe(s);
    expect(seen).toMatch(/^HEADING: Heading out \(n … nw\) needs something to keep a heading/m);
    expect(seen).toContain('You have: nothing. Blocked now: you need something to keep a heading');
    expect(observe(warden({ pack: ['map-compass'] }))).toContain('You have: your map and compass: no drift.');
    expect(observe(warden({ weather: 'clear' }))).toContain('You have: the sun today, with a shadow stick');
    expect(observe(warden({ on: false }))).not.toContain('HEADING:');
    // The play API's view: the ways blocked with why, in the viewer's language; then what keeps it.
    const api = viewText(app(s), 'day', enT);
    expect(api).toContain('"n" = North (not now: you need something to keep a heading');
    expect(viewText(app(s), 'day', sv)).toContain('(inte nu: du behöver något att hålla kursen med');
    expect(viewText(app(warden({ pack: ['map-compass'] })), 'day', enT)).toContain('you keep your heading by the map and compass');
    const needled = runAction(s, 'needlecompass');
    expect(viewText(app(needled), 'day', enT)).toContain('you keep your heading by your needle compass, which may drift a direction off; its pull lasts 7 more day(s)');
  });

  it('keeps the needle compass through a save, and drops it with the switch off or malformed', () => {
    const made = runAction(warden({ pack: ['sewing-kit'] }), 'needlecompass');
    const a = { ...app(made), sim: { ...made, needleCompass: { ...made.needleCompass!, trips: 2 } } };
    expect(deserialize(serialize(a))!.sim.needleCompass).toEqual({ made: 1, tool: 'needle', trips: 2 });
    const off = { ...app(warden({ on: false })), sim: { ...warden({ on: false }), needleCompass: { made: 1, tool: 'needle' as const } } };
    expect(deserialize(serialize(off))!.sim.needleCompass).toBeUndefined();
    for (const bad of [{ made: 0, tool: 'needle' }, { made: 1, tool: 'pin' }, { made: 1, tool: 'hook', trips: -1 }, 'needle']) {
      const broken = { ...app(made), sim: { ...made, needleCompass: bad as unknown as Region1State['needleCompass'] } };
      expect(deserialize(serialize(broken))!.sim.needleCompass).toBeUndefined();
    }
  });
});
