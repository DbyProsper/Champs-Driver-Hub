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
      branches: {
        Row: {
          address: string
          city: string
          closes_at: string
          created_at: string
          id: string
          is_active: boolean
          latitude: number | null
          longitude: number | null
          name: string
          opens_at: string
          phone: string | null
          postal_code: string
          slug: string
          sort_order: number
          whatsapp: string | null
        }
        Insert: {
          address: string
          city: string
          closes_at?: string
          created_at?: string
          id?: string
          is_active?: boolean
          latitude?: number | null
          longitude?: number | null
          name: string
          opens_at?: string
          phone?: string | null
          postal_code: string
          slug: string
          sort_order?: number
          whatsapp?: string | null
        }
        Update: {
          address?: string
          city?: string
          closes_at?: string
          created_at?: string
          id?: string
          is_active?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string
          opens_at?: string
          phone?: string | null
          postal_code?: string
          slug?: string
          sort_order?: number
          whatsapp?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      deliveries: {
        Row: {
          actual_delivery_time: string | null
          assign_deadline_at: string | null
          batch_id: string | null
          broadcast_at: string | null
          created_at: string
          delivery_fee_cents: number
          distance_km: number | null
          driver_id: string | null
          estimated_eta_max: number | null
          estimated_eta_min: number | null
          id: string
          order_id: string
          payment_reference: string | null
          payment_status: string
          proof_of_payment_url: string | null
          queue_position: number | null
          status: string
          updated_at: string
        }
        Insert: {
          actual_delivery_time?: string | null
          assign_deadline_at?: string | null
          batch_id?: string | null
          broadcast_at?: string | null
          created_at?: string
          delivery_fee_cents?: number
          distance_km?: number | null
          driver_id?: string | null
          estimated_eta_max?: number | null
          estimated_eta_min?: number | null
          id?: string
          order_id: string
          payment_reference?: string | null
          payment_status?: string
          proof_of_payment_url?: string | null
          queue_position?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          actual_delivery_time?: string | null
          assign_deadline_at?: string | null
          batch_id?: string | null
          broadcast_at?: string | null
          created_at?: string
          delivery_fee_cents?: number
          distance_km?: number | null
          driver_id?: string | null
          estimated_eta_max?: number | null
          estimated_eta_min?: number | null
          id?: string
          order_id?: string
          payment_reference?: string | null
          payment_status?: string
          proof_of_payment_url?: string | null
          queue_position?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "delivery_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_batches: {
        Row: {
          created_at: string
          driver_id: string | null
          id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          driver_id?: string | null
          id?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          driver_id?: string | null
          id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_batches_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_settings: {
        Row: {
          avg_stop_min: number
          base_prep_min: number
          id: string
          max_radius_km: number
          max_wait_min: number
          normal_capacity_max: number
          normal_capacity_min: number
          peak_capacity_max: number
          peak_capacity_min: number
          peak_threshold: number
          tier1_fee_cents: number
          tier1_max_km: number
          tier2_fee_cents: number
          tier2_max_km: number
          tier3_fee_cents: number
          tier3_max_km: number
          updated_at: string
        }
        Insert: {
          avg_stop_min?: number
          base_prep_min?: number
          id?: string
          max_radius_km?: number
          max_wait_min?: number
          normal_capacity_max?: number
          normal_capacity_min?: number
          peak_capacity_max?: number
          peak_capacity_min?: number
          peak_threshold?: number
          tier1_fee_cents?: number
          tier1_max_km?: number
          tier2_fee_cents?: number
          tier2_max_km?: number
          tier3_fee_cents?: number
          tier3_max_km?: number
          updated_at?: string
        }
        Update: {
          avg_stop_min?: number
          base_prep_min?: number
          id?: string
          max_radius_km?: number
          max_wait_min?: number
          normal_capacity_max?: number
          normal_capacity_min?: number
          peak_capacity_max?: number
          peak_capacity_min?: number
          peak_threshold?: number
          tier1_fee_cents?: number
          tier1_max_km?: number
          tier2_fee_cents?: number
          tier2_max_km?: number
          tier3_fee_cents?: number
          tier3_max_km?: number
          updated_at?: string
        }
        Relationships: []
      }
      driver_applications: {
        Row: {
          admin_notes: string | null
          bank_account_holder: string | null
          bank_account_number: string | null
          bank_name: string | null
          branch_id: string | null
          created_at: string
          id: string
          name: string
          phone: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          bank_account_holder?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          name: string
          phone: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          bank_account_holder?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          name?: string
          phone?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_applications_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_locations: {
        Row: {
          driver_id: string
          id: string
          latitude: number
          longitude: number
          updated_at: string
        }
        Insert: {
          driver_id: string
          id?: string
          latitude: number
          longitude: number
          updated_at?: string
        }
        Update: {
          driver_id?: string
          id?: string
          latitude?: number
          longitude?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_locations_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          bank_account_holder: string | null
          bank_account_number: string | null
          bank_name: string | null
          branch_id: string | null
          created_at: string
          id: string
          name: string
          phone: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          bank_account_holder?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          name: string
          phone: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          bank_account_holder?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          name?: string
          phone?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          alt: string
          created_at: string
          id: string
          image_key: string
          is_active: boolean
          sort_order: number
          src: string
          title: string
          updated_at: string
          usage: string
        }
        Insert: {
          alt?: string
          created_at?: string
          id?: string
          image_key: string
          is_active?: boolean
          sort_order?: number
          src: string
          title: string
          updated_at?: string
          usage?: string
        }
        Update: {
          alt?: string
          created_at?: string
          id?: string
          image_key?: string
          is_active?: boolean
          sort_order?: number
          src?: string
          title?: string
          updated_at?: string
          usage?: string
        }
        Relationships: []
      }
      menu_items: {
        Row: {
          category_id: string
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_available: boolean
          name: string
          price_cents: number
          sort_order: number
          updated_at: string
          variant_label: string | null
        }
        Insert: {
          category_id: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          name: string
          price_cents: number
          sort_order?: number
          updated_at?: string
          variant_label?: string | null
        }
        Update: {
          category_id?: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          name?: string
          price_cents?: number
          sort_order?: number
          updated_at?: string
          variant_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          item_name: string
          menu_item_id: string | null
          order_id: string
          quantity: number
          unit_price_cents: number
        }
        Insert: {
          created_at?: string
          id?: string
          item_name: string
          menu_item_id?: string | null
          order_id: string
          quantity: number
          unit_price_cents: number
        }
        Update: {
          created_at?: string
          id?: string
          item_name?: string
          menu_item_id?: string | null
          order_id?: string
          quantity?: number
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          branch_id: string
          created_at: string
          customer_name: string
          customer_phone: string
          delivery_address: string | null
          delivery_fee_cents: number
          delivery_lat: number | null
          delivery_lng: number | null
          delivery_notes: string | null
          delivery_status: string | null
          distance_km: number | null
          driver_id: string | null
          fulfillment: Database["public"]["Enums"]["fulfillment_type"]
          id: string
          order_number: string
          pickup_pin: string
          status: Database["public"]["Enums"]["order_status"]
          subtotal_cents: number
          updated_at: string
          user_id: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          branch_id: string
          created_at?: string
          customer_name: string
          customer_phone: string
          delivery_address?: string | null
          delivery_fee_cents?: number
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_notes?: string | null
          delivery_status?: string | null
          distance_km?: number | null
          driver_id?: string | null
          fulfillment: Database["public"]["Enums"]["fulfillment_type"]
          id?: string
          order_number?: string
          pickup_pin: string
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_cents: number
          updated_at?: string
          user_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          branch_id?: string
          created_at?: string
          customer_name?: string
          customer_phone?: string
          delivery_address?: string | null
          delivery_fee_cents?: number
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_notes?: string | null
          delivery_status?: string | null
          distance_km?: number | null
          driver_id?: string | null
          fulfillment?: Database["public"]["Enums"]["fulfillment_type"]
          id?: string
          order_number?: string
          pickup_pin?: string
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_cents?: number
          updated_at?: string
          user_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          favorite_branch_id: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          favorite_branch_id?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          favorite_branch_id?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_favorite_branch_id_fkey"
            columns: ["favorite_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          active_from: string | null
          active_until: string | null
          badge: string | null
          branch_id: string | null
          created_at: string
          day_of_week: number | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          price_cents: number | null
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          active_from?: string | null
          active_until?: string | null
          badge?: string | null
          branch_id?: string | null
          created_at?: string
          day_of_week?: number | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          price_cents?: number | null
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          active_from?: string | null
          active_until?: string | null
          badge?: string | null
          branch_id?: string | null
          created_at?: string
          day_of_week?: number | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          price_cents?: number | null
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      site_settings: {
        Row: {
          hero_body: string
          hero_eyebrow: string
          hero_focus_x: number
          hero_focus_y: number
          hero_image_key: string
          hero_line_one: string
          hero_line_two: string
          id: string
          primary_cta_label: string
          secondary_cta_label: string
          show_branch_info: boolean
          show_brand_strip: boolean
          show_categories: boolean
          show_promotions: boolean
          theme: string
          updated_at: string
        }
        Insert: {
          hero_body?: string
          hero_eyebrow?: string
          hero_focus_x?: number
          hero_focus_y?: number
          hero_image_key?: string
          hero_line_one?: string
          hero_line_two?: string
          id?: string
          primary_cta_label?: string
          secondary_cta_label?: string
          show_branch_info?: boolean
          show_brand_strip?: boolean
          show_categories?: boolean
          show_promotions?: boolean
          theme?: string
          updated_at?: string
        }
        Update: {
          hero_body?: string
          hero_eyebrow?: string
          hero_focus_x?: number
          hero_focus_y?: number
          hero_image_key?: string
          hero_line_one?: string
          hero_line_two?: string
          id?: string
          primary_cta_label?: string
          secondary_cta_label?: string
          show_branch_info?: boolean
          show_brand_strip?: boolean
          show_categories?: boolean
          show_promotions?: boolean
          theme?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_upsert_driver_by_email: {
        Args: {
          _bank_account_holder?: string
          _bank_account_number?: string
          _bank_name?: string
          _branch_id?: string
          _email: string
          _name: string
          _phone: string
        }
        Returns: {
          out_driver_id: string
          out_email: string
          out_user_id: string
        }[]
      }
      approve_driver_application: {
        Args: { _application_id: string }
        Returns: {
          out_driver_id: string
          out_user_id: string
        }[]
      }
      auto_assign_pending_deliveries: { Args: never; Returns: number }
      confirm_delivery_payment: {
        Args: { _delivery_id: string }
        Returns: {
          out_delivery_id: string
          out_payment_status: string
        }[]
      }
      get_driver_profile_for_user: {
        Args: { _user_id: string }
        Returns: {
          bank_account_holder: string
          bank_account_number: string
          bank_name: string
          branch_id: string
          id: string
          name: string
          phone: string
          status: string
        }[]
      }
      get_my_access_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      grant_access_role: {
        Args: { _email: string; _role: Database["public"]["Enums"]["app_role"] }
        Returns: {
          out_email: string
          out_role: Database["public"]["Enums"]["app_role"]
          out_user_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_champs_owner_email: { Args: never; Returns: boolean }
      is_driver: { Args: { _user_id: string }; Returns: boolean }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      online_drivers_count: { Args: never; Returns: number }
      reject_driver_application: {
        Args: { _admin_notes?: string; _application_id: string }
        Returns: {
          out_application_id: string
          out_status: string
        }[]
      }
      request_driver_application: {
        Args: {
          _bank_account_holder?: string
          _bank_account_number?: string
          _bank_name?: string
          _branch_id?: string
          _name: string
          _phone: string
        }
        Returns: {
          out_application_id: string
          out_status: string
        }[]
      }
      submit_delivery_payment: {
        Args: {
          _delivery_id: string
          _payment_reference: string
          _proof_path?: string
        }
        Returns: {
          out_delivery_id: string
          out_payment_status: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "staff" | "user" | "driver"
      fulfillment_type: "pickup" | "delivery"
      order_status:
        | "pending"
        | "preparing"
        | "out_for_delivery"
        | "completed"
        | "cancelled"
        | "ready"
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
    Enums: {
      app_role: ["admin", "staff", "user", "driver"],
      fulfillment_type: ["pickup", "delivery"],
      order_status: [
        "pending",
        "preparing",
        "out_for_delivery",
        "completed",
        "cancelled",
        "ready",
      ],
    },
  },
} as const
