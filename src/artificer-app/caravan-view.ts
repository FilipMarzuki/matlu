/**
 * Meeting the caravan (#1356): at the thaw, a dialogue with Bodil before you climb aboard —
 * drawn as a modal in the encounter screen's style (#1347). Who is speaking and what they say,
 * the conversation so far, and your answers: each with its cost, what it needs, and its odds
 * in words. When it ends, one button: climb aboard, or watch them go.
 *
 * Presentation only: the rules live in `src/artificer/caravan-meeting.ts`.
 * Buttons carry `data-meet="<optionId>"`, `data-cmd="board"` and `data-cmd="stay"`.
 *
 * In the viewer's language (#1709): what's said and each answer come from the catalog (`meet.*`),
 * read back from the English the meeting keeps (sim-words.ts `simLine`).
 */

import { meetingOptions, meetingStep, type Meeting, type MeetingOption } from '../artificer/caravan-meeting';
import { TRAVELLERS } from '../artificer/villages';
import type { Region1State } from '../artificer/region1';
import { makeT, type Key, type T } from '../artificer/i18n';
import { badge } from './road-view';
import { esc } from './html';
import { isKey, simLine } from './sim-words';
import { peopleName, roleName } from './road-words';

const EN: T = makeT('en');

/** What an answer costs, in a few words. */
function costOf(o: MeetingOption, t: T): string {
  const parts = Object.entries(o.cost?.stores ?? {}).map(([k, n]) => `${n} ${t(`storeword.${k}` as Key)}`);
  if (o.cost?.marks) parts.push(t('encui.marks', { n: o.cost.marks }));
  return parts.join(' · ');
}

const person = (id: string | null) => (id ? TRAVELLERS.find(x => x.id === id) : undefined);

/** The modal, or nothing when no meeting is open. */
export function meetingModal(s: Region1State, m: Meeting | undefined, t: T = EN): string {
  if (!m) return '';
  const step = meetingStep(m);
  const speaker = person(step.speaker);
  // The conversation so far, newest last: who said what, and what you answered.
  const lines = m.lines.slice(-6).map(l => {
    const who = person(l.speaker);
    return who
      ? `<p class="meet-line"><b>${esc(who.name)}</b> ${esc(simLine(l.text, t))}</p>`
      : `<p class="meet-line you"><b>${esc(t('meetui.you'))}</b> ${esc(simLine(l.text, t))}</p>`;
  }).join('');
  const head = `<div class="meet-head">${speaker ? badge(speaker, 48) : ''}<div><p class="enc-kind">${esc(t('meetui.head', { n: s.day }))}</p>
    <p class="meet-who"><b>${esc(speaker?.name ?? t('meetui.caravan'))}</b>${speaker ? ` · ${esc(roleName(speaker.role, t))} · ${esc(peopleName(speaker.people, t))}` : ''}</p></div></div>`;
  const refused = m.last && !m.last.success && m.last.text.startsWith('Not possible') ? `<p class="enc-wait">${esc(simLine(m.last.label, t))}: ${esc(simLine(m.last.text, t))}</p>` : '';
  const label = (o: MeetingOption): string => (isKey(`meet.opt.${o.id}`) ? t(`meet.opt.${o.id}` as Key) : o.label);
  const body = m.ended
    ? `<div class="runbar">${m.ended === 'board'
      ? `<button class="btn go" data-cmd="board">${m.owesHelp ? t("meetui.boardOwes", { n: m.owesHelp }) : t("meetui.board")}</button>`
      : `<button class="btn" data-cmd="stay">${esc(t('meetui.stay'))}</button>`}</div>`
    : `<div class="enc-options">${meetingOptions(s, m).map(({ option, unmet, odds }) => {
        const need = unmet ? simLine(unmet, t) : null;
        return `<button class="enc-opt" data-meet="${esc(option.id)}" ${need ? `disabled title="${esc(need)}"` : ''}>
        <span class="eo-label">${esc(label(option))}</span>
        <span class="eo-meta">${costOf(option, t) && !need ? `<span class="eo-cost">${esc(costOf(option, t))}</span>` : ''}${need ? `<span class="eo-need">${esc(need)}</span>` : `<span class="odds o-${odds}" title="${esc(t(`encui.${odds}Tip` as Key))}">${esc(t(`encui.${odds}` as Key))}</span>`}</span>
      </button>`;
      }).join('')}</div>${refused}`;
  return `<div class="enc-backdrop"><section class="enc meet box" role="dialog" aria-modal="true" aria-label="${esc(t('meetui.label'))}">${head}<div class="meet-lines">${lines}</div>${body}</section></div>`;
}
