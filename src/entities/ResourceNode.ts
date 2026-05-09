/**
 * ResourceNode — interactable world object that yields items when gathered.
 *
 * Lifecycle: ready → (player presses E or taps) → depleted → (respawn timer) → ready
 *
 * Built on InteractiveObject so proximity detection is handled by Phaser's
 * physics overlap — no manual distance checks in update loops.
 *
 * ## Setup (in your scene)
 *
 *   // create():
 *   const node = new ResourceNode(this, x, y, def, inventory);
 *   // That's it — node self-registers physics body + overlap + input.
 *   // Optionally add a collider so the player can't walk through:
 *   this.physics.add.collider(player, node);
 *
 *   // No update() loop needed for proximity — physics overlap handles it.
 *
 * ## Events
 *
 * Emits `'resource-gathered'` on scene.events with `{ nodeId, yields }` so
 * other systems (quest tracker, sound manager, etc.) can react.
 */

import * as Phaser from 'phaser';
import { InteractiveObject } from '../environment/InteractiveObject';
import type { InventorySystem } from '../systems/InventorySystem';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ResourceNodeYield {
  itemId: string;
  min: number;
  max: number;
}

export interface ResourceNodeTypeDef {
  id: string;
  label: string;
  spriteKey: string;
  yields: ResourceNodeYield[];
  respawnMs: number;
  interactRadius: number;
  colliderWidth?: number;
  colliderHeight?: number;
  colliderOffsetY?: number;
}

export type ResourceNodeState = 'ready' | 'depleted';

// ── Class ──────────────────────────────────────────────────────────────────────

export class ResourceNode extends InteractiveObject {
  readonly def: ResourceNodeTypeDef;
  private readonly inventory: InventorySystem;

  private _nodeState: ResourceNodeState = 'ready';
  private _promptText: Phaser.GameObjects.Text;
  private _playerInRange = false;
  private _eKey: Phaser.Input.Keyboard.Key | null;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    def: ResourceNodeTypeDef,
    inventory: InventorySystem,
  ) {
    super(scene, x, y, def.spriteKey, {
      trigger: 'player-nearby',
      triggerRadius: def.interactRadius,
      colliderWidth:   def.colliderWidth   ?? 16,
      colliderHeight:  def.colliderHeight  ?? 16,
      colliderOffsetY: def.colliderOffsetY ?? 0,
    });

    this.def = def;
    this.inventory = inventory;

    this.sortDepth();

    // Static physics body for collision (player can't walk through)
    scene.physics.add.existing(this, true);
    const body = this.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(this.colliderWidth, this.colliderHeight);
    body.setOffset(
      (this.displayWidth  - this.colliderWidth)  / 2,
      this.displayHeight  - this.colliderHeight  + this.colliderOffsetY,
    );
    body.reset(this.x, this.y);

    // Interaction prompt — hidden until player enters overlap zone
    this._promptText = scene.add.text(x, y - this.displayHeight - 4, '[E] Gather', {
      fontSize: '9px',
      color: '#ffe066',
      fontFamily: 'monospace',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5, 1).setAlpha(0).setDepth(9999);

    // E key (idempotent — all nodes share the same Key instance)
    this._eKey = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.E) ?? null;

    // Tap / click to gather (mobile + mouse)
    this.setInteractive({ useHandCursor: true });
    this.on('pointerup', () => this.gather());
  }

  get nodeState(): ResourceNodeState {
    return this._nodeState;
  }

  /**
   * Call from a physics overlap callback when the player enters this node's
   * interact radius. The overlap zone is set up by the scene once — not per frame.
   */
  setPlayerInRange(inRange: boolean): void {
    this._playerInRange = inRange;

    if (inRange && this._nodeState === 'ready') {
      this._promptText.setAlpha(1);
    } else {
      this._promptText.setAlpha(0);
    }
  }

  /**
   * Lightweight per-frame check — only processes the E key, no distance math.
   * Call from scene.update() if you want keyboard gathering. Skip entirely
   * if you only support tap/click.
   */
  checkInput(): void {
    if (this._playerInRange && this._nodeState === 'ready' &&
        this._eKey && Phaser.Input.Keyboard.JustDown(this._eKey)) {
      this.gather();
    }
  }

  /** InteractiveObject hook — called when player-touch overlap fires. */
  protected override onReact(): void {
    this.gather();
  }

  // ── Gather ────────────────────────────────────────────────────────────────

  private gather(): void {
    if (this._nodeState !== 'ready') return;

    // Add items to inventory
    for (const y of this.def.yields) {
      const qty = Phaser.Math.Between(y.min, y.max);
      if (qty > 0) this.inventory.add(y.itemId, qty);
    }

    // Deplete
    this._nodeState = 'depleted';
    this._promptText.setAlpha(0);
    this._playerInRange = false;

    // Shake feedback
    this.scene.tweens.add({
      targets: this,
      angle: { from: -6, to: 6 },
      yoyo: true,
      duration: 60,
      repeat: 2,
      onComplete: () => {
        this.angle = 0;
        this.setAlpha(0.35);
      },
    });

    this.scene.events.emit('resource-gathered', {
      nodeId: this.def.id,
      yields: this.def.yields,
    });

    // Respawn via Phaser timer — no manual delta tracking needed
    if (this.def.respawnMs > 0) {
      this.scene.time.delayedCall(this.def.respawnMs, () => this.respawn());
    }
  }

  private respawn(): void {
    this._nodeState = 'ready';
    this.scene.tweens.add({
      targets: this,
      alpha: { from: 0.35, to: 1 },
      scaleX: { from: 0.6, to: 1 },
      scaleY: { from: 0.6, to: 1 },
      duration: 400,
      ease: 'Back.Out',
    });
  }

  override destroy(fromScene?: boolean): void {
    this._promptText?.destroy();
    super.destroy(fromScene);
  }
}
