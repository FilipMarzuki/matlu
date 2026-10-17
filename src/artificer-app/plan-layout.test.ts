/**
 * The queue beside the actions (#1826, ui feature `side-queue`): the look is exempt (screenshots),
 * but the structure isn't. With the switch on the queue has its own column beside the actions and
 * the journal and camp-site picker are outside it; off, the PLAN tab is drawn as before. The compact
 * queue's words, in English and Swedish.
 */

import { describe, it, expect } from 'vitest';
import { FEATURES, featureById, ruleFeatures, uiFeatureOn } from '../artificer/features';
import { makeT, type Key } from '../artificer/i18n';
import { DISTANCE_NOT_RINGS } from '../artificer/distance-words';
import { ICON } from './camp-blocks';
import { distanceT } from './sim-words';
import { SIDE_QUEUE_FEATURE, compactEnd, compactItem, compactItemHtml, compactItemText, compactTotal, planLayout, queueStrip, type PlanParts } from './plan-layout';
import type { ActionId } from '../artificer/region1';

const en = makeT('en');
const sv = makeT('sv');

const parts: PlanParts = {
  actions: '<section class="box"><i>ACTIONS</i></section>',
  queue: '<div class="queue"><i>QUEUE</i></div>',
  journal: '<div class="log"><i>JOURNAL</i></div>',
  camp: '<div class="camp-scene"><i>SITES</i></div>',
};

/** The inside of the first `<section class="box NAME"…>` (the parts hold no sections of their own but the actions'). */
const section = (html: string, name: string): string | null => {
  const m = new RegExp(`<section class="box ${name}"[^>]*>([\\s\\S]*?)</section>`).exec(html);
  return m ? m[1] : null;
};

describe('the side-queue ui feature (#1826)', () => {
  it('is a ui feature, experimental, on by default, registered after the Menu, and no run saves it', () => {
    expect(featureById(SIDE_QUEUE_FEATURE)).toMatchObject({ kind: 'ui', stage: 'experimental', default: true, absent: false, issue: 1826 });
    expect(uiFeatureOn({}, SIDE_QUEUE_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [SIDE_QUEUE_FEATURE]: false }, SIDE_QUEUE_FEATURE)).toBe(false);
    expect(Object.keys(ruleFeatures())).not.toContain(SIDE_QUEUE_FEATURE);
    // After the Menu; the two-row header (#1824) came after it, and only ui features follow it.
    const at = FEATURES.findIndex(f => f.id === SIDE_QUEUE_FEATURE);
    expect(at).toBeGreaterThan(FEATURES.findIndex(f => f.id === 'meny'));
    expect(FEATURES.slice(at).every(f => f.kind === 'ui')).toBe(true);
  });
});

describe('the PLAN layout (#1826)', () => {
  it('on: the actions, then the queue in its own column beside them', () => {
    const html = planLayout(parts, true, en);
    expect(html).toMatch(/^<div class="plan sideq">/);
    const q = section(html, 'planq');
    expect(q).toContain('QUEUE');
    expect(html.indexOf('ACTIONS')).toBeLessThan(html.indexOf('class="box planq"'));
    expect(html).toContain('<div class="planacts"><section class="box"><i>ACTIONS</i></section></div>');
    expect(html).toMatch(/class="box planq" aria-label="The queue"/);
    expect(html).not.toContain('planside');
  });

  it('on: the journal and the site picker are outside the frozen column, in a box of their own', () => {
    const html = planLayout(parts, true, en);
    const q = section(html, 'planq')!;
    expect(q).not.toContain('JOURNAL');
    expect(q).not.toContain('SITES');
    const more = section(html, 'planmore')!;
    expect(more).toContain('JOURNAL');
    expect(more).toContain('SITES');
    // Camp made: no site picker, the journal alone.
    expect(section(planLayout({ ...parts, camp: '' }, true, en), 'planmore')).toBe(parts.journal);
  });

  it('on: before the guide brings the queue in, the actions take the width; with nothing yet, nothing', () => {
    const html = planLayout({ ...parts, queue: '' }, true, en);
    expect(html).toMatch(/^<div class="plan sideq noq">/);
    expect(html).not.toContain('planq');
    expect(planLayout({ actions: '', queue: '', journal: '', camp: '' }, true, en)).toBe('');
  });

  it('on: before planning is learned, the one-at-a-time note sits where the queue would', () => {
    const note = '<div class="queue onestep"><i>ONE THING</i></div>';
    expect(section(planLayout({ ...parts, queue: note }, true, en), 'planq')).toBe(`<div class="planqfull">${note}</div>`);
  });

  it('says the column\'s name in Swedish', () => {
    expect(planLayout(parts, true, sv)).toContain('aria-label="Kön"');
  });

  it('off: the layout from before, one side column with the queue, the journal and the sites', () => {
    const html = planLayout(parts, false, en);
    expect(html).toBe(`<div class="plan">${parts.actions}<section class="box planside">${parts.queue}${parts.journal}${parts.camp}</section></div>`);
    expect(html).not.toMatch(/sideq|planq|planmore|planacts/);
    expect(planLayout({ actions: '', queue: '', journal: '', camp: '' }, false, en)).toBe('');
  });
});

describe('the compact queue\'s words (#1826)', () => {
  it('a task: its icon, short name, the distance in a word, and its hours, in English and Swedish', () => {
    expect(compactItemText(compactItem('wood', 1, true, 4, ICON.wood, en))).toBe('🪵 Wood 4h');
    expect(compactItemText(compactItem('water', 2, true, 2.5, ICON.water, en))).toBe('💧 Water far 2.5h');
    expect(compactItemText(compactItem('hunt', 3, true, 6, ICON.hunt, en))).toBe('🏹 Hunt distant 6h');
    expect(compactItemText(compactItem('wood', 1, true, 4, ICON.wood, sv))).toBe('🪵 Ved 4h');
    expect(compactItemText(compactItem('water', 2, true, 2.5, ICON.water, sv))).toBe('💧 Vatten yttre 2,5h');
    expect(compactItemText(compactItem('gather', 3, true, 3, ICON.gather, sv))).toBe('🌿 Mat fjärran 3h');
    // Work at camp has no distance.
    expect(compactItemText(compactItem('rest', 2, false, 1, ICON.rest, en))).toBe('☕ Rest 1h');
  });

  it('says the distance as a distance with `distance-not-rings` on', () => {
    const run = { config: { world: { features: { [DISTANCE_NOT_RINGS]: true } } } } as unknown as Parameters<typeof distanceT>[0];
    expect(compactItem('water', 2, true, 2, ICON.water, distanceT(run, en)).dist).toBe('½ day');
    expect(compactItem('water', 3, true, 2, ICON.water, distanceT(run, sv)).dist).toBe('1 dag');
  });

  it('every action has a short name in both languages, shorter than or as long as its full one', () => {
    for (const id of Object.keys(ICON) as ActionId[]) {
      for (const t of [en, sv]) {
        const short = t(`actshort.${id}` as Key);
        expect(short, id).not.toBe(`actshort.${id}`);
        expect(short.length, id).toBeLessThanOrEqual(t(`act.${id}` as Key).length);
      }
    }
  });

  it('draws the task\'s words escaped, without a distance when it has none', () => {
    const html = compactItemHtml(compactItem('rest', 1, false, 1, ICON.rest, en));
    expect(html).toBe('<span class="qc"><span class="qci">☕</span><span class="qcn">Rest</span><span class="qch">1h</span></span>');
    expect(compactItemHtml({ icon: '', name: '<b>', dist: 'a&b', hours: '1h' })).not.toContain('<b>');
  });

  it('the day\'s total and when it ends: the clock as the hours show, or the part of the day', () => {
    expect(compactEnd(6, null)).toBe('12:00');
    expect(compactEnd(8.5, null)).toBe('14:30');
    expect(compactEnd(6, 'MIDDAY')).toBe('MIDDAY');
    expect(compactTotal(6, '12:00', en)).toBe('6 / 14h · ends 12:00');
    expect(compactTotal(6, '12:00', sv)).toBe('6 / 14 h · slut 12:00');
    expect(compactTotal(2.5, null, en)).toBe('2.5 / 14h');
    expect(compactTotal(2.5, null, sv)).toBe('2,5 / 14 h');
  });
});

describe('the phone\'s strip over the actions (#1826)', () => {
  const items = [compactItem('water', 1, true, 2, ICON.water, en), compactItem('wood', 2, true, 4, ICON.wood, en)];
  const strip = (open: boolean, t = en): string => queueStrip({ items, note: '', total: compactTotal(6, '12:00', t), open, button: { cmd: 'day', label: 'RUN THE DAY', disabled: false } }, t);

  it('sits first in the frozen box, the whole queue after it; unfolded marks the box', () => {
    const folded = planLayout({ ...parts, strip: strip(false), stripOpen: false }, true, en);
    const q = section(folded, 'planq')!;
    expect(q.indexOf('class="qstrip"')).toBe(5);
    expect(q).toContain(`<div class="planqfull">${parts.queue}</div>`);
    expect(folded).toContain('class="box planq"');
    expect(planLayout({ ...parts, strip: strip(true), stripOpen: true }, true, en)).toContain('class="box planq stripopen"');
    // Off, no strip, whatever is passed.
    expect(planLayout({ ...parts, strip: strip(false) }, false, en)).not.toContain('qstrip');
  });

  it('folded: each task as a chip (icon, short name, hours), the total and its end, ▾ to unfold, and Run', () => {
    const html = strip(false);
    expect(html).toContain('data-cmd="qstrip" aria-expanded="false" title="Show the whole queue"');
    expect(html.match(/class="qschip"/g)).toHaveLength(2);
    expect(html).toContain('<span class="qci">🪵</span> Wood <b>4h</b>');
    expect(html).toContain('6 / 14h · ends 12:00');
    expect(html).toContain('▾');
    expect(html).toContain('<button class="btn go" data-cmd="day">RUN THE DAY</button>');
  });

  it('unfolded: ▴ folds it again; in Swedish', () => {
    const html = strip(true, sv);
    expect(html).toContain('aria-expanded="true" title="Fäll ihop kön"');
    expect(html).toContain('▴');
    expect(html).toContain('6 / 14 h · slut 12:00');
  });

  it('with nothing queued, or before planning is learned, says its note, and End day can be disabled', () => {
    const html = queueStrip({ items: [], note: sv('qc.empty'), total: compactTotal(0, null, sv), open: false, button: { cmd: 'endday', label: 'AVSLUTA', disabled: true } }, sv);
    expect(html).toContain('<span class="qsnote">Inget i kön — tryck på en syssla</span>');
    expect(html).toContain('data-cmd="endday" disabled');
    expect(html).not.toContain('class="qschip"');
  });
});
