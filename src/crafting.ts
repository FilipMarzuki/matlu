import * as Phaser from 'phaser';

// Phaser 4's ESM bundle references `Phaser` as a global in some internal paths
// (see main.ts). Assign it before constructing the game. Must happen first.
(window as unknown as Record<string, unknown>)['Phaser'] = Phaser;

import { CraftForgeScene } from './scenes/CraftForgeScene';

/**
 * Standalone entry for the Craft-Forge testbed — a lightweight page that boots
 * ONLY the crafting scene, with none of the game's other scenes/systems. Served
 * as /crafting.html so an external tester can open the crafting menus in any
 * browser without loading (or playing) the whole game.
 */
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: 0x0d0e1a,
  // Crisp pixel art (matches the game).
  render: { pixelArt: true },
  // Fill the viewport; the scene draws to a fixed 1024×640 design canvas and
  // scales itself to fit, so it works on phones, tablets, and desktop.
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [CraftForgeScene],
});

// Expose for Playwright / manual debugging (same convention as main.ts).
(window as unknown as Record<string, unknown>)['__game'] = game;
