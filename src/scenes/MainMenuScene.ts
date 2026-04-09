import Phaser from 'phaser';
import { t } from '../lib/i18n';
import { CombatArenaScene } from './CombatArenaScene';

/**
 * MainMenuScene — the game's entry point.
 *
 * Three buttons on the right-side panel over a live arena background:
 *   - Wilderview → fade out → GameScene
 *   - Arena      → fade out → stop this scene, arena continues full-screen
 *   - Credits    → overlay CreditsScene
 */
export class MainMenuScene extends Phaser.Scene {
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

    // ── Arena background ─────────────────────────────────────────────────────

    // Run the combat arena behind this scene as a live background.
    // launch() already handles re-starting a running scene internally, so no
    // explicit stop() is needed. bringToTop() ensures MainMenuScene always
    // renders on top of the arena regardless of scene ordering.
    this.scene.launch(CombatArenaScene.KEY);
    this.scene.bringToTop();

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

    const buttonStartY = height * 0.50;
    const buttonGap    = 52;

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

    addBtn('Wilderview', () => this.startWilderview());
    addBtn('Arena',      () => this.openArena());
    addBtn(t('menu.credits'), () => this.openCredits());

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

  private startWilderview(): void {
    this.fadeMusicOut();
    // Stop the arena background before entering the world to free resources.
    this.scene.stop(CombatArenaScene.KEY);
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('GameScene');
    });
  }

  private openArena(): void {
    this.fadeMusicOut();
    // CombatArenaScene is already running as the background — stop this scene
    // to reveal it full-screen.  No need to stop the arena.
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.stop();
    });
  }

  private openCredits(): void {
    // Overlay pattern: pause so the arena stays rendered behind CreditsScene.
    this.scene.pause();
    this.scene.launch('CreditsScene', this.scene.key as unknown as object);
  }
}
