import * as Phaser from 'phaser';
import { t } from '../lib/i18n';

/**
 * LoreScene — paginated world-lore overlay (FIL-81 / FIL-136).
 *
 * Covers the three game worlds and the Skymning corruption across 4 pages.
 * Launched as an overlay (pause caller + launch this scene), following the
 * same pattern as CreditsScene and SettingsScene.
 *
 * ## Why pagination instead of scrolling?
 * The primary platform is a landscape Android tablet. Large ◀ / ▶ tap targets
 * are more reliable than a scroll gesture, which can conflict with Phaser's
 * pointer handling. Arrow keys work for keyboard players too.
 *
 * ## Content source
 * Text is taken from FIL-136 (world-lore canonical reference). Translations
 * are English-only for now; FIL-136 will add localised variants in future.
 *
 * ## Page rendering
 * `showPage()` is called on every navigation step. It destroys all previously
 * created content objects and recreates them for the new page. Phaser's
 * wordWrap style option handles line-breaking automatically — we just set a
 * max width and the engine wraps the string at word boundaries.
 */

interface LorePage {
  /** Large heading shown at the top of the page. */
  heading: string;
  /** Accent colour for the heading — each world has a distinct palette. */
  headingColor: string;
  /** Optional smaller subtitle below the heading (e.g. corruption strain name). */
  subheading?: string;
  /** Body text. Use '\n\n' for paragraph breaks; single '\n' for line breaks. */
  body: string;
}

// Sourced from FIL-136: "World lore: Earth, Spinolandet, Vattenpandalandet"
// This is the canonical reference for NPC dialogue and enemy flavour text.
const PAGES: LorePage[] = [
  {
    heading: 'The Skymning',
    headingColor: '#c080e0', // purple — the universal corruption colour
    body: [
      'An ancient balancing force that keeps worlds from stagnation. Small',
      'amounts are natural — forests need death to renew. The problem: it is',
      'spreading faster than any world can absorb.',
      '',
      'Three strains keep the worlds in balance:',
      '',
      '  Vildskymning — corrupts animals and wildlife',
      '  Jordskymning — corrupts land, machines, magic systems',
      '  Mannaskymning — corrupts humans; feared, least understood',
      '',
      'The Skymning is not simply evil. It is an ancient force that has been',
      'accelerated or distorted beyond its natural role.',
    ].join('\n'),
  },
  {
    heading: 'Earth',
    headingColor: '#80a8e0', // steel blue — technology and machines
    subheading: 'Strain: The Static',
    body: [
      'A world of industry, old forests, and coasts crisscrossed with military',
      'infrastructure. After the Skymning began corrupting electrical systems,',
      'humanity militarised rapidly.',
      '',
      'The Static is electromagnetic corruption — it corrodes circuits, scrambles',
      'AI, and drives automated machines into frenzy. Hardened armour and direct',
      'neural integration are the Earth faction\'s answer.',
      '',
      'Heroes begin as field engineers and end as something that blurs the line',
      'between human and machine.',
    ].join('\n'),
  },
  {
    heading: 'Spinolandet',
    headingColor: '#80e0a0', // jungle green — biology and nature
    subheading: 'Strain: The Blight',
    body: [
      'A world where something in the biological substrate accelerated evolution —',
      'species that should take millions of years adapted in centuries, creating',
      'fantastical chimera creatures. Dense jungle-sea hybrid environments.',
      '',
      'The Blight is a mutagenic signal that drives evolution backwards into pure',
      'predatory aggression. Blighted creatures grow enormous, lose intelligence,',
      'and hunger constantly.',
      '',
      'Heroes are Spiners — humans who bond with native creatures and fight the',
      'Blight by accelerating their own evolution in controlled ways.',
    ].join('\n'),
  },
  {
    heading: 'Vattenpandalandet',
    headingColor: '#60c8e8', // water blue — rivers and magic
    subheading: 'Strain: The Dry',
    body: [
      'A world of rivers, floating islands, mist valleys, and ancient bamboo',
      'forests. Water here is metaphysical — rivers carry memory, rain holds',
      'prophecy, still pools are used for divination.',
      '',
      'The Dry corrupts water, drains magic, and turns rivers black and stagnant.',
      'Magical constructs created to protect the world sometimes get corrupted by',
      'the Dry and turn against their makers.',
      '',
      'Heroes are Panda scholars of water magic, practitioners of a tradition',
      'thousands of years old.',
    ].join('\n'),
  },
];

export class LoreScene extends Phaser.Scene {
  /** Index of the currently displayed page. */
  private currentPage = 0;

  /** Container holding all per-page content objects. Cleared on each navigation. */
  private pageGroup!: Phaser.GameObjects.Group;

  // Panel geometry — computed in create() and referenced in showPage().
  private panelW = 0;
  private panelH = 0;
  private cx     = 0;
  private cy     = 0;

  // Navigation buttons — created once, updated (alpha + interactive) per page.
  private prevBtn!: Phaser.GameObjects.Text;
  private nextBtn!: Phaser.GameObjects.Text;
  private pageIndicator!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'LoreScene' });
  }

  create(): void {
    const { width, height } = this.cameras.main;
    this.cx = width  / 2;
    this.cy = height / 2;

    this.panelW = 460;
    this.panelH = 340;

    const { cx, cy, panelW, panelH } = this;

    // ── Backdrop ──────────────────────────────────────────────────────────────
    this.add
      .rectangle(cx, cy, width, height, 0x000000, 0.78)
      .setScrollFactor(0)
      .setDepth(800)
      .setInteractive()
      .on('pointerdown', () => this.close());

    // ── Panel ─────────────────────────────────────────────────────────────────
    this.add
      .rectangle(cx, cy, panelW, panelH, 0x111a11, 0.95)
      .setScrollFactor(0)
      .setDepth(801)
      .setInteractive(); // swallow events so backdrop doesn't close on panel click

    const border = this.add.graphics().setScrollFactor(0).setDepth(802);
    border.lineStyle(1, 0xffffff, 0.12);
    border.strokeRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH);

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

    // ── Navigation controls ───────────────────────────────────────────────────
    // Prev / next buttons sit in the bottom strip of the panel, always visible.
    // setAlpha() and .removeInteractive() / .setInteractive() are toggled in
    // updateNavigation() to grey out arrows at the first/last page.

    const navY = cy + panelH / 2 - 32;

    this.prevBtn = this.add
      .text(cx - panelW / 2 + 28, navY, '◀', {
        fontSize: '18px',
        color: '#ffe066',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.navigate(-1));

    this.nextBtn = this.add
      .text(cx + panelW / 2 - 28, navY, '▶', {
        fontSize: '18px',
        color: '#ffe066',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.navigate(1));

    this.pageIndicator = this.add
      .text(cx, navY, '', {
        fontSize: '12px',
        color: '#7a9a7a',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);

    // Keyboard navigation — left/right arrows cycle pages.
    this.input.keyboard?.on('keydown-LEFT',  () => this.navigate(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.navigate(1));

    // ── Hint ──────────────────────────────────────────────────────────────────
    this.add
      .text(cx, cy + panelH / 2 - 12, t('credits.close_hint'), {
        fontSize: '10px',
        color: '#3a5a3a',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);

    // ── Page content group ────────────────────────────────────────────────────
    // A Phaser Group gives us one .clear(true, true) call to destroy all children
    // at once — much cleaner than keeping references to every text object.
    this.pageGroup = this.add.group();

    this.showPage(0);
  }

  /**
   * Navigate to an adjacent page.
   * @param delta  +1 for next, -1 for previous
   */
  private navigate(delta: number): void {
    const next = this.currentPage + delta;
    if (next < 0 || next >= PAGES.length) return;
    this.currentPage = next;
    this.showPage(this.currentPage);
  }

  /**
   * Render the content for the given page index.
   * All previously created page-content objects are destroyed first via the group.
   *
   * @param index  Page index (0-based)
   */
  private showPage(index: number): void {
    // true, true → destroy children AND remove them from the group.
    // This is the Phaser way to bulk-destroy a set of game objects.
    this.pageGroup.clear(true, true);

    const page = PAGES[index];
    const { cx, cy, panelW, panelH } = this;

    const contentLeft = cx - panelW / 2 + 24;
    const contentW    = panelW - 48;

    // ── Heading ───────────────────────────────────────────────────────────────
    const heading = this.add
      .text(cx, cy - panelH / 2 + 36, page.heading, {
        fontSize: '20px',
        color: page.headingColor,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(802);
    this.pageGroup.add(heading);

    let textY = cy - panelH / 2 + 62;

    // ── Subheading ────────────────────────────────────────────────────────────
    if (page.subheading) {
      const sub = this.add
        .text(cx, textY, page.subheading, {
          fontSize: '12px',
          color: '#7a9a7a',
          fontStyle: 'italic',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(802);
      this.pageGroup.add(sub);
      textY += 22;
    }

    // Divider between header area and body
    const divG = this.add.graphics().setScrollFactor(0).setDepth(802);
    divG.lineStyle(1, 0xffffff, 0.10);
    divG.lineBetween(contentLeft, textY, cx + panelW / 2 - 24, textY);
    this.pageGroup.add(divG);
    textY += 10;

    // ── Body ──────────────────────────────────────────────────────────────────
    // wordWrap: { width: contentW } tells Phaser to break lines at word boundaries
    // so the text never overflows the panel horizontally. The Text object grows
    // vertically to fit — we don't need to measure it ourselves.
    const body = this.add
      .text(contentLeft, textY, page.body, {
        fontSize: '12px',
        color: '#cccccc',
        lineSpacing: 4,
        wordWrap: { width: contentW },
      })
      .setScrollFactor(0)
      .setDepth(802);
    this.pageGroup.add(body);

    // ── Navigation state ──────────────────────────────────────────────────────
    this.updateNavigation();
  }

  /**
   * Grey out and disable arrows at the first/last page.
   *
   * setAlpha() visually signals the disabled state without hiding the button
   * (so the player always knows where the controls are). removeInteractive()
   * prevents clicks from firing while the button is disabled.
   */
  private updateNavigation(): void {
    const atFirst = this.currentPage === 0;
    const atLast  = this.currentPage === PAGES.length - 1;

    this.prevBtn.setAlpha(atFirst ? 0.25 : 1);
    this.nextBtn.setAlpha(atLast  ? 0.25 : 1);

    if (atFirst) {
      this.prevBtn.removeInteractive();
    } else {
      this.prevBtn.setInteractive({ useHandCursor: true });
    }

    if (atLast) {
      this.nextBtn.removeInteractive();
    } else {
      this.nextBtn.setInteractive({ useHandCursor: true });
    }

    // Page indicator: "1 / 4"
    this.pageIndicator.setText(`${this.currentPage + 1} / ${PAGES.length}`);
  }

  private close(): void {
    this.scene.stop();
    const callerKey = (this.scene.settings.data as unknown as string) ?? 'MainMenuScene';
    this.scene.resume(callerKey);
  }
}
