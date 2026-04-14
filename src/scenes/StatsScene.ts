import * as Phaser from 'phaser';
import { t } from '../lib/i18n';
import { fetchMatluLeaderboard, fetchPlayerRuns } from '../lib/matluRuns';
import type { MatluRun } from '../types/database.types';

/**
 * StatsScene — two-section stats overlay (FIL-86).
 *
 * ## Two sections
 * - **My Records** (top): personal runs fetched by the player's stored nickname.
 *   Shows total runs, best score, and a last-5-runs mini-table.
 * - **Top Scores** (bottom): global top-5 leaderboard (same data as before).
 *
 * ## Scene lifecycle (overlay pattern)
 * Caller calls `scene.pause()` then `scene.launch('StatsScene', callerKey)`.
 * `close()` stops this scene and resumes the caller. Identical pattern to
 * CreditsScene and SettingsScene — background stays rendered and frozen underneath.
 *
 * ## Async fetch inside create()
 * `Promise.all` fires both queries in parallel. A `_shutdown` flag prevents
 * the callback from touching a destroyed scene if the player closes early.
 *
 * ## Supabase fallback
 * Both `fetchPlayerRuns` and `fetchMatluLeaderboard` return `null` when Supabase
 * isn't configured (missing VITE_SUPABASE_* env vars). Each section handles null
 * independently so a partial outage degrades gracefully.
 */
export class StatsScene extends Phaser.Scene {
  private _shutdown = false;

  constructor() {
    super({ key: 'StatsScene' });
  }

  create(): void {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this._shutdown = true;
    });

    const { width, height } = this.cameras.main;
    const cx = width  / 2;
    const cy = height / 2;

    // ── Backdrop ──────────────────────────────────────────────────────────────
    this.add
      .rectangle(cx, cy, width, height, 0x000000, 0.78)
      .setScrollFactor(0)
      .setDepth(800)
      .setInteractive()
      .on('pointerdown', () => this.close());

    // ── Panel ─────────────────────────────────────────────────────────────────
    // Taller than the original leaderboard-only panel to accommodate both sections.
    const panelW = 420;
    const panelH = 490;
    this.add
      .rectangle(cx, cy, panelW, panelH, 0x111a11, 0.95)
      .setScrollFactor(0)
      .setDepth(801)
      .setInteractive();

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

    // ── Hint ──────────────────────────────────────────────────────────────────
    this.add
      .text(cx, cy + panelH / 2 - 14, t('credits.close_hint'), {
        fontSize: '10px',
        color: '#3a5a3a',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);

    // ── Section Y coordinates ─────────────────────────────────────────────────
    // Personal section starts just below the title; a separator divides it from
    // the leaderboard. Both are sized to fit comfortably inside the 490px panel.
    const personalTop = cy - panelH / 2 + 56;
    const separatorY  = personalTop + 170;
    const leaderTop   = separatorY  + 24;

    // ── Loading placeholder ───────────────────────────────────────────────────
    const placeholder = this.add
      .text(cx, cy - 10, t('stats.loading'), {
        fontSize: '13px',
        color: '#7a9a7a',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);

    // ── Parallel fetch — personal runs + global leaderboard ───────────────────
    // Both queries fire at the same time; we render when both resolve.
    const nickname = localStorage.getItem('matlu_player_name') ?? '';
    void Promise.all([
      fetchPlayerRuns(nickname, 5),
      fetchMatluLeaderboard(5),
    ]).then(([personalResult, leaderResult]) => {
      if (this._shutdown) return;
      placeholder.destroy();

      this.renderPersonalSection(cx, panelW, personalTop, nickname, personalResult);

      // Separator line between sections
      const sepG = this.add.graphics().setScrollFactor(0).setDepth(802);
      sepG.lineStyle(1, 0xffffff, 0.08);
      const left  = cx - panelW / 2 + 20;
      const right = cx + panelW / 2 - 20;
      sepG.lineBetween(left, separatorY, right, separatorY);

      this.renderLeaderSection(cx, panelW, leaderTop, leaderResult);
    });
  }

  // ── Personal section ────────────────────────────────────────────────────────

  /**
   * Render the "My Records" section: a summary line + last-5-runs mini-table.
   *
   * @param cx          Horizontal centre of the panel
   * @param panelW      Panel width
   * @param startY      Top y of this section (below title)
   * @param nickname    Player name read from localStorage
   * @param result      Supabase query result (null = not configured)
   */
  private renderPersonalSection(
    cx: number,
    panelW: number,
    startY: number,
    nickname: string,
    result: Awaited<ReturnType<typeof fetchPlayerRuns>>,
  ): void {
    const left = cx - panelW / 2 + 20;

    // Section label
    this.add.text(left, startY - 16, t('stats.my_records'), {
      fontSize: '9px', color: '#445544', fontStyle: 'italic',
    }).setScrollFactor(0).setDepth(802);

    if (!result) {
      this.showMessage(cx, startY + 40, t('stats.no_scores'));
      return;
    }

    const { data, error } = result;
    if (error || !data) {
      this.showMessage(cx, startY + 40, t('stats.error'), '#f08080');
      return;
    }
    if (data.length === 0 || !nickname) {
      this.showMessage(cx, startY + 40, t('stats.no_scores'));
      return;
    }

    // Summary stats derived from personal run history
    const totalRuns = data.length;
    const bestScore = Math.max(...data.map(r => r.score ?? 0));
    const totalMs   = data.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0);
    const totalMins = Math.floor(totalMs / 60_000);
    const totalSecs = Math.floor((totalMs % 60_000) / 1000);
    const totalTime = `${totalMins}:${String(totalSecs).padStart(2, '0')}`;

    // Single-line summary: name · Runs: N · Best: X · Total: H:MM
    this.add.text(left, startY,
      `${nickname}  ·  ${t('stats.runs')}: ${totalRuns}  ·  ${t('stats.best')}: ${bestScore}  ·  ${t('stats.total_time')}: ${totalTime}`,
      { fontSize: '11px', color: '#aabbaa' },
    ).setScrollFactor(0).setDepth(802);

    // Mini-table: last 5 runs — columns # | Score | Time | Date
    this.renderPersonalTable(cx, panelW, startY + 22, data);
  }

  /**
   * Compact 4-column table of personal runs: rank, score, time, date.
   * Rows are 18px high; alternating brightness matches the global leaderboard style.
   */
  private renderPersonalTable(cx: number, panelW: number, startY: number, runs: MatluRun[]): void {
    const rowH  = 18;
    const left  = cx - panelW / 2 + 20;
    const colRank  = left;
    const colScore = cx - 60;
    const colTime  = cx + 40;
    const colDate  = cx + panelW / 2 - 20;

    // Header
    const hdrStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: '10px', color: '#7a9aaa', fontStyle: 'bold',
    };
    this.add.text(colRank,  startY, t('stats.rank'),     hdrStyle).setScrollFactor(0).setDepth(802);
    this.add.text(colScore, startY, t('stats.score'),    hdrStyle).setScrollFactor(0).setDepth(802).setOrigin(1, 0);
    this.add.text(colTime,  startY, t('stats.duration'), hdrStyle).setScrollFactor(0).setDepth(802).setOrigin(1, 0);
    this.add.text(colDate,  startY, t('stats.date'),     hdrStyle).setScrollFactor(0).setDepth(802).setOrigin(1, 0);

    const divG = this.add.graphics().setScrollFactor(0).setDepth(802);
    divG.lineStyle(1, 0xffffff, 0.08);
    divG.lineBetween(left, startY + 15, colDate, startY + 15);

    runs.slice(0, 5).forEach((run, i) => {
      const y     = startY + 22 + i * rowH;
      const color = i % 2 === 0 ? '#cccccc' : '#999999';
      const style: Phaser.Types.GameObjects.Text.TextStyle = { fontSize: '10px', color };

      const ms  = run.duration_ms;
      const dur = ms != null
        ? `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`
        : '—';

      // Date: "Apr 10" style from ISO created_at
      const dateStr = run.created_at
        ? new Date(run.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : '—';

      this.add.text(colRank,  y, String(i + 1),        style).setScrollFactor(0).setDepth(802);
      this.add.text(colScore, y, String(run.score ?? 0), style).setScrollFactor(0).setDepth(802).setOrigin(1, 0);
      this.add.text(colTime,  y, dur,                   style).setScrollFactor(0).setDepth(802).setOrigin(1, 0);
      this.add.text(colDate,  y, dateStr,               style).setScrollFactor(0).setDepth(802).setOrigin(1, 0);
    });
  }

  // ── Leaderboard section ─────────────────────────────────────────────────────

  /**
   * Render the "Top Scores" section: section label + global top-5 table.
   */
  private renderLeaderSection(
    cx: number,
    panelW: number,
    startY: number,
    result: Awaited<ReturnType<typeof fetchMatluLeaderboard>>,
  ): void {
    const left = cx - panelW / 2 + 20;

    this.add.text(left, startY - 16, t('stats.top_scores'), {
      fontSize: '9px', color: '#445544', fontStyle: 'italic',
    }).setScrollFactor(0).setDepth(802);

    if (!result) {
      this.showMessage(cx, startY + 40, t('stats.no_scores'));
      return;
    }

    const { data, error } = result;
    if (error || !data) {
      this.showMessage(cx, startY + 40, t('stats.error'), '#f08080');
      return;
    }
    if (data.length === 0) {
      this.showMessage(cx, startY + 40, t('stats.no_scores'));
      return;
    }

    this.renderTable(cx, startY, panelW, data);
  }

  // ── Shared helpers ──────────────────────────────────────────────────────────

  /** Display a single centred message (empty-state or error). */
  private showMessage(cx: number, cy: number, msg: string, color = '#7a9a7a'): void {
    this.add
      .text(cx, cy, msg, { fontSize: '13px', color })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);
  }

  /**
   * Render a fixed-column leaderboard table (global top scores).
   *
   * Phaser has no built-in table widget, so we position individual Text objects
   * at fixed x offsets to simulate columns. Right-origin anchoring on numeric
   * columns (`setOrigin(1, 0)`) gives the same effect as CSS `text-align: right`.
   */
  private renderTable(cx: number, startY: number, panelW: number, runs: MatluRun[]): void {
    const rowH = 20;

    const left      = cx - panelW / 2 + 20;
    const colRank   = left;
    const colName   = left + 36;
    const colScore  = cx + panelW / 2 - 100;
    const colTime   = cx + panelW / 2 - 20;

    const hdrStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: '11px',
      color: '#90b8e8',
      fontStyle: 'bold',
    };
    this.add.text(colRank,  startY, t('stats.rank'),     hdrStyle).setScrollFactor(0).setDepth(802);
    this.add.text(colName,  startY, t('stats.name'),     hdrStyle).setScrollFactor(0).setDepth(802);
    this.add.text(colScore, startY, t('stats.score'),    hdrStyle).setScrollFactor(0).setDepth(802).setOrigin(1, 0);
    this.add.text(colTime,  startY, t('stats.duration'), hdrStyle).setScrollFactor(0).setDepth(802).setOrigin(1, 0);

    const divG = this.add.graphics().setScrollFactor(0).setDepth(802);
    divG.lineStyle(1, 0xffffff, 0.10);
    divG.lineBetween(left, startY + 18, colTime, startY + 18);

    runs.slice(0, 5).forEach((run, i) => {
      const y = startY + 26 + i * rowH;

      const color = i % 2 === 0 ? '#cccccc' : '#999999';
      const style: Phaser.Types.GameObjects.Text.TextStyle = { fontSize: '11px', color };

      const ms  = run.duration_ms;
      const dur = ms != null
        ? `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`
        : '—';

      const nameW = colScore - colName - 12;

      this.add.text(colRank,  y, String(i + 1),   style).setScrollFactor(0).setDepth(802);
      this.add.text(colName,  y, run.nickname ?? '—', { ...style, fixedWidth: nameW }).setScrollFactor(0).setDepth(802);
      this.add.text(colScore, y, String(run.score ?? 0), style).setScrollFactor(0).setDepth(802).setOrigin(1, 0);
      this.add.text(colTime,  y, dur,              style).setScrollFactor(0).setDepth(802).setOrigin(1, 0);
    });
  }

  private close(): void {
    this.scene.stop();
    const callerKey = (this.scene.settings.data as unknown as string) ?? 'MainMenuScene';
    this.scene.resume(callerKey);
  }
}
