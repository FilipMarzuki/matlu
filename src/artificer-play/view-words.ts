/**
 * A game's text in the player's language (#1713, phase 5 of #1685), for the play API, the MCP
 * server and the text console.
 *
 * An English game reads exactly as it always has: the AI harness's observation
 * (src/artificer-ai/observe.ts), which the AI benchmark and the API tests pin. This file is only for
 * the other languages, and it doesn't translate that observation line by line. It draws what the
 * browser game draws in that language, from the same pure views (camp-blocks, road-view,
 * encounter-view, caravan-view, land-view, progress-view) and the same catalog and `simLine` path,
 * then turns their HTML into plain text. So a Swedish API game says what the Swedish page says, and
 * every translation the app gets, it gets too.
 *
 * The page's buttons become markers a player can act on: `[do: talk:hf-maren]`, `[choose: flee]`,
 * `[ask: hf-tobin]`, `[set site: cave]`, `[endDay]`; the legend at the top of each view says how
 * to send them. Buttons only the page has (carry on, board, close a sheet) are left out: the API
 * takes those steps itself (session.ts `advance`).
 *
 * Presentation only, like the rest of the catalog: nothing here reads back into the game, and the
 * same seed and moves play the same game in every language.
 */

import { difficultyOfCharacter, difficultyLabel } from '../artificer/difficulty';
import { en } from '../artificer/i18n/en';
import type { Key, T } from '../artificer/i18n';
import { ACTIONS, DAY_HOURS, queueHours, queueId, survivalLockOf, type ActionId, type Region1State } from '../artificer/region1';
import { RINGS, reachable, type Ring } from '../artificer/exploration';
import { shown, visibilityOf } from '../artificer/action-visibility';
import { ROAD_DAYS, peopleHere, villageOf, type RoadState } from '../artificer/road';
import { encounterById, optionsFor } from '../artificer/encounters';
import { featureOn } from '../artificer/features';
import { QUESTION_CHARS } from '../artificer/free-questions';
import type { AppState } from '../artificer-app/controller';
import { coldBlock, firstJournalLine, moodLine, outcomeCard, sitesBlock, toolsBlock, yieldText } from '../artificer-app/camp-blocks';
import { hasCamp, withCampLine } from '../artificer-app/camp-view';
import { encounterModal } from '../artificer-app/encounter-view';
import { meetingModal } from '../artificer-app/caravan-view';
import { lastNews, personSheet, questLog, roadEnd, roadView, routeStrip } from '../artificer-app/road-view';
import { landRings } from '../artificer-app/land-view';
import { outlookBlock } from '../artificer-app/progress-view';
import { logText } from '../artificer-app/journal-view';
import { hrs } from '../artificer-app/html';
import { actionName, focusName, isKey, landLines, lockText, optionGroupLabel, optionLabel, ringName, simLine, spotRated, weatherLines, weatherWord } from '../artificer-app/sim-words';
import { knownSpot, siteRatingCounts } from '../artificer/camp-sites';
import type { Phase } from './session';
import { nowLine } from '../artificer-app/time-view';

// ── HTML to text ────────────────────────────────────────────────────────────

const ENTITIES: Readonly<Record<string, string>> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string): string => s.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))).replace(/&([a-z]+);/g, (whole, name: string) => ENTITIES[name] ?? whole);
const attr = (attrs: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];

/** What a page button does, as a marker a player can send (see the header), or null for none. */
function marker(attrs: string): string | null {
  const road = attr(attrs, 'data-road');
  if (road !== undefined) return `do: ${road}`;
  const option = attr(attrs, 'data-choose') ?? attr(attrs, 'data-meet');
  if (option !== undefined) return `choose: ${option}`;
  const site = attr(attrs, 'data-site');
  if (site !== undefined) return `set site: ${site}`;
  // A camp site's card (#1732): Make camp there, as the action with its spot.
  const spot = attr(attrs, 'data-camp');
  if (spot !== undefined) return `do: {"q":"camp","opts":{"spot":"${spot}"}}`;
  if (attr(attrs, 'data-cmd') === 'roadday') return 'endDay';
  return null;
}

/**
 * Some of the page's HTML as plain text: one line per block (a paragraph, a card, a button), lists
 * as "- " lines, a button with what it does in brackets and, when it can't be pressed, why. The
 * HTML is ours (the app's views), so a few regular expressions read it well enough.
 */
export function htmlText(html: string): string {
  let h = html.replace(/\s+/g, ' ');
  // A free question's box (road-view.ts freeQuestion): its button, and who it asks.
  h = h.replace(/<form\b[^>]*\bdata-question="([^"]*)"[^>]*>([\s\S]*?)<\/form>/g, (_, id: string, inner: string) =>
    `<p>${inner.replace(/<input\b[^>]*>/g, '').replace(/<\/?button\b[^>]*>/g, ' ')} [ask: ${id}]</p>`);
  // A person's badge is their initial and their role's icon: the card names them anyway.
  h = h.replace(/<span class="vbadge[^"]*"[^>]*>\s*<span>[^<]*<\/span>\s*<i>[^<]*<\/i>\s*<\/span>/g, '');
  h = h.replace(/<button\b([^>]*)>([\s\S]*?)<\/button>/g, (_, attrs: string, inner: string) => {
    const does = marker(attrs);
    // Page-only buttons: carry on, board, a new Warden, closing a sheet.
    if (!does && (attr(attrs, 'data-cmd') !== undefined || /^\s*✕\s*$/.test(inner))) return '';
    const why = /\bdisabled\b/.test(attrs) ? attr(attrs, 'title') : undefined;
    return `<p>${inner}${does ? ` [${does}]` : ''}${why ? ` (${why})` : ''}</p>`;
  });
  h = h.replace(/<img\b[^>]*>/g, '')
    .replace(/<li\b[^>]*>/g, '\n- ')
    .replace(/<\/?(?:p|div|ul|ol|section|h[1-6]|br|form|header|nav)\b[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decode(h).split('\n')
    .map(l => l.replace(/\s+/g, ' ').replace(/ ([.,:;!?)])/g, '$1').replace(/\( /g, '(').trim())
    .filter(l => l && l !== '-')
    .join('\n');
}

// ── The view ────────────────────────────────────────────────────────────────

/** The marker legend at the top of a view: how to send what the brackets say. */
const legend = (t: T): string => t('api.legend');

/** A heading, as the API's text writes them: upper case, on its own line. */
const head = (key: Key, t: T, vars?: Record<string, string | number>): string => t(key, vars).toUpperCase();

/** The journal's latest lines, oldest first (as the English view lists them), in the viewer's language. */
function journalLines(log: readonly { day: number; text: string }[], mark: string, n: number, t: T): string[] {
  return log.slice(-n).map(l => `- ${mark}${l.day} ${logText(l, t)}`);
}

/** One Reach action as a line: what it's called, its hours, what it yields or why it can't be done now, and its id. */
function actionLines(s: Region1State, t: T): string[] {
  const out: string[] = [];
  for (const id of Object.keys(ACTIONS) as ActionId[]) {
    if (!shown(s, id)) continue;
    const def = ACTIONS[id];
    for (const ring of def.ringed ? RINGS.filter(r => reachable(s.explore, r)) : [1 as Ring]) {
      const vis = visibilityOf(s, id, ring);
      if (vis.status === 'hidden') continue;
      const q = queueId(id, ring);
      const what = vis.reason ? t('api.blocked', { why: simLine(vis.reason, t) }) : yieldText(id, s, ring, t);
      // The Make camp card's badges (#1756): how many places to camp you know rate great and good.
      const counts = id === 'camp' ? siteRatingCounts(s) : null;
      const badges = counts && (counts.great || counts.good) ? ` · ${t('campsite.badgesTip', { great: counts.great, good: counts.good })}` : '';
      out.push(`- ${actionName(id, t)}${def.ringed ? ` (${ringName(ring, t).toLowerCase()})` : ''} · ${hrs(queueHours(q, s), t)} h · ${what}${badges} [do: ${q}]`);
      for (const g of def.options?.(s, {}) ?? []) {
        // A place to camp says how good you believe it is (#1756), as its option does on the page.
        const rated = (c: { value: string }): string => { const p = g.key === 'spot' ? knownSpot(s, c.value) : undefined; const r = p ? spotRated(s, p, t) : ''; return r ? ` (${r})` : ''; };
        out.push(`    ${optionGroupLabel(g, t)} "${g.key}": ${g.choices.map(c => `"${c.value}" = ${optionLabel(g, c, t)}${rated(c)}`).join(' | ')}`);
      }
    }
  }
  return out;
}

/** A day in the Reach: the day and the weather, the body, stores, camp, the land, the outlook, the actions and the journal. */
function dayText(a: AppState, t: T): string {
  const s = a.sim;
  const lock = survivalLockOf(s);
  const focus = lock ? `${t('status.survival')} (${lockText(lock, t)})` : focusName(s.focus, t);
  const eating = t(s.eating === 'half' ? 'status.half' : s.eating === 'none' ? 'status.none' : 'status.full');
  const land = landLines(s, t);
  const journal = journalLines(withCampLine(s.log), 'D', 6, t);
  const weather = weatherLines(s, t);
  return [
    legend(t),
    '',
    t('api.dayHead', { n: s.day, weather: weatherWord(s.weatherToday, s.day, s.config.calendar, t), h: hrs(s.hoursToday, t), max: DAY_HOURS }),
    // The time of day in words (#1740, `time-words`): what the page's queue box says.
    ...(nowLine(s, t, false) ? [`${t('time.label')}: ${nowLine(s, t, false)}`] : []),
    t(s.canPlan ? 'api.canPlan' : 'api.oneAtATime'),
    // The weather and the season in words (#1729): what the page's weather box says.
    ...(weather.length ? ['', head('wx.head', t), ...weather] : []),
    '',
    head('head.warden', t),
    vitalsLine(s, t),
    moodLine(s, t),
    `${t('status.focus')} ${focus} · ${t('status.rations')} ${eating}`,
    // Difficulty (#1728): only when something was left unspent at creation.
    ...(difficultyOfCharacter(s.character) > 1 ? [t('api.difficulty', { m: difficultyLabel(difficultyOfCharacter(s.character)) })] : []),
    '',
    head('head.stores', t),
    storesLine(s, t),
    htmlText(coldBlock(s, t)),
    '',
    head('head.tools', t),
    htmlText(toolsBlock(s, t)),
    '',
    head(hasCamp(s) ? 'head.site' : 'head.makeCamp', t),
    htmlText(sitesBlock(s, t)),
    '',
    head('head.land', t),
    htmlText(landRings(s, t)),
    ...(land.length ? land : []),
    '',
    head('head.outlook', t),
    htmlText(outlookBlock(s, t)),
    '',
    head('api.actions', t),
    ...actionLines(s, t),
    `- ${t('api.endDay')} [endDay]`,
    '',
    head('head.latest', t),
    ...(journal.length ? journal : [firstJournalLine(s, t)]),
  ].filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== '')).join('\n').trim();
}

/** The road: the route, the day's news, the people here with everything they offer, the quests and the journal. */
function roadText(r: RoadState, t: T): string {
  const sheets = peopleHere(r).map(p => htmlText(personSheet(r, p, { person: p.id }, t)));
  return [
    legend(t),
    '',
    htmlText(routeStrip(r, t)),
    roadVitals(r, t),
    '',
    htmlText(lastNews(r, t)),
    '',
    htmlText(roadView(r, { person: null }, t)),
    ...sheets.flatMap(sheet => ['', sheet]),
    // On the wagon the road's own screen already shows the quest log.
    ...(villageOf(r) ? ['', htmlText(questLog(r, false, t))] : []),
    '',
    head('head.roadJournal', t),
    ...journalLines(r.log, 'R', 6, t),
    ...(featureOn(r.features, 'free-questions') ? ['', t('api.askHow', { n: QUESTION_CHARS })] : []),
  ].filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== '')).join('\n').trim();
}

/** The run's end: how it ended, and the last of the journal. */
function endText(a: AppState, t: T): string {
  const road = a.stage === 'road' ? a.road : undefined;
  const card = road?.outcome ? roadEnd(road, t) : a.sim.outcome ? outcomeCard(a, undefined, t) : '';
  const log = road ? road.log : withCampLine(a.sim.log);
  return [htmlText(card), '', head('head.journal', t), ...journalLines(log, road ? 'R' : 'D', 6, t)].join('\n').trim();
}

/** The full view's text in the viewer's language. */
export function viewText(a: AppState, phase: Phase, t: T): string {
  switch (phase) {
    case 'day': return dayText(a, t);
    case 'encounter': return [legend(t), '', htmlText(encounterModal(a.sim, null, 0, t)), '', vitalsLine(a.sim, t)].join('\n');
    case 'meeting': return [legend(t), '', htmlText(meetingModal(a.sim, a.meeting, t))].join('\n');
    case 'road': return roadText(a.road!, t);
    // The road carries the Warden's body and mind under the same names, so the encounter screen reads it as it reads the Reach (as session.ts does).
    case 'road-encounter': return [legend(t), '', htmlText(encounterModal(a.road! as unknown as Region1State, null, 0, t)), '', roadVitals(a.road!, t)].join('\n');
    case 'ended': return endText(a, t);
  }
}

// ── Status lines ────────────────────────────────────────────────────────────

const r0 = (n: number): number => Math.round(n);

function vitalsLine(s: Pick<Region1State, 'vitals'>, t: T): string {
  const v = s.vitals;
  return t('api.vitals', { vig: r0(v.vigor.current), vigCap: r0(v.vigor.cap), cla: r0(v.clarity.current), claCap: r0(v.clarity.cap), con: r0(v.condition) });
}

function storesLine(s: Region1State, t: T): string {
  const st = s.stores;
  return (['rawFood', 'water', 'firewood', 'materials', 'rations', 'stone', 'hides'] as const).map(k => `${t(`store.${k}`)} ${st[k]}`).join(' · ');
}

function roadVitals(r: RoadState, t: T): string {
  return `${vitalsLine(r, t)} · ${t('api.marks', { n: r.marks })}`;
}

/** The one-line status sent with every move, in the viewer's language. */
export function statusText(a: AppState, phase: Phase, t: T): string {
  const s = a.sim;
  if (phase === 'meeting') return t('api.status.meeting', { n: s.day });
  if (phase === 'ended') return t('api.status.ended', { outcome: outcomeText(a, t) });
  if (phase === 'road' || phase === 'road-encounter') {
    const r = a.road!;
    return t('api.status.road', { n: r.day, total: ROAD_DAYS, h: hrs(r.hoursToday, t), max: DAY_HOURS, vitals: vitalsLine(r, t), marks: r.marks });
  }
  const st = s.stores;
  return t('api.status.day', { n: s.day, h: hrs(s.hoursToday, t), max: DAY_HOURS, vitals: vitalsLine(s, t), food: st.rawFood, water: st.water, wood: st.firewood, rations: st.rations });
}

/** How a run ended, in a few words (session.ts outcomeWord, in the viewer's language). */
function outcomeText(a: AppState, t: T): string {
  if (a.stage === 'road' && a.road?.outcome) return t(a.road.outcome.kind === 'arrived' ? 'end.arrivedHead' : a.road.outcome.kind === 'died' ? 'end.diedHead' : 'end.cargoHead');
  if (a.stayed) return t('api.stayed');
  const o = a.sim.outcome;
  if (!o) return '';
  // A death or a collapse in the Reach in a few words, as the English status says it ("died on day 11"):
  // `end.died` / `end.collapsed` are the closing card's headlines ("THE REACH TAKES YOU"), too loud for a status line.
  if (o.kind === 'died' || o.kind === 'collapsed') return t(`api.outcome.${o.kind}`, { n: a.sim.day });
  return t('api.outcome', { what: isKey(`end.${o.kind}`) ? t(`end.${o.kind}` as Key) : o.kind, n: a.sim.day });
}

// ── Move labels ─────────────────────────────────────────────────────────────

/** The label of a move the session lists (session.ts dayMoves, encounterMoves, roadMoves, the meeting's), in the viewer's language. */
export function moveLabel(a: AppState, phase: Phase, move: Record<string, unknown>, english: string, t: T): string {
  if ('endDay' in move) return t('api.endDay');
  if ('choose' in move) {
    const id = String(move.choose);
    if (phase === 'meeting') return isKey(`meet.opt.${id}`) ? t(`meet.opt.${id}` as Key) : simLine(english, t);
    const s = phase === 'road-encounter' ? a.road! as unknown as Region1State : a.sim;
    const e = s.pending ? encounterById(s.pending.id) : undefined;
    if (!e) return simLine(english, t);
    const step = s.pending!.step;
    const key = `${step ? `enc.${e.id}.step.${step}` : `enc.${e.id}`}.opt.${id}`;
    const option = optionsFor(s, e).find(o => o.option.id === id)?.option;
    return isKey(key) ? t(key as Key) : simLine(option?.label ?? english, t);
  }
  const doing = typeof move.do === 'string' ? move.do : '';
  if (phase === 'road' || phase === 'road-encounter') {
    if (doing.startsWith('talk:')) {
      const p = peopleHere(a.road!).find(x => x.id === doing.slice(5));
      return t('api.talkWith', { name: p?.name ?? doing.slice(5) });
    }
    return isKey(`api.road.${doing}`) ? t(`api.road.${doing}` as Key) : english;
  }
  const [id, ringText] = doing.split('@');
  if (!(id in ACTIONS)) return english;
  const def = ACTIONS[id as ActionId];
  return `${actionName(id as ActionId, t)}${def.ringed ? ` (${ringName(Number(ringText ?? 1) as Ring, t).toLowerCase()})` : ''}`;
}

// ── What changed, and refusals ─────────────────────────────────────────────

/** A line of what changed (session.ts `changes`): the journal's own words, or someone at the caravan meeting saying something. */
export interface Change { text: string; speaker?: string }

export const changeText = (c: Change, t: T): string => (c.speaker ? `${c.speaker}: ${simLine(c.text, t)}` : simLine(c.text, t));

/**
 * A refused move's reason (session.ts `apply`), in the viewer's language: the session's English
 * matched against the `api.no.*` templates (the English catalog holds each exactly as the session
 * writes it), with the parts that came from the game (a reason, a name) said again in that
 * language. A reason no template matches stays as it came.
 */
export function refusalText(english: string, t: T): string {
  // In English the session's own words stand (an action's id stays its id).
  if (t('lang.name') === en['lang.name']) return english;
  const m = matchRefusal(english);
  if (!m) return simLine(english, t);
  const vars: Record<string, string> = {};
  for (const [name, v] of Object.entries(m.vars)) {
    vars[name] = name === 'why' ? simLine(v, t)
      : name === 'refusal' ? refusalText(v, t)
      : name === 'action' && v in ACTIONS ? actionName(v as ActionId, t).toLowerCase()
      // Ids are sent as they are, so they're quoted: "cave", "tree" read as ids, not words.
      : name === 'ids' ? v.split(', ').map(id => `"${id}"`).join(', ')
      : v;
  }
  return t(m.key, vars);
}

/** The refusal template a session's English matches, and its parts as they came; null for none. Filling the English template with them gives back the sentence. */
export function matchRefusal(english: string): { key: Key; vars: Record<string, string> } | null {
  for (const [key, re, names] of REFUSALS) {
    const m = re.exec(english);
    if (m) return { key, vars: Object.fromEntries(names.map((name, i) => [name, m[i + 1]])) };
  }
  return null;
}

/** The refusal templates, as patterns: `{why}` is a reason from the game, read back through `simLine`; anything else is kept as it is (an id, a name, a number). */
const REFUSALS: readonly [Key, RegExp, string[]][] = (Object.keys(en) as Key[]).filter(k => k.startsWith('api.no.')).map(key => {
  const names: string[] = [];
  const pattern = en[key].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{(\w+)\\\}/g, (_, name: string) => { names.push(name); return '(.+?)'; });
  return [key, new RegExp(`^${pattern}$`, 's'), names];
});
