import * as Phaser from 'phaser';
import { CombatEntity } from '../entities/CombatEntity';
import { getCommunityCreditMeta } from './communityRegistryLookup';
import { hasSeenCommunitySubmission, markSeenCommunitySubmission } from './communityCreditState';

/** Any scene object with world x/y in the same space as `cameras.main.worldView`. */
type PositionedGameObject = Phaser.GameObjects.GameObject & { x: number; y: number };

interface WatchEntry {
  readonly target: PositionedGameObject;
  readonly entityClassName: string;
  getPosition(): { x: number; y: number };
}

/**
 * Tracks community-sourced entities until they first appear inside the main
 * camera's world view, then emits `community-creature-spawned` once per
 * creature_submission_id (persisted in localStorage).
 */
export class CommunityEncounterCoordinator {
  private watches: WatchEntry[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  /** Arena / combat entities — registry class must match `constructor.name`. */
  watchCombatEntity(entity: CombatEntity): void {
    const name = entity.constructor.name;
    if (!getCommunityCreditMeta(name)) return;
    this.watches.push({
      target: entity,
      entityClassName: name,
      getPosition: () => ({ x: entity.x, y: entity.y }),
    });
  }

  /**
   * Overworld or any Phaser object with world x/y matching the main camera space.
   */
  watchGameObject(obj: PositionedGameObject, registryClassName: string): void {
    if (!getCommunityCreditMeta(registryClassName)) return;
    this.watches.push({
      target: obj,
      entityClassName: registryClassName,
      getPosition: () => ({ x: obj.x, y: obj.y }),
    });
  }

  /** Call once per frame from the owning scene while gameplay runs. */
  update(): void {
    if (this.watches.length === 0) return;
    const cam = this.scene.cameras.main;
    const retained: WatchEntry[] = [];

    for (const w of this.watches) {
      if (!w.target.active) continue;

      const meta = getCommunityCreditMeta(w.entityClassName);
      if (!meta) continue;
      if (hasSeenCommunitySubmission(meta.creatureSubmissionId)) continue;

      const { x, y } = w.getPosition();
      if (!cam.worldView.contains(x, y)) {
        retained.push(w);
        continue;
      }

      markSeenCommunitySubmission(meta.creatureSubmissionId);
      this.scene.events.emit('community-creature-spawned', { entityId: meta.entityId });
    }

    this.watches = retained;
  }
}
