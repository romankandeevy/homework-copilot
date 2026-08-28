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
    PostgrestVersion: "14.17"
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
        Relationships: [
          {
            foreignKeyName: "homework_solution_access_solution_id_fkey"
            columns: ["solution_id"]
            isOneToOne: false
            referencedRelation: "homework_solutions"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_solution_catalog: {
        Row: {
          condition_normalized: string
          created_at: string
          solution_id: string
          source_page: number | null
          source_url: string
          subject: string
          task: string
          textbook_edition: string
          textbook_id: string
          textbook_title: string
        }
        Insert: {
          condition_normalized?: string
          created_at?: string
          solution_id: string
          source_page?: number | null
          source_url?: string
          subject: string
          task: string
          textbook_edition?: string
          textbook_id: string
          textbook_title: string
        }
        Update: {
          condition_normalized?: string
          created_at?: string
          solution_id?: string
          source_page?: number | null
          source_url?: string
          subject?: string
          task?: string
          textbook_edition?: string
          textbook_id?: string
          textbook_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_solution_catalog_solution_id_fkey"
            columns: ["solution_id"]
            isOneToOne: true
            referencedRelation: "homework_solutions"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_acceptances: {
        Row: {
          accepted_at: string
          agreement_version: string
          consent_version: string
          id: string
          privacy_version: string
          source: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          agreement_version: string
          consent_version: string
          id?: string
          privacy_version: string
          source: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          agreement_version?: string
          consent_version?: string
          id?: string
          privacy_version?: string
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      referral_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      referral_invites: {
        Row: {
          created_at: string
          id: string
          invitee_reward_amount: number
          invitee_user_id: string
          invitee_wallet_entry_id: string | null
          qualifying_top_up_id: string | null
          referral_code_id: string
          referrer_reward_amount: number
          referrer_user_id: string
          referrer_wallet_entry_id: string | null
          rewarded_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          invitee_reward_amount?: number
          invitee_user_id: string
          invitee_wallet_entry_id?: string | null
          qualifying_top_up_id?: string | null
          referral_code_id: string
          referrer_reward_amount?: number
          referrer_user_id: string
          referrer_wallet_entry_id?: string | null
          rewarded_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          invitee_reward_amount?: number
          invitee_user_id?: string
          invitee_wallet_entry_id?: string | null
          qualifying_top_up_id?: string | null
          referral_code_id?: string
          referrer_reward_amount?: number
          referrer_user_id?: string
          referrer_wallet_entry_id?: string | null
          rewarded_at?: string | null
          status?: string
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
          source: string
          source_page: number | null
          source_url: string
          subject: string
          task: string
          textbook_edition: string
          textbook_id: string
          textbook_title: string
        }
        Insert: {
          condition_normalized?: string
          created_at?: string
          created_by?: string | null
          id?: string
          solution: Json
          source: string
          source_page?: number | null
          source_url?: string
          subject: string
          task: string
          textbook_edition?: string
          textbook_id: string
          textbook_title: string
        }
        Update: {
          condition_normalized?: string
          created_at?: string
          created_by?: string | null
          id?: string
          solution?: Json
          source?: string
          source_page?: number | null
          source_url?: string
          subject?: string
          task?: string
          textbook_edition?: string
          textbook_id?: string
          textbook_title?: string
        }
        Relationships: []
      }
      support_conversations: {
        Row: {
          category: string
          context: Json
          created_at: string
          id: string
          last_message_at: string
          owner_notification_status: string
          resolved_at: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          context?: Json
          created_at?: string
          id?: string
          last_message_at?: string
          owner_notification_status?: string
          resolved_at?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          context?: Json
          created_at?: string
          id?: string
          last_message_at?: string
          owner_notification_status?: string
          resolved_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          author_type: string
          author_user_id: string | null
          body: string
          conversation_id: string
          created_at: string
          id: string
          source_key: string | null
        }
        Insert: {
          author_type: string
          author_user_id?: string | null
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          source_key?: string | null
        }
        Update: {
          author_type?: string
          author_user_id?: string | null
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          source_key?: string | null
        }
        Relationships: []
      }
      support_telegram_message_map: {
        Row: {
          conversation_id: string
          created_at: string
          direction: string
          telegram_chat_id: number
          telegram_message_id: number
        }
        Insert: {
          conversation_id: string
          created_at?: string
          direction: string
          telegram_chat_id: number
          telegram_message_id: number
        }
        Update: {
          conversation_id?: string
          created_at?: string
          direction?: string
          telegram_chat_id?: number
          telegram_message_id?: number
        }
        Relationships: []
      }
      support_telegram_callback_actions: {
        Row: {
          action: string
          conversation_id: string
          created_at: string
          processed_at: string | null
          status: string
          telegram_chat_id: number
          telegram_message_id: number
          token_hash: string
        }
        Insert: {
          action: string
          conversation_id: string
          created_at?: string
          processed_at?: string | null
          status?: string
          telegram_chat_id: number
          telegram_message_id: number
          token_hash: string
        }
        Update: {
          action?: string
          conversation_id?: string
          created_at?: string
          processed_at?: string | null
          status?: string
          telegram_chat_id?: number
          telegram_message_id?: number
          token_hash?: string
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
      verified_homework_tasks: {
        Row: {
          condition: string
          condition_normalized: string
          diagram_regions: Json
          has_diagram: boolean
          ocr_confidence: number
          solution_payload: Json | null
          source_page: number | null
          source_region: Json
          source_url: string
          task: string
          textbook_edition: string
          textbook_id: string
        }
        Insert: {
          condition: string
          condition_normalized: string
          diagram_regions?: Json
          has_diagram?: boolean
          ocr_confidence: number
          solution_payload?: Json | null
          source_page?: number | null
          source_region: Json
          source_url: string
          task: string
          textbook_edition: string
          textbook_id: string
        }
        Update: {
          condition?: string
          condition_normalized?: string
          diagram_regions?: Json
          has_diagram?: boolean
          ocr_confidence?: number
          solution_payload?: Json | null
          source_page?: number | null
          source_region?: Json
          source_url?: string
          task?: string
          textbook_edition?: string
          textbook_id?: string
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
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_adjust_balance: {
        Args: { p_amount: number; p_reason: string; p_user_id: string }
        Returns: Json
      }
      admin_update_user_profile: {
        Args: { p_full_name: string; p_grade: number; p_user_id: string }
        Returns: Json
      }
      admin_list_solution_library: {
        Args: { p_limit?: number; p_search?: string }
        Returns: Json
      }
      admin_delete_solution: {
        Args: { p_reason: string; p_solution_id: string }
        Returns: Json
      }
      admin_record_verified_top_up: {
        Args: { p_amount: number; p_provider_reference: string; p_user_id: string }
        Returns: Json
      }
      admin_dashboard: { Args: { p_period_days?: number }; Returns: Json }
      admin_list_users: {
        Args: { p_limit?: number; p_search?: string }
        Returns: Json
      }
      admin_set_user_ban: {
        Args: { p_is_banned: boolean; p_reason?: string; p_user_id: string }
        Returns: Json
      }
      admin_user_detail: { Args: { p_user_id: string }; Returns: Json }
      admin_support_list: { Args: { p_limit?: number; p_status?: string | null }; Returns: Json }
      admin_support_detail: { Args: { p_conversation_id: string }; Returns: Json }
      admin_support_update_status: { Args: { p_conversation_id: string; p_status: string }; Returns: Json }
      admin_credit_feature_balance: { Args: { p_amount: number; p_conversation_id: string; p_reason: string }; Returns: Json }
      record_support_idea_telegram_decision: {
        Args: {
          p_action: string
          p_telegram_chat_id: number
          p_telegram_message_id: number
          p_telegram_user_id: number
          p_token_hash: string
        }
        Returns: Json
      }
      complete_homework_solution: {
        Args: {
          p_condition: string
          p_condition_normalized: string
          p_edition: string
          p_idempotency_key: string
          p_solution?: Json
          p_source: string
          p_source_page: number | null
          p_source_url: string
          p_task: string
          p_textbook_id: string
        }
        Returns: Json
      }
      get_admin_context: { Args: never; Returns: Json }
      get_my_referral: { Args: never; Returns: Json }
      bind_my_referral: { Args: { p_code: string }; Returns: Json }
      begin_referral_registration: { Args: { p_code: string }; Returns: Json }
      get_verified_homework_task: {
        Args: {
          p_edition: string
          p_source_url: string
          p_task: string
          p_textbook_id: string
        }
        Returns: {
          condition: string
          condition_normalized: string
          diagram_regions: Json
          has_diagram: boolean
          ocr_confidence: number
          source_page: number
          source_region: Json
          source_url: string
        }[]
      }
      spend_solution_credit: {
        Args: {
          p_description?: string
          p_idempotency_key: string
          p_source?: string
          p_task_number?: number
          p_textbook_id?: string
        }
        Returns: number
      }
      record_current_legal_acceptance: {
        Args: { p_source: string }
        Returns: undefined
      }
      track_my_activity: {
        Args: { p_event: string; p_path?: string }
        Returns: undefined
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

export type Profile = Database['public']['Tables']['profiles']['Row']
export type AccountControl = Database['public']['Tables']['account_controls']['Row']
export type WalletEntry = Database['public']['Tables']['wallet_entries']['Row']
