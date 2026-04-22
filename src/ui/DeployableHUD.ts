/**
 * DeployableHUD — 4-slot panel showing the CombatEngineer's deployable kit status.
 *
 * ## Layout (bottom-left, horizontal)
 *
 *   [ T ][ D ][ M ][ S ]
 *     Q    E    R    F
 *
 * Each 36×36 slot shows:
 *  - A coloured background: green (ready), dark-gray (cooldown), dark-red (cap hit).
 *  - A radial "pie" sweep that darkens the icon while cooldown is active; shrinks
 *    to nothing when the slot is ready.
 *  - A placeholder icon letter (T/D/M/S) centred in the slot.
 *  - A count badge in the top-right corner ("0/1", "2/3", …).
 *  - The key binding letter below the slot.
 *
 * ## Cap-hit flash
 * When the player tries to place a deployable past its cap, the corresponding
 * slot flashes red for 300 ms.  CombatEngineer.deployX() emits
 * 'deployable:cap-hit' with the kind string; this class listens and sets a
 * per-slot timer.
 *
 * ## Update cadence
 * CombatArenaScene calls update(engineer, delta) every frame from inside its
 * main update loop (guarded by heroAlive + instanceof CombatEngineer).
 * No state is cached here — the scene owns the hero reference.
 */

import * as Phaser from 'phaser';
import { CombatEngineer } from '../entities/CombatEngineer';
import { TURRET, DRONE, MINE, SHIELD } from '../data/deployableConfigs';

// ── Slot geometry ─────────────────────────────────────────────────────────────

const SLOT_SIZE = 36;   // px — width and height of each square slot
const SLOT_GAP  = 6;    // px — horizontal gap between slots
const SLOT_STEP = SLOT_SIZE + SLOT_GAP;   // 42 px per slot including gap

// ── Per-kind metadata ─────────────────────────────────────────────────────────

type DeployKind = 'turret' | 'drone' | 'mine' | 'shield';

const KINDS: DeployKind[] = ['turret', 'drone', 'mine', 'shield'];

/** Placeholder icon letters — replaced by sprite icons once PixelLab art lands. */
const ICONS: string[] = ['T', 'D', 'M', 'S'];

/** Key binding labels shown below each slot. */
const KEY_LABELS: string[] = ['Q', 'E', 'R', 'F'];

/** Total cooldown durations per kind — used to compute sweep fraction. */
const COOLDOWN_TOTALS: number[] = [
  TURRET.cooldownMs,
  DRONE.cooldownMs,
  MINE.cooldownMs,
  SHIELD.cooldownMs,
];

/** Hard caps per kind — used to colour the count badge. */
const CAPS: number[] = [
  TURRET.cap,
  DRONE.cap,
  MINE.cap,
  SHIELD.cap,
];

// ── Cap-hit flash duration ─────────────────────────────────────────────────────

const CAP_HIT_FLASH_MS = 300;

// ── Colours ───────────────────────────────────────────────────────────────────

const COL_READY_BG     = 0x1a3322;  // dark green — slot available
const COL_COOLDOWN_BG  = 0x1c1c1c;  // near-black — slot on cooldown
const COL_CAP_HIT_BG   = 0x550000;  // dark red — cap-hit flash
const COL_SWEEP        = 0x000000;  // black pie overlay for cooldown progress
const ALPHA_BG         = 0.85;
const ALPHA_SWEEP      = 0.65;

export class DeployableHUD {
  private readonly scene:       Phaser.Scene;
  private readonly gfx:         Phaser.GameObjects.Graphics;
  private readonly iconTexts:   Phaser.GameObjects.Text[];
  private readonly countTexts:  Phaser.GameObjects.Text[];
  private readonly keyTexts:    Phaser.GameObjects.Text[];

  /** ms remaining for the cap-hit red flash, one entry per slot. */
  private readonly capHitTimers: number[];

  /** Top-left corner of the panel in screen coordinates. */
  private readonly originX: number;
  private readonly originY: number;

  /** Bound listener so we can remove it cleanly in destroy(). */
  private readonly capHitListener: (kind: DeployKind) => void;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene   = scene;
    this.originX = x;
    this.originY = y;

    // Graphics object redrawn every frame for the backgrounds + sweep arcs.
    this.gfx = scene.add.graphics().setScrollFactor(0).setDepth(10);

    this.iconTexts   = [];
    this.countTexts  = [];
    this.keyTexts    = [];
    this.capHitTimers = [0, 0, 0, 0];

    for (let i = 0; i < 4; i++) {
      const sx  = x + i * SLOT_STEP;
      const mid = y + SLOT_SIZE / 2;

      // Centred icon letter.
      this.iconTexts.push(
        scene.add.text(sx + SLOT_SIZE / 2, mid, ICONS[i], {
          fontSize: '15px', color: '#ffffff',
        }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(11),
      );

      // Count badge — top-right corner of the slot.
      this.countTexts.push(
        scene.add.text(sx + SLOT_SIZE, y, '0/1', {
          fontSize: '9px', color: '#aaaaaa',
          backgroundColor: '#00000099',
          padding: { x: 2, y: 1 },
        }).setOrigin(1, 0).setScrollFactor(0).setDepth(11),
      );

      // Key label below the slot.
      this.keyTexts.push(
        scene.add.text(sx + SLOT_SIZE / 2, y + SLOT_SIZE + 3, KEY_LABELS[i], {
          fontSize: '9px', color: '#888888',
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(11),
      );
    }

    // Listen for cap-hit events emitted by CombatEngineer.deployX().
    this.capHitListener = (kind: DeployKind) => {
      const idx = KINDS.indexOf(kind);
      if (idx >= 0) this.capHitTimers[idx] = CAP_HIT_FLASH_MS;
    };
    scene.events.on('deployable:cap-hit', this.capHitListener);
  }

  /**
   * Redraw all four slots to reflect the current engineer state.
   * Called every frame by CombatArenaScene when the active hero is a CombatEngineer.
   */
  update(engineer: CombatEngineer, delta: number): void {
    this.gfx.clear();

    const cooldownRemaining = [
      engineer.turretCooldownMs,
      engineer.droneCooldownMs,
      engineer.mineCooldownMs,
      engineer.shieldCooldownMs,
    ];
    const counts = [
      engineer.turretActiveCount,
      engineer.droneActiveCount,
      engineer.mineActiveCount,
      engineer.shieldActiveCount,
    ];
    const readyFlags = [
      engineer.turretReady,
      engineer.droneReady,
      engineer.mineReady,
      engineer.shieldReady,
    ];

    for (let i = 0; i < 4; i++) {
      const sx         = this.originX + i * SLOT_STEP;
      const onCooldown = cooldownRemaining[i] > 0;
      const isCapHit   = this.capHitTimers[i] > 0;
      const isReady    = readyFlags[i];

      // Tick cap-hit flash timer.
      if (isCapHit) {
        this.capHitTimers[i] = Math.max(0, this.capHitTimers[i] - delta);
      }

      // ── Background ────────────────────────────────────────────────────────
      const bgColor = isCapHit  ? COL_CAP_HIT_BG
                    : isReady   ? COL_READY_BG
                    :             COL_COOLDOWN_BG;
      this.gfx.fillStyle(bgColor, ALPHA_BG);
      this.gfx.fillRect(sx, this.originY, SLOT_SIZE, SLOT_SIZE);

      // Thin border so slots are distinguishable when adjacent.
      this.gfx.lineStyle(1, 0x444444, 0.9);
      this.gfx.strokeRect(sx, this.originY, SLOT_SIZE, SLOT_SIZE);

      // ── Cooldown sweep (pie/clock wipe from top, clockwise) ───────────────
      // The sweep covers the "remaining" fraction of the cooldown, shrinking to
      // nothing as the timer reaches 0.  Not drawn during a cap-hit flash.
      if (onCooldown && !isCapHit) {
        const fraction  = cooldownRemaining[i] / COOLDOWN_TOTALS[i];
        const cx        = sx + SLOT_SIZE / 2;
        const cy        = this.originY + SLOT_SIZE / 2;
        const r         = SLOT_SIZE / 2 - 1;
        const startAngle = -Math.PI / 2;                         // top
        const endAngle   = startAngle + fraction * 2 * Math.PI;  // clockwise

        this.gfx.fillStyle(COL_SWEEP, ALPHA_SWEEP);
        this.gfx.beginPath();
        this.gfx.moveTo(cx, cy);
        this.gfx.arc(cx, cy, r, startAngle, endAngle, false);
        this.gfx.closePath();
        this.gfx.fillPath();
      }

      // ── Icon tint ─────────────────────────────────────────────────────────
      this.iconTexts[i].setColor(isReady ? '#ffffff' : '#666666');

      // ── Count badge ───────────────────────────────────────────────────────
      const cap       = CAPS[i];
      const atCap     = counts[i] >= cap;
      const countStr  = `${counts[i]}/${cap}`;
      this.countTexts[i].setText(countStr).setColor(atCap ? '#ff6666' : '#aaaaaa');
    }
  }

  /** Remove all scene objects and event listeners. */
  destroy(): void {
    this.scene.events.off('deployable:cap-hit', this.capHitListener);
    this.gfx.destroy();
    for (const t of [...this.iconTexts, ...this.countTexts, ...this.keyTexts]) {
      t.destroy();
    }
  }
}
