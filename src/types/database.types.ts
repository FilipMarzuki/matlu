/**
 * Supabase Postgres types for this project.
 *
 * Schemas were created with the Supabase MCP tool `apply_migration`:
 *   - `create_matlu_runs` — leaderboard table
 *   - `create_matlu_feedback` — in-game feedback table
 *
 * Regenerate the full project types in Cursor via MCP
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
      matlu_feedback: {
        Row: {
          created_at: string;
          feedback_text: string;
          game_version: string;
          id: string;
          session_id: string | null;
          user_agent: string | null;
        };
        Insert: {
          created_at?: string;
          feedback_text: string;
          game_version: string;
          id?: string;
          session_id?: string | null;
          user_agent?: string | null;
        };
        Update: {
          created_at?: string;
          feedback_text?: string;
          game_version?: string;
          id?: string;
          session_id?: string | null;
          user_agent?: string | null;
        };
        Relationships: [];
      };
      matlu_runs: {
        Row: {
          created_at: string;
          duration_ms: number | null;
          id: string;
          nickname: string;
          score: number;
        };
        Insert: {
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          nickname?: string;
          score?: number;
        };
        Update: {
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          nickname?: string;
          score?: number;
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

export type MatluFeedback = Database['public']['Tables']['matlu_feedback']['Row'];
export type MatluFeedbackInsert = Database['public']['Tables']['matlu_feedback']['Insert'];
export type MatluRun = Database['public']['Tables']['matlu_runs']['Row'];
export type MatluRunInsert = Database['public']['Tables']['matlu_runs']['Insert'];
