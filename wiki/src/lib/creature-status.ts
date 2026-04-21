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
  labelSv: string;
  /** Decorative emoji prefix (optional per spec). */
  emoji: string;
  /**
   * Kid-friendly copy shown below the label.
   * For 'queued': use getCopy() to substitute the queue position.
   * For 'rejected': use getCopy() to inject the moderation note.
   */
  copy: string;
  copySv: string;
  /** CSS colour for the ribbon's left border. */
  borderColor: string;
}

export const STATUS_MAP: Record<CreatureStatus, StatusInfo> = {
  submitted: {
    label: 'Waiting for review', labelSv: 'Väntar på granskning',
    emoji: '⏳',
    copy: 'The Matlu team is reading your creature!',
    copySv: 'Matlu-teamet läser ditt väsen!',
    borderColor: '#9ca3af',
  },
  approved: {
    label: 'Accepted!', labelSv: 'Accepterat!',
    emoji: '🎉',
    copy: 'Your creature made it in. Next up: powers and story.',
    copySv: 'Ditt väsen kom med. Nästa steg: krafter och historia.',
    borderColor: '#4ade80',
  },
  balanced: {
    label: 'Getting its powers', labelSv: 'Får sina krafter',
    emoji: '⚔️',
    copy: 'Figuring out what your creature can do in battle.',
    copySv: 'Bestämmer vad ditt väsen kan göra i strid.',
    borderColor: '#f59e0b',
  },
  'lore-ready': {
    label: 'Getting its story', labelSv: 'Får sin historia',
    emoji: '📖',
    copy: 'Writing where your creature fits in the world.',
    copySv: 'Skriver var ditt väsen hör hemma i världen.',
    borderColor: '#818cf8',
  },
  'graphics-rated': {
    label: 'Ready for drawing', labelSv: 'Redo att tecknas',
    emoji: '🎨',
    copy: 'Waiting its turn to be drawn.',
    copySv: 'Väntar på sin tur att tecknas.',
    borderColor: '#fb923c',
  },
  queued: {
    label: 'In line to be drawn', labelSv: 'I kön för att tecknas',
    emoji: '⏲️',
    copy: 'In line to be drawn.',
    copySv: 'I kön för att tecknas.',
    borderColor: '#fbbf24',
  },
  spriting: {
    label: 'Being drawn right now!', labelSv: 'Tecknas just nu!',
    emoji: '✏️',
    copy: 'The pixel artist is working on your creature.',
    copySv: 'Pixelkonstnären arbetar med ditt väsen.',
    borderColor: '#34d399',
  },
  'in-game': {
    label: 'In the game!', labelSv: 'I spelet!',
    emoji: '🎮',
    copy: 'Play Matlu to find your creature.',
    copySv: 'Spela Matlu för att hitta ditt väsen.',
    borderColor: '#60a5fa',
  },
  rejected: {
    label: 'Not going to the game', labelSv: 'Kom inte med i spelet',
    emoji: '❌',
    copy: '',
    copySv: '',
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
  lang: 'en' | 'sv' = 'en',
): string {
  if (status === 'queued') {
    if (lang === 'sv') return queuePosition !== null ? `Plats #${queuePosition} i teckningskön.` : 'I kön för att tecknas.';
    return queuePosition !== null ? `Position #${queuePosition} in the drawing queue.` : 'In line to be drawn.';
  }
  if (status === 'rejected') {
    if (lang === 'sv') return moderationNote?.trim() || 'Det här väsenet valdes inte ut till spelet.';
    return moderationNote?.trim() || 'This creature was not selected for the game.';
  }
  return lang === 'sv' ? info.copySv : info.copy;
}
