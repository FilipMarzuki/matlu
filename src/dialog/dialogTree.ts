/**
 * Pure data model + logic for the JSON dialog tree format (#946), extended
 * with a condition DSL + node side-effects for branching dialog (#943).
 *
 * This module has no Phaser dependency so it can be unit-tested headlessly.
 * Scene-facing loading (NpcDialogScene, GameScene preload) lives separately
 * and imports these types/functions. The traversal state machine itself
 * lives in `DialogRunner.ts`.
 */

/** Sentinel `next` value that closes the dialog instead of walking to a node. */
export const END_NODE = 'END';

/**
 * Composable condition gating a choice's visibility, evaluated against a
 * `WorldContext` snapshot. Every variant is a single-key object so
 * `evalCondition` can tell them apart with an `in` check — exactly one key
 * is set per condition per the JSON schema.
 */
export type Condition =
  | { flag: string }
  | { item: string; gte?: number; lt?: number }
  | { worldEvent: string }
  | { timeOfDay: 'dawn' | 'day' | 'dusk' | 'night' }
  | { location: string }
  | { visitCount: string; gte?: number; lt?: number }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

/** Side-effect fired when a node is entered. The runner emits these; it never mutates game state itself. */
export type NodeEffect =
  | { setFlag: string }
  | { clearFlag: string }
  | { giveItem: string; qty?: number }
  | { startQuest: string }
  | { completeQuest: string };

/**
 * Plain snapshot of live game state, assembled by the caller (GameScene)
 * before a dialog starts. `evalCondition` and `DialogRunner` only ever see
 * this snapshot — no Phaser or game-object references.
 */
export interface WorldContext {
  /** Quest flags, story beats, npc-met flags. */
  flags: Set<string>;
  /** Item id → quantity. */
  inventory: Map<string, number>;
  /** Active world event ids. */
  worldEvents: Set<string>;
  timeOfDay: 'dawn' | 'day' | 'dusk' | 'night';
  /** Current zone id. */
  location: string;
  /** Npc id → times the player has talked to them. */
  visitCounts: Map<string, number>;
}

/**
 * Evaluates a `Condition` against a `WorldContext` snapshot. Pure and
 * side-effect free — safe to call from unit tests with no game dependencies.
 */
export function evalCondition(cond: Condition, ctx: WorldContext): boolean {
  if ('flag' in cond) return ctx.flags.has(cond.flag);
  if ('item' in cond) return checkRange(ctx.inventory.get(cond.item) ?? 0, cond.gte, cond.lt);
  if ('worldEvent' in cond) return ctx.worldEvents.has(cond.worldEvent);
  if ('timeOfDay' in cond) return ctx.timeOfDay === cond.timeOfDay;
  if ('location' in cond) return ctx.location === cond.location;
  if ('visitCount' in cond) return checkRange(ctx.visitCounts.get(cond.visitCount) ?? 0, cond.gte, cond.lt);
  if ('all' in cond) return cond.all.every(c => evalCondition(c, ctx));
  if ('any' in cond) return cond.any.some(c => evalCondition(c, ctx));
  return !evalCondition(cond.not, ctx);
}

function checkRange(value: number, gte?: number, lt?: number): boolean {
  if (gte !== undefined && value < gte) return false;
  if (lt !== undefined && value >= lt) return false;
  return true;
}

export interface DialogChoiceDef {
  /** Button label shown to the player. */
  label: string;
  /** Id of the node to walk to when this choice is picked, or `END_NODE` to close the dialog. */
  next: string;
  /** Choice is hidden unless this evaluates true against the current `WorldContext`. Absent = always visible. */
  condition?: Condition;
}

export interface DialogNodeDef {
  /** Line of dialog shown for this node. */
  text: string;
  /** Empty array means the node can only advance via `next` (auto-advance) or it's a dead end. */
  choices: DialogChoiceDef[];
  /** When `choices` is empty, the node auto-advances here once its text finishes. `END_NODE` closes the dialog. */
  next?: string;
  /** Overrides the dialog's speaker name for this node only (e.g. a different NPC chimes in). */
  npcName?: string;
  /** Overrides the dialog's portrait texture key for this node only. */
  portraitKey?: string;
  /** Side-effects fired (via `DialogRunner`'s emitter) when this node is entered. */
  onEnter?: NodeEffect[];
}

export interface DialogTree {
  /** Stable identifier, also used as the JSON file's base name. */
  id: string;
  /** Key into `nodes` for the first node shown. */
  startNode: string;
  nodes: Record<string, DialogNodeDef>;
}

/** True when a node has no outgoing choices and no auto-advance target — the conversation ends here. */
export function isEndNode(node: DialogNodeDef): boolean {
  return node.choices.length === 0 && node.next === undefined;
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
    if (node.next !== undefined) {
      if (typeof node.next !== 'string') {
        errors.push(`node "${nodeId}" has invalid "next"`);
      } else if (node.next !== END_NODE && !nodeIds.includes(node.next)) {
        errors.push(`node "${nodeId}" "next" points at unknown node "${node.next}"`);
      }
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
      } else if (choice.next !== END_NODE && !nodeIds.includes(choice.next)) {
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
