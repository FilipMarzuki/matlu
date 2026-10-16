/**
 * Feedback reports (#1773, epic #1772): what a player writes in the 💬 panel, and what of it may be
 * kept in `artificer_feedback` (supabase/migrations/20261016090000_artificer_feedback.sql).
 *
 * Plain functions with no game code and no Node, so the page builds the report the way the server
 * checks it, and both strip the same things:
 * - The text is for everyone (the owner's call on #1772: "it's for all people, not only kids"), so
 *   it isn't cleaned the way a free question is: an email or a number typed into it stays. Only
 *   control and invisible characters go, and it's cut to FEEDBACK_CHARS. Line breaks stay: a pasted
 *   list or steps to reproduce read better as they were written.
 * - The attached context is structured: only the fields named here are kept, each cut to a length.
 * - The save (off unless the player ticks it) goes without the Warden's name (`stripWardenName`).
 * - The Warden's id and the run's record id are always attached, so a report ties to a run.
 * - An email, only if the player gives one for an answer. It's kept apart from everything else
 *   (its own column, `contact_email`) and never goes back out: not in the context, not in the
 *   answer, not in an error, not in a log, and triage (#1776) only says "contact: yes/no".
 * - Up to MAX_IMAGES screenshots, made small on the page (feedback-images.ts: at most 1600 px,
 *   re-encoded, which drops EXIF and GPS). The server checks each really is an image.
 *
 * Picks ("point at it", #1774) are already part of the shape, so that issue only has to fill them.
 */

/** The kinds of report. Swedish labels are the page's (Fel / Idé / Annat). */
export const FEEDBACK_KINDS = ['bug', 'idea', 'other'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** The free text's length, in characters (not UTF-16 units). */
export const FEEDBACK_CHARS = 2000;
/**
 * The whole request body, save and images included: three images of up to IMAGE_BYTES each are
 * about 4 MB as base64, and Vercel's functions take 4.5 MB, so the limit sits between.
 */
export const FEEDBACK_BODY_BYTES = 4_400_000;
/** Images a report may carry, and each one's size once decoded. */
export const MAX_IMAGES = 3;
export const IMAGE_BYTES = 1_000_000;
/** The image types kept, and the extension each is stored under. */
export const IMAGE_TYPES = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' } as const;
export type ImageType = keyof typeof IMAGE_TYPES;
/** The private Storage bucket the images go to (the migration makes it). */
export const IMAGE_BUCKET = 'artificer-feedback';
/** An email's longest (RFC 5321's path limit). */
export const EMAIL_CHARS = 254;
/** Reports kept per hashed address per hour, and from everyone per day (the free tier's guard). */
export const FEEDBACK_LIMITS = { perIpPerHour: 10, perDay: 1000 };
/** The journal lines a report may carry, and each line's length. */
export const JOURNAL_LINES = 10;
const JOURNAL_CHARS = 400;
/** Picks a report may carry (#1774). */
export const MAX_PICKS = 5;

/** Where the player was, as the page saw it. Every field optional: a part the page can't tell is left out. */
export interface FeedbackWhere {
  seed?: number;
  day?: number;
  /** Which of this browser's runs it is (1 for the first). */
  runNumber?: number;
  stage?: string;
  tab?: string;
  look?: string;
  lang?: string;
  dev?: boolean;
  /** The feature switches that are on (ids). */
  features?: string[];
  viewport?: { w: number; h: number };
  device?: 'phone' | 'tablet' | 'desktop';
}

export interface FeedbackBuild {
  /** The commit the page was built from (short sha), or "dev". */
  version?: string;
  /** When it was built (ISO date). */
  date?: string;
  /** The page's path, without the query (a query can hold anything). */
  path?: string;
}

/** The parts of the context the player left ticked. */
export interface FeedbackContext {
  build?: FeedbackBuild;
  where?: FeedbackWhere;
  journal?: string[];
}

/** One thing pointed at (#1774): structured text, never pixels. */
export interface FeedbackPick {
  text: string;
  role: string;
  path: string;
  rect: { x: number; y: number; w: number; h: number };
  tab: string;
}

/** An image as the page sends it: its type and its bytes as base64 (no `data:` prefix). */
export interface FeedbackImage {
  type: ImageType;
  data: string;
}

/** A report as the page sends it. */
export interface FeedbackBody {
  kind: FeedbackKind;
  text: string;
  /** The Warden's id: always attached. */
  wardenId: string;
  /** The run's game id in the records, once it's been sent there (#1559); null before. */
  runId: string | null;
  context: FeedbackContext;
  picks: FeedbackPick[];
  /** The save, without the Warden's name; null unless the player ticked it. */
  save: Record<string, unknown> | null;
  /** Screenshots, at most MAX_IMAGES. */
  images: FeedbackImage[];
  /** Only if they'd like an answer; '' otherwise. Never sent back, never logged. */
  email: string;
}

/** An image checked: its type and its bytes. */
export interface CheckedImage {
  type: ImageType;
  bytes: Uint8Array;
}

/** A report as kept: the body checked and cleaned, the images stored apart, and what the server adds. */
export interface Feedback extends Omit<FeedbackBody, 'images' | 'email'> {
  ref: string;
  surface: 'web' | 'console' | 'api' | 'mcp';
  build: string;
  ipWeekHash: string;
  /** Where the images were put in the bucket. */
  images: string[];
  /** The email, or null: its own column, never in `context`. */
  contactEmail: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A report's text fit to keep, or null if nothing is left. Line breaks stay (at most one blank
 * line in a row); every other control or invisible character goes; cut to `max` characters.
 * Nothing else is touched: an email or a phone number typed in stays (#1772).
 */
export function cleanFeedbackText(raw: unknown, max = FEEDBACK_CHARS): string | null {
  if (typeof raw !== 'string') return null;
  const flat = raw.normalize('NFC')
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    // Every control and format character but the line break: \p{Cc} holds \n, so it's spared by
    // hand. Other spacing (tabs, no-break spaces) becomes a plain space.
    .replace(/[^\S\n]|[\p{Cc}\p{Cf}]/gu, ch => (ch === '\n' ? '\n' : /\s/.test(ch) ? ' ' : ''))
    .split('\n').map(l => l.replace(/ {2,}/g, ' ').trimEnd()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // By characters, not UTF-16 units: half a letter outside the basic plane is text Postgres refuses.
  const text = [...flat].slice(0, max).join('').trim();
  return text || null;
}

/**
 * The email as given, '' for none, or null if it isn't a plausible address. Plausible only: one
 * @, something before it, a dot in what's after, no spaces. Whether it reaches anyone is the
 * owner's to find out when answering.
 */
export function cleanEmail(raw: unknown): string | null {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return '';
  if (s.length > EMAIL_CHARS) return null;
  return /^[^\s@\p{Cc}]{1,64}@[^\s@\p{Cc}.]+(?:\.[^\s@\p{Cc}.]+)+$/u.test(s) ? s : null;
}

/** The kind, or null if it isn't one. */
export const parseKind = (v: unknown): FeedbackKind | null =>
  typeof v === 'string' && (FEEDBACK_KINDS as readonly string[]).includes(v) ? (v as FeedbackKind) : null;

/** An id as the game makes them (`w-…`, a UUID): letters, digits and a few marks, short. */
export const cleanId = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(v) ? v : null);

/**
 * A reference for a report, "FB-" and four characters: Crockford-like, without 0 O 1 I L, so it
 * can be read out or typed back without guessing. 31⁴ ≈ 920 000 of them; the table's unique key
 * catches the rare repeat and the server draws again.
 */
export const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const REF_PATTERN = /^FB-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

export function makeRef(random: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += REF_ALPHABET[Math.min(REF_ALPHABET.length - 1, Math.floor(random() * REF_ALPHABET.length))];
  return `FB-${s}`;
}

// ── Images ───────────────────────────────────────────────────────────────────

/** The first bytes each image type starts with, so a file that only says it's an image is refused. */
function looksLike(type: ImageType, b: Uint8Array): boolean {
  const at = (i: number, ...xs: number[]): boolean => xs.every((x, k) => b[i + k] === x);
  if (type === 'image/png') return at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (type === 'image/jpeg') return at(0, 0xff, 0xd8, 0xff);
  return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50); // RIFF, size, WEBP
}

/** Base64 to bytes, or null if it isn't base64. `atob` is in browsers and in Node alike. */
function fromBase64(s: string): Uint8Array | null {
  if (s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export type ImagesChecked = { ok: true; images: CheckedImage[] } | { ok: false; error: string };

/** The images checked: how many, each one's type and size, and that its bytes are that type. */
export function checkImages(raw: unknown): ImagesChecked {
  if (raw === undefined || raw === null) return { ok: true, images: [] };
  if (!Array.isArray(raw)) return { ok: false, error: '"images" must be a list.' };
  if (raw.length > MAX_IMAGES) return { ok: false, error: `At most ${MAX_IMAGES} images.` };
  const images: CheckedImage[] = [];
  for (const [i, img] of raw.entries()) {
    const n = i + 1;
    if (!isObj(img) || typeof img.type !== 'string' || typeof img.data !== 'string') return { ok: false, error: `Image ${n} must be { "type", "data" }.` };
    if (!Object.hasOwn(IMAGE_TYPES, img.type)) return { ok: false, error: `Image ${n} isn't a WebP, JPEG or PNG image.` };
    // A quick bound before decoding: base64 is 4 characters for every 3 bytes.
    if (img.data.length > Math.ceil(IMAGE_BYTES / 3) * 4) return { ok: false, error: `Image ${n} is over ${IMAGE_BYTES} bytes.` };
    const bytes = fromBase64(img.data);
    if (!bytes) return { ok: false, error: `Image ${n} isn't base64.` };
    if (bytes.length > IMAGE_BYTES) return { ok: false, error: `Image ${n} is over ${IMAGE_BYTES} bytes.` };
    if (!looksLike(img.type as ImageType, bytes)) return { ok: false, error: `Image ${n} isn't the image it says it is.` };
    images.push({ type: img.type as ImageType, bytes });
  }
  return { ok: true, images };
}

// ── The context ──────────────────────────────────────────────────────────────

/** A short label (an id, a tab, a look): letters, digits and a few marks, cut. */
const label = (v: unknown, max = 64): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[^\p{L}\p{N} _.:/#@-]/gu, '').trim().slice(0, max);
  return s || undefined;
};
const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : undefined;
/** Drop the undefined fields, so the stored jsonb holds only what was there. */
const compact = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

function cleanBuild(v: unknown): FeedbackBuild | undefined {
  if (!isObj(v)) return undefined;
  // The path without a query or fragment: they can carry anything.
  const path = typeof v.path === 'string' ? label(v.path.split(/[?#]/)[0], 120) : undefined;
  const b = compact<FeedbackBuild>({ version: label(v.version, 40), date: label(v.date, 40), path });
  return Object.keys(b).length ? b : undefined;
}

function cleanWhere(v: unknown): FeedbackWhere | undefined {
  if (!isObj(v)) return undefined;
  const vp = isObj(v.viewport) ? { w: num(v.viewport.w, 0, 20_000) ?? 0, h: num(v.viewport.h, 0, 20_000) ?? 0 } : undefined;
  const device = v.device === 'phone' || v.device === 'tablet' || v.device === 'desktop' ? v.device : undefined;
  const features = Array.isArray(v.features) ? v.features.map(f => label(f, 48)).filter((f): f is string => !!f).slice(0, 64) : undefined;
  const w = compact<FeedbackWhere>({
    seed: num(v.seed, 0, 2 ** 32), day: num(v.day, 0, 10_000), runNumber: num(v.runNumber, 0, 100_000), stage: label(v.stage, 16), tab: label(v.tab, 24),
    look: label(v.look, 32), lang: label(v.lang, 8), dev: typeof v.dev === 'boolean' ? v.dev : undefined, features, viewport: vp, device,
  });
  return Object.keys(w).length ? w : undefined;
}

function cleanJournal(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const lines = v.slice(-JOURNAL_LINES).map(l => cleanFeedbackText(l, JOURNAL_CHARS)).filter((l): l is string => !!l);
  return lines.length ? lines : undefined;
}

/**
 * The context as kept: only the known parts and fields, cleaned. Never null: an empty object is
 * "nothing attached". Built field by field, so nothing the page adds (an email, say) can ride along.
 */
export function cleanContext(v: unknown): FeedbackContext {
  if (!isObj(v)) return {};
  return compact<FeedbackContext>({ build: cleanBuild(v.build), where: cleanWhere(v.where), journal: cleanJournal(v.journal) });
}

/** Picks as kept (#1774): at most MAX_PICKS, each part cut. */
export function cleanPicks(v: unknown): FeedbackPick[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).slice(0, MAX_PICKS).map(p => {
    const r = isObj(p.rect) ? p.rect : {};
    return {
      text: cleanFeedbackText(p.text, 200) ?? '',
      role: label(p.role, 80) ?? '',
      path: typeof p.path === 'string' ? [...p.path.replace(/[\p{Cc}\p{Cf}]/gu, '')].slice(0, 200).join('') : '',
      rect: { x: num(r.x, -20_000, 20_000) ?? 0, y: num(r.y, -20_000, 200_000) ?? 0, w: num(r.w, 0, 20_000) ?? 0, h: num(r.h, 0, 200_000) ?? 0 },
      tab: label(p.tab, 24) ?? '',
    };
  });
}

/**
 * The save without the Warden's name: the character's `name` blanked in the Reach and on the road,
 * and the name taken out of every string that holds it (the journal says it), whole words only.
 * A copy: the game's own state is never touched.
 */
export function stripWardenName(save: unknown): Record<string, unknown> | null {
  if (!isObj(save)) return null;
  const copy = structuredClone(save) as Record<string, unknown>;
  const names = new Set<string>();
  const blank = (holder: unknown): void => {
    if (!isObj(holder) || !isObj(holder.character)) return;
    const c = holder.character;
    if (typeof c.name === 'string' && c.name.trim()) names.add(c.name.trim());
    c.name = '';
  };
  blank(copy.sim);
  blank(copy.road);
  return withoutNames(copy, [...names]) as Record<string, unknown>;
}

/**
 * Every string in `v` with these names replaced by "the Warden", whole words only. Longest first,
 * so "Mira Ash" goes before "Mira" could leave " Ash" behind. A one-letter name would hit too many
 * words, so it's left (the save's own name field is blanked anyway).
 */
export function withoutNames<V>(v: V, names: readonly string[]): V {
  const words = names.map(n => n.trim()).filter(n => [...n].length >= 2).sort((a, b) => b.length - a.length);
  if (!words.length) return v;
  const escaped = words.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') return x.replace(re, 'the Warden');
    if (Array.isArray(x)) return x.map(walk);
    if (isObj(x)) return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
    return x;
  };
  return walk(v) as V;
}

// ── The whole body ───────────────────────────────────────────────────────────

/** What a checked body holds: the report as kept, with the images still as bytes (the server stores them, then keeps their paths). */
export interface CheckedFeedback extends Omit<Feedback, 'ref' | 'surface' | 'build' | 'ipWeekHash' | 'images'> {
  images: CheckedImage[];
}

/** A body that passed, or why it didn't (a sentence for the 400). No error ever quotes the email. */
export type Checked = { ok: true; body: CheckedFeedback } | { ok: false; error: string };

/** Check and clean what the page sent: the kind, the text, the ids, the context, picks, the save, images and the email. */
export function checkFeedback(raw: unknown): Checked {
  if (!isObj(raw)) return { ok: false, error: 'The body must be a JSON object.' };
  const kind = parseKind(raw.kind);
  if (!kind) return { ok: false, error: `"kind" must be one of ${FEEDBACK_KINDS.map(k => `"${k}"`).join(', ')}.` };
  if (typeof raw.text !== 'string') return { ok: false, error: '"text" must be a string.' };
  if ([...raw.text].length > FEEDBACK_CHARS) return { ok: false, error: `"text" is over ${FEEDBACK_CHARS} characters.` };
  const text = cleanFeedbackText(raw.text);
  if (!text) return { ok: false, error: 'There\'s nothing in that to send.' };
  const wardenId = cleanId(raw.wardenId);
  if (!wardenId) return { ok: false, error: '"wardenId" must be the Warden\'s id.' };
  if (raw.runId !== undefined && raw.runId !== null && !cleanId(raw.runId)) return { ok: false, error: '"runId" must be a run\'s id or null.' };
  if (raw.picks !== undefined && !Array.isArray(raw.picks)) return { ok: false, error: '"picks" must be a list.' };
  if (raw.save !== undefined && raw.save !== null && !isObj(raw.save)) return { ok: false, error: '"save" must be an object or null.' };
  const email = cleanEmail(raw.email);
  if (email === null) return { ok: false, error: 'That email doesn\'t look like an address. Leave it empty if you don\'t want an answer.' };
  const images = checkImages(raw.images);
  if (!images.ok) return images;
  return {
    ok: true,
    body: {
      kind, text, wardenId, runId: cleanId(raw.runId), context: cleanContext(raw.context), picks: cleanPicks(raw.picks),
      save: stripWardenName(raw.save), images: images.images, contactEmail: email || null,
    },
  };
}
