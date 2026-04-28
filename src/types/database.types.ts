/**
 * Supabase Postgres types for this project.
 *
 * Schemas were created with the Supabase MCP tool `apply_migration`:
 *   - `create_matlu_runs`                    — leaderboard table
 *   - `create_matlu_feedback`                — in-game feedback table
 *   - `create_stats_weekly`                  — weekly engineering metrics
 *   - `create_creature_submissions`          — creature wiki submission form (FIL-431)
 *   - `creature_pipeline_state_machine`      — pipeline status columns + history table + trigger (FIL-435)
 *   - `macro_world_tables`                   — ancestries, cultures, architecture, fashion (#793)
 *   - `buildings_archetypes_ancestry_body`    — buildings, population_archetypes, ancestry body columns (#793)
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
      ancestries: {
        Row: {
          anatomy: string | null
          body_plan: string | null
          build: string | null
          clustering: string | null
          created_at: string | null
          description: string | null
          elevation_ideal_max: number | null
          elevation_ideal_min: number | null
          elevation_tol_max: number | null
          elevation_tol_min: number | null
          head: string | null
          id: string
          lifespan: string | null
          mixing_behavior: string | null
          moisture_ideal_max: number | null
          moisture_ideal_min: number | null
          moisture_tol_max: number | null
          moisture_tol_min: number | null
          name: string
          naming_base: string | null
          population_weight: number | null
          senses: string | null
          silhouette: string | null
          slug: string
          sprite_note: string | null
          sprite_resolution: number | null
          surface: string | null
          variation: string | null
        }
        Insert: {
          anatomy?: string | null
          body_plan?: string | null
          build?: string | null
          clustering?: string | null
          created_at?: string | null
          description?: string | null
          elevation_ideal_max?: number | null
          elevation_ideal_min?: number | null
          elevation_tol_max?: number | null
          elevation_tol_min?: number | null
          head?: string | null
          id?: string
          lifespan?: string | null
          mixing_behavior?: string | null
          moisture_ideal_max?: number | null
          moisture_ideal_min?: number | null
          moisture_tol_max?: number | null
          moisture_tol_min?: number | null
          name: string
          naming_base?: string | null
          population_weight?: number | null
          senses?: string | null
          silhouette?: string | null
          slug: string
          sprite_note?: string | null
          sprite_resolution?: number | null
          surface?: string | null
          variation?: string | null
        }
        Update: {
          anatomy?: string | null
          body_plan?: string | null
          build?: string | null
          clustering?: string | null
          created_at?: string | null
          description?: string | null
          elevation_ideal_max?: number | null
          elevation_ideal_min?: number | null
          elevation_tol_max?: number | null
          elevation_tol_min?: number | null
          head?: string | null
          id?: string
          lifespan?: string | null
          mixing_behavior?: string | null
          moisture_ideal_max?: number | null
          moisture_ideal_min?: number | null
          moisture_tol_max?: number | null
          moisture_tol_min?: number | null
          name?: string
          naming_base?: string | null
          population_weight?: number | null
          senses?: string | null
          silhouette?: string | null
          slug?: string
          sprite_note?: string | null
          sprite_resolution?: number | null
          surface?: string | null
          variation?: string | null
        }
        Relationships: []
      }
      ancestry_biome_affinities: {
        Row: {
          ancestry_id: string
          biome_id: string
          score: number
        }
        Insert: {
          ancestry_id: string
          biome_id: string
          score: number
        }
        Update: {
          ancestry_id?: string
          biome_id?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "ancestry_biome_affinities_ancestry_id_fkey"
            columns: ["ancestry_id"]
            isOneToOne: false
            referencedRelation: "ancestries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ancestry_biome_affinities_biome_id_fkey"
            columns: ["biome_id"]
            isOneToOne: false
            referencedRelation: "biomes"
            referencedColumns: ["id"]
          },
        ]
      }
      ancestry_feature_bonuses: {
        Row: {
          ancestry_id: string
          bonus: number
          feature_id: string
        }
        Insert: {
          ancestry_id: string
          bonus: number
          feature_id: string
        }
        Update: {
          ancestry_id?: string
          bonus?: number
          feature_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ancestry_feature_bonuses_ancestry_id_fkey"
            columns: ["ancestry_id"]
            isOneToOne: false
            referencedRelation: "ancestries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ancestry_feature_bonuses_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "geographic_features"
            referencedColumns: ["id"]
          },
        ]
      }
      architecture_blocks: {
        Row: {
          block_type: string
          id: string
          name: string
          sort_order: number | null
          sprite_key: string | null
          style_id: string
        }
        Insert: {
          block_type: string
          id?: string
          name: string
          sort_order?: number | null
          sprite_key?: string | null
          style_id: string
        }
        Update: {
          block_type?: string
          id?: string
          name?: string
          sort_order?: number | null
          sprite_key?: string | null
          style_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "architecture_blocks_style_id_fkey"
            columns: ["style_id"]
            isOneToOne: false
            referencedRelation: "architecture_styles"
            referencedColumns: ["id"]
          },
        ]
      }
      architecture_styles: {
        Row: {
          climate_response: string | null
          construction_method: string | null
          created_at: string | null
          description: string | null
          form_language: string | null
          ground_relation: string | null
          id: string
          name: string
          ornament_level: string | null
          primary_material: string | null
          prompt_keywords: string | null
          real_world_inspiration: string | null
          slug: string
          structural_principle: string | null
          window_style: string | null
        }
        Insert: {
          climate_response?: string | null
          construction_method?: string | null
          created_at?: string | null
          description?: string | null
          form_language?: string | null
          ground_relation?: string | null
          id?: string
          name: string
          ornament_level?: string | null
          primary_material?: string | null
          prompt_keywords?: string | null
          real_world_inspiration?: string | null
          slug: string
          structural_principle?: string | null
          window_style?: string | null
        }
        Update: {
          climate_response?: string | null
          construction_method?: string | null
          created_at?: string | null
          description?: string | null
          form_language?: string | null
          ground_relation?: string | null
          id?: string
          name?: string
          ornament_level?: string | null
          primary_material?: string | null
          prompt_keywords?: string | null
          real_world_inspiration?: string | null
          slug?: string
          structural_principle?: string | null
          window_style?: string | null
        }
        Relationships: []
      }
      biomes: {
        Row: {
          created_at: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      buildings: {
        Row: {
          base_depth_max: number | null
          base_depth_min: number | null
          base_size_max: number | null
          base_size_min: number | null
          category: string | null
          count: Json | null
          created_at: string | null
          height_hint: string | null
          id: string
          lore_hook: string | null
          min_tier: number | null
          name: string
          placement_hints: string[] | null
          role: string | null
          slug: string
          unlock_conditions: Json | null
          zone: string | null
        }
        Insert: {
          base_depth_max?: number | null
          base_depth_min?: number | null
          base_size_max?: number | null
          base_size_min?: number | null
          category?: string | null
          count?: Json | null
          created_at?: string | null
          height_hint?: string | null
          id?: string
          lore_hook?: string | null
          min_tier?: number | null
          name: string
          placement_hints?: string[] | null
          role?: string | null
          slug: string
          unlock_conditions?: Json | null
          zone?: string | null
        }
        Update: {
          base_depth_max?: number | null
          base_depth_min?: number | null
          base_size_max?: number | null
          base_size_min?: number | null
          category?: string | null
          count?: Json | null
          created_at?: string | null
          height_hint?: string | null
          id?: string
          lore_hook?: string | null
          min_tier?: number | null
          name?: string
          placement_hints?: string[] | null
          role?: string | null
          slug?: string
          unlock_conditions?: Json | null
          zone?: string | null
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
          tracker_comment_posted_at: string | null
        }
        Insert: {
          changed_at?: string
          creature_id: string
          from_status?: string | null
          id?: string
          note?: string | null
          to_status: string
          tracker_comment_posted_at?: string | null
        }
        Update: {
          changed_at?: string
          creature_id?: string
          from_status?: string | null
          id?: string
          note?: string | null
          to_status?: string
          tracker_comment_posted_at?: string | null
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
          converted_at: string | null
          created_at: string
          creator_name: string
          creature_name: string
          credits_opt_in: boolean
          entity_class: string | null
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
          linear_issue_id: string | null
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
          converted_at?: string | null
          created_at?: string
          creator_name: string
          creature_name: string
          credits_opt_in?: boolean
          entity_class?: string | null
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
          linear_issue_id?: string | null
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
          converted_at?: string | null
          created_at?: string
          creator_name?: string
          creature_name?: string
          credits_opt_in?: boolean
          entity_class?: string | null
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
          linear_issue_id?: string | null
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
      culture_ancestry_preferences: {
        Row: {
          ancestry_id: string
          culture_id: string
          weight: number
        }
        Insert: {
          ancestry_id: string
          culture_id: string
          weight: number
        }
        Update: {
          ancestry_id?: string
          culture_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "culture_ancestry_preferences_ancestry_id_fkey"
            columns: ["ancestry_id"]
            isOneToOne: false
            referencedRelation: "ancestries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "culture_ancestry_preferences_culture_id_fkey"
            columns: ["culture_id"]
            isOneToOne: false
            referencedRelation: "cultures"
            referencedColumns: ["id"]
          },
        ]
      }
      culture_architecture_assignments: {
        Row: {
          architecture_style_id: string
          culture_id: string
        }
        Insert: {
          architecture_style_id: string
          culture_id: string
        }
        Update: {
          architecture_style_id?: string
          culture_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "culture_architecture_assignments_architecture_style_id_fkey"
            columns: ["architecture_style_id"]
            isOneToOne: false
            referencedRelation: "architecture_styles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "culture_architecture_assignments_culture_id_fkey"
            columns: ["culture_id"]
            isOneToOne: false
            referencedRelation: "cultures"
            referencedColumns: ["id"]
          },
        ]
      }
      culture_trait_assignments: {
        Row: {
          culture_id: string
          trait_id: string
        }
        Insert: {
          culture_id: string
          trait_id: string
        }
        Update: {
          culture_id?: string
          trait_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "culture_trait_assignments_culture_id_fkey"
            columns: ["culture_id"]
            isOneToOne: false
            referencedRelation: "cultures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "culture_trait_assignments_trait_id_fkey"
            columns: ["trait_id"]
            isOneToOne: false
            referencedRelation: "culture_traits"
            referencedColumns: ["id"]
          },
        ]
      }
      culture_traits: {
        Row: {
          created_at: string | null
          description: string
          id: string
          slug: string
        }
        Insert: {
          created_at?: string | null
          description: string
          id?: string
          slug: string
        }
        Update: {
          created_at?: string | null
          description?: string
          id?: string
          slug?: string
        }
        Relationships: []
      }
      cultures: {
        Row: {
          created_at: string | null
          facing_bias: string | null
          hierarchy_scale: number | null
          id: string
          name: string
          organicness: number | null
          perimeter_awareness: number | null
          preferred_shapes: string[] | null
          roof_style: string | null
          slug: string
          spacing: number | null
          street_pattern: string | null
          verticality: number | null
        }
        Insert: {
          created_at?: string | null
          facing_bias?: string | null
          hierarchy_scale?: number | null
          id?: string
          name: string
          organicness?: number | null
          perimeter_awareness?: number | null
          preferred_shapes?: string[] | null
          roof_style?: string | null
          slug: string
          spacing?: number | null
          street_pattern?: string | null
          verticality?: number | null
        }
        Update: {
          created_at?: string | null
          facing_bias?: string | null
          hierarchy_scale?: number | null
          id?: string
          name?: string
          organicness?: number | null
          perimeter_awareness?: number | null
          preferred_shapes?: string[] | null
          roof_style?: string | null
          slug?: string
          spacing?: number | null
          street_pattern?: string | null
          verticality?: number | null
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
      fashion_styles: {
        Row: {
          base_materials: string[] | null
          base_motifs: string[] | null
          base_palette: string[] | null
          created_at: string | null
          culture_id: string
          id: string
          real_world_inspiration: string | null
        }
        Insert: {
          base_materials?: string[] | null
          base_motifs?: string[] | null
          base_palette?: string[] | null
          created_at?: string | null
          culture_id: string
          id?: string
          real_world_inspiration?: string | null
        }
        Update: {
          base_materials?: string[] | null
          base_motifs?: string[] | null
          base_palette?: string[] | null
          created_at?: string | null
          culture_id?: string
          id?: string
          real_world_inspiration?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fashion_styles_culture_id_fkey"
            columns: ["culture_id"]
            isOneToOne: true
            referencedRelation: "cultures"
            referencedColumns: ["id"]
          },
        ]
      }
      fashion_variants: {
        Row: {
          accessories: string[] | null
          fashion_style_id: string
          footwear: string | null
          headwear: string | null
          id: string
          notes: string | null
          role: string
          silhouette: string | null
        }
        Insert: {
          accessories?: string[] | null
          fashion_style_id: string
          footwear?: string | null
          headwear?: string | null
          id?: string
          notes?: string | null
          role: string
          silhouette?: string | null
        }
        Update: {
          accessories?: string[] | null
          fashion_style_id?: string
          footwear?: string | null
          headwear?: string | null
          id?: string
          notes?: string | null
          role?: string
          silhouette?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fashion_variants_fashion_style_id_fkey"
            columns: ["fashion_style_id"]
            isOneToOne: false
            referencedRelation: "fashion_styles"
            referencedColumns: ["id"]
          },
        ]
      }
      geographic_features: {
        Row: {
          created_at: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          slug?: string
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
      population_archetypes: {
        Row: {
          animations: string[] | null
          building_id: string | null
          count_max: number | null
          count_min: number | null
          count_per_tier: Json | null
          created_at: string | null
          fashion_variant: string | null
          id: string
          is_ambient: boolean | null
          name: string
          role: string
          sprite_notes: string | null
        }
        Insert: {
          animations?: string[] | null
          building_id?: string | null
          count_max?: number | null
          count_min?: number | null
          count_per_tier?: Json | null
          created_at?: string | null
          fashion_variant?: string | null
          id?: string
          is_ambient?: boolean | null
          name: string
          role: string
          sprite_notes?: string | null
        }
        Update: {
          animations?: string[] | null
          building_id?: string | null
          count_max?: number | null
          count_min?: number | null
          count_per_tier?: Json | null
          created_at?: string | null
          fashion_variant?: string | null
          id?: string
          is_ambient?: boolean | null
          name?: string
          role?: string
          sprite_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "population_archetypes_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
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

// Convenience aliases used across the codebase
export type MatluRun = Tables<'matlu_runs'>
export type MatluRunInsert = TablesInsert<'matlu_runs'>
export type MatluFeedbackInsert = TablesInsert<'matlu_feedback'>
