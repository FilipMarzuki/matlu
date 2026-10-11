import * as Phaser from 'phaser';
import { t } from '../lib/i18n';
import { UI } from '../ui/UIFactory';
import { loadAudioManifest } from '../audio/AudioLoader';

/**
 * MainMenuScene — the game's entry point.
 *
 * Centred panel with three sections:
 *   - Play → HomesteadScene (the main game)
 *   - Dev Modes → various forge/test scenes
 *   - Profile → settings, stats, credits
 */
export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MainMenuScene' });
  }

  preload(): void {
    UI.preloadUI(this);
    loadAudioManifest(this);
  }

  create(): void {
    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cy = height / 2;

    // ── Background ────────────────────────────────────────────────────────
    this.cameras.main.setBackgroundColor(0x0a0e1a);

    // ── Panel — sized to fit all content ─────────────────────────────────
    const panelW = 340;
    const panelH = Math.min(height - 24, 560);
    UI.makePanel(this, cx, cy, panelW, panelH, 'fantasy', 0);

    // ── Title ─────────────────────────────────────────────────────────────
    this.add.text(cx, cy - panelH / 2 + 28, 'CORE WARDEN', {
      ...UI.Font.logo,
      fontSize: '24px',
      color: UI.TextColor.primary,
    }).setOrigin(0.5).setDepth(1);

    this.add.text(cx, cy - panelH / 2 + 52, t('menu.subtitle'), {
      ...UI.Font.small,
      color: UI.TextColor.secondary,
    }).setOrigin(0.5).setDepth(1);

    // ── Play button (accent / gold) ──────────────────────────────────────
    let y = cy - panelH / 2 + 86;
    UI.makeButton(this, cx, y, 'Play', () => this.startHomestead(), {
      fixedWidth: 220, variant: 'accent', depth: 1,
    });

    // ── Dev Modes ─────────────────────────────────────────────────────────
    y += 48;
    UI.makeDivider(this, cx, y - 8, panelW - 40, 1);
    this.add.text(cx, y, 'DEV MODES', {
      ...UI.Font.tiny, color: UI.TextColor.secondary,
    }).setOrigin(0.5).setDepth(1);

    y += 18;
    const devModes = [
      { label: 'Arena',            action: () => this.scene.start('DungeonForgeScene', {}) },
      { label: 'World Forge',      action: () => this.scene.start('WorldForgeScene') },
      { label: 'Settlement Forge', action: () => this.scene.start('SettlementForgeScene') },
      { label: 'Wilderview',       action: () => this.scene.start('GameScene') },
    ];
    for (const mode of devModes) {
      UI.makeButton(this, cx, y, mode.label, mode.action, { fixedWidth: 220, depth: 1 });
      y += 34;
    }

    // ── Profile ───────────────────────────────────────────────────────────
    y += 8;
    UI.makeDivider(this, cx, y - 8, panelW - 40, 1);
    this.add.text(cx, y, 'PROFILE', {
      ...UI.Font.tiny, color: UI.TextColor.secondary,
    }).setOrigin(0.5).setDepth(1);

    y += 18;
    const profileItems = [
      { label: t('menu.settings'), action: () => this.openOverlay('SettingsScene') },
      { label: t('menu.stats'),    action: () => this.openOverlay('StatsScene') },
      { label: t('menu.credits'),  action: () => this.openOverlay('CreditsScene') },
    ];
    for (const item of profileItems) {
      UI.makeButton(this, cx, y, item.label, item.action, { fixedWidth: 220, depth: 1 });
      y += 34;
    }

    // ── Music ─────────────────────────────────────────────────────────────
    const musicVol = parseFloat(localStorage.getItem('matlu_music_vol') ?? '0.15');
    const vol = isNaN(musicVol) ? 0.15 : Phaser.Math.Clamp(musicVol, 0, 1);
    if (this.cache.audio.has('music-menu')) {
      const music = this.sound.add('music-menu', { loop: true, volume: 0 });
      music.play();
      this.tweens.add({ targets: music, volume: 0.25 * vol, duration: 1500, ease: 'Sine.easeIn' });
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => music.stop());
    }

    // ── Keyboard ──────────────────────────────────────────────────────────
    this.input.keyboard?.on('keydown-ENTER', () => this.startHomestead());
  }

  private startHomestead(): void {
    this.fadeMusicOut();
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('HomesteadScene');
    });
  }

  private openOverlay(key: string): void {
    this.scene.pause();
    this.scene.launch(key, this.scene.key as unknown as object);
  }

  private fadeMusicOut(): void {
    const music = this.sound.getAll('music-menu')[0] as Phaser.Sound.BaseSound | undefined;
    if (music) {
      this.tweens.add({ targets: music, volume: 0, duration: 400, ease: 'Sine.easeIn' });
    }
  }
}
