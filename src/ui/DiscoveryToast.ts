import * as Phaser from 'phaser';
import recipesJson from '../../public/macro-world/recipes.json';
import { RECIPE_DISCOVERED } from '../systems/DiscoverySystem';
import type { DiscoveryMethod } from '../crafting/Discovery';
import { discoveryToastText, type ToastText } from '../crafting/discoveryToast';
import { Color, Depth, Font, TextColor } from './theme';

const RECIPES = recipesJson.recipes as { id?: string; name?: string }[];
/** Game-registry key for the scenes that can show a toast, oldest first. */
const HOSTS_KEY = 'discoveryToastHosts';
const MAX_SHOWN = 3;
const IN_MS = 250;
const HOLD_MS = 2800;
const OUT_MS = 400;
const TOP = 14;
const GAP = 6;

/**
 * DiscoveryToast — a short "New recipe" toast at the top of the screen for each recipe the
 * player works out (#1529). Listens for RECIPE_DISCOVERED on game.events.
 *
 * Usage: `new DiscoveryToast(scene)` in create(), or `new DiscoveryToast(scene, uiCam)` in a
 * scene whose HUD has its own camera (the toast is drawn on that camera only).
 *
 * The Homestead and the crafting menu drawn over it each make one, but only one shows each
 * toast: the newest whose scene is running. Every scene draws in its own layer, so a toast in the
 * Homestead would sit under the open menu; while the menu is open, its toast host takes over.
 *
 * Several discoveries at once stack, up to three, and the rest wait their turn.
 */
export class DiscoveryToast {
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private shown: Phaser.GameObjects.Container[] = [];
  private queue: ToastText[] = [];

  constructor(private readonly scene: Phaser.Scene, camera?: Phaser.Cameras.Scene2D.Camera) {
    this.camera = camera ?? scene.cameras.main;
    const hosts = DiscoveryToast.hosts(scene.game);
    hosts.push(this);
    scene.game.events.on(RECIPE_DISCOVERED, this.onDiscovered, this);
    // The scene's own objects, tweens and timers go with it; the listener and host entry are
    // on the game, so they're removed here or a stopped scene would keep "showing" toasts.
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.game.events.off(RECIPE_DISCOVERED, this.onDiscovered, this);
      const i = hosts.indexOf(this);
      if (i !== -1) hosts.splice(i, 1);
      this.shown = [];
      this.queue = [];
    });
  }

  /** The live hosts, kept in the game registry so every scene sees the same list. */
  private static hosts(game: Phaser.Game): DiscoveryToast[] {
    let hosts = game.registry.get(HOSTS_KEY) as DiscoveryToast[] | undefined;
    if (!hosts) {
      hosts = [];
      game.registry.set(HOSTS_KEY, hosts);
    }
    return hosts;
  }

  private onDiscovered(recipeId: string, method: DiscoveryMethod): void {
    // Only the newest host whose scene is running shows it. A paused scene's tweens don't run,
    // so a toast there would hang on screen until the scene resumed.
    const live = DiscoveryToast.hosts(this.scene.game).filter(h => h.scene.sys.isActive());
    if (live.at(-1) !== this) return;
    const text = discoveryToastText(recipeId, method, RECIPES);
    if (!text) return;
    this.queue.push(text);
    this.pump();
  }

  private pump(): void {
    while (this.shown.length < MAX_SHOWN && this.queue.length > 0) this.show(this.queue.shift()!);
  }

  /** Where the toast in slot `i` sits: stacked down from the top, each as tall as the ones above. */
  private slotY(i: number): number {
    return this.shown.slice(0, i).reduce((y, t) => y + (t.getData('h') as number) + GAP, TOP);
  }

  private show(text: ToastText): void {
    const s = this.scene;
    const label = s.add.text(0, 10, 'NEW RECIPE', { ...Font.small, color: '#c8922a' }).setOrigin(0.5, 0).setLetterSpacing(1);
    const title = s.add.text(0, 24, text.title, { ...Font.heading, color: TextColor.primary }).setOrigin(0.5, 0);
    const detail = s.add.text(0, 24 + title.height + 2, text.detail, { ...Font.small, color: TextColor.secondary }).setOrigin(0.5, 0);
    const w = Math.max(200, label.width, title.width, detail.width) + 28;
    const h = detail.y + detail.height + 10;

    const bg = s.add.graphics();
    bg.fillStyle(Color.panelBgWarm, 0.94);
    bg.fillRoundedRect(-w / 2, 0, w, h, 6);
    bg.lineStyle(1, Color.accentFantasy, 0.9);
    bg.strokeRoundedRect(-w / 2, 0, w, h, 6);

    const y = this.slotY(this.shown.length);
    const toast = s.add.container(s.scale.width / 2, y - 12, [bg, label, title, detail])
      .setDepth(Depth.TOAST).setScrollFactor(0).setAlpha(0).setData('h', h);
    // Draw it on one camera only: in the Homestead the main camera is zoomed 3×, and its HUD
    // has a camera of its own.
    for (const cam of s.cameras.cameras) if (cam !== this.camera) cam.ignore(toast);
    this.shown.push(toast);

    s.tweens.add({ targets: toast, alpha: 1, y, duration: IN_MS, ease: 'Sine.easeOut' });
    s.time.delayedCall(IN_MS + HOLD_MS, () => {
      s.tweens.add({
        targets: toast, alpha: 0, duration: OUT_MS, ease: 'Sine.easeIn',
        onComplete: () => {
          toast.destroy();
          this.shown = this.shown.filter(t => t !== toast);
          // The ones below move up into the gap, then any waiting toast takes the free slot.
          this.shown.forEach((t, i) => s.tweens.add({ targets: t, y: this.slotY(i), duration: 200, ease: 'Sine.easeOut' }));
          this.pump();
        },
      });
    });
  }
}
