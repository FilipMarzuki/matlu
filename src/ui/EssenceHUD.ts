import * as Phaser from 'phaser';
import type { EssenceSystem } from '../systems/EssenceSystem';
import { ESSENCE_CHANGED_EVENT } from '../systems/EssenceSystem';

const DEPTH = 300;

/**
 * EssenceHUD — small fixed badge in the top-left corner showing carried Essence.
 *
 * Placed below the gold counter (which sits at ~40 px from the top).
 * Updates immediately whenever EssenceSystem emits ESSENCE_CHANGED_EVENT.
 *
 * Lifecycle: constructed once in GameScene.create(); cleans itself up on
 * SHUTDOWN via Phaser's scene event.
 */
export class EssenceHUD {
  private readonly label: Phaser.GameObjects.Text;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly essenceSystem: EssenceSystem,
  ) {
    const pad = 14;
    // Positioned below the gold counter (pad + hpBarH + goldText gap ≈ 54 px)
    const y = pad + 14 + 12 + 16;

    this.label = scene.add
      .text(pad, y, this._format(), {
        fontFamily: '"Syne", sans-serif',
        fontSize: '11px',
        color: '#aaffcc',
      })
      .setScrollFactor(0)
      .setDepth(DEPTH);

    scene.events.on(ESSENCE_CHANGED_EVENT, this._onChanged, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this._dispose, this);
  }

  private _format(): string {
    return `✦ ${this.essenceSystem.getCarried()}`;
  }

  private _onChanged(): void {
    this.label.setText(this._format());
  }

  private _dispose(): void {
    this.scene.events.off(ESSENCE_CHANGED_EVENT, this._onChanged, this);
    this.label.destroy();
  }
}
