export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.17'
  }
  public: {
    Tables: {
      account_controls: {
        Row: {
          ban_reason: string | null
          banned_at: string | null
          banned_by: string | null
          is_banned: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          ban_reason?: string | null
          banned_at?: string | null
          banned_by?: string | null
          is_banned?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          ban_reason?: string | null
          banned_at?: string | null
          banned_by?: string | null
          is_banned?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      homework_solution_access: {
        Row: {
          idempotency_key: string
          purchased_at: string
          solution_id: string
          user_id: string
        }
        Insert: {
          idempotency_key: string
          purchased_at?: string
          solution_id: string
          user_id: string
        }
        Update: {
          idempotency_key?: string
          purchased_at?: string
          solution_id?: string
          user_id?: string
        }
        Relationships: []
      }
      homework_solution_catalog: {
        Row: {
          condition_normalized: string
          created_at: string
          source_page: number | null
          source_url: string
          solution_id: string
          subject: string
          task: string
          textbook_edition: string
          textbook_id: string
          textbook_title: string
        }
        Insert: {
          condition_normalized: string
          created_at?: string
          source_page?: number | null
          source_url: string
          solution_id: string
          subject: string
          task: string
          textbook_edition: string
          textbook_id: string
          textbook_title: string
        }
        Update: {
          condition_normalized?: string
          created_at?: string
          source_page?: number | null
          source_url?: string
          solution_id?: string
          subject?: string
          task?: string
          textbook_edition?: string
          textbook_id?: string
          textbook_title?: string
        }
        Relationships: []
      }
      homework_solutions: {
        Row: {
          condition_normalized: string
          created_at: string
          created_by: string | null
          id: string
          solution: Json
          source_page: number | null
          source: string
          source_url: string
          subject: string
          task: string
          textbook_edition: string
          textbook_id: string
          textbook_title: string
        }
        Insert: {
          condition_normalized: string
          created_at?: string
          created_by?: string | null
          id?: string
          solution: Json
          source_page?: number | null
          source: string
          source_url: string
          subject: string
          task: string
          textbook_edition: string
          textbook_id: string
          textbook_title: string
        }
        Update: {
          condition_normalized?: string
          created_at?: string
          created_by?: string | null
          id?: string
          solution?: Json
          source_page?: number | null
          source?: string
          source_url?: string
          subject?: string
          task?: string
          textbook_edition?: string
          textbook_id?: string
          textbook_title?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          full_name: string
          grade: number
          id: string
          last_seen_at: string | null
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          full_name?: string
          grade?: number
          id: string
          last_seen_at?: string | null
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          full_name?: string
          grade?: number
          id?: string
          last_seen_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_schedules: {
        Row: {
          entries: Json
          time_slots: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          entries?: Json
          time_slots?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          entries?: Json
          time_slots?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wallet_accounts: {
        Row: {
          balance: number
          created_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wallet_entries: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          idempotency_key: string
          kind: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          idempotency_key: string
          kind: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          idempotency_key?: string
          kind?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      admin_adjust_balance: {
        Args: { p_amount: number; p_reason: string; p_user_id: string }
        Returns: Json
      }
      admin_dashboard: {
        Args: { p_period_days?: number }
        Returns: Json
      }
      admin_list_users: {
        Args: { p_limit?: number; p_search?: string }
        Returns: Json
      }
      admin_set_user_ban: {
        Args: { p_is_banned: boolean; p_reason?: string; p_user_id: string }
        Returns: Json
      }
      admin_user_detail: {
        Args: { p_user_id: string }
        Returns: Json
      }
      complete_homework_solution: {
        Args: {
          p_condition: string
          p_condition_normalized: string
          p_edition: string
          p_idempotency_key: string
          p_solution?: Json | null
          p_source_page: number | null
          p_source_url: string
          p_source: string
          p_task: string
          p_textbook_id: string
        }
        Returns: Json
      }
      spend_solution_credit: {
        Args: {
          p_description?: string
          p_idempotency_key: string
          p_source?: string
          p_task_number?: number | null
          p_textbook_id?: string | null
        }
        Returns: number
      }
      get_admin_context: {
        Args: never
        Returns: Json
      }
      track_my_activity: {
        Args: { p_event: string; p_path?: string }
        Returns: undefined
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

export type Profile = Database['public']['Tables']['profiles']['Row']
export type AccountControl = Database['public']['Tables']['account_controls']['Row']
export type WalletEntry = Database['public']['Tables']['wallet_entries']['Row']
