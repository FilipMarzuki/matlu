/**
 * DialogScene — pause overlay for narrative text and choice menus (FIL-35).
 *
 * Launched by GameScene with `this.scene.pause()` + `this.scene.launch('DialogScene', data)`.
 * When dismissed or a choice is made, the scene stops itself, resumes the caller,
 * and emits a `dialog-choice` event on the caller's event bus.
 *
 * ## Data shape
 * ```ts
 * const data: DialogData = {
 *   lines: ['Line one.', 'Line two.'],
 *   choices: [{ id: 'a', label: 'Option A' }], // optional
 *   callerKey: 'GameScene',
 * };
 * this.scene.pause();
 * this.scene.launch('DialogScene', data);
 * ```
 *
 * ## Receiving the result in the caller
 * ```ts
 * this.events.on('dialog-choice', (choiceId: string) => {
 *   console.log('Player chose:', choiceId);
 * });
 * ```
 */

export interface DialogChoice {
  id: string;
  label: string;
}

export interface DialogData {
  lines: string[];
  choices?: DialogChoice[];
  /** Key of the scene to resume when done */
  callerKey: string;
}

export class DialogScene extends Phaser.Scene {
  constructor() {
    super({ key: 'DialogScene' });
  }

  create(): void {
    const data  = this.scene.settings.data as unknown as DialogData;
    const { lines, choices, callerKey } = data;

    const sw = this.scale.width;
    const sh = this.scale.height;

    // Dark vignette behind the box so the game world is still visible
    this.add
      .rectangle(sw / 2, sh / 2, sw, sh, 0x000000, 0.55)
      .setScrollFactor(0)
      .setDepth(0);

    // ── Box geometry ────────────────────────────────────────────────────────
    const boxW       = Math.min(sw - 80, 540);
    const lineHeight = 28;
    const linesH     = lines.length * lineHeight;
    const choicesH   = choices ? choices.length * 48 + 16 : 0;
    const boxH       = 40 + linesH + choicesH + 24;
    const boxX       = sw / 2;
    const boxY       = sh / 2;

    this.add
      .rectangle(boxX, boxY, boxW, boxH, 0x1a1a2e, 0.95)
      .setStrokeStyle(2, 0xaaaacc, 0.8)
      .setScrollFactor(0)
      .setDepth(1);

    // ── Dialog lines ────────────────────────────────────────────────────────
    const textStartY = boxY - boxH / 2 + 24;
    lines.forEach((line, i) => {
      this.add
        .text(boxX, textStartY + i * lineHeight, line, {
          fontSize: '15px',
          color: '#e8e8f0',
          wordWrap: { width: boxW - 48 },
          align: 'center',
        })
        .setOrigin(0.5, 0)
        .setScrollFactor(0)
        .setDepth(2);
    });

    // ── Choice buttons or dismiss hint ──────────────────────────────────────
    if (choices && choices.length > 0) {
      const choicesStartY = textStartY + linesH + 20;
      choices.forEach((choice, i) => {
        const btnY = choicesStartY + i * 48;
        const btn  = this.add
          .rectangle(boxX, btnY, boxW - 60, 36, 0x2a2a4a, 0.9)
          .setStrokeStyle(1, 0x6666aa, 0.8)
          .setInteractive({ useHandCursor: true })
          .setScrollFactor(0)
          .setDepth(2);

        this.add
          .text(boxX, btnY, choice.label, { fontSize: '14px', color: '#c8c8ee' })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(3);

        btn.on('pointerover',  () => btn.setFillStyle(0x3a3a6a, 0.95));
        btn.on('pointerout',   () => btn.setFillStyle(0x2a2a4a, 0.90));
        btn.on('pointerdown',  () => this.choose(choice.id, callerKey));

        // Keyboard shortcut: 1 / 2 / 3
        if (i < 9) {
          this.input.keyboard?.once(`keydown-${i + 1}`, () =>
            this.choose(choice.id, callerKey));
        }
      });
    } else {
      // No choices — tap or press to continue
      const hint = this.add
        .text(boxX, boxY + boxH / 2 - 18, '[Tryck var som helst för att fortsätta]', {
          fontSize: '12px',
          color: '#888899',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(2);

      // Subtle blink on the hint
      this.tweens.add({ targets: hint, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });

      this.input.once('pointerdown', () => this.dismiss(callerKey));
      this.input.keyboard?.once('keydown-ESC',   () => this.dismiss(callerKey));
      this.input.keyboard?.once('keydown-SPACE',  () => this.dismiss(callerKey));
      this.input.keyboard?.once('keydown-ENTER',  () => this.dismiss(callerKey));
    }
  }

  private choose(choiceId: string, callerKey: string): void {
    this.scene.stop();
    this.scene.resume(callerKey);
    // Deliver the result to the caller on its own event bus
    this.scene.get(callerKey).events.emit('dialog-choice', choiceId);
  }

  private dismiss(callerKey: string): void {
    this.scene.stop();
    this.scene.resume(callerKey);
  }
}
