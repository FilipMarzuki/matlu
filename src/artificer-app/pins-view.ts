/**
 * Pins on screen (#1380): the places you remember. How much room your memory has (shown with the
 * remember-this prompt), a 📌 on each ring of the land that holds one, and the full list with its
 * forget and interest controls. In the viewer's language (#1709 the memory line, #1711 the rest).
 *
 * Presentation only: the rules live in `src/artificer/pins.ts` and `region1.ts` (`forgetPin`,
 * `setInterest`). Buttons carry `data-pinring="<ring>"`, `data-forget="<pin id>"` and
 * `data-interest="<pin id>|<0–3>"`.
 */

import { RINGS, type Ring } from '../artificer/exploration';
import type { Region1State } from '../artificer/region1';
import { pinCapacity, letGoFirst, maxInterest, pinWeight, placeName, PIN_WORDS, type Pin } from '../artificer/pins';
import { makeT, type T } from '../artificer/i18n';
import { wordText } from './sim-words';

const esc = (t: string | number): string => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const stars = (n: number): string => '★'.repeat(n);
/** A place you remember, by name ("the deep pool"), in the viewer's language. */
const placeText = (p: Pin, t: T): string => wordText(placeName(p), t) ?? placeName(p);

/** "Memory: 2 of 3" — and, when it's full, the place you'd let go first (a suggestion). */
export function memoryLine(s: Region1State, t: T = makeT('en')): string {
  const held = s.pins?.length ?? 0, room = pinCapacity(s);
  const full = held >= room;
  const first = full ? letGoFirst(s.pins) : undefined;
  // In the viewer's language (#1709): it shows on the encounter screen, for a place worth remembering.
  return `<p class="enc-memory ${full ? 'full' : ''}">${full && first
    ? `${t('encui.memoryFullHtml', { held, room, place: esc(placeText(first, t)), ring: esc(t(`ring.${first.ring}`).toLowerCase()) })} <button class="pinbtn" data-forget="${esc(first.id)}">${esc(t('encui.letGo'))}</button>`
    : t('encui.memoryHtml', { held, room })}</p>`;
}

/** What a held place does (pins.ts pinEffect), in words. */
export function pinEffectText(p: Pin, t: T): string {
  const n = pinWeight(p);
  switch (p.kind) {
    case 'fishing': return t('pins.fx.fishing', { n });
    case 'forage': return t('pins.fx.forage', { n });
    case 'stone': return t('pins.fx.stone', { n });
    case 'shelter': return t(p.ring === 1 ? 'pins.fx.shelter' : 'pins.fx.shelterFar');
    case 'wonder': return p.feeling === 'eerie' ? t(n > 1 ? 'pins.fx.eerieMuch' : 'pins.fx.eerie') : t('pins.fx.wonder');
    case 'peaceful': return t(n > 1 ? 'pins.fx.calmMuch' : 'pins.fx.calm');
  }
}

/** The 📌 on a ring of the land: how many places you remember there. Tapping lists them. */
export function ringPinChip(s: Region1State, ring: Ring, open: boolean, t: T = makeT('en')): string {
  const here = (s.pins ?? []).filter(p => p.ring === ring);
  if (!here.length) return '';
  const loud = here.some(p => p.interest === 3);
  return `<button class="chip pin ${loud ? 'loud' : ''}" data-pinring="${ring}" aria-expanded="${open}">📌 ${esc(here.length === 1 ? placeText(here[0], t) : t('pins.places', { n: here.length }))}</button>`;
}

/** One remembered place: what it is, how it felt, when you found it, its interest and what it does. */
function pinRow(s: Region1State, p: Pin, controls: boolean, t: T): string {
  const top = maxInterest(s.skills);
  const scale = controls && top > 0
    ? `<span class="pin-stars">${[1, 2, 3].map(n => `<button class="star ${(p.interest ?? 0) >= n ? 'on' : ''}" data-interest="${esc(p.id)}|${p.interest === n ? 0 : n}" ${n > top ? `disabled title="${esc(t('pins.starLocked'))}"` : `title="${esc(n === 3 ? t('pins.star3') : t('pins.star', { n }))}"`}>★</button>`).join('')}</span>`
    : p.interest ? `<span class="pin-stars">${stars(p.interest)}</span>` : '';
  return `<li class="pin-row ${p.interest === 3 ? 'loud' : ''}">
      <div class="pin-head"><b>${esc(placeText(p, t))}</b>${scale}</div>
      <div class="pin-meta">${esc(wordText(PIN_WORDS[p.kind], t) ?? PIN_WORDS[p.kind])}${p.feeling ? ` · <i>${esc(t(`pins.feel.${p.feeling}`))}</i>` : ''} · ${esc(t('pins.found', { n: p.day }))}</div>
      <div class="pin-fx">${esc(pinEffectText(p, t))}</div>
      ${controls ? `<button class="pinbtn" data-forget="${esc(p.id)}">${esc(t('pins.letGo'))}</button>` : ''}
    </li>`;
}

/** A ring's pins, shown under the ring on the land when its 📌 is tapped. */
export function ringPins(s: Region1State, ring: Ring, t: T = makeT('en')): string {
  const here = (s.pins ?? []).filter(p => p.ring === ring);
  return here.length ? `<ul class="pins">${here.map(p => pinRow(s, p, false, t)).join('')}</ul>` : '';
}

/** How many places you can hold in mind, and whether you can weigh them yet (the PINS list's first line). */
export function pinsRoom(s: Region1State, t: T = makeT('en')): string {
  const room = pinCapacity(s), top = maxInterest(s.skills);
  const weigh = top ? `${t('pins.weigh', { stars: stars(top) })} ${t(top < 3 ? 'pins.weighMore' : 'pins.weighTop')}` : t('pins.weighLater');
  return `<p class="mood" style="margin:0 0 8px">${t(room === 1 ? 'pins.roomHtml.one' : 'pins.roomHtml.other', { n: room })} ${esc(weigh)}</p>`;
}

/** A ring's places with their forget and interest controls (the merged LAND tab's ring sections, #1730). */
export function ringPinRows(s: Region1State, ring: Ring, t: T = makeT('en')): string {
  const here = (s.pins ?? []).filter(p => p.ring === ring);
  return here.length ? `<ul class="pins">${here.map(p => pinRow(s, p, true, t)).join('')}</ul>` : '';
}

/** The PINS list: every place you remember, by ring, with forget and (once Memory allows) interest controls. */
export function pinsList(s: Region1State, t: T = makeT('en')): string {
  const pins = s.pins ?? [];
  const head = pinsRoom(s, t);
  if (!pins.length) return `${head}<p class="mood" style="margin:0">${esc(t('pins.none'))}</p>`;
  return head + RINGS.filter(r => pins.some(p => p.ring === r)).map(r =>
    `<div class="ringhead">${esc(t(`ring.${r}`).toUpperCase())}</div><ul class="pins">${pins.filter(p => p.ring === r).map(p => pinRow(s, p, true, t)).join('')}</ul>`).join('');
}
