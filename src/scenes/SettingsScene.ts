import * as Phaser from 'phaser';
import { t, setLanguage, getLanguage, SUPPORTED_LANGUAGES } from '../lib/i18n';

/**
 * SettingsScene — audio and language preferences overlay.
 *
 * Launched as a Phaser overlay (pause caller + launch this scene) so the
 * menu or game stays rendered in the background. Follows the same pattern
 * as CreditsScene:
 *   - caller passes its scene key as `scene.settings.data`
 *   - close() stops this scene and resumes the caller
 *
 * ## Controls
 * - Click audio button to toggle mute on/off (all game sound)
 * - Click EN / SV / PL to change language (persists to localStorage via i18n)
 * - Click ✕ or press Escape to close
 *
 * ## Persistence
 * Mute state is saved to `localStorage` under `matlu_muted`.
 * Language is already persisted by i18n.ts (`matlu_lang`).
 * Both are restored on the next page load in `src/main.ts`.
 */

const MUTE_KEY = 'matlu_muted';

export class SettingsScene extends Phaser.Scene {
  constructor() {
    super({ key: 'SettingsScene' });
  }

  create(): void {
    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cy = height / 2;

    // ── Backdrop ─────────────────────────────────────────────────────────────
    // Full-screen semi-transparent overlay; clicking outside the panel closes.
    this.add
      .rectangle(cx, cy, width, height, 0x000000, 0.65)
      .setScrollFactor(0)
      .setDepth(800)
      .setInteractive()
      .on('pointerdown', () => this.close());

    // ── Panel ─────────────────────────────────────────────────────────────────
    // Solid panel so clicks on controls don't fall through to the backdrop.
    const panelW = 280;
    const panelH = 220;
    this.add
      .rectangle(cx, cy, panelW, panelH, 0x111a11, 0.95)
      .setScrollFactor(0)
      .setDepth(801)
      .setInteractive(); // swallows pointer events so backdrop doesn't close on panel clicks

    // ── Title ─────────────────────────────────────────────────────────────────
    this.add
      .text(cx, cy - panelH / 2 + 22, t('settings.title'), {
        fontSize: '18px',
        color: '#f0ead6',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);

    // ── Audio toggle ──────────────────────────────────────────────────────────
    // Reflects current mute state; clicking flips it and updates the label.
    const audioLabel = () =>
      this.sound.mute ? t('settings.sound_off') : t('settings.sound_on');

    const audioBtn = this.add
      .text(cx, cy - 30, audioLabel(), {
        fontSize: '14px',
        color: '#ffe066',
        backgroundColor: '#333300aa',
        padding: { x: 14, y: 8 },
        fixedWidth: 200,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802)
      .setInteractive({ useHandCursor: true })
      .on('pointerover',  () => {
        audioBtn.setStyle({ color: '#ffffff' });
        if (this.game.device.os.desktop && this.cache.audio.has('sfx-hover')) {
          this.sound.play('sfx-hover', { volume: 0.18 });
        }
      })
      .on('pointerout',   () => audioBtn.setStyle({ color: '#ffe066' }))
      .on('pointerdown',  () => {
        // Toggle mute on the shared sound manager and persist
        this.sound.setMute(!this.sound.mute);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(MUTE_KEY, String(this.sound.mute));
        }
        audioBtn.setText(audioLabel());
        audioBtn.setStyle({ color: '#ffe066' }); // reset hover colour after click
      });

    // ── Language selector ─────────────────────────────────────────────────────
    // Three inline buttons; selected language is highlighted gold, others grey.
    this.add
      .text(cx, cy + 28, t('settings.language_label'), {
        fontSize: '12px',
        color: '#7a9a7a',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);

    const langBtnW = 52;
    const langGap  = 8;
    const totalW   = SUPPORTED_LANGUAGES.length * langBtnW + (SUPPORTED_LANGUAGES.length - 1) * langGap;
    let lx = cx - totalW / 2 + langBtnW / 2;

    const langButtons: Phaser.GameObjects.Text[] = [];

    for (const code of SUPPORTED_LANGUAGES) {
      const btn = this.add
        .text(lx, cy + 56, code.toUpperCase(), {
          fontSize: '13px',
          color: getLanguage() === code ? '#ffe066' : '#555544',
          backgroundColor: getLanguage() === code ? '#333300aa' : '#1a1a0066',
          padding: { x: 8, y: 6 },
          fixedWidth: langBtnW,
          align: 'center',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(802)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => {
          if (this.game.device.os.desktop && this.cache.audio.has('sfx-hover')) {
            this.sound.play('sfx-hover', { volume: 0.18 });
          }
        })
        .on('pointerdown', () => {
          setLanguage(code);
          // Refresh button highlights to reflect the new selection
          for (const b of langButtons) {
            const isActive = b.text.toLowerCase() === getLanguage();
            b.setStyle({ color: isActive ? '#ffe066' : '#555544', backgroundColor: isActive ? '#333300aa' : '#1a1a0066' });
          }
        });

      langButtons.push(btn);
      lx += langBtnW + langGap;
    }

    // ── Close button ──────────────────────────────────────────────────────────
    const closeBtn = this.add
      .text(cx + panelW / 2 - 14, cy - panelH / 2 + 14, '✕', {
        fontSize: '14px',
        color: '#7a9a7a',
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(802)
      .setInteractive({ useHandCursor: true })
      .on('pointerover',  () => {
        closeBtn.setStyle({ color: '#f0ead6' });
        if (this.game.device.os.desktop && this.cache.audio.has('sfx-hover')) {
          this.sound.play('sfx-hover', { volume: 0.18 });
        }
      })
      .on('pointerout',   () => closeBtn.setStyle({ color: '#7a9a7a' }))
      .on('pointerdown',  () => this.close());

    this.input.keyboard?.on('keydown-ESC', () => this.close());
  }

  private close(): void {
    this.scene.stop();
    const callerKey = (this.scene.settings.data as unknown as string) ?? 'MainMenuScene';
    this.scene.resume(callerKey);
  }
}
