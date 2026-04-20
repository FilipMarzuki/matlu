/**
 * Public-facing display info for each creature pipeline status.
 * Internal status strings → kid-friendly label, copy, emoji, and border color
 * for use on /creatures/[slug] and any future pages.
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

export interface StatusDisplay {
  label: string;
  /** Ribbon copy. For 'queued', use {N} as a placeholder for queue position. */
  copy: string;
  emoji: string;
  /** Hex color for the ribbon's left border. */
  borderColor: string;
}

export const STATUS_DISPLAY: Record<CreatureStatus, StatusDisplay> = {
  submitted: {
    label: 'Waiting for review',
    copy: 'The Matlu team is reading your creature!',
    emoji: '⏳',
    borderColor: '#6b7280',
  },
  approved: {
    label: 'Accepted!',
    copy: 'Your creature made it in. Next up: powers and story.',
    emoji: '🎉',
    borderColor: '#4ade80',
  },
  balanced: {
    label: 'Getting its powers',
    copy: 'Figuring out what your creature can do in battle.',
    emoji: '⚔️',
    borderColor: '#fb923c',
  },
  'lore-ready': {
    label: 'Getting its story',
    copy: 'Writing where your creature fits in the world.',
    emoji: '📖',
    borderColor: '#60a5fa',
  },
  'graphics-rated': {
    label: 'Ready for drawing',
    copy: 'Waiting its turn to be drawn.',
    emoji: '🎨',
    borderColor: '#a78bfa',
  },
  queued: {
    label: 'In line to be drawn',
    copy: 'Position #{N} in the drawing queue.',
    emoji: '⏲️',
    borderColor: '#f59e0b',
  },
  spriting: {
    label: 'Being drawn right now!',
    copy: 'The pixel artist is working on your creature.',
    emoji: '✏️',
    borderColor: '#ec4899',
  },
  'in-game': {
    label: 'In the game!',
    copy: 'Play Matlu to find your creature.',
    emoji: '🎮',
    borderColor: '#4ade80',
  },
  rejected: {
    label: 'Not going to the game',
    copy: '',
    emoji: '❌',
    borderColor: '#f87171',
  },
};

export function isKnownStatus(s: string): s is CreatureStatus {
  return Object.prototype.hasOwnProperty.call(STATUS_DISPLAY, s);
}

/** Human-readable label for a status string (falls back to raw value if unknown). */
export function statusLabel(s: string): string {
  return isKnownStatus(s) ? STATUS_DISPLAY[s].label : s;
}
