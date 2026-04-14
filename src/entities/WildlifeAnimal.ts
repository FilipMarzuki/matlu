import * as Phaser from 'phaser';
import { LivingEntity, LivingEntityConfig } from './LivingEntity';
import type { WorldClock } from '../world/WorldClock';

export type AnimalState = 'idle' | 'roaming' | 'fleeing' | 'resting' | 'sleeping';

/** Scenes that expose a WorldClock can implement this interface. */
export interface WorldClockScene extends Phaser.Scene {
  worldClock: WorldClock;
}

export interface WildlifeAnimalConfig extends LivingEntityConfig {
  roamRadius: number;
  fleeRadius: number;
  speed: number;
}

/**
 * WildlifeAnimal — base class for all wildlife.
 *
 * Implements a simple FSM with states: idle → roaming → fleeing → resting → sleeping.
 * Subclasses (Bird, GroundAnimal) specialise movement logic without changing the
 * FSM structure.
 */
export abstract class WildlifeAnimal extends LivingEntity {
  protected animalState: AnimalState = 'idle';
  protected animalStateTimer = 0;

  readonly roamRadius: number;
  readonly fleeRadius: number;
  readonly speed: number;

  /** Home position the animal roams around. */
  protected homeX: number;
  protected homeY: number;

  constructor(scene: Phaser.Scene, x: number, y: number, config: WildlifeAnimalConfig) {
    super(scene, x, y, config);
    this.roamRadius = config.roamRadius;
    this.fleeRadius = config.fleeRadius;
    this.speed = config.speed;
    this.homeX = x;
    this.homeY = y;
  }

  override update(delta: number): void {
    if (!this.isAlive) return;
    this.animalStateTimer -= delta;
    this.checkDayNight();
    this.updateFSM(delta);
  }

  /**
   * Read the WorldClock from the scene (if present) and adjust the FSM.
   * Animals sleep at night and wake at dawn.
   */
  private checkDayNight(): void {
    const clock = (this.scene as Partial<WorldClockScene>).worldClock;
    if (!clock) return;

    const isNight = clock.isNight;
    const isDawn  = clock.isDawn;

    if (isNight && this.animalState !== 'sleeping') {
      this.setAnimalState('sleeping', Infinity);
    } else if (isDawn && this.animalState === 'sleeping') {
      this.setAnimalState('idle', 2000);
    }
  }

  /** Transition to a new FSM state. */
  protected setAnimalState(next: AnimalState, duration: number): void {
    this.animalState = next;
    this.animalStateTimer = duration;
    this.onStateChange(next);
  }

  /**
   * Core FSM tick — subclasses implement their movement for each state.
   * Called every frame while alive.
   */
  protected abstract updateFSM(delta: number): void;

  /** Hook called on every state transition. Override to play animations etc. */
  protected onStateChange(_next: AnimalState): void {
    // override in subclasses
  }
}
