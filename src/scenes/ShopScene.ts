import * as Phaser from 'phaser';
import { t } from '../lib/i18n';

/**
 * ShopScene — vendor shop overlay (FIL-93).
 *
 * Launched as a Phaser overlay (GameScene paused, this scene on top) using
 * the same pattern as UpgradeScene and CreditsScene:
 *   - caller: `this.scene.pause(); this.scene.launch('ShopScene', data)`
 *   - data shape: `{ callerKey: string; gold: number; vendorId: string }`
 *   - close: `this.scene.stop(); this.scene.resume(callerKey)`
 *
 * ## Items — consumable vs permanent
 * Unlike upgrades (UpgradeScene), shop items are consumable: each purchase
 * applies an immediate effect and can be bought again. No localStorage
 * persistence is needed — the effect hits the live game state via the
 * 'shop-purchased' event emitted on GameScene's event bus.
 *
 * ## Effects implemented
 *   heal       → restores HP (value = HP amount)
 *   cleanse_pct → adds cleanse progress (value = percentage points, 1–100)
 *
 * ## Trade mode (gold → resource or resource → resource)
 * Blocked on FIL-36 (Inventory Level 1), which introduces the resource
 * system. This PR implements buy mode only; the trade tab can be added once
 * the inventory is in place.
 *
 * ## Communication with GameScene
 * On each purchase, emits 'shop-purchased' on the paused GameScene's event
 * bus. Paused scenes still process event bus calls, so the gold and HP
 * counters update immediately and are visible when the overlay closes.
 *
 * ## Keyboard support
 * ESC / clicking outside the panel closes the shop. Arrow keys scroll item
 * focus (future enhancement — not implemented yet as the item count is small).
 */

// ─── Item catalogue ───────────────────────────────────────────────────────────

interface ShopItem {
  id:     string;
  /** Display name. */
  label:  string;
  /** Short effect description shown in the shop row. */
  desc:   string;
  cost:   number;
  /** What to apply on purchase. */
  effect: 'heal' | 'cleanse_pct';
  /**
   * Effect magnitude.
   * heal       → HP restored
   * cleanse_pct → percentage points added to the cleanse meter (e.g. 5 = 5%)
   */
  value:  number;
}

/**
 * One catalogue per vendor (keyed by vendorId passed from GameScene).
 * Different settlements carry different inventories — Skogsgläntan (the
 * trading village) stocks the widest range; the smaller hamlets keep basics.
 */
const VENDOR_INVENTORIES: Record<string, ShopItem[]> = {
  strandviken: [
    { id: 'heal_small', label: 'Herbal remedy',  desc: 'Restore 25 HP',    cost:  8, effect: 'heal',       value: 25 },
    { id: 'heal_large', label: 'Root tonic',     desc: 'Restore 60 HP',    cost: 18, effect: 'heal',       value: 60 },
  ],
  skogsglanten: [
    { id: 'heal_small',    label: 'Forest herb',     desc: 'Restore 25 HP',      cost:  8, effect: 'heal',        value: 25 },
    { id: 'heal_large',    label: 'Root tonic',      desc: 'Restore 60 HP',      cost: 18, effect: 'heal',        value: 60 },
    { id: 'cleanse_boost', label: 'Grove blessing',  desc: '+5% Cleanse',         cost: 22, effect: 'cleanse_pct', value:  5 },
  ],
  klippbyn: [
    { id: 'heal_large',    label: 'Mountain herb',  desc: 'Restore 60 HP',  cost: 18, effect: 'heal',        value: 60 },
    { id: 'cleanse_boost', label: 'Spring water',   desc: '+5% Cleanse',     cost: 22, effect: 'cleanse_pct', value:  5 },
  ],
};

// ─── Scene ───────────────────────────────────────────────────────────────────

export class ShopScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ShopScene' });
  }

  create(): void {
    // Duck audio exactly like UpgradeScene does — lower volume while the overlay
    // is open so UI interaction feels separate from the game world.
    if (this.scene.isPaused('GameScene')) {
      type DuckableScene = Phaser.Scene & { duckAudio?: (tweens: Phaser.Tweens.TweenManager) => void };
      (this.scene.get('GameScene') as DuckableScene).duckAudio?.(this.tweens);
    }

    const { width, height } = this.cameras.main;
    const cx = width  / 2;
    const cy = height / 2;

    const { gold: initialGold, vendorId } = this.scene.settings.data as {
      callerKey: string;
      gold:      number;
      vendorId:  string;
    };

    // Local gold copy — decremented immediately for UI feedback.
    // GameScene applies the authoritative deduction via 'shop-purchased' events.
    let currentGold = initialGold;

    const items = VENDOR_INVENTORIES[vendorId] ?? [];

    // ── Panel geometry ────────────────────────────────────────────────────────
    const panelW = 380;
    // Height scales with item count so the panel always fits its content.
    const rowH   = 52;
    const headerH = 72;
    const footerH = 36;
    const panelH  = headerH + items.length * rowH + footerH;

    // ── Backdrop ─────────────────────────────────────────────────────────────
    // Full-screen semi-transparent overlay — clicking outside the panel closes.
    this.add
      .rectangle(cx, cy, width, height, 0x000000, 0.65)
      .setScrollFactor(0)
      .setDepth(800)
      .setInteractive()
      .on('pointerdown', () => this.close());

    // ── Panel background ──────────────────────────────────────────────────────
    this.add
      .rectangle(cx, cy, panelW, panelH, 0x111a11, 0.95)
      .setScrollFactor(0)
      .setDepth(801)
      .setInteractive(); // swallow events so backdrop doesn't close on panel click

    const border = this.add.graphics().setScrollFactor(0).setDepth(802);
    border.lineStyle(1, 0xffffff, 0.12);
    border.strokeRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH);

    // ── Header ────────────────────────────────────────────────────────────────
    const top = cy - panelH / 2;

    this.add
      .text(cx, top + 18, 'Trader', {
        fontSize: '18px',
        color:    '#ffe066',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(802);

    // Gold balance — updated in-place so the player sees the running total.
    const goldLabel = this.add
      .text(cx, top + 42, `${t('hud.gold')}: ${currentGold}`, {
        fontSize: '12px',
        color:    '#cccc88',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(802);

    // Divider below header
    const divG = this.add.graphics().setScrollFactor(0).setDepth(802);
    divG.lineStyle(1, 0xffffff, 0.10);
    const divY = top + headerH - 4;
    divG.lineBetween(cx - panelW / 2 + 16, divY, cx + panelW / 2 - 16, divY);

    // ── Item rows ─────────────────────────────────────────────────────────────
    // Each row contains: item name + description on the left, cost + Buy button
    // on the right. The Buy button goes grey when the player can't afford it.
    //
    // Phaser doesn't have a native button widget — we use Text objects with
    // setInteractive() and pointer events, the same pattern UpgradeScene uses.

    const itemStartY = top + headerH + rowH / 2;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rowY = itemStartY + i * rowH;

      // Item label
      this.add
        .text(cx - panelW / 2 + 20, rowY - 10, item.label, {
          fontSize: '13px',
          color:    '#f0ead6',
        })
        .setScrollFactor(0)
        .setDepth(802);

      // Item description
      this.add
        .text(cx - panelW / 2 + 20, rowY + 8, item.desc, {
          fontSize: '11px',
          color:    '#888888',
        })
        .setScrollFactor(0)
        .setDepth(802);

      // Cost label
      this.add
        .text(cx + panelW / 2 - 80, rowY, `${item.cost}g`, {
          fontSize: '12px',
          color:    '#ffe066',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(802);

      // Buy button
      const btn = this.add
        .text(cx + panelW / 2 - 36, rowY, 'Buy', {
          fontSize:          '12px',
          color:             '#111111',
          backgroundColor:   '#ffe066',
          padding:           { x: 8, y: 4 },
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(802)
        .setInteractive({ useHandCursor: true });

      // Initial affordability state
      const updateBtn = (): void => {
        if (currentGold >= item.cost) {
          btn.setAlpha(1).setInteractive({ useHandCursor: true });
        } else {
          btn.setAlpha(0.35).removeInteractive();
        }
      };
      updateBtn();

      btn.on('pointerover', () => {
        if (currentGold >= item.cost) btn.setStyle({ color: '#000000', backgroundColor: '#ffee88' });
      });
      btn.on('pointerout', () => {
        btn.setStyle({ color: '#111111', backgroundColor: '#ffe066' });
      });

      btn.on('pointerdown', () => {
        if (currentGold < item.cost) return;

        // Apply deduction locally for immediate UI feedback.
        currentGold -= item.cost;
        goldLabel.setText(`${t('hud.gold')}: ${currentGold}`);

        // Notify GameScene (which is paused but its event bus still fires).
        // GameScene applies the gold deduction and the gameplay effect.
        this.scene.get('GameScene').events.emit('shop-purchased', {
          effect: item.effect,
          value:  item.value,
          cost:   item.cost,
        });

        // Re-evaluate all buttons after the purchase.
        this.events.emit('gold-changed');
      });

      // Re-evaluate affordability whenever gold changes.
      this.events.on('gold-changed', updateBtn);
    }

    // ── Footer ─────────────────────────────────────────────────────────────────
    this.add
      .text(cx, cy + panelH / 2 - 18, t('credits.close_hint'), {
        fontSize: '10px',
        color:    '#3a5a3a',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);

    // ── Close button ──────────────────────────────────────────────────────────
    const closeBtn = this.add
      .text(cx + panelW / 2 - 14, top + 14, '✕', {
        fontSize: '14px',
        color:    '#7a9a7a',
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
    const callerKey = (this.scene.settings.data as { callerKey?: string }).callerKey ?? 'GameScene';
    this.scene.resume(callerKey);
  }
}
