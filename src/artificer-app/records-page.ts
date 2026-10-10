/**
 * The Records page (#1558): the best runs of all time, how far people and each AI model get
 * through the winter, and, for a finished game (`?game=<id>`, linked from the console and the MCP
 * server), how that run compares.
 *
 * Everything is read live from the play API (GET /api/v1/runs, cached a minute at Vercel's edge),
 * so a new record shows up without a deployment. Ranking and comparing come from
 * src/artificer-play/records.ts, the same rules the API stores its rank key by; that module has no
 * game code in it, so this page stays small.
 */

import './style.css';
import './records.css';
import { inject } from '@vercel/analytics';
import { percentBeaten, tierOf, outcomeLine, groupOf, type StoredRun } from '../artificer-play/records';

// As in main.ts: only a production build on the real domain reports to Vercel Web Analytics.
if (import.meta.env.PROD && location.hostname === 'artificer.corewarden.app') inject();

const SURFACE: Record<StoredRun['surface'], string> = { api: 'API', mcp: 'MCP', console: 'console', bench: 'nightly playtest', web: 'web game' };
/** The three ways a run can go, in order. Their colours are one hue, dim to bright (records.css). */
const TIERS = [
  { tier: 1, label: 'Died before the thaw' },
  { tier: 2, label: 'Lived to the thaw' },
  { tier: 3, label: 'Reached Mistheim' },
] as const;
/** Past this many AI models, the rest share one row: more bars than this stop being readable. */
const MAX_MODEL_ROWS = 7;

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;

/** Make an element with a class and text (always text: names come from players). */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

async function getJson<T>(path: string): Promise<{ status: number; body: T | null }> {
  try {
    const r = await fetch(path);
    return { status: r.status, body: r.ok ? ((await r.json()) as T) : null };
  } catch {
    return { status: 0, body: null };
  }
}

// ── Small helpers ───────────────────────────────────────────────────────────

const who = (r: StoredRun): string => r.nickname ?? 'a Warden';
const playedBy = (r: StoredRun): string => (r.playerKind === 'person' ? 'a person' : r.model ?? 'an AI');
const when = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const pct = (n: number, of: number): number => (of ? Math.round((100 * n) / of) : 0);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * A table column. On a phone each row becomes a small card (records.css): `lead` cells make its
 * first line, a `line` cell starts a line of its own, and the rest follow with their heading as a
 * label, so nothing has to scroll sideways.
 */
interface Col { head: string; num?: boolean; phone?: 'lead' | 'line' | 'labelled' | 'plain'; cls?: string }

function table(cols: Col[], rows: (string | Node)[][]): HTMLTableElement {
  const t = el('table', 'cards');
  const tr = el('tr');
  for (const c of cols) tr.append(el('th', c.num ? 'num' : '', c.head));
  t.append(el('thead'));
  t.tHead!.append(tr);
  const body = el('tbody');
  for (const row of rows) {
    const r = el('tr');
    row.forEach((cell, i) => {
      const c = cols[i];
      const phone = c.phone ?? 'labelled';
      const td = el('td', [c.num ? 'num' : '', phone, c.cls ?? ''].filter(Boolean).join(' '));
      if (phone === 'labelled') td.dataset.label = c.head;
      td.append(cell);
      r.append(td);
    });
    body.append(r);
  }
  t.append(body);
  return t;
}

/** Who played, and under it, muted, where it was played. */
function playerCell(r: StoredRun): Node {
  const span = el('span', '', playedBy(r));
  if (r.playerKind === 'ai' && r.model) span.title = 'As the player reported it';
  const frag = document.createDocumentFragment();
  frag.append(span, el('span', 'where', SURFACE[r.surface]));
  return frag;
}

// ── Best runs ───────────────────────────────────────────────────────────────

/** Rows shown before "Show all": the board reads at a glance, and the rest is one tap away. */
const BEST_SHOWN = 10;

function renderBest(best: StoredRun[], mine: StoredRun | null): void {
  const box = $('#best');
  box.replaceChildren();
  if (!best.length) {
    box.append(emptyNote());
    return;
  }
  const t = table(
    [
      { head: '#', num: true, phone: 'lead', cls: 'rank' }, { head: 'Warden', phone: 'lead' }, { head: 'Played by', phone: 'line' },
      { head: 'How it ended', phone: 'lead', cls: 'ended' }, { head: 'Winter-ready' }, { head: 'Larder at midwinter', num: true },
      { head: 'Shelter' }, { head: 'Skills', num: true }, { head: 'When', phone: 'plain' },
    ],
    best.map((r, i) => [
      String(i + 1), who(r), playerCell(r), outcomeLine(r),
      r.readyDay === null ? 'never' : `day ${r.readyDay}`,
      r.larderMidwinter === null ? '—' : String(r.larderMidwinter),
      `tier ${r.shelterTier}`, String(r.skillLevels), when(r.createdAt),
    ]),
  );
  const rows = [...t.tBodies[0].rows];
  // The reader's own run, if it made the board; a run past the first rows opens the whole board.
  const mineAt = mine ? best.findIndex(r => r.id === mine.id) : -1;
  if (mineAt >= 0) rows[mineAt].classList.add('mine');
  box.append(t);
  if (best.length <= BEST_SHOWN || mineAt >= BEST_SHOWN) return;
  rows.slice(BEST_SHOWN).forEach(r => { r.hidden = true; });
  const more = el('button', 'pill more', `SHOW ALL ${best.length}`);
  more.type = 'button';
  more.addEventListener('click', () => {
    rows.forEach(r => { r.hidden = false; });
    more.remove();
  });
  box.append(more);
}

function emptyNote(): HTMLElement {
  const p = el('p', 'quiet', 'No finished runs yet. Be the first: play one in the ');
  const a = el('a', '', 'console');
  a.href = '/console/';
  p.append(a, '.');
  return p;
}

// ── How far each player gets ────────────────────────────────────────────────

interface Group { label: string; runs: StoredRun[] }

/** People first, then models by how many runs they have; the long tail folds into one row. */
function groupsOf(runs: StoredRun[]): Group[] {
  const by = new Map<string, StoredRun[]>();
  for (const r of runs) by.set(groupOf(r), [...(by.get(groupOf(r)) ?? []), r]);
  const people = by.get('People');
  by.delete('People');
  const models = [...by.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const shown = models.slice(0, MAX_MODEL_ROWS).map(([label, rs]) => ({ label, runs: rs }));
  const rest = models.slice(MAX_MODEL_ROWS).flatMap(([, rs]) => rs);
  return [...(people ? [{ label: 'People', runs: people }] : []), ...shown, ...(rest.length ? [{ label: 'Other AIs', runs: rest }] : [])];
}

function renderSpread(recent: StoredRun[]): void {
  const box = $('#spread');
  box.replaceChildren();
  if (!recent.length) {
    box.append(emptyNote());
    return;
  }
  $('#spread-sub').textContent = `The last ${recent.length} runs: people together, AIs by the model they named.`;
  const groups = groupsOf(recent);

  const legend = el('div', 'legend');
  for (const t of TIERS) {
    const item = el('span', 'key');
    item.append(el('span', `swatch t${t.tier}`), t.label);
    legend.append(item);
  }

  const chart = el('div', 'bars');
  for (const g of groups) {
    const counts = TIERS.map(t => g.runs.filter(r => tierOf(r) === t.tier).length);
    const row = el('div', 'row');
    const label = el('div', 'grp');
    label.append(el('span', 'name', g.label), el('span', 'n', `${g.runs.length} run${g.runs.length === 1 ? '' : 's'}`));
    const bar = el('div', 'bar');
    TIERS.forEach((t, i) => {
      if (!counts[i]) return;
      const seg = el('span', `seg t${t.tier}`);
      seg.style.flexGrow = String(counts[i]);
      seg.tabIndex = 0;
      const share = pct(counts[i], g.runs.length);
      seg.setAttribute('aria-label', `${g.label}: ${share}% ${t.label.toLowerCase()} (${counts[i]} of ${g.runs.length})`);
      seg.dataset.value = `${share}%`;
      seg.dataset.detail = `${t.label} · ${counts[i]} of ${g.runs.length} runs`;
      seg.dataset.group = g.label;
      bar.append(seg);
    });
    row.append(label, bar);
    chart.append(row);
  }

  // The same numbers as a table, with the medians the bars can't show.
  const view = el('div', 'table-wrap');
  view.append(table(
    [
      { head: 'Player', phone: 'line', cls: 'title' }, { head: 'Runs', num: true },
      ...TIERS.map(t => ({ head: t.label, num: true })),
      { head: 'Median end day', num: true }, { head: 'Median ready day', num: true }, { head: 'Median larder', num: true },
    ],
    groups.map(g => {
      const n = g.runs.length;
      const counts = TIERS.map(t => g.runs.filter(r => tierOf(r) === t.tier).length);
      const m = (xs: (number | null)[]): string => {
        const v = median(xs.filter((x): x is number => x !== null));
        return v === null ? '—' : String(v);
      };
      return [g.label, String(n), ...counts.map(c => `${pct(c, n)}%`), m(g.runs.map(r => r.endDay)), m(g.runs.map(r => r.readyDay)), m(g.runs.map(r => r.larderMidwinter))];
    }),
  ));
  box.append(legend, chart, view);
  wireTooltips(chart);
}

/** One tooltip for every bar segment, on hover and on keyboard focus. Values also sit in the table. */
function wireTooltips(root: HTMLElement): void {
  const tip = $('#tip');
  const show = (seg: HTMLElement, x: number, y: number): void => {
    tip.replaceChildren(el('strong', '', seg.dataset.value), el('span', '', seg.dataset.detail), el('span', 'muted', seg.dataset.group));
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.min(Math.max(8, x - w / 2), innerWidth - w - 8)}px`;
    tip.style.top = `${Math.max(8, y - h - 12)}px`;
  };
  const hide = (): void => { tip.hidden = true; };
  root.addEventListener('pointermove', e => {
    const seg = (e.target as HTMLElement).closest<HTMLElement>('.seg');
    if (seg) show(seg, e.clientX, e.clientY); else hide();
  });
  root.addEventListener('pointerleave', hide);
  root.addEventListener('focusin', e => {
    const seg = (e.target as HTMLElement).closest<HTMLElement>('.seg');
    if (!seg) return;
    const b = seg.getBoundingClientRect();
    show(seg, b.left + b.width / 2, b.top);
  });
  root.addEventListener('focusout', hide);
}

// ── Your run ────────────────────────────────────────────────────────────────

function renderYours(mine: StoredRun | null, status: number, recent: StoredRun[]): void {
  const box = $('#yours');
  box.hidden = false;
  box.replaceChildren(el('p', 'eyebrow ice', 'YOUR RUN'));
  if (!mine) {
    box.append(el('p', 'quiet', status === 404
      ? "This game has no record yet: a run gets one when it ends. Finish it in the console, then come back."
      : "Your run's record can't be reached right now. Try again in a while."));
    return;
  }
  box.append(el('h2', '', `${mine.nickname ?? 'Your Warden'} ${outcomeLine(mine)}.`));
  const others = recent.filter(r => r.id !== mine.id);
  const tiles = el('div', 'tiles');
  const tile = (label: string, group: StoredRun[]): void => {
    const p = percentBeaten(mine, group);
    const t = el('div', 'tile');
    t.append(el('span', 'label', label), el('span', 'value', p === null ? '—' : `${p}%`), el('span', 'muted', p === null ? 'no runs to compare yet' : `of ${group.length} run${group.length === 1 ? '' : 's'}`));
    tiles.append(t);
  };
  tile('Further than all runs', others);
  tile("Further than people's runs", others.filter(r => r.playerKind === 'person'));
  tile("Further than AIs' runs", others.filter(r => r.playerKind === 'ai'));
  const facts = el('p', 'facts', [
    mine.readyDay === null ? 'Never winter-ready' : `Winter-ready on day ${mine.readyDay}`,
    mine.larderMidwinter === null ? null : `${mine.larderMidwinter} rations at midwinter`,
    `shelter tier ${mine.shelterTier}`,
    `skills ${mine.skillLevels}`,
    `${mine.moves} moves`,
  ].filter(Boolean).join(' · '));
  box.append(tiles, facts);
}

// ── Start ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const game = new URLSearchParams(location.search).get('game');
  const [runs, mine] = await Promise.all([
    getJson<{ recent: StoredRun[]; best: StoredRun[] }>('/api/v1/runs'),
    game ? getJson<{ run: StoredRun }>(`/api/v1/games/${encodeURIComponent(game)}/run`) : Promise.resolve(null),
  ]);
  if (!runs.body) {
    const why = el('p', 'quiet', `The records can't be reached right now${runs.status ? ` (${runs.status})` : ''}. Try again in a while.`);
    $('#best').replaceChildren(why);
    $('#spread').replaceChildren(why.cloneNode(true));
    return;
  }
  const own = mine?.body?.run ?? null;
  if (mine) renderYours(own, mine.status, runs.body.recent);
  renderBest(runs.body.best, own);
  renderSpread(runs.body.recent);
}

void main();
