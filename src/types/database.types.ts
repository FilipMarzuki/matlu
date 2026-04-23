/**
 * Supabase Postgres types for this project.
 *
 * Schemas were created with the Supabase MCP tool `apply_migration`:
 *   - `create_matlu_runs`                    — leaderboard table
 *   - `create_matlu_feedback`                — in-game feedback table
 *   - `create_stats_weekly`                  — weekly engineering metrics
 *   - `create_creature_submissions`          — creature wiki submission form (FIL-431)
 *   - `creature_pipeline_state_machine`      — pipeline status columns + history table + trigger (FIL-435)
 *
 * Regenerate via MCP `generate_typescript_types` after any DDL change,
 * then replace this file.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_sessions: {
        Row: {
          branch: string | null
          cache_read_tokens: number
          cache_write_tokens: number
          created_at: string
          estimated_cost_usd: number
          id: string
          input_tokens: number
          issue_id: string | null
          model: string | null
          output_tokens: number
          recorded_at: string
          session_id: string
          source: string
          workflow: string
        }
        Insert: {
          branch?: string | null
          cache_read_tokens?: number
          cache_write_tokens?: number
          created_at?: string
          estimated_cost_usd?: number
          id?: string
          input_tokens?: number
          issue_id?: string | null
          model?: string | null
          output_tokens?: number
          recorded_at: string
          session_id: string
          source?: string
          workflow: string
        }
        Update: {
          branch?: string | null
          cache_read_tokens?: number
          cache_write_tokens?: number
          created_at?: string
          estimated_cost_usd?: number
          id?: string
          input_tokens?: number
          issue_id?: string | null
          model?: string | null
          output_tokens?: number
          recorded_at?: string
          session_id?: string
          source?: string
          workflow?: string
        }
        Relationships: []
      }
      cognitive_load: {
        Row: {
          avg_pr_age_days: number
          created_at: string
          details: Json
          id: string
          issues_in_progress: number
          open_prs: number
          recorded_at: string
          rework_rate: number
          score: number
        }
        Insert: {
          avg_pr_age_days?: number
          created_at?: string
          details?: Json
          id?: string
          issues_in_progress?: number
          open_prs?: number
          recorded_at: string
          rework_rate?: number
          score: number
        }
        Update: {
          avg_pr_age_days?: number
          created_at?: string
          details?: Json
          id?: string
          issues_in_progress?: number
          open_prs?: number
          recorded_at?: string
          rework_rate?: number
          score?: number
        }
        Relationships: []
      }
      creature_status_history: {
        Row: {
          changed_at: string
          creature_id: string
          from_status: string | null
          id: string
          note: string | null
          to_status: string
        }
        Insert: {
          changed_at?: string
          creature_id: string
          from_status?: string | null
          id?: string
          note?: string | null
          to_status: string
        }
        Update: {
          changed_at?: string
          creature_id?: string
          from_status?: string | null
          id?: string
          note?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "creature_status_history_creature_id_fkey"
            columns: ["creature_id"]
            isOneToOne: false
            referencedRelation: "creature_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      creature_submissions: {
        Row: {
          approved: boolean
          approved_at: string | null
          art_credit: string | null
          art_path: string | null
          audio_description: string | null
          balance_notes: string | null
          balance_tier: string | null
          behaviour_notes: string | null
          behaviour_threat: string | null
          biome_affinity: string[] | null
          completion_score: number | null
          contact_email: string | null
          created_at: string
          creator_name: string
          creature_name: string
          credits_opt_in: boolean
          entity_id: string | null
          food_notes: string | null
          graphics_difficulty: number | null
          graphics_notes: string | null
          habitat_biome: string[] | null
          habitat_climate: string | null
          habitat_notes: string | null
          id: string
          kind_diet: string | null
          kind_movement: string[] | null
          kind_size: string | null
          kind_solitary: boolean | null
          license_accepted: boolean
          license_version: string
          lore_description: string | null
          lore_entry_id: string | null
          lore_entry_url: string | null
          lore_origin: string | null
          maker_age: number | null
          moderation_note: string | null
          parental_consent: boolean
          queue_priority: number | null
          queued_at: string | null
          rejected_at: string | null
          shipped_at: string | null
          slug: string | null
          special_ability: string | null
          status: string
          status_changed_at: string | null
          tracker_issue_number: number | null
          visual_description: string | null
          world_name: string | null
        }
        Insert: {
          approved?: boolean
          approved_at?: string | null
          art_credit?: string | null
          art_path?: string | null
          audio_description?: string | null
          balance_notes?: string | null
          balance_tier?: string | null
          behaviour_notes?: string | null
          behaviour_threat?: string | null
          biome_affinity?: string[] | null
          completion_score?: number | null
          contact_email?: string | null
          created_at?: string
          creator_name: string
          creature_name: string
          credits_opt_in?: boolean
          entity_id?: string | null
          food_notes?: string | null
          graphics_difficulty?: number | null
          graphics_notes?: string | null
          habitat_biome?: string[] | null
          habitat_climate?: string | null
          habitat_notes?: string | null
          id?: string
          kind_diet?: string | null
          kind_movement?: string[] | null
          kind_size?: string | null
          kind_solitary?: boolean | null
          license_accepted: boolean
          license_version: string
          lore_description?: string | null
          lore_entry_id?: string | null
          lore_entry_url?: string | null
          lore_origin?: string | null
          maker_age?: number | null
          moderation_note?: string | null
          parental_consent: boolean
          queue_priority?: number | null
          queued_at?: string | null
          rejected_at?: string | null
          shipped_at?: string | null
          slug?: string | null
          special_ability?: string | null
          status?: string
          status_changed_at?: string | null
          tracker_issue_number?: number | null
          visual_description?: string | null
          world_name?: string | null
        }
        Update: {
          approved?: boolean
          approved_at?: string | null
          art_credit?: string | null
          art_path?: string | null
          audio_description?: string | null
          balance_notes?: string | null
          balance_tier?: string | null
          behaviour_notes?: string | null
          behaviour_threat?: string | null
          biome_affinity?: string[] | null
          completion_score?: number | null
          contact_email?: string | null
          created_at?: string
          creator_name?: string
          creature_name?: string
          credits_opt_in?: boolean
          entity_id?: string | null
          food_notes?: string | null
          graphics_difficulty?: number | null
          graphics_notes?: string | null
          habitat_biome?: string[] | null
          habitat_climate?: string | null
          habitat_notes?: string | null
          id?: string
          kind_diet?: string | null
          kind_movement?: string[] | null
          kind_size?: string | null
          kind_solitary?: boolean | null
          license_accepted?: boolean
          license_version?: string
          lore_description?: string | null
          lore_entry_id?: string | null
          lore_entry_url?: string | null
          lore_origin?: string | null
          maker_age?: number | null
          moderation_note?: string | null
          parental_consent?: boolean
          queue_priority?: number | null
          queued_at?: string | null
          rejected_at?: string | null
          shipped_at?: string | null
          slug?: string | null
          special_ability?: string | null
          status?: string
          status_changed_at?: string | null
          tracker_issue_number?: number | null
          visual_description?: string | null
          world_name?: string | null
        }
        Relationships: []
      }
      deploy_health: {
        Row: {
          checked_at: string
          deploy_id: string
          deploy_time: string
          error_spike_pct: number | null
          healthy: boolean
          id: string
          linear_identifier: string | null
          linear_issue_id: string | null
          new_error_types: string[] | null
          post_error_count: number | null
          pre_error_count: number | null
        }
        Insert: {
          checked_at?: string
          deploy_id: string
          deploy_time: string
          error_spike_pct?: number | null
          healthy: boolean
          id?: string
          linear_identifier?: string | null
          linear_issue_id?: string | null
          new_error_types?: string[] | null
          post_error_count?: number | null
          pre_error_count?: number | null
        }
        Update: {
          checked_at?: string
          deploy_id?: string
          deploy_time?: string
          error_spike_pct?: number | null
          healthy?: boolean
          id?: string
          linear_identifier?: string | null
          linear_issue_id?: string | null
          new_error_types?: string[] | null
          post_error_count?: number | null
          pre_error_count?: number | null
        }
        Relationships: []
      }
      error_metrics: {
        Row: {
          id: string
          linear_issues_filed: number
          recorded_at: string
          top_errors: Json
          top_warns: Json
          total_error_occurrences: number
          total_warn_occurrences: number
          unique_errors: number
          unique_warns: number
          window_hours: number
        }
        Insert: {
          id?: string
          linear_issues_filed?: number
          recorded_at?: string
          top_errors?: Json
          top_warns?: Json
          total_error_occurrences?: number
          total_warn_occurrences?: number
          unique_errors?: number
          unique_warns?: number
          window_hours?: number
        }
        Update: {
          id?: string
          linear_issues_filed?: number
          recorded_at?: string
          top_errors?: Json
          top_warns?: Json
          total_error_occurrences?: number
          total_warn_occurrences?: number
          unique_errors?: number
          unique_warns?: number
          window_hours?: number
        }
        Relationships: []
      }
      matlu_feedback: {
        Row: {
          created_at: string | null
          feedback_text: string
          game_version: string
          id: string
          session_id: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string | null
          feedback_text: string
          game_version: string
          id?: string
          session_id?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string | null
          feedback_text?: string
          game_version?: string
          id?: string
          session_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      matlu_runs: {
        Row: {
          created_at: string | null
          duration_ms: number | null
          id: string
          nickname: string
          score: number
        }
        Insert: {
          created_at?: string | null
          duration_ms?: number | null
          id?: string
          nickname?: string
          score?: number
        }
        Update: {
          created_at?: string | null
          duration_ms?: number | null
          id?: string
          nickname?: string
          score?: number
        }
        Relationships: []
      }
      stats_weekly: {
        Row: {
          active_days: number | null
          agent_failure_rate_pct: number | null
          agent_issues_processed: number | null
          agent_outcome_by_type: Json | null
          agent_outcome_failed: number | null
          agent_outcome_partial: number | null
          agent_outcome_success: number | null
          agent_outcome_wrong_interp: number | null
          agent_pr_share_pct: number | null
          agent_prs: number | null
          agent_success_rate_pct: number | null
          ai_cache_read_tokens: number | null
          ai_cache_write_tokens: number | null
          ai_input_tokens: number | null
          ai_output_tokens: number | null
          ai_sessions: number | null
          ai_total_cost_usd: number | null
          ai_total_tokens: number | null
          any_count: number | null
          avg_cycle_time_days: number | null
          avg_merge_time_hours: number | null
          avg_pr_size: number | null
          bundle_css_kb: number | null
          bundle_gzip_kb: number | null
          bundle_js_kb: number | null
          bundle_total_kb: number | null
          cfr_pct: number | null
          ci_pass_rate_pct: number | null
          cognitive_load_top_file: string | null
          cognitive_load_top_score: number | null
          cognitive_load_top10: Json | null
          cognitive_load_total: number | null
          content: string
          created_at: string | null
          deploys_last_week: number | null
          deploys_this_week: number | null
          failed_deploys: number | null
          fix_revert_count: number | null
          fix_revert_pct: number | null
          human_prs: number | null
          id: string
          issues_completed: number | null
          lead_time_avg_days: number | null
          lead_time_count: number | null
          lead_time_p90_days: number | null
          lead_time_prev_avg: number | null
          lead_time_trend: string | null
          lines_added: number | null
          lines_deleted: number | null
          metrics: Json | null
          mttr_hours: number | null
          new_file_count: number | null
          pixellab_balance_usd: number | null
          prs_merged: number | null
          rework_file_count: number | null
          rework_rate_pct: number | null
          slug: string
          test_file_count: number | null
          title: string
          todo_count: number | null
          top_rework_file: string | null
          top_rework_hits: number | null
          total_checked_deploys: number | null
          total_commits: number | null
          total_files_changed: number | null
          ts_file_count: number | null
          ts_ignore_count: number | null
          week_of: string
        }
        Insert: {
          active_days?: number | null
          agent_failure_rate_pct?: number | null
          agent_issues_processed?: number | null
          agent_outcome_by_type?: Json | null
          agent_outcome_failed?: number | null
          agent_outcome_partial?: number | null
          agent_outcome_success?: number | null
          agent_outcome_wrong_interp?: number | null
          agent_pr_share_pct?: number | null
          agent_prs?: number | null
          agent_success_rate_pct?: number | null
          ai_cache_read_tokens?: number | null
          ai_cache_write_tokens?: number | null
          ai_input_tokens?: number | null
          ai_output_tokens?: number | null
          ai_sessions?: number | null
          ai_total_cost_usd?: number | null
          ai_total_tokens?: number | null
          any_count?: number | null
          avg_cycle_time_days?: number | null
          avg_merge_time_hours?: number | null
          avg_pr_size?: number | null
          bundle_css_kb?: number | null
          bundle_gzip_kb?: number | null
          bundle_js_kb?: number | null
          bundle_total_kb?: number | null
          cfr_pct?: number | null
          ci_pass_rate_pct?: number | null
          cognitive_load_top_file?: string | null
          cognitive_load_top_score?: number | null
          cognitive_load_top10?: Json | null
          cognitive_load_total?: number | null
          content: string
          created_at?: string | null
          deploys_last_week?: number | null
          deploys_this_week?: number | null
          failed_deploys?: number | null
          fix_revert_count?: number | null
          fix_revert_pct?: number | null
          human_prs?: number | null
          id?: string
          issues_completed?: number | null
          lead_time_avg_days?: number | null
          lead_time_count?: number | null
          lead_time_p90_days?: number | null
          lead_time_prev_avg?: number | null
          lead_time_trend?: string | null
          lines_added?: number | null
          lines_deleted?: number | null
          metrics?: Json | null
          mttr_hours?: number | null
          new_file_count?: number | null
          pixellab_balance_usd?: number | null
          prs_merged?: number | null
          rework_file_count?: number | null
          rework_rate_pct?: number | null
          slug: string
          test_file_count?: number | null
          title: string
          todo_count?: number | null
          top_rework_file?: string | null
          top_rework_hits?: number | null
          total_checked_deploys?: number | null
          total_commits?: number | null
          total_files_changed?: number | null
          ts_file_count?: number | null
          ts_ignore_count?: number | null
          week_of: string
        }
        Update: {
          active_days?: number | null
          agent_failure_rate_pct?: number | null
          agent_issues_processed?: number | null
          agent_outcome_by_type?: Json | null
          agent_outcome_failed?: number | null
          agent_outcome_partial?: number | null
          agent_outcome_success?: number | null
          agent_outcome_wrong_interp?: number | null
          agent_pr_share_pct?: number | null
          agent_prs?: number | null
          agent_success_rate_pct?: number | null
          ai_cache_read_tokens?: number | null
          ai_cache_write_tokens?: number | null
          ai_input_tokens?: number | null
          ai_output_tokens?: number | null
          ai_sessions?: number | null
          ai_total_cost_usd?: number | null
          ai_total_tokens?: number | null
          any_count?: number | null
          avg_cycle_time_days?: number | null
          avg_merge_time_hours?: number | null
          avg_pr_size?: number | null
          bundle_css_kb?: number | null
          bundle_gzip_kb?: number | null
          bundle_js_kb?: number | null
          bundle_total_kb?: number | null
          cfr_pct?: number | null
          ci_pass_rate_pct?: number | null
          cognitive_load_top_file?: string | null
          cognitive_load_top_score?: number | null
          cognitive_load_top10?: Json | null
          cognitive_load_total?: number | null
          content?: string
          created_at?: string | null
          deploys_last_week?: number | null
          deploys_this_week?: number | null
          failed_deploys?: number | null
          fix_revert_count?: number | null
          fix_revert_pct?: number | null
          human_prs?: number | null
          id?: string
          issues_completed?: number | null
          lead_time_avg_days?: number | null
          lead_time_count?: number | null
          lead_time_p90_days?: number | null
          lead_time_prev_avg?: number | null
          lead_time_trend?: string | null
          lines_added?: number | null
          lines_deleted?: number | null
          metrics?: Json | null
          mttr_hours?: number | null
          new_file_count?: number | null
          pixellab_balance_usd?: number | null
          prs_merged?: number | null
          rework_file_count?: number | null
          rework_rate_pct?: number | null
          slug?: string
          test_file_count?: number | null
          title?: string
          todo_count?: number | null
          top_rework_file?: string | null
          top_rework_hits?: number | null
          total_checked_deploys?: number | null
          total_commits?: number | null
          total_files_changed?: number | null
          ts_file_count?: number | null
          ts_ignore_count?: number | null
          week_of?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      creature_queue_priority: {
        Args: { c: Database["public"]["Tables"]["creature_submissions"]["Row"] }
        Returns: number
      }
      creature_status_transition_allowed: {
        Args: { from_s: string; to_s: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

// ── Convenience aliases ───────────────────────────────────────────────────────

export type MatluRun          = Tables<'matlu_runs'>;
export type MatluRunInsert    = TablesInsert<'matlu_runs'>;
export type MatluFeedbackInsert = TablesInsert<'matlu_feedback'>;
export type CreatureSubmission = Tables<'creature_submissions'>;
export type CreatureStatusHistory = Tables<'creature_status_history'>;
