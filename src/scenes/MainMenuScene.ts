import { t } from '../lib/i18n';
import { CombatArenaScene } from './CombatArenaScene';

/**
 * MainMenuScene — the game's entry point and navigation hub.
 *
 * Displays the game title and buttons for each major screen.
 * Lore and Stats are shown but disabled until their scenes are implemented
 * in FIL-85 and FIL-86.
 *
 * ## Scene transitions
 * - Play: camera fade-out → scene.start('GameScene')
 * - Credits: pause this scene, launch CreditsScene as an overlay
 * - Settings: pause this scene, launch SettingsScene as an overlay
 *   (both overlay scenes call scene.resume(callerKey) on close)
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
    // sendToBack() ensures CombatArenaScene renders first (underneath).
    // Stop any stale instance before launching so create() runs fresh.
    this.scene.stop(CombatArenaScene.KEY);
    this.scene.launch(CombatArenaScene.KEY);
    this.scene.sendToBack(CombatArenaScene.KEY);

    // ── Right-side panel ──────────────────────────────────────────────────────

    // All menu UI lives in a 220px panel anchored to the right edge.
    // The arena fight is visible in the remaining ~70% of the screen on the left.
    const panelW = 220;
    const cx = width - panelW / 2;   // horizontal center of the panel

    // Semi-transparent dark panel — slight green tint echoes the game palette.
    // Alpha 0.92 keeps the arena subtly visible behind the panel edges.
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

    const buttonStartY = height * 0.46;
    const buttonGap    = 52;

    // Collect active (non-disabled) buttons so keyboard nav can cycle through them.
    // Each entry pairs the Text object with the action it triggers.
    const activeButtons: Array<{ btn: Phaser.GameObjects.Text; action: () => void }> = [];
    let focusIndex = 0;

    // Gold colour used for normal (unfocused) buttons
    const COLOR_NORMAL  = '#ffe066';
    // White used for both hover AND keyboard focus — visually consistent
    const COLOR_FOCUSED = '#ffffff';

    /**
     * Move keyboard focus to the button at index i.
     * Resets the previously focused button to normal styling and highlights the new one.
     */
    const setFocus = (i: number): void => {
      // Reset old
      const old = activeButtons[focusIndex];
      if (old) {
        old.btn.setStyle({ color: COLOR_NORMAL });
        // Strip the "> " prefix added when the button gained focus
        old.btn.setText(old.btn.text.replace(/^> /, ''));
      }
      focusIndex = i;
      // Highlight new
      const cur = activeButtons[focusIndex];
      if (cur) {
        cur.btn.setStyle({ color: COLOR_FOCUSED });
        cur.btn.setText('> ' + cur.btn.text);
      }
    };

    const playClick = (): void => {
      if (this.cache.audio.has('sfx-click')) this.sound.play('sfx-click', { volume: 0.4 });
    };

    const addActive = (btn: Phaser.GameObjects.Text, action: () => void): void => {
      activeButtons.push({ btn, action });
    };

    addActive(this.makeButton(cx, buttonStartY,                 t('menu.play'),     false, () => this.startGame()),   () => this.startGame());
    addActive(this.makeButton(cx, buttonStartY + buttonGap,     t('menu.credits'),  false, () => this.openCredits()), () => this.openCredits());
    addActive(this.makeButton(cx, buttonStartY + buttonGap * 2, t('menu.settings'), false, () => this.openSettings()),() => this.openSettings());
    // Coming soon — greyed out until FIL-85/86 are implemented
    this.makeButton(cx, buttonStartY + buttonGap * 3, t('menu.lore'),  true);
    this.makeButton(cx, buttonStartY + buttonGap * 4, t('menu.stats'), true);

    // Start with Play focused
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

    // Stop the arena when this scene shuts down (navigating to GameScene, etc.)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scene.stop(CombatArenaScene.KEY);
    });

    // ── Hint ─────────────────────────────────────────────────────────────────

    this.add
      .text(cx, height - 28, t('menu.hint'), {
        fontSize: '11px',
        color: '#3a5a3a',
      })
      .setOrigin(0.5)
      .setDepth(1);
  }

  /**
   * Create a single menu button.
   *
   * Phaser text objects support backgroundColor and padding natively,
   * so no separate background rectangle is needed — the text itself IS the button.
   * setInteractive() makes the text object receive pointer events.
   *
   * @param disabled - When true, the button is greyed out and non-interactive
   */
  private makeButton(
    x: number,
    y: number,
    label: string,
    disabled: boolean,
    onClick?: () => void,
  ): Phaser.GameObjects.Text {
    const btn = this.add
      .text(x, y, label, {
        fontSize: '16px',
        // Gold for active, grey for disabled — matches NpcDialogScene choice buttons
        color: disabled ? '#555544' : '#ffe066',
        backgroundColor: disabled ? '#1a1a0066' : '#333300aa',
        padding: { x: 14, y: 8 },
        fixedWidth: 180,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(1);

    if (!disabled && onClick) {
      btn
        .setInteractive({ useHandCursor: true })
        .on('pointerover',  () => btn.setStyle({ color: '#ffffff' }))
        .on('pointerout',   () => btn.setStyle({ color: '#ffe066' }))
        .on('pointerdown',  () => {
          if (this.cache.audio.has('sfx-click')) this.sound.play('sfx-click', { volume: 0.4 });
          onClick();
        });
    }

    return btn;
  }

  private startGame(): void {
    // Fade music out alongside the camera fade so there's no audio pop
    const music = this.sound.getAll('music-menu')[0] as Phaser.Sound.BaseSound | undefined;
    if (music) {
      this.tweens.add({ targets: music, volume: 0, duration: 400, ease: 'Sine.easeIn' });
    }
    // Fade to black before switching scenes — feels cleaner than a hard cut
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('GameScene');
    });
  }

  private openCredits(): void {
    // Overlay pattern: pause this scene so it stays rendered in the background,
    // then launch CreditsScene on top. CreditsScene calls scene.resume(callerKey)
    // on close, which restores MainMenuScene — no extra wiring needed.
    this.scene.pause();
    this.scene.launch('CreditsScene', this.scene.key as unknown as object);
  }

  private openSettings(): void {
    this.scene.pause();
    this.scene.launch('SettingsScene', this.scene.key as unknown as object);
  }
}
