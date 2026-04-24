import * as Phaser from 'phaser';
import { insertFeedback, GAME_VERSION } from '../lib/feedback';

/**
 * Minimal shape expected from CombatArenaScene.getArenaState().
 * Defined here as an interface to avoid a circular import:
 * CombatArenaScene already imports NavScene, so NavScene must NOT import
 * CombatArenaScene directly.
 */
interface ArenaStateSnapshot {
  waveNumber:   number;
  enemiesAlive: number;
  playerHp:     number;
}

/** Scene key used to look up CombatArenaScene at runtime without importing it. */
const ARENA_SCENE_KEY = 'CombatArenaScene';

/**
 * NavScene — persistent right-side navigation panel with collapsible layer tree.
 *
 * Layer tree structure (WilderView mode):
 *   ▾ Camera      → Free Cam
 *   ▾ Overlays    → Elev Map, Biome Map
 *   ▾ World       → Decor, Animals, Paths, Zones, Settlements, Fog
 *
 * Clicking a section header collapses / expands it; rebuildLayout() repositions
 * all visible items so they pack tightly with no gaps.
 *
 * Communication with the underlying game scene is via the Phaser game event bus:
 *   Emits:   nav-toggle-*, nav-goto-*, nav-reset-arena, nav-toggle-play-mode
 *   Listens: nav-*-changed (state feedback from game scenes)
 */
export class NavScene extends Phaser.Scene {
  static readonly KEY = 'NavScene';

  // ── Section open/collapsed state ────────────────────────────────────────────
  private openSections = { camera: true, overlays: false, world: true };

  // ── Layer tree button references ────────────────────────────────────────────
  private freeCamBtn!:     Phaser.GameObjects.Text;
  private elevMapBtn!:     Phaser.GameObjects.Text;
  private biomeMapBtn!:    Phaser.GameObjects.Text;
  private decorBtn!:       Phaser.GameObjects.Text;
  private animalsBtn!:     Phaser.GameObjects.Text;
  private pathsBtn!:       Phaser.GameObjects.Text;
  private zonesBtn!:       Phaser.GameObjects.Text;
  private settlementsBtn!: Phaser.GameObjects.Text;
  private fogBtn!:         Phaser.GameObjects.Text;
  private isoGridBtn!:     Phaser.GameObjects.Text;

  // ── Section header references (needed by rebuildLayout) ─────────────────────
  private cameraHeader!:   Phaser.GameObjects.Text;
  private overlaysHeader!: Phaser.GameObjects.Text;
  private worldHeader!:    Phaser.GameObjects.Text;

  // Items per section — drives rebuildLayout visibility + positioning
  private cameraItems:  Phaser.GameObjects.Text[] = [];
  private overlayItems: Phaser.GameObjects.Text[] = [];
  private worldItems:   Phaser.GameObjects.Text[] = [];

  // All WilderView objects (tree + hint) — toggled on/off when switching modes
  private wilderViewGroup!: Phaser.GameObjects.Group;

  // ── Arena-only controls ─────────────────────────────────────────────────────
  private playAiBtn!:  Phaser.GameObjects.Text;
  private resetBtn!:   Phaser.GameObjects.Text;
  private arenaGroup!: Phaser.GameObjects.Group;

  // Y coordinate where the layer tree begins (below the view-mode divider)
  private treeStartY = 0;

  // ── Mode tracking ───────────────────────────────────────────────────────────
  private currentMode: 'wilderview' | 'arena' = 'wilderview';
  private initialMode: 'wilderview' | 'arena' = 'wilderview';

  // ── Feedback widget (DOM) ───────────────────────────────────────────────────
  private feedbackWrapper:  HTMLDivElement | null    = null;
  private feedbackInput:    HTMLInputElement | null  = null;
  private feedbackSendBtn:  HTMLButtonElement | null = null;
  private feedbackStatus:   HTMLDivElement | null    = null;

  constructor() {
    super({ key: NavScene.KEY });
  }

  init(data?: { mode?: 'wilderview' | 'arena' }): void {
    this.initialMode = data?.mode ?? 'wilderview';
  }

  create(): void {
    const W   = this.scale.width;
    const H   = this.scale.height;
    const PW  = 160;      // panel width
    const cx  = W - PW / 2;
    const BTN_W = PW - 28;

    // ── Background panel ───────────────────────────────────────────────────────
    this.add.rectangle(cx, H / 2, PW, H, 0x0a130a, 0.92);

    // ── Menu link ─────────────────────────────────────────────────────────────
    this.add.text(cx, H * 0.05, '← Menu', {
      fontSize: '11px', color: '#3a5a3a',
    }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', function(this: Phaser.GameObjects.Text) { this.setStyle({ color: '#6a9a6a' }); })
      .on('pointerout',  function(this: Phaser.GameObjects.Text) { this.setStyle({ color: '#3a5a3a' }); })
      .on('pointerup',   () => { window.location.href = '/menu'; });

    const btnY0  = H * 0.12;
    const btnGap = 46;

    // ── View-mode selector (World Dev / Arena tabs) ────────────────────────────
    const wvActive = this.add.text(cx, btnY0, 'World Dev', {
      fontSize: '14px', color: '#aaffaa',
      backgroundColor: '#33330088',
      padding: { x: 10, y: 6 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5).setName('wv-active');

    const wvInactive = this.add.text(cx, btnY0, 'World Dev', {
      fontSize: '14px', color: '#ffe066',
      backgroundColor: '#33330088',
      padding: { x: 10, y: 6 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5).setName('wv-inactive')
      .setInteractive({ useHandCursor: true })
      .on('pointerup',   () => this.game.events.emit('nav-goto-wilderview'))
      .on('pointerover', () => wvInactive.setStyle({ color: '#ffffff' }))
      .on('pointerout',  () => wvInactive.setStyle({ color: '#ffe066' }));

    const arenaActive = this.add.text(cx, btnY0 + btnGap, 'Arena', {
      fontSize: '14px', color: '#aaffaa',
      backgroundColor: '#33330088',
      padding: { x: 10, y: 6 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5).setName('arena-active');

    const arenaInactive = this.add.text(cx, btnY0 + btnGap, 'Arena', {
      fontSize: '14px', color: '#ffe066',
      backgroundColor: '#33330088',
      padding: { x: 10, y: 6 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5).setName('arena-inactive')
      .setInteractive({ useHandCursor: true })
      .on('pointerup',   () => this.game.events.emit('nav-goto-arena'))
      .on('pointerover', () => arenaInactive.setStyle({ color: '#ffffff' }))
      .on('pointerout',  () => arenaInactive.setStyle({ color: '#ffe066' }));

    // Thin divider below the tabs
    const divY = btnY0 + btnGap * 2 + 10;
    this.add.rectangle(cx, divY, BTN_W, 1, 0x3a5a3a, 0.6);
    this.treeStartY = divY + 14;

    // ── Layer tree builder helpers ─────────────────────────────────────────────

    /**
     * Create a collapsible section header.
     * Clicking it toggles openSections[section] and calls rebuildLayout().
     */
    const mkHeader = (label: string, section: keyof typeof this.openSections): Phaser.GameObjects.Text => {
      const icon = this.openSections[section] ? '▾ ' : '▸ ';
      const t = this.add.text(cx, 0, icon + label, {
        fontSize: '11px', color: '#7aaa7a',
        padding: { x: 10, y: 3 },
        fixedWidth: BTN_W, align: 'left',
      }).setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerup', () => {
          this.openSections[section] = !this.openSections[section];
          t.setText((this.openSections[section] ? '▾ ' : '▸ ') + label);
          this.rebuildLayout();
        })
        .on('pointerover', () => t.setStyle({ color: '#aaffaa' }))
        .on('pointerout',  () => t.setStyle({ color: '#7aaa7a' }));
      return t;
    };

    /**
     * Create a layer toggle button.
     * pointerout restores the active (✓) colour if the layer is on, otherwise base colour.
     */
    const mkBtn = (
      label: string,
      baseColor: string,
      bg: string,
      onUp: () => void,
      startActive = false,
    ): Phaser.GameObjects.Text => {
      const initLabel = startActive ? label + ' ✓' : label;
      const initColor = startActive ? '#ffffff'     : baseColor;
      const t = this.add.text(cx, 0, initLabel, {
        fontSize: '12px', color: initColor,
        backgroundColor: bg,
        padding: { x: 10, y: 4 },
        fixedWidth: BTN_W, align: 'center',
      }).setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerup', onUp)
        .on('pointerover', () => t.setStyle({ color: '#ffffff' }))
        .on('pointerout',  () => {
          t.setStyle({ color: t.text.includes('✓') ? '#ffffff' : baseColor });
        });
      return t;
    };

    // ── Camera section ─────────────────────────────────────────────────────────
    this.cameraHeader = mkHeader('Camera', 'camera');
    this.freeCamBtn   = mkBtn('Free Cam', '#88aaff', '#111122aa',
      () => this.game.events.emit('nav-toggle-free-cam'));
    this.cameraItems  = [this.freeCamBtn];

    // ── Overlays section ───────────────────────────────────────────────────────
    this.overlaysHeader = mkHeader('Overlays', 'overlays');
    this.elevMapBtn     = mkBtn('Elev Map',  '#cc88ff', '#220033aa',
      () => this.game.events.emit('nav-toggle-elev-overlay'));
    this.biomeMapBtn    = mkBtn('Biome Map', '#88ffcc', '#002233aa',
      () => this.game.events.emit('nav-toggle-biome-overlay'));
    this.overlayItems   = [this.elevMapBtn, this.biomeMapBtn];

    // ── World section ──────────────────────────────────────────────────────────
    this.worldHeader    = mkHeader('World', 'world');
    // Decor (trees/rocks/flowers + particles) — starts hidden → no ✓
    this.decorBtn       = mkBtn('Decor',       '#ffcc88', '#332200aa',
      () => this.game.events.emit('nav-toggle-decor'));
    // Animals — start visible → show ✓
    this.animalsBtn     = mkBtn('Animals',     '#aaffaa', '#002200aa',
      () => this.game.events.emit('nav-toggle-animals'), true);
    // Paths — starts hidden
    this.pathsBtn       = mkBtn('Paths',       '#88ccff', '#001133aa',
      () => this.game.events.emit('nav-toggle-paths'));
    // Zones — starts hidden
    this.zonesBtn       = mkBtn('Zones',       '#ffaacc', '#220011aa',
      () => this.game.events.emit('nav-toggle-zones'));
    // Settlements — starts hidden
    this.settlementsBtn = mkBtn('Settlements', '#ffdd88', '#221100aa',
      () => this.game.events.emit('nav-toggle-settlements'));
    // Fog — starts visible → show ✓
    this.fogBtn         = mkBtn('Fog',         '#aaccff', '#112233aa',
      () => this.game.events.emit('nav-toggle-fog'), true);
    // Iso Grid — starts hidden → no ✓  (G key shortcut)
    this.isoGridBtn     = mkBtn('Iso Grid [G]','#ccddff', '#111133aa',
      () => this.game.events.emit('nav-toggle-iso-grid'));
    this.worldItems     = [
      this.decorBtn, this.animalsBtn, this.pathsBtn,
      this.zonesBtn, this.settlementsBtn, this.fogBtn, this.isoGridBtn,
    ];

    // Hint shown below the tree in WilderView mode
    const freeCamHint = this.add.text(cx, H - 80, 'WASD — pan\nScroll — zoom', {
      fontSize: '10px', color: '#3a5a3a', align: 'center',
    }).setOrigin(0.5, 1);

    // Group everything so applyMode() can show/hide the tree in one call
    this.wilderViewGroup = this.add.group([
      this.cameraHeader, ...this.cameraItems,
      this.overlaysHeader, ...this.overlayItems,
      this.worldHeader, ...this.worldItems,
      freeCamHint,
    ]);

    // ── Arena controls ─────────────────────────────────────────────────────────
    this.playAiBtn = this.add.text(cx, divY + 22, 'Play', {
      fontSize: '13px', color: '#88aaff',
      backgroundColor: '#111122aa',
      padding: { x: 10, y: 5 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerup',   () => this.game.events.emit('nav-toggle-play-mode'))
      .on('pointerover', () => this.playAiBtn.setStyle({ color: '#bbddff' }))
      .on('pointerout',  () => this.playAiBtn.setStyle({
        color: this.playAiBtn.text === 'AI' ? '#ffffff' : '#88aaff',
      }));

    // Design mode toggle — restarts arena with ?debug flag
    const designBtn = this.add.text(cx, divY + 44, 'Design', {
      fontSize: '13px', color: '#66ccaa',
      backgroundColor: '#112211aa',
      padding: { x: 10, y: 5 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.game.events.emit('nav-toggle-design'))
      .on('pointerover', () => designBtn.setStyle({ color: '#99ffcc' }))
      .on('pointerout',  () => designBtn.setStyle({ color: '#66ccaa' }));

    // Rebuild — full scene restart (regenerates dungeon + respawns hero)
    const rebuildBtn = this.add.text(cx, divY + 66, 'Rebuild', {
      fontSize: '13px', color: '#cc88ff',
      backgroundColor: '#110022aa',
      padding: { x: 10, y: 5 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerup',   () => this.game.events.emit('nav-rebuild-arena'))
      .on('pointerover', () => rebuildBtn.setStyle({ color: '#ddaaff' }))
      .on('pointerout',  () => rebuildBtn.setStyle({ color: '#cc88ff' }));

    this.resetBtn = this.add.text(cx, divY + 110, 'Reset', {
      fontSize: '13px', color: '#ff9966',
      backgroundColor: '#220011aa',
      padding: { x: 10, y: 5 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerup',   () => this.game.events.emit('nav-reset-arena'))
      .on('pointerover', () => this.resetBtn.setStyle({ color: '#ffcc99' }))
      .on('pointerout',  () => this.resetBtn.setStyle({ color: '#ff9966' }));

    const arenaHint = this.add.text(cx, H - 80,
      'WASD — move\nSpace — attack\nShift — dash\n(Play mode)', {
        fontSize: '10px', color: '#3a5a3a', align: 'center',
      }).setOrigin(0.5, 1);

    this.arenaGroup = this.add.group([this.playAiBtn, designBtn, rebuildBtn, this.resetBtn, arenaHint]);

    // ── Initial layout + mode ──────────────────────────────────────────────────
    this.rebuildLayout();
    this.applyMode(this.initialMode, { wvActive, wvInactive, arenaActive, arenaInactive });

    // ── Feedback widget ────────────────────────────────────────────────────────
    this.buildFeedbackWidget();

    // ── Game event listeners ───────────────────────────────────────────────────

    this.game.events.on('nav-mode-change', (mode: 'wilderview' | 'arena') => {
      this.applyMode(mode, { wvActive, wvInactive, arenaActive, arenaInactive });
    }, this);

    this.game.events.on('nav-free-cam-changed', (active: boolean) => {
      this.syncBtn(this.freeCamBtn, 'Free Cam', '#88aaff', active);
    }, this);

    this.game.events.on('nav-play-mode-changed', (active: boolean) => {
      this.playAiBtn.setText(active ? 'AI' : 'Play');
      this.playAiBtn.setStyle({ color: active ? '#ffffff' : '#88aaff' });
    }, this);

    // Dev overlay: only one can be active at a time
    this.game.events.on('nav-dev-overlay-changed', (mode: 'none' | 'elevation' | 'biome') => {
      this.syncBtn(this.elevMapBtn,  'Elev Map',  '#cc88ff', mode === 'elevation');
      this.syncBtn(this.biomeMapBtn, 'Biome Map', '#88ffcc', mode === 'biome');
    }, this);

    // Individual layer state feedback
    this.game.events.on('nav-decor-changed',       (v: boolean) => { this.syncBtn(this.decorBtn,       'Decor',       '#ffcc88', v); }, this);
    this.game.events.on('nav-animals-changed',     (v: boolean) => { this.syncBtn(this.animalsBtn,     'Animals',     '#aaffaa', v); }, this);
    this.game.events.on('nav-paths-changed',       (v: boolean) => { this.syncBtn(this.pathsBtn,       'Paths',       '#88ccff', v); }, this);
    this.game.events.on('nav-zones-changed',       (v: boolean) => { this.syncBtn(this.zonesBtn,       'Zones',       '#ffaacc', v); }, this);
    this.game.events.on('nav-settlements-changed', (v: boolean) => { this.syncBtn(this.settlementsBtn, 'Settlements', '#ffdd88', v); }, this);
    this.game.events.on('nav-fog-changed',         (v: boolean) => { this.syncBtn(this.fogBtn,         'Fog',         '#aaccff', v); }, this);
    this.game.events.on('nav-iso-grid-changed',    (v: boolean) => { this.syncBtn(this.isoGridBtn,     'Iso Grid [G]','#ccddff', v); }, this);

    // Clean up listeners and DOM elements when this scene shuts down.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('nav-mode-change',          undefined, this);
      this.game.events.off('nav-free-cam-changed',     undefined, this);
      this.game.events.off('nav-play-mode-changed',    undefined, this);
      this.game.events.off('nav-dev-overlay-changed',  undefined, this);
      this.game.events.off('nav-decor-changed',        undefined, this);
      this.game.events.off('nav-animals-changed',      undefined, this);
      this.game.events.off('nav-paths-changed',        undefined, this);
      this.game.events.off('nav-zones-changed',        undefined, this);
      this.game.events.off('nav-settlements-changed',  undefined, this);
      this.game.events.off('nav-fog-changed',          undefined, this);
      this.game.events.off('nav-iso-grid-changed',     undefined, this);
      this.destroyFeedbackWidget();
    });
  }

  /**
   * Reposition all layer tree items so they pack tightly with no gaps.
   * Called on create() and whenever a section header is clicked.
   *
   * Layout constants:
   *   SECT_H = 22 px — section header height (11 px font + 2×3 px padding)
   *   ITEM_H = 26 px — button row height    (12 px font + 2×4 px padding + 1 gap)
   *   GAP    = 6  px — vertical gap between sections
   */
  private rebuildLayout(): void {
    const cx     = this.scale.width - 80; // panel center X (W=800, PW=160 → 720)
    let   y      = this.treeStartY;
    const SECT_H = 22;
    const ITEM_H = 26;
    const GAP    = 6;

    const placeSection = (
      header: Phaser.GameObjects.Text,
      items:  Phaser.GameObjects.Text[],
      open:   boolean,
    ) => {
      header.setPosition(cx, y + SECT_H / 2);
      y += SECT_H;
      if (open) {
        for (const btn of items) {
          btn.setPosition(cx, y + ITEM_H / 2).setVisible(true);
          y += ITEM_H;
        }
      } else {
        for (const btn of items) btn.setVisible(false);
      }
      y += GAP;
    };

    placeSection(this.cameraHeader,   this.cameraItems,   this.openSections.camera);
    placeSection(this.overlaysHeader, this.overlayItems,  this.openSections.overlays);
    placeSection(this.worldHeader,    this.worldItems,    this.openSections.world);
  }

  /**
   * Update a toggle button's label and colour to reflect its current active state.
   * Active (on) → appends ✓ and uses white; inactive (off) → base label and base colour.
   */
  private syncBtn(
    btn:       Phaser.GameObjects.Text,
    baseLabel: string,
    baseColor: string,
    active:    boolean,
  ): void {
    btn.setText(active ? baseLabel + ' ✓' : baseLabel);
    btn.setStyle({ color: active ? '#ffffff' : baseColor });
  }

  /**
   * Switch between WilderView and Arena mode.
   * Shows/hides the view-mode tab buttons, the layer tree, and the arena controls.
   */
  private applyMode(
    mode: 'wilderview' | 'arena',
    btns: {
      wvActive:     Phaser.GameObjects.Text;
      wvInactive:   Phaser.GameObjects.Text;
      arenaActive:  Phaser.GameObjects.Text;
      arenaInactive: Phaser.GameObjects.Text;
    },
  ): void {
    this.currentMode = mode;

    if (this.feedbackInput) {
      this.feedbackInput.placeholder =
        mode === 'arena' ? 'Combat feedback...' : 'Feedback...';
    }

    const wv = mode === 'wilderview';
    btns.wvActive.setVisible(wv);
    btns.wvInactive.setVisible(!wv);
    btns.arenaActive.setVisible(!wv);
    btns.arenaInactive.setVisible(wv);

    // Show/hide the entire layer tree (WilderView) or the arena controls
    this.wilderViewGroup.getChildren().forEach(c =>
      (c as Phaser.GameObjects.Text).setVisible(wv));
    this.arenaGroup.getChildren().forEach(c =>
      (c as Phaser.GameObjects.Text).setVisible(!wv));

    // Visibility set above is a blanket show/hide; for items inside collapsed sections
    // the rebuildLayout visibility state must be restored.
    if (wv) {
      this.rebuildLayout();
      this.freeCamBtn.setText('Free Cam');
      this.freeCamBtn.setStyle({ color: '#88aaff' });
    } else {
      this.playAiBtn.setText('Play');
      this.playAiBtn.setStyle({ color: '#88aaff' });
    }
  }

  // ── Feedback widget ───────────────────────────────────────────────────────────

  /**
   * Build and append the feedback DOM widget.
   *
   * Why DOM and not Phaser Text + Graphics?
   * Phaser doesn't have a native text-input widget. The standard Phaser
   * pattern for chat/form input is to overlay an HTML <input> on the canvas.
   * `position:fixed` + right/bottom offsets keep it glued to the nav panel
   * regardless of RESIZE-mode canvas scaling.
   */
  private buildFeedbackWidget(): void {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = [
      'position:fixed',
      'right:14px',
      'bottom:90px',
      'width:132px',
      'display:flex',
      'flex-direction:column',
      'gap:5px',
      'z-index:100',
    ].join(';');

    const label = document.createElement('div');
    label.textContent = '✦ Feedback';
    label.style.cssText = [
      'color:#ffe066',
      'font-size:13px',
      'font-weight:bold',
      'text-align:center',
      'letter-spacing:0.5px',
    ].join(';');

    const input = document.createElement('input');
    input.type        = 'text';
    input.placeholder = this.currentMode === 'arena' ? 'Combat feedback...' : 'Feedback...';
    input.maxLength   = 500;
    input.style.cssText = [
      'background:rgba(10,19,10,0.92)',
      'color:#f0ead6',
      'border:1px solid #6a8a2a',
      'padding:7px 8px',
      'font-size:12px',
      'box-sizing:border-box',
      'outline:none',
      'width:100%',
      'border-radius:2px',
    ].join(';');

    // Stop keydown/keyup from bubbling to Phaser's window-level listener.
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { void this.submitFeedback(); }
    });
    input.addEventListener('keyup', (e) => { e.stopPropagation(); });

    const sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send Feedback';
    sendBtn.style.cssText = [
      'background:rgba(60,90,20,0.85)',
      'color:#ffe066',
      'border:1px solid #6a8a2a',
      'padding:7px',
      'font-size:12px',
      'font-weight:bold',
      'cursor:pointer',
      'width:100%',
      'border-radius:2px',
      'letter-spacing:0.3px',
    ].join(';');
    sendBtn.addEventListener('mouseover', () => {
      sendBtn.style.background = 'rgba(80,120,25,0.95)';
      sendBtn.style.color = '#ffffff';
    });
    sendBtn.addEventListener('mouseout',  () => {
      sendBtn.style.background = 'rgba(60,90,20,0.85)';
      sendBtn.style.color = '#ffe066';
    });
    sendBtn.addEventListener('click', () => { void this.submitFeedback(); });

    const status = document.createElement('div');
    status.style.cssText = 'color:#aaffaa;font-size:12px;text-align:center;height:16px;';

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    wrapper.appendChild(sendBtn);
    wrapper.appendChild(status);
    document.body.appendChild(wrapper);

    this.feedbackWrapper = wrapper;
    this.feedbackInput   = input;
    this.feedbackSendBtn = sendBtn;
    this.feedbackStatus  = status;
  }

  /**
   * Remove the feedback DOM widget from the page.
   * Called from the SHUTDOWN event handler to prevent leaks when the scene restarts.
   */
  private destroyFeedbackWidget(): void {
    this.feedbackWrapper?.remove();
    this.feedbackWrapper = null;
    this.feedbackInput   = null;
    this.feedbackSendBtn = null;
    this.feedbackStatus  = null;
  }

  /**
   * Read the current arena state for context metadata.
   * Uses a duck-typed interface to avoid a circular module dependency.
   */
  private buildContextJson(): string {
    if (this.currentMode === 'arena') {
      const rawScene: unknown = this.scene.get(ARENA_SCENE_KEY);
      const provider = rawScene as { getArenaState?(): ArenaStateSnapshot };
      const state = provider.getArenaState?.() ?? { waveNumber: 0, enemiesAlive: 0, playerHp: 0 };
      return JSON.stringify({
        scene_mode:    'arena',
        wave_number:   state.waveNumber,
        enemies_alive: state.enemiesAlive,
        player_hp:     state.playerHp,
      });
    }
    return JSON.stringify({ scene_mode: 'wilderview' });
  }

  /**
   * Submit the current input text as a feedback row.
   * Disables controls while the async insert is in flight; re-enables on completion.
   */
  private async submitFeedback(): Promise<void> {
    if (!this.feedbackInput || !this.feedbackSendBtn) return;
    const text = this.feedbackInput.value.trim();
    if (!text) return;

    this.feedbackInput.disabled   = true;
    this.feedbackSendBtn.disabled = true;

    try {
      await insertFeedback(text, GAME_VERSION, this.buildContextJson());
      this.feedbackInput.value = '';
      if (this.feedbackStatus) {
        this.feedbackStatus.textContent = 'Sent!';
        setTimeout(() => {
          if (this.feedbackStatus) this.feedbackStatus.textContent = '';
        }, 2000);
      }
    } catch (err) {
      console.error('Feedback submit error:', err);
      if (this.feedbackStatus) {
        this.feedbackStatus.style.color = '#ff9966';
        this.feedbackStatus.textContent = 'Error — try again';
        setTimeout(() => {
          if (this.feedbackStatus) {
            this.feedbackStatus.textContent = '';
            this.feedbackStatus.style.color = '#aaffaa';
          }
        }, 3000);
      }
    } finally {
      this.feedbackInput.disabled   = false;
      this.feedbackSendBtn.disabled = false;
    }
  }
}
