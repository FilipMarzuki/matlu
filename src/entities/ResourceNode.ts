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
import type { TinkerTraySystem } from '../systems/TinkerTraySystem';
import { resolveHarvest, type ResourceNodeYield } from '../crafting/actions';

// ── Types ──────────────────────────────────────────────────────────────────────

// The yield type now lives with the pure harvest rules in src/crafting/actions.ts;
// re-exported here so existing imports from this module keep working.
export type { ResourceNodeYield };

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
  /** When true, auto-gathers as soon as the player enters range. */
  private _pendingGather = false;
  /** Visual targeting indicator. */
  private _targetRing: Phaser.GameObjects.Arc | null = null;
  /** Perception glow — visible when tray slots 0-1 match this node's yields. */
  private _perceptionGlow: Phaser.GameObjects.Arc | null = null;
  private _perceptionCheckTimer: Phaser.Time.TimerEvent | null = null;

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

    // Tap / click to target this node — scene moves player toward it
    this.setInteractive({ useHandCursor: true });
    this.on('pointerup', () => {
      if (this._nodeState !== 'ready') return;
      scene.events.emit('resource-node:targeted', this);
    });

    // Active perception glow (#824): check tray every 1s for matching yields.
    // Uses a timer instead of per-frame checks to keep update() lightweight.
    this._perceptionCheckTimer = scene.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => this.updatePerceptionGlow(),
    });
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
      // Auto-gather if player tapped this node from a distance and just arrived
      if (this._pendingGather) {
        this._pendingGather = false;
        this.clearTarget();
        this.gather();
      }
    } else {
      this._promptText.setAlpha(0);
    }
  }

  /**
   * Mark this node as targeted — player will walk toward it and auto-gather
   * on arrival. Called by scene when the player taps a node from a distance.
   */
  setTargeted(targeted: boolean): void {
    this._pendingGather = targeted;
    if (targeted) {
      // Show a pulsing ring around the targeted node
      if (!this._targetRing) {
        this._targetRing = this.scene.add.arc(this.x, this.y, 20, 0, 360, false)
          .setStrokeStyle(2, 0xffe066, 0.8)
          .setFillStyle(0xffe066, 0.05)
          .setDepth(this.depth - 1);
        this.scene.tweens.add({
          targets: this._targetRing,
          scaleX: 1.3, scaleY: 1.3, alpha: 0.3,
          yoyo: true, repeat: -1, duration: 600, ease: 'Sine.InOut',
        });
      }
    } else {
      this.clearTarget();
    }
  }

  /** Whether this node is the current move-to target. */
  get isTargeted(): boolean { return this._pendingGather; }

  /** World position for the scene to move the player toward. */
  get targetPos(): { x: number; y: number } { return { x: this.x, y: this.y }; }

  private clearTarget(): void {
    this._pendingGather = false;
    if (this._targetRing) {
      this.scene.tweens.killTweensOf(this._targetRing);
      this._targetRing.destroy();
      this._targetRing = null;
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
    this.gatherFromTouch();
  }

  /** Public entry point for touch/tap and action-button gathering. */
  gatherFromTouch(): void {
    this.gather();
  }

  // ── Gather ────────────────────────────────────────────────────────────────

  private gather(): void {
    if (this._nodeState !== 'ready') return;

    // The rules (what drops, how many) live in the Phaser-free resolveHarvest so
    // the crafting sim can reuse them; this class only applies the result.
    const outcome = resolveHarvest(this.def.yields, { rng: Math.random });
    for (const { itemId, qty } of outcome.items) {
      this.inventory.add(itemId, qty);
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

  // ── Perception glow (#824) ───────────────────────────────────────────────

  /**
   * Check if any yield item IDs match tray slots 0-1 (prefixed with "material:").
   * If so, show a subtle pulsing glow around this node.
   */
  private updatePerceptionGlow(): void {
    if (this._nodeState !== 'ready') {
      this.hidePerceptionGlow();
      return;
    }

    const tray = this.scene.game.registry.get('tinkerTraySystem') as TinkerTraySystem | undefined;
    if (!tray) { this.hidePerceptionGlow(); return; }

    // Collect active tray IDs from slots 0-1
    const activeIds = new Set<string>();
    for (let i = 0; i < 2; i++) {
      const id = tray.slots[i];
      if (id) activeIds.add(id);
    }

    if (activeIds.size === 0) { this.hidePerceptionGlow(); return; }

    // Check if any yield itemId matches a tray slot (with "material:" prefix)
    const matches = this.def.yields.some(
      y => activeIds.has(`material:${y.itemId}`) || activeIds.has(y.itemId),
    );

    if (matches) {
      this.showPerceptionGlow();
    } else {
      this.hidePerceptionGlow();
    }
  }

  private showPerceptionGlow(): void {
    if (this._perceptionGlow) return; // already visible

    // Very subtle gold aura — a gentle hint, not a beacon
    this._perceptionGlow = this.scene.add.arc(this.x, this.y, 16, 0, 360, false)
      .setStrokeStyle(1, 0xddaa44, 0.25)
      .setFillStyle(0xddaa44, 0.04)
      .setDepth(this.depth - 1);

    this.scene.tweens.add({
      targets: this._perceptionGlow,
      alpha: { from: 0.2, to: 0.45 },
      scaleX: { from: 1, to: 1.1 },
      scaleY: { from: 1, to: 1.1 },
      yoyo: true,
      repeat: -1,
      duration: 2000,
      ease: 'Sine.InOut',
    });
  }

  private hidePerceptionGlow(): void {
    if (!this._perceptionGlow) return;
    this.scene.tweens.killTweensOf(this._perceptionGlow);
    this._perceptionGlow.destroy();
    this._perceptionGlow = null;
  }

  override destroy(fromScene?: boolean): void {
    this._promptText?.destroy();
    this.clearTarget();
    this.hidePerceptionGlow();
    this._perceptionCheckTimer?.destroy();
    super.destroy(fromScene);
  }
}
