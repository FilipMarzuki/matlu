import * as Phaser from 'phaser';
import { WorldObject } from './WorldObject';

export interface SolidObjectOptions {
  frame?: string | number;
  /** Collision box width in px — defaults to 16. Use narrow values for tree trunks. */
  colliderWidth?: number;
  /** Collision box height in px — defaults to 16. */
  colliderHeight?: number;
  /** Vertical offset for the collision box relative to the sprite bottom — defaults to 0. */
  colliderOffsetY?: number;
  /** Uniform scale applied to the sprite before sizing the collision body. */
  scale?: number;
}

/**
 * SolidObject — environment object with a collision body that blocks movement.
 *
 * Trees, rocks and walls inherit from this. Instantiated via createSolidGroup()
 * so that a single physics.add.collider() call covers all instances in the group.
 *
 * The collision box is intentionally narrow (trunk of a tree, not the full canopy)
 * so the player can walk behind trees naturally.
 */
export class SolidObject extends WorldObject {
  readonly colliderWidth: number;
  readonly colliderHeight: number;
  readonly colliderOffsetY: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    texture: string,
    options: SolidObjectOptions = {}
  ) {
    super(scene, x, y, texture, options.frame);
    this.colliderWidth = options.colliderWidth ?? 16;
    this.colliderHeight = options.colliderHeight ?? 16;
    this.colliderOffsetY = options.colliderOffsetY ?? 0;
  }
}

/**
 * Factory — creates a StaticGroup from a list of object definitions.
 * Returns the group ready for `scene.physics.add.collider()`.
 *
 * @example
 * ```ts
 * this.trees = createSolidGroup(this, [
 *   { x: 300, y: 400, texture: 'tree-oak', options: { colliderWidth: 12, colliderHeight: 10 } }
 * ]);
 * this.physics.add.collider(this.player, this.trees);
 * ```
 */
export function createSolidGroup(
  scene: Phaser.Scene,
  objects: Array<{ x: number; y: number; texture: string; options?: SolidObjectOptions }>
): Phaser.Physics.Arcade.StaticGroup {
  const group = scene.physics.add.staticGroup();

  for (const { x, y, texture, options } of objects) {
    const obj = new SolidObject(scene, x, y, texture, options);
    // Scale before body sizing so displayWidth/displayHeight are correct
    if (options?.scale !== undefined) obj.setScale(options.scale);
    group.add(obj);

    // Narrow the collision box to the trunk/base, not the full sprite canopy
    const body = obj.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(obj.colliderWidth, obj.colliderHeight);
    body.setOffset(
      (obj.displayWidth - obj.colliderWidth) / 2,
      obj.displayHeight - obj.colliderHeight + obj.colliderOffsetY
    );
  }

  // Must call refresh() after adding all bodies so Arcade physics updates
  group.refresh();
  return group;
}
