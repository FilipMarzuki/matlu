/**
 * Entity — basklass för alla spelentiteter med position och livscykel.
 *
 * Alla rörliga objekt i Matlu ärver härifrån: spelare, djur, fiender.
 * Klassen hanterar bara position och grundläggande Phaser-integration —
 * inget beteende läggs till här.
 */
export abstract class Entity extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);
    scene.add.existing(this);
  }

  /**
   * Kallas varje frame av Phaser's game loop.
   * Subklasser implementerar sin specifika logik här.
   */
  abstract update(delta: number): void;
}
