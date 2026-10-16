/**
 * #1773: the feedback panel's draft (kept in this browser, every access wrapped) and the body it
 * builds from the draft and what the page can attach.
 */

import { describe, it, expect } from 'vitest';
import { blankDraft, bodyBytes, clearedDraft, deviceOf, DRAFT_KEY, feedbackBody, hasDraft, IMAGES_KEY, lastJournal, loadDraft, saveDraft, type Attachable, type DraftStorage } from './feedback-draft';
import { fitWithin } from './feedback-images';
import { checkFeedback } from '../artificer-play/feedback';

/** A Storage in a Map, as localStorage behaves. */
function mapStorage(quota = Infinity): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => {
      if (v.length > quota) throw new DOMException('quota', 'QuotaExceededError');
      map.set(k, v);
    },
    removeItem: k => { map.delete(k); },
  };
}
/** A Storage that throws on everything, as a blocked one does. */
const throwing: DraftStorage = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
  removeItem: () => { throw new Error('blocked'); },
};

const IMG = { type: 'image/png' as const, data: 'iVBORw0KGgo=' };

describe('the draft is kept in this browser (#1773)', () => {
  it('saves and loads back the same draft, the images under their own key', () => {
    const s = mapStorage();
    const d = { ...blankDraft(), kind: 'idea' as const, text: 'More fish\nplease', email: 'a@b.se', images: [IMG], panel: 'min' as const, sheet: 'full' as const, ticks: { build: false, where: true, journal: true, save: true } };
    expect(saveDraft(d, s)).toBe(true);
    expect(s.map.get(DRAFT_KEY)).not.toContain('iVBOR');
    expect(s.map.has(IMAGES_KEY)).toBe(true);
    expect(loadDraft(s)).toEqual(d);
  });

  it('is blank with nothing kept, or something that is not a draft', () => {
    expect(loadDraft(mapStorage())).toEqual(blankDraft());
    const s = mapStorage();
    s.setItem(DRAFT_KEY, '{oops');
    expect(loadDraft(s)).toEqual(blankDraft());
    s.setItem(DRAFT_KEY, JSON.stringify({ kind: 'rant', text: 7, panel: 'wide', ticks: { save: 'yes' } }));
    expect(loadDraft(s)).toEqual(blankDraft());
  });

  it('never throws when storage throws or is missing: blank to load, false to save', () => {
    expect(loadDraft(throwing)).toEqual(blankDraft());
    expect(loadDraft(null)).toEqual(blankDraft());
    expect(saveDraft({ ...blankDraft(), text: 'x' }, throwing)).toBe(false);
    expect(saveDraft({ ...blankDraft(), text: 'x' }, null)).toBe(false);
  });

  it('keeps the words when the images are over the quota', () => {
    const s = mapStorage(1000);
    const d = { ...blankDraft(), text: 'words', images: [{ type: 'image/png' as const, data: 'A'.repeat(2000) }] };
    expect(saveDraft(d, s)).toBe(true);
    expect(loadDraft(s).text).toBe('words');
    expect(loadDraft(s).images).toEqual([]);
  });

  it('after a send, the words go and where the panel sits stays', () => {
    const d = { ...blankDraft(), kind: 'idea' as const, text: 'x', email: 'a@b.se', images: [IMG], panel: 'open' as const, sheet: 'peek' as const };
    const c = clearedDraft(d);
    expect(c).toMatchObject({ text: '', email: '', images: [], kind: 'idea', panel: 'open', sheet: 'peek' });
    expect(hasDraft(c)).toBe(false);
    expect(hasDraft(d)).toBe(true);
  });
});

describe('the body the panel sends (#1773)', () => {
  const attachable: Attachable = {
    wardenId: 'w-1', runId: null,
    build: { version: 'abc1234', date: '2026-10-16T10:00Z', path: '/' },
    where: { day: 3, tab: 'plan', lang: 'sv' },
    journal: lastJournal(Array.from({ length: 14 }, (_, i) => ({ day: i + 1, text: `Mira did thing ${i + 1}` }))),
    save: { sim: { character: { id: 'w-1', name: 'Mira' }, log: [{ day: 1, text: 'Mira wakes.' }] } },
    wardenName: 'Mira',
  };

  it('always carries the Warden and run ids, and the ticked parts only', () => {
    const b = feedbackBody({ ...blankDraft(), text: 'Bug', ticks: { build: true, where: false, journal: true, save: false } }, attachable);
    expect(b.wardenId).toBe('w-1');
    expect(b.runId).toBeNull();
    expect(b.context.build).toEqual(attachable.build);
    expect(b.context.where).toBeUndefined();
    expect(b.context.journal).toHaveLength(10);
    expect(b.context.journal![9]).toBe('D14 the Warden did thing 14');
    expect(b.save).toBeNull();
    expect(b.picks).toEqual([]);
    expect(checkFeedback(b).ok).toBe(true);
  });

  it("sends the save only when ticked, and without the Warden's name", () => {
    const b = feedbackBody({ ...blankDraft(), text: 'Bug', ticks: { build: true, where: true, journal: true, save: true } }, attachable);
    expect(JSON.stringify(b.save)).not.toContain('Mira');
    expect((b.save as { sim: { character: { id: string } } }).sim.character.id).toBe('w-1');
  });

  it('keeps the email out of the context', () => {
    const b = feedbackBody({ ...blankDraft(), text: 'Bug', email: ' me@example.com ' }, attachable);
    expect(b.email).toBe('me@example.com');
    expect(JSON.stringify(b.context)).not.toContain('example.com');
    expect(bodyBytes(b)).toBeGreaterThan(0);
  });
});

describe('small helpers (#1773)', () => {
  it('tells phones, tablets and desktops apart', () => {
    expect(deviceOf(400, true)).toBe('phone');
    expect(deviceOf(1024, true)).toBe('tablet');
    expect(deviceOf(1440, false)).toBe('desktop');
  });

  it('fits an image within 1600 px on its long side, never upscaling', () => {
    expect(fitWithin(4000, 3000)).toEqual({ w: 1600, h: 1200 });
    expect(fitWithin(1200, 5000)).toEqual({ w: 384, h: 1600 });
    expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 });
  });
});
