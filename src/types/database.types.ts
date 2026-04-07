/**
 * Supabase Postgres types for this project.
 *
 * Schema for `matlu_runs` was created with the Supabase MCP tool `apply_migration`
 * (`create_matlu_runs`). Regenerate the full project types in Cursor via MCP
 * `generate_typescript_types` after any DDL change, then replace this file.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.4';
  };
  public: {
    Tables: {
      matlu_runs: {
        Row: {
          created_at: string;
          duration_ms: number | null;
          id: string;
          nickname: string;
          score: number;
          /** Procedural map seed — added by migration 20260407_add_seed_to_runs */
          seed: number | null;
        };
        Insert: {
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          nickname?: string;
          score?: number;
          seed?: number | null;
        };
        Update: {
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          nickname?: string;
          score?: number;
          seed?: number | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export type MatluRun = Database['public']['Tables']['matlu_runs']['Row'];
export type MatluRunInsert = Database['public']['Tables']['matlu_runs']['Insert'];
