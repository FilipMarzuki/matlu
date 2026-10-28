/**
 * Where the day ends, in words (#1930, ui feature `day-forecast`). The look is exempt (`ui-hud`:
 * screenshots), but what the sentence says is checked here against the queue's own preview: when
 * and where today's plan leaves you, how tired, and the nights each store a trip fills will cover,
 * the same numbers as the key box and the winter outlook. With `forecasts` on, it says no more than
 * the Warden can know. In English and Swedish. Pure: states in, words out, no browser.
 */

import { describe, it, expect } from 'vitest';
import { makeT } from '../artificer/i18n';
import { featureById, uiFeatureOn } from '../artificer/features';
import { keyMetrics } from '../artificer/key-metrics';
import { knownSpots } from '../artificer/camp-sites';
import { endDay, queueId, runAction, winterOutlook, type QueueItem, type Region1State } from '../artificer/region1';
import { forecastRand, judged, knowThreshold, misjudgeChance, queueKeyOf, roughAmount, taskKey } from '../artificer/forecasts';
import { DEFAULT_STATS } from '../artificer/stats';
import { enqueue, makeWarden, previewQueue, todayHours, type AppState } from './controller';
import { queueForecast, taskCard } from './forecast-words';
import { vitalLevel, vitalWord } from './vital-words';
import { queueStrip } from './plan-layout';
import { DAY_FORECAST_FEATURE, dayEnd, dayEndHtml, dayEndText, storeText, storesText } from './day-forecast';

const en = makeT('en');
const sv = makeT('sv');

/**
 * A run played the game's own way: a Warden of 12 with INT 12 chosen (10 at that age), who has
 * scouted, made camp at the first place they found, and fetched wood and water three times each
 * (enough, at INT 10, to know both close by), then slept. Rules switches as `features` sets them.
 */
function played(features?: Record<string, boolean>): { before: Region1State; camped: Region1State } {
  const a = makeWarden({ id: 'w-day-forecast', stats: { ...DEFAULT_STATS, int: 12 } }, undefined, features);
  let s = a.sim;
  const step = (q: QueueItem): void => { s = runAction(s, q); if (s.hoursToday >= 11) s = endDay(s); };
  for (const q of ['scout', 'survey', 'explore'] as QueueItem[]) step(q);
  const before = { ...s, canPlan: true };
  step({ q: 'camp', opts: { spot: knownSpots(s)[0].id } });
  for (const q of ['wood', 'water', 'wood', 'water', 'wood', 'water'] as QueueItem[]) step(q);
  if (s.hoursToday > 0) s = endDay(s);
  return { before, camped: { ...s, canPlan: true } };
}

const ON = played();
const OFF = played({ forecasts: false });

const queued = (sim: Region1State, queue: QueueItem[]): { a: AppState; p: ReturnType<typeof previewQueue> } => {
  const a = queue.reduce(enqueue, { sim, queue: [], stage: 'reach' } as AppState);
  return { a, p: previewQueue(a) };
};
const line = (sim: Region1State, queue: QueueItem[], t = en, words = true): string | null => {
  const { a, p } = queued(sim, queue);
  const e = dayEnd(a, p, words, t);
  return e ? dayEndText(e, t) : null;
};

describe('Where the day ends, in words (#1930)', () => {
  it('is a ui switch, on by default, that no run saves', () => {
    const f = featureById(DAY_FORECAST_FEATURE);
    expect(f?.kind).toBe('ui');
    expect(f?.default).toBe(true);
    expect(uiFeatureOn({}, DAY_FORECAST_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [DAY_FORECAST_FEATURE]: false }, DAY_FORECAST_FEATURE)).toBe(false);
    expect(ON.camped.config.world.features?.[DAY_FORECAST_FEATURE]).toBeUndefined();
  });

  it('a day that ends back at camp: when, how tired (the word the header will show), and the nights each store a trip fills covers', () => {
    const { a, p } = queued(OFF.camped, ['wood', 'water']);
    const e = dayEnd(a, p, true, en)!;
    expect(e.where).toBe('back');
    expect(p.dayOffset).toEqual([0, 0]);
    const dusk = p.projected;
    const vigor = vitalLevel(dusk.vitals.vigor.current, dusk.vitals.vigor.cap);
    const clarity = vitalLevel(dusk.vitals.clarity.current, dusk.vitals.clarity.cap);
    expect(e.tired).toEqual(clarity > vigor ? { id: 'clarity', level: clarity } : { id: 'vigor', level: vigor });
    // The key box's water and the winter outlook's firewood nights, at dusk: the line and the status bar agree.
    const water = keyMetrics(dusk, { needs: false }).find(m => m.id === 'water')!.value;
    expect(e.stores).toEqual([
      { store: 'water', known: 'exact', nights: water, thaw: false },
      { store: 'wood', known: 'exact', nights: winterOutlook(dusk).fuelDays, thaw: false },
    ]);
    const word = vitalWord(e.tired!.id, e.tired!.level, en).toLowerCase();
    expect(dayEndText(e, en)).toBe(`Back at camp ${en(`dayend.when.${e.part}`)}, ${word}, with water for ${water} nights and wood for ${winterOutlook(dusk).fuelDays} nights.`);
    expect(dayEndText(e, sv)).toMatch(new RegExp(`^Tillbaka i lägret ${sv(`dayend.when.${e.part}`)}, ${vitalWord(e.tired!.id, e.tired!.level, sv).toLowerCase()}, med vatten för ${water} nätter och ved för \\d+ nätter\\.$`));
  });

  it('over budget: a day of more than the waking hours ends after dark, and tomorrow\'s tasks don\'t count', () => {
    const { a, p } = queued(OFF.camped, ['wood', 'water', 'wood', 'wood', 'water']);
    expect(todayHours(a, p)).toBeGreaterThan(14);
    expect(p.dayOffset.at(-1)).toBe(1);
    const e = dayEnd(a, p, true, en)!;
    expect(e.part).toBe('night');
    expect(dayEndText(e, en)).toMatch(/^Back at camp after dark, \w+, with water for \d+ nights and wood for \d+ nights\.$/);
    expect(dayEndText(e, sv)).toMatch(/^Tillbaka i lägret efter mörkrets inbrott, /);
    // Dusk is where tomorrow's first task starts: its water isn't in tonight's count.
    const dusk = p.before[4];
    expect(e.stores.find(x => x.store === 'water')).toEqual({ store: 'water', known: 'exact', nights: dusk.stores.water, thaw: false });
  });

  it('where you are: done at camp, at a camp made today, out on the land under the sky, or with no camp yet', () => {
    expect(line(OFF.camped, ['build'])).toMatch(/^Done (in the afternoon|around midday|before midday|by dusk), \w+\.$/);
    expect(line(OFF.before, [{ q: 'camp', opts: { spot: knownSpots(OFF.before)[0].id } }])).toMatch(/^At your new camp /);
    const out = line(OFF.camped, [{ q: 'explore@2', opts: { way: 'n' } }])!;
    expect(out).toMatch(/^Out on the land .*\. A night under the sky\.$/);
    expect(line(OFF.camped, [{ q: 'explore@2', opts: { way: 'n' } }], sv)).toMatch(/^Ute i landet .*\. En natt under bar himmel\.$/);
    // No camp yet: nothing to go back to, so a trip ends where you are.
    expect(line(OFF.before, ['wood'])).toMatch(/^Done .*, with wood for \d+ nights\.$/);
  });

  it('with the hours shown (time words off, or dev), the clock says when', () => {
    expect(line(OFF.camped, ['wood', 'water'], en, false)).toMatch(/^Back at camp by \d\d:\d\d, /);
    expect(line(OFF.camped, ['wood', 'water'], sv, false)).toMatch(/^Tillbaka i lägret kl\. \d\d:\d\d, /);
  });

  it('nothing to say: an empty queue, nothing that runs today, planning not learned, or the run over', () => {
    expect(line(OFF.camped, [])).toBeNull();
    const { a, p } = queued(OFF.camped, ['wood']);
    expect(dayEnd({ ...a, sim: { ...a.sim, canPlan: false } }, p, true, en)).toBeNull();
    expect(dayEnd({ ...a, sim: { ...a.sim, outcome: { choice: 'collapse', kind: 'collapsed', vitals: a.sim.vitals } } }, p, true, en)).toBeNull();
    // A task refused today takes no time and ends nothing.
    expect(dayEnd(a, { ...p, warnings: ['Too tired.'] }, true, en)).toBeNull();
    expect(dayEndHtml(null, en)).toBe('');
  });

  it('forecasts on: a trip never done there brings "whatever" you find, one still being learned its card\'s rough word, and no numbers for either', () => {
    // Wood half a day out was never fetched.
    const far = line(ON.camped, [queueId('wood', 2)])!;
    expect(far).toMatch(/with whatever wood you find\.$/);
    expect(far).not.toMatch(/\d/);
    // Wood close by fetched once (INT 10 needs three): the card's own word.
    const once = { ...ON.camped, familiar: { ...ON.camped.familiar, 'wood@1': 1 } };
    const { a, p } = queued(once, ['wood']);
    const e = dayEnd(a, p, true, en)!;
    const card = taskCard(once, p.before[0], 'wood', 1, en)!;
    expect(e.stores).toEqual([{ store: 'wood', known: 'rough', level: card.level }]);
    expect(dayEndText(e, en)).toMatch(/with (a little|some|plenty) more wood\.$/);
    expect(dayEndText(e, sv)).toMatch(/med (lite|en del|mycket) mer ved\.$/);
    // Known three times: the nights, as with the switch off.
    expect(line(ON.camped, ['wood'])).toMatch(/with wood for \d+ nights\.$/);
  });

  it('a trap line set today brings nothing by dusk, so it names no food; food nights are the key box\'s', () => {
    const { a, p } = queued(OFF.camped, ['traps']);
    expect(p.warnings).toEqual([null]);
    expect(p.projected.stores.rawFood).toBe(a.sim.stores.rawFood);
    expect(dayEnd(a, p, true, en)!.stores).toEqual([]);
    // A day that does bring food in: its nights are the key box's food days at dusk.
    const g = queued(OFF.camped, ['traps', 'gather']);
    const food = dayEnd(g.a, g.p, true, en)!.stores.find(x => x.store === 'food');
    expect(food).toEqual({ store: 'food', known: 'exact', nights: keyMetrics(g.p.projected, { needs: false }).find(m => m.id === 'food')!.value, thaw: false });
  });

  it('forecasts on: several trips to one store, one still being learned, get one rough word for all they bring', () => {
    // Wood close by is known (fetched three times); half a day out was fetched once, so it's rough.
    const learning = { ...ON.camped, familiar: { ...ON.camped.familiar, [taskKey('wood', 2)]: 1 } };
    const queue: QueueItem[] = [queueId('wood', 2), 'wood'];
    const { a, p } = queued(learning, queue);
    expect(p.dayOffset).toEqual([0, 0]);
    const e = dayEnd(a, p, true, en)!;
    // The two trips' haul together, as a rough amount, judged as surely as the least practised trip
    // allows, from the line's own seeded stream: not the known trip counted as nothing.
    const haul = p.projected.stores.firewood - a.sim.stores.firewood;
    const int = learning.character.stats.int;
    const level = judged(roughAmount(haul), 3, misjudgeChance(int, 1, knowThreshold(int)), forecastRand(learning, queueKeyOf(queue), 'dusk:wood'));
    expect(e.stores).toEqual([{ store: 'wood', known: 'rough', level }]);
    expect(dayEnd(a, previewQueue(a), true, en)).toEqual(e);
    expect(dayEndText(e, en)).not.toMatch(/wood for \d/);
  });

  it('forecasts on: how tired is the day forecast\'s to see — left out when it can\'t, judged within a step when it can, and steady across redraws', () => {
    // Something in the queue never done: the forecast is closed, and so is the tiredness.
    const closed = queued(ON.camped, ['wood', queueId('wood', 2)]);
    expect(queueForecast(closed.a, closed.p)).toBeNull();
    expect(dayEnd(closed.a, closed.p, true, en)!.tired).toBeNull();
    // INT 8 can't see a day coming at all.
    const dull = { ...ON.camped, character: { ...ON.camped.character, stats: { ...ON.camped.character.stats, int: 8 } } };
    const d = queued(dull, ['wood', 'water']);
    expect(dayEnd(d.a, d.p, true, en)!.tired).toBeNull();
    expect(line(dull, ['wood', 'water'])).toMatch(/^Back at camp [^,]+, with /);
    // Open: a word within one step of the truth, the same every time it's drawn.
    for (const q of [['wood'], ['wood', 'water'], ['water', 'wood', 'wood'], ['wood', 'water', 'wood', 'wood']] as QueueItem[][]) {
      const { a, p } = queued(ON.camped, q);
      expect(queueForecast(a, p)).not.toBeNull();
      const e = dayEnd(a, p, true, en)!;
      const truth = Math.max(vitalLevel(p.projected.vitals.vigor.current, p.projected.vitals.vigor.cap), vitalLevel(p.projected.vitals.clarity.current, p.projected.vitals.clarity.cap));
      expect(Math.abs(e.tired!.level - truth)).toBeLessThanOrEqual(1);
      expect(dayEnd(a, previewQueue(a), true, en)).toEqual(e);
    }
  });

  it('the stores in words: one night, none, to the thaw, and lists in both languages', () => {
    expect(storeText({ store: 'food', known: 'exact', nights: 1, thaw: false }, en)).toBe('food for 1 night');
    expect(storeText({ store: 'food', known: 'exact', nights: 1, thaw: false }, sv)).toBe('mat för 1 natt');
    expect(storeText({ store: 'water', known: 'exact', nights: 0, thaw: false }, en)).toBe('no water for tonight');
    expect(storeText({ store: 'water', known: 'exact', nights: 0, thaw: false }, sv)).toBe('inget vatten för natten');
    expect(storeText({ store: 'wood', known: 'exact', nights: 40, thaw: true }, en)).toBe('wood to last to the thaw');
    // The ones you can't tell are said together, after the others.
    expect(storesText([{ store: 'wood', known: 'unknown' }], en)).toBe('whatever wood you find');
    expect(storesText([{ store: 'wood', known: 'unknown' }], sv)).toBe('det du hittar av ved');
    const mixed = [{ store: 'food', known: 'unknown' }, { store: 'water', known: 'exact', nights: 2, thaw: false }, { store: 'wood', known: 'unknown' }] as const;
    expect(storesText(mixed, en)).toBe('water for 2 nights and whatever food and wood you find');
    expect(storesText(mixed, sv)).toBe('vatten för 2 nätter och det du hittar av mat och ved');
    const e = { part: 'evening' as const, clock: null, where: 'back' as const, tired: { id: 'vigor' as const, level: 2 as const }, stores: [
      { store: 'food' as const, known: 'exact' as const, nights: 4, thaw: false },
      { store: 'water' as const, known: 'rough' as const, level: 1 },
      { store: 'wood' as const, known: 'exact' as const, nights: 3, thaw: false },
    ] };
    expect(dayEndText(e, en)).toBe('Back at camp by dusk, tired, with food for 4 nights, some more water and wood for 3 nights.');
    expect(dayEndText(e, sv)).toBe('Tillbaka i lägret i skymningen, trött, med mat för 4 nätter, en del mer vatten och ved för 3 nätter.');
    expect(dayEndHtml(e, en)).toBe('<p class="dayend">Back at camp by dusk, tired, with food for 4 nights, some more water and wood for 3 nights.</p>');
  });

  it('the phone\'s strip says it in the total\'s place, in the bar; without it, the strip is as before', () => {
    const base = { items: [], note: 'Nothing', total: '6 / 14h · ends NIGHT', open: false, button: { cmd: 'day', label: 'RUN', disabled: false } };
    const html = queueStrip({ ...base, line: 'Back at camp by dusk & tired.' }, en);
    expect(html).toContain('<span class="qsline">Back at camp by dusk &#38; tired.</span><span class="qsfold"');
    expect(html).not.toContain('qstot');
    expect(/<button class="qsbar"[^]*?<\/button>/.exec(html)![0]).toContain('qsline');
    // No line: exactly as before.
    expect(queueStrip(base, en)).toBe(queueStrip({ ...base, line: '' }, en));
    expect(queueStrip(base, en)).toContain('<span class="qstot">6 / 14h · ends NIGHT</span>');
  });
});
