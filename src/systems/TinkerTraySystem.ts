import * as Phaser from 'phaser';

const REGISTRY_KEY = 'tinkerTraySystem';
const LS_KEY = 'matlu_tinker_tray';

/** Emitted on game.events when tray progress changes. */
export const TRAY_PROGRESS_CHANGED = 'tray-progress-changed';
/** Emitted on game.events when a discovery resolves (progress hits 100%). */
export const TRAY_DISCOVERY = 'tray-discovery';

// ── Types ────────────────────────────────────────────────────────────────────

export type DiscoveryType =
  | 'recipe'
  | 'concept-rank'
  | 'item-variant'
  | 'lore-revelation'
  | 'story-secret'
  | 'npc-insight'
  | 'false-conclusion';

export interface Discovery {
  type: DiscoveryType;
  id: string;
  hint: string;
  /** True if this was generated as a false conclusion from overloaded slots. */
  isFalse: boolean;
}

export interface TrayCombo {
  tray: string[];
  possibleResults: { type: DiscoveryType; id: string; hint: string }[];
}

interface TraySave {
  slots: (string | null)[];
  progress: number;
  /** Discoveries the player has already made (combo hashes). */
  discovered: string[];
  /** False conclusions currently believed. */
  falseBeliefs: string[];
}

// ── Speed multipliers per slot (from tinker-tray.json) ───────────────────────

const SLOT_SPEED = [1.5, 1.2, 0.5, 0.3, 0.1];
/** Probability of a false conclusion per tick for slots 3-5. */
const FALSE_CHANCE = [0, 0, 0.05, 0.15, 0.3];

/**
 * TinkerTraySystem — manages the player's mental workbench state.
 *
 * Owns:
 *  - 5 ranked slots (concepts, materials, recipes, lore fragments)
 *  - Progress toward current discovery (0-1)
 *  - Discovery resolution (deterministic: same combo = same result)
 *  - False conclusion tracking
 *
 * Progress ticks are driven externally — call `tick()` during rest events.
 * For the prototype, the Mind tab has a "Rest" button that calls tick().
 *
 * Access from any scene:
 *   const tray = this.game.registry.get('tinkerTraySystem') as TinkerTraySystem;
 */
export class TinkerTraySystem {
  private readonly game: Phaser.Game;

  /** 5 ranked slots — concept/material/recipe/lore IDs or null. */
  slots: (string | null)[] = [null, null, null, null, null];
  /** Progress toward current discovery, 0-1. */
  progress = 0;
  /** Set of combo hashes for discoveries already made. */
  private discovered: Set<string> = new Set();
  /** Set of discovery IDs currently believed but actually false. */
  falseBeliefs: Set<string> = new Set();

  /** Hand-authored combo tables loaded from tinker-tray.json. */
  private craftingCombos: TrayCombo[] = [];
  private loreCombos: TrayCombo[] = [];

  constructor(scene: Phaser.Scene) {
    this.game = scene.game;
    this._restoreFromStorage();
    this.game.registry.set(REGISTRY_KEY, this);
    this.game.events.once(Phaser.Core.Events.DESTROY, () => this._persist());
  }

  // ── Combo data loading ──────────────────────────────────────────────────────

  /** Load discovery combos from the parsed tinker-tray.json data. */
  loadCombos(data: { craftingExamples?: TrayCombo[]; loreExamples?: TrayCombo[] }): void {
    this.craftingCombos = data.craftingExamples ?? [];
    this.loreCombos = data.loreExamples ?? [];
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Advance discovery progress by one tick. Call during rest/sleep/idle.
   *
   * @param qualityBonus Settlement quality modifier (0 = wilderness, 0.5 = outpost, 1 = town)
   * @returns A Discovery if progress reached 100%, or null.
   */
  tick(qualityBonus = 0): Discovery | null {
    const filledSlots = this.slots.filter(Boolean) as string[];
    if (filledSlots.length === 0) return null;

    // Base progress: average of filled slot speed multipliers, boosted by quality
    let speed = 0;
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i]) speed += SLOT_SPEED[i];
    }
    speed /= filledSlots.length;
    speed *= (1 + qualityBonus * 0.5);

    // Each tick adds 8-15% base (scaled by speed) — so 7-13 ticks to discover
    const increment = 0.1 * speed;
    this.progress = Math.min(1, this.progress + increment);
    this._persist();

    this.game.events.emit(TRAY_PROGRESS_CHANGED, this.progress);

    if (this.progress >= 1) {
      return this._resolve();
    }
    return null;
  }

  /** Get a flavour hint based on current progress. */
  getProgressHint(): string {
    if (this.progress <= 0) return '';
    if (this.progress < 0.3) return 'Something stirs at the edge of thought...';
    if (this.progress < 0.6) return 'A shape is forming... not quite there yet.';
    if (this.progress < 0.85) return 'Almost... the pieces are connecting.';
    return 'A flash of insight is imminent!';
  }

  /** Set a slot value and reset progress (new combination = start over). */
  setSlot(index: number, value: string | null): void {
    if (index < 0 || index > 4) return;
    if (this.slots[index] === value) return;
    this.slots[index] = value;
    this.progress = 0;
    this._persist();
    this.game.events.emit(TRAY_PROGRESS_CHANGED, 0);
  }

  /** Swap two slots. Resets progress since the ranking changed. */
  swapSlots(a: number, b: number): void {
    const tmp = this.slots[a];
    this.slots[a] = this.slots[b];
    this.slots[b] = tmp;
    this.progress = 0;
    this._persist();
    this.game.events.emit(TRAY_PROGRESS_CHANGED, 0);
  }

  /** Check if a specific combo has already been discovered. */
  isDiscovered(comboHash: string): boolean {
    return this.discovered.has(comboHash);
  }

  /** Clear a false belief (e.g. NPC correction or contradicting evidence). */
  clearFalseBelief(discoveryId: string): void {
    this.falseBeliefs.delete(discoveryId);
    this._persist();
  }

  // ── Resolution ──────────────────────────────────────────────────────────────

  /** Deterministic hash for current tray combo — sorted so order within
   *  filled slots doesn't matter (only which slots they occupy matters
   *  for false-conclusion risk, not for result lookup). */
  private _comboHash(): string {
    const filled = this.slots.filter(Boolean) as string[];
    return filled.sort().join('|');
  }

  /**
   * Resolve the current tray at 100% progress.
   * Looks up combo tables first, falls back to "dead end".
   * False conclusion chance based on which slots are filled.
   */
  private _resolve(): Discovery | null {
    const hash = this._comboHash();
    const filledSlots = this.slots.map((s, i) => s ? i : -1).filter(i => i >= 0);

    // Already discovered this exact combo
    if (this.discovered.has(hash)) {
      this.progress = 0;
      this._persist();
      return {
        type: 'concept-rank',
        id: '_already-known',
        hint: 'You\'ve already explored this line of thinking. Try a different combination.',
        isFalse: false,
      };
    }

    // Check false conclusion risk from slots 3-5
    const shouldFalse = this._rollFalseConclusion(filledSlots);

    // Look up in combo tables
    const combo = this._findCombo();

    if (!combo || combo.possibleResults.length === 0) {
      // Dead end — still counts as "discovered" so repeated attempts
      // eventually give clearer signals
      this.discovered.add(hash);
      this.progress = 0;
      this._persist();
      return {
        type: 'concept-rank',
        id: '_dead-end',
        hint: 'The ideas don\'t connect. Maybe a different approach...',
        isFalse: false,
      };
    }

    // Pick first result (deterministic — same combo = same result)
    const result = combo.possibleResults[0];

    if (shouldFalse && combo.possibleResults.length > 0) {
      // Generate a false conclusion — use the real hint but mark it false
      const falseDiscovery: Discovery = {
        type: result.type,
        id: result.id + '_false',
        hint: result.hint,
        isFalse: true,
      };
      this.falseBeliefs.add(falseDiscovery.id);
      this.discovered.add(hash);
      this.progress = 0;
      this._persist();
      this.game.events.emit(TRAY_DISCOVERY, falseDiscovery);
      return falseDiscovery;
    }

    // Real discovery
    const discovery: Discovery = {
      type: result.type,
      id: result.id,
      hint: result.hint,
      isFalse: false,
    };
    this.discovered.add(hash);
    this.progress = 0;
    this._persist();
    this.game.events.emit(TRAY_DISCOVERY, discovery);
    return discovery;
  }

  /** Find a matching combo from the authored tables. */
  private _findCombo(): TrayCombo | null {
    const filled = new Set(this.slots.filter(Boolean) as string[]);
    const allCombos = [...this.craftingCombos, ...this.loreCombos];

    for (const combo of allCombos) {
      // A combo matches if all its tray items are present in the filled slots
      if (combo.tray.every(item => filled.has(item))) {
        return combo;
      }
    }
    return null;
  }

  /** Deterministic false conclusion roll based on which high slots are used.
   *  Uses the combo hash as a seed so it's consistent per combination. */
  private _rollFalseConclusion(filledSlotIndices: number[]): boolean {
    // Only slots 3+ (index 2+) can trigger false conclusions
    const riskySlots = filledSlotIndices.filter(i => i >= 2);
    if (riskySlots.length === 0) return false;

    // Deterministic "random" based on combo hash
    const hash = this._comboHash();
    let seed = 0;
    for (let i = 0; i < hash.length; i++) {
      seed = ((seed << 5) - seed + hash.charCodeAt(i)) | 0;
    }
    const pseudoRandom = Math.abs(seed % 100) / 100;

    // Max false chance across risky slots
    const maxChance = Math.max(...riskySlots.map(i => FALSE_CHANCE[i]));
    return pseudoRandom < maxChance;
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private _persist(): void {
    try {
      const save: TraySave = {
        slots: this.slots,
        progress: this.progress,
        discovered: [...this.discovered],
        falseBeliefs: [...this.falseBeliefs],
      };
      localStorage.setItem(LS_KEY, JSON.stringify(save));
    } catch {
      // localStorage unavailable — fail silently.
    }
  }

  private _restoreFromStorage(): void {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const save = JSON.parse(raw) as Partial<TraySave>;
      if (save.slots) this.slots = save.slots;
      if (typeof save.progress === 'number') this.progress = save.progress;
      if (save.discovered) this.discovered = new Set(save.discovered);
      if (save.falseBeliefs) this.falseBeliefs = new Set(save.falseBeliefs);
    } catch {
      // Corrupt save — start fresh.
    }
  }
}
