import * as Phaser from 'phaser';
import { TinkerTray } from '../crafting/TinkerTray';
import { localStorageStore } from '../crafting/ports';

// The tray rules live in the Phaser-free TinkerTray class
// (src/crafting/TinkerTray.ts) so the crafting sim can reuse them. Re-exported
// here so existing imports from this module keep working unchanged.
export {
  TRAY_PROGRESS_CHANGED,
  TRAY_DISCOVERY,
  type DiscoveryType,
  type Discovery,
  type TrayCombo,
} from '../crafting/TinkerTray';

const REGISTRY_KEY = 'tinkerTraySystem';

/**
 * TinkerTraySystem — Core Warden's tinker tray: the Phaser-free TinkerTray
 * plus the Phaser plumbing (global registry entry, game.events, localStorage,
 * save on game destroy).
 *
 * Access from any scene:
 *   const tray = this.game.registry.get('tinkerTraySystem') as TinkerTraySystem;
 */
export class TinkerTraySystem extends TinkerTray {
  constructor(scene: Phaser.Scene) {
    super({ emitter: scene.game.events, store: localStorageStore });
    scene.game.registry.set(REGISTRY_KEY, this);
    scene.game.events.once(Phaser.Core.Events.DESTROY, () => this._persist());
  }
}
