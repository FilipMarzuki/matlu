/**
 * The queue beside the actions (#1826, ui feature `side-queue`): the look is exempt (screenshots),
 * but the structure isn't. With the switch on the queue has its own column beside the actions and
 * the journal and camp-site picker are outside it; off, the PLAN tab is drawn as before. The compact
 * queue's words, in English and Swedish. On a wide screen (#1931) the journal joins the queue's
 * frozen column.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { FEATURES, featureById, ruleFeatures, uiFeatureOn } from '../artificer/features';
import { makeT, type Key } from '../artificer/i18n';
import { DISTANCE_NOT_RINGS } from '../artificer/distance-words';
import { ICON } from './camp-blocks';
import { distanceT } from './sim-words';
import { JOURNAL_BESIDE_QUERY, SIDE_QUEUE_FEATURE, compactEnd, compactItem, compactItemHtml, compactItemText, compactTotal, planLayout, queueStrip, type PlanParts } from './plan-layout';
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

describe('the journal under the queue on a wide screen (#1931)', () => {
  it('beside: the journal sits under the queue, the two in one frozen box; the site picker stays below', () => {
    const html = planLayout(parts, true, en, true);
    expect(html).toMatch(/^<div class="plan sideq">/);
    // In order: the frozen box, the queue's box, the journal's box (closing the frozen box), then the box below.
    const order = ['<div class="planqzone"><div class="planstick"><section class="box planq"', 'QUEUE', `<section class="box planlog">${parts.journal}</section></div></div>`, '<section class="box planmore">'];
    const at = order.map(s => html.indexOf(s));
    expect(at.every(i => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(section(html, 'planq')).not.toContain('JOURNAL');
    expect(section(html, 'planlog')).toBe(parts.journal);
    expect(section(html, 'planmore')).toBe(parts.camp);
    // Camp made: nothing is left for the box below, so there is none.
    const made = planLayout({ ...parts, camp: '' }, true, en, true);
    expect(made).toContain('class="box planlog"');
    expect(made).not.toContain('planmore');
  });

  it('beside: the phone\'s strip and its fold are drawn as before, in the queue\'s box', () => {
    const html = planLayout({ ...parts, strip: '<div class="qstrip">S</div>', stripOpen: true }, true, en, true);
    expect(section(html, 'planq stripopen')).toBe(`<div class="qstrip">S</div><div class="planqfull">${parts.queue}</div>`);
  });

  it('with no queue to sit under (the guide\'s first steps), or no journal yet, the layout is the narrow one', () => {
    expect(planLayout({ ...parts, queue: '' }, true, en, true)).toBe(planLayout({ ...parts, queue: '' }, true, en));
    expect(planLayout({ ...parts, journal: '' }, true, en, true)).toBe(planLayout({ ...parts, journal: '' }, true, en));
    expect(planLayout({ actions: '', queue: '', journal: '', camp: '' }, true, en, true)).toBe('');
  });

  it('narrow, or with the switch off, the HTML is exactly what it was', () => {
    // The layout #1826 drew, character for character.
    const before = `<div class="plan sideq"><div class="planacts">${parts.actions}</div>`
      + `<div class="planqzone"><section class="box planq" aria-label="The queue"><div class="planqfull">${parts.queue}</div></section></div>`
      + `<section class="box planmore">${parts.journal}${parts.camp}</section></div>`;
    expect(planLayout(parts, true, en)).toBe(before);
    expect(planLayout(parts, true, en, false)).toBe(before);
    expect(planLayout(parts, false, en, true)).toBe(planLayout(parts, false, en));
  });

  it('the screens it\'s for are the ones style.css lays the column out on', () => {
    expect(JOURNAL_BESIDE_QUERY).toBe('(min-width: 1000px)');
    const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const at = css.indexOf(`@media ${JOURNAL_BESIDE_QUERY} {`);
    expect(at).toBeGreaterThan(-1);
    // The frozen box and the journal's own scroll are laid out inside that query, not outside it.
    const block = css.slice(at, css.indexOf('\n}\n', at));
    expect(block).toContain('.planstick {');
    expect(block).toContain('.planstick > .planlog');
    expect(css.slice(0, at)).not.toMatch(/\.planstick|\.planlog/);
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
