/**
 * The text console's command line (#1557): what a typed line means, and what Tab can complete it
 * to. Pure functions, no DOM, so they're unit-tested (console-commands.test.ts); console.ts wires
 * them to the page and the HTTP API.
 *
 * A player types the way people talk to text games: `scout`, `scout 2`, `gather wood`, `end day`,
 * `choose 2` or just `2`. The game's legal moves (from the API's view) decide what those mean:
 * the server stays the judge, and anything not understood here is still sent, so the player gets
 * the game's own reason back rather than a guess from the page.
 */

import type { Move } from '../artificer-play/session';

/** A legal move as the API lists it: the move itself, a label and the hours it takes. */
export interface MoveOption {
  move: Move;
  label: string;
  hours?: number;
}

export type Command =
  | { kind: 'move'; move: Move }
  | { kind: 'look' }
  | { kind: 'help' }
  | { kind: 'rules' }
  | { kind: 'new'; name?: string }
  | { kind: 'error'; message: string };

/** Words the console answers itself, completed by Tab alongside the moves. */
const COMMANDS = ['look', 'help', 'rules', 'new', 'end day', 'set eating ', 'set focus ', 'set site ', 'plan '];

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');
/** A move's action id: "gather@2" → "gather". */
const actionOf = (m: Move): string | null => ('do' in m && typeof m.do === 'string' ? m.do.split('@')[0] : null);
/** A label without its "(ring 1)" or "(3h)" tail: "Gather wood (ring 1)" → "gather wood". */
const labelWords = (label: string): string => norm(label.replace(/\(.*?\)/g, ''));

export function parseCommand(input: string, moves: MoveOption[]): Command {
  const line = norm(input);
  if (!line) return { kind: 'error', message: 'Type a command, or tap a move below. "help" lists them.' };

  // An option id in an encounter wins over the console's own words (an option may be "help").
  const option = moves.find(m => 'choose' in m.move && norm(m.move.choose) === line);
  if (option) return { kind: 'move', move: option.move };

  if (line === 'help' || line === '?') return { kind: 'help' };
  if (line === 'look' || line === 'l') return { kind: 'look' };
  if (line === 'rules') return { kind: 'rules' };
  // The name keeps the case it was typed in, so read it from the input rather than the lowercased line.
  const fresh = /^new(?:\s+game)?(?:\s+(.+))?$/i.exec(input.trim());
  if (fresh) return { kind: 'new', name: fresh[1]?.trim() || undefined };
  if (/^(end( the)? day|sleep|end)$/.test(line)) return { kind: 'move', move: { endDay: true } };

  const numbered = /^(?:choose |pick |c )?(\d+)$/.exec(line);
  if (numbered) {
    const pick = moves[Number(numbered[1]) - 1];
    if (pick) return { kind: 'move', move: pick.move };
    if (!moves.length) return { kind: 'error', message: 'No moves are open: type "new" for a fresh game.' };
    return { kind: 'error', message: `There's no move ${numbered[1]}: pick one of 1 to ${moves.length}.` };
  }

  const setting = /^set (eating|focus|site) (\S+)$/.exec(line);
  if (setting) return { kind: 'move', move: { set: { [setting[1]]: setting[2] } } };

  const plan = /^plan (.+)$/.exec(line);
  if (plan) return { kind: 'move', move: { plan: plan[1].split(/[ ,]+/).filter(Boolean) } };

  if (line.startsWith('{')) {
    try {
      return { kind: 'move', move: JSON.parse(input.trim()) as Move };
    } catch {
      return { kind: 'error', message: "That looks like a move object, but it isn't valid JSON." };
    }
  }

  // "scout", "scout 2", "gather@2": an action id, maybe with a ring.
  // Only a bare id or an id and a number count: "gather wood" is a name, below, not gather + junk.
  const [word, ring] = line.split(' ');
  const wanted = /^\d+$/.test(ring ?? '') ? Number(ring) : null;
  if (ring === undefined || wanted !== null) {
    const same = moves.filter(m => actionOf(m.move) === word.split('@')[0]);
    if (same.length) {
      const id = word.includes('@') ? word : wanted && wanted > 1 ? `${word}@${wanted}` : word;
      const exact = same.find(m => 'do' in m.move && m.move.do === id);
      return { kind: 'move', move: exact?.move ?? { do: id } };
    }
  }

  // "gather wood": the start of a move's label, or each typed word starting a word of it
  // ("wood gather", "fetch wat"). Whole-word starts only: "a" alone mustn't pick "gather food".
  const startsAWord = (label: string, w: string) => labelWords(label).split(' ').some(lw => lw.startsWith(w));
  const byLabel = moves.find(m => labelWords(m.label).startsWith(line)) ?? moves.find(m => line.split(' ').every(w => startsAWord(m.label, w)));
  if (byLabel) return { kind: 'move', move: byLabel.move };

  // Not understood here: send it anyway, and the game says why it can't be done.
  return { kind: 'move', move: { do: line } };
}

/** What Tab can complete `prefix` to: the console's words, action ids, move labels and option ids. */
export function completions(prefix: string, moves: MoveOption[]): string[] {
  const p = prefix.toLowerCase();
  const all = new Set<string>(COMMANDS);
  for (const m of moves) {
    const action = actionOf(m.move);
    if (action) all.add(action);
    if ('choose' in m.move) all.add(m.move.choose.toLowerCase());
    all.add(labelWords(m.label));
  }
  return [...all].filter(c => c.startsWith(p) && c !== p).sort();
}

/** The longest start every candidate shares, for Tab with several matches. */
export function commonPrefix(words: string[]): string {
  if (!words.length) return '';
  let out = words[0];
  for (const w of words.slice(1)) while (!w.startsWith(out)) out = out.slice(0, -1);
  return out;
}

export const HELP = [
  'Type a move, or tap one of the numbered moves below the text.',
  '  scout, water, gather, wood …   the action ids the moves list shows',
  '  scout 2                        an action in ring 2 (further out)',
  '  gather wood                    the start of a move\'s name works too',
  '  2  or  choose 2                the second move in the list',
  '  end day                        sleep; the night passes',
  '  set eating half                free settings: eating full|half|none, focus goal:larder|none, site cave …',
  '  plan water gather wood         a whole day in one line, once your Warden has learned to plan',
  '  look   rules   new [name]      the full view, how the valley works, a fresh game',
  'Tab completes a word; ↑ and ↓ bring back what you typed.',
].join('\n');
