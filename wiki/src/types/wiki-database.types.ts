// Minimal Supabase Database types for the wiki project.
// Mirrors the creature_submissions table defined in
// supabase/migrations/20260419000000_create_creature_submissions.sql
// and extended by the creature priority queue migration (FIL-437).

export type CreatureRow = {
  id: string;
  created_at: string;

  // Creator identity
  creator_name: string;
  maker_age: number | null;
  contact_email: string | null;

  // Creature core
  creature_name: string;
  world_name: string | null;

  // Picture
  art_path: string | null;
  art_credit: string | null;

  // Kind
  kind_size: string | null;
  kind_movement: string[] | null;
  kind_diet: string | null;
  kind_solitary: boolean | null;

  // Habitat
  habitat_biome: string[] | null;
  habitat_climate: string | null;
  habitat_notes: string | null;

  // Behaviour
  behaviour_threat: string | null;
  behaviour_notes: string | null;

  // Food & special
  food_notes: string | null;
  special_ability: string | null;

  // Lore
  lore_description: string | null;
  lore_origin: string | null;
  lore_entry_id: string | null;
  lore_entry_url: string | null;

  // Game pipeline
  status: string;
  status_changed_at: string | null;
  entity_id: string | null;
  tracker_issue_number: number | null;
  balance_tier: string | null;
  balance_notes: string | null;
  graphics_difficulty: number | null;
  graphics_notes: string | null;
  biome_affinity: string[] | null;
  queue_priority: number | null;
  queued_at: string | null;
  shipped_at: string | null;

  // Completion
  completion_score: number | null;

  // Consent & credits
  license_version: string;
  license_accepted: boolean;
  parental_consent: boolean;
  credits_opt_in: boolean;

  // Moderation
  approved: boolean;
  approved_at: string | null;
  rejected_at: string | null;
  moderation_note: string | null;
  slug: string | null;
};

export type WikiDatabase = {
  public: {
    Tables: {
      creature_submissions: {
        Row: CreatureRow;
        Insert: Partial<CreatureRow> & {
          creator_name: string;
          creature_name: string;
          license_version: string;
          license_accepted: boolean;
          parental_consent: boolean;
        };
        Update: Partial<CreatureRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
