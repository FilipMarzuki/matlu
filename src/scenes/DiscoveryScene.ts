import * as Phaser from 'phaser';
import { BIOMES } from '../world/biomes';
import {
  loadDiscovery,
  WORLD_ORDER,
  WORLD_LABELS,
  type WorldId,
} from '../lib/discoveryState';
import entityRegistry from '../entities/entity-registry.json';

/**
 * DiscoveryScene — Pokédex-style progress screen launched from the pause menu.
 *
 * Shows what the player has discovered per world: biomes and creatures.
 * Undiscovered entries display as "? ?????" — no spoilers.  Community
 * creatures show "(by <creator>)" when credits_opt_in is true.
 *
 * ## Scene lifecycle
 * Launched as a parallel overlay (PauseMenuScene pauses itself then
 * scene.launch('DiscoveryScene', callerKey)).  The Back button stops this
 * scene and resumes the caller — identical to the SettingsScene pattern.
 *
 * ## Data sources
 * - Biome totals: all entries in src/world/biomes.ts (no world filter yet;
 *   world-specific biome lists can be added when other worlds become playable).
 * - Creature totals: entity-registry.json filtered by world + type !== 'hero'.
 * - Discovered state: localStorage via discoveryState.ts.
 */

type RegistryEntity = (typeof entityRegistry)['entities'][number] & {
  credits_opt_in?: boolean;
};

const DEPTH_BASE = 900;

export class DiscoveryScene extends Phaser.Scene {
  static readonly KEY = 'DiscoveryScene';

  private worldIdx                        = 0;
  private worldNameText!: Phaser.GameObjects.Text;
  private contentObjects: Phaser.GameObjects.GameObject[] = [];
  /** Caller scene key — stored once in create() so close() can resume it. */
  private callerKey = 'PauseMenuScene';

  constructor() {
    super({ key: DiscoveryScene.KEY });
  }

  create(): void {
    this.callerKey =
      (this.scene.settings.data as unknown as string) ?? 'PauseMenuScene';

    const { width, height } = this.cameras.main;
    const cx = width / 2;
    const cy = height / 2;

    // ── Backdrop ────────────────────────────────────────────────────────────
    this.add
      .rectangle(cx, cy, width, height, 0x000000, 0.85)
      .setScrollFactor(0)
      .setDepth(DEPTH_BASE);

    // ── Panel ───────────────────────────────────────────────────────────────
    const pw = 760;
    const ph = 548;
    this.add
      .rectangle(cx, cy, pw, ph, 0x111a11, 0.97)
      .setScrollFactor(0)
      .setDepth(DEPTH_BASE + 1);

    // Panel border
    const border = this.add.graphics().setScrollFactor(0).setDepth(DEPTH_BASE + 2);
    border.lineStyle(1, 0xffffff, 0.15);
    border.strokeRect(cx - pw / 2, cy - ph / 2, pw, ph);

    // ── Title ────────────────────────────────────────────────────────────────
    this.add
      .text(cx, 50, 'Discovery', {
        fontSize: '22px',
        color: '#f0ead6',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH_BASE + 2);

    // ── World selector ───────────────────────────────────────────────────────
    const arrowStyle = {
      fontSize: '18px',
      color: '#ffe066',
      backgroundColor: '#333300aa',
      padding: { x: 10, y: 6 },
    };

    const leftArrow = this.add
      .text(cx - 200, 90, '◀', arrowStyle)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH_BASE + 2)
      .setInteractive({ useHandCursor: true });
    leftArrow
      .on('pointerover', () => leftArrow.setStyle({ color: '#ffffff' }))
      .on('pointerout',  () => leftArrow.setStyle({ color: '#ffe066' }))
      .on('pointerdown', () => {
        this.worldIdx =
          (this.worldIdx - 1 + WORLD_ORDER.length) % WORLD_ORDER.length;
        this.rebuildContent();
      });

    this.worldNameText = this.add
      .text(cx, 90, '', { fontSize: '18px', color: '#ffe066' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH_BASE + 2);

    const rightArrow = this.add
      .text(cx + 200, 90, '▶', arrowStyle)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH_BASE + 2)
      .setInteractive({ useHandCursor: true });
    rightArrow
      .on('pointerover', () => rightArrow.setStyle({ color: '#ffffff' }))
      .on('pointerout',  () => rightArrow.setStyle({ color: '#ffe066' }))
      .on('pointerdown', () => {
        this.worldIdx = (this.worldIdx + 1) % WORLD_ORDER.length;
        this.rebuildContent();
      });

    // Static top divider
    const divStatic = this.add.graphics().setScrollFactor(0).setDepth(DEPTH_BASE + 2);
    divStatic.lineStyle(1, 0xffffff, 0.1);
    divStatic.lineBetween(cx - pw / 2 + 20, 113, cx + pw / 2 - 20, 113);

    // ── Back button ──────────────────────────────────────────────────────────
    const back = this.add
      .text(cx, height - 30, 'Back', {
        fontSize: '15px',
        color: '#ffe066',
        backgroundColor: '#333300aa',
        padding: { x: 14, y: 8 },
        fixedWidth: 120,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH_BASE + 2)
      .setInteractive({ useHandCursor: true });
    back
      .on('pointerover', () => back.setStyle({ color: '#ffffff' }))
      .on('pointerout',  () => back.setStyle({ color: '#ffe066' }))
      .on('pointerdown', () => {
        if (this.cache.audio.has('sfx-click')) {
          this.sound.play('sfx-click', { volume: 0.4 });
        }
        this.close();
      });

    this.input.keyboard?.on('keydown-ESC', () => this.close());

    this.rebuildContent();
  }

  // ── Content rendering ─────────────────────────────────────────────────────

  /**
   * Destroy and recreate all world-specific content objects.
   * Called once on create() and again whenever the world selector changes.
   */
  private rebuildContent(): void {
    for (const obj of this.contentObjects) obj.destroy();
    this.contentObjects = [];

    const world = WORLD_ORDER[this.worldIdx] as WorldId;
    this.worldNameText.setText(WORLD_LABELS[world]);

    const data = loadDiscovery();
    const discoveredBiomes  = new Set(data.biomesByWorld[world] ?? []);
    const seenCreatures     = new Set(data.seenCreatureClasses);

    // Creatures for this world — heroes are not tracked in the discovery log.
    const worldCreatures = (entityRegistry.entities as RegistryEntity[]).filter(
      e => e.world === world && e.type !== 'hero',
    );

    const d    = DEPTH_BASE + 3;
    const add  = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
      this.contentObjects.push(obj);
      return obj;
    };

    // ── Biome section ─────────────────────────────────────────────────────
    const discoveredBiomeCount = BIOMES.filter((_, i) => discoveredBiomes.has(i)).length;
    add(
      this.add
        .text(40, 130, `BIOMES   [ ${discoveredBiomeCount} / ${BIOMES.length} ]`, {
          fontSize: '13px',
          color: '#a0b080',
        })
        .setScrollFactor(0)
        .setDepth(d),
    );

    // 3-column grid for biomes
    const colX = [40, 300, 560];
    let row = 0;
    for (let start = 0; start < BIOMES.length; start += 3) {
      const slice = BIOMES.slice(start, start + 3);
      slice.forEach((biome, col) => {
        const idx        = start + col;
        const discovered = discoveredBiomes.has(idx);
        add(
          this.add
            .text(colX[col], 152 + row * 22, discovered ? `✓ ${biome.name}` : '? ?????', {
              fontSize: '12px',
              color: discovered ? '#ffe066' : '#555555',
            })
            .setScrollFactor(0)
            .setDepth(d),
        );
      });
      row++;
    }

    // ── Divider between sections ──────────────────────────────────────────
    const divY = 152 + row * 22 + 14;
    const midDivGfx = this.add.graphics().setScrollFactor(0).setDepth(d);
    midDivGfx.lineStyle(1, 0xffffff, 0.1);
    midDivGfx.lineBetween(20, divY, 780, divY);
    this.contentObjects.push(midDivGfx);

    // ── Creature section ──────────────────────────────────────────────────
    const discoveredCreatureCount = worldCreatures.filter(e =>
      seenCreatures.has(e.class),
    ).length;

    add(
      this.add
        .text(40, divY + 16, `CREATURES   [ ${discoveredCreatureCount} / ${worldCreatures.length} ]`, {
          fontSize: '13px',
          color: '#a0b080',
        })
        .setScrollFactor(0)
        .setDepth(d),
    );

    row = 0;
    for (let start = 0; start < worldCreatures.length; start += 3) {
      const slice = worldCreatures.slice(start, start + 3);
      slice.forEach((entity, col) => {
        const discovered = seenCreatures.has(entity.class);
        let label: string;
        if (!discovered) {
          label = '? ?????';
        } else {
          const displayName = entity.name_en ?? entity.class;
          // Show "(by <creator>)" only when the creator has opted in.
          const showCredit  =
            entity.credits_opt_in === true && entity.submissionCreator;
          label = showCredit
            ? `✓ ${displayName} (by ${entity.submissionCreator as string})`
            : `✓ ${displayName}`;
        }
        add(
          this.add
            .text(colX[col], divY + 36 + row * 20, label, {
              fontSize: '11px',
              color: discovered ? '#ffe066' : '#555555',
            })
            .setScrollFactor(0)
            .setDepth(d),
        );
      });
      row++;
    }
  }

  private close(): void {
    this.scene.stop();
    this.scene.resume(this.callerKey);
  }
}
