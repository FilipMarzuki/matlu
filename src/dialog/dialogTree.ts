/**
 * Pure data model + logic for the JSON dialog tree format (#946).
 *
 * This module has no Phaser dependency so it can be unit-tested headlessly.
 * Scene-facing loading (NpcDialogScene, GameScene preload) lives separately
 * and imports these types/functions.
 */

export interface DialogChoiceDef {
  /** Button label shown to the player. */
  label: string;
  /** Id of the node to walk to when this choice is picked. */
  next: string;
}

export interface DialogNodeDef {
  /** Line of dialog shown for this node. */
  text: string;
  /** Empty array means the conversation ends after this node's text. */
  choices: DialogChoiceDef[];
}

export interface DialogTree {
  /** Stable identifier, also used as the JSON file's base name. */
  id: string;
  /** Key into `nodes` for the first node shown. */
  startNode: string;
  nodes: Record<string, DialogNodeDef>;
}

/** True when a node has no outgoing choices — the conversation ends here. */
export function isEndNode(node: DialogNodeDef): boolean {
  return node.choices.length === 0;
}

/**
 * Validates the shape of parsed JSON against the dialog tree format and
 * checks every `next` reference points at a real node. Returns a list of
 * human-readable problems; an empty array means the tree is well-formed.
 */
export function validateDialogTree(data: unknown): string[] {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null) {
    return ['dialog tree must be a JSON object'];
  }

  const tree = data as Partial<DialogTree>;

  if (typeof tree.id !== 'string' || tree.id.length === 0) {
    errors.push('missing or invalid "id"');
  }
  if (typeof tree.startNode !== 'string' || tree.startNode.length === 0) {
    errors.push('missing or invalid "startNode"');
  }
  if (typeof tree.nodes !== 'object' || tree.nodes === null) {
    errors.push('missing or invalid "nodes"');
    return errors;
  }

  const nodes = tree.nodes as Record<string, unknown>;
  const nodeIds = Object.keys(nodes);

  if (typeof tree.startNode === 'string' && !nodeIds.includes(tree.startNode)) {
    errors.push(`startNode "${tree.startNode}" is not a key in "nodes"`);
  }

  for (const nodeId of nodeIds) {
    const node = nodes[nodeId] as Partial<DialogNodeDef>;
    if (typeof node.text !== 'string') {
      errors.push(`node "${nodeId}" is missing "text"`);
    }
    if (!Array.isArray(node.choices)) {
      errors.push(`node "${nodeId}" is missing "choices"`);
      continue;
    }
    node.choices.forEach((choice, i) => {
      if (typeof choice.label !== 'string') {
        errors.push(`node "${nodeId}" choice ${i} is missing "label"`);
      }
      if (typeof choice.next !== 'string') {
        errors.push(`node "${nodeId}" choice ${i} is missing "next"`);
      } else if (!nodeIds.includes(choice.next)) {
        errors.push(`node "${nodeId}" choice ${i} points at unknown node "${choice.next}"`);
      }
    });
  }

  return errors;
}

/** Looks up the starting node of a tree. Throws if the tree is malformed. */
export function getStartNode(tree: DialogTree): DialogNodeDef {
  const node = tree.nodes[tree.startNode];
  if (!node) throw new Error(`dialog tree "${tree.id}" has no start node "${tree.startNode}"`);
  return node;
}

/** Looks up the node a choice leads to. Throws if the id is unknown. */
export function getNode(tree: DialogTree, nodeId: string): DialogNodeDef {
  const node = tree.nodes[nodeId];
  if (!node) throw new Error(`dialog tree "${tree.id}" has no node "${nodeId}"`);
  return node;
}
