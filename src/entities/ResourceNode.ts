/**
 * ResourceNode — interactable world object that yields items when gathered.
 *
 * Lifecycle: ready → (player presses E) → depleted → (respawn timer) → ready
 *
 * ## Setup (in your scene)
 *
 *   // preload(): ensure node.def.spriteKey texture exists
 *   // create():
 *   const node = new ResourceNode(this, x, y, def);
 *   this.physics.add.existing(node, true); // static body
 *   node.initStaticBody();                 // size the collision box
 *   this.physics.add.collider(player, node);
 *
 *   // update():
 *   node.tick(delta, player.x, player.y);
 *
 * ## Events
 *
 * Emits `'resource-gathered'` on scene.events with `{ nodeId, yields }` so
 * other systems (quest tracker, sound manager, etc.) can react.
 */

import * as Phaser from 'phaser';
import { SolidObject } from '../environment/SolidObject';
import type { InventorySystem } from '../systems/InventorySystem';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ResourceNodeYield {
  itemId: string;
  min: number;
  max: number;
}

/**
 * One entry in `resource-nodes.json#nodeTypes`. All fields needed to instantiate
 * a node — the scene picks the def and places it at a world position.
 */
export interface ResourceNodeTypeDef {
  /** Unique identifier, e.g. `"tree"`, `"rock"`, `"ore"`. */
  id: string;
  /** Human-readable name shown in future UI. */
  label: string;
  /** Phaser texture key — must be loaded before creating this node. */
  spriteKey: string;
  /** Items dropped on gather; qty rolled per yield entry. */
  yields: ResourceNodeYield[];
  /** How long (ms) the node is depleted before it respawns. */
  respawnMs: number;
  /** Player must be within this many px to see the interaction prompt. */
  interactRadius: number;
  /** Collision box width in px — defaults to 16. */
  colliderWidth?: number;
  /** Collision box height in px — defaults to 16. */
  colliderHeight?: number;
  /** Vertical offset for the collision body — defaults to 0. */
  colliderOffsetY?: number;
}

export type ResourceNodeState = 'ready' | 'depleted';

// ── Class ──────────────────────────────────────────────────────────────────────

export class ResourceNode extends SolidObject {
  readonly def: ResourceNodeTypeDef;

  private _nodeState: ResourceNodeState = 'ready';
  private _respawnRemaining = 0;
  private _promptText: Phaser.GameObjects.Text;
  private _eKey: Phaser.Input.Keyboard.Key | null;

  constructor(scene: Phaser.Scene, x: number, y: number, def: ResourceNodeTypeDef) {
    super(scene, x, y, def.spriteKey, {
      colliderWidth:   def.colliderWidth   ?? 16,
      colliderHeight:  def.colliderHeight  ?? 16,
      colliderOffsetY: def.colliderOffsetY ?? 0,
    });

    this.def = def;

    // Depth-sort by y so it overlaps objects below it in the top-down view
    this.sortDepth();

    // Interaction prompt — fades in when player enters interactRadius
    this._promptText = scene.add.text(x, y - this.displayHeight - 4, '[E] Gather', {
      fontSize: '9px',
      color: '#ffe066',
      fontFamily: 'monospace',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5, 1).setAlpha(0).setDepth(9999);

    // addKey() is idempotent — multiple nodes all get the same Key instance
    this._eKey = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.E) ?? null;

    // Tap / click to gather (mobile + mouse)
    this.setInteractive({ useHandCursor: true });
    this.on('pointerup', () => this._gather());
  }

  get nodeState(): ResourceNodeState {
    return this._nodeState;
  }

  /**
   * Size the static physics body to match colliderWidth/Height.
   * Call immediately after `scene.physics.add.existing(this, true)`.
   *
   * Phaser's StaticBody offset is relative to the top-left of the sprite, but
   * WorldObject uses bottom-centre origin — so we shift by displayWidth/2 to
   * keep the collider centred on the sprite's trunk / base.
   */
  initStaticBody(): void {
    const body = this.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(this.colliderWidth, this.colliderHeight);
    body.setOffset(
      (this.displayWidth  - this.colliderWidth)  / 2,
      this.displayHeight  - this.colliderHeight  + this.colliderOffsetY,
    );
    body.reset(this.x, this.y);
  }

  /**
   * Main update — call from scene.update() every frame.
   *
   * @param delta   Frame delta in ms from Phaser's update(time, delta)
   * @param playerX World-x of the player
   * @param playerY World-y of the player
   */
  tick(delta: number, playerX: number, playerY: number): void {
    // Respawn countdown while depleted
    if (this._nodeState === 'depleted') {
      this._respawnRemaining -= delta;
      if (this._respawnRemaining <= 0) this._respawn();
    }

    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const inRange =
      this._nodeState === 'ready' &&
      Math.sqrt(dx * dx + dy * dy) <= this.def.interactRadius;

    // Smooth prompt fade (same lerp used by HumanoidNPC)
    this._promptText.setAlpha(
      Phaser.Math.Linear(this._promptText.alpha, inRange ? 1 : 0, 0.12),
    );
    this._promptText.setPosition(this.x, this.y - this.displayHeight - 4);

    // Keyboard gather — JustDown consumes the press for this frame
    if (inRange && this._eKey && Phaser.Input.Keyboard.JustDown(this._eKey)) {
      this._gather();
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _gather(): void {
    if (this._nodeState !== 'ready') return;

    // Add items to the global InventorySystem (may be absent in minimal test scenes)
    const inv = this.scene.game.registry.get('inventorySystem') as InventorySystem | undefined;
    for (const y of this.def.yields) {
      const qty = Phaser.Math.Between(y.min, y.max);
      inv?.add(y.itemId, qty);
    }

    this._nodeState = 'depleted';
    this._respawnRemaining = this.def.respawnMs;
    this.setAlpha(0.35);
    this._promptText.setAlpha(0);

    // Quick shake tween as gather feedback
    this.scene.tweens.add({
      targets: this,
      angle: { from: -6, to: 6 },
      yoyo: true,
      duration: 60,
      repeat: 2,
      onComplete: () => { this.angle = 0; },
    });

    this.scene.events.emit('resource-gathered', {
      nodeId: this.def.id,
      yields: this.def.yields,
    });
  }

  private _respawn(): void {
    this._nodeState = 'ready';
    // Grow-back tween signals to the player the node is harvestable again
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
