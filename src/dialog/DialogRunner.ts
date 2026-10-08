/**
 * Pure state machine that walks a `DialogTree` (#943). No Phaser imports —
 * `NpcDialogScene` drives this class and renders whatever it reports back.
 */

import { END_NODE, evalCondition, type DialogChoiceDef, type DialogNodeDef, type DialogTree, type NodeEffect, type WorldContext } from './dialogTree';

type SetFlagListener = (flag: string) => void;
type ClearFlagListener = (flag: string) => void;
type GiveItemListener = (item: string, qty: number) => void;
type StartQuestListener = (questId: string) => void;
type CompleteQuestListener = (questId: string) => void;

export class DialogRunner {
  private readonly tree: DialogTree;
  private readonly ctx: WorldContext;
  private nodeId: string | null;

  private readonly setFlagListeners: SetFlagListener[] = [];
  private readonly clearFlagListeners: ClearFlagListener[] = [];
  private readonly giveItemListeners: GiveItemListener[] = [];
  private readonly startQuestListeners: StartQuestListener[] = [];
  private readonly completeQuestListeners: CompleteQuestListener[] = [];

  constructor(tree: DialogTree, ctx: WorldContext) {
    this.tree = tree;
    this.ctx = ctx;
    this.nodeId = tree.startNode;
    this.fireOnEnter(this.requireNode(tree.startNode));
  }

  /** Current node to display. `null` once the dialog has ended. */
  get currentNode(): DialogNodeDef | null {
    return this.nodeId === null ? null : this.requireNode(this.nodeId);
  }

  /** Choices visible to the player — conditions already filtered against the `WorldContext`. */
  get visibleChoices(): DialogChoiceDef[] {
    const node = this.currentNode;
    if (!node) return [];
    return node.choices.filter(choice => !choice.condition || evalCondition(choice.condition, this.ctx));
  }

  /** Advance via a choice (index into `visibleChoices`, not the raw node list). Runs the next node's `onEnter` effects. */
  choose(choiceIndex: number): void {
    const choice = this.visibleChoices[choiceIndex];
    if (!choice) throw new Error(`DialogRunner: no visible choice at index ${choiceIndex}`);
    this.goTo(choice.next);
  }

  /** Advance a no-choice node via its `next` field (auto-advance). No-op if the current node has no `next`. */
  advance(): void {
    const node = this.currentNode;
    if (!node?.next) return;
    this.goTo(node.next);
  }

  on(event: 'setFlag', cb: SetFlagListener): void;
  on(event: 'clearFlag', cb: ClearFlagListener): void;
  on(event: 'giveItem', cb: GiveItemListener): void;
  on(event: 'startQuest', cb: StartQuestListener): void;
  on(event: 'completeQuest', cb: CompleteQuestListener): void;
  on(
    event: 'setFlag' | 'clearFlag' | 'giveItem' | 'startQuest' | 'completeQuest',
    cb: SetFlagListener | ClearFlagListener | GiveItemListener | StartQuestListener | CompleteQuestListener
  ): void {
    switch (event) {
      case 'setFlag': this.setFlagListeners.push(cb as SetFlagListener); break;
      case 'clearFlag': this.clearFlagListeners.push(cb as ClearFlagListener); break;
      case 'giveItem': this.giveItemListeners.push(cb as GiveItemListener); break;
      case 'startQuest': this.startQuestListeners.push(cb as StartQuestListener); break;
      case 'completeQuest': this.completeQuestListeners.push(cb as CompleteQuestListener); break;
    }
  }

  private goTo(nextId: string): void {
    if (nextId === END_NODE) {
      this.nodeId = null;
      return;
    }
    this.nodeId = nextId;
    this.fireOnEnter(this.requireNode(nextId));
  }

  private fireOnEnter(node: DialogNodeDef): void {
    for (const effect of node.onEnter ?? []) {
      this.fireEffect(effect);
    }
  }

  private fireEffect(effect: NodeEffect): void {
    if ('setFlag' in effect) this.setFlagListeners.forEach(cb => cb(effect.setFlag));
    else if ('clearFlag' in effect) this.clearFlagListeners.forEach(cb => cb(effect.clearFlag));
    else if ('giveItem' in effect) this.giveItemListeners.forEach(cb => cb(effect.giveItem, effect.qty ?? 1));
    else if ('startQuest' in effect) this.startQuestListeners.forEach(cb => cb(effect.startQuest));
    else this.completeQuestListeners.forEach(cb => cb(effect.completeQuest));
  }

  private requireNode(nodeId: string): DialogNodeDef {
    const node = this.tree.nodes[nodeId];
    if (!node) throw new Error(`DialogRunner: tree "${this.tree.id}" has no node "${nodeId}"`);
    return node;
  }
}
