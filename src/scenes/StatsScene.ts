import Phaser from 'phaser';
import { t } from '../lib/i18n';
import { fetchMatluLeaderboard } from '../lib/matluRuns';
import type { MatluRun } from '../types/database.types';

/**
 * StatsScene — leaderboard overlay showing the top 10 runs from Supabase.
 *
 * ## Scene lifecycle (overlay pattern)
 * The caller calls `scene.pause()` then `scene.launch('StatsScene', callerKey)`.
 * When the player closes this scene, `close()` stops it and resumes the caller.
 * This is the same pattern used by CreditsScene and SettingsScene — it keeps
 * the background (MainMenu, arena preview) visible and frozen underneath.
 *
 * ## Async fetch inside create()
 * Phaser's `create()` must return synchronously, but you can start async work
 * inside it. We show a "Loading…" placeholder, then replace it with data (or an
 * error message) once the Supabase fetch resolves. A `_shutdown` flag prevents
 * crashing if the player closes the scene before the network responds.
 *
 * ## Graceful Supabase fallback
 * `fetchMatluLeaderboard` returns `null` when Supabase isn't configured (e.g.
 * local dev without a .env file). The scene handles that case without errors.
 */
export class StatsScene extends Phaser.Scene {
  /**
   * True once the scene has been stopped.
   * Guards the async Supabase callback from touching a destroyed scene.
   */
  private _shutdown = false;

  constructor() {
    super({ key: 'StatsScene' });
  }

  create(): void {
    // Listen for the scene shutdown event so the async callback can bail out.
    // Phaser.Scenes.Events.SHUTDOWN fires whenever scene.stop() is called.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this._shutdown = true;
    });

    const { width, height } = this.cameras.main;
    const cx = width  / 2;
    const cy = height / 2;

    // ── Backdrop ──────────────────────────────────────────────────────────────
    // Full-screen semi-transparent rectangle; clicking outside the panel closes
    // the overlay. setScrollFactor(0) pins it to the camera so it doesn't drift
    // if the background scene has a scrolling camera.
    this.add
      .rectangle(cx, cy, width, height, 0x000000, 0.78)
      .setScrollFactor(0)
      .setDepth(800)
      .setInteractive()
      .on('pointerdown', () => this.close());

    // ── Panel ─────────────────────────────────────────────────────────────────
    // Solid panel with a slightly higher depth than the backdrop. setInteractive()
    // here swallows pointer events so clicks on the panel don't fall through to
    // the backdrop and accidentally dismiss the overlay.
    const panelW = 420;
    const panelH = 310;
    this.add
      .rectangle(cx, cy, panelW, panelH, 0x111a11, 0.95)
      .setScrollFactor(0)
      .setDepth(801)
      .setInteractive();

    // Subtle hairline border drawn with Graphics — Text objects can't have
    // outlines, so we draw a stroked rect on a separate Graphics layer.
    const border = this.add.graphics().setScrollFactor(0).setDepth(802);
    border.lineStyle(1, 0xffffff, 0.12);
    border.strokeRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH);

    // ── Title ─────────────────────────────────────────────────────────────────
    this.add
      .text(cx, cy - panelH / 2 + 22, t('stats.title'), {
        fontSize: '20px',
        color: '#f0ead6',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);

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

    // ── Loading placeholder ───────────────────────────────────────────────────
    // Destroyed once data arrives; replaced with the table or an error/empty msg.
    const placeholder = this.add
      .text(cx, cy + 10, t('stats.loading'), {
        fontSize: '13px',
        color: '#7a9a7a',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);

    // ── Hint ──────────────────────────────────────────────────────────────────
    this.add
      .text(cx, cy + panelH / 2 - 14, t('credits.close_hint'), {
        fontSize: '10px',
        color: '#3a5a3a',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);

    // ── Leaderboard fetch ─────────────────────────────────────────────────────
    // `void` explicitly discards the returned Promise — we handle results inside
    // .then() and don't need to await the outer call.
    void fetchMatluLeaderboard(10).then((result) => {
      // Guard: scene was closed while we were waiting for the network response.
      if (this._shutdown) return;

      placeholder.destroy();

      if (!result) {
        // Supabase not configured (missing VITE_SUPABASE_* env vars).
        this.showMessage(cx, cy + 10, t('stats.no_scores'));
        return;
      }

      const { data, error } = result;
      if (error || !data) {
        this.showMessage(cx, cy + 10, t('stats.error'), '#f08080');
        return;
      }
      if (data.length === 0) {
        this.showMessage(cx, cy + 10, t('stats.no_scores'));
        return;
      }

      // Table top starts just below the title area.
      this.renderTable(cx, cy - panelH / 2 + 56, panelW, data);
    });
  }

  /** Utility: display a single centred message (empty-state or error). */
  private showMessage(cx: number, cy: number, msg: string, color = '#7a9a7a'): void {
    this.add
      .text(cx, cy, msg, { fontSize: '13px', color })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);
  }

  /**
   * Render a fixed-column leaderboard table.
   *
   * Phaser has no built-in table widget, so we position individual Text objects
   * at fixed x offsets to simulate columns. For numeric columns (score, time)
   * `setOrigin(1, 0)` anchors the text from its right edge — the same effect as
   * CSS `text-align: right` — so numbers align regardless of their digit count.
   *
   * @param cx      Horizontal centre of the panel
   * @param startY  Top y of the header row
   * @param panelW  Panel width, used to compute right-edge column positions
   * @param runs    Sorted array of run rows from Supabase
   */
  private renderTable(cx: number, startY: number, panelW: number, runs: MatluRun[]): void {
    const rowH = 22;

    // Column x positions. Left columns use left-origin; right columns use right-origin.
    const left      = cx - panelW / 2 + 20;
    const colRank   = left;
    const colName   = left + 36;
    const colScore  = cx + panelW / 2 - 100;
    const colTime   = cx + panelW / 2 - 20;

    // ── Header ────────────────────────────────────────────────────────────────
    const hdrStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: '11px',
      color: '#90b8e8',
      fontStyle: 'bold',
    };
    this.add.text(colRank,  startY, t('stats.rank'),     hdrStyle).setScrollFactor(0).setDepth(802);
    this.add.text(colName,  startY, t('stats.name'),     hdrStyle).setScrollFactor(0).setDepth(802);
    this.add.text(colScore, startY, t('stats.score'),    hdrStyle).setScrollFactor(0).setDepth(802).setOrigin(1, 0);
    this.add.text(colTime,  startY, t('stats.duration'), hdrStyle).setScrollFactor(0).setDepth(802).setOrigin(1, 0);

    // Hairline divider below the header
    const divG = this.add.graphics().setScrollFactor(0).setDepth(802);
    divG.lineStyle(1, 0xffffff, 0.10);
    divG.lineBetween(left, startY + 18, colTime, startY + 18);

    // ── Data rows ─────────────────────────────────────────────────────────────
    runs.slice(0, 10).forEach((run, i) => {
      const y = startY + 26 + i * rowH;

      // Alternate row brightness so adjacent entries are easier to track.
      const color = i % 2 === 0 ? '#cccccc' : '#999999';
      const style: Phaser.Types.GameObjects.Text.TextStyle = { fontSize: '11px', color };

      // duration_ms → "M:SS" string. Null means the run pre-dates duration tracking.
      const ms  = run.duration_ms;
      const dur = ms != null
        ? `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`
        : '—';

      // Name column has a fixedWidth to prevent long nicknames from spilling into
      // the score column. colScore - colName - 12 gives a comfortable right margin.
      const nameW = colScore - colName - 12;

      this.add.text(colRank,  y, String(i + 1),  style).setScrollFactor(0).setDepth(802);
      this.add.text(colName,  y, run.nickname,    { ...style, fixedWidth: nameW }).setScrollFactor(0).setDepth(802);
      this.add.text(colScore, y, String(run.score), style).setScrollFactor(0).setDepth(802).setOrigin(1, 0);
      this.add.text(colTime,  y, dur,             style).setScrollFactor(0).setDepth(802).setOrigin(1, 0);
    });
  }

  private close(): void {
    this.scene.stop();
    // Resume whichever scene launched us — passed as scene.settings.data.
    const callerKey = (this.scene.settings.data as unknown as string) ?? 'MainMenuScene';
    this.scene.resume(callerKey);
  }
}
