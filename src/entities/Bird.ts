import { WildlifeAnimal, WildlifeAnimalConfig } from './WildlifeAnimal';

/**
 * Bird — WildlifeAnimal subclass for flying birds.
 *
 * Birds move through the air and can pass over obstacles. Concrete species
 * (e.g. BlueTit) inherit from here and add sprites and sounds.
 */
export abstract class Bird extends WildlifeAnimal {
  constructor(scene: Phaser.Scene, x: number, y: number, config: WildlifeAnimalConfig) {
    super(scene, x, y, config);
  }

  protected override updateFSM(_delta: number): void {
    switch (this.animalState) {
      case 'idle':
        if (this.animalStateTimer <= 0) {
          // Randomly switch to roaming
          this.setAnimalState('roaming', Phaser.Math.Between(2000, 5000));
        }
        break;

      case 'roaming': {
        // Fly toward a random point within roamRadius of home
        if (this.animalStateTimer <= 0) {
          this.setAnimalState('idle', Phaser.Math.Between(1000, 3000));
        }
        break;
      }

      case 'fleeing':
        // Fly away from threat — implemented by concrete subclass
        if (this.animalStateTimer <= 0) {
          this.setAnimalState('resting', Phaser.Math.Between(3000, 6000));
        }
        break;

      case 'resting':
        if (this.animalStateTimer <= 0) {
          this.setAnimalState('idle', Phaser.Math.Between(1000, 2000));
        }
        break;

      case 'sleeping':
        // Dormant — WorldClock wakes the bird at dawn via checkDayNight()
        break;
    }
  }
}
