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
 * ## Controls (FIL-115)
 * - Three sliders for Music / SFX / Ambience volume (0–100%)
 * - Click audio button to toggle mute on/off (all game sound)
 * - Click EN / SV / PL to change language (persists to localStorage via i18n)
 * - Click ✕ or press Escape to close
 *
 * ## Persistence
 * Volume multipliers: `matlu_music_vol`, `matlu_sfx_vol`, `matlu_ambience_vol` (0–1).
 * Mute state: `matlu_muted`.
 * Language: `matlu_lang` (managed by i18n.ts).
 * Volumes are restored in GameScene.preload(); mute in src/main.ts.
 */

const MUTE_KEY = 'matlu_muted';
export const MUSIC_VOL_KEY    = 'matlu_music_vol';
export const SFX_VOL_KEY      = 'matlu_sfx_vol';
export const AMBIENCE_VOL_KEY = 'matlu_ambience_vol';

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
    // Expanded to fit three volume sliders plus mute toggle and language selector.
    const panelW = 300;
    const panelH = 310;
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

    // ── Volume sliders (FIL-115) ──────────────────────────────────────────────
    // Three draggable sliders — Music / SFX / Ambience.
    // Changing a slider persists to localStorage and emits a game event so the
    // running GameScene can update currently-playing sounds without a restart.
    const sliderRows: Array<{ label: string; key: string; event: string }> = [
      { label: t('settings.music'),    key: MUSIC_VOL_KEY,    event: 'settings:music-vol'    },
      { label: t('settings.sfx'),      key: SFX_VOL_KEY,      event: 'settings:sfx-vol'      },
      { label: t('settings.ambience'), key: AMBIENCE_VOL_KEY, event: 'settings:ambience-vol' },
    ];

    const sliderStartY = cy - 105;
    const sliderRowH   = 42;

    // Layout: label on left, draggable track in the middle, percentage on the right.
    const labelX = cx - 130;
    const trackX = cx - 40;  // left edge of the track rectangle
    const trackW = 120;
    const trackH = 4;
    const thumbW = 10;
    const thumbH = 14;
    const valueX = trackX + trackW + 12;

    for (let i = 0; i < sliderRows.length; i++) {
      const { label, key, event } = sliderRows[i];
      const rowY = sliderStartY + i * sliderRowH;

      this.add.text(labelX, rowY, label, {
        fontSize: '12px',
        color: '#f0ead6',
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(802);

      // Track background — clicking it jumps the thumb to the click position.
      const track = this.add
        .rectangle(trackX + trackW / 2, rowY, trackW, trackH, 0x334433)
        .setScrollFactor(0)
        .setDepth(802)
        .setInteractive({ useHandCursor: true });

      // Read stored value; default 0.15 (15%) so new players start quiet.
      const stored  = typeof localStorage !== 'undefined'
        ? parseFloat(localStorage.getItem(key) ?? '0.15')
        : 0.15;
      const initVal = Phaser.Math.Clamp(isNaN(stored) ? 0.15 : stored, 0, 1);

      // Filled portion of the track to the left of the thumb.
      const fill = this.add
        .rectangle(trackX, rowY, initVal * trackW, trackH, 0x7aaa7a)
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(802);

      const thumb = this.add
        .rectangle(trackX + initVal * trackW, rowY, thumbW, thumbH, 0xffe066)
        .setScrollFactor(0)
        .setDepth(803)
        .setInteractive({ draggable: true, useHandCursor: true });
      this.input.setDraggable(thumb);

      const valTxt = this.add.text(valueX, rowY, `${Math.round(initVal * 100)}%`, {
        fontSize: '11px',
        color: '#7a9a7a',
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(802);

      // Helper: clamp value, update visuals, persist, and emit game event.
      const applyVal = (val: number) => {
        const v = Phaser.Math.Clamp(val, 0, 1);
        thumb.setX(trackX + v * trackW);
        fill.setSize(v * trackW, trackH);
        valTxt.setText(`${Math.round(v * 100)}%`);
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, String(v));
        this.game.events.emit(event, v);
      };

      // Click on track → jump thumb to that position.
      track.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
        applyVal((ptr.x - trackX) / trackW);
      });

      // Drag thumb horizontally.
      thumb.on('drag', (_ptr: Phaser.Input.Pointer, x: number) => {
        applyVal((x - trackX) / trackW);
      });
    }

    // ── Audio mute toggle ─────────────────────────────────────────────────────
    const muteY = sliderStartY + sliderRows.length * sliderRowH + 10;
    const audioLabel = () =>
      this.sound.mute ? t('settings.sound_off') : t('settings.sound_on');

    const audioBtn = this.add
      .text(cx, muteY, audioLabel(), {
        fontSize: '13px',
        color: '#ffe066',
        backgroundColor: '#333300aa',
        padding: { x: 14, y: 7 },
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
        this.sound.setMute(!this.sound.mute);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(MUTE_KEY, String(this.sound.mute));
        }
        audioBtn.setText(audioLabel());
        audioBtn.setStyle({ color: '#ffe066' });
      });

    // ── Language selector ─────────────────────────────────────────────────────
    const langLabelY = muteY + 46;
    this.add
      .text(cx, langLabelY, t('settings.language_label'), {
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
        .text(lx, langLabelY + 30, code.toUpperCase(), {
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
