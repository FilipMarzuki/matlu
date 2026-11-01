/**
 * Tests for #1228 — what the intro says (the look is checked by screenshot; the card's own words and
 * buttons are in quick-start.test.ts), and its screen's markup: the pack heading (#1844) and the 💬
 * button on every beat (#1845).
 */

import { describe, it, expect } from 'vitest';
import { createRegion1 } from '../artificer/region1';
import { makeT } from '../artificer/i18n';
import { checkFeedback, cleanContext } from '../artificer-play/feedback';
import { blankDraft, feedbackBody, type Attachable } from './feedback-draft';
import { contrast } from './looks';
import { DEFAULT_AGE } from '../artificer/growing';
import { introBeats, introHtml, introWhere, artificerRank, conceptRanks, type Beat, type QuickStep } from './intro';

const READY: QuickStep = { step: 'ready', age: DEFAULT_AGE };
const CHANGE: QuickStep = { step: 'change', age: DEFAULT_AGE };
const en = makeT('en');
const heir = () => createRegion1({}, { known: [], concepts: {}, heirlooms: [{ item: 'stone-knife', grade: 'fine', heirloom: true }] });

describe('The intro (#1228, the quick start since #2009)', () => {
  // Packing is no longer a flashback (#1666): present tense, and nothing about "before any of this".
  it('packs in the present tense', () => {
    const pack = introBeats(createRegion1(), en, CHANGE).find(b => b.kind === 'pack')!;
    expect(pack.lines).toEqual(['What will you pack?']);
    expect(pack.lines.join(' ')).not.toMatch(/before any of this/i);
  });

  it('ranks a Warden by concept mastery', () => {
    const s = createRegion1({}, { known: ['snare', 'stone-knife'], concepts: { tension: 2, sealing: 1 } });
    expect(conceptRanks(s)).toBe(3);
    expect(artificerRank(s, {})).toBe('Journeyman');
  });

  // One run per Warden (#1455): every arrival is a new person, told what the last one left.
  it('tells a new Warden what the last one left, and no one else', () => {
    const all = introBeats(heir(), en, READY).flatMap(b => b.lines).join('\n');
    expect(all).toMatch(/Someone was here before you\./);
    expect(all).toMatch(/They left: a fine stone knife\./);
    expect(introBeats(createRegion1(), en, READY).flatMap(b => b.lines).join('\n')).not.toMatch(/Someone was here/);
  });

  // Every beat has a name (#1845), so feedback can say which screen it came from.
  it('names each beat, once', () => {
    expect(introBeats(heir(), en, READY).map(b => b.id)).toEqual(['fall', 'ready']);
    expect(introBeats(heir(), en, CHANGE).map(b => b.id)).toEqual(['fall', 'pack', 'create', 'ready']);
  });

  it('climbs Apprentice → Journeyman → Master by volume and depth (#1457)', () => {
    const at = (n: number) => artificerRank({ concepts: { a: { rank: n, insight: 0 } } }, {});
    expect([at(0), at(2), at(3), at(6), at(10)]).toEqual(['Apprentice', 'Apprentice', 'Journeyman', 'Journeyman', 'Master']);
  });
});

// ── The intro's screen (#1844, #1845) ────────────────────────────────────────

const FB = '<span class="ctl"><button class="pill fbbtn" data-cmd="feedback">💬</button></span>';
const view = (beat: Beat, i = 1, t = makeT('en')): string =>
  introHtml({ beat, i, count: 4, name: 'Signe', form: '', nextDisabled: false, feedback: FB, t });

describe('Intro screen', () => {
  const beats = introBeats(createRegion1(), en, CHANGE);

  it('shows the 💬 feedback button on every beat kind, in its own corner outside the beat and the bar', () => {
    const kinds = new Set(beats.map(b => b.kind));
    expect([...kinds].sort()).toEqual(['create', 'narration', 'pack', 'ready']);
    for (const b of beats) {
      const html = view(b, beats.indexOf(b));
      expect(html).toContain(`<div class="introfb">${FB}</div>`);
      // Not inside the beat (its words) nor the bar (Skip / Next).
      const beat = html.slice(html.indexOf('<div class="beat'), html.indexOf('<div class="introbar'));
      expect(beat).not.toContain('data-cmd="feedback"');
      expect(html.slice(html.indexOf('<div class="introbar'))).not.toContain('data-cmd="feedback"');
    }
  });

  it('makes the pack question a heading with its own class, in both languages', () => {
    const pack = beats.find(b => b.kind === 'pack')!;
    expect(view(pack)).toContain('<h2 class="packq" style="--n:0">What will you pack?</h2>');
    const sv = makeT('sv');
    expect(view(introBeats(createRegion1(), sv, CHANGE).find(b => b.kind === 'pack')!, 1, sv)).toContain('<h2 class="packq" style="--n:0">Vad packar du?</h2>');
    // Only the pack beat's lines are headings.
    for (const b of beats.filter(x => x.kind !== 'pack')) expect(view(b)).not.toContain('packq');
  });

  it('draws the pack heading in a colour that passes AA on the intro night sky and its panel', () => {
    // style.css `.packq`: var(--gold) (the intro keeps the default tokens), on rgba(13,14,26,.92)
    // over the sky's gradient #15122b → #05050b. Checked against each opaque end.
    for (const bg of ['#15122b', '#05050b', '#0d0e1a']) expect(contrast('#ffe066', bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('fills the name on the card, keeps Skip off it and holds Next when asked', () => {
    const card = view(beats.at(-1)!, 3);
    expect(card).toContain('You&#39;re Signe, 12, a scout.');
    expect(card).not.toContain('data-intro="skip"');
    expect(card).toContain('PLAY');
    const create = beats.find(b => b.kind === 'create')!;
    expect(introHtml({ beat: create, i: 2, count: 4, name: '', form: '<form></form>', nextDisabled: true, feedback: FB, t: makeT('en') })).toMatch(/<form><\/form><\/div>[\s\S]*data-intro="next" disabled/);
  });

  it('puts the beat into the context feedback sends, and the server keeps it', () => {
    const pack = beats.find(b => b.kind === 'pack')!;
    expect(introWhere(pack)).toEqual({ stage: 'intro', tab: 'intro: pack' });
    const a: Attachable = {
      wardenId: 'w-1', runId: null, build: { version: 'dev' },
      where: { day: 0, ...introWhere(pack), lang: 'en' },
      journal: [], save: null,
    };
    const body = feedbackBody({ ...blankDraft(), text: 'Where do I scroll?' }, a);
    expect(body.context.where).toMatchObject({ stage: 'intro', tab: 'intro: pack' });
    const checked = checkFeedback(body);
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.body.context.where).toMatchObject({ stage: 'intro', tab: 'intro: pack' });
    // Every beat's name fits the field and survives the server's cleaning.
    for (const b of introBeats(heir(), en, CHANGE)) {
      expect(cleanContext({ where: introWhere(b) }).where).toEqual(introWhere(b));
    }
  });
});
