/**
 * #1838: how to play lives in the journal, as the Warden's own notes behind a 📖 on the journal's
 * heading; the ⚙ Menu's How to play links there, and the header has no ?. Behind the
 * `journal-notes` ui switch; off, the journal heading and the Menu are as before.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { FEATURES, featureById, ruleFeatures, uiFeatureOn } from '../artificer/features';
import { NOTES_FEATURE, NOTE_KEYS, howtoBody, journalHead, notesButton, notesPage, notesShown } from './journal-notes';
import { headerControls, headerRows, menyPage, MENY_FEATURE, type HeaderParts } from './meny';

const en = makeT('en');
const sv = makeT('sv');
const STYLE = 'color:var(--faint);margin-bottom:7px';
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('the switch (#1838)', () => {
  it('is a ui feature, experimental, on by default, after the Menu, and no run saves it', () => {
    expect(featureById(NOTES_FEATURE)).toMatchObject({ kind: 'ui', stage: 'experimental', default: true, absent: false, issue: 1838 });
    expect(uiFeatureOn({}, NOTES_FEATURE)).toBe(true);
    expect(uiFeatureOn({ [NOTES_FEATURE]: false }, NOTES_FEATURE)).toBe(false);
    expect(Object.keys(ruleFeatures())).not.toContain(NOTES_FEATURE);
    expect(FEATURES.findIndex(f => f.id === NOTES_FEATURE)).toBeGreaterThan(FEATURES.findIndex(f => f.id === MENY_FEATURE));
  });
});

describe('the journal box\'s 📖 (#1838)', () => {
  it('on, the heading carries the 📖 that opens the notes', () => {
    const html = journalHead('LATEST', STYLE, { on: true, open: false, winterDay: 23 }, en);
    expect(html).toContain('LATEST');
    expect(html).toContain('data-cmd="notes"');
    expect(html).toContain('📖');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('id="notes"');
  });

  it('open, the notes follow the heading, with the 📖 pressed and a way back', () => {
    const html = journalHead('LATEST', STYLE, { on: true, open: true, winterDay: 23 }, en);
    expect(html).toContain('aria-expanded="true"');
    expect(html.indexOf('LATEST')).toBeLessThan(html.indexOf('id="notes"'));
    expect(text(html)).toContain('MY NOTES');
    expect(text(html)).toContain('BACK TO THE JOURNAL');
  });

  it('off, the heading is exactly the one from before', () => {
    expect(journalHead('LATEST', STYLE, { on: false, open: true, winterDay: 23 }, en)).toBe(`<p class="eyebrow" style="${STYLE}">LATEST</p>`);
    expect(journalHead('ROAD JOURNAL', '', { on: false, open: false, winterDay: 23 }, en)).toBe('<p class="eyebrow">ROAD JOURNAL</p>');
  });

  it('the 📖 is named for screen readers in both languages', () => {
    expect(notesButton(false, en)).toContain('aria-label="My notes');
    expect(notesButton(false, sv)).toContain('aria-label="Mina anteckningar');
  });
});

describe('the notes (#1838)', () => {
  it('in English: the queue, hours, Vigor and Clarity, water first, scouting, the snow\'s day, the save', () => {
    const s = text(notesPage(23, en));
    expect(s).toContain('MY NOTES');
    expect(s).toMatch(/Each day I plan a queue of tasks/);
    expect(s).toMatch(/hours/);
    expect(s).toMatch(/Vigor/);
    expect(s).toMatch(/Clarity/);
    expect(s).toMatch(/Water matters most/);
    expect(s).toMatch(/First I scout/);
    expect(s).toContain('The snow comes on day 23');
    expect(s).toMatch(/until the thaw/);
    expect(s).toMatch(/this browser/);
  });

  it('in Swedish, in the journal\'s own voice', () => {
    const s = text(notesPage(23, sv));
    expect(s).toContain('MINA ANTECKNINGAR');
    expect(s).toMatch(/Varje dag planerar jag en kö av sysslor/);
    expect(s).toMatch(/timmar/);
    expect(s).toMatch(/Kraft/);
    expect(s).toMatch(/Klarhet/);
    expect(s).toMatch(/Vattnet är viktigast/);
    expect(s).toMatch(/Först spanar jag/);
    expect(s).toContain('Snön kommer dag 23');
    expect(s).toMatch(/tövädret/);
    expect(s).toMatch(/webbläsaren/);
  });

  it('is first person and says nothing about more than one life (#1837)', () => {
    for (const t of [en, sv]) {
      for (const k of NOTE_KEYS) expect(t(k, { winterDay: 23 })).toMatch(/\b(I|My|Jag|jag|min|Dagboken|This journal)\b/);
    }
    const all = `${text(notesPage(23, en))} ${text(notesPage(23, sv))}`;
    expect(all).not.toMatch(/\b(runs?|next Warden|new game|rundor?|nästa väktare)\b/i);
  });

  it('every note is in both languages', () => {
    for (const k of NOTE_KEYS) expect(sv(k, { winterDay: 23 })).not.toBe(en(k, { winterDay: 23 }));
  });

  it('show while the journal is still empty until the player chooses, then as they chose', () => {
    expect(notesShown(null, true)).toBe(true);
    expect(notesShown(null, false)).toBe(false);
    expect(notesShown(false, true)).toBe(false);
    expect(notesShown(true, false)).toBe(true);
  });
});

describe('the Menu\'s How to play (#1838)', () => {
  it('on, it is a link to the notes, with no copy of the text', () => {
    const html = menyPage({ howto: howtoBody({ notes: true, lede: '<p class="lede">the old text</p>' }, en) }, en);
    expect(html).toContain('data-meny="howto"');
    expect(html).toContain('data-cmd="notesopen"');
    expect(html).toContain('MY NOTES, IN THE JOURNAL');
    expect(html).not.toContain('the old text');
    expect(howtoBody({ notes: true, lede: '' }, sv)).toContain('MINA ANTECKNINGAR, I DAGBOKEN');
  });

  it('off, it is the old copy (or nothing), as before', () => {
    expect(howtoBody({ notes: false, lede: '<p class="lede">x</p>' }, en)).toBe('<p class="lede">x</p>');
    expect(menyPage({ howto: howtoBody({ notes: false, lede: '' }, en) }, en)).not.toContain('data-meny="howto"');
  });
});

describe('no ? in the header (#1838)', () => {
  const parts = (help: string): HeaderParts => ({
    warden: '<b>W</b>', counters: '<i>day</i>', week: '', experiment: '', dev: '', playAi: '', weekly: '', features: '', look: '', help, feedback: '<i>fb</i>', reset: '',
  });
  const q = '<span class="ctl"><button class="pill" data-cmd="help">?</button></span>';

  it('with the notes on the page passes no help, so neither header draws a ?', () => {
    expect(headerControls(true, parts(''), '<i>gear</i>')).not.toContain('data-cmd="help"');
    expect(headerRows({ title: '<h1>T</h1>', counters: '', week: '', experiment: '', feedback: '', row2: '' }, '<i>gear</i>')).not.toContain('?');
  });

  it('off, the one-row header still has its ? as before', () => {
    expect(headerControls(true, parts(q), '<i>gear</i>')).toContain('data-cmd="help"');
  });
});
