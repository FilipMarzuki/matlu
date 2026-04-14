import * as Phaser from 'phaser';
import { t } from '../lib/i18n';

/**
 * CreditsScene — displays asset pack credits and contributors.
 *
 * Accessible by pressing C on the WilderviewScene, or via the credits
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
    pack: 'calm forest 0852 AM 240320_0695',
    author: 'klankbeeld',
    contact: 'https://freesound.org/s/737961/',
    attributionRequired: true,
    notes: 'Forest ambience loop. License: CC Attribution 4.0',
  },
  {
    pack: 'Impact Sounds (1.0)',
    author: 'Kenney',
    contact: 'www.kenney.nl',
    attributionRequired: false,
    notes: 'Footstep sounds. License: CC0 (public domain)',
  },
  {
    pack: 'leaves.mp3',
    author: 'DSOADigital',
    contact: 'https://freesound.org/s/362253/',
    attributionRequired: false,
    notes: 'Animal rustle / leaves sound. License: CC0 (public domain)',
  },
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
    // FIL-113: Duck audio when credits open over GameScene (C key during gameplay).
    // CreditsScene can also be launched from MainMenuScene — isPaused() guards that case.
    if (this.scene.isPaused('GameScene')) {
      type DuckableScene = Phaser.Scene & { duckAudio?: (tweens: Phaser.Tweens.TweenManager) => void };
      (this.scene.get('GameScene') as DuckableScene).duckAudio?.(this.tweens);
    }

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
      .text(width / 2, y, t('credits.title'), {
        fontSize: '22px',
        color: '#f0ead6',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(801);

    y += 40;

    this.add
      .text(width / 2, y, t('credits.asset_packs_heading'), {
        fontSize: '13px',
        color: '#90b8e8',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(801);

    y += 26;

    for (const entry of CREDITS) {
      const attribution = entry.attributionRequired ? t('credits.attribution_required') : '';
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
      .text(width / 2, y, t('credits.game_code_by'), {
        fontSize: '11px',
        color: '#666666',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(801);

    y += 24;
    this.add
      .text(width / 2, y, t('credits.close_hint'), {
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
    // Resume the scene that launched credits (WilderviewScene or GameScene)
    const callerKey = (this.scene.settings.data as unknown as string) ?? 'GameScene';
    this.scene.resume(callerKey);
  }
}
