import * as Phaser from 'phaser';
// src/environment/InteractiveObject.ts
import { SolidObject, SolidObjectOptions } from './SolidObject';

export type InteractionTrigger =
  | 'player-touch'   // player overlaps the collision box
  | 'player-nearby'  // player is within triggerRadius
  | 'event';         // listens for a scene event

export interface InteractiveObjectOptions extends SolidObjectOptions {
  trigger?: InteractionTrigger;
  /** px — used when trigger = 'player-nearby' */
  triggerRadius?: number;
  /** scene event to listen for, used when trigger = 'event' */
  eventName?: string;
}

/**
 * InteractiveObject — static environment objects that react to the player
 * or world events.
 *
 * Trees that shake on touch, flowers that open during daytime,
 * bushes that hide animals.
 *
 * @example Shaking tree (player-touch)
 * ```ts
 * const tree = new InteractiveObject(scene, 400, 300, 'tree-oak', {
 *   trigger: 'player-touch',
 *   colliderWidth: 12,
 *   colliderHeight: 10,
 * });
 * scene.physics.add.overlap(player, tree, () => tree.react());
 * ```
 *
 * @example Event-trigger
 * ```ts
 * const corruptTree = new InteractiveObject(scene, 600, 400, 'tree-corrupt', {
 *   trigger: 'event',
 *   eventName: 'enemy-killed',
 * });
 * // Listens automatically — no extra setup required
 * ```
 */
export class InteractiveObject extends SolidObject {
  private readonly _trigger: InteractionTrigger;
  private readonly _triggerRadius: number;
  private _reacting = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    texture: string,
    options: InteractiveObjectOptions = {}
  ) {
    super(scene, x, y, texture, options);
    this._trigger = options.trigger ?? 'player-touch';
    this._triggerRadius = options.triggerRadius ?? 60;

    if (this._trigger === 'event' && options.eventName) {
      scene.events.on(options.eventName, () => this.react());
    }
  }

  /**
   * Trigger the reaction — called by the scene on collision/overlap/event.
   * No-ops if a reaction is already in progress.
   */
  react(): void {
    if (this._reacting) return;
    this.onReact();
  }

  /**
   * Hook — override in subclasses for specific behaviour.
   * Default: simple shake tween (suitable for trees and bushes).
   */
  protected onReact(): void {
    this._reacting = true;
    this.scene.tweens.add({
      targets: this,
      angle: { from: -4, to: 4 },
      yoyo: true,
      duration: 80,
      repeat: 2,
      onComplete: () => {
        this.angle = 0;
        this._reacting = false;
      },
    });
  }

  get interactionTrigger(): InteractionTrigger {
    return this._trigger;
  }

  get radius(): number {
    return this._triggerRadius;
  }
}
