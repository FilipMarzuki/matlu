import Phaser from 'phaser';
import { t } from '../lib/i18n';
import { CombatArenaScene } from './CombatArenaScene';
import { WilderviewScene } from './WilderviewScene';

// ── Background swap constants ─────────────────────────────────────────────────

/** How long each background scene runs before switching. */
const BG_SWAP_INTERVAL_MS = 30_000;
/** Fade duration for background transitions. */
const BG_FADE_MS          =    800;

/**
 * MainMenuScene — the game's entry point.
 *
 * Three buttons on the right-side panel over a live background:
 *   - Wilderview → fade out → GameScene
 *   - Arena      → fade out → stop this scene, arena continues full-screen
 *   - Credits    → overlay CreditsScene
 *
 * The background alternates between CombatArenaScene and WilderviewScene every
 * BG_SWAP_INTERVAL_MS with a short camera fade. Both background scenes are
 * launched with `{ background: true }` to suppress their in-scene HUDs.
 */
export class MainMenuScene extends Phaser.Scene {
  /** Key of whichever background scene is currently running. */
  private activeBgKey: string = CombatArenaScene.KEY;
  /** Repeating timer that drives background swaps. */
  private bgSwapTimer!: Phaser.Time.TimerEvent;

  constructor() {
    super({ key: 'MainMenuScene' });
  }

  preload(): void {
    // Piano menu theme (Free Orchestral Music Pack, CC0)
    this.load.audio('music-menu', [
      'assets/audio/Free Orchestral Music Pack/Lost Kingdom (Piano Menu).wav',
    ]);
    // Cassette button click SFX (Shapeforms, free preview)
    this.load.audio('sfx-click', [
      'assets/audio/Shapeforms Audio Free Sound Effects/Cassette Preview/AUDIO/BUTTON_05.wav',
    ]);
  }

  create(): void {
    const { width, height } = this.cameras.main;

    // ── Background scene ─────────────────────────────────────────────────────

    // Start with the arena background. `{ background: true }` suppresses the
    // in-scene HUD and dev bar so they don't overlap the menu panel.
    this.activeBgKey = CombatArenaScene.KEY;
    this.scene.launch(CombatArenaScene.KEY, { background: true });
    this.scene.bringToTop();

    // Schedule the repeating background swap (arena ↔ wilderview).
    this.bgSwapTimer = this.time.addEvent({
      delay:         BG_SWAP_INTERVAL_MS,
      callback:      this.swapBackground,
      callbackScope: this,
      loop:          true,
    });

    // ── Right-side panel ──────────────────────────────────────────────────────

    // All menu UI lives in a 220px panel anchored to the right edge.
    // The arena fight is visible in the remaining ~70% of the screen on the left.
    const panelW = 220;
    const cx = width - panelW / 2;   // horizontal center of the panel

    // Semi-transparent dark panel — slight green tint echoes the game palette.
    this.add
      .rectangle(cx, height / 2, panelW, height, 0x0a130a)
      .setAlpha(0.92)
      .setDepth(0);

    // ── Title ────────────────────────────────────────────────────────────────

    this.add
      .text(cx, height * 0.22, 'matlu', {
        fontSize: '48px',
        color: '#f0ead6',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(1);

    this.add
      .text(cx, height * 0.22 + 56, t('menu.subtitle'), {
        fontSize: '14px',
        color: '#7a9a7a',
      })
      .setOrigin(0.5)
      .setDepth(1);

    // ── Buttons ──────────────────────────────────────────────────────────────

    // Six buttons fit comfortably starting at 40% of height with a 44px gap.
    // (Previously 50% / 52px for 3 buttons — tightened to avoid overlap with
    // the hint text at the bottom of the panel.)
    const buttonStartY = height * 0.40;
    const buttonGap    = 44;

    // Collect active buttons so keyboard nav can cycle through them.
    const activeButtons: Array<{ btn: Phaser.GameObjects.Text; action: () => void }> = [];
    let focusIndex = 0;

    const COLOR_NORMAL  = '#ffe066';
    const COLOR_FOCUSED = '#ffffff';

    const setFocus = (i: number): void => {
      const old = activeButtons[focusIndex];
      if (old) {
        old.btn.setStyle({ color: COLOR_NORMAL });
        old.btn.setText(old.btn.text.replace(/^> /, ''));
      }
      focusIndex = i;
      const cur = activeButtons[focusIndex];
      if (cur) {
        cur.btn.setStyle({ color: COLOR_FOCUSED });
        cur.btn.setText('> ' + cur.btn.text);
      }
    };

    const playClick = (): void => {
      if (this.cache.audio.has('sfx-click')) this.sound.play('sfx-click', { volume: 0.4 });
    };

    const addBtn = (label: string, action: () => void): void => {
      const y = buttonStartY + activeButtons.length * buttonGap;
      activeButtons.push({ btn: this.makeButton(cx, y, label, action), action });
    };

    addBtn('Wilderview',          () => this.startWilderview());
    addBtn('Arena',               () => this.openArena());
    addBtn(t('menu.settings'),   () => this.openSettings());
    addBtn(t('menu.stats'),      () => this.openStats());
    addBtn(t('menu.lore'),       () => this.openLore());
    addBtn(t('menu.credits'),    () => this.openCredits());

    // Start with first button focused
    setFocus(0);

    // ── Keyboard navigation ───────────────────────────────────────────────────

    const n = activeButtons.length;
    this.input.keyboard?.on('keydown-UP',   () => setFocus((focusIndex - 1 + n) % n));
    this.input.keyboard?.on('keydown-DOWN', () => setFocus((focusIndex + 1) % n));
    this.input.keyboard?.on('keydown-ENTER', () => {
      playClick();
      activeButtons[focusIndex].action();
    });

    // ── Music ────────────────────────────────────────────────────────────────

    if (this.cache.audio.has('music-menu')) {
      const menuMusic = this.sound.add('music-menu', { loop: true, volume: 0 });
      menuMusic.play();
      this.tweens.add({ targets: menuMusic, volume: 0.25, duration: 1500, ease: 'Sine.easeIn' });
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => menuMusic.stop());
    }

    // ── Hint ─────────────────────────────────────────────────────────────────

    this.add
      .text(cx, height - 28, t('menu.hint'), {
        fontSize: '11px',
        color: '#3a5a3a',
      })
      .setOrigin(0.5)
      .setDepth(1);
  }

  private makeButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
  ): Phaser.GameObjects.Text {
    const btn = this.add
      .text(x, y, label, {
        fontSize: '16px',
        color: '#ffe066',
        backgroundColor: '#333300aa',
        padding: { x: 14, y: 8 },
        fixedWidth: 180,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(1)
      .setInteractive({ useHandCursor: true })
      .on('pointerover',  () => btn.setStyle({ color: '#ffffff' }))
      .on('pointerout',   () => btn.setStyle({ color: '#ffe066' }))
      .on('pointerdown',  () => {
        if (this.cache.audio.has('sfx-click')) this.sound.play('sfx-click', { volume: 0.4 });
        onClick();
      });
    return btn;
  }

  private fadeMusicOut(): void {
    const music = this.sound.getAll('music-menu')[0] as Phaser.Sound.BaseSound | undefined;
    if (music) {
      this.tweens.add({ targets: music, volume: 0, duration: 400, ease: 'Sine.easeIn' });
    }
  }

  /**
   * Swap between CombatArenaScene and WilderviewScene backgrounds.
   * Called on a repeating timer — fades the camera out, stops the current
   * background, launches the next one, then fades back in.
   */
  private swapBackground(): void {
    const nextKey  = this.activeBgKey === CombatArenaScene.KEY
      ? WilderviewScene.KEY
      : CombatArenaScene.KEY;
    const nextData = nextKey === CombatArenaScene.KEY ? { background: true } : undefined;

    this.cameras.main.fadeOut(BG_FADE_MS, 0, 0, 0);
    this.time.delayedCall(BG_FADE_MS, () => {
      this.scene.stop(this.activeBgKey);
      this.activeBgKey = nextKey;
      this.scene.launch(nextKey, nextData);
      // Re-assert render order — launch() adds the new scene below this one.
      this.scene.bringToTop();
      this.cameras.main.fadeIn(BG_FADE_MS, 0, 0, 0);
    });
  }

  private startWilderview(): void {
    this.fadeMusicOut();
    this.bgSwapTimer.remove();
    // Stop whichever background is currently running to free resources.
    this.scene.stop(this.activeBgKey);
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('GameScene');
    });
  }

  private openArena(): void {
    this.fadeMusicOut();
    this.bgSwapTimer.remove();
    // Always stop whichever background is running and restart the arena in
    // foreground mode. Passing `{}` explicitly clears any stale bgMode init
    // data that Phaser may have retained from the background launch.
    const bgKey = this.activeBgKey;
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.stop(bgKey);
      this.scene.start(CombatArenaScene.KEY, {});
    });
  }

  private openCredits(): void {
    // Overlay pattern: pause so the background stays rendered behind CreditsScene.
    this.scene.pause();
    this.scene.launch('CreditsScene', this.scene.key as unknown as object);
  }

  private openSettings(): void {
    // Same overlay pattern: pause this scene, launch SettingsScene with our key
    // as data so it can resume us when the player closes Settings.
    this.scene.pause();
    this.scene.launch('SettingsScene', this.scene.key as unknown as object);
  }

  private openStats(): void {
    this.scene.pause();
    this.scene.launch('StatsScene', this.scene.key as unknown as object);
  }

  private openLore(): void {
    this.scene.pause();
    this.scene.launch('LoreScene', this.scene.key as unknown as object);
  }
}
