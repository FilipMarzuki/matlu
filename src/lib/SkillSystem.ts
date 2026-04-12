/**
 * SkillSystem — invisible skill progression and first-time discovery bonuses.
 *
 * The player gets better at things by doing them. Skill levels are never
 * shown; improvements manifest as subtle stat changes the player notices
 * organically (slightly faster, hitting from a bit further, finding more gold).
 *
 * ## Skill categories
 *
 * | Skill       | Gained by                  | Affects                          |
 * |-------------|----------------------------|----------------------------------|
 * | combat      | Killing enemies            | Gold drops from kills            |
 * | running     | Moving                     | Movement speed                   |
 * | cleansing   | Swipe attacks              | Swipe range                      |
 * | throwing    | Firing ranged bolts        | Bolt travel range                |
 *
 * ## XP curve
 *
 * Level = floor(sqrt(xp / XP_PER_LEVEL)), capped at MAX_LEVEL.
 * This is the same curve used by Runescape: early levels come quickly from
 * normal play, the system asymptotes rather than requiring grinding.
 *
 *   level 1  →    50 XP   (a handful of actions)
 *   level 5  →  1 250 XP  (one good session)
 *   level 10 →  5 000 XP  (several sessions)
 *   level 50 → 125 000 XP (dedicated long-term play)
 *
 * Each level adds 1 % to the relevant multiplier (1.0 at level 0, up to 1.5 at 50).
 *
 * ## First-time discovery bonuses
 *
 * A `firsts` registry tracks action keys that have fired before. Calling
 * `trackFirst(key)` returns true only on the genuine first call, then false
 * forever. Both skills and firsts are persisted in localStorage so bonuses
 * don't re-fire on page reload.
 *
 * ## Why no UI?
 * Showing XP bars or level numbers would make players optimise rather than
 * play naturally. Invisible improvements match how skills feel in real life —
 * you notice you're faster, but you don't watch a meter.
 */

export type SkillName = 'combat' | 'running' | 'cleansing' | 'throwing';

const SKILL_NAMES: ReadonlyArray<SkillName> = ['combat', 'running', 'cleansing', 'throwing'];

/**
 * XP required for level n: n² × XP_PER_LEVEL.
 * Equivalently, level = floor(sqrt(xp / XP_PER_LEVEL)).
 */
const XP_PER_LEVEL = 50;

/** Hard cap — multiplier reaches 1.5× at this level. */
const MAX_LEVEL = 50;

const SKILLS_STORAGE_KEY = 'matlu_skills';
const FIRSTS_STORAGE_KEY = 'matlu_firsts';

export class SkillSystem {
  private readonly xp: Record<SkillName, number>;
  private readonly firsts: Set<string>;

  constructor() {
    this.xp     = this.loadSkills();
    this.firsts = this.loadFirsts();
  }

  // ─── XP accumulation ────────────────────────────────────────────────────────

  /**
   * Add XP to a skill.
   *
   * @returns The new level after adding the XP. Callers can use this to detect
   * a level-up if they need a hook (e.g., future level-up sound). Not required
   * for the silent improvements the system currently applies.
   */
  addXP(skill: SkillName, amount: number): number {
    this.xp[skill] = (this.xp[skill] ?? 0) + amount;
    this.saveSkills();
    return this.level(skill);
  }

  // ─── Level and multiplier ────────────────────────────────────────────────────

  /**
   * Current level for a skill (0–50).
   * Derived from the stored XP on every call — no separate level cache needed.
   */
  level(skill: SkillName): number {
    return Math.min(MAX_LEVEL, Math.floor(Math.sqrt(this.xp[skill] / XP_PER_LEVEL)));
  }

  /**
   * Stat multiplier for a skill: 1.0 at level 0, up to 1.5 at level 50.
   *
   * Each skill level adds 1 % effectiveness. At level 5 the player is 5 %
   * better — noticeable but not dramatic. At the hard cap of level 50 the
   * bonus reaches 50 %, which requires dedicated long-term play.
   *
   * Applied at usage sites rather than mutating the base stat, so the
   * multiplier always reflects the current skill level without requiring
   * explicit refresh calls.
   */
  multiplier(skill: SkillName): number {
    return 1 + this.level(skill) * 0.01;
  }

  // ─── First-time discovery bonuses ────────────────────────────────────────────

  /**
   * Record an action as "done for the first time" and return whether this
   * is genuinely the first occurrence.
   *
   * Returns `true` on the first call for a given key (reward should be applied),
   * `false` on every subsequent call. Persisted to localStorage so page reloads
   * don't re-trigger bonuses.
   *
   * @example
   * ```ts
   * if (this.skillSystem.trackFirst('first-kill')) {
   *   this.skillSystem.addXP('combat', 50); // silent bonus XP
   * }
   * ```
   */
  trackFirst(key: string): boolean {
    if (this.firsts.has(key)) return false;
    this.firsts.add(key);
    this.saveFirsts();
    return true;
  }

  // ─── Persistence ─────────────────────────────────────────────────────────────

  private loadSkills(): Record<SkillName, number> {
    const defaults: Record<SkillName, number> = { combat: 0, running: 0, cleansing: 0, throwing: 0 };
    try {
      const stored = JSON.parse(
        localStorage.getItem(SKILLS_STORAGE_KEY) ?? '{}'
      ) as Partial<Record<SkillName, number>>;
      for (const name of SKILL_NAMES) {
        const v = stored[name];
        if (typeof v === 'number' && v >= 0) defaults[name] = v;
      }
    } catch { /* ignore parse errors — start fresh */ }
    return defaults;
  }

  private saveSkills(): void {
    localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(this.xp));
  }

  private loadFirsts(): Set<string> {
    try {
      return new Set<string>(
        JSON.parse(localStorage.getItem(FIRSTS_STORAGE_KEY) ?? '[]') as string[]
      );
    } catch {
      return new Set();
    }
  }

  private saveFirsts(): void {
    localStorage.setItem(FIRSTS_STORAGE_KEY, JSON.stringify([...this.firsts]));
  }
}
