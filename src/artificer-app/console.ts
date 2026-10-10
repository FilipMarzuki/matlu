/**
 * The text console (#1557): Greywind Reach as text, in the browser, for people. It plays through
 * the HTTP API (src/artificer-play/api.ts) like any other client, so a console game is stored and
 * counted like an AI's, and the seed never reaches the page.
 *
 * The page is a log of what happened, a status line, the moves open now as tappable chips, and a
 * command line. console-commands.ts turns a typed line into a move; this file does the talking
 * to the API and the drawing. The game in progress is remembered in this browser by its id, so a
 * reload carries on where it was.
 */

import './style.css';
import './console.css';
import { inject } from '@vercel/analytics';
import { parseCommand, completions, commonPrefix, HELP, type MoveOption } from './console-commands';

// As in main.ts: only a production build on the real domain reports to Vercel Web Analytics.
if (import.meta.env.PROD && location.hostname === 'artificer.corewarden.app') inject();

/** What the API sends for a game: its view, plus what changed after a move. */
interface GameBody {
  id: string;
  phase: string;
  status: string;
  text: string;
  moves: MoveOption[];
  changed?: string[];
}

const GAME_KEY = 'artificer.console.game';
const out = document.querySelector<HTMLDivElement>('#out')!;
const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const chipsEl = document.querySelector<HTMLDivElement>('#chips')!;
const form = document.querySelector<HTMLFormElement>('#cmd')!;
const input = document.querySelector<HTMLInputElement>('#line')!;

let gameId: string | null = load();
let moves: MoveOption[] = [];
let busy = false;
const history: string[] = [];
let back = 0; // how far ↑ has gone back into history

// ── Talking to the API ──────────────────────────────────────────────────────

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const r = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { status: 0, body: { error: "Couldn't reach the game. Check your connection and try again." } };
  }
}

async function newGame(name?: string): Promise<void> {
  const r = await api('POST', '/api/v1/games', { name, client: 'artificer-console' });
  if (r.status !== 201) return failed(r);
  const g = r.body as unknown as GameBody;
  remember(g.id);
  print(`A new game${name ? ` for ${name}` : ''}. Type "help" any time.`, 'note');
  show(g, true);
}

async function look(): Promise<void> {
  if (!gameId) return welcome();
  const r = await api('GET', `/api/v1/games/${gameId}`);
  if (r.status === 404 || r.status === 410) {
    remember(null);
    print(String(r.body.error ?? 'That game is gone.'), 'warn');
    return welcome();
  }
  if (r.status !== 200) return failed(r);
  show(r.body as unknown as GameBody, true);
}

async function move(m: unknown): Promise<void> {
  if (!gameId) {
    print('No game yet: type "new" (or "new Vega") to start one.', 'warn');
    return;
  }
  const r = await api('POST', `/api/v1/games/${gameId}/moves`, { move: m });
  if (r.status === 422) {
    print(`Refused: ${String(r.body.error)}`, 'warn');
    setMoves((r.body.moves as MoveOption[] | undefined) ?? moves);
    return;
  }
  // 404/410: the game is gone, so look() forgets it. 409: another tab moved first, so look()
  // fetches where the game really is before the next move.
  if (r.status === 404 || r.status === 410 || r.status === 409) {
    if (r.status === 409) failed(r);
    return look();
  }
  if (r.status !== 200) return failed(r);
  const g = r.body as unknown as GameBody;
  print(g.changed?.length ? g.changed.join('\n') : '(nothing new)');
  // On an ordinary day, what changed is enough; when the game wants a choice or has ended,
  // the whole view matters, as the MCP server does for AIs.
  show(g, g.phase !== 'day');
}

async function rules(): Promise<void> {
  const r = await api('GET', '/api/v1/rules');
  if (r.status !== 200) return failed(r);
  print(`${String(r.body.rules)}\n\nON THE ROAD\n${String(r.body.roadRules)}`, 'view');
}

function failed(r: { status: number; body: Record<string, unknown> }): void {
  print(`${String(r.body.error ?? `Something went wrong (${r.status}).`)}`, 'warn');
}

// ── Drawing ─────────────────────────────────────────────────────────────────

function print(text: string, kind: 'view' | 'note' | 'warn' | 'echo' | 'plain' = 'plain'): void {
  const el = document.createElement('div');
  el.className = `entry ${kind}`;
  el.textContent = text; // textContent, never innerHTML: game text and names are shown as text
  out.append(el);
  out.scrollTop = out.scrollHeight;
}

function show(g: GameBody, full: boolean): void {
  if (full) print(g.text, 'view');
  statusEl.textContent = g.status;
  setMoves(g.moves);
  if (g.phase === 'ended') print('The run is over. Type "new" for another, or tap NEW GAME.', 'note');
}

function setMoves(list: MoveOption[]): void {
  moves = list;
  chipsEl.replaceChildren(
    ...list.map((m, i) => chip(`${i + 1} · ${m.label}${m.hours !== undefined ? ` · ${m.hours}h` : ''}`, () => run(String(i + 1)))),
    ...(list.length ? [] : [chip('NEW GAME', () => run('new'))]),
  );
}

function chip(label: string, onTap: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = label;
  b.addEventListener('click', onTap);
  return b;
}

function welcome(): void {
  statusEl.textContent = '';
  print(
    'Greywind Reach, as text. A Warden alone in a mountain valley, thirty days of autumn to make ready for a sixty-night winter.\n' +
      'Type "new" to begin (or "new" and a name), and "help" for the commands.',
    'note',
  );
  setMoves([]);
}

// ── The command line ────────────────────────────────────────────────────────

async function run(line: string): Promise<void> {
  if (busy) return;
  const cmd = parseCommand(line, moves);
  print(`› ${line}`, 'echo');
  if (line.trim()) history.push(line);
  back = 0;
  busy = true;
  form.classList.add('busy');
  try {
    if (cmd.kind === 'error') print(cmd.message, 'warn');
    else if (cmd.kind === 'help') print(HELP, 'note');
    else if (cmd.kind === 'look') await look();
    else if (cmd.kind === 'rules') await rules();
    else if (cmd.kind === 'new') await newGame(cmd.name);
    else await move(cmd.move);
  } finally {
    busy = false;
    form.classList.remove('busy');
    input.focus({ preventScroll: true });
  }
}

form.addEventListener('submit', e => {
  e.preventDefault(); // handled here: there's no server form to send to
  const line = input.value;
  input.value = '';
  void run(line);
});

input.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const found = completions(input.value, moves);
    if (found.length === 1) input.value = found[0];
    else if (found.length > 1) {
      input.value = commonPrefix(found) || input.value;
      print(found.join('   '), 'note');
    }
  } else if (e.key === 'ArrowUp' && history.length) {
    e.preventDefault();
    back = Math.min(back + 1, history.length);
    input.value = history[history.length - back];
  } else if (e.key === 'ArrowDown' && history.length) {
    e.preventDefault();
    back = Math.max(back - 1, 0);
    input.value = back ? history[history.length - back] : '';
  }
});

// ── This browser's game ─────────────────────────────────────────────────────

function load(): string | null {
  try {
    return localStorage.getItem(GAME_KEY);
  } catch {
    return null; // private windows and blocked storage: just start fresh
  }
}

function remember(id: string | null): void {
  gameId = id;
  try {
    if (id) localStorage.setItem(GAME_KEY, id);
    else localStorage.removeItem(GAME_KEY);
  } catch {
    // Nothing to do: the game still plays, it just won't survive a reload.
  }
}

void (gameId ? look() : Promise.resolve(welcome()));
