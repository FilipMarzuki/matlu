import * as Phaser from 'phaser';
import { WildlifeAnimal, WildlifeAnimalConfig } from './WildlifeAnimal';

/**
 * GroundAnimal — WildlifeAnimal subclass for ground-dwelling animals.
 *
 * Ground animals are affected by terrain and cannot fly over obstacles.
 * Concrete species (e.g. rabbit, hedgehog) inherit from here.
 */
export abstract class GroundAnimal extends WildlifeAnimal {
  constructor(scene: Phaser.Scene, x: number, y: number, config: WildlifeAnimalConfig) {
    super(scene, x, y, config);
  }

  protected override updateFSM(_delta: number): void {
    switch (this.animalState) {
      case 'idle':
        if (this.animalStateTimer <= 0) {
          this.setAnimalState('roaming', Phaser.Math.Between(3000, 7000));
        }
        break;

      case 'roaming':
        // Walk toward a random point within roamRadius of home
        if (this.animalStateTimer <= 0) {
          this.setAnimalState('resting', Phaser.Math.Between(2000, 4000));
        }
        break;

      case 'fleeing':
        // Run away from threat
        if (this.animalStateTimer <= 0) {
          this.setAnimalState('resting', Phaser.Math.Between(4000, 8000));
        }
        break;

      case 'resting':
        if (this.animalStateTimer <= 0) {
          this.setAnimalState('idle', Phaser.Math.Between(1000, 3000));
        }
        break;

      case 'sleeping':
        // Dormant — WorldClock wakes the animal at dawn via checkDayNight()
        break;
    }
  }
}
