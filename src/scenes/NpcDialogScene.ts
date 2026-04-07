import Phaser from 'phaser';

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
 */

const CHARS_PER_SECOND = 38;

export interface DialogChoice {
  id: string;
  label: string;
}

export interface NpcDialogData {
  /** Key of the scene that launched this dialog — used to resume it and emit events */
  callerKey: string;
  /** The line of text to display */
  text: string;
  /** Optional choices shown after text is fully revealed */
  choices?: DialogChoice[];
}

export class NpcDialogScene extends Phaser.Scene {
  private dialogData!: NpcDialogData;
  private textObj!: Phaser.GameObjects.Text;
  private charProgress = 0;
  private fullText = '';
  private revealed = false;
  private choiceButtons: Phaser.GameObjects.Text[] = [];

  constructor() {
    super({ key: 'NpcDialogScene' });
  }

  // Phaser passes the data argument from scene.launch() here.
  // We cast it because Phaser types the arg as `object`.
  init(data: object): void {
    this.dialogData = data as NpcDialogData;
  }

  create(): void {
    const { width, height } = this.cameras.main;
    const panelW = Math.min(width * 0.8, 600);
    const panelH = 180;
    const px = width / 2;
    const py = height - panelH / 2 - 24;

    // Semi-transparent panel background
    this.add
      .rectangle(px, py, panelW, panelH, 0x000000, 0.82)
      .setScrollFactor(0)
      .setDepth(900)
      .setInteractive()
      .on('pointerdown', () => this.advanceOrClose());

    // Decorative border
    const border = this.add.graphics().setDepth(901).setScrollFactor(0);
    border.lineStyle(2, 0xffffff, 0.25);
    border.strokeRect(px - panelW / 2, py - panelH / 2, panelW, panelH);

    this.fullText = this.dialogData.text;
    this.charProgress = 0;

    this.textObj = this.add
      .text(px - panelW / 2 + 20, py - panelH / 2 + 18, '', {
        fontSize: '15px',
        color: '#f0ead6',
        wordWrap: { width: panelW - 40 },
        lineSpacing: 4,
      })
      .setScrollFactor(0)
      .setDepth(902);

    // Space key also advances / closes
    this.input.keyboard?.on('keydown-SPACE', () => this.advanceOrClose());
  }

  update(_time: number, delta: number): void {
    if (this.revealed) return;

    this.charProgress += CHARS_PER_SECOND * (delta / 1000);
    const chars = Math.min(Math.floor(this.charProgress), this.fullText.length);
    this.textObj.setText(this.fullText.slice(0, chars));

    if (chars >= this.fullText.length) {
      this.revealed = true;
      this.showChoices();
    }
  }

  private advanceOrClose(): void {
    if (!this.revealed) {
      // Skip typewriter — show full text immediately
      this.charProgress = this.fullText.length;
      this.textObj.setText(this.fullText);
      this.revealed = true;
      this.showChoices();
    } else if (!this.dialogData.choices || this.dialogData.choices.length === 0) {
      // No choices — clicking closes the dialog
      this.close(undefined);
    }
    // If choices exist and are shown, closing happens via choice button clicks
  }

  private showChoices(): void {
    if (!this.dialogData.choices || this.dialogData.choices.length === 0) return;

    const { width, height } = this.cameras.main;
    const panelW = Math.min(width * 0.8, 600);
    const panelH = 180;
    const py = height - panelH / 2 - 24;
    const buttonY = py + panelH / 2 - 28;
    const spacing = panelW / (this.dialogData.choices.length + 1);

    this.dialogData.choices.forEach((choice: DialogChoice, i: number) => {
      const bx = width / 2 - panelW / 2 + spacing * (i + 1);
      const btn = this.add
        .text(bx, buttonY, choice.label, {
          fontSize: '13px',
          color: '#ffe066',
          backgroundColor: '#333300aa',
          padding: { x: 10, y: 5 },
        })
        .setOrigin(0.5, 1)
        .setScrollFactor(0)
        .setDepth(902)
        .setInteractive()
        .on('pointerdown', () => this.close(choice.id))
        .on('pointerover', function (this: Phaser.GameObjects.Text) { this.setColor('#ffffff'); })
        .on('pointerout',  function (this: Phaser.GameObjects.Text) { this.setColor('#ffe066'); });
      this.choiceButtons.push(btn);
    });
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
