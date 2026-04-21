/**
 * creature-status.ts — shared status map for the creature tracker (FIL-440 / C1).
 *
 * Maps internal status values from creature_submissions.status to public-facing
 * labels, emoji icons, copy text, and a colour for the left-border ribbon.
 *
 * Kept separate so future pages (e.g. a public tracker page) can import it
 * without pulling in the Supabase fetch layer.
 */

export type CreatureStatus =
  | 'submitted'
  | 'approved'
  | 'balanced'
  | 'lore-ready'
  | 'graphics-rated'
  | 'queued'
  | 'spriting'
  | 'in-game'
  | 'rejected';

export interface StatusInfo {
  /** Short public label shown in the ribbon heading. */
  label: string;
  /** Decorative emoji prefix (optional per spec). */
  emoji: string;
  /**
   * Kid-friendly copy shown below the label.
   * For 'queued': use getCopy() to substitute the queue position.
   * For 'rejected': use getCopy() to inject the moderation note.
   */
  copy: string;
  /** CSS colour for the ribbon's left border. */
  borderColor: string;
}

export const STATUS_MAP: Record<CreatureStatus, StatusInfo> = {
  submitted: {
    label: 'Waiting for review',
    emoji: '⏳',
    copy: 'The Matlu team is reading your creature!',
    borderColor: '#9ca3af',
  },
  approved: {
    label: 'Accepted!',
    emoji: '🎉',
    copy: 'Your creature made it in. Next up: powers and story.',
    borderColor: '#4ade80',
  },
  balanced: {
    label: 'Getting its powers',
    emoji: '⚔️',
    copy: 'Figuring out what your creature can do in battle.',
    borderColor: '#f59e0b',
  },
  'lore-ready': {
    label: 'Getting its story',
    emoji: '📖',
    copy: 'Writing where your creature fits in the world.',
    borderColor: '#818cf8',
  },
  'graphics-rated': {
    label: 'Ready for drawing',
    emoji: '🎨',
    copy: 'Waiting its turn to be drawn.',
    borderColor: '#fb923c',
  },
  queued: {
    label: 'In line to be drawn',
    emoji: '⏲️',
    copy: 'In line to be drawn.',  // replaced by getCopy() with actual position
    borderColor: '#fbbf24',
  },
  spriting: {
    label: 'Being drawn right now!',
    emoji: '✏️',
    copy: 'The pixel artist is working on your creature.',
    borderColor: '#34d399',
  },
  'in-game': {
    label: 'In the game!',
    emoji: '🎮',
    copy: 'Play Matlu to find your creature.',
    borderColor: '#60a5fa',
  },
  rejected: {
    label: 'Not going to the game',
    emoji: '❌',
    copy: '',  // replaced by getCopy() with moderation_note
    borderColor: '#f87171',
  },
};

/** Returns the StatusInfo for any status string, falling back to 'submitted'. */
export function getStatusInfo(status: string | null | undefined): StatusInfo {
  const s = (status ?? 'submitted') as CreatureStatus;
  return STATUS_MAP[s] ?? STATUS_MAP['submitted'];
}

/**
 * Resolves the public copy string shown under the ribbon label.
 * Handles the two dynamic cases: queue position and rejection note.
 */
export function getCopy(
  status: string | null | undefined,
  info: StatusInfo,
  queuePosition: number | null,
  moderationNote: string | null,
): string {
  if (status === 'queued') {
    return queuePosition !== null
      ? `Position #${queuePosition} in the drawing queue.`
      : 'In line to be drawn.';
  }
  if (status === 'rejected') {
    return moderationNote?.trim() || 'This creature was not selected for the game.';
  }
  return info.copy;
}
