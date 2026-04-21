/**
 * SimpleJoystick — minimal virtual joystick for touch devices.
 *
 * Replaces phaser3-rex-plugins (which references `Phaser` as a global at
 * module-evaluation time — before ESM starts our code — causing ReferenceError).
 *
 * Exposes two properties consumed by scene update loops:
 *   - `force`    — clamped distance from centre (0 = idle, up to `radius`)
 *   - `rotation` — angle in radians pointing from centre → thumb
 *
 * The joystick claims the first pointer that touches within 2× the base radius.
 * A second simultaneous touch (e.g. action button) is ignored by the joystick
 * because it checks `pointerId` before processing.
 */
export class SimpleJoystick {
  force    = 0;
  rotation = 0;

  private pointerId: number | null = null;
  private readonly cx: number;
  private readonly cy: number;
  private readonly radius: number;
  private readonly thumb: Phaser.GameObjects.Arc;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    radius: number,
    thumb: Phaser.GameObjects.Arc,
  ) {
    this.cx     = x;
    this.cy     = y;
    this.radius = radius;
    this.thumb  = thumb;

    scene.input.on('pointerdown',     this.onDown, this);
    scene.input.on('pointermove',     this.onMove, this);
    scene.input.on('pointerup',       this.onUp,   this);
    scene.input.on('pointerupoutside', this.onUp,  this);
  }

  private onDown(pointer: Phaser.Input.Pointer): void {
    if (this.pointerId !== null) return;
    const dx = pointer.x - this.cx;
    const dy = pointer.y - this.cy;
    if (dx * dx + dy * dy > (this.radius * 2) ** 2) return;
    this.pointerId = pointer.id;
    this.updateThumb(pointer);
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.pointerId) return;
    this.updateThumb(pointer);
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.pointerId) return;
    this.pointerId = null;
    this.force     = 0;
    this.rotation  = 0;
    this.thumb.setPosition(this.cx, this.cy);
  }

  private updateThumb(pointer: Phaser.Input.Pointer): void {
    const dx   = pointer.x - this.cx;
    const dy   = pointer.y - this.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return;
    const clamped = Math.min(dist, this.radius);
    this.force    = clamped;
    this.rotation = Math.atan2(dy, dx);
    this.thumb.setPosition(
      this.cx + (dx / dist) * clamped,
      this.cy + (dy / dist) * clamped,
    );
  }
}
