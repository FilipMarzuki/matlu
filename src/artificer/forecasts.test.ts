/**
 * Forecasts from INT and experience (#1827, rules feature `forecasts`): one test per acceptance
 * scenario of the issue, in its Given / When / Then. Pure: states in, words out, no browser.
 */

import { describe, it, expect } from 'vitest';
import { makeT } from './i18n';
import { runAction, queueId, type Region1State, type QueueItem } from './region1';
import { survey, createExploration } from './exploration';
import { knowThreshold, misjudgeChance, judged, forecastRand, taskKey, craftKey, familiarity } from './forecasts';
import { makeWarden, previewQueue, type AppState } from '../artificer-app/controller';
import { yieldText, paletteBlock, distanceOptions } from '../artificer-app/camp-blocks';
import { taskCard, taskLevel, craftCard, cardYield, queueForecast, forecastBlock, forecastLines } from '../artificer-app/forecast-words';

const en = makeT('en');
const sv = makeT('sv');

/** A Warden who can plan, has the two inner distances scouted, materials and no tools yet (so a knife is there to make), at this INT. */
function warden(int: number, familiar: Record<string, number> = {}, opts: { id?: string; day?: number; features?: Record<string, boolean> } = {}): Region1State {
  const s = makeWarden({ id: opts.id ?? 'w-forecast' }, undefined, opts.features).sim;
  return {
    ...s, canPlan: true, tools: [], day: opts.day ?? s.day, explore: survey(survey(createExploration(), 1), 2),
    stores: { ...s.stores, materials: 12, firewood: 6, rawFood: 6, water: 6 },
    character: { ...s.character, stats: { ...s.character.stats, int } },
    ...(Object.keys(familiar).length ? { familiar } : {}),
  };
}
const app = (sim: Region1State, queue: QueueItem[] = []): AppState => ({ sim, queue, stage: 'reach' });
const noDigits = /\d/;

describe('Forecasts from INT and experience (#1827)', () => {
  it('1. Given a task never done at a distance, Then its card shows no numbers and says it is unknown, even if known at another distance', () => {
    const s = warden(10, { [taskKey('wood', 1)]: 5 });
    const far = taskCard(s, s, 'wood', 2, en);
    expect(far?.knowing).toBe('unknown');
    expect(far?.text).toBe("you don't know what this will bring");
    expect(cardYield(s, s, 'wood', 2, en, yieldText('wood', s, 2, en))).not.toMatch(noDigits);
    // Known close by: the numbers, as today — in the chooser too, distance by distance.
    expect(taskCard(s, s, 'wood', 1, en)).toBeNull();
    const opts = distanceOptions(s, 'wood', {}, en, s);
    expect(opts.find(o => o.ring === 1)?.yield).toBe(yieldText('wood', s, 1, en));
    expect(opts.find(o => o.ring === 2)?.yield).toBe("you don't know what this will bring");
    expect(taskCard(s, s, 'wood', 2, sv)?.text).toBe('du vet inte vad det här ger');
    // Doing it is what counts, at that distance only, with no dice.
    const done = runAction(s, queueId('wood', 2));
    expect(familiarity(done, taskKey('wood', 2))).toBe(1);
    expect(familiarity(done, taskKey('wood', 1))).toBe(5);
  });

  it('2. Given a task done N−1 times at a distance, Then a rough word; at N, numbers — INT 8 / 10 / 14 give N = 4 / 3 / 2', () => {
    for (const [int, n] of [[8, 4], [10, 3], [14, 2]] as const) {
      expect(knowThreshold(int)).toBe(n);
      const rough = warden(int, { [taskKey('water', 1)]: n - 1 });
      const card = taskCard(rough, rough, 'water', 1, en);
      expect(card?.knowing).toBe('rough');
      expect(card?.text).toMatch(/^(a little|some|plenty of) water$/);
      expect(card?.text).not.toMatch(noDigits);
      expect(taskCard(rough, rough, 'water', 1, sv)?.text).toMatch(/^(lite|en del|mycket) vatten$/);
      const known = warden(int, { [taskKey('water', 1)]: n });
      expect(taskCard(known, known, 'water', 1, en)).toBeNull();
      expect(cardYield(known, known, 'water', 1, en, yieldText('water', known, 1, en))).toBe(yieldText('water', known, 1, en));
    }
  });

  it('3. Given a recipe never made, Then no odds or exact cost; made N times, Then the odds band, the grade and the exact cost', () => {
    const fresh = warden(10);
    const exact = yieldText('knife', fresh, 1, en);
    const never = craftCard(fresh, fresh, 'knife', en, exact)!;
    expect(never.knowing).toBe('unknown');
    expect(never.text).toMatch(/you're not sure you can make this/);
    expect(never.text).not.toMatch(noDigits);
    expect(never.band).toBeNull();
    expect(never.rough).toEqual([{ item: 'materials', level: expect.any(Number) }]);
    const card = (sim: Region1State): string => /<button class="act[^"]*" data-q="knife"[\s\S]*?<\/button>/.exec(paletteBlock(app(sim), previewQueue(app(sim)), { dev: false, t: en }))?.[0] ?? '';
    expect(card(fresh)).not.toMatch(/<b>2<\/b>/);
    expect(card(fresh)).toMatch(/not sure you can make this/);
    // Practised but short of N: success and grade in words, the cost roughly.
    const some = warden(10, { [craftKey('stone-knife')]: 2 });
    const rough = craftCard(some, some, 'knife', en, exact)!;
    expect(rough.knowing).toBe('rough');
    expect(rough.text).toMatch(/you'll likely manage|it could go either way|beyond you for now/);
    expect(rough.text).not.toMatch(noDigits);
    expect(craftCard(some, some, 'knife', sv, exact)!.text).toMatch(/det klarar du nog|det kan gå åt båda hållen|det övermäktar dig/);
    // Made N times (INT 10: three): the real band, the grade, and the exact cost on the card.
    const made = warden(10, { [craftKey('stone-knife')]: 3 });
    const sure = craftCard(made, made, 'knife', en, exact)!;
    expect(sure.knowing).toBe('exact');
    expect(sure.rough).toBeNull();
    expect(sure.text).toMatch(/^hunt −15% vigor, quicker preserving · (good odds|close to your limit|it will fail)/);
    expect(sure.text).toMatch(/comes out (crude|sound|fine|masterwork)/);
    expect(card(made)).toMatch(/<b>2<\/b>/);
    // A try counts whether it works or not.
    expect(familiarity(runAction(fresh, 'knife'), craftKey('stone-knife'))).toBe(1);
  });

  it('4. Given every queued item known and INT ≥ 9, Then a day forecast of effort and yield; with INT 8 or any unknown item, none', () => {
    const fam = { [taskKey('wood', 1)]: 1, [taskKey('water', 1)]: 1 };
    const queue: QueueItem[] = ['wood', 'water'];
    const at = (s: Region1State, q = queue) => { const a = app(s, q); return { a, p: previewQueue(a) }; };
    const { a, p } = at(warden(9, fam));
    const c = queueForecast(a, p)!;
    expect(c.days).toHaveLength(1);
    expect(c.days[0].effort).toBeGreaterThanOrEqual(0);
    const html = forecastBlock(a, p, en);
    expect(html).toMatch(/Today: (a light day|a full day|sounds exhausting|more than you can manage) · (not much to show for it|a fair amount|a good haul)\./);
    expect(forecastBlock(a, p, sv)).toMatch(/I dag: /);
    // INT 8: none.
    const low = at(warden(8, fam));
    expect(queueForecast(low.a, low.p)).toBeNull();
    expect(forecastBlock(low.a, low.p, en)).toBe('');
    // Anything never done at its distance: none.
    const unknown = at(warden(12, fam), ['wood', queueId('water', 2)]);
    expect(queueForecast(unknown.a, unknown.p)).toBeNull();
    // A craft in the queue is forecast too, once tried.
    const crafty = at(warden(12, { ...fam, [craftKey('stone-knife')]: 1 }), ['wood', 'knife']);
    const lines = forecastLines(queueForecast(crafty.a, crafty.p)!, crafty.a.sim.day, en);
    expect(lines.some(l => /stone knife (will probably come out|probably won't come together)/i.test(l))).toBe(true);
  });

  it('5. Given a three-day queue, Then days 2–3 are forecast only with INT 13+ and 7 days played, or 21 days played; otherwise "can\'t see that far"', () => {
    const queue: QueueItem[] = Array.from({ length: 9 }, () => 'wood');
    const cast = (int: number, day: number) => {
      const a = app(warden(int, { [taskKey('wood', 1)]: 3 }, { day }), queue);
      const p = previewQueue(a);
      expect(Math.max(...p.dayOffset)).toBe(2);
      return { c: queueForecast(a, p)!, lines: forecastLines(queueForecast(a, p)!, day, en) };
    };
    const sharp = cast(13, 8);
    expect(sharp.c.days.map(d => d.offset)).toEqual([0, 1, 2]);
    expect(sharp.c.unseen).toEqual([]);
    expect(sharp.c.stretch).not.toBeNull();
    expect(sharp.lines.some(l => /^Day 9: /.test(l))).toBe(true);
    expect(cast(10, 22).c.days).toHaveLength(3);
    for (const [int, day] of [[13, 7], [12, 8], [10, 21]] as const) {
      const blind = cast(int, day);
      expect(blind.c.days.map(d => d.offset)).toEqual([0]);
      expect(blind.c.unseen).toEqual([1, 2]);
      expect(blind.lines.filter(l => /you can't see that far ahead yet/.test(l))).toHaveLength(2);
    }
  });

  it('6. Given low INT and practice, Then over many seeded days some verdicts are one step off and none by more; at high INT and practice almost none; exact numbers never', () => {
    const offs = (int: number, fam: number): number[] => Array.from({ length: 400 }, (_, i) => {
      const s = warden(int, { [taskKey('wood', 1)]: fam }, { day: 1 + (i % 60), id: `w-${i}` });
      return taskCard(s, s, 'wood', 1, en)!.level! - taskLevel('wood', s, 1)!;
    });
    const low = offs(8, 1);
    expect(low.filter(d => d !== 0).length).toBeGreaterThan(20);
    expect(low.every(d => Math.abs(d) <= 1)).toBe(true);
    // Crafts too: the success verdict a step off at times, never two.
    const verdicts = Array.from({ length: 300 }, (_, i) => {
      const s = warden(8, { [craftKey('stone-knife')]: 1 }, { id: `w-${i}` });
      return craftCard(s, s, 'knife', en, '')!.band;
    });
    expect(new Set(verdicts).size).toBeGreaterThan(1);
    // A sharp, practised mind almost never misjudges, and a guess further ahead more often.
    expect(misjudgeChance(18, 20, 2)).toBeLessThan(0.01);
    expect(misjudgeChance(8, 1, 4, 2)).toBeGreaterThan(misjudgeChance(8, 1, 4, 0));
    const sharp = Array.from({ length: 1000 }, (_, i) => judged(1, 3, misjudgeChance(18, 20, 2), forecastRand(warden(18), 'q', `s${i}`)));
    expect(sharp.filter(l => l !== 1).length).toBeLessThan(15);
    // Known: the exact numbers, the same on every day and for every Warden.
    for (let i = 0; i < 50; i++) {
      const s = warden(10, { [taskKey('wood', 1)]: 3 }, { day: 1 + i, id: `w-${i}` });
      expect(cardYield(s, s, 'wood', 1, en, yieldText('wood', s, 1, en))).toBe(yieldText('wood', s, 1, en));
    }
  });

  it('7. Given the same seed and day (and, for the day\'s verdict, the same queue), Then the same forecast; with the switch off or absent, cards as today, no forecasts, the same run', () => {
    const fam = { [taskKey('wood', 1)]: 1, [taskKey('water', 1)]: 2 };
    const draw = (s: Region1State) => { const a = app(s, ['wood', 'water']); const p = previewQueue(a); return paletteBlock(a, p, { dev: false, t: en }) + forecastBlock(a, p, en); };
    expect(draw(warden(9, fam))).toBe(draw(warden(9, fam)));
    for (let i = 0; i < 20; i++) expect(taskCard(warden(8, fam, { id: `w-${i}` }), warden(8, fam, { id: `w-${i}` }), 'wood', 1, en)).toEqual(taskCard(warden(8, fam, { id: `w-${i}` }), warden(8, fam, { id: `w-${i}` }), 'wood', 1, en));
    // Off (or a run from before the switch, which reads as off): cards as today, and no forecast.
    for (const features of [{ forecasts: false }, undefined]) {
      const base = warden(14, {}, { features: features ?? { forecasts: false } });
      const off = features ? base : { ...base, config: { ...base.config, world: { ...base.config.world, features: Object.fromEntries(Object.entries(base.config.world.features ?? {}).filter(([k]) => k !== 'forecasts')) } } };
      expect(taskCard(off, off, 'wood', 2, en)).toBeNull();
      expect(craftCard(off, off, 'knife', en, 'x')).toBeNull();
      const a = app(off, ['wood', 'water']);
      const p = previewQueue(a);
      expect(queueForecast(a, p)).toBeNull();
      expect(paletteBlock(a, p, { dev: false, t: en })).toContain(yieldText('gather', p.projected, 1, en));
      expect(runAction(off, 'wood').familiar).toBeUndefined();
    }
    // The same run on and off: counting changes nothing else (no dice drawn, nothing else moved).
    const strip = (s: Region1State) => JSON.stringify({ ...s, familiar: undefined, config: undefined });
    let on = warden(10), off = warden(10, {}, { features: { forecasts: false } });
    for (const item of ['wood', queueId('water', 2), 'knife', 'gather', 'rest'] as QueueItem[]) { on = runAction(on, item); off = runAction(off, item); }
    expect(strip(on)).toBe(strip(off));
    expect(on.familiar).toEqual({ 'wood@1': 1, 'water@2': 1, 'craft:stone-knife': 1, 'gather@1': 1, 'rest@1': 1 });
  });

  it('8. Given a fixed run and day, Then a task card\'s word is the same whether the queue is empty, holds other tasks, or holds the task in another slot; a different day may give another word', () => {
    const fam = { [taskKey('wood', 1)]: 1, [taskKey('water', 1)]: 1, [taskKey('gather', 1)]: 1 };
    const queues: QueueItem[][] = [[], ['water', 'gather'], ['wood', 'water'], ['water', 'gather', 'wood'], ['gather', 'wood', 'water', 'wood']];
    // The wood card's word on the palette, in the chooser and on each queued wood row, for one queue.
    const words = (s: Region1State, queue: QueueItem[]): string[] => {
      const a = app(s, queue);
      const p = previewQueue(a);
      const card = taskCard(s, p.projected, 'wood', 1, en)!.text;
      const chooser = distanceOptions(p.projected, 'wood', {}, en, s).find(o => o.ring === 1)!.yield;
      const rows = queue.flatMap((q, i) => (q === 'wood' ? [taskCard(s, p.before[i], 'wood', 1, en)!.text] : []));
      expect(paletteBlock(a, p, { dev: false, t: en })).toContain(card);
      return [card, chooser, ...rows];
    };
    let misjudged = 0;
    const byDay = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const s = warden(8, fam, { id: `w-card-${i}`, day: 5 });
      const all = queues.flatMap(q => words(s, q));
      expect(new Set(all).size).toBe(1);
      if (taskCard(s, s, 'wood', 1, en)!.level !== taskLevel('wood', s, 1)) misjudged++;
      for (let day = 2; day < 30; day++) byDay.add(taskCard(warden(8, fam, { id: `w-card-${i}`, day }), warden(8, fam, { id: `w-card-${i}`, day }), 'wood', 1, en)!.text);
    }
    // The words do get misjudged (so the sameness above isn't just the truth), and another day can draw another.
    expect(misjudged).toBeGreaterThan(0);
    expect(byDay.size).toBeGreaterThan(1);
  });
});
