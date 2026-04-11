import Phaser from 'phaser';

/**
 * NavScene — persistent right-side navigation panel.
 *
 * Launched as an overlay by GameScene and CombatArenaScene. Because it has its
 * own scene camera (no zoom, no scroll), its UI elements are never culled — the
 * main game scene's zoom=3 camera would cull scrollFactor(0) elements that are
 * outside the small world-space view window.
 *
 * Communication with the underlying game scene is via the Phaser game event bus
 * (`this.game.events`) so the two scenes stay decoupled:
 *
 *   nav-mode-change   → NavScene updates which mode button is highlighted
 *   nav-goto-arena    → CombatArenaScene is started
 *   nav-goto-wilderview → GameScene is started
 *   nav-free-cam-changed (bool) → NavScene updates the Free Cam button label
 *   nav-play-mode-changed (bool) → NavScene updates the Play/AI button label
 *   nav-toggle-free-cam   → GameScene toggles free-fly camera
 *   nav-toggle-play-mode  → CombatArenaScene toggles hero player mode
 *   nav-reset-arena        → CombatArenaScene resets the fight
 */
export class NavScene extends Phaser.Scene {
  static readonly KEY = 'NavScene';

  private freeCamBtn!:  Phaser.GameObjects.Text;
  private elevMapBtn!:  Phaser.GameObjects.Text;
  private biomeMapBtn!: Phaser.GameObjects.Text;
  private playAiBtn!:   Phaser.GameObjects.Text;
  private resetBtn!:    Phaser.GameObjects.Text;
  private freeCamGroup!: Phaser.GameObjects.Group;
  private arenaGroup!:   Phaser.GameObjects.Group;

  // Initial mode passed via scene.launch(NavScene.KEY, { mode }) so the panel
  // shows the correct active button immediately without a frame-late event.
  private initialMode: 'wilderview' | 'arena' = 'wilderview';

  constructor() {
    super({ key: NavScene.KEY });
  }

  init(data?: { mode?: 'wilderview' | 'arena' }): void {
    this.initialMode = data?.mode ?? 'wilderview';
  }

  create(): void {
    const W  = this.scale.width;
    const H  = this.scale.height;
    const PW = 160;      // panel width
    const cx = W - PW / 2;
    const BTN_W = PW - 28;

    // ── Background panel ───────────────────────────────────────────────────────
    this.add
      .rectangle(cx, H / 2, PW, H, 0x0a130a, 0.92);

    // ── Title ─────────────────────────────────────────────────────────────────
    this.add.text(cx, H * 0.08, 'matlu', {
      fontSize: '22px', color: '#f0ead6', fontStyle: 'bold',
    }).setOrigin(0.5);

    const btnY0 = H * 0.22;
    const btnGap = 46;

    const inactiveStyle = (label: string) => this.add.text(cx, 0, label, {
      fontSize: '14px', color: '#ffe066',
      backgroundColor: '#33330088',
      padding: { x: 10, y: 6 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5);

    const activeStyle = (label: string) => this.add.text(cx, 0, label, {
      fontSize: '14px', color: '#aaffaa',
      backgroundColor: '#33330088',
      padding: { x: 10, y: 6 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5);

    // ── WilderView button ──────────────────────────────────────────────────────
    const wvActive = this.add.text(cx, btnY0, 'WilderView', {
      fontSize: '14px', color: '#aaffaa',
      backgroundColor: '#33330088',
      padding: { x: 10, y: 6 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5).setName('wv-active');

    const wvInactive = inactiveStyle('WilderView')
      .setY(btnY0).setName('wv-inactive')
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.game.events.emit('nav-goto-wilderview'))
      .on('pointerover', () => wvInactive.setStyle({ color: '#ffffff' }))
      .on('pointerout',  () => wvInactive.setStyle({ color: '#ffe066' }));

    // ── Arena button ───────────────────────────────────────────────────────────
    const arenaActive = activeStyle('Arena').setY(btnY0 + btnGap).setName('arena-active');

    const arenaInactive = inactiveStyle('Arena')
      .setY(btnY0 + btnGap).setName('arena-inactive')
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.game.events.emit('nav-goto-arena'))
      .on('pointerover', () => arenaInactive.setStyle({ color: '#ffffff' }))
      .on('pointerout',  () => arenaInactive.setStyle({ color: '#ffe066' }));

    // Start in WilderView mode — setMode() adjusts visibility.
    wvActive.setVisible(true);
    wvInactive.setVisible(false);
    arenaActive.setVisible(false);
    arenaInactive.setVisible(true);

    // ── Divider ────────────────────────────────────────────────────────────────
    const divY = btnY0 + btnGap * 2 + 10;
    this.add.rectangle(cx, divY, BTN_W, 1, 0x3a5a3a, 0.6);

    // ── WilderView-only controls (Free Cam + Dev overlays) ────────────────────
    this.freeCamBtn = this.add.text(cx, divY + 22, 'Free Cam', {
      fontSize: '13px', color: '#88aaff',
      backgroundColor: '#111122aa',
      padding: { x: 10, y: 5 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerup',   () => this.game.events.emit('nav-toggle-free-cam'))
      .on('pointerover', () => this.freeCamBtn.setStyle({ color: '#bbddff' }))
      .on('pointerout',  () => this.freeCamBtn.setStyle({ color: this.freeCamBtn.text.includes('✓') ? '#ffffff' : '#88aaff' }));

    // Dev overlay buttons — toggling elevation heatmap or biome colour map.
    // Each acts as a toggle: clicking the active mode turns it off.
    this.elevMapBtn = this.add.text(cx, divY + 66, 'Elev Map', {
      fontSize: '13px', color: '#cc88ff',
      backgroundColor: '#220033aa',
      padding: { x: 10, y: 5 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerup',   () => this.game.events.emit('nav-toggle-elev-overlay'))
      .on('pointerover', () => this.elevMapBtn.setStyle({ color: '#eeccff' }))
      .on('pointerout',  () => this.elevMapBtn.setStyle({ color: this.elevMapBtn.text.includes('✓') ? '#ffffff' : '#cc88ff' }));

    this.biomeMapBtn = this.add.text(cx, divY + 110, 'Biome Map', {
      fontSize: '13px', color: '#88ffcc',
      backgroundColor: '#002233aa',
      padding: { x: 10, y: 5 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerup',   () => this.game.events.emit('nav-toggle-biome-overlay'))
      .on('pointerover', () => this.biomeMapBtn.setStyle({ color: '#ccffee' }))
      .on('pointerout',  () => this.biomeMapBtn.setStyle({ color: this.biomeMapBtn.text.includes('✓') ? '#ffffff' : '#88ffcc' }));

    const freeCamHint = this.add.text(cx, H - 80, 'WASD — pan\nScroll — zoom', {
      fontSize: '10px', color: '#3a5a3a', align: 'center',
    }).setOrigin(0.5, 1);

    this.freeCamGroup = this.add.group([this.freeCamBtn, this.elevMapBtn, this.biomeMapBtn, freeCamHint]);

    // ── Arena-only controls (Play/AI, Reset) ───────────────────────────────────
    this.playAiBtn = this.add.text(cx, divY + 22, 'Play', {
      fontSize: '13px', color: '#88aaff',
      backgroundColor: '#111122aa',
      padding: { x: 10, y: 5 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerup',   () => this.game.events.emit('nav-toggle-play-mode'))
      .on('pointerover', () => this.playAiBtn.setStyle({ color: '#bbddff' }))
      .on('pointerout',  () => this.playAiBtn.setStyle({ color: this.playAiBtn.text === 'AI' ? '#ffffff' : '#88aaff' }));

    this.resetBtn = this.add.text(cx, divY + 66, 'Reset', {
      fontSize: '13px', color: '#ff9966',
      backgroundColor: '#220011aa',
      padding: { x: 10, y: 5 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerup',   () => this.game.events.emit('nav-reset-arena'))
      .on('pointerover', () => this.resetBtn.setStyle({ color: '#ffcc99' }))
      .on('pointerout',  () => this.resetBtn.setStyle({ color: '#ff9966' }));

    const arenaHint = this.add.text(cx, H - 80, 'WASD — move\nSpace — attack\nShift — dash\n(Play mode)', {
      fontSize: '10px', color: '#3a5a3a', align: 'center',
    }).setOrigin(0.5, 1);

    this.arenaGroup = this.add.group([this.playAiBtn, this.resetBtn, arenaHint]);

    // Apply initial mode — set via launch data so it's correct on the first frame.
    this.applyMode(this.initialMode, { wvActive, wvInactive, arenaActive, arenaInactive });

    // ── Game event listeners ───────────────────────────────────────────────────

    this.game.events.on('nav-mode-change', (mode: 'wilderview' | 'arena') => {
      this.applyMode(mode, { wvActive, wvInactive, arenaActive, arenaInactive });
    }, this);

    this.game.events.on('nav-free-cam-changed', (active: boolean) => {
      this.freeCamBtn.setText(active ? 'Free Cam ✓' : 'Free Cam');
      this.freeCamBtn.setStyle({ color: active ? '#ffffff' : '#88aaff' });
    }, this);

    this.game.events.on('nav-play-mode-changed', (active: boolean) => {
      this.playAiBtn.setText(active ? 'AI' : 'Play');
      this.playAiBtn.setStyle({ color: active ? '#ffffff' : '#88aaff' });
    }, this);

    // GameScene notifies us when the dev overlay mode changes so we can mark the
    // active button with a ✓ and reset the inactive one.
    this.game.events.on('nav-dev-overlay-changed', (mode: 'none' | 'elevation' | 'biome') => {
      const elevOn  = mode === 'elevation';
      const biomeOn = mode === 'biome';
      this.elevMapBtn.setText( elevOn  ? 'Elev Map ✓' : 'Elev Map');
      this.elevMapBtn.setStyle({ color: elevOn  ? '#ffffff' : '#cc88ff' });
      this.biomeMapBtn.setText(biomeOn ? 'Biome Map ✓' : 'Biome Map');
      this.biomeMapBtn.setStyle({ color: biomeOn ? '#ffffff' : '#88ffcc' });
    }, this);

    // Clean up listeners when this scene shuts down.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('nav-mode-change', undefined, this);
      this.game.events.off('nav-free-cam-changed', undefined, this);
      this.game.events.off('nav-play-mode-changed', undefined, this);
      this.game.events.off('nav-dev-overlay-changed', undefined, this);
    });
  }

  private applyMode(
    mode: 'wilderview' | 'arena',
    btns: {
      wvActive:     Phaser.GameObjects.Text;
      wvInactive:   Phaser.GameObjects.Text;
      arenaActive:  Phaser.GameObjects.Text;
      arenaInactive: Phaser.GameObjects.Text;
    },
  ): void {
    const wv = mode === 'wilderview';
    btns.wvActive.setVisible(wv);
    btns.wvInactive.setVisible(!wv);
    btns.arenaActive.setVisible(!wv);
    btns.arenaInactive.setVisible(wv);

    this.freeCamGroup.getChildren().forEach(c =>
      (c as Phaser.GameObjects.Text).setVisible(wv));
    this.arenaGroup.getChildren().forEach(c =>
      (c as Phaser.GameObjects.Text).setVisible(!wv));

    // Reset dynamic button states when switching modes.
    if (wv) {
      this.freeCamBtn.setText('Free Cam');
      this.freeCamBtn.setStyle({ color: '#88aaff' });
    } else {
      this.playAiBtn.setText('Play');
      this.playAiBtn.setStyle({ color: '#88aaff' });
    }
  }
}
