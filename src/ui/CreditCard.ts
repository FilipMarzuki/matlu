import * as Phaser from 'phaser';
import {
  getCommunityCreditMeta,
  getCommunityCreatorLine,
} from '../lib/communityRegistryLookup';

const DISPLAY_MS = 4000;
const SLIDE_MS = 320;
const BG_COLOR = 0x000000;
const BG_ALPHA = 0.7;
const DEPTH = 100_000;

export interface CommunityCreatureSpawnedPayload {
  entityId: string;
}

/**
 * Bottom-right toast that credits a community creature's creator on first
 * encounter. Listens for `community-creature-spawned` on the scene event bus.
 */
export class CreditCard {
  private root: Phaser.GameObjects.Container | null = null;
  private hideTimer: Phaser.Time.TimerEvent | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.scene.events.on('community-creature-spawned', this.onSpawned, this);
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.dispose, this);
  }

  private onSpawned(payload: CommunityCreatureSpawnedPayload): void {
    const meta = getCommunityCreditMeta(payload.entityId);
    if (!meta) return;
    this.show(meta.displayName, getCommunityCreatorLine(meta));
  }

  private dispose(): void {
    this.scene.events.off('community-creature-spawned', this.onSpawned, this);
    this.clearCard();
  }

  private clearCard(): void {
    if (this.hideTimer) {
      this.hideTimer.remove(false);
      this.hideTimer = null;
    }
    if (this.root) {
      this.scene.tweens.killTweensOf(this.root);
      this.root.destroy();
      this.root = null;
    }
  }

  private show(creatureTitle: string, creatorLine: string): void {
    this.clearCard();

    const pad = 16;
    const maxW = Math.min(340, this.scene.scale.width - pad * 2);
    const titleStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: '"Syne", sans-serif',
      fontSize: '17px',
      color: '#ffffff',
      fontStyle: 'bold',
      wordWrap: { width: maxW - 24 },
    };
    const subStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: '"Syne", sans-serif',
      fontSize: '14px',
      color: '#dddddd',
      wordWrap: { width: maxW - 24 },
    };

    const titleObj = this.scene.add.text(0, 0, `🦎 ${creatureTitle}`, titleStyle);
    const subObj = this.scene.add.text(0, 0, creatorLine, subStyle);
    titleObj.setOrigin(1, 0);
    subObj.setOrigin(1, 0);

    const innerPadX = 12;
    const innerPadY = 10;
    const contentW = Math.max(titleObj.width, subObj.width) + innerPadX * 2;
    const contentH = titleObj.height + subObj.height + innerPadY * 2 + 4;
    const w = Math.min(Math.max(contentW, 200), maxW);
    const h = contentH;

    const bg = this.scene.add.rectangle(0, 0, w, h, BG_COLOR, BG_ALPHA);
    bg.setOrigin(1, 1);
    bg.setStrokeStyle(1, 0x444444, 0.6);

    titleObj.setPosition(-innerPadX, -h + innerPadY);
    subObj.setPosition(-innerPadX, titleObj.y + titleObj.height + 4);

    const container = this.scene.add.container(this.scene.scale.width + w + pad, this.scene.scale.height - pad, [
      bg,
      titleObj,
      subObj,
    ]);
    container.setScrollFactor(0);
    container.setDepth(DEPTH);
    this.root = container;

    const targetX = this.scene.scale.width - pad;

    this.scene.tweens.add({
      targets: container,
      x: targetX,
      duration: SLIDE_MS,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.hideTimer = this.scene.time.delayedCall(DISPLAY_MS, () => {
          this.hideTimer = null;
          if (!this.root) return;
          this.scene.tweens.add({
            targets: this.root,
            x: this.scene.scale.width + w + pad,
            duration: SLIDE_MS,
            ease: 'Cubic.easeIn',
            onComplete: () => this.clearCard(),
          });
        });
      },
    });
  }
}
