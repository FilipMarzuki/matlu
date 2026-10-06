/**
 * Panic on screen (#1364): the encounter modal shows your read and state, marks what fear does
 * to the options, and shows the truth when your read was wrong; the queue and the status bar say
 * how a trip or a night will feel. Visual issue — these pin the words and hooks, not the look.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, tripUnease, tonightsFright, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { truthLine } from '../artificer/panic';
import { createExploration, scout } from '../artificer/exploration';
import { encounterModal } from './encounter-view';
import { previewQueue, GAME_WORLD } from './controller';

const at = (state: 'calm' | 'shaken' | 'panicked', id = 'crumbling-ledge'): Region1State => {
  const s = createRegion1({ world: GAME_WORLD }, undefined, { id: 'w-ui' });
  return { ...s, skills: { scouting: 20 }, pending: { id, day: 3, hour: 14, ring: 2, action: 'scout', state, perceived: state === 'calm' ? 2 : state === 'shaken' ? 3 : 4, margin: 0 } };
};

describe('Panic on screen (#1364)', () => {
  it('shows how it looks to you and how you stand', () => {
    expect(encounterModal(at('calm'), null, 0)).toMatch(/It looks <b>frightening<\/b>\. You keep your head\./);
    expect(encounterModal(at('shaken'), null, 0)).toMatch(/class="enc-read s-shaken">It looks <b>terrifying<\/b>\. Your heart is hammering/);
    expect(encounterModal(at('panicked'), null, 0)).toMatch(/s-panicked">It looks <b>overwhelming<\/b>\. Panic\. You can barely think\./);
  });

  it('marks what fear does to the options', () => {
    // Shaken: the careful option is marked harder; panicked: it is closed, with the reason.
    expect(encounterModal(at('shaken'), null, 0)).toMatch(/Go the long way round to it <span class="eo-shaken"/);
    expect(encounterModal(at('calm'), null, 0)).not.toMatch(/eo-shaken/);
    expect(encounterModal(at('panicked'), null, 0)).toMatch(/data-choose="go-around" disabled title="you can&#39;t think straight"/);
  });

  it('shows the override and the truth afterwards', () => {
    const html = encounterModal({ ...at('panicked'), pending: null }, { kind: 'animal', scene: 'A fox.', choice: 'Chase it', text: ['You meant to chase it for the hare. Your legs ran.', 'You back off.'], died: false, truth: truthLine(4, 1, 'animal') }, 0);
    expect(html).toMatch(/class="enc-result override">You meant to chase it/);
    expect(html).toContain('Looking back, it was only ever bluffing.');
    expect(truthLine(2, 2, 'find')).toBeNull();
    expect(truthLine(1, 2, 'find')).toBe('Only afterwards do you see how dangerous that was.');
  });

  it('says how a trip and a night will feel', () => {
    const base = createRegion1({ world: GAME_WORLD }, undefined, { id: 'w-ui2' });
    const late: Region1State = { ...base, day: 50, hoursToday: 13, weatherToday: 'fog', explore: scout(scout(createExploration(), 1), 2), character: { ...base.character, talents: [], quirks: [] }, stores: { ...base.stores, firewood: 6 } };
    const u = tripUnease(late, 'wood@3')!;
    expect(u.state).toBe('panicked');
    expect(u.reasons).toEqual(expect.arrayContaining(['dark', 'fog', 'the distant ring', 'wolves about']));
    expect(previewQueue({ sim: { ...late, canPlan: true }, queue: ['wood@3'], stage: 'reach' }).unease[0]).toMatchObject({ state: 'panicked' });
    expect(tripUnease(late, 'rest')).toBeNull();
    // Tonight: no shelter, no fire, wolves about — uneasy. With wood for a fire, calm.
    const night = tonightsFright({ ...late, weatherToday: 'clear', stores: { ...late.stores, firewood: 0 } })!;
    expect(night.state).toBe('shaken');
    expect(night.reasons).toEqual(expect.arrayContaining(['no shelter', 'no fire', 'wolves about']));
    expect(tonightsFright({ ...late, weatherToday: 'clear' })!.state).toBe('calm');
    // In a world without fear, nothing to say.
    expect(tonightsFright(createRegion1({ world: FULL_WORLD }))).toBeNull();
  });
});
