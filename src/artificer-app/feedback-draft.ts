/**
 * The 💬 feedback panel's data (#1773): the draft kept in this browser, the context the page
 * attaches, and the body it sends. No DOM here (feedback-panel.ts draws it), so it's all testable.
 *
 * The draft lives in localStorage until it's sent or thrown away, so a reload never loses what
 * someone wrote. Storage can be missing or blocked (a private window, cleared site data), so every
 * read and write is wrapped: without it the panel still works, the draft just lasts this visit.
 * The images are kept under their own key: they're big, and if they don't fit the words still do.
 */

import { FEEDBACK_CHARS, IMAGE_TYPES, JOURNAL_LINES, MAX_IMAGES, MAX_PICKS, parseKind, stripWardenName, withoutNames, type FeedbackBody, type FeedbackBuild, type FeedbackContext, type FeedbackImage, type FeedbackKind, type FeedbackPick, type FeedbackWhere } from '../artificer-play/feedback';

export const DRAFT_KEY = 'artificer.feedback.draft.v1';
export const IMAGES_KEY = 'artificer.feedback.images.v1';

/** The parts of the context, each a box the player can untick. The save starts unticked. */
export const CONTEXT_PARTS = ['build', 'where', 'journal', 'save'] as const;
export type ContextPart = (typeof CONTEXT_PARTS)[number];
export type Ticks = Record<ContextPart, boolean>;
export const DEFAULT_TICKS: Ticks = { build: true, where: true, journal: true, save: false };

/** What's kept between visits: the words, the kind, the ticks, and where the panel was left. */
export interface Draft {
  kind: FeedbackKind;
  text: string;
  /** Only for an answer. Kept with the draft (it's this browser's), sent in its own field. */
  email: string;
  ticks: Ticks;
  /** Picks (#1774): kept with the draft so a reload keeps them too. Empty until then. */
  picks: FeedbackPick[];
  /** Screenshots, already made small (feedback-images.ts). Stored under IMAGES_KEY. */
  images: FeedbackImage[];
  /** How the panel was left: shut, open, or minimized to its pill. */
  panel: 'closed' | 'open' | 'min';
  /** The bottom sheet's height on a phone. */
  sheet: 'peek' | 'half' | 'full';
}

export const blankDraft = (): Draft => ({ kind: 'bug', text: '', email: '', ticks: { ...DEFAULT_TICKS }, picks: [], images: [], panel: 'closed', sheet: 'half' });

/** The bits of Storage the draft needs, so tests can hand in one that throws. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The browser's storage, or null where even touching `localStorage` throws (some private modes). */
export function browserStorage(): DraftStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

const read = (store: DraftStorage | null, key: string): string | null => {
  try { return store?.getItem(key) ?? null; } catch { return null; }
};
const parse = (raw: string | null): unknown => {
  if (!raw) return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
};

/** Kept images, if they still look like the panel's own. */
function keptImages(v: unknown): FeedbackImage[] {
  if (!Array.isArray(v)) return [];
  return v.filter((i): i is FeedbackImage => !!i && typeof i === 'object' && typeof i.data === 'string' && Object.hasOwn(IMAGE_TYPES, i.type)).slice(0, MAX_IMAGES);
}

/** The kept draft, or a blank one when there's none, it can't be read, or it isn't one. */
export function loadDraft(store: DraftStorage | null = browserStorage()): Draft {
  const blank = blankDraft();
  const d = parse(read(store, DRAFT_KEY)) as Partial<Draft> | null;
  const images = keptImages(parse(read(store, IMAGES_KEY)));
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ...blank, images };
  const ticks = { ...blank.ticks };
  for (const p of CONTEXT_PARTS) if (typeof d.ticks?.[p] === 'boolean') ticks[p] = d.ticks[p];
  return {
    kind: parseKind(d.kind) ?? blank.kind,
    text: typeof d.text === 'string' ? [...d.text].slice(0, FEEDBACK_CHARS).join('') : '',
    email: typeof d.email === 'string' ? d.email.slice(0, 254) : '',
    ticks,
    picks: Array.isArray(d.picks) ? d.picks.slice(0, MAX_PICKS) : [],
    images,
    panel: d.panel === 'open' || d.panel === 'min' ? d.panel : 'closed',
    sheet: d.sheet === 'peek' || d.sheet === 'full' ? d.sheet : 'half',
  };
}

/**
 * Keep the draft: the words under one key, the images under another. True if the words were kept
 * (images that don't fit the browser's quota are only this visit's; the words matter more).
 */
export function saveDraft(d: Draft, store: DraftStorage | null = browserStorage()): boolean {
  if (!store) return false;
  const { images, ...words } = d;
  let ok = false;
  try { store.setItem(DRAFT_KEY, JSON.stringify(words)); ok = true; } catch { /* this visit only */ }
  try {
    if (images.length) store.setItem(IMAGES_KEY, JSON.stringify(images));
    else store.removeItem(IMAGES_KEY);
  } catch {
    try { store.removeItem(IMAGES_KEY); } catch { /* nothing to clear */ }
  }
  return ok;
}

/** After a send: the words, email, picks, images and ticks go; where the panel sits stays. */
export function clearedDraft(d: Draft): Draft {
  return { ...blankDraft(), kind: d.kind, panel: d.panel, sheet: d.sheet };
}

/** Is there anything in the draft worth a "draft" mark? */
export const hasDraft = (d: Draft): boolean => d.text.trim().length > 0 || d.picks.length > 0 || d.images.length > 0;

/** The device class, from the viewport and the pointer: what a bug that only shows on phones needs. */
export function deviceOf(width: number, coarse: boolean): FeedbackWhere['device'] {
  if (width <= 720) return 'phone';
  return coarse && width <= 1280 ? 'tablet' : 'desktop';
}

/** The last `JOURNAL_LINES` lines of a journal, oldest first, as "D3 text". */
export function lastJournal(log: readonly { day: number; text: string }[], mark = 'D'): string[] {
  return log.slice(-JOURNAL_LINES).map(l => `${mark}${l.day} ${l.text}`);
}

/** Everything the page could attach right now; the ticks choose what goes. */
export interface Attachable {
  /** Always attached. */
  wardenId: string;
  runId: string | null;
  build: FeedbackBuild;
  where: FeedbackWhere;
  journal: string[];
  /** The save as stored (the parsed JSON), or null if there's none. */
  save: unknown;
  /** The Warden's name, taken out of the journal lines too. */
  wardenName?: string;
}

/** The body to send: the draft's words, kind, images and email, the ids, and the ticked parts of what's attachable. */
export function feedbackBody(d: Draft, a: Attachable): FeedbackBody {
  const context: FeedbackContext = {};
  if (d.ticks.build) context.build = a.build;
  if (d.ticks.where) context.where = a.where;
  if (d.ticks.journal && a.journal.length) context.journal = withoutNames(a.journal.slice(-JOURNAL_LINES), a.wardenName ? [a.wardenName] : []);
  return {
    kind: d.kind, text: d.text, wardenId: a.wardenId, runId: a.runId, context, picks: d.picks,
    save: d.ticks.save ? stripWardenName(a.save) : null, images: d.images, email: d.email.trim(),
  };
}

/** The body's size in bytes, as the server counts it: what decides whether the save fits. */
export const bodyBytes = (b: FeedbackBody): number => new TextEncoder().encode(JSON.stringify(b)).length;
