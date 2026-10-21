/**
 * The 💬 feedback panel (#1773, epic #1772): always reachable, never in the way.
 *
 * - Desktop: docked on the right, about 340px wide, and the page narrows to make room
 *   (`html.fb-docked` pads the body). There's no backdrop and no focus trap, so every button in
 *   the game stays clickable and you can keep playing while you write.
 * - Phone: a bottom sheet, peek (a 56px bar), half or full height. At peek and half the page above
 *   is padded clear of it, so the game stays usable.
 * - Minimize (–, or Esc) shrinks it to a pill in the corner; × shuts it. Neither loses the draft,
 *   which is kept in this browser (feedback-draft.ts) until it's sent or thrown away.
 *
 * It lives outside the game's root (`#app`), which the game redraws on every move: the panel is
 * built once per language and then only updated in place, so typing never loses the caret.
 */

import { FEEDBACK_BODY_BYTES, FEEDBACK_CHARS, FEEDBACK_KINDS, JOURNAL_LINES, MAX_IMAGES, cleanEmail, cleanFeedbackText, type FeedbackKind } from '../artificer-play/feedback';
import { bodyBytes, browserStorage, clearedDraft, CONTEXT_PARTS, feedbackBody, hasDraft, loadDraft, saveDraft, type Attachable, type ContextPart, type Draft } from './feedback-draft';
import { filesOf, shrinkImage } from './feedback-images';
import { esc } from './html';
import type { T } from '../artificer/i18n';

/** Where a report goes: the play API, same origin (src/artificer-play/api.ts). */
export const FEEDBACK_URL = '/api/v1/feedback';
/** The width above which the panel docks on the right; at and below, it's a bottom sheet. */
export const PHONE_MAX = 720;

export interface FeedbackHost {
  /** The page's translate function, as it is now. */
  t: () => T;
  /** The page's language: the panel's markup is rebuilt when it changes (`t` itself is remade on every draw). */
  lang: () => string;
  /** What can be attached, read when the panel shows it and when it sends. */
  attachable: () => Attachable;
}

export interface FeedbackPanel {
  /** Shift+F and the 💬 button: open it (and put the caret in the text), or minimize it if open. */
  toggle(): void;
  open(): void;
  minimize(): void;
  /** The header button's HTML, drawn by the game's header. */
  button(t: T): string;
  /** The game redrew (or changed language): bring the panel's words and the context up to date. */
  refresh(): void;
}

const isEditable = (el: EventTarget | null): boolean => {
  const e = el as HTMLElement | null;
  return !!e && (e.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName));
};

export function installFeedback(host: FeedbackHost): FeedbackPanel {
  const storage = browserStorage();
  let draft: Draft = loadDraft(storage);
  let builtFor: string | null = null;
  /** The last thing said under Send, and whether the draft could be kept. */
  let status = '';
  let kept = true;
  let sending = false;

  const el = document.createElement('aside');
  el.className = 'fbpanel';
  el.id = 'fbpanel';
  el.setAttribute('role', 'complementary');
  const pill = document.createElement('button');
  pill.className = 'fbpill';
  pill.type = 'button';
  pill.dataset.fb = 'open';
  document.body.append(el, pill);

  const t = (): T => host.t();
  const q = <E extends Element>(sel: string): E | null => el.querySelector<E>(sel);

  function keep(): void {
    kept = saveDraft(draft, storage);
  }

  /** The page's layout classes: docked on the right, or a sheet of some height at the bottom. */
  function layout(): void {
    const html = document.documentElement;
    const open = draft.panel === 'open';
    html.classList.toggle('fb-docked', open);
    for (const s of ['peek', 'half', 'full'] as const) html.classList.toggle(`fb-sheet-${s}`, open && draft.sheet === s);
    el.hidden = !open;
    el.dataset.sheet = draft.sheet;
    pill.hidden = draft.panel !== 'min';
    const tt = t();
    const imgs = draft.images.length ? ` · ${tt(draft.images.length === 1 ? 'fb.pillImages.one' : 'fb.pillImages.other', { n: draft.images.length })}` : '';
    pill.textContent = hasDraft(draft) ? `${tt('fb.pillDraft')}${imgs}` : tt('fb.pill');
    pill.setAttribute('aria-label', tt('fb.title'));
    // The header button says whether the panel is open (it's in the game's root: found each time).
    for (const b of document.querySelectorAll<HTMLElement>('[data-cmd="feedback"]')) b.setAttribute('aria-pressed', String(open));
    const peek = q<HTMLElement>('.fbpeek');
    if (peek) peek.textContent = tt(hasDraft(draft) ? 'fb.peek' : 'fb.peekEmpty');
  }

  /** Build the panel's markup: once per language (the form's values are set after, from the draft). */
  function build(): void {
    const tt = t();
    builtFor = host.lang();
    el.setAttribute('aria-label', tt('fb.title'));
    const kinds = FEEDBACK_KINDS.map(k => `<button type="button" class="pill fbkind" data-fbkind="${k}" aria-pressed="false">${esc(tt(`fb.kind.${k}`))}</button>`).join('');
    const sheet = (['peek', 'half', 'full'] as const).map(s => `<button type="button" class="fbicon fbsheetbtn" data-fbsheet="${s}" aria-label="${esc(tt(s === 'peek' ? 'fb.sheetPeek' : s === 'half' ? 'fb.sheetHalf' : 'fb.sheetFull'))}">${s === 'peek' ? '▁' : s === 'half' ? '▄' : '█'}</button>`).join('');
    const ticks = CONTEXT_PARTS.map(p => `<li><label><input type="checkbox" data-fbtick="${p}"> <span>${esc(tt(`fb.part.${p}`, { n: JOURNAL_LINES }))}</span></label><div class="fbval" data-fbval="${p}"></div></li>`).join('');
    el.innerHTML = `
      <div class="fbhead">
        <button type="button" class="fbgrab" data-fb="grab"><span class="fbpeek"></span></button>
        <h2 class="fbtitle">💬 ${esc(tt('fb.title'))}</h2>
        <span class="fbsheet">${sheet}</span>
        <button type="button" class="fbicon" data-fb="min" aria-label="${esc(tt('fb.minimize'))}" title="${esc(tt('fb.minimize'))}">–</button>
        <button type="button" class="fbicon" data-fb="close" aria-label="${esc(tt('fb.close'))}" title="${esc(tt('fb.close'))}">×</button>
      </div>
      <div class="fbbody">
        <div class="fbkinds" role="group" aria-label="${esc(tt('fb.kind'))}">${kinds}</div>
        <label class="sr-only" for="fbtext">${esc(tt('fb.textLabel'))}</label>
        <textarea id="fbtext" class="fbtext" rows="6" maxlength="${FEEDBACK_CHARS}"></textarea>
        <div class="fbrow">
          <button type="button" class="pill" data-fb="attach" title="${esc(tt('fb.attachTip', { max: MAX_IMAGES }))}">${esc(tt('fb.attach'))}</button>
          <input type="file" class="fbfile" accept="image/*" multiple hidden>
          <span class="fbcount" aria-live="off"></span>
        </div>
        <ul class="fbthumbs"></ul>
        <p class="fbnote fbimgnote">${esc(tt('fb.imagesNote'))}</p>
        <p class="fbnote fbimgmsg" aria-live="polite"></p>
        <details class="fbctx"><summary>${esc(tt('fb.alsoSent'))}</summary>
          <p class="fbnote fbalways"></p>
          <ul class="fbticks">${ticks}</ul>
        </details>
        <label class="fbemail"><span>${esc(tt('fb.email'))}</span>
          <input type="email" id="fbemail" autocomplete="email" inputmode="email" maxlength="254">
          <span class="fbnote">${esc(tt('fb.emailNote'))}</span>
        </label>
        <div class="fbsend">
          <button type="button" class="btn go" data-fb="send">${esc(tt('fb.send'))}</button>
          <span class="fbstatus" aria-live="polite"></span>
        </div>
        <button type="button" class="fblink" data-fb="discard">${esc(tt('fb.discard'))}</button>
      </div>`;
    fill();
  }

  /** Put the draft into the form, and everything that follows from it. */
  function fill(): void {
    const tt = t();
    const text = q<HTMLTextAreaElement>('#fbtext');
    if (text && text.value !== draft.text) text.value = draft.text;
    if (text) text.placeholder = tt(`fb.placeholder.${draft.kind}`);
    const email = q<HTMLInputElement>('#fbemail');
    if (email && email.value !== draft.email) email.value = draft.email;
    for (const b of el.querySelectorAll<HTMLElement>('[data-fbkind]')) b.setAttribute('aria-pressed', String(b.dataset.fbkind === draft.kind));
    for (const b of el.querySelectorAll<HTMLInputElement>('[data-fbtick]')) b.checked = draft.ticks[b.dataset.fbtick as ContextPart];
    for (const b of el.querySelectorAll<HTMLElement>('[data-fbsheet]')) b.setAttribute('aria-pressed', String(b.dataset.fbsheet === draft.sheet));
    const thumbs = q<HTMLElement>('.fbthumbs');
    if (thumbs) {
      thumbs.innerHTML = draft.images.map((img, i) => `<li><img src="data:${img.type};base64,${img.data}" alt="${esc(tt('fb.imageAlt', { n: i + 1 }))}"><button type="button" class="fbicon fbrm" data-fbrm="${i}" aria-label="${esc(tt('fb.imageRemove', { n: i + 1 }))}">×</button></li>`).join('');
    }
    q<HTMLElement>('.fbimgnote')!.hidden = draft.images.length === 0;
    const attach = q<HTMLButtonElement>('[data-fb="attach"]');
    if (attach) attach.disabled = draft.images.length >= MAX_IMAGES;
    counts();
    context();
    say();
    layout();
  }

  function counts(): void {
    const c = q<HTMLElement>('.fbcount');
    if (c) c.textContent = t()('fb.count', { n: [...draft.text].length, max: FEEDBACK_CHARS });
  }

  /** The "Also sent" list's values: what each ticked part holds right now. */
  function context(): void {
    const details = q<HTMLDetailsElement>('.fbctx');
    if (!details?.open) return; // only drawn when it's looked at
    const a = host.attachable();
    const tt = t();
    q<HTMLElement>('.fbalways')!.textContent = tt('fb.alwaysSent', { warden: a.wardenId, run: a.runId ?? tt('fb.runNone') });
    const w = a.where;
    const vals: Record<ContextPart, string> = {
      build: [a.build.version, a.build.date, a.build.path].filter(Boolean).join(' · '),
      where: [w.day !== undefined ? `day ${w.day}` : '', w.stage, w.tab, w.look, w.lang, w.dev ? 'dev' : '', w.device, w.viewport ? `${w.viewport.w}×${w.viewport.h}` : '', w.features?.length ? `${w.features.length} features` : ''].filter(Boolean).join(' · '),
      journal: a.journal.slice(-3).join('\n'),
      save: '',
    };
    for (const p of CONTEXT_PARTS) {
      const v = q<HTMLElement>(`[data-fbval="${p}"]`);
      if (v) v.textContent = vals[p];
    }
  }

  function say(): void {
    const s = q<HTMLElement>('.fbstatus');
    if (s) s.textContent = status || (hasDraft(draft) ? t()(kept ? 'fb.saved' : 'fb.notSaved') : '');
    const send = q<HTMLButtonElement>('[data-fb="send"]');
    if (send) { send.disabled = sending; send.textContent = t()(sending ? 'fb.sending' : 'fb.send'); }
  }

  function setPanel(p: Draft['panel']): void {
    draft = { ...draft, panel: p };
    keep();
    layout();
  }

  function open(): void {
    if (builtFor !== host.lang()) build();
    setPanel('open');
    // On a phone a peeking sheet opens to half, so there's room to write.
    if (window.innerWidth <= PHONE_MAX && draft.sheet === 'peek') { draft = { ...draft, sheet: 'half' }; keep(); fill(); }
    context();
    q<HTMLTextAreaElement>('#fbtext')?.focus({ preventScroll: true });
  }

  function minimize(): void {
    if (draft.panel === 'closed') return;
    const hadFocus = el.contains(document.activeElement);
    setPanel('min');
    if (hadFocus) pill.focus({ preventScroll: true });
  }

  async function addFiles(files: File[]): Promise<void> {
    const msg = q<HTMLElement>('.fbimgmsg')!;
    msg.textContent = '';
    for (const f of files) {
      if (draft.images.length >= MAX_IMAGES) { msg.textContent = t()('fb.imageMax', { max: MAX_IMAGES }); break; }
      const r = await shrinkImage(f);
      if (r === 'not-image') { msg.textContent = t()('fb.imageNotImage'); continue; }
      if (r === 'too-big') { msg.textContent = t()('fb.imageTooBig'); continue; }
      draft = { ...draft, images: [...draft.images, r] };
    }
    status = '';
    keep();
    fill();
  }

  async function send(): Promise<void> {
    if (sending) return;
    const tt = t();
    if (!cleanFeedbackText(draft.text)) { status = tt('fb.empty'); say(); return; }
    if (cleanEmail(draft.email) === null) { status = tt('fb.emailBad'); say(); q<HTMLInputElement>('#fbemail')?.focus(); return; }
    const body = feedbackBody(draft, host.attachable());
    if (bodyBytes(body) > FEEDBACK_BODY_BYTES) { status = tt('fb.saveTooBig'); say(); return; }
    sending = true;
    status = '';
    say();
    try {
      const r = await fetch(FEEDBACK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const answer = (await r.json().catch(() => null)) as { ref?: unknown } | null;
      if (r.status === 201 && typeof answer?.ref === 'string') {
        draft = clearedDraft(draft);
        keep();
        status = tt('fb.sent', { ref: answer.ref });
      } else {
        status = tt('fb.failed', { status: r.status });
      }
    } catch {
      status = tt('fb.offline');
    } finally {
      sending = false;
      fill();
    }
  }

  // ── The panel's own events (delegated: its markup is rebuilt on a language change) ──
  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b || (b as HTMLButtonElement).disabled) return;
    const d = b.dataset;
    if (d.fbkind) { draft = { ...draft, kind: d.fbkind as FeedbackKind }; keep(); fill(); }
    else if (d.fbsheet) { draft = { ...draft, sheet: d.fbsheet as Draft['sheet'] }; keep(); fill(); }
    else if (d.fbrm !== undefined) { draft = { ...draft, images: draft.images.filter((_, i) => i !== Number(d.fbrm)) }; keep(); fill(); }
    else if (d.fb === 'grab') { draft = { ...draft, sheet: draft.sheet === 'peek' ? 'half' : 'peek' }; keep(); fill(); }
    else if (d.fb === 'min') minimize();
    else if (d.fb === 'close') { setPanel('closed'); document.querySelector<HTMLElement>('[data-cmd="feedback"]')?.focus({ preventScroll: true }); }
    else if (d.fb === 'attach') q<HTMLInputElement>('.fbfile')?.click();
    else if (d.fb === 'send') void send();
    else if (d.fb === 'discard') {
      if (!hasDraft(draft) || confirm(t()('fb.discardAsk'))) { draft = clearedDraft(draft); status = ''; keep(); fill(); }
    }
  });
  el.addEventListener('input', e => {
    const target = e.target as HTMLElement;
    if (target.id === 'fbtext') { draft = { ...draft, text: (target as HTMLTextAreaElement).value }; status = ''; keep(); counts(); say(); layout(); }
    else if (target.id === 'fbemail') { draft = { ...draft, email: (target as HTMLInputElement).value }; status = ''; keep(); say(); }
  });
  el.addEventListener('change', e => {
    const target = e.target as HTMLInputElement;
    if (target.dataset.fbtick) { draft = { ...draft, ticks: { ...draft.ticks, [target.dataset.fbtick]: target.checked } }; keep(); say(); }
    else if (target.classList.contains('fbfile')) { void addFiles([...(target.files ?? [])]); target.value = ''; }
  });
  el.addEventListener('toggle', () => context(), true);
  // Pasted images (text pastes as text, as any box does) and dropped files.
  el.addEventListener('paste', e => {
    const files = filesOf(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    void addFiles(files);
  });
  el.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); el.classList.add('fbdrop'); } });
  el.addEventListener('dragleave', () => el.classList.remove('fbdrop'));
  el.addEventListener('drop', e => {
    el.classList.remove('fbdrop');
    const files = filesOf(e.dataTransfer);
    if (!files.length) return;
    e.preventDefault();
    void addFiles(files);
  });
  // Esc in the panel minimizes it, and goes no further (the game's own Esc handlers never see it).
  el.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    minimize();
  });
  pill.addEventListener('click', () => open());

  const panel: FeedbackPanel = {
    toggle: () => (draft.panel === 'open' ? minimize() : open()),
    open,
    minimize,
    button: tt => `<span class="ctl"><button class="pill fbbtn" data-cmd="feedback" aria-pressed="${draft.panel === 'open'}" aria-controls="fbpanel" aria-label="${esc(tt('fb.button'))}" title="${esc(tt('fb.buttonTip'))}">💬<span class="fblabel">${esc(tt('fb.button'))}</span></button></span>`,
    refresh: () => {
      if (draft.panel !== 'closed' && builtFor !== host.lang()) build();
      else { context(); layout(); }
    },
  };

  // Shift+F anywhere but in a box being typed in. Registered after the game's own key handlers, so
  // an Esc the game used (a popover, the map session, the intro) has defaultPrevented set and is
  // left alone; any other Esc with the panel open minimizes it.
  document.addEventListener('keydown', e => {
    if (e.key === 'F' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditable(e.target)) { e.preventDefault(); panel.toggle(); return; }
    if (e.key === 'Escape' && draft.panel === 'open' && !e.defaultPrevented) minimize();
  });

  // A draft left open or minimized comes back the same way after a reload.
  if (draft.panel !== 'closed') build();
  layout();
  return panel;
}
