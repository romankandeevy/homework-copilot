export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.15'
  }
  public: {
    Tables: {
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
          created_at: string
          solution_id: string
          subject: string
          task: string
          textbook_id: string
          textbook_title: string
        }
        Insert: {
          created_at?: string
          solution_id: string
          subject: string
          task: string
          textbook_id: string
          textbook_title: string
        }
        Update: {
          created_at?: string
          solution_id?: string
          subject?: string
          task?: string
          textbook_id?: string
          textbook_title?: string
        }
        Relationships: []
      }
      homework_solutions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          solution: Json
          source: string
          subject: string
          task: string
          textbook_id: string
          textbook_title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          solution: Json
          source: string
          subject: string
          task: string
          textbook_id: string
          textbook_title: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          solution?: Json
          source?: string
          subject?: string
          task?: string
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
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          full_name?: string
          grade?: number
          id: string
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          full_name?: string
          grade?: number
          id?: string
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
      complete_homework_solution: {
        Args: {
          p_idempotency_key: string
          p_solution?: Json | null
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
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

export type Profile = Database['public']['Tables']['profiles']['Row']
export type WalletEntry = Database['public']['Tables']['wallet_entries']['Row']
