/**
 * Acceptance tests for #1478 — focus follows the concept web. Since #1459 study offers any concept
 * a Warden has opened; focus took only the Region 1 six. Now it takes any open concept, and refuses
 * one the Warden hasn't come across, as study does.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { STEADY_WORLD } from './test-helpers';
import { createRegion1, runAction, chooseSite, endDay, setFocus, STUDY_CONCEPTS, CRAFT_WORLD, type Region1State } from './region1';
import { createVitals } from './vitality';
import { parseFocus, focusKey } from './focus';
import { parseDecision } from '../artificer-ai/decision';
import { observe } from '../artificer-ai/observe';

const fresh = (over: Partial<Region1State> = {}): Region1State => ({ ...runAction(createRegion1({ world: STEADY_WORLD }), 'scout'), hoursToday: 0, vitals: createVitals(), ...over });
/** A roofed, fed and watered camp at nightfall, after a long day's work. */
function camp(over: Partial<Region1State> = {}): Region1State {
  let s = chooseSite(fresh(), 'cave');
  s = runAction({ ...s, stores: { ...s.stores, materials: 20 } }, 'build');
  return { ...s, stores: { ...s.stores, rawFood: 5, water: 5 }, vitals: createVitals({ vigor: 60, clarity: 70 }), hoursToday: 10, today: { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false }, ...over };
}
const json = (o: unknown) => JSON.stringify(o);

describe('Focus follows the concept web (#1478)', () => {
  // 1. Precision opens at sharpening 2: focus on it holds, and a day's work turns it over.
  it('takes an open web concept and teaches it while you work', () => {
    const base = camp();
    const s = { ...base, concepts: { ...base.concepts, sharpening: { rank: 2, insight: 0 } } };
    expect(STUDY_CONCEPTS(s)).toContain('precision');
    const f = setFocus(s, parseFocus('concept:precision'));
    expect(focusKey(f.focus)).toBe('concept:precision');
    expect(endDay(f).concepts.precision?.insight ?? 0).toBeGreaterThan(0);
  });

  // 2. Friction: nothing has shown this Warden friction, so focus refuses it and stays as it was.
  it('refuses a concept the Warden hasn’t come across, keeping the focus', () => {
    const s = setFocus(fresh(), parseFocus('goal:larder'));
    const after = setFocus(s, parseFocus('concept:friction'));
    expect(focusKey(after.focus)).toBe('goal:larder');
    expect(after.log.at(-1)?.text).toMatch(/haven't come across friction/);
  });

  // 3. The AI may name a web concept; a made-up one is still an error.
  it('lets the AI name a web concept, and only a real one', () => {
    const reply = (focus: string) => parseDecision(json({ thoughts: '', focus, site: null, queue: [] }));
    expect(reply('concept:precision').ok).toBe(true);
    expect(reply('concept:nonsense').ok).toBe(false);
    // The FOCUS line tells it which concepts are open now.
    expect(observe(fresh())).toMatch(/FOCUS: none.*concepts open: joinery, tension, sealing, leverage, sharpening, weaving/);
  });

  // 4. One registry: the stale root copy is gone and the sim still has the whole web.
  it('keeps one concepts registry', () => {
    const root = join(__dirname, '..', '..');
    expect(existsSync(join(root, 'macro-world', 'concepts.json'))).toBe(false);
    expect(existsSync(join(root, 'public', 'macro-world', 'concepts.json'))).toBe(true);
    expect(Object.keys(CRAFT_WORLD.concepts)).toHaveLength(34);
  });
});
