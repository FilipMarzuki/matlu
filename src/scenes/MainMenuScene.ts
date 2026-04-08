import { t } from '../lib/i18n';

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

  create(): void {
    const { width, height } = this.cameras.main;
    const cx = width / 2;

    // Dark forest background — matches the game's overall palette
    this.add
      .rectangle(cx, height / 2, width, height, 0x111a11)
      .setDepth(0);

    // ── Title ────────────────────────────────────────────────────────────────

    // Game title — large, cream, bold
    this.add
      .text(cx, height * 0.22, 'matlu', {
        fontSize: '48px',
        color: '#f0ead6',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(1);

    // Subtitle — muted, small
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

    this.makeButton(cx, buttonStartY,              t('menu.play'),     false, () => this.startGame());
    this.makeButton(cx, buttonStartY + buttonGap,  t('menu.credits'),  false, () => this.openCredits());
    this.makeButton(cx, buttonStartY + buttonGap * 2, t('menu.settings'), false, () => this.openSettings());
    // Coming soon — greyed out until FIL-85/86 are implemented
    this.makeButton(cx, buttonStartY + buttonGap * 3, t('menu.lore'),  true);
    this.makeButton(cx, buttonStartY + buttonGap * 4, t('menu.stats'), true);

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
        .on('pointerdown',  onClick);
    }

    return btn;
  }

  private startGame(): void {
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
