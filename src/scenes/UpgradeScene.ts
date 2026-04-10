import Phaser from 'phaser';
import { t } from '../lib/i18n';

/**
 * UpgradeScene — permanent upgrade shop overlay.
 *
 * Launched as a Phaser overlay (pause GameScene + launch this scene) so the
 * game stays rendered in the background. Follows the same overlay pattern as
 * SettingsScene and CreditsScene:
 *   - caller passes `{ callerKey, gold }` as `scene.settings.data`
 *   - close() stops this scene and resumes the caller
 *
 * ## Upgrades (one-time purchases, persist via localStorage 'matlu_upgrades')
 *   Hardened        +25 max HP             15g
 *   Fleet-footed    +15% move speed        20g
 *   Longer dash     +50% dash duration     25g
 *   Cleanse mastery +20% swipe radius      30g
 *   Lucky strike    +50% gold from kills   35g
 *
 * ## Communication with GameScene
 * On each purchase, emits 'upgrade-purchased' with the cost (number) on the
 * GameScene event bus so the caller can deduct gold from its HUD counter
 * while it is paused. GameScene writes nothing back — the source of truth for
 * which upgrades are bought lives exclusively in localStorage.
 */

const UPGRADES_KEY = 'matlu_upgrades';

interface UpgradeDef {
  id:    string;
  label: string;
  desc:  string;
  cost:  number;
}

const UPGRADES: UpgradeDef[] = [
  { id: 'hardened',        label: 'Hardened',         desc: '+25 max HP',           cost: 15 },
  { id: 'fleet_footed',    label: 'Fleet-footed',      desc: '+15% move speed',      cost: 20 },
  { id: 'longer_dash',     label: 'Longer dash',       desc: '+50% dash duration',   cost: 25 },
  { id: 'cleanse_mastery', label: 'Cleanse mastery',   desc: '+20% swipe radius',    cost: 30 },
  { id: 'lucky_strike',    label: 'Lucky strike',      desc: '+50% gold from kills', cost: 35 },
];

export class UpgradeScene extends Phaser.Scene {
  constructor() {
    super({ key: 'UpgradeScene' });
  }

  create(): void {
    // FIL-113: Duck audio when the upgrade shop opens over GameScene.
    if (this.scene.isPaused('GameScene')) {
      type DuckableScene = Phaser.Scene & { duckAudio?: (tweens: Phaser.Tweens.TweenManager) => void };
      (this.scene.get('GameScene') as DuckableScene).duckAudio?.(this.tweens);
    }

    const { width, height } = this.cameras.main;
    const cx = width  / 2;
    const cy = height / 2;

    const { callerKey, gold: initialGold } = this.scene.settings.data as {
      callerKey: string;
      gold: number;
    };

    // Local gold copy — decremented here for immediate UI feedback.
    // GameScene maintains the authoritative counter via 'upgrade-purchased' events.
    let currentGold = initialGold;

    // Persisted set of purchased upgrade ids.
    const bought = JSON.parse(localStorage.getItem(UPGRADES_KEY) ?? '{}') as Record<string, boolean>;

    // ── Backdrop ──────────────────────────────────────────────────────────────
    // Full-screen dim; clicks outside the panel close the overlay.
    this.add
      .rectangle(cx, cy, width, height, 0x000000, 0.65)
      .setScrollFactor(0)
      .setDepth(800)
      .setInteractive()
      .on('pointerdown', () => this.close());

    // ── Panel ─────────────────────────────────────────────────────────────────
    const panelW = 320;
    const panelH = 360;
    this.add
      .rectangle(cx, cy, panelW, panelH, 0x111a11, 0.95)
      .setScrollFactor(0)
      .setDepth(801)
      .setInteractive(); // swallows pointer events so backdrop doesn't close on panel clicks

    // ── Title ─────────────────────────────────────────────────────────────────
    this.add
      .text(cx, cy - panelH / 2 + 22, 'Upgrade Shrine', {
        fontSize: '18px',
        color: '#f0ead6',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);

    // ── Gold display — updates after each purchase ────────────────────────────
    const goldDisplay = this.add
      .text(cx, cy - panelH / 2 + 50, `${t('hud.gold')}: ${currentGold}`, {
        fontSize: '13px',
        color: '#ffe066',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);

    // ── Upgrade rows ──────────────────────────────────────────────────────────
    const rowStartY = cy - panelH / 2 + 90;
    const rowStep   = 52;

    // Keep refs so refreshButtons() can restyle all of them together after a purchase.
    const buttons: Phaser.GameObjects.Text[] = [];

    const refreshButtons = (): void => {
      for (let i = 0; i < UPGRADES.length; i++) {
        const def = UPGRADES[i];
        const btn = buttons[i];
        if (bought[def.id]) {
          btn.setText('✓ Purchased')
            .setStyle({ color: '#7a9a7a', backgroundColor: '#0a110a88' });
          btn.disableInteractive();
        } else if (currentGold >= def.cost) {
          btn.setText(`Buy  ${def.cost}g`)
            .setStyle({ color: '#ffe066', backgroundColor: '#333300aa' });
          btn.setInteractive({ useHandCursor: true });
        } else {
          btn.setText(`${def.cost}g`)
            .setStyle({ color: '#664444', backgroundColor: '#1a0a0a66' });
          btn.disableInteractive();
        }
      }
    };

    for (let i = 0; i < UPGRADES.length; i++) {
      const def  = UPGRADES[i];
      const rowY = rowStartY + i * rowStep;

      // Left: upgrade name
      this.add
        .text(cx - panelW / 2 + 16, rowY, def.label, {
          fontSize: '13px',
          color: '#d4c9a8',
        })
        .setScrollFactor(0)
        .setDepth(802);

      // Left: description line
      this.add
        .text(cx - panelW / 2 + 16, rowY + 18, def.desc, {
          fontSize: '10px',
          color: '#7a9a7a',
        })
        .setScrollFactor(0)
        .setDepth(802);

      // Right: buy button — state filled by refreshButtons()
      const btn = this.add
        .text(cx + panelW / 2 - 16, rowY + 9, '', {
          fontSize: '12px',
          color: '#ffe066',
          backgroundColor: '#333300aa',
          padding:    { x: 10, y: 6 },
          fixedWidth: 90,
          align:      'center',
        })
        .setOrigin(1, 0.5)
        .setScrollFactor(0)
        .setDepth(802);

      btn.on('pointerover', () => btn.setStyle({ color: '#ffffff' }));
      btn.on('pointerout',  () => {
        if (!bought[def.id]) btn.setStyle({ color: '#ffe066' });
      });

      // Closure captures `def` and `i` so each button acts on its own upgrade.
      btn.on('pointerdown', () => {
        if (bought[def.id] || currentGold < def.cost) return;
        bought[def.id] = true;
        localStorage.setItem(UPGRADES_KEY, JSON.stringify(bought));
        currentGold -= def.cost;
        goldDisplay.setText(`${t('hud.gold')}: ${currentGold}`);
        // GameScene (paused, not sleeping) still processes events — notify it to
        // decrement its gold counter and refresh the HUD.
        this.scene.get(callerKey).events.emit('upgrade-purchased', def.cost);
        refreshButtons();
      });

      buttons.push(btn);
    }

    refreshButtons();

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
      .on('pointerover', () => closeBtn.setStyle({ color: '#f0ead6' }))
      .on('pointerout',  () => closeBtn.setStyle({ color: '#7a9a7a' }))
      .on('pointerdown', () => this.close());

    this.input.keyboard?.on('keydown-ESC', () => this.close());
  }

  private close(): void {
    this.scene.stop();
    const callerKey = (this.scene.settings.data as { callerKey: string }).callerKey;
    this.scene.resume(callerKey);
  }
}
