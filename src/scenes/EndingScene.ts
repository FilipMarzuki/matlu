/**
 * EndingScene — full-screen outro shown when the player reaches the portal.
 *
 * ## Why a separate scene instead of extending LevelCompleteScene?
 * The ending is a narrative moment, not a score screen. It needs its own layout,
 * colour palette per ending, and alignment bar reveal — adding that to
 * LevelCompleteScene would bloat it with unrelated concerns.
 *
 * ## The four endings (from FIL-146 design spec)
 * - restoration  : Earth dominant + cleanse ≥ 60% — worlds separated, peaceful cost
 * - weaving      : All three scores within 20 pts + cleanse ≥ 50% — worlds fused
 * - wound        : Spino or Vatten dominant + cleanse ≥ 40% — fragile stability
 * - silence      : Cleanse < 40% — Skymning overwhelms; the only "bad" ending
 *
 * ## Why no alignment labels during play?
 * Per spec: "No alignment meter shown to player at any point — they play, not
 * optimise." Labels are only shown HERE, retrospectively, after the ending text.
 */

import * as Phaser from 'phaser';

export type EndingId = 'restoration' | 'weaving' | 'wound' | 'silence';

export interface EndingSceneData {
  ending: EndingId;
  alignment: { earth: number; spino: number; vatten: number };
  kills: number;
  durationMs: number;
  cleanse: number;
}

/**
 * Determine which of the four endings the player earned.
 *
 * Priority order (first match wins):
 *   1. silence     — cleanse too low regardless of alignment
 *   2. weaving     — all three scores within 20 pts of each other (balanced)
 *   3. restoration — Earth dominant + cleanse ≥ 60%
 *   4. wound       — default when no other condition met
 */
export function determineEnding(
  alignment: { earth: number; spino: number; vatten: number },
  cleansePercent: number,
): EndingId {
  if (cleansePercent < 40) return 'silence';
  const { earth, spino, vatten } = alignment;
  const max = Math.max(earth, spino, vatten);
  const min = Math.min(earth, spino, vatten);
  if (max - min <= 20 && cleansePercent >= 50) return 'weaving';
  if (earth >= spino && earth >= vatten && cleansePercent >= 60) return 'restoration';
  return 'wound';
}

// ── Ending content ─────────────────────────────────────────────────────────────

interface EndingDef {
  title: string;
  body: string;
  /** Accent bar colour at the top of the screen */
  accentColor: number;
}

const ENDINGS: Record<EndingId, EndingDef> = {
  restoration: {
    title: 'The Restoration',
    body: 'The worlds are separated. The tears close. The blended connections — adapted creatures, cross-world relationships, merged knowledge — are undone. The Swedish coast is quiet again. The player character returns home to a world that remembers nothing of the others. It is peaceful and it costs something real.',
    accentColor: 0x3a6b8a,
  },
  weaving: {
    title: 'The Weaving',
    body: 'The worlds are permanently fused. The Skymning is managed rather than cured — held at natural levels by a new understanding across all three civilisations. A new world begins. The player character has no single home anymore and has made peace with that. The most hopeful ending. Also the hardest to reach.',
    accentColor: 0x4a8a5a,
  },
  wound: {
    title: 'The Wound Held Open',
    body: "The source is stopped but the tears don't close. The blended world stabilises into something fragile — functional but unresolved. One world's values shaped the outcome; the other two are present but secondary. Not a failure. Not a resolution. A beginning that knows it is incomplete.",
    accentColor: 0x8a6a3a,
  },
  silence: {
    title: 'The Silence',
    body: 'The Skymning overwhelms the Seam. All three worlds continue their collapse. No resolution — just aftermath. The only ending earned by ignoring the corruption rather than by making a wrong choice.',
    accentColor: 0x3a1a2a,
  },
};

// ── Scene ──────────────────────────────────────────────────────────────────────

export class EndingScene extends Phaser.Scene {
  static readonly KEY = 'EndingScene';

  private endingData!: EndingSceneData;
  private endingMusic: Phaser.Sound.BaseSound | undefined;

  constructor() {
    super({ key: EndingScene.KEY });
  }

  preload(): void {
    // Calm hopeful ambient for the ending narrative screen (FIL-111).
    this.load.audio('music-ending', [
      'assets/audio/music-loop-bundle-2026-q1/Week 2 - Ruined Lands HOPE.ogg',
    ]);
  }

  // Phaser calls init() with the data object passed to scene.launch().
  init(data: EndingSceneData): void {
    this.endingData = data;
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    const ending = ENDINGS[this.endingData.ending];

    // Use a fixed (non-scrolling) camera so the overlay renders in screen space.
    this.cameras.main.setScroll(0, 0);

    // ── Ending ambient music ──────────────────────────────────────────────────
    // Start at 0 and fade in so the jingle playing in GameScene isn't abruptly
    // cut off. Music key loaded in preload() above.
    if (this.cache.audio.has('music-ending')) {
      this.endingMusic = this.sound.add('music-ending', { loop: true, volume: 0 });
      this.endingMusic.play();
      type AudibleSound = Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;
      this.tweens.add({ targets: this.endingMusic as AudibleSound, volume: 0.15, duration: 2000, ease: 'Sine.easeIn' });
    }

    // ── Background ────────────────────────────────────────────────────────────
    this.add.rectangle(cx, height / 2, width, height, 0x05050f).setScrollFactor(0);

    // Thin accent strip along the top — colour signals which ending type this is
    this.add.rectangle(cx, 6, width, 12, ending.accentColor, 0.9).setScrollFactor(0);

    // ── Ending title ──────────────────────────────────────────────────────────
    this.add.text(cx, 48, ending.title, {
      fontSize: '28px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);

    // ── Narrative body ────────────────────────────────────────────────────────
    this.add.text(cx, 96, ending.body, {
      fontSize: '13px',
      color: '#bbbbcc',
      wordWrap: { width: Math.min(500, width - 80) },
      align: 'center',
      lineSpacing: 5,
    }).setOrigin(0.5, 0).setScrollFactor(0);

    // ── Alignment score bars ──────────────────────────────────────────────────
    // Shown retrospectively here — never displayed during play (FIL-146 spec).
    const barAreaTop = height * 0.57;

    this.add.text(cx, barAreaTop - 20, 'World Alignment', {
      fontSize: '11px',
      color: '#666688',
      fontStyle: 'italic',
    }).setOrigin(0.5).setScrollFactor(0);

    const barW   = Math.min(260, width - 120);
    const barH   = 10;
    const trackX = cx;                  // centre of bar track

    const rows: Array<{ label: string; value: number; fillColor: number }> = [
      { label: 'Earth',             value: this.endingData.alignment.earth, fillColor: 0x4a9ab0 },
      { label: 'Spinaria',  value: this.endingData.alignment.spino,  fillColor: 0x6ab054 },
      { label: 'Mistheim', value: this.endingData.alignment.vatten, fillColor: 0x5477b0 },
    ];

    rows.forEach(({ label, value, fillColor }, i) => {
      const ry = barAreaTop + i * 30;

      // Track background
      this.add.rectangle(trackX, ry, barW, barH, 0x1e1e33).setScrollFactor(0);

      // Filled portion (left-aligned within track)
      const filled = Math.max(0, (value / 100) * barW);
      if (filled > 0) {
        // Rectangle origin is centre, so offset x to align left edge with track
        this.add.rectangle(trackX - barW / 2 + filled / 2, ry, filled, barH, fillColor)
          .setScrollFactor(0);
      }

      // World name (right-aligned just left of the track)
      this.add.text(trackX - barW / 2 - 8, ry, label, {
        fontSize: '10px', color: '#999999',
      }).setOrigin(1, 0.5).setScrollFactor(0);

      // Numeric value (left of the right edge)
      this.add.text(trackX + barW / 2 + 8, ry, String(Math.round(value)), {
        fontSize: '10px', color: '#999999',
      }).setOrigin(0, 0.5).setScrollFactor(0);
    });

    // ── Run stats ─────────────────────────────────────────────────────────────
    const statsY = barAreaTop + rows.length * 30 + 20;
    const mins   = Math.floor(this.endingData.durationMs / 60_000);
    const secs   = Math.floor((this.endingData.durationMs % 60_000) / 1000);
    const time   = `${mins}:${secs.toString().padStart(2, '0')}`;

    this.add.text(cx, statsY,
      `Cleanse ${this.endingData.cleanse}%  ·  ${this.endingData.kills} defeated  ·  ${time}`, {
      fontSize: '11px',
      color: '#555577',
    }).setOrigin(0.5).setScrollFactor(0);

    // ── Main Menu button ──────────────────────────────────────────────────────
    const btnY = statsY + 44;
    const btn  = this.add.text(cx, btnY, 'Main Menu', {
      fontSize: '15px',
      color: '#ddddee',
      backgroundColor: '#2a2a44',
      padding: { x: 22, y: 10 },
    }).setOrigin(0.5).setScrollFactor(0).setInteractive({ useHandCursor: true });

    btn.on('pointerover', () => btn.setStyle({ backgroundColor: '#44446a' }));
    btn.on('pointerout',  () => btn.setStyle({ backgroundColor: '#2a2a44' }));
    btn.on('pointerdown', () => {
      // Stop ambient music before tearing down the scene.
      this.endingMusic?.stop();
      // Stop both the frozen GameScene and this overlay, then return to the menu
      this.scene.stop('GameScene');
      this.scene.stop(EndingScene.KEY);
      this.scene.start('MainMenuScene');
    });
  }
}
