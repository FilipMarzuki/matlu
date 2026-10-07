/**
 * Pins on screen (#1380): the places you remember. How much room your memory has (shown with the
 * remember-this prompt), a 📌 on each ring of the land that holds one, and the full list with its
 * forget and interest controls.
 *
 * Presentation only: the rules live in `src/artificer/pins.ts` and `region1.ts` (`forgetPin`,
 * `setInterest`). Buttons carry `data-pinring="<ring>"`, `data-forget="<pin id>"` and
 * `data-interest="<pin id>|<0–3>"`.
 */

import { RING_NAME, RINGS, type Ring } from '../artificer/exploration';
import type { Region1State } from '../artificer/region1';
import { pinCapacity, letGoFirst, maxInterest, pinEffect, placeName, PIN_WORDS, type Pin } from '../artificer/pins';

const esc = (t: string | number): string => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const stars = (n: number): string => '★'.repeat(n);
const FEELING_WORD: Readonly<Record<NonNullable<Pin['feeling']>, string>> = { eerie: 'eerie', awed: 'awe-struck', peaceful: 'peaceful' };

/** "Memory: 2 of 3" — and, when it's full, the place you'd let go first (a suggestion). */
export function memoryLine(s: Region1State): string {
  const held = s.pins?.length ?? 0, room = pinCapacity(s);
  const full = held >= room;
  const first = full ? letGoFirst(s.pins) : undefined;
  return `<p class="enc-memory ${full ? 'full' : ''}">🧠 Memory: <b>${held} of ${room}</b> places${full && first
    ? ` — full. You'd let go of <b>${esc(placeName(first))}</b> (${esc(RING_NAME[first.ring].toLowerCase())} ring) first. <button class="pinbtn" data-forget="${esc(first.id)}">Let it go</button>`
    : ''}</p>`;
}

/** The 📌 on a ring of the land: how many places you remember there. Tapping lists them. */
export function ringPinChip(s: Region1State, ring: Ring, open: boolean): string {
  const here = (s.pins ?? []).filter(p => p.ring === ring);
  if (!here.length) return '';
  const loud = here.some(p => p.interest === 3);
  return `<button class="chip pin ${loud ? 'loud' : ''}" data-pinring="${ring}" aria-expanded="${open}">📌 ${here.length === 1 ? esc(placeName(here[0])) : `${here.length} places`}</button>`;
}

/** One remembered place: what it is, how it felt, when you found it, its interest and what it does. */
function pinRow(s: Region1State, p: Pin, controls: boolean): string {
  const top = maxInterest(s.skills);
  const scale = controls && top > 0
    ? `<span class="pin-stars">${[1, 2, 3].map(n => `<button class="star ${(p.interest ?? 0) >= n ? 'on' : ''}" data-interest="${esc(p.id)}|${p.interest === n ? 0 : n}" ${n > top ? `disabled title="Your Memory isn't good enough to weigh places that finely yet"` : `title="${n === 3 ? 'Know it well: its effect counts double' : `Interest ${n}`}"`}>★</button>`).join('')}</span>`
    : p.interest ? `<span class="pin-stars">${stars(p.interest)}</span>` : '';
  return `<li class="pin-row ${p.interest === 3 ? 'loud' : ''}">
      <div class="pin-head"><b>${esc(placeName(p))}</b>${scale}</div>
      <div class="pin-meta">${esc(PIN_WORDS[p.kind])}${p.feeling ? ` · <i>${FEELING_WORD[p.feeling]}</i>` : ''} · found day ${p.day}</div>
      <div class="pin-fx">${esc(pinEffect(p))}</div>
      ${controls ? `<button class="pinbtn" data-forget="${esc(p.id)}">Let it go</button>` : ''}
    </li>`;
}

/** A ring's pins, shown under the ring on the land when its 📌 is tapped. */
export function ringPins(s: Region1State, ring: Ring): string {
  const here = (s.pins ?? []).filter(p => p.ring === ring);
  return here.length ? `<ul class="pins">${here.map(p => pinRow(s, p, false)).join('')}</ul>` : '';
}

/** The PINS list: every place you remember, by ring, with forget and (once Memory allows) interest controls. */
export function pinsList(s: Region1State): string {
  const pins = s.pins ?? [];
  const room = pinCapacity(s), top = maxInterest(s.skills);
  const head = `<p class="mood" style="margin:0 0 8px">You can hold <b>${room}</b> place${room === 1 ? '' : 's'} in mind — more with a sharper mind (INT) and more Memory. ${top
    ? `You can weigh them now: up to ${stars(top)}.${top < 3 ? ' ★★★ comes with more Memory.' : ' A ★★★ place counts double.'}`
    : 'With more Memory you will learn to weigh them.'}</p>`;
  if (!pins.length) return `${head}<p class="mood" style="margin:0">None yet. Out on the land you sometimes come across a place worth remembering.</p>`;
  return head + RINGS.filter(r => pins.some(p => p.ring === r)).map(r =>
    `<div class="ringhead">${RING_NAME[r].toUpperCase()}</div><ul class="pins">${pins.filter(p => p.ring === r).map(p => pinRow(s, p, true)).join('')}</ul>`).join('');
}
