/**
 * BehaviorTree — lightweight BT runner for combat AI.
 *
 * Nodes operate on a plain CombatContext object (not the entity directly) to
 * avoid circular imports between the AI system and CombatEntity.
 *
 * Node types:
 *   BtSelector  — tries children left-to-right, returns first non-failure
 *   BtSequence  — tries children left-to-right, fails on first failure
 *   BtCondition — leaf that checks a boolean predicate
 *   BtAction    — leaf that performs an action and returns a status
 *   BtCooldown  — decorator that blocks its child until a timer elapses
 */

export type BtStatus = 'success' | 'failure' | 'running';

/**
 * Snapshot of the entity's current state, passed to every BT node on each
 * tick. Contains position, HP, an opponent snapshot, and action closures.
 *
 * Using a plain object (not the entity itself) means BT nodes have no
 * dependency on CombatEntity, keeping imports acyclic.
 */
export interface CombatContext {
  /** Entity world position this tick */
  x: number;
  y: number;
  /** Entity HP this tick */
  hp: number;
  maxHp: number;
  /**
   * Opponent snapshot — null when there is no opponent or the opponent is
   * dead. BT conditions check this before acting.
   */
  opponent: { x: number; y: number } | null;

  /** Move toward a world position at the entity's configured speed. */
  moveToward: (tx: number, ty: number) => void;
  /** Stop all movement immediately. */
  stop: () => void;
  /**
   * Attempt a melee attack on the current opponent.
   * CombatEntity handles the attack cooldown internally — the BT just calls
   * this and the entity decides whether the hit lands.
   */
  attack: () => void;
  /** Drift in a slowly changing random direction — used as fallback wander. */
  wander: (delta: number) => void;
  /**
   * Spawn a projectile aimed at world position (tx, ty).
   * CombatEntity handles velocity calculation, spawning, and event emission.
   * The BT node treats this as fire-and-forget — no cooldown logic here.
   */
  shootAt: (tx: number, ty: number) => void;
  /**
   * Burst toward (tx, ty) at dash speed for dashDurationMs.
   * While the dash is active, moveToward and stop become no-ops so the burst
   * velocity is not cancelled by other BT branches running on the same tick.
   */
  dash: (tx: number, ty: number) => void;
}

export interface BtNode {
  tick(ctx: CombatContext, delta: number): BtStatus;
}

// ── Core node types ───────────────────────────────────────────────────────────

/**
 * Selector: tries children left-to-right and returns the first result that
 * is not 'failure'. Returns 'failure' only if every child fails.
 *
 * Think of it as logical OR — "do the first thing that works".
 */
export class BtSelector implements BtNode {
  constructor(private readonly children: BtNode[]) {}

  tick(ctx: CombatContext, delta: number): BtStatus {
    for (const child of this.children) {
      const s = child.tick(ctx, delta);
      if (s !== 'failure') return s;
    }
    return 'failure';
  }
}

/**
 * Sequence: tries children left-to-right and returns 'failure' as soon as
 * any child fails. Returns 'success' only if every child succeeds.
 *
 * Think of it as logical AND — "do all of these in order".
 */
export class BtSequence implements BtNode {
  constructor(private readonly children: BtNode[]) {}

  tick(ctx: CombatContext, delta: number): BtStatus {
    for (const child of this.children) {
      const s = child.tick(ctx, delta);
      if (s !== 'success') return s;
    }
    return 'success';
  }
}

/**
 * Condition: a leaf node that runs a predicate.
 * Returns 'success' if the predicate is true, 'failure' otherwise.
 * Never returns 'running'.
 */
export class BtCondition implements BtNode {
  constructor(private readonly fn: (ctx: CombatContext) => boolean) {}

  tick(ctx: CombatContext, _delta: number): BtStatus {
    return this.fn(ctx) ? 'success' : 'failure';
  }
}

/**
 * Action: a leaf node that performs work each tick.
 * Returns whatever status the function returns.
 */
export class BtAction implements BtNode {
  constructor(
    private readonly fn: (ctx: CombatContext, delta: number) => BtStatus,
  ) {}

  tick(ctx: CombatContext, delta: number): BtStatus {
    return this.fn(ctx, delta);
  }
}

/**
 * Cooldown: a decorator that gates its wrapped child behind a timer.
 * Blocks the child (returns 'failure') until `cooldownMs` has elapsed since
 * the child last returned 'success'. Ready immediately on the first tick.
 */
export class BtCooldown implements BtNode {
  // Start at Infinity so the very first tick is always unblocked.
  private elapsed = Infinity;

  constructor(
    private readonly child: BtNode,
    private readonly cooldownMs: number,
  ) {}

  tick(ctx: CombatContext, delta: number): BtStatus {
    this.elapsed += delta;
    if (this.elapsed < this.cooldownMs) return 'failure';
    const s = this.child.tick(ctx, delta);
    if (s === 'success') this.elapsed = 0;
    return s;
  }
}
