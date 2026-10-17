/**
 * #1839 on the page: Explore's chooser carries a compass (look around in the middle, the eight ways
 * around it), a way picked makes every distance open and queues Explore that way, and everything
 * new reads in Swedish as well as English: the compass, the option group and the journal's lines.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { en } from '../artificer/i18n/en';
import { createRegion1, runAction, ACTIONS, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { ruleFeatures } from '../artificer/features';
import { knownSpots } from '../artificer/camp-sites';
import { survey, createExploration } from '../artificer/exploration';
import { DIRS, DIRECTED_EXPLORE } from '../artificer/directed-explore';
import { compassBlock, distanceItem, distanceOptions, paletteBlock } from './camp-blocks';
import { previewQueue, makeWarden, serialize, deserialize, type AppState } from './controller';
import { simLine, optionLabel, optionGroupLabel, choiceNote } from './sim-words';

const enT = makeT('en');
const sv = makeT('sv');

const warden = (on = true, id = 'w-astrid'): Region1State => {
  const features = { ...ruleFeatures(), [DIRECTED_EXPLORE]: on };
  return createRegion1({ world: { ...FULL_WORLD, encounters: false, luck: false, accidents: false, darkness: false, weather: 'clear', features } }, undefined, { id });
};
const app = (sim: Region1State): AppState => ({ ...makeWarden({ id: sim.character.id }), sim, queue: [] });
const palette = (sim: Region1State, way?: Parameters<typeof paletteBlock>[2]['way'], t = enT): string => {
  const a = app(sim);
  return paletteBlock(a, previewQueue(a), { dev: false, t, chooser: 'explore', way });
};

describe('#1839 the compass in Explore’s chooser', () => {
  it('draws look around and the eight ways, a 3 × 3 grid, only with the switch on', () => {
    const html = palette(warden());
    expect(html).toContain('class="compass"');
    for (const d of DIRS) expect(html).toContain(`data-way="${d}"`);
    expect(html).toContain('data-way="here"');
    expect(html).not.toContain('data-way="camp"');
    expect(palette(warden(false))).not.toContain('class="compass"');
  });

  it('a way picked opens every distance and queues Explore that way', () => {
    const s = warden();
    // At the start only close by is known: looking around further out is greyed.
    expect(distanceOptions(s, 'explore', {}, enT).filter(o => o.greyed).map(o => o.ring)).toEqual([2, 3]);
    const out = distanceOptions(s, 'explore', {}, enT, 'ne');
    expect(out.every(o => !o.greyed && o.way === 'ne')).toBe(true);
    expect(distanceItem(out[1])).toEqual({ q: 'explore@2', opts: { way: 'ne' } });
    expect(distanceItem(distanceOptions(s, 'explore', {}, enT)[0])).toBe('explore');
    expect(palette(s, 'ne')).toContain('data-pickway="ne"');
    // Around camp is offered once you're away from a camp.
    const camped = runAction({ ...s, explore: survey(createExploration(), 1) }, { q: 'camp', opts: { spot: knownSpots(s)[0].id } });
    const away = runAction(camped, { q: 'explore@2', opts: { way: 's' } });
    expect(compassBlock(away, 'here', enT)).toContain('data-way="camp"');
  });

  it('says the compass, the way and the journal’s new lines in Swedish', () => {
    const s = warden();
    const sweden = palette(s, 'n', sv);
    expect(sweden).toContain('Åt vilket håll?');
    expect(sweden).toContain('>NO<');
    const camped = runAction({ ...s, explore: survey(createExploration(), 1) }, { q: 'camp', opts: { spot: knownSpots(s)[0].id } });
    const away = runAction(camped, { q: 'explore@3', opts: { way: 'e' } });
    const back = runAction(away, 'rest');
    const looked = runAction(runAction(s, { q: 'explore@2', opts: { way: 'w' } }), 'explore');
    const lines = [...away.log, ...back.log, ...looked.log].map(l => l.text)
      .filter(l => /^(Headed|Out that way|You'll sleep out|Looked around where|Walked back to camp)/.test(l));
    expect(lines.length).toBeGreaterThan(4);
    for (const l of lines) {
      const said = simLine(l, sv);
      expect(said, l).not.toBe(l);
      expect(said).not.toMatch(/\b(north|south|east|west|hours|about|Headed)\b/);
    }
    // The option group, every choice and its note, away from camp.
    const g = ACTIONS.explore.options!(away, {})[0];
    expect(optionGroupLabel(g, sv)).toBe('Åt vilket håll');
    for (const c of g.choices) {
      expect(optionLabel(g, c, sv)).not.toBe(c.label);
      expect(choiceNote(away, g, c, sv)).not.toBe(c.note);
      // And in English, exactly the sim's words.
      expect(optionLabel(g, c, enT)).toBe(c.label);
      expect(choiceNote(away, g, c, enT)).toBe(c.note);
    }
    expect(en['opt.way.headNote']).toBe(g.choices.find(c => c.value === 'n')!.note);
  });

  it('keeps where you stand and what you saw through a save', () => {
    const a = { ...app(warden()), sim: runAction(warden(), { q: 'explore@2', opts: { way: 'n' } }) };
    const back = deserialize(serialize(a))!;
    expect(back.sim.afield).toEqual(a.sim.afield);
    expect(back.sim.seenOut).toEqual(a.sim.seenOut);
    // With the switch off, a stray field is dropped.
    const off = { ...app(warden(false)), sim: { ...warden(false), afield: { x: 1, y: 1 }, seenOut: [3] } };
    const read = deserialize(serialize(off))!;
    expect(read.sim.afield).toBeUndefined();
    expect(read.sim.seenOut).toBeUndefined();
  });
});
