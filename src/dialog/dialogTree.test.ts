/**
 * Acceptance tests for #946 — JSON dialog tree format + loader.
 * One test per Given/When/Then criterion derived from the issue description.
 */

import { describe, it, expect } from 'vitest';
import { validateDialogTree, getStartNode, getNode, isEndNode, type DialogTree } from './dialogTree';

const BLACKSMITH: DialogTree = {
  id: 'blacksmith-greeting',
  startNode: 'start',
  nodes: {
    start: {
      text: 'Welcome, traveler. Need something forged?',
      choices: [
        { label: 'What can you make?', next: 'catalog' },
        { label: 'Just browsing.', next: 'farewell' },
      ],
    },
    catalog: {
      text: 'Blades, shields, tools — if I have the materials.',
      choices: [{ label: 'Interesting.', next: 'farewell' }],
    },
    farewell: {
      text: 'Come back when you need something.',
      choices: [],
    },
  },
};

describe('dialog tree format + loader (#946 acceptance)', () => {
  it('given a well-formed dialog tree JSON, when validated, then it has no errors', () => {
    expect(validateDialogTree(BLACKSMITH)).toEqual([]);
  });

  it('given a dialog tree, when reading its start node, then it returns the startNode text + choices', () => {
    const node = getStartNode(BLACKSMITH);
    expect(node.text).toBe('Welcome, traveler. Need something forged?');
    expect(node.choices.map(c => c.label)).toEqual(['What can you make?', 'Just browsing.']);
  });

  it('given a node with choices, when a choice is picked, then it resolves the next node by id', () => {
    const start = getStartNode(BLACKSMITH);
    const nextId = start.choices[0].next;
    const node = getNode(BLACKSMITH, nextId);
    expect(nextId).toBe('catalog');
    expect(node.text).toBe('Blades, shields, tools — if I have the materials.');
  });

  it('given a node with empty choices, when checked, then it is recognized as an end node', () => {
    const farewell = getNode(BLACKSMITH, 'farewell');
    expect(isEndNode(farewell)).toBe(true);
    expect(isEndNode(getStartNode(BLACKSMITH))).toBe(false);
  });

  it('given a multi-node branching conversation, when walking start -> catalog -> farewell, then each hop matches the authored JSON', () => {
    const start = getStartNode(BLACKSMITH);
    const catalog = getNode(BLACKSMITH, start.choices[0].next);
    const farewell = getNode(BLACKSMITH, catalog.choices[0].next);
    expect(farewell.text).toBe('Come back when you need something.');
    expect(isEndNode(farewell)).toBe(true);
  });

  it('given JSON missing required fields, when validated, then it reports which fields are missing', () => {
    const errors = validateDialogTree({ id: 'broken' });
    expect(errors).toContain('missing or invalid "startNode"');
    expect(errors).toContain('missing or invalid "nodes"');
  });

  it('given a choice whose "next" points at a non-existent node, when validated, then it is reported as an error', () => {
    const broken: DialogTree = {
      id: 'broken',
      startNode: 'start',
      nodes: {
        start: { text: 'Hi.', choices: [{ label: 'Bye', next: 'nowhere' }] },
      },
    };
    const errors = validateDialogTree(broken);
    expect(errors.some(e => e.includes('nowhere'))).toBe(true);
  });

  it('given a startNode that is not a key in nodes, when validated, then it is reported as an error', () => {
    const broken: DialogTree = { id: 'broken', startNode: 'missing', nodes: { start: { text: 'Hi.', choices: [] } } };
    const errors = validateDialogTree(broken);
    expect(errors.some(e => e.includes('startNode'))).toBe(true);
  });
});
