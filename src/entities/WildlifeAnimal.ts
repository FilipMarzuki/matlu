import { LivingEntity, LivingEntityConfig } from './LivingEntity';

export type AnimalState = 'idle' | 'roaming' | 'fleeing' | 'resting';

export interface WildlifeAnimalConfig extends LivingEntityConfig {
  roamRadius: number;
  fleeRadius: number;
  speed: number;
}

/**
 * WildlifeAnimal — basklass för alla vilda djur.
 *
 * Implementerar ett enkelt FSM (finite state machine) med fyra tillstånd:
 * idle → roaming → fleeing → resting. Subklasser (Bird, GroundAnimal)
 * specialiserar rörelselogiken utan att ändra FSM-strukturen.
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
    this.updateFSM(delta);
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
