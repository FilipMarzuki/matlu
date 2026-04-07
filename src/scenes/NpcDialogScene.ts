/**
 * NpcDialogScene — JRPG-style dialog box for important NPC conversations (FIL-38).
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────┐
 *   │ [Portrait 48×48]  Speaker Name                   │
 *   │                   Dialog text (typewriter)       │
 *   │                   [Choice A]  [Choice B]          │
 *   └──────────────────────────────────────────────────┘
 *
 * The scene is launched by GameScene (via NPC.EVENT_INTERACT) as a
 * pause-overlay — GameScene pauses; NpcDialogScene stops and resumes it when done.
 *
 * ## Launch
 * ```ts
 * const data: NpcDialogData = {
 *   nodes: SOME_DIALOG,
 *   startId: 'root',
 *   callerKey: 'GameScene',
 * };
 * this.scene.pause();
 * this.scene.launch('NpcDialogScene', data);
 * ```
 *
 * ## Receiving results
 * ```ts
 * this.events.on('npc-dialog-done', (endNodeId: string) => { ... });
 * ```
 */

// ─── Dialog tree format ───────────────────────────────────────────────────────

export interface DialogChoice {
  label: string;
  /** ID of the next node when this choice is selected */
  next: string;
  /**
   * Optional side-effect key. GameScene maps these keys to callables
   * so the dialog tree stays serialisable.
   */
  effect?: string;
}

/**
 * A single node in a branching dialog tree.
 * The tree terminates when a node has neither `next` nor `choices`.
 */
export interface DialogNode {
  id: string;
  /** Speaker's display name */
  speaker: string;
  /** Hex color for the portrait placeholder (until real pixel-art portraits exist) */
  portraitColor: number;
  text: string;
  /** Auto-advance to this node id when the player taps / presses space */
  next?: string;
  choices?: DialogChoice[];
}

export interface NpcDialogData {
  nodes: DialogNode[];
  startId: string;
  /** Key of the scene to resume and notify when done */
  callerKey: string;
}

// ─── Scene ────────────────────────────────────────────────────────────────────

/** Characters revealed per second during the typewriter effect */
const TYPEWRITER_CPS = 28;

export class NpcDialogScene extends Phaser.Scene {
  private nodeMap!:   Map<string, DialogNode>;
  private callerKey!: string;

  private portrait!:  Phaser.GameObjects.Rectangle;
  private nameText!:  Phaser.GameObjects.Text;
  private bodyText!:  Phaser.GameObjects.Text;
  private choiceBtns: Phaser.GameObjects.Rectangle[] = [];
  private choiceLbls: Phaser.GameObjects.Text[]      = [];
  private hintText!:  Phaser.GameObjects.Text;

  private currentNode!:   DialogNode;
  private charProgress  = 0;  // float — fractional character count
  private typewriterDone = false;

  constructor() {
    super({ key: 'NpcDialogScene' });
  }

  create(): void {
    const data = this.scene.settings.data as unknown as NpcDialogData;
    this.callerKey = data.callerKey;
    this.nodeMap   = new Map(data.nodes.map(n => [n.id, n]));

    this.buildPanel();
    this.showNode(data.startId);

    // Advance / skip typewriter on tap or space/enter
    this.input.on('pointerdown', () => this.onAdvance());
    this.input.keyboard?.on('keydown-SPACE', () => this.onAdvance());
    this.input.keyboard?.on('keydown-ENTER', () => this.onAdvance());
  }

  update(_time: number, delta: number): void {
    if (this.typewriterDone) return;

    const target = this.currentNode.text.length;
    this.charProgress += TYPEWRITER_CPS * (delta / 1000);

    if (this.charProgress >= target) {
      this.charProgress     = target;
      this.typewriterDone   = true;
      this.bodyText.setText(this.currentNode.text);
      this.showChoicesOrHint();
    } else {
      this.bodyText.setText(
        this.currentNode.text.slice(0, Math.floor(this.charProgress))
      );
    }
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private buildPanel(): void {
    const sw = this.scale.width;
    const sh = this.scale.height;

    const panelH  = Math.round(sh * 0.26);
    const panelY  = sh - panelH / 2 - 8;
    const panelW  = sw - 24;
    const portSize = panelH - 20;
    const portX   = 12 + portSize / 2;
    const textX   = 12 + portSize + 14;
    const textW   = panelW - portSize - 36;

    // Dark backdrop
    this.add
      .rectangle(sw / 2, sh / 2, sw, sh, 0x000000, 0.35)
      .setScrollFactor(0).setDepth(0);

    this.add
      .rectangle(sw / 2, panelY, panelW, panelH, 0x12121e, 0.96)
      .setStrokeStyle(2, 0x6666aa, 0.8)
      .setScrollFactor(0).setDepth(1);

    // Portrait placeholder
    this.portrait = this.add
      .rectangle(portX, panelY, portSize, portSize, 0x334455)
      .setStrokeStyle(1, 0x8888bb, 0.6)
      .setScrollFactor(0).setDepth(2);

    // Speaker name
    this.nameText = this.add
      .text(textX, panelY - panelH / 2 + 10, '', {
        fontSize: '13px',
        color: '#b8b8e8',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0)
      .setScrollFactor(0).setDepth(2);

    // Dialog body
    this.bodyText = this.add
      .text(textX, panelY - panelH / 2 + 28, '', {
        fontSize: '13px',
        color: '#e8e8f0',
        wordWrap: { width: textW },
        lineSpacing: 4,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0).setDepth(2);

    // Continue hint
    this.hintText = this.add
      .text(sw - 20, sh - 16, '[mellanslag / tryck för att fortsätta]', {
        fontSize: '11px',
        color: '#888899',
      })
      .setOrigin(1, 1)
      .setScrollFactor(0).setDepth(2)
      .setVisible(false);

    this.tweens.add({
      targets: this.hintText,
      alpha: 0.4,
      duration: 650,
      yoyo: true,
      repeat: -1,
    });
  }

  private showNode(id: string): void {
    const node = this.nodeMap.get(id);
    if (!node) { this.finish(id); return; }

    this.currentNode   = node;
    this.charProgress  = 0;
    this.typewriterDone = false;

    this.portrait.setFillStyle(node.portraitColor);
    this.nameText.setText(node.speaker);
    this.bodyText.setText('');
    this.hintText.setVisible(false);
    this.clearChoices();
  }

  private showChoicesOrHint(): void {
    const node = this.currentNode;

    if (node.choices && node.choices.length > 0) {
      this.buildChoices(node.choices);
    } else if (node.next) {
      this.hintText.setVisible(true);
    } else {
      // Terminal node — show a close hint
      this.hintText.setText('[tryck för att stänga]');
      this.hintText.setVisible(true);
    }
  }

  private buildChoices(choices: DialogChoice[]): void {
    const sw     = this.scale.width;
    const sh     = this.scale.height;
    const panelH = Math.round(sh * 0.26);
    const panelY = sh - panelH / 2 - 8;
    const startX = sw / 2 - ((choices.length - 1) * 110) / 2;
    const btnY   = panelY + panelH / 2 - 22;

    choices.forEach((choice, i) => {
      const bx  = startX + i * 110;
      const btn = this.add
        .rectangle(bx, btnY, 100, 28, 0x2a2a4a, 0.9)
        .setStrokeStyle(1, 0x6666aa, 0.8)
        .setInteractive({ useHandCursor: true })
        .setScrollFactor(0).setDepth(3);

      const lbl = this.add
        .text(bx, btnY, choice.label, { fontSize: '12px', color: '#c8c8ee' })
        .setOrigin(0.5)
        .setScrollFactor(0).setDepth(4);

      btn.on('pointerover',  () => btn.setFillStyle(0x3a3a6a, 0.95));
      btn.on('pointerout',   () => btn.setFillStyle(0x2a2a4a, 0.90));
      btn.on('pointerdown',  () => this.selectChoice(choice));
      this.input.keyboard?.once(`keydown-${i + 1}`, () => this.selectChoice(choice));

      this.choiceBtns.push(btn);
      this.choiceLbls.push(lbl);
    });
  }

  private clearChoices(): void {
    this.choiceBtns.forEach(b => b.destroy());
    this.choiceLbls.forEach(l => l.destroy());
    this.choiceBtns = [];
    this.choiceLbls = [];
  }

  private onAdvance(): void {
    if (!this.typewriterDone) {
      // Skip to end of typewriter
      this.charProgress    = this.currentNode.text.length;
      this.typewriterDone  = true;
      this.bodyText.setText(this.currentNode.text);
      this.showChoicesOrHint();
      return;
    }
    // No choices — advance to next node or close
    if (this.currentNode.choices && this.currentNode.choices.length > 0) return;
    if (this.currentNode.next) {
      this.showNode(this.currentNode.next);
    } else {
      this.finish(this.currentNode.id);
    }
  }

  private selectChoice(choice: DialogChoice): void {
    // Emit the effect key so GameScene can respond to it
    if (choice.effect) {
      this.scene.get(this.callerKey).events.emit('npc-dialog-effect', choice.effect);
    }
    if (choice.next === '__close__') {
      this.finish(choice.next);
    } else {
      this.clearChoices();
      this.showNode(choice.next);
    }
  }

  private finish(endNodeId: string): void {
    this.scene.stop();
    this.scene.resume(this.callerKey);
    this.scene.get(this.callerKey).events.emit('npc-dialog-done', endNodeId);
  }
}
