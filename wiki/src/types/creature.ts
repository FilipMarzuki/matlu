/**
 * Subset of the creature_submissions Row type used by wiki API endpoints and pages.
 * Mirrors the fields in src/types/database.types.ts — update both if the schema changes.
 */
export interface CreatureRow {
  id: string;
  creature_name: string;
  creator_name: string;
  credits_opt_in: boolean;
  lore_description: string | null;
  lore_origin: string | null;
  art_path: string | null;
  slug: string | null;
  status: string;
  status_changed_at: string | null;
  tracker_issue_number: number | null;
  approved: boolean;
  approved_at: string | null;
  kind_size: string | null;
  kind_movement: string[] | null;
  kind_diet: string | null;
  kind_solitary: boolean | null;
  habitat_biome: string[] | null;
  habitat_climate: string | null;
  habitat_notes: string | null;
  behaviour_threat: string | null;
  behaviour_notes: string | null;
  special_ability: string | null;
  world_name: string | null;
}

/** Human-readable labels for creature pipeline statuses shown in tracker comments. */
export const STATUS_LABELS: Record<string, string> = {
  pending:    'Pending Review',
  approved:   'Approved',
  balancing:  'Balancing',
  balanced:   'Balanced',
  'in-game':  'In Game',
  rejected:   'Rejected',
};
