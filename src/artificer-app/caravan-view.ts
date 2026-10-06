/**
 * Meeting the caravan (#1356): at the thaw, a dialogue with Bodil before you climb aboard —
 * drawn as a modal in the encounter screen's style (#1347). Who is speaking and what they say,
 * the conversation so far, and your answers: each with its cost, what it needs, and its odds
 * in words. When it ends, one button: climb aboard, or watch them go.
 *
 * Presentation only: the rules live in `src/artificer/caravan-meeting.ts`.
 * Buttons carry `data-meet="<optionId>"`, `data-cmd="board"` and `data-cmd="stay"`.
 */

import { meetingOptions, meetingStep, type Meeting, type MeetingOption } from '../artificer/caravan-meeting';
import { TRAVELLERS } from '../artificer/villages';
import type { Region1State } from '../artificer/region1';
import { badge } from './road-view';

const esc = (t: string | number): string => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const ODDS_NOTE = { safe: 'nothing can go wrong', likely: 'it should go well', risky: 'it could go either way', desperate: 'it will probably go badly' } as const;

/** What an answer costs, in a few words. */
function costOf(o: MeetingOption): string {
  const parts = Object.entries(o.cost?.stores ?? {}).map(([k, n]) => `${n} ${k === 'rawFood' ? 'food' : k}`);
  if (o.cost?.marks) parts.push(`${o.cost.marks} marks`);
  return parts.join(' · ');
}

const person = (id: string | null) => (id ? TRAVELLERS.find(t => t.id === id) : undefined);

/** The modal, or nothing when no meeting is open. */
export function meetingModal(s: Region1State, m: Meeting | undefined): string {
  if (!m) return '';
  const step = meetingStep(m);
  const speaker = person(step.speaker);
  // The conversation so far, newest last: who said what, and what you answered.
  const lines = m.lines.slice(-6).map(l => {
    const who = person(l.speaker);
    return who
      ? `<p class="meet-line"><b>${esc(who.name)}</b> ${esc(l.text)}</p>`
      : `<p class="meet-line you"><b>You</b> ${esc(l.text)}</p>`;
  }).join('');
  const head = `<div class="meet-head">${speaker ? badge(speaker, 48) : ''}<div><p class="enc-kind">🛞 THE SPRING CARAVAN · DAY ${s.day}</p>
    <p class="meet-who"><b>${esc(speaker?.name ?? 'The caravan')}</b>${speaker ? ` · ${esc(speaker.role)} · ${esc(speaker.people)}` : ''}</p></div></div>`;
  const refused = m.last && !m.last.success && m.last.text.startsWith('Not possible') ? `<p class="enc-wait">${esc(m.last.label)}: ${esc(m.last.text)}</p>` : '';
  const body = m.ended
    ? `<div class="runbar">${m.ended === 'board'
      ? `<button class="btn go" data-cmd="board">🛞 CLIMB ABOARD${m.owesHelp ? ` — YOU OWE ${m.owesHelp} DAYS' HELP` : ''}</button>`
      : '<button class="btn" data-cmd="stay">WATCH THEM GO</button>'}</div>`
    : `<div class="enc-options">${meetingOptions(s, m).map(({ option, unmet, odds }) => `<button class="enc-opt" data-meet="${esc(option.id)}" ${unmet ? `disabled title="${esc(unmet)}"` : ''}>
        <span class="eo-label">${esc(option.label)}</span>
        <span class="eo-meta">${costOf(option) && !unmet ? `<span class="eo-cost">${esc(costOf(option))}</span>` : ''}${unmet ? `<span class="eo-need">${esc(unmet)}</span>` : `<span class="odds o-${odds}" title="${ODDS_NOTE[odds]}">${odds}</span>`}</span>
      </button>`).join('')}</div>${refused}`;
  return `<div class="enc-backdrop"><section class="enc meet box" role="dialog" aria-modal="true" aria-label="Meeting the caravan">${head}<div class="meet-lines">${lines}</div>${body}</section></div>`;
}
