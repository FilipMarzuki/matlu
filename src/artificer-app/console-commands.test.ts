/**
 * The text console's command line (#1557): typed lines against a real day-1 moves list and a
 * made-up encounter.
 */

import { describe, it, expect } from 'vitest';
import { parseCommand, completions, commonPrefix, type MoveOption } from './console-commands';
import { startGame, view } from '../artificer-play/session';

const day1: MoveOption[] = view(startGame({ seed: 's1' })).moves;
const encounter: MoveOption[] = [
  { move: { choose: 'help' }, label: 'Help the stranger' },
  { move: { choose: 'leave' }, label: 'Walk on' },
];
const moveOf = (line: string, moves = day1) => {
  const c = parseCommand(line, moves);
  return c.kind === 'move' ? c.move : c;
};

describe('The console command line (#1557)', () => {
  it('reads action ids, rings, and the start of a move name', () => {
    expect(moveOf('scout')).toEqual({ do: 'scout' });
    expect(moveOf('  Scout  ')).toEqual({ do: 'scout' });
    expect(moveOf('scout 1')).toEqual({ do: 'scout' });
    expect(moveOf('scout 2')).toEqual({ do: 'scout@2' });
    expect(moveOf('gather wood')).toEqual({ do: 'wood' });
    expect(moveOf('fetch water')).toEqual({ do: 'water' });
  });

  it('ends the day, picks by number, and takes free settings and plans', () => {
    expect(moveOf('end day')).toEqual({ endDay: true });
    expect(moveOf('sleep')).toEqual({ endDay: true });
    expect(moveOf('1')).toEqual(day1[0].move);
    expect(moveOf('choose 2')).toEqual(day1[1].move);
    expect(parseCommand('99', day1).kind).toBe('error');
    expect(moveOf('set eating half')).toEqual({ set: { eating: 'half' } });
    expect(moveOf('plan water gather, wood')).toEqual({ plan: ['water', 'gather', 'wood'] });
    expect(moveOf('{"do":"rest"}')).toEqual({ do: 'rest' });
  });

  it("answers its own words, but an encounter's option wins over them", () => {
    expect(parseCommand('look', day1)).toEqual({ kind: 'look' });
    expect(parseCommand('rules', day1)).toEqual({ kind: 'rules' });
    expect(parseCommand('help', day1)).toEqual({ kind: 'help' });
    expect(parseCommand('new Vega', day1)).toEqual({ kind: 'new', name: 'Vega' });
    expect(parseCommand('new game', day1)).toEqual({ kind: 'new', name: undefined });
    expect(moveOf('help', encounter)).toEqual({ choose: 'help' });
    expect(moveOf('walk on', encounter)).toEqual({ choose: 'leave' });
    expect(parseCommand('', day1).kind).toBe('error');
  });

  it('sends what it does not understand, so the game can say why', () => {
    expect(moveOf('teleport home')).toEqual({ do: 'teleport home' });
  });

  it('completes words from the moves and its own commands', () => {
    expect(completions('sc', day1)).toContain('scout');
    expect(completions('gather', day1)).toEqual(expect.arrayContaining(['gather food', 'gather wood']));
    expect(completions('end', day1)).toContain('end day');
    expect(completions('wa', encounter)).toContain('walk on');
    expect(commonPrefix(['gather food', 'gather wood'])).toBe('gather ');
    expect(commonPrefix([])).toBe('');
  });
});
