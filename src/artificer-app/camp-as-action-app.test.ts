/**
 * #1732 on the page: Make camp as an action, its camp sites on the Camp tab and the LAND tab, and
 * the queue's site choices, in both languages. The English the page shows is the sim's own (the AI
 * and the API read the same words); the Swedish has no English left in it.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { en as EN } from '../artificer/i18n/en';
import { createRegion1, runAction, ACTIONS, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { survey, createExploration } from '../artificer/exploration';
import { SUGGESTED_PACK } from '../artificer/kit';
import { CAMP_AS_ACTION, FACT_TEXT, BAND_TEXT, knownSpots } from '../artificer/camp-sites';
import { sitesBlock, paletteBlock, GROUPS } from './camp-blocks';
import { campSpotsSection, landTab } from './land-view';
import { choiceNote, optionLabel } from './sim-words';
import { previewQueue, makeWarden, type AppState } from './controller';

const sv = makeT('sv');
const en = makeT('en');

const ENGLISH_RE = /(?<![\p{L}])(the|you|your|and|with|of|not|yet|first|already|about|water|camp|warm|minutes|north|south|east|west|cave|treeline|hilltop|riverbank|shelter|wood|ground|wind|here)(?![\p{L}])/giu;
const shown = (html: string): string => html.replace(/\bdata-[\w-]+="[^"]*"/g, '').replace(/<[^>]*>/g, ' ');
const englishIn = (html: string): string[] => [...shown(html).matchAll(ENGLISH_RE)].map(m => m[0]);

function explored(on = true): Region1State {
  const s = createRegion1({ world: { ...FULL_WORLD, encounters: false, features: { [CAMP_AS_ACTION]: on } } }, undefined, { id: 'w-astrid', pack: [...SUGGESTED_PACK] });
  const camped = on ? runAction(s, { q: 'camp', opts: { spot: knownSpots(s)[0].id } }) : s;
  return { ...camped, explore: survey(survey(createExploration(), 1), 2) };
}
const app = (sim: Region1State): AppState => ({ ...makeWarden({ id: 'w-astrid' }), sim, queue: [] });

describe('Make camp on the page (#1732)', () => {
  it('the facts and bands the page says are the sim\'s English, word for word', () => {
    for (const [k, v] of Object.entries(FACT_TEXT)) expect(EN[`campsite.fact.${k}` as keyof typeof EN]).toBe(v);
    for (const [k, v] of Object.entries(BAND_TEXT)) expect(EN[`campsite.band.${k}` as keyof typeof EN]).toBe(v);
  });

  it('a site choice reads in English exactly as the sim\'s note (the AI\'s and the API\'s words), and in Swedish with no English', () => {
    const s = explored();
    const [g] = ACTIONS.camp.options!(s, {});
    expect(g.choices.length).toBeGreaterThan(1);
    for (const c of g.choices) {
      if (!c.blocked) expect(choiceNote(s, g, c, en)).toBe(c.note);
      expect(optionLabel(g, c, en)).toBe(c.label);
      expect(englishIn(choiceNote(s, g, c, sv)), c.note).toEqual([]);
      expect(englishIn(optionLabel(g, c, sv))).toEqual([]);
    }
  });

  it('the Camp tab lists the places to camp you know, each a card that makes camp there; with the switch off, the four sites as before', () => {
    const s = explored();
    const html = sitesBlock(s, en);
    for (const p of knownSpots(s)) expect(html).toContain(`data-camp="${p.id}"`);
    expect(html).not.toContain('data-site=');
    expect(englishIn(sitesBlock(s, sv))).toEqual([]);
    const off = sitesBlock(explored(false), en);
    expect(off).toContain('data-site="cave"');
    expect(off).not.toContain('data-camp=');
  });

  it('the LAND tab marks the places to camp with ⛺, your camp among them; nothing with the switch off', () => {
    const s = explored();
    const section = campSpotsSection(s, en);
    expect(section.match(/⛺ <b>/g)?.length).toBe(knownSpots(s).length);
    expect(section).toContain('YOUR CAMP');
    expect(landTab(s, en)).toContain(section);
    expect(englishIn(campSpotsSection(s, sv))).toEqual([]);
    expect(campSpotsSection(explored(false), en)).toBe('');
  });

  it('the action sits with the building actions, named in both languages', () => {
    expect(GROUPS.find(g => g.key === 'build')?.ids[0]).toBe('camp');
    const a = app(explored());
    const html = paletteBlock(a, previewQueue(a), { dev: false, t: sv });
    expect(html).toContain('data-q="camp"');
    expect(html).toContain('SLÅ LÄGER');
    expect(paletteBlock(app(explored(false)), previewQueue(app(explored(false))), { dev: false, t: en })).not.toContain('data-q="camp"');
  });
});
