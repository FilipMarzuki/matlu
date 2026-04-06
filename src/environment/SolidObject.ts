import { WorldObject } from './WorldObject';

export interface SolidObjectOptions {
  frame?: string | number;
  /** Collision box width in px — defaults to 16. Use narrow values for tree trunks. */
  colliderWidth?: number;
  /** Collision box height in px — defaults to 16. */
  colliderHeight?: number;
  /** Vertical offset for the collision box relative to the sprite bottom — defaults to 0. */
  colliderOffsetY?: number;
}

/**
 * SolidObject — miljöobjekt med kollision som blockerar rörelse.
 *
 * Träd, klippor och väggar ärver detta. Instansieras via
 * createSolidGroup() så att en enda physics.add.collider()-rad
 * täcker alla instanser i gruppen.
 *
 * Kollisionsboxen är avsiktligt smal (stammen på ett träd, inte
 * hela kronan) så att spelaren kan gå bakom träd naturligt.
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
    group.add(obj);

    // Narrow the collision box to the trunk/base, not the full sprite crown
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
