/**
 * CreditsScene — displays asset pack credits and contributors.
 *
 * Accessible by pressing C on the AttractionScene, or via the credits
 * button if one is added to the UI. Press Escape or click to dismiss.
 */

interface CreditEntry {
  pack: string;
  author: string;
  contact?: string;
  /** Whether attribution is legally required */
  attributionRequired: boolean;
  /** Human-readable license notes */
  notes?: string;
}

const CREDITS: CreditEntry[] = [
  {
    pack: 'Pixel Crawler - Fairy Forest 1.7',
    author: 'Anokolisa',
    contact: 'AnomalyPixel@gmail.com',
    attributionRequired: false,
    notes: 'Paid pack — credit appreciated but not required.',
  },
  {
    pack: 'Pixel Crawler - Garden Environment',
    author: 'Anokolisa',
    contact: 'AnomalyPixel@gmail.com',
    attributionRequired: false,
    notes: 'Paid pack — credit appreciated but not required. Attribution required if game contains a saxophone solo.',
  },
  {
    pack: 'Pixel Crawler - Cemetery',
    author: 'Anokolisa',
    contact: 'AnomalyPixel@gmail.com',
    attributionRequired: false,
    notes: 'Paid pack — credit appreciated but not required.',
  },
  {
    pack: 'Mystic Woods (Free)',
    author: 'Game Endeavour',
    attributionRequired: true,
    notes: 'Free tileset — attribution required.',
  },
];

export class CreditsScene extends Phaser.Scene {
  constructor() {
    super({ key: 'CreditsScene' });
  }

  create(): void {
    const { width, height } = this.cameras.main;

    // Semi-transparent backdrop
    this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.78)
      .setScrollFactor(0)
      .setDepth(800)
      .setInteractive()
      .on('pointerdown', () => this.close());

    const lineHeight = 18;
    let y = 60;

    this.add
      .text(width / 2, y, 'Credits', {
        fontSize: '22px',
        color: '#f0ead6',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(801);

    y += 40;

    this.add
      .text(width / 2, y, 'Asset Packs', {
        fontSize: '13px',
        color: '#90b8e8',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(801);

    y += 26;

    for (const entry of CREDITS) {
      const attribution = entry.attributionRequired ? ' ★ attribution required' : '';
      this.add
        .text(40, y, `${entry.pack}  —  ${entry.author}${attribution}`, {
          fontSize: '12px',
          color: entry.attributionRequired ? '#f0a020' : '#cccccc',
        })
        .setScrollFactor(0)
        .setDepth(801);
      y += lineHeight;

      if (entry.notes) {
        this.add
          .text(48, y, entry.notes, {
            fontSize: '10px',
            color: '#888888',
          })
          .setScrollFactor(0)
          .setDepth(801);
        y += lineHeight;
      }

      y += 6;
    }

    y += 16;
    this.add
      .text(width / 2, y, 'Game code by Filip Marzuki', {
        fontSize: '11px',
        color: '#666666',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(801);

    y += 24;
    this.add
      .text(width / 2, y, 'Press Escape or click anywhere to close', {
        fontSize: '11px',
        color: '#555555',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(801);

    this.input.keyboard?.on('keydown-ESC', () => this.close());
  }

  private close(): void {
    this.scene.stop();
    // Resume the scene that launched credits (AttractionScene or GameScene)
    const callerKey = (this.scene.settings.data as unknown as string) ?? 'GameScene';
    this.scene.resume(callerKey);
  }
}
