/**
 * Hand-maintained mirror of the Supabase schema in `supabase/migrations/`.
 *
 * Regenerate with `npm run db:types` once the project is linked; the shape
 * below is the contract every feature module codes against.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      hospitals: {
        Row: {
          id: string
          name: string
          code: string
          level: string
          address: string | null
          city: string | null
          region: string | null
          country: string
          latitude: number
          longitude: number
          phone: string | null
          emergency_phone: string | null
          email: string | null
          timezone: string
          is_active: boolean
          accepts_referrals: boolean
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          code: string
          level?: string
          address?: string | null
          city?: string | null
          region?: string | null
          country?: string
          latitude: number
          longitude: number
          phone?: string | null
          emergency_phone?: string | null
          email?: string | null
          timezone?: string
          is_active?: boolean
          accepts_referrals?: boolean
          notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['hospitals']['Insert']>
        Relationships: []
      }

      departments: {
        Row: {
          id: string
          hospital_id: string
          name: string
          template_key: string
          contact_phone: string | null
          requires_shift_update: boolean
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          hospital_id: string
          name: string
          template_key: string
          contact_phone?: string | null
          requires_shift_update?: boolean
          is_active?: boolean
        }
        Update: Partial<Database['public']['Tables']['departments']['Insert']>
        Relationships: []
      }

      profiles: {
        Row: {
          id: string
          full_name: string
          email: string
          phone: string | null
          role: string
          hospital_id: string | null
          department_id: string | null
          is_active: boolean
          must_change_password: boolean
          last_login_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name: string
          email: string
          phone?: string | null
          role?: string
          hospital_id?: string | null
          department_id?: string | null
          is_active?: boolean
          must_change_password?: boolean
          last_login_at?: string | null
        }
        Update: Partial<Omit<Database['public']['Tables']['profiles']['Insert'], 'id'>>
        Relationships: []
      }

      hospital_resources: {
        Row: {
          hospital_id: string
          er_open: boolean
          diversion_reason: string | null
          operating_rooms_total: number
          operating_rooms_functional: number
          resident_surgeon_available: boolean
          anesthetist_available: boolean
          obstetric_theatre_available: boolean
          neurosurgery_available: boolean
          cath_lab_available: boolean
          icu_beds_total: number
          icu_beds_available: number
          nicu_beds_total: number
          nicu_beds_available: number
          neonatal_resuscitation_available: boolean
          ventilators_total: number
          ventilators_available: number
          oxygen_supply_percent: number
          isolation_beds_available: number
          general_beds_total: number
          general_beds_available: number
          burn_unit_available: boolean
          dialysis_available: boolean
          blood_bank_functional: boolean
          ct_functional: boolean
          mri_functional: boolean
          xray_functional: boolean
          ultrasound_functional: boolean
          ambulances_available: number
          power_backup_available: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: { hospital_id: string } & Partial<
          Omit<Database['public']['Tables']['hospital_resources']['Row'], 'hospital_id'>
        >
        Update: Partial<Database['public']['Tables']['hospital_resources']['Row']>
        Relationships: []
      }

      blood_stock: {
        Row: {
          hospital_id: string
          blood_group: string
          units: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          hospital_id: string
          blood_group: string
          units?: number
          updated_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['blood_stock']['Insert']>
        Relationships: []
      }

      readiness_updates: {
        Row: {
          id: string
          hospital_id: string
          department_id: string
          shift_date: string
          shift_type: string
          submitted_by: string | null
          submitted_at: string
          payload: Json
          notes: string | null
        }
        Insert: {
          id?: string
          hospital_id: string
          department_id: string
          shift_date: string
          shift_type: string
          submitted_by?: string | null
          payload: Json
          notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['readiness_updates']['Insert']>
        Relationships: []
      }

      emergency_types: {
        Row: {
          id: string
          code: string
          name: string
          category: string
          description: string | null
          default_urgency: string
          sort_order: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          code: string
          name: string
          category: string
          description?: string | null
          default_urgency?: string
          sort_order?: number
          is_active?: boolean
        }
        Update: Partial<Database['public']['Tables']['emergency_types']['Insert']>
        Relationships: []
      }

      emergency_requirements: {
        Row: {
          id: string
          emergency_type_id: string
          resource_key: string
          weight: number
          is_critical: boolean
          min_quantity: number
        }
        Insert: {
          id?: string
          emergency_type_id: string
          resource_key: string
          weight?: number
          is_critical?: boolean
          min_quantity?: number
        }
        Update: Partial<Database['public']['Tables']['emergency_requirements']['Insert']>
        Relationships: []
      }

      referrals: {
        Row: {
          id: string
          reference_number: string
          requesting_hospital_id: string
          receiving_hospital_id: string | null
          emergency_type_id: string
          urgency: string
          status: string
          patient_ref: string
          patient_age_band: string
          patient_sex: string
          clinical_summary: string
          required_resources: string[]
          score_snapshot: Json
          candidate_snapshot: Json
          distance_km: number | null
          eta_minutes: number | null
          requested_by: string | null
          requested_at: string
          responded_by: string | null
          responded_at: string | null
          response_seconds: number | null
          accepted_at: string | null
          in_transit_at: string | null
          completed_at: string | null
          cancelled_at: string | null
          decline_reason: string | null
          outcome: string | null
          outcome_notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          reference_number?: string
          requesting_hospital_id: string
          receiving_hospital_id?: string | null
          emergency_type_id: string
          urgency?: string
          status?: string
          patient_ref: string
          patient_age_band: string
          patient_sex?: string
          clinical_summary: string
          required_resources?: string[]
          score_snapshot?: Json
          candidate_snapshot?: Json
          distance_km?: number | null
          eta_minutes?: number | null
          requested_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['referrals']['Insert']>
        Relationships: []
      }

      referral_events: {
        Row: {
          id: string
          referral_id: string
          event_type: string
          from_status: string | null
          to_status: string | null
          actor_id: string | null
          actor_hospital_id: string | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          referral_id: string
          event_type: string
          from_status?: string | null
          to_status?: string | null
          actor_id?: string | null
          actor_hospital_id?: string | null
          notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['referral_events']['Insert']>
        Relationships: []
      }

      messages: {
        Row: {
          id: string
          referral_id: string
          sender_id: string | null
          sender_hospital_id: string | null
          body: string
          created_at: string
        }
        Insert: {
          id?: string
          referral_id: string
          sender_id?: string | null
          sender_hospital_id?: string | null
          body: string
        }
        Update: Partial<Database['public']['Tables']['messages']['Insert']>
        Relationships: []
      }

      message_receipts: {
        Row: { message_id: string; user_id: string; read_at: string }
        Insert: { message_id: string; user_id: string; read_at?: string }
        Update: Partial<Database['public']['Tables']['message_receipts']['Insert']>
        Relationships: []
      }

      notifications: {
        Row: {
          id: string
          user_id: string
          hospital_id: string | null
          type: string
          title: string
          body: string | null
          link: string | null
          severity: string
          is_read: boolean
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          hospital_id?: string | null
          type: string
          title: string
          body?: string | null
          link?: string | null
          severity?: string
          is_read?: boolean
        }
        Update: Partial<Database['public']['Tables']['notifications']['Insert']>
        Relationships: []
      }

      audit_logs: {
        Row: {
          id: string
          actor_id: string | null
          actor_email: string | null
          actor_role: string | null
          hospital_id: string | null
          action: string
          entity_type: string | null
          entity_id: string | null
          details: Json
          created_at: string
        }
        Insert: {
          id?: string
          actor_id?: string | null
          actor_email?: string | null
          actor_role?: string | null
          hospital_id?: string | null
          action: string
          entity_type?: string | null
          entity_id?: string | null
          details?: Json
        }
        Update: Partial<Database['public']['Tables']['audit_logs']['Insert']>
        Relationships: []
      }

      scoring_config: {
        Row: {
          id: number
          resource_weight: number
          proximity_weight: number
          yellow_penalty: number
          red_penalty: number
          max_eta_minutes: number
          max_distance_km: number
          road_distance_factor: number
          fixed_transport_overhead_minutes: number
          tie_break_epsilon: number
          exclude_red_hospitals: boolean
          exclude_hospitals_on_diversion: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: Partial<Database['public']['Tables']['scoring_config']['Row']>
        Update: Partial<Database['public']['Tables']['scoring_config']['Row']>
        Relationships: []
      }
    }

    Views: {
      department_readiness: {
        Row: {
          department_id: string
          hospital_id: string
          department_name: string
          template_key: string
          requires_shift_update: boolean
          last_submitted_at: string | null
          last_shift_date: string | null
          last_shift_type: string | null
          last_submitted_by: string | null
          last_submitted_by_name: string | null
        }
        Relationships: []
      }
    }

    Functions: {
      get_referral_candidates: {
        Args: {
          p_origin_hospital_id: string
          p_emergency_type_id: string
          p_max_km?: number
        }
        Returns: ReferralCandidateRow[]
      }
      submit_readiness: {
        Args: {
          p_department_id: string
          p_payload: Json
          p_blood_stock?: Json
          p_notes?: string | null
        }
        Returns: Json
      }
      create_referral: {
        Args: {
          p_receiving_hospital_id: string
          p_emergency_type_id: string
          p_urgency: string
          p_patient_ref: string
          p_patient_age_band: string
          p_patient_sex: string
          p_clinical_summary: string
          p_required_resources: string[]
          p_score_snapshot: Json
          p_candidate_snapshot: Json
          p_distance_km: number | null
          p_eta_minutes: number | null
        }
        Returns: Json
      }
      update_referral_status: {
        Args: {
          p_referral_id: string
          p_status: string
          p_notes?: string | null
          p_outcome?: string | null
        }
        Returns: Json
      }
      flag_overdue_readiness: { Args: Record<string, never>; Returns: number }
      hospital_performance: {
        Args: { p_hospital_id?: string | null; p_from?: string | null; p_to?: string | null }
        Returns: HospitalPerformanceRow[]
      }
      referral_analytics: {
        Args: { p_hospital_id?: string | null; p_from?: string | null; p_to?: string | null }
        Returns: Json
      }
      compliance_report: {
        Args: { p_hospital_id?: string | null; p_days?: number }
        Returns: ComplianceRow[]
      }
      /** Null for an unauthenticated or deactivated caller. */
      current_user_role: { Args: Record<string, never>; Returns: string | null }
      /** Null until an administrator attaches the profile to a hospital. */
      current_user_hospital: { Args: Record<string, never>; Returns: string | null }
      /** Stamps `profiles.last_login_at` and writes an `auth.login` audit row. */
      record_login: { Args: Record<string, never>; Returns: undefined }
      log_audit_event: {
        Args: {
          p_action: string
          p_entity_type?: string | null
          p_entity_id?: string | null
          p_details?: Json
        }
        Returns: undefined
      }
      mark_notifications_read: {
        Args: { p_ids?: string[] | null }
        Returns: number
      }
    }

    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

/** Row shape returned by `get_referral_candidates`. */
export interface ReferralCandidateRow {
  hospital_id: string
  name: string
  code: string
  level: string
  city: string | null
  region: string | null
  phone: string | null
  emergency_phone: string | null
  email: string | null
  latitude: number
  longitude: number
  timezone: string
  distance_km: number
  accepts_referrals: boolean

  er_open: boolean
  diversion_reason: string | null

  operating_rooms_total: number
  operating_rooms_functional: number
  resident_surgeon_available: boolean
  anesthetist_available: boolean
  obstetric_theatre_available: boolean
  neurosurgery_available: boolean
  cath_lab_available: boolean
  icu_beds_total: number
  icu_beds_available: number
  nicu_beds_total: number
  nicu_beds_available: number
  neonatal_resuscitation_available: boolean
  ventilators_total: number
  ventilators_available: number
  oxygen_supply_percent: number
  isolation_beds_available: number
  general_beds_total: number
  general_beds_available: number
  burn_unit_available: boolean
  dialysis_available: boolean
  blood_bank_functional: boolean
  ct_functional: boolean
  mri_functional: boolean
  xray_functional: boolean
  ultrasound_functional: boolean
  ambulances_available: number
  power_backup_available: boolean

  resources_updated_at: string | null
  /** Oldest "last update" across the hospital's departments that owe an update. */
  oldest_department_update_at: string | null
  departments_total: number
  departments_reporting: number

  blood_units_total: number
  blood_stock: Json

  /** Historical performance, used only for tie-breaking. */
  referrals_received: number
  referrals_accepted: number
  avg_response_seconds: number | null
}

export interface HospitalPerformanceRow {
  hospital_id: string
  hospital_name: string
  referrals_sent: number
  referrals_received: number
  referrals_accepted: number
  referrals_declined: number
  referrals_completed: number
  acceptance_rate: number
  avg_response_seconds: number | null
  avg_completion_minutes: number | null
  compliance_rate: number
}

export interface ComplianceRow {
  hospital_id: string
  hospital_name: string
  department_id: string
  department_name: string
  expected_updates: number
  actual_updates: number
  compliance_rate: number
  missed_shifts: number
  last_submitted_at: string | null
}

// Convenience aliases -------------------------------------------------------

type PublicSchema = Database['public']

export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row']
export type TablesInsert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Update']
export type Views<T extends keyof PublicSchema['Views']> = PublicSchema['Views'][T]['Row']
