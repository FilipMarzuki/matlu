import * as Phaser from 'phaser';
import { getStartNode, getNode, type DialogTree, type DialogNodeDef } from '../dialog/dialogTree';
import type { DialogRunner } from '../dialog/DialogRunner';
import { UI } from '../ui/UIFactory';

/**
 * NpcDialogScene — a pause overlay for story dialog with typewriter text reveal.
 *
 * ## How it works (scene overlay pattern)
 * The caller pauses itself, then launches this scene on top:
 * ```ts
 * this.scene.pause();
 * this.scene.launch('NpcDialogScene', dialogData as unknown as object);
 * ```
 * When dismissed, NpcDialogScene stops itself and resumes the caller.
 * Communication back uses the caller scene's event bus:
 * ```ts
 * this.scene.get(callerKey).events.emit('dialog-choice', choiceId);
 * ```
 * This keeps NpcDialogScene decoupled — it doesn't import GameScene.
 *
 * ## Typewriter effect
 * A float `charProgress` is incremented each frame by `CHARS_PER_SECOND × (delta/1000)`.
 * `Math.floor(charProgress)` gives the number of characters to show. Tapping space
 * or clicking the panel skips to the full text immediately.
 *
 * ## Choices
 * Optional `choices[]` are rendered as buttons after the text is fully revealed.
 * Clicking a choice emits 'dialog-choice' with the choice id and closes the dialog.
 * If there are no choices, clicking anywhere advances or closes.
 *
 * ## Dialog trees (#946)
 * When `dialogTree` is passed instead, the scene walks the tree itself: each
 * choice click re-plays the typewriter for the `next` node rather than closing
 * the scene, until it reaches a node with no choices (the tree's end).
 *
 * ## Dialog runner (#943)
 * When `dialogRunner` is passed, it takes priority over `dialogTree` — the
 * scene no longer walks node ids itself, it just reads
 * `runner.currentNode`/`runner.visibleChoices` (already condition-filtered)
 * and calls `runner.choose(i)` / `runner.advance()`. A node with no visible
 * choices but a `next` field auto-advances a beat after its text finishes;
 * `runner.currentNode === null` closes the dialog.
 *
 * ## Visual layer (#942)
 * The panel, portrait frame, name plate and choice buttons are all built with
 * `UIFactory` (`UI.makePanel` / `UI.makeButton` / `UI.makeText`) instead of raw
 * rectangles, so the dialog matches the rest of the game's Tech-Rune theme.
 * `mode: 'full'` swaps the bottom-anchored "semi" panel for a dimmed backdrop
 * and a larger centered panel, for story-beat dialog.
 */

const CHARS_PER_SECOND = 38;

export interface DialogChoice {
  id: string;
  label: string;
}

export interface NpcDialogData {
  /** Key of the scene that launched this dialog — used to resume it and emit events */
  callerKey: string;
  /** The line of text to display. Ignored when `dialogTree` is set — the tree's start node supplies it. */
  text: string;
  /** Optional choices shown after text is fully revealed. Ignored when `dialogTree` is set. */
  choices?: DialogChoice[];
  /** NPC name shown above the text */
  speakerName?: string;
  /** Phaser texture key for a portrait shown left of the text panel. Falls back to a placeholder silhouette. */
  portrait?: string;
  /** JSON-authored multi-node branching conversation (#946). Takes priority over text/choices. */
  dialogTree?: DialogTree;
  /** Condition-aware runner driving the tree (#943). Takes priority over `dialogTree` and `text`/`choices`. */
  dialogRunner?: DialogRunner;
  /** 'semi' (default) keeps the game world visible, panel anchored to the bottom.
   *  'full' dims the world with a backdrop and centers a larger panel, for story beats. */
  mode?: 'semi' | 'full';
}

/** Panel geometry computed once in create(), reused by showChoices() and the continue hint. */
interface PanelLayout {
  px: number;
  py: number;
  panelW: number;
  panelH: number;
}

/** Auto-advance delay (ms) after a no-choice node's text finishes typing, before `runner.advance()` fires. */
const AUTO_ADVANCE_DELAY = 500;

export class NpcDialogScene extends Phaser.Scene {
  private dialogData!: NpcDialogData;
  private textObj!: Phaser.GameObjects.Text;
  private continueHint!: Phaser.GameObjects.Text;
  private layout!: PanelLayout;
  private charProgress = 0;
  private fullText = '';
  private revealed = false;
  private choiceButtons: Phaser.GameObjects.Text[] = [];

  constructor() {
    super({ key: 'NpcDialogScene' });
  }

  preload(): void {
    UI.preloadUI(this);
  }

  // Phaser passes the data argument from scene.launch() here.
  // We cast it because Phaser types the arg as `object`.
  init(data: object): void {
    this.dialogData = data as NpcDialogData;
    this.revealed = false;
    this.choiceButtons = [];
    if (this.dialogData.dialogRunner) {
      this.applyRunnerNode();
    } else if (this.dialogData.dialogTree) {
      this.applyNode(getStartNode(this.dialogData.dialogTree));
    }
  }

  /** Copies a tree node's text/choices onto dialogData so create()/update() render it unchanged. */
  private applyNode(node: DialogNodeDef): void {
    this.dialogData.text = node.text;
    // `id` carries the target node id in tree mode — showChoices() reads it back in advanceToNode().
    this.dialogData.choices = node.choices.map(c => ({ id: c.next, label: c.label }));
  }

  /**
   * Copies the runner's current node onto dialogData, condition-filtering
   * choices via `visibleChoices` and letting the node override the
   * speaker name / portrait for this beat only. `id` carries the choice's
   * index into `visibleChoices` — showChoices() reads it back as a number.
   */
  private applyRunnerNode(): void {
    const runner = this.dialogData.dialogRunner;
    const node = runner?.currentNode;
    if (!runner || !node) return;

    this.dialogData.text = node.text;
    if (node.npcName) this.dialogData.speakerName = node.npcName;
    if (node.portraitKey) this.dialogData.portrait = node.portraitKey;
    this.dialogData.choices = runner.visibleChoices.map((c, i) => ({ id: String(i), label: c.label }));
  }

  create(): void {
    // FIL-113: Duck audio when dialog opens over GameScene.
    if (this.scene.isPaused('GameScene')) {
      type DuckableScene = Phaser.Scene & { duckAudio?: (tweens: Phaser.Tweens.TweenManager) => void };
      (this.scene.get('GameScene') as DuckableScene).duckAudio?.(this.tweens);
    }

    const { width, height } = this.cameras.main;
    const isFull = this.dialogData.mode === 'full';

    // Full overlay dims the world behind the panel; semi keeps it visible.
    if (isFull) {
      UI.makeBackdrop(this, 0.78, UI.Color.backdropBlack, () => this.advanceOrClose());
    }

    const panelW = isFull ? width * 0.7 : Math.min(width * 0.8, 600);
    const panelH = isFull ? height * 0.4 : 180;
    const px = width / 2;
    const py = isFull ? height / 2 : height - panelH / 2 - 24;
    this.layout = { px, py, panelW, panelH };

    // UIFactory panel (nine-slice sprite if loaded, graphics double-border fallback otherwise).
    const panel = UI.makePanel(this, px, py, panelW, panelH, 'fantasy');
    panel.bg.setInteractive().on('pointerdown', () => this.advanceOrClose());

    // Portrait box: bigger in full mode, left side of the panel.
    const portraitSize = isFull ? 96 : 64;
    const portraitPad = 12;
    const textOffsetX = portraitSize + portraitPad * 2;
    const portraitX = px - panelW / 2 + portraitPad + portraitSize / 2;
    const portraitY = py;

    this.drawPortrait(portraitX, portraitY, portraitSize);

    // Speaker name plate — omitted entirely if no speakerName.
    const textLeft = px - panelW / 2 + textOffsetX;
    let textTop = py - panelH / 2 + 14;
    if (this.dialogData.speakerName) {
      UI.makeText(this, textLeft, textTop, this.dialogData.speakerName, 'label')
        .setColor('#c8922a')
        .setDepth(902);
      textTop += 20;
    }

    this.fullText = this.dialogData.text;
    this.charProgress = 0;

    this.textObj = UI.makeText(this, textLeft, textTop, '', 'body', UI.TextColor.primary, 902);
    this.textObj.setWordWrapWidth(panelW - textOffsetX - 20);
    this.textObj.setLineSpacing(4);

    // "▼ tap to continue" — only visible once text is revealed and no choices are pending.
    this.continueHint = this.add
      .text(px + panelW / 2 - 14, py + panelH / 2 - 10, '▼ tap to continue', {
        ...UI.Font.small,
        color: UI.TextColor.secondary,
      })
      .setOrigin(1, 1)
      .setScrollFactor(0)
      .setDepth(902)
      .setVisible(false);
    this.tweens.add({ targets: this.continueHint, alpha: { from: 0.4, to: 1.0 }, duration: 600, yoyo: true, repeat: -1 });

    // Space key also advances / closes
    this.input.keyboard?.on('keydown-SPACE', () => this.advanceOrClose());
  }

  /** Renders the sprite at `portraitKey` if it's loaded, otherwise a placeholder silhouette. */
  private drawPortrait(cx: number, cy: number, size: number): void {
    const hasPortrait = !!this.dialogData.portrait && this.textures.exists(this.dialogData.portrait);

    // Frame background + border, drawn either way so the placeholder reads as "a portrait slot".
    this.add.rectangle(cx, cy, size, size, UI.Color.panelBgSub, 1)
      .setScrollFactor(0)
      .setDepth(901);
    const frame = this.add.graphics().setDepth(903).setScrollFactor(0);
    frame.lineStyle(2, UI.Color.accentFantasy, 0.9);
    frame.strokeRect(cx - size / 2, cy - size / 2, size, size);

    if (hasPortrait) {
      this.add.image(cx, cy, this.dialogData.portrait!)
        .setDisplaySize(size - 4, size - 4)
        .setScrollFactor(0)
        .setDepth(902);
      return;
    }

    // Placeholder silhouette — a simple head + shoulders shape, no NPC art required yet.
    const gfx = this.add.graphics().setDepth(902).setScrollFactor(0);
    gfx.fillStyle(UI.Color.borderOuter, 1);
    const headR = size * 0.22;
    const headCy = cy - size * 0.12;
    gfx.fillCircle(cx, headCy, headR);
    const shoulderTop = headCy + headR * 0.75;
    const shoulderW = size * 0.34;
    const baseW = size * 0.42;
    const base = cy + size * 0.38;
    gfx.beginPath();
    gfx.moveTo(cx - shoulderW, shoulderTop);
    gfx.lineTo(cx + shoulderW, shoulderTop);
    gfx.lineTo(cx + baseW, base);
    gfx.lineTo(cx - baseW, base);
    gfx.closePath();
    gfx.fillPath();
  }

  update(_time: number, delta: number): void {
    if (this.revealed) return;

    this.charProgress += CHARS_PER_SECOND * (delta / 1000);
    const chars = Math.min(Math.floor(this.charProgress), this.fullText.length);
    this.textObj.setText(this.fullText.slice(0, chars));

    if (chars >= this.fullText.length) {
      this.revealed = true;
      this.onFullyRevealed();
    }
  }

  private advanceOrClose(): void {
    if (!this.revealed) {
      // Skip typewriter — show full text immediately
      this.charProgress = this.fullText.length;
      this.textObj.setText(this.fullText);
      this.revealed = true;
      this.onFullyRevealed();
    } else if (!this.dialogData.choices || this.dialogData.choices.length === 0) {
      // Runner node is mid auto-advance (scheduled below) — ignore manual taps until it fires.
      if (this.dialogData.dialogRunner?.currentNode?.next !== undefined) return;
      // No choices — clicking closes the dialog
      this.close(undefined);
    }
    // If choices exist and are shown, closing happens via choice button clicks
  }

  /** Shows choice buttons, or — in runner mode — schedules the next node's auto-advance. */
  private onFullyRevealed(): void {
    this.showChoices();

    const runner = this.dialogData.dialogRunner;
    const hasVisibleChoices = !!this.dialogData.choices && this.dialogData.choices.length > 0;
    if (runner && !hasVisibleChoices && runner.currentNode?.next !== undefined) {
      this.time.delayedCall(AUTO_ADVANCE_DELAY, () => {
        runner.advance();
        this.refreshFromRunner();
      });
    }
  }

  /** Re-reads the runner's current node after choose()/advance() and restarts the typewriter, or closes on END. */
  private refreshFromRunner(): void {
    const runner = this.dialogData.dialogRunner;
    if (!runner) return;

    if (!runner.currentNode) {
      this.close(undefined);
      return;
    }

    this.applyRunnerNode();

    this.choiceButtons.forEach(btn => btn.destroy());
    this.choiceButtons = [];

    this.fullText = this.dialogData.text;
    this.charProgress = 0;
    this.revealed = false;
    this.textObj.setText('');
  }

  private showChoices(): void {
    const hasChoices = !!this.dialogData.choices && this.dialogData.choices.length > 0;
    this.continueHint.setVisible(this.revealed && !hasChoices);
    if (!hasChoices) return;

    const { px, py, panelW, panelH } = this.layout;
    const buttonY = py + panelH / 2 - 28;
    const choices = this.dialogData.choices!;
    const spacing = panelW / (choices.length + 1);

    choices.forEach((choice: DialogChoice, i: number) => {
      const bx = px - panelW / 2 + spacing * (i + 1);
      const btn = UI.makeButton(this, bx, buttonY, choice.label, () => {
        // Runner mode (#943) walks via DialogRunner.choose(); plain tree
        // mode (#946) walks node ids itself; non-tree dialogs keep the
        // original close-and-emit behavior.
        if (this.dialogData.dialogRunner) {
          this.dialogData.dialogRunner.choose(Number(choice.id));
          this.refreshFromRunner();
        } else if (this.dialogData.dialogTree) {
          this.advanceToNode(choice.id);
        } else {
          this.close(choice.id);
        }
      }, { variant: 'accent', depth: 902, scrollFactor: 0 });
      this.choiceButtons.push(btn);
    });
  }

  /**
   * Walks the dialog tree to `nodeId`, clears the old choice buttons, and
   * restarts the typewriter for the new node's text (#946). advanceOrClose()
   * closes the scene once a node with no choices is reached.
   */
  private advanceToNode(nodeId: string): void {
    const tree = this.dialogData.dialogTree;
    if (!tree) return;

    this.applyNode(getNode(tree, nodeId));

    this.choiceButtons.forEach(btn => btn.destroy());
    this.choiceButtons = [];

    this.fullText = this.dialogData.text;
    this.charProgress = 0;
    this.revealed = false;
    this.textObj.setText('');
    this.continueHint.setVisible(false);
  }

  private close(choiceId: string | undefined): void {
    if (choiceId !== undefined) {
      // Emit the choice back to the caller scene via its event bus
      this.scene.get(this.dialogData.callerKey).events.emit('dialog-choice', choiceId);
    }
    this.scene.stop();
    this.scene.resume(this.dialogData.callerKey);
  }
}
