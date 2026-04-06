// src/environment/InteractiveObject.ts
import { SolidObject, SolidObjectOptions } from './SolidObject';

export type InteractionTrigger =
  | 'player-touch'   // spelaren rör kollisionsboxen
  | 'player-nearby'  // spelaren inom triggerRadius
  | 'event';         // lyssnar på ett scene-event

export interface InteractiveObjectOptions extends SolidObjectOptions {
  trigger?: InteractionTrigger;
  /** px — används om trigger = 'player-nearby' */
  triggerRadius?: number;
  /** scene-event att lyssna på, används om trigger = 'event' */
  eventName?: string;
}

/**
 * InteractiveObject — statiska miljöobjekt som reagerar på spelaren
 * eller världshändelser.
 *
 * Träd som skakar vid beröring, blommor som öppnar sig på dagen,
 * buskar som gömmer djur.
 *
 * @example Skakande träd (player-touch)
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
 * // Lyssnar automatiskt — ingen extra setup krävs
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
   * Trigga reaktionen — kallas av scenen vid kollision/overlap/event.
   * Ignorerar om en reaktion redan pågår.
   */
  react(): void {
    if (this._reacting) return;
    this.onReact();
  }

  /**
   * Hook — override i subklass för specifikt beteende.
   * Standard: enkel skak-tween (passar träd och buskar).
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
