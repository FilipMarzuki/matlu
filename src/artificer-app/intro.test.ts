/**
 * Tests for #1228 — what the arrival intro says (the look is checked by screenshot), and its
 * screen's markup: the pack heading (#1844) and the 💬 button on every beat (#1845).
 */

import { describe, it, expect } from 'vitest';
import { createRegion1 } from '../artificer/region1';
import { makeT } from '../artificer/i18n';
import { checkFeedback, cleanContext } from '../artificer-play/feedback';
import { blankDraft, feedbackBody, type Attachable } from './feedback-draft';
import { contrast } from './looks';
import { introBeats, introHtml, introWhere, artificerRank, conceptRanks, fillName, type Beat } from './intro';

describe('Arrival intro', () => {
  it('designates a fresh Warden as an Apprentice Artificer and closes on the motto', () => {
    const beats = introBeats(createRegion1());
    const all = beats.flatMap(b => b.lines).join('\n');
    // The weekend comes first (#1666): the hike page, then packing, then the portal.
    expect(beats[0].kind).toBe('narration');
    expect(beats[0].portal).toBeUndefined();
    expect(beats[0].lines.join(' ')).toMatch(/patrol.*weekend hike/);
    expect(beats[1].kind).toBe('pack');
    expect(beats[1].lines).toEqual(['What will you pack?']);
    expect(beats.filter(b => b.kind === 'pack')).toHaveLength(1);
    expect(beats[2]).toMatchObject({ kind: 'narration', portal: true });
    expect(all).toMatch(/Crafting knowledge exceeds threshold/);
    expect(all).toMatch(/CLASS DESIGNATED: ARTIFICER/);
    expect(all).toMatch(/RANK: APPRENTICE/);
    expect(all).toMatch(/Winter is coming\. Survive!/);
    expect(all).not.toMatch(/Region:|until the thaw/);
    expect(beats.at(-1)).toEqual({ id: 'title', kind: 'title', lines: ['SURVIVE.', 'THRIVE.', 'MASTER YOUR NEW REALITY.'] });
    // Character creation (#1239) comes right after the designation, and the voice then uses the name.
    const create = beats.findIndex(b => b.kind === 'create');
    expect(beats[create - 1].lines[0]).toBe('CLASS DESIGNATED: ARTIFICER');
    expect(fillName(beats[create + 1].lines[0], 'Vega')).toBe('Registered: Vega.');
    expect(fillName(beats[create + 1].lines[0], '  ')).toBe('Registered: Artificer.');
  });

  // Packing is no longer a flashback (#1666): present tense, and nothing about "before any of this".
  it('packs in the present tense', () => {
    const pack = introBeats(createRegion1()).find(b => b.kind === 'pack')!;
    expect(pack.lines.join(' ')).not.toMatch(/before any of this/i);
    expect(pack.lines.join(' ')).not.toMatch(/What did you pack/);
  });

  it('ranks a Warden by concept mastery', () => {
    const s = createRegion1({}, { known: ['snare', 'stone-knife'], concepts: { tension: 2, sealing: 1 } });
    expect(conceptRanks(s)).toBe(3);
    expect(artificerRank(s, {})).toBe('Journeyman');
    expect(introBeats(s).flatMap(b => b.lines).join('\n')).toMatch(/RANK: JOURNEYMAN/);
  });

  // One run per Warden (#1455): every arrival is a new person, told what the last one left.
  it('tells a new Warden what the last one left', () => {
    const s = createRegion1({}, { known: [], concepts: {}, heirlooms: [{ item: 'stone-knife', grade: 'fine', heirloom: true }] });
    const beats = introBeats(s);
    const all = beats.flatMap(b => b.lines).join('\n');
    expect(all).toMatch(/Someone was here before you\./);
    expect(all).toMatch(/They left: a fine stone knife\./);
    // Still a new person: the creation screen runs, and the heirloom line comes after registration.
    expect(beats.findIndex(b => b.lines[0] === 'Someone was here before you.')).toBeGreaterThan(beats.findIndex(b => b.kind === 'create'));
    expect(introBeats(createRegion1()).flatMap(b => b.lines).join('\n')).not.toMatch(/Someone was here/);
  });

  // Every beat has a name (#1845), so feedback can say which screen it came from.
  it('names each beat, once', () => {
    const s = createRegion1({}, { known: [], concepts: {}, heirlooms: [{ item: 'stone-knife', grade: 'fine', heirloom: true }] });
    const ids = introBeats(s).map(b => b.id);
    expect(ids).toEqual(['hike', 'pack', 'portal', 'stone', 'arrival', 'class', 'create', 'registered', 'before', 'title']);
    expect(introBeats(createRegion1()).map(b => b.id)).not.toContain('before');
  });

  it('climbs Apprentice → Journeyman → Master by volume and depth (#1457)', () => {
    const at = (n: number) => artificerRank({ concepts: { a: { rank: n, insight: 0 } } }, {});
    expect([at(0), at(2), at(3), at(6), at(10)]).toEqual(['Apprentice', 'Apprentice', 'Journeyman', 'Journeyman', 'Master']);
  });
});

// ── The intro's screen (#1844, #1845) ────────────────────────────────────────

const FB = '<span class="ctl"><button class="pill fbbtn" data-cmd="feedback">💬</button></span>';
const view = (beat: Beat, i = 1, t = makeT('en')): string =>
  introHtml({ beat, i, count: 9, name: 'Signe', form: '', nextDisabled: false, feedback: FB, t });

describe('Intro screen', () => {
  const beats = introBeats(createRegion1());

  it('shows the 💬 feedback button on every beat kind, in its own corner outside the beat and the bar', () => {
    const kinds = new Set(beats.map(b => b.kind));
    expect([...kinds].sort()).toEqual(['create', 'narration', 'pack', 'title', 'voice']);
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
    expect(view(introBeats(createRegion1(), sv).find(b => b.kind === 'pack')!, 1, sv)).toContain('<h2 class="packq" style="--n:0">Vad packar du?</h2>');
    // Only the pack beat's lines are headings.
    for (const b of beats.filter(x => x.kind !== 'pack')) expect(view(b)).not.toContain('packq');
  });

  it('draws the pack heading in a colour that passes AA on the intro night sky and its panel', () => {
    // style.css `.packq`: var(--gold) (the intro keeps the default tokens), on rgba(13,14,26,.92)
    // over the sky's gradient #15122b → #05050b. Checked against each opaque end.
    for (const bg of ['#15122b', '#05050b', '#0d0e1a']) expect(contrast('#ffe066', bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('still fills the name, keeps Skip off the last beat and holds Next when asked', () => {
    const reg = beats.find(b => b.id === 'registered')!;
    expect(view(reg)).toContain('Registered: Signe.');
    const last = view(beats.at(-1)!, 8);
    expect(last).not.toContain('data-intro="skip"');
    expect(last).toContain('BEGIN');
    const create = beats.find(b => b.kind === 'create')!;
    expect(introHtml({ beat: create, i: 6, count: 9, name: '', form: '<form></form>', nextDisabled: true, feedback: FB, t: makeT('en') })).toMatch(/<form><\/form><\/div>[\s\S]*data-intro="next" disabled/);
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
    for (const b of introBeats(createRegion1({}, { known: [], concepts: {}, heirlooms: [{ item: 'stone-knife', grade: 'fine', heirloom: true }] }))) {
      expect(cleanContext({ where: introWhere(b) }).where).toEqual(introWhere(b));
    }
  });
});
