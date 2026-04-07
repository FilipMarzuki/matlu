import Phaser from 'phaser';

/**
 * AttractionScene — the first thing players see at the Vercel URL.
 *
 * Not a menu. A living demo of the world: the camera drifts autonomously
 * across the map, showing wildlife areas and points of interest. Once
 * GameScene has active entities (wildlife animals, NPCs) the scene will
 * track them; for now the camera visits a set of predefined attraction
 * points and pans between them.
 *
 * Flow:
 *   AttractionScene (camera demo) → player presses button → GameScene
 */

/** A world-space position the camera visits and optionally pans toward. */
interface AttractionPoint {
  x: number;
  y: number;
  label: string;
  durationMs: number;
}

// Predefined attraction points across the 2400×2000 world.
// Add more as the world is built out (sync with LDtk AttractionPoint entities).
const ATTRACTION_POINTS: AttractionPoint[] = [
  { x: 400,  y: 1000, label: 'Vägkorsningen',    durationMs: 10000 },
  { x: 160,  y: 800,  label: 'Övre vänster zon', durationMs: 9000  },
  { x: 700,  y: 850,  label: 'Övre höger zon',   durationMs: 8000  },
  { x: 150,  y: 1200, label: 'Nedre vänster zon', durationMs: 9000 },
  { x: 700,  y: 1200, label: 'Nedre höger zon',  durationMs: 8000  },
  { x: 1200, y: 1000, label: 'Centrala fältet',  durationMs: 12000 },
];

export class AttractionScene extends Phaser.Scene {
  private pointIndex = 0;
  private overlayBg!: Phaser.GameObjects.Rectangle;
  private overlayLabel!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'AttractionScene' });
  }

  create(): void {
    const { width, height } = this.cameras.main;

    // Camera starts at the first attraction point (no lerp on first frame)
    const first = ATTRACTION_POINTS[0];
    this.cameras.main.centerOn(first.x, first.y);
    this.cameras.main.setBounds(0, 0, 2400, 2000);

    this.createStateOverlay(width, height);
    this.createPlayButton(width, height);

    // Kick off the first camera move
    this.time.delayedCall(1000, () => this.transitionToNext());
  }

  // ─── Camera movement ───────────────────────────────────────────────────────

  private transitionToNext(): void {
    this.cameras.main.fadeOut(400, 0, 0, 0);

    this.cameras.main.once(
      Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE,
      () => {
        this.pointIndex = (this.pointIndex + 1) % ATTRACTION_POINTS.length;
        const target = ATTRACTION_POINTS[this.pointIndex];

        this.cameras.main.centerOn(target.x, target.y);
        this.updateOverlay(target.label);

        this.cameras.main.fadeIn(600, 0, 0, 0);

        this.cameras.main.once(
          Phaser.Cameras.Scene2D.Events.FADE_IN_COMPLETE,
          () => {
            // Schedule next transition after the point's dwell time
            this.time.delayedCall(target.durationMs, () => this.transitionToNext());
          }
        );
      }
    );
  }

  // ─── State overlay ─────────────────────────────────────────────────────────

  private createStateOverlay(_width: number, _height: number): void {
    // Subtle panel in the bottom-left corner
    this.overlayBg = this.add
      .rectangle(12, _height - 12, 180, 44, 0x000000, 0.45)
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(500)
      .setAlpha(0);

    this.overlayLabel = this.add
      .text(20, _height - 36, '', { fontSize: '11px', color: '#cccccc' })
      .setScrollFactor(0)
      .setDepth(501)
      .setAlpha(0);

    const first = ATTRACTION_POINTS[this.pointIndex];
    this.updateOverlay(first.label);
  }

  private updateOverlay(label: string): void {
    this.overlayLabel.setText(label);
    this.tweens.add({ targets: [this.overlayBg, this.overlayLabel], alpha: 0.9, duration: 400 });
  }

  // ─── Play button ───────────────────────────────────────────────────────────

  private createPlayButton(width: number, height: number): void {
    const btn = this.add
      .text(width / 2, height - 52, 'Tryck för att spela', {
        fontSize: '16px',
        color: '#ffffff',
        backgroundColor: '#00000066',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(502)
      .setInteractive({ useHandCursor: true });

    // Pulse animation
    this.tweens.add({
      targets: btn,
      alpha: 0.45,
      duration: 1100,
      yoyo: true,
      repeat: -1,
    });

    btn.on('pointerdown', () => this.startGame());
    this.input.keyboard?.on('keydown-SPACE', () => this.startGame());
    this.input.keyboard?.on('keydown-ENTER', () => this.startGame());
  }

  private startGame(): void {
    // Remove keyboard listeners to avoid double-firing
    this.input.keyboard?.off('keydown-SPACE');
    this.input.keyboard?.off('keydown-ENTER');

    this.cameras.main.fadeOut(700, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('GameScene');
    });
  }
}
