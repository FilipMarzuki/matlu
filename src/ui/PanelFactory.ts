import * as Phaser from 'phaser';

export const CRAFTING_PANEL_TEXTURE_KEY = 'crafting-frames';

export type PanelStyle = 'wood' | 'leather' | 'parchment' | 'metal' | 'cork';

interface PanelOptions {
  depth?: number;
  interactive?: boolean;
  name?: string;
  scrollFactor?: number;
}

const ATLAS_URL = '/assets/ui/crafting-frames.png';
const ATLAS_JSON_URL = '/assets/ui/crafting-frames.json';
const SLICE_SIZE = 16;

/**
 * Loads the shared crafting UI atlas once. Scenes call this from preload so
 * the same frame texture can back every stretchable panel.
 */
export function preloadCraftingPanels(scene: Phaser.Scene): void {
  if (scene.textures.exists(CRAFTING_PANEL_TEXTURE_KEY)) return;

  scene.load.atlas(CRAFTING_PANEL_TEXTURE_KEY, ATLAS_URL, ATLAS_JSON_URL);
}

/**
 * Creates a crisp pixel-art nine-slice panel. The returned container is sized
 * to the requested bounds so callers can add labels or hit areas relative to it.
 */
export function createPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  style: PanelStyle,
  options: PanelOptions = {},
): Phaser.GameObjects.Container {
  const panelWidth = Math.round(width);
  const panelHeight = Math.round(height);
  const container = scene.add.container(Math.round(x), Math.round(y));
  const frame = scene.add.nineslice(
    0,
    0,
    CRAFTING_PANEL_TEXTURE_KEY,
    style,
    panelWidth,
    panelHeight,
    SLICE_SIZE,
    SLICE_SIZE,
    SLICE_SIZE,
    SLICE_SIZE,
    true,
    true,
  );

  frame.setOrigin(0.5);
  frame.setName(`${style}-panel-frame`);
  container.add(frame);
  container.setSize(panelWidth, panelHeight);

  if (options.name) container.setName(options.name);
  if (options.depth !== undefined) container.setDepth(options.depth);
  if (options.scrollFactor !== undefined) container.setScrollFactor(options.scrollFactor);
  if (options.interactive) {
    container.setInteractive(
      new Phaser.Geom.Rectangle(-panelWidth / 2, -panelHeight / 2, panelWidth, panelHeight),
      Phaser.Geom.Rectangle.Contains,
    );
  }

  return container;
}
