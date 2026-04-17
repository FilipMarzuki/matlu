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
 *   nav-toggle-decor      → GameScene toggles world decorations visibility
 *   nav-toggle-animals    → GameScene toggles wildlife visibility
 *   nav-toggle-play-mode  → CombatArenaScene toggles hero player mode
 *   nav-reset-arena        → CombatArenaScene resets the fight
 */
export class NavScene extends Phaser.Scene {
  static readonly KEY = 'NavScene';

  private freeCamBtn!:  Phaser.GameObjects.Text;
  private elevMapBtn!:  Phaser.GameObjects.Text;
  private biomeMapBtn!: Phaser.GameObjects.Text;
  private decorBtn!:    Phaser.GameObjects.Text;
  private animalsBtn!:  Phaser.GameObjects.Text;
  private playAiBtn!:   Phaser.GameObjects.Text;
  private resetBtn!:    Phaser.GameObjects.Text;
  private freeCamGroup!: Phaser.GameObjects.Group;
  private arenaGroup!:   Phaser.GameObjects.Group;

  // Tracks the active view mode so the feedback widget can use the right
  // placeholder text and build the correct context JSON on submit.
  private currentMode: 'wilderview' | 'arena' = 'wilderview';

  // Feedback widget — DOM elements appended to document.body and removed on shutdown.
  private feedbackWrapper: HTMLDivElement | null    = null;
  private feedbackInput:   HTMLInputElement | null  = null;
  private feedbackSendBtn: HTMLButtonElement | null = null;
  private feedbackStatus:  HTMLDivElement | null    = null;

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

    // ── World Dev button ──────────────────────────────────────────────────────
    const wvActive = this.add.text(cx, btnY0, 'World Dev', {
      fontSize: '14px', color: '#aaffaa',
      backgroundColor: '#33330088',
      padding: { x: 10, y: 6 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5).setName('wv-active');

    const wvInactive = inactiveStyle('World Dev')
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

    // Toggle world decorations (trees, paths, zone tints) on/off.
    this.decorBtn = this.add.text(cx, divY + 154, 'Decor', {
      fontSize: '13px', color: '#ffcc88',
      backgroundColor: '#332200aa',
      padding: { x: 10, y: 5 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerup',   () => this.game.events.emit('nav-toggle-decor'))
      .on('pointerover', () => this.decorBtn.setStyle({ color: '#ffeecc' }))
      .on('pointerout',  () => this.decorBtn.setStyle({ color: this.decorBtn.text.includes('✓') ? '#ffffff' : '#ffcc88' }));

    // Toggle wildlife (rabbits, deer, hare, fox) visibility on/off.
    this.animalsBtn = this.add.text(cx, divY + 198, 'Animals', {
      fontSize: '13px', color: '#aaffaa',
      backgroundColor: '#002200aa',
      padding: { x: 10, y: 5 },
      fixedWidth: BTN_W, align: 'center',
    }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerup',   () => this.game.events.emit('nav-toggle-animals'))
      .on('pointerover', () => this.animalsBtn.setStyle({ color: '#ccffcc' }))
      .on('pointerout',  () => this.animalsBtn.setStyle({ color: this.animalsBtn.text.includes('✓') ? '#ffffff' : '#aaffaa' }));

    const freeCamHint = this.add.text(cx, H - 80, 'WASD — pan\nScroll — zoom', {
      fontSize: '10px', color: '#3a5a3a', align: 'center',
    }).setOrigin(0.5, 1);

    this.freeCamGroup = this.add.group([
      this.freeCamBtn, this.elevMapBtn, this.biomeMapBtn,
      this.decorBtn, this.animalsBtn, freeCamHint,
    ]);

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

    // ── Feedback widget ────────────────────────────────────────────────────────
    // DOM <input> + button appended to document.body and positioned with
    // CSS `position:fixed` so it sticks to the nav panel regardless of canvas
    // scale. Phaser's keyboard events are blocked while the input is focused by
    // calling stopPropagation() on keydown/keyup — Phaser listens at the window
    // level in bubble phase, so stopping propagation on the focused element
    // prevents WASD/space/etc. from reaching the game scenes.
    this.buildFeedbackWidget();

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

    this.game.events.on('nav-decor-changed', (visible: boolean) => {
      this.decorBtn.setText(visible ? 'Decor ✓' : 'Decor');
      this.decorBtn.setStyle({ color: visible ? '#ffffff' : '#ffcc88' });
    }, this);

    this.game.events.on('nav-animals-changed', (visible: boolean) => {
      this.animalsBtn.setText(visible ? 'Animals ✓' : 'Animals');
      this.animalsBtn.setStyle({ color: visible ? '#ffffff' : '#aaffaa' });
    }, this);

    // Clean up listeners and DOM elements when this scene shuts down.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('nav-mode-change', undefined, this);
      this.game.events.off('nav-free-cam-changed', undefined, this);
      this.game.events.off('nav-play-mode-changed', undefined, this);
      this.game.events.off('nav-dev-overlay-changed', undefined, this);
      this.game.events.off('nav-decor-changed', undefined, this);
      this.game.events.off('nav-animals-changed', undefined, this);
      this.destroyFeedbackWidget();
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
    this.currentMode = mode;

    // Update feedback input placeholder to match the active context.
    if (this.feedbackInput) {
      this.feedbackInput.placeholder =
        mode === 'arena' ? 'Combat feedback...' : 'Feedback...';
    }

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
    // Align the widget with the nav panel (160 px wide, right edge of viewport).
    // BTN_W = 132 px → right:14px + width:132px fills the panel's button column.
    wrapper.style.cssText = [
      'position:fixed',
      'right:14px',
      'bottom:135px',
      'width:132px',
      'display:flex',
      'flex-direction:column',
      'gap:4px',
      'z-index:100',
    ].join(';');

    const input = document.createElement('input');
    input.type        = 'text';
    input.placeholder = this.currentMode === 'arena' ? 'Combat feedback...' : 'Feedback...';
    input.maxLength   = 500;
    input.style.cssText = [
      'background:rgba(10,19,10,0.85)',
      'color:#f0ead6',
      'border:1px solid #3a5a3a',
      'padding:5px 8px',
      'font-size:12px',
      'box-sizing:border-box',
      'outline:none',
      'width:100%',
    ].join(';');

    // Stop keydown/keyup from bubbling to Phaser's window-level listener.
    // Phaser registers keyboard handlers with addEventListener(…, false) on
    // window, so events propagate: input → … → window. stopPropagation() on
    // the input element cuts the chain before it reaches Phaser, preventing
    // WASD / space / etc. from firing game actions while the player types.
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { void this.submitFeedback(); }
    });
    input.addEventListener('keyup', (e) => { e.stopPropagation(); });

    const sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send';
    sendBtn.style.cssText = [
      'background:rgba(17,17,34,0.67)',
      'color:#88aaff',
      'border:1px solid #3a5a3a',
      'padding:5px',
      'font-size:12px',
      'cursor:pointer',
      'width:100%',
    ].join(';');
    sendBtn.addEventListener('mouseover', () => { sendBtn.style.color = '#bbddff'; });
    sendBtn.addEventListener('mouseout',  () => { sendBtn.style.color = '#88aaff'; });
    sendBtn.addEventListener('click',     () => { void this.submitFeedback(); });

    // One-line status area — shows "Sent!" for 2 s after a successful submit.
    const status = document.createElement('div');
    status.style.cssText = 'color:#aaffaa;font-size:12px;text-align:center;height:16px;';

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
   * Called from the SHUTDOWN event handler to prevent leaks when the scene
   * restarts (e.g. returning to main menu and re-entering the arena).
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
   *
   * Uses a duck-typed interface rather than importing CombatArenaScene to
   * avoid a circular module dependency (CombatArenaScene → NavScene → …).
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
   *
   * Disables the input and button while the async Supabase insert is in
   * flight (prevents double-submits). Re-enables on both success and error.
   * Shows a brief "Sent!" confirmation on success.
   */
  private async submitFeedback(): Promise<void> {
    if (!this.feedbackInput || !this.feedbackSendBtn) return;
    const text = this.feedbackInput.value.trim();
    if (!text) return;

    this.feedbackInput.disabled  = true;
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
    } finally {
      // Always re-enable so a network error doesn't lock out the user.
      this.feedbackInput.disabled  = false;
      this.feedbackSendBtn.disabled = false;
    }
  }
}
