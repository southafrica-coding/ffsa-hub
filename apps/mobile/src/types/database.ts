// GENERATED COPY - do not edit; run npm run types:sync
// Source: src/types/database.ts at the repo root (the web app's Supabase types).

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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      activity_events: {
        Row: {
          contact_id: string
          created_at: string
          event_type: string
          id: string
          occurred_at: string
          payload: Json | null
          related_campaign_id: string | null
          related_form_id: string | null
          related_label_id: string | null
          related_user_id: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          event_type: string
          id?: string
          occurred_at?: string
          payload?: Json | null
          related_campaign_id?: string | null
          related_form_id?: string | null
          related_label_id?: string | null
          related_user_id?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          event_type?: string
          id?: string
          occurred_at?: string
          payload?: Json | null
          related_campaign_id?: string | null
          related_form_id?: string | null
          related_label_id?: string | null
          related_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_audience"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "activity_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_related_campaign_id_fkey"
            columns: ["related_campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_related_form_id_fkey"
            columns: ["related_form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_related_label_id_fkey"
            columns: ["related_label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_related_user_id_fkey"
            columns: ["related_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      application_questions: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_required: boolean
          label: string
          options: Json | null
          parent_question_id: string | null
          program_id: string
          show_when_answer: string | null
          sort_order: number
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_required?: boolean
          label: string
          options?: Json | null
          parent_question_id?: string | null
          program_id: string
          show_when_answer?: string | null
          sort_order?: number
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_required?: boolean
          label?: string
          options?: Json | null
          parent_question_id?: string | null
          program_id?: string
          show_when_answer?: string | null
          sort_order?: number
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_questions_parent_question_id_fkey"
            columns: ["parent_question_id"]
            isOneToOne: false
            referencedRelation: "application_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_questions_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      application_responses: {
        Row: {
          admin_notes: string | null
          answers: Json
          applicant_email: string | null
          applicant_info: Json | null
          assigned_staff_id: string | null
          created_at: string
          id: string
          program_id: string
          references_requested_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          staff_assigned_at: string | null
          staff_assigned_by: string | null
          staff_viewed_at: string | null
          status: string
          status_token: string | null
          submitted_at: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          admin_notes?: string | null
          answers?: Json
          applicant_email?: string | null
          applicant_info?: Json | null
          assigned_staff_id?: string | null
          created_at?: string
          id?: string
          program_id: string
          references_requested_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_assigned_at?: string | null
          staff_assigned_by?: string | null
          staff_viewed_at?: string | null
          status?: string
          status_token?: string | null
          submitted_at?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          admin_notes?: string | null
          answers?: Json
          applicant_email?: string | null
          applicant_info?: Json | null
          assigned_staff_id?: string | null
          created_at?: string
          id?: string
          program_id?: string
          references_requested_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_assigned_at?: string | null
          staff_assigned_by?: string | null
          staff_viewed_at?: string | null
          status?: string
          status_token?: string | null
          submitted_at?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_responses_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_responses_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_responses_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_responses_staff_assigned_by_fkey"
            columns: ["staff_assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_responses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      application_template_questions: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_required: boolean
          label: string
          options: Json | null
          parent_question_id: string | null
          show_when_answer: string | null
          sort_order: number
          template_id: string
          type: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_required?: boolean
          label: string
          options?: Json | null
          parent_question_id?: string | null
          show_when_answer?: string | null
          sort_order?: number
          template_id: string
          type?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_required?: boolean
          label?: string
          options?: Json | null
          parent_question_id?: string | null
          show_when_answer?: string | null
          sort_order?: number
          template_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_template_questions_parent_question_id_fkey"
            columns: ["parent_question_id"]
            isOneToOne: false
            referencedRelation: "application_template_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_template_questions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "application_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      application_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          checked_in_at: string | null
          checked_in_by: string | null
          contact_id: string
          created_at: string
          event_id: string
          id: string
          method: string
          notes: string | null
          status: string
        }
        Insert: {
          checked_in_at?: string | null
          checked_in_by?: string | null
          contact_id: string
          created_at?: string
          event_id: string
          id?: string
          method?: string
          notes?: string | null
          status?: string
        }
        Update: {
          checked_in_at?: string | null
          checked_in_by?: string | null
          contact_id?: string
          created_at?: string
          event_id?: string
          id?: string
          method?: string
          notes?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_checked_in_by_fkey"
            columns: ["checked_in_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_audience"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "attendance_records_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          changes: Json | null
          created_at: string
          id: string
          resource_id: string
          resource_type: string
          user_id: string | null
        }
        Insert: {
          action: string
          changes?: Json | null
          created_at?: string
          id?: string
          resource_id: string
          resource_type: string
          user_id?: string | null
        }
        Update: {
          action?: string
          changes?: Json | null
          created_at?: string
          id?: string
          resource_id?: string
          resource_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_labels: {
        Row: {
          added_at: string
          campaign_id: string
          label_id: string
        }
        Insert: {
          added_at?: string
          campaign_id: string
          label_id: string
        }
        Update: {
          added_at?: string
          campaign_id?: string
          label_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_labels_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_recipients: {
        Row: {
          bounce_reason: string | null
          bounced_at: string | null
          campaign_id: string
          complained_at: string | null
          contact_id: string
          delivered_at: string | null
          first_clicked_at: string | null
          id: string
          opened_at: string | null
          provider_message_id: string | null
          sent_at: string | null
          unsubscribed_at: string | null
        }
        Insert: {
          bounce_reason?: string | null
          bounced_at?: string | null
          campaign_id: string
          complained_at?: string | null
          contact_id: string
          delivered_at?: string | null
          first_clicked_at?: string | null
          id?: string
          opened_at?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          unsubscribed_at?: string | null
        }
        Update: {
          bounce_reason?: string | null
          bounced_at?: string | null
          campaign_id?: string
          complained_at?: string | null
          contact_id?: string
          delivered_at?: string | null
          first_clicked_at?: string | null
          id?: string
          opened_at?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          unsubscribed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_audience"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          body_html: string
          body_source: Json | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          preview_text: string | null
          scheduled_at: string | null
          sending_identity_id: string
          sent_at: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          body_html: string
          body_source?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          preview_text?: string | null
          scheduled_at?: string | null
          sending_identity_id: string
          sent_at?: string | null
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          body_html?: string
          body_source?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          preview_text?: string | null
          scheduled_at?: string | null
          sending_identity_id?: string
          sent_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_sending_identity_id_fkey"
            columns: ["sending_identity_id"]
            isOneToOne: false
            referencedRelation: "sending_identities"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_agreements: {
        Row: {
          body_markdown: string
          created_at: string
          effective_at: string
          id: string
          is_current: boolean
          title: string
          version: string
        }
        Insert: {
          body_markdown: string
          created_at?: string
          effective_at?: string
          id?: string
          is_current?: boolean
          title: string
          version: string
        }
        Update: {
          body_markdown?: string
          created_at?: string
          effective_at?: string
          id?: string
          is_current?: boolean
          title?: string
          version?: string
        }
        Relationships: []
      }
      consent_records: {
        Row: {
          accepted_at: string
          agreement_version: string
          applicant_email: string | null
          application_id: string | null
          id: string
          ip_address: string | null
          source: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          accepted_at?: string
          agreement_version: string
          applicant_email?: string | null
          application_id?: string | null
          id?: string
          ip_address?: string | null
          source: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          accepted_at?: string
          agreement_version?: string
          applicant_email?: string | null
          application_id?: string | null
          id?: string
          ip_address?: string | null
          source?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_agreement_version_fkey"
            columns: ["agreement_version"]
            isOneToOne: false
            referencedRelation: "consent_agreements"
            referencedColumns: ["version"]
          },
          {
            foreignKeyName: "consent_records_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_labels: {
        Row: {
          added_at: string
          added_by: string | null
          added_via: string
          contact_id: string
          label_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          added_via: string
          contact_id: string
          label_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          added_via?: string
          contact_id?: string
          label_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_labels_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_labels_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_labels_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_audience"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "contact_labels_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          city: string | null
          country: string | null
          created_at: string
          date_of_birth: string | null
          email: string | null
          email_normalized: string | null
          first_name: string
          gender: string | null
          id: string
          last_interaction_at: string | null
          last_name: string
          marital_status: string | null
          marketing_status: string
          nationality: string | null
          notes: string | null
          owner_id: string | null
          phone: string | null
          phone_normalized: string | null
          postal_code: string | null
          preferred_channel: string | null
          preferred_language: string | null
          preferred_name: string | null
          province: string | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          email_normalized?: string | null
          first_name: string
          gender?: string | null
          id?: string
          last_interaction_at?: string | null
          last_name: string
          marital_status?: string | null
          marketing_status?: string
          nationality?: string | null
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          phone_normalized?: string | null
          postal_code?: string | null
          preferred_channel?: string | null
          preferred_language?: string | null
          preferred_name?: string | null
          province?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          email_normalized?: string | null
          first_name?: string
          gender?: string | null
          id?: string
          last_interaction_at?: string | null
          last_name?: string
          marital_status?: string | null
          marketing_status?: string
          nationality?: string | null
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          phone_normalized?: string | null
          postal_code?: string | null
          preferred_channel?: string | null
          preferred_language?: string | null
          preferred_name?: string | null
          province?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      country_tiers: {
        Row: {
          country_name: string
          created_at: string
          id: string
          tier: string
          updated_at: string
        }
        Insert: {
          country_name: string
          created_at?: string
          id?: string
          tier: string
          updated_at?: string
        }
        Update: {
          country_name?: string
          created_at?: string
          id?: string
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      courses: {
        Row: {
          code: string
          created_at: string
          credit_hours: number
          description: string | null
          id: string
          name: string
          program_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          credit_hours?: number
          description?: string | null
          id?: string
          name: string
          program_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          credit_hours?: number
          description?: string | null
          id?: string
          name?: string
          program_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      csv_imports: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          custom_label_name: string | null
          error_count: number
          error_log: Json | null
          filename: string
          id: string
          imported_count: number
          label_id: string | null
          matched_count: number
          review_count: number
          row_count: number
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          custom_label_name?: string | null
          error_count?: number
          error_log?: Json | null
          filename: string
          id?: string
          imported_count?: number
          label_id?: string | null
          matched_count?: number
          review_count?: number
          row_count: number
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          custom_label_name?: string | null
          error_count?: number
          error_log?: Json | null
          filename?: string
          id?: string
          imported_count?: number
          label_id?: string | null
          matched_count?: number
          review_count?: number
          row_count?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "csv_imports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "csv_imports_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
        ]
      }
      dedup_review_queue: {
        Row: {
          created_at: string
          email_match_contact_id: string | null
          id: string
          incoming_data: Json
          phone_match_contact_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          source_id: string | null
          source_type: string
          status: string
        }
        Insert: {
          created_at?: string
          email_match_contact_id?: string | null
          id?: string
          incoming_data: Json
          phone_match_contact_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_id?: string | null
          source_type: string
          status?: string
        }
        Update: {
          created_at?: string
          email_match_contact_id?: string | null
          id?: string
          incoming_data?: Json
          phone_match_contact_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_id?: string | null
          source_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "dedup_review_queue_email_match_contact_id_fkey"
            columns: ["email_match_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dedup_review_queue_email_match_contact_id_fkey"
            columns: ["email_match_contact_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_audience"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "dedup_review_queue_email_match_contact_id_fkey"
            columns: ["email_match_contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dedup_review_queue_phone_match_contact_id_fkey"
            columns: ["phone_match_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dedup_review_queue_phone_match_contact_id_fkey"
            columns: ["phone_match_contact_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_audience"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "dedup_review_queue_phone_match_contact_id_fkey"
            columns: ["phone_match_contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dedup_review_queue_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_suppressions: {
        Row: {
          added_at: string
          email_normalized: string
          reason: string
        }
        Insert: {
          added_at?: string
          email_normalized: string
          reason: string
        }
        Update: {
          added_at?: string
          email_normalized?: string
          reason?: string
        }
        Relationships: []
      }
      enrollments: {
        Row: {
          assigned_staff_id: string | null
          completed_at: string | null
          created_at: string
          enrolled_at: string
          enrolled_by: string | null
          id: string
          notes: string | null
          program_id: string
          removed_at: string | null
          removed_by: string | null
          staff_assigned_at: string | null
          staff_assigned_by: string | null
          staff_viewed_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_staff_id?: string | null
          completed_at?: string | null
          created_at?: string
          enrolled_at?: string
          enrolled_by?: string | null
          id?: string
          notes?: string | null
          program_id: string
          removed_at?: string | null
          removed_by?: string | null
          staff_assigned_at?: string | null
          staff_assigned_by?: string | null
          staff_viewed_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_staff_id?: string | null
          completed_at?: string | null
          created_at?: string
          enrolled_at?: string
          enrolled_by?: string | null
          id?: string
          notes?: string | null
          program_id?: string
          removed_at?: string | null
          removed_by?: string | null
          staff_assigned_at?: string | null
          staff_assigned_by?: string | null
          staff_viewed_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_enrolled_by_fkey"
            columns: ["enrolled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_staff_assigned_by_fkey"
            columns: ["staff_assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_outcome_responses: {
        Row: {
          contact_id: string
          form_submission_id: string | null
          id: string
          outcome_id: string
          responded_at: string
        }
        Insert: {
          contact_id: string
          form_submission_id?: string | null
          id?: string
          outcome_id: string
          responded_at?: string
        }
        Update: {
          contact_id?: string
          form_submission_id?: string | null
          id?: string
          outcome_id?: string
          responded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_outcome_responses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_outcome_responses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_audience"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "event_outcome_responses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_outcome_responses_form_submission_id_fkey"
            columns: ["form_submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_outcome_responses_outcome_id_fkey"
            columns: ["outcome_id"]
            isOneToOne: false
            referencedRelation: "event_outcomes"
            referencedColumns: ["id"]
          },
        ]
      }
      event_labels: {
        Row: {
          created_at: string
          event_id: string
          label_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          label_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          label_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_labels_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
        ]
      }
      event_outcomes: {
        Row: {
          created_at: string
          description: string | null
          event_id: string
          form_id: string | null
          id: string
          is_active: boolean
          label_id: string | null
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          event_id: string
          form_id?: string | null
          id?: string
          is_active?: boolean
          label_id?: string | null
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          event_id?: string
          form_id?: string | null
          id?: string
          is_active?: boolean
          label_id?: string | null
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_outcomes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_outcomes_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_outcomes_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
        ]
      }
      outcome_workflows: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          outcome_id: string
          trigger: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          outcome_id: string
          trigger?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          outcome_id?: string
          trigger?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outcome_workflows_outcome_id_fkey"
            columns: ["outcome_id"]
            isOneToOne: false
            referencedRelation: "event_outcomes"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_email_sends: {
        Row: {
          bounce_reason: string | null
          bounced_at: string | null
          complained_at: string | null
          contact_id: string
          delivered_at: string | null
          enrollment_id: string | null
          first_clicked_at: string | null
          id: string
          opened_at: string | null
          outcome_label_id: string | null
          provider_message_id: string | null
          sent_at: string
          step_id: string | null
          unsubscribed_at: string | null
          workflow_id: string | null
        }
        Insert: {
          bounce_reason?: string | null
          bounced_at?: string | null
          complained_at?: string | null
          contact_id: string
          delivered_at?: string | null
          enrollment_id?: string | null
          first_clicked_at?: string | null
          id?: string
          opened_at?: string | null
          outcome_label_id?: string | null
          provider_message_id?: string | null
          sent_at?: string
          step_id?: string | null
          unsubscribed_at?: string | null
          workflow_id?: string | null
        }
        Update: {
          bounce_reason?: string | null
          bounced_at?: string | null
          complained_at?: string | null
          contact_id?: string
          delivered_at?: string | null
          enrollment_id?: string | null
          first_clicked_at?: string | null
          id?: string
          opened_at?: string | null
          outcome_label_id?: string | null
          provider_message_id?: string | null
          sent_at?: string
          step_id?: string | null
          unsubscribed_at?: string | null
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_email_sends_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "workflow_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_email_sends_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "outcome_workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_email_sends_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_enrollments: {
        Row: {
          completed_at: string | null
          contact_id: string
          current_step: number
          enrolled_at: string
          form_submission_id: string | null
          id: string
          next_run_at: string | null
          status: string
          updated_at: string
          workflow_id: string
        }
        Insert: {
          completed_at?: string | null
          contact_id: string
          current_step?: number
          enrolled_at?: string
          form_submission_id?: string | null
          id?: string
          next_run_at?: string | null
          status?: string
          updated_at?: string
          workflow_id: string
        }
        Update: {
          completed_at?: string | null
          contact_id?: string
          current_step?: number
          enrolled_at?: string
          form_submission_id?: string | null
          id?: string
          next_run_at?: string | null
          status?: string
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_enrollments_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "outcome_workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_enrollments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_enrollments_form_submission_id_fkey"
            columns: ["form_submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_step_runs: {
        Row: {
          detail: Json | null
          enrollment_id: string
          id: string
          ran_at: string
          status: string
          step_id: string | null
        }
        Insert: {
          detail?: Json | null
          enrollment_id: string
          id?: string
          ran_at?: string
          status: string
          step_id?: string | null
        }
        Update: {
          detail?: Json | null
          enrollment_id?: string
          id?: string
          ran_at?: string
          status?: string
          step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_step_runs_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "workflow_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_step_runs_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "workflow_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_steps: {
        Row: {
          config: Json
          created_at: string
          id: string
          sort_order: number
          step_type: string
          workflow_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          sort_order?: number
          step_type: string
          workflow_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          sort_order?: number
          step_type?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_steps_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "outcome_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      event_registrations: {
        Row: {
          contact_id: string
          event_id: string
          id: string
          notes: string | null
          order_id: string | null
          registered_at: string
          registered_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          contact_id: string
          event_id: string
          id?: string
          notes?: string | null
          order_id?: string | null
          registered_at?: string
          registered_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          contact_id?: string
          event_id?: string
          id?: string
          notes?: string | null
          order_id?: string | null
          registered_at?: string
          registered_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_registrations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_registrations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_audience"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "event_registrations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_registrations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_registrations_registered_by_fkey"
            columns: ["registered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_roles: {
        Row: {
          contact_id: string | null
          created_at: string
          display_name: string | null
          event_id: string
          id: string
          notes: string | null
          role_name: string
          sort_order: number
          user_id: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          display_name?: string | null
          event_id: string
          id?: string
          notes?: string | null
          role_name: string
          sort_order?: number
          user_id?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          display_name?: string | null
          event_id?: string
          id?: string
          notes?: string | null
          role_name?: string
          sort_order?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_roles_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_roles_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_audience"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "event_roles_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_roles_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_scan_links: {
        Row: {
          id: string
          event_id: string
          token: string
          is_active: boolean
          created_by: string | null
          created_at: string
          rotated_at: string | null
          expires_at: string | null
        }
        Insert: {
          id?: string
          event_id: string
          token: string
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          rotated_at?: string | null
          expires_at?: string | null
        }
        Update: {
          id?: string
          event_id?: string
          token?: string
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          rotated_at?: string | null
          expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_scan_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          pay_later_enabled: boolean
          sending_identity_id: string | null
          email_show_event_logo: boolean
          email_wording: Json
          pay_later_due_date: string | null
          xero_item_code: string | null
          base_label_id: string | null
          brand: string
          buyer_fields: Json
          checkout_questions: Json
          created_at: string
          currency: string
          created_by: string
          description: string | null
          end_date: string | null
          end_time: string | null
          id: string
          is_public: boolean
          location: string | null
          logo_url: string | null
          max_capacity: number | null
          public_slug: string | null
          registration_required: boolean
          start_date: string
          start_time: string | null
          status: string
          ticketing_enabled: boolean
          title: string
          updated_at: string
        }
        Insert: {
          pay_later_enabled?: boolean
          sending_identity_id?: string | null
          email_show_event_logo?: boolean
          email_wording?: Json
          pay_later_due_date?: string | null
          xero_item_code?: string | null
          base_label_id?: string | null
          brand?: string
          buyer_fields?: Json
          checkout_questions?: Json
          created_at?: string
          currency?: string
          created_by: string
          description?: string | null
          end_date?: string | null
          end_time?: string | null
          id?: string
          is_public?: boolean
          location?: string | null
          logo_url?: string | null
          max_capacity?: number | null
          public_slug?: string | null
          registration_required?: boolean
          start_date: string
          start_time?: string | null
          status?: string
          ticketing_enabled?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          pay_later_enabled?: boolean
          sending_identity_id?: string | null
          email_show_event_logo?: boolean
          email_wording?: Json
          pay_later_due_date?: string | null
          xero_item_code?: string | null
          base_label_id?: string | null
          brand?: string
          buyer_fields?: Json
          checkout_questions?: Json
          created_at?: string
          created_by?: string
          currency?: string
          description?: string | null
          end_date?: string | null
          end_time?: string | null
          id?: string
          is_public?: boolean
          location?: string | null
          logo_url?: string | null
          max_capacity?: number | null
          public_slug?: string | null
          registration_required?: boolean
          start_date?: string
          start_time?: string | null
          status?: string
          ticketing_enabled?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_base_label_id_fkey"
            columns: ["base_label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      form_submissions: {
        Row: {
          consent_record_id: string | null
          contact_id: string | null
          dedup_action: string
          form_id: string
          id: string
          ip_address: string | null
          raw_data: Json
          submitted_at: string
          user_agent: string | null
        }
        Insert: {
          consent_record_id?: string | null
          contact_id?: string | null
          dedup_action: string
          form_id: string
          id?: string
          ip_address?: string | null
          raw_data: Json
          submitted_at?: string
          user_agent?: string | null
        }
        Update: {
          consent_record_id?: string | null
          contact_id?: string | null
          dedup_action?: string
          form_id?: string
          id?: string
          ip_address?: string | null
          raw_data?: Json
          submitted_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_submissions_consent_record_id_fkey"
            columns: ["consent_record_id"]
            isOneToOne: false
            referencedRelation: "consent_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_audience"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "form_submissions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
        ]
      }
      forms: {
        Row: {
          created_at: string
          created_by: string | null
          custom_label_allowed: boolean
          description: string | null
          double_opt_in: boolean
          event_id: string | null
          id: string
          is_active: boolean
          label_id: string | null
          name: string
          records_attendance: boolean
          redirect_url: string | null
          schema: Json
          sending_identity_id: string | null
          slug: string
          updated_at: string
          welcome_campaign_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          custom_label_allowed?: boolean
          description?: string | null
          double_opt_in?: boolean
          event_id?: string | null
          id?: string
          is_active?: boolean
          label_id?: string | null
          name: string
          records_attendance?: boolean
          redirect_url?: string | null
          schema: Json
          sending_identity_id?: string | null
          slug: string
          updated_at?: string
          welcome_campaign_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          custom_label_allowed?: boolean
          description?: string | null
          double_opt_in?: boolean
          event_id?: string | null
          id?: string
          is_active?: boolean
          label_id?: string | null
          name?: string
          records_attendance?: boolean
          redirect_url?: string | null
          schema?: Json
          sending_identity_id?: string | null
          slug?: string
          updated_at?: string
          welcome_campaign_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forms_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forms_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forms_sending_identity_id_fkey"
            columns: ["sending_identity_id"]
            isOneToOne: false
            referencedRelation: "sending_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forms_welcome_campaign_id_fkey"
            columns: ["welcome_campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      grades: {
        Row: {
          course_id: string
          created_at: string
          enrollment_id: string
          graded_at: string | null
          graded_by: string | null
          id: string
          letter_grade: string | null
          notes: string | null
          updated_at: string
        }
        Insert: {
          course_id: string
          created_at?: string
          enrollment_id: string
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          letter_grade?: string | null
          notes?: string | null
          updated_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          enrollment_id?: string
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          letter_grade?: string | null
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grades_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grades_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grades_graded_by_fkey"
            columns: ["graded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      labels: {
        Row: {
          category: string | null
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          is_preset: boolean
          public_subscribe: boolean
          name: string
          sending_identity_id: string | null
          slug: string
        }
        Insert: {
          category?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_preset?: boolean
          public_subscribe?: boolean
          name: string
          sending_identity_id?: string | null
          slug: string
        }
        Update: {
          category?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_preset?: boolean
          public_subscribe?: boolean
          name?: string
          sending_identity_id?: string | null
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "labels_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labels_sending_identity_id_fkey"
            columns: ["sending_identity_id"]
            isOneToOne: false
            referencedRelation: "sending_identities"
            referencedColumns: ["id"]
          },
        ]
      }
      library_applications: {
        Row: {
          cohort: string | null
          created_at: string
          id: string
          import_id: string | null
          person_id: string
          program_name: string | null
          raw_data: Json
          status: string | null
          submitted_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          cohort?: string | null
          created_at?: string
          id?: string
          import_id?: string | null
          person_id: string
          program_name?: string | null
          raw_data?: Json
          status?: string | null
          submitted_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          cohort?: string | null
          created_at?: string
          id?: string
          import_id?: string | null
          person_id?: string
          program_name?: string | null
          raw_data?: Json
          status?: string | null
          submitted_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "library_applications_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "library_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_applications_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "library_persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_applications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      library_documents: {
        Row: {
          created_at: string
          doc_type: string | null
          expires_at: string | null
          file_url: string | null
          id: string
          identifier: string | null
          import_id: string | null
          person_id: string
          raw_data: Json
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          doc_type?: string | null
          expires_at?: string | null
          file_url?: string | null
          id?: string
          identifier?: string | null
          import_id?: string | null
          person_id: string
          raw_data?: Json
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          doc_type?: string | null
          expires_at?: string | null
          file_url?: string | null
          id?: string
          identifier?: string | null
          import_id?: string | null
          person_id?: string
          raw_data?: Json
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "library_documents_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "library_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_documents_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "library_persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_documents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      library_enrollments: {
        Row: {
          created_at: string
          end_date: string | null
          id: string
          import_id: string | null
          person_id: string
          program_name: string | null
          raw_data: Json
          role: string | null
          school_name: string | null
          start_date: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          id?: string
          import_id?: string | null
          person_id: string
          program_name?: string | null
          raw_data?: Json
          role?: string | null
          school_name?: string | null
          start_date?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          end_date?: string | null
          id?: string
          import_id?: string | null
          person_id?: string
          program_name?: string | null
          raw_data?: Json
          role?: string | null
          school_name?: string | null
          start_date?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "library_enrollments_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "library_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_enrollments_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "library_persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_enrollments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      library_imports: {
        Row: {
          auto_linked_count: number
          column_mapping: Json
          column_order: string[] | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          error_count: number
          error_log: Json | null
          filename: string
          id: string
          persons_created: number
          queued_count: number
          record_type: string
          records_created: number
          row_count: number
          status: string
          template_id: string | null
        }
        Insert: {
          auto_linked_count?: number
          column_mapping?: Json
          column_order?: string[] | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_count?: number
          error_log?: Json | null
          filename: string
          id?: string
          persons_created?: number
          queued_count?: number
          record_type: string
          records_created?: number
          row_count?: number
          status?: string
          template_id?: string | null
        }
        Update: {
          auto_linked_count?: number
          column_mapping?: Json
          column_order?: string[] | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_count?: number
          error_log?: Json | null
          filename?: string
          id?: string
          persons_created?: number
          queued_count?: number
          record_type?: string
          records_created?: number
          row_count?: number
          status?: string
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "library_imports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_imports_template_fk"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "library_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      library_match_queue: {
        Row: {
          confidence: string
          created_at: string
          id: string
          match_reason: string
          person_id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          confidence: string
          created_at?: string
          id?: string
          match_reason: string
          person_id: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          confidence?: string
          created_at?: string
          id?: string
          match_reason?: string
          person_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_match_queue_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "library_persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_match_queue_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_match_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      library_payments: {
        Row: {
          amount: number | null
          created_at: string
          currency: string | null
          description: string | null
          id: string
          import_id: string | null
          paid_at: string | null
          person_id: string
          raw_data: Json
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          description?: string | null
          id?: string
          import_id?: string | null
          paid_at?: string | null
          person_id: string
          raw_data?: Json
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          description?: string | null
          id?: string
          import_id?: string | null
          paid_at?: string | null
          person_id?: string
          raw_data?: Json
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "library_payments_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "library_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_payments_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "library_persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      library_persons: {
        Row: {
          country: string | null
          created_at: string
          date_of_birth: string | null
          email: string | null
          email_normalized: string | null
          first_name: string | null
          id: string
          last_name: string | null
          link_method: string | null
          linked_at: string | null
          linked_by: string | null
          linked_user_id: string | null
          nationality: string | null
          phone: string | null
          phone_normalized: string | null
          preferred_name: string | null
          raw_data: Json
          source_import_id: string | null
          updated_at: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          email_normalized?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          link_method?: string | null
          linked_at?: string | null
          linked_by?: string | null
          linked_user_id?: string | null
          nationality?: string | null
          phone?: string | null
          phone_normalized?: string | null
          preferred_name?: string | null
          raw_data?: Json
          source_import_id?: string | null
          updated_at?: string
        }
        Update: {
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          email_normalized?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          link_method?: string | null
          linked_at?: string | null
          linked_by?: string | null
          linked_user_id?: string | null
          nationality?: string | null
          phone?: string | null
          phone_normalized?: string | null
          preferred_name?: string | null
          raw_data?: Json
          source_import_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_persons_linked_by_fkey"
            columns: ["linked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_persons_linked_user_id_fkey"
            columns: ["linked_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_persons_source_import_id_fkey"
            columns: ["source_import_id"]
            isOneToOne: false
            referencedRelation: "library_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      library_templates: {
        Row: {
          column_mapping: Json
          created_at: string
          created_by: string | null
          id: string
          name: string
          record_type: string
          updated_at: string
        }
        Insert: {
          column_mapping: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          record_type: string
          updated_at?: string
        }
        Update: {
          column_mapping?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          record_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          xero_invoice_id: string | null
          xero_invoice_number: string | null
          xero_region: string | null
          invoice_due_date: string | null
          invoice_paid_cents: number
          invoice_emailed_at: string | null
          invoice_error: string | null
          inventory_released_at: string | null
          buyer_contact_id: string | null
          buyer_email: string
          buyer_first_name: string
          buyer_last_name: string
          buyer_phone: string | null
          buyer_country: string | null
          cancelled_at: string | null
          consent_accepted_at: string | null
          consent_version: string | null
          contact_resolution: string
          created_at: string
          currency: string
          custom_answers: Json
          discount_cents: number
          donation_cents: number
          event_id: string
          expires_at: string | null
          id: string
          lines: Json
          marketing_consent: boolean
          paid_at: string | null
          payment_provider: string | null
          promo_code: string | null
          promo_code_id: string | null
          provider_payment_id: string | null
          provider_reference: string | null
          refund_cents: number
          refunded_at: string | null
          staff_notes: string | null
          status: string
          subtotal_cents: number
          ticket_answers: Json
          waived_steps: Json
          waiver_signatures: Json | null
          total_cents: number
          updated_at: string
        }
        Insert: {
          xero_invoice_id?: string | null
          xero_invoice_number?: string | null
          xero_region?: string | null
          invoice_due_date?: string | null
          invoice_paid_cents?: number
          invoice_emailed_at?: string | null
          invoice_error?: string | null
          inventory_released_at?: string | null
          buyer_contact_id?: string | null
          buyer_email: string
          buyer_first_name: string
          buyer_last_name: string
          buyer_phone?: string | null
          buyer_country?: string | null
          cancelled_at?: string | null
          consent_accepted_at?: string | null
          consent_version?: string | null
          contact_resolution?: string
          created_at?: string
          currency?: string
          custom_answers?: Json
          discount_cents?: number
          donation_cents?: number
          event_id: string
          expires_at?: string | null
          id?: string
          lines?: Json
          marketing_consent?: boolean
          paid_at?: string | null
          payment_provider?: string | null
          promo_code?: string | null
          promo_code_id?: string | null
          provider_payment_id?: string | null
          provider_reference?: string | null
          refund_cents?: number
          refunded_at?: string | null
          staff_notes?: string | null
          status?: string
          subtotal_cents?: number
          ticket_answers?: Json
          waived_steps?: Json
          waiver_signatures?: Json | null
          total_cents?: number
          updated_at?: string
        }
        Update: {
          xero_invoice_id?: string | null
          xero_invoice_number?: string | null
          xero_region?: string | null
          invoice_due_date?: string | null
          invoice_paid_cents?: number
          invoice_emailed_at?: string | null
          invoice_error?: string | null
          inventory_released_at?: string | null
          buyer_contact_id?: string | null
          buyer_email?: string
          buyer_first_name?: string
          buyer_last_name?: string
          buyer_phone?: string | null
          buyer_country?: string | null
          cancelled_at?: string | null
          consent_accepted_at?: string | null
          consent_version?: string | null
          contact_resolution?: string
          created_at?: string
          currency?: string
          custom_answers?: Json
          discount_cents?: number
          donation_cents?: number
          event_id?: string
          expires_at?: string | null
          id?: string
          lines?: Json
          marketing_consent?: boolean
          paid_at?: string | null
          payment_provider?: string | null
          promo_code?: string | null
          promo_code_id?: string | null
          provider_payment_id?: string | null
          provider_reference?: string | null
          refund_cents?: number
          refunded_at?: string | null
          staff_notes?: string | null
          status?: string
          subtotal_cents?: number
          ticket_answers?: Json
          waived_steps?: Json
          waiver_signatures?: Json | null
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_buyer_contact_id_fkey"
            columns: ["buyer_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_buyer_contact_id_fkey"
            columns: ["buyer_contact_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_audience"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "orders_buyer_contact_id_fkey"
            columns: ["buyer_contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_budget_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_default: boolean
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      outreach_cash_batches: {
        Row: {
          bank_fee: number
          batch_date: string
          created_at: string
          created_by: string
          exchange_rate: number
          id: string
          local_currency: string
          local_currency_received: number
          notes: string | null
          team_id: string
          updated_at: string
          zar_withdrawn: number
        }
        Insert: {
          bank_fee?: number
          batch_date?: string
          created_at?: string
          created_by: string
          exchange_rate: number
          id?: string
          local_currency: string
          local_currency_received: number
          notes?: string | null
          team_id: string
          updated_at?: string
          zar_withdrawn: number
        }
        Update: {
          bank_fee?: number
          batch_date?: string
          created_at?: string
          created_by?: string
          exchange_rate?: number
          id?: string
          local_currency?: string
          local_currency_received?: number
          notes?: string | null
          team_id?: string
          updated_at?: string
          zar_withdrawn?: number
        }
        Relationships: [
          {
            foreignKeyName: "outreach_cash_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_cash_batches_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "outreach_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_closeouts: {
        Row: {
          admin_notes: string | null
          cash_remaining: number
          closed_at: string | null
          closed_by: string | null
          created_at: string
          funds_returned: number
          id: string
          status: string
          team_id: string
          total_funds_sent: number
          total_spent: number
          updated_at: string
          variance: number
          variance_pct: number
        }
        Insert: {
          admin_notes?: string | null
          cash_remaining?: number
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          funds_returned?: number
          id?: string
          status?: string
          team_id: string
          total_funds_sent?: number
          total_spent?: number
          updated_at?: string
          variance?: number
          variance_pct?: number
        }
        Update: {
          admin_notes?: string | null
          cash_remaining?: number
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          funds_returned?: number
          id?: string
          status?: string
          team_id?: string
          total_funds_sent?: number
          total_spent?: number
          updated_at?: string
          variance?: number
          variance_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "outreach_closeouts_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_closeouts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "outreach_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_expenses: {
        Row: {
          cash_batch_id: string | null
          category_id: string
          country: string | null
          created_at: string
          created_by: string
          description: string
          exchange_rate: number
          expense_date: string
          id: string
          local_amount: number
          local_currency: string
          notes: string | null
          payment_method: string
          purchaser: string | null
          receipt_code: string | null
          receipt_path: string | null
          team_id: string
          updated_at: string
          vendor: string | null
          zar_amount: number
        }
        Insert: {
          cash_batch_id?: string | null
          category_id: string
          country?: string | null
          created_at?: string
          created_by: string
          description: string
          exchange_rate?: number
          expense_date?: string
          id?: string
          local_amount: number
          local_currency?: string
          notes?: string | null
          payment_method?: string
          purchaser?: string | null
          receipt_code?: string | null
          receipt_path?: string | null
          team_id: string
          updated_at?: string
          vendor?: string | null
          zar_amount: number
        }
        Update: {
          cash_batch_id?: string | null
          category_id?: string
          country?: string | null
          created_at?: string
          created_by?: string
          description?: string
          exchange_rate?: number
          expense_date?: string
          id?: string
          local_amount?: number
          local_currency?: string
          notes?: string | null
          payment_method?: string
          purchaser?: string | null
          receipt_code?: string | null
          receipt_path?: string | null
          team_id?: string
          updated_at?: string
          vendor?: string | null
          zar_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "outreach_expenses_cash_batch_id_fkey"
            columns: ["cash_batch_id"]
            isOneToOne: false
            referencedRelation: "outreach_cash_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "outreach_budget_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_expenses_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "outreach_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_fund_releases: {
        Row: {
          amount_zar: number
          created_at: string
          created_by: string
          currency: string
          id: string
          label: string
          method: string
          notes: string | null
          recipient: string | null
          release_date: string
          team_id: string
          updated_at: string
        }
        Insert: {
          amount_zar: number
          created_at?: string
          created_by: string
          currency?: string
          id?: string
          label: string
          method?: string
          notes?: string | null
          recipient?: string | null
          release_date?: string
          team_id: string
          updated_at?: string
        }
        Update: {
          amount_zar?: number
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          label?: string
          method?: string
          notes?: string | null
          recipient?: string | null
          release_date?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_fund_releases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_fund_releases_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "outreach_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_receipts: {
        Row: {
          expense_id: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          mime_type: string | null
          uploaded_at: string
          uploaded_by: string
        }
        Insert: {
          expense_id: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          uploaded_at?: string
          uploaded_by: string
        }
        Update: {
          expense_id?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          uploaded_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_receipts_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "outreach_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_receipts_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_team_budgets: {
        Row: {
          budget_amount_zar: number
          category_id: string
          created_at: string
          id: string
          notes: string | null
          people_count: number | null
          team_id: string
          updated_at: string
        }
        Insert: {
          budget_amount_zar?: number
          category_id: string
          created_at?: string
          id?: string
          notes?: string | null
          people_count?: number | null
          team_id: string
          updated_at?: string
        }
        Update: {
          budget_amount_zar?: number
          category_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          people_count?: number | null
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_team_budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "outreach_budget_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_team_budgets_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "outreach_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_team_members: {
        Row: {
          id: string
          joined_at: string
          role: string
          team_id: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          role?: string
          team_id: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          role?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "outreach_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_teams: {
        Row: {
          country: string | null
          created_at: string
          created_by: string
          currency: string
          drive_folder_url: string | null
          end_date: string | null
          id: string
          location: string | null
          notes: string | null
          people_count: number
          program_id: string
          start_date: string | null
          status: string
          team_name: string
          total_budget_zar: number
          updated_at: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          created_by: string
          currency?: string
          drive_folder_url?: string | null
          end_date?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          people_count?: number
          program_id: string
          start_date?: string | null
          status?: string
          team_name: string
          total_budget_zar?: number
          updated_at?: string
        }
        Update: {
          country?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          drive_folder_url?: string | null
          end_date?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          people_count?: number
          program_id?: string
          start_date?: string | null
          status?: string
          team_name?: string
          total_budget_zar?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_teams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_teams_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_fee_profiles: {
        Row: {
          currency: string
          fixed_cents: number
          id: string
          is_active: boolean
          percent_bps: number
          provider: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          currency?: string
          fixed_cents?: number
          id?: string
          is_active?: boolean
          percent_bps: number
          provider: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          currency?: string
          fixed_cents?: number
          id?: string
          is_active?: boolean
          percent_bps?: number
          provider?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_fee_profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          created_at: string
          display_name: string
          id: string
          key: string
          module: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          key: string
          module: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          key?: string
          module?: string
          sort_order?: number
        }
        Relationships: []
      }
      person_tags: {
        Row: {
          contact_id: string
          tag_id: string
        }
        Insert: {
          contact_id: string
          tag_id: string
        }
        Update: {
          contact_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_tags_person_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_tags_person_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_audience"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "person_tags_person_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      person_type_assignments: {
        Row: {
          assigned_at: string
          contact_id: string
          id: string
          person_type_id: string
        }
        Insert: {
          assigned_at?: string
          contact_id: string
          id?: string
          person_type_id: string
        }
        Update: {
          assigned_at?: string
          contact_id?: string
          id?: string
          person_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_type_assignments_person_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_type_assignments_person_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_audience"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "person_type_assignments_person_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_type_assignments_person_type_id_fkey"
            columns: ["person_type_id"]
            isOneToOne: false
            referencedRelation: "person_types"
            referencedColumns: ["id"]
          },
        ]
      }
      person_types: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      prayer_room_eval_requests: {
        Row: {
          background: string | null
          created_at: string
          id: string
          instruments: string[] | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          role: string
          status: string
          user_id: string
        }
        Insert: {
          background?: string | null
          created_at?: string
          id?: string
          instruments?: string[] | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          role: string
          status?: string
          user_id: string
        }
        Update: {
          background?: string | null
          created_at?: string
          id?: string
          instruments?: string[] | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          role?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prayer_room_eval_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prayer_room_eval_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      prayer_room_series: {
        Row: {
          commitment_type: string
          created_at: string
          created_by: string
          day_of_week: number | null
          end_date: string | null
          end_time: string
          id: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          start_date: string
          start_time: string
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          commitment_type: string
          created_at?: string
          created_by: string
          day_of_week?: number | null
          end_date?: string | null
          end_time: string
          id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date: string
          start_time: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          commitment_type?: string
          created_at?: string
          created_by?: string
          day_of_week?: number | null
          end_date?: string | null
          end_time?: string
          id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string
          start_time?: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prayer_room_series_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prayer_room_series_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      prayer_room_slot_members: {
        Row: {
          assigned_by: string | null
          created_at: string
          id: string
          instrument: string | null
          role: string
          slot_id: string
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          instrument?: string | null
          role: string
          slot_id: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          instrument?: string | null
          role?: string
          slot_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prayer_room_slot_members_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prayer_room_slot_members_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "prayer_room_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prayer_room_slot_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      prayer_room_slots: {
        Row: {
          color: string | null
          completed_at: string | null
          created_at: string
          end_time: string
          id: string
          notes: string | null
          series_id: string | null
          slot_date: string
          start_time: string
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          color?: string | null
          completed_at?: string | null
          created_at?: string
          end_time: string
          id?: string
          notes?: string | null
          series_id?: string | null
          slot_date: string
          start_time: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          color?: string | null
          completed_at?: string | null
          created_at?: string
          end_time?: string
          id?: string
          notes?: string | null
          series_id?: string | null
          slot_date?: string
          start_time?: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prayer_room_slots_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "prayer_room_series"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          acceptance_email_body: string | null
          acceptance_email_subject: string | null
          application_deadline: string | null
          application_open: boolean
          code: string
          created_at: string
          created_by: string
          credit_hours: number
          description: string | null
          id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          acceptance_email_body?: string | null
          acceptance_email_subject?: string | null
          application_deadline?: string | null
          application_open?: boolean
          code: string
          created_at?: string
          created_by: string
          credit_hours?: number
          description?: string | null
          id?: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          acceptance_email_body?: string | null
          acceptance_email_subject?: string | null
          application_deadline?: string | null
          application_open?: boolean
          code?: string
          created_at?: string
          created_by?: string
          credit_hours?: number
          description?: string | null
          id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "programs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_codes: {
        Row: {
          amount_off_cents: number | null
          applies_to_ticket_type_id: string | null
          code: string
          created_at: string
          created_by: string | null
          event_id: string
          id: string
          is_active: boolean
          kind: string
          max_redemptions: number | null
          percent_off: number | null
          redemption_count: number
          valid_from: string | null
          valid_until: string | null
          waived_questions: Json
          waives_waiver: boolean
        }
        Insert: {
          amount_off_cents?: number | null
          applies_to_ticket_type_id?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          event_id: string
          id?: string
          is_active?: boolean
          kind: string
          max_redemptions?: number | null
          percent_off?: number | null
          redemption_count?: number
          valid_from?: string | null
          valid_until?: string | null
          waived_questions?: Json
          waives_waiver?: boolean
        }
        Update: {
          amount_off_cents?: number | null
          applies_to_ticket_type_id?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          event_id?: string
          id?: string
          is_active?: boolean
          kind?: string
          max_redemptions?: number | null
          percent_off?: number | null
          redemption_count?: number
          valid_from?: string | null
          valid_until?: string | null
          waived_questions?: Json
          waives_waiver?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "promo_codes_applies_to_ticket_type_id_fkey"
            columns: ["applies_to_ticket_type_id"]
            isOneToOne: false
            referencedRelation: "ticket_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_codes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_questions: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_required: boolean
          label: string
          options: Json | null
          parent_question_id: string | null
          program_id: string
          show_when_answer: string | null
          sort_order: number
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_required?: boolean
          label: string
          options?: Json | null
          parent_question_id?: string | null
          program_id: string
          show_when_answer?: string | null
          sort_order?: number
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_required?: boolean
          label?: string
          options?: Json | null
          parent_question_id?: string | null
          program_id?: string
          show_when_answer?: string | null
          sort_order?: number
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reference_questions_parent_question_id_fkey"
            columns: ["parent_question_id"]
            isOneToOne: false
            referencedRelation: "reference_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_questions_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_requests: {
        Row: {
          application_id: string
          created_at: string
          email_sent_at: string | null
          form_data: Json | null
          id: string
          known_duration: string | null
          referee_email: string
          referee_name: string
          reference_text: string | null
          relationship: string | null
          reminder_sent_at: string | null
          slot_id: string
          status: string
          submitted_at: string | null
          token: string
          updated_at: string
        }
        Insert: {
          application_id: string
          created_at?: string
          email_sent_at?: string | null
          form_data?: Json | null
          id?: string
          known_duration?: string | null
          referee_email: string
          referee_name: string
          reference_text?: string | null
          relationship?: string | null
          reminder_sent_at?: string | null
          slot_id: string
          status?: string
          submitted_at?: string | null
          token?: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          created_at?: string
          email_sent_at?: string | null
          form_data?: Json | null
          id?: string
          known_duration?: string | null
          referee_email?: string
          referee_name?: string
          reference_text?: string | null
          relationship?: string | null
          reminder_sent_at?: string | null
          slot_id?: string
          status?: string
          submitted_at?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reference_requests_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reference_requests_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "reference_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_slots: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_required: boolean
          label: string
          program_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_required?: boolean
          label: string
          program_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_required?: boolean
          label?: string
          program_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reference_slots_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          display_name: string
          id: string
          is_system: boolean
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          is_system?: boolean
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          is_system?: boolean
          name?: string
        }
        Relationships: []
      }
      school_fee_structures: {
        Row: {
          accommodation_zar: number
          created_at: string
          id: string
          materials_zar: number
          meals_zar: number
          notes: string | null
          program_id: string
          tier: string
          total_zar: number | null
          tuition_zar: number
          updated_at: string
        }
        Insert: {
          accommodation_zar?: number
          created_at?: string
          id?: string
          materials_zar?: number
          meals_zar?: number
          notes?: string | null
          program_id: string
          tier: string
          total_zar?: number | null
          tuition_zar?: number
          updated_at?: string
        }
        Update: {
          accommodation_zar?: number
          created_at?: string
          id?: string
          materials_zar?: number
          meals_zar?: number
          notes?: string | null
          program_id?: string
          tier?: string
          total_zar?: number | null
          tuition_zar?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_fee_structures_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      sending_identities: {
        Row: {
          created_at: string
          display_name: string
          from_email: string
          from_name: string
          id: string
          is_active: boolean
          provider: string
          reply_to: string | null
          slug: string
        }
        Insert: {
          created_at?: string
          display_name: string
          from_email: string
          from_name: string
          id?: string
          is_active?: boolean
          provider: string
          reply_to?: string | null
          slug: string
        }
        Update: {
          created_at?: string
          display_name?: string
          from_email?: string
          from_name?: string
          id?: string
          is_active?: boolean
          provider?: string
          reply_to?: string | null
          slug?: string
        }
        Relationships: []
      }
      signup_links: {
        Row: {
          code: string
          enabled: boolean
          regenerated_at: string
          regenerated_by: string | null
          type: string
        }
        Insert: {
          code: string
          enabled?: boolean
          regenerated_at?: string
          regenerated_by?: string | null
          type: string
        }
        Update: {
          code?: string
          enabled?: boolean
          regenerated_at?: string
          regenerated_by?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "signup_links_regenerated_by_fkey"
            columns: ["regenerated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      student_fees: {
        Row: {
          accommodation_zar: number
          amount_paid_zar: number
          created_at: string
          discount_zar: number
          enrollment_id: string
          final_amount_zar: number | null
          id: string
          materials_zar: number
          meals_zar: number
          notes: string | null
          program_id: string
          scholarship_zar: number
          status: string
          tier: string
          tier_override: boolean
          total_due_zar: number
          tuition_zar: number
          updated_at: string
          user_id: string
          xero_invoice_id: string | null
          xero_invoice_number: string | null
          xero_invoice_url: string | null
        }
        Insert: {
          accommodation_zar?: number
          amount_paid_zar?: number
          created_at?: string
          discount_zar?: number
          enrollment_id: string
          final_amount_zar?: number | null
          id?: string
          materials_zar?: number
          meals_zar?: number
          notes?: string | null
          program_id: string
          scholarship_zar?: number
          status?: string
          tier: string
          tier_override?: boolean
          total_due_zar?: number
          tuition_zar?: number
          updated_at?: string
          user_id: string
          xero_invoice_id?: string | null
          xero_invoice_number?: string | null
          xero_invoice_url?: string | null
        }
        Update: {
          accommodation_zar?: number
          amount_paid_zar?: number
          created_at?: string
          discount_zar?: number
          enrollment_id?: string
          final_amount_zar?: number | null
          id?: string
          materials_zar?: number
          meals_zar?: number
          notes?: string | null
          program_id?: string
          scholarship_zar?: number
          status?: string
          tier?: string
          tier_override?: boolean
          total_due_zar?: number
          tuition_zar?: number
          updated_at?: string
          user_id?: string
          xero_invoice_id?: string | null
          xero_invoice_number?: string | null
          xero_invoice_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_fees_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: true
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_fees_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_fees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      student_payments: {
        Row: {
          amount_zar: number
          created_at: string
          currency_amount: number | null
          currency_paid: string | null
          exchange_rate: number | null
          id: string
          notes: string | null
          payment_date: string
          payment_method: string
          receipt_path: string | null
          recorded_by: string
          reference: string | null
          student_fee_id: string
        }
        Insert: {
          amount_zar: number
          created_at?: string
          currency_amount?: number | null
          currency_paid?: string | null
          exchange_rate?: number | null
          id?: string
          notes?: string | null
          payment_date?: string
          payment_method: string
          receipt_path?: string | null
          recorded_by: string
          reference?: string | null
          student_fee_id: string
        }
        Update: {
          amount_zar?: number
          created_at?: string
          currency_amount?: number | null
          currency_paid?: string | null
          exchange_rate?: number | null
          id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string
          receipt_path?: string | null
          recorded_by?: string
          reference?: string | null
          student_fee_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_payments_student_fee_id_fkey"
            columns: ["student_fee_id"]
            isOneToOne: false
            referencedRelation: "student_fees"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          category: string | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      ticket_types: {
        Row: {
          capacity: number | null
          created_at: string
          description: string | null
          display_price_cents: number
          event_id: string
          id: string
          is_active: boolean
          max_per_order: number | null
          name: string
          pricing_mode: string
          quantity_sold: number
          questions: Json
          waiver: Json | null
          sales_end_at: string | null
          sales_start_at: string | null
          sort_order: number
          target_net_cents: number
          updated_at: string
        }
        Insert: {
          capacity?: number | null
          created_at?: string
          description?: string | null
          display_price_cents?: number
          event_id: string
          id?: string
          is_active?: boolean
          max_per_order?: number | null
          name: string
          pricing_mode?: string
          quantity_sold?: number
          questions?: Json
          waiver?: Json | null
          sales_end_at?: string | null
          sales_start_at?: string | null
          sort_order?: number
          target_net_cents?: number
          updated_at?: string
        }
        Update: {
          capacity?: number | null
          created_at?: string
          description?: string | null
          display_price_cents?: number
          event_id?: string
          id?: string
          is_active?: boolean
          max_per_order?: number | null
          name?: string
          pricing_mode?: string
          quantity_sold?: number
          questions?: Json
          waiver?: Json | null
          sales_end_at?: string | null
          sales_start_at?: string | null
          sort_order?: number
          target_net_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_types_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          checked_in_at: string | null
          checked_in_by: string | null
          checked_in_by_name: string | null
          checked_in_via_link: string | null
          code: string
          created_at: string
          custom_answers: Json
          waiver_signature: Json | null
          event_id: string
          id: string
          order_id: string
          promo_code_id: string | null
          status: string
          ticket_type_id: string
          waived_steps: Json | null
        }
        Insert: {
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_in_by_name?: string | null
          checked_in_via_link?: string | null
          code: string
          created_at?: string
          custom_answers?: Json
          waiver_signature?: Json | null
          event_id: string
          id?: string
          order_id: string
          promo_code_id?: string | null
          status?: string
          ticket_type_id: string
          waived_steps?: Json | null
        }
        Update: {
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_in_by_name?: string | null
          checked_in_via_link?: string | null
          code?: string
          created_at?: string
          custom_answers?: Json
          waiver_signature?: Json | null
          event_id?: string
          id?: string
          order_id?: string
          promo_code_id?: string | null
          status?: string
          ticket_type_id?: string
          waived_steps?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_checked_in_by_fkey"
            columns: ["checked_in_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "ticket_types"
            referencedColumns: ["id"]
          },
        ]
      }
      unsubscribes: {
        Row: {
          contact_id: string
          id: string
          label_id: string | null
          reason: string | null
          source: string
          unsubscribed_at: string
        }
        Insert: {
          contact_id: string
          id?: string
          label_id?: string | null
          reason?: string | null
          source: string
          unsubscribed_at?: string
        }
        Update: {
          contact_id?: string
          id?: string
          label_id?: string | null
          reason?: string | null
          source?: string
          unsubscribed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unsubscribes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unsubscribes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_audience"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "unsubscribes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unsubscribes_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
        ]
      }
      user_label_assignments: {
        Row: {
          assigned_by: string | null
          created_at: string
          id: string
          label_id: string
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          label_id: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          label_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_label_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_label_assignments_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "user_labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_label_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_labels: {
        Row: {
          category: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      user_permissions: {
        Row: {
          granted_at: string
          granted_by: string | null
          id: string
          permission_id: string
          scope_id: string | null
          scope_type: string | null
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          permission_id: string
          scope_id?: string | null
          scope_type?: string | null
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          permission_id?: string
          scope_id?: string | null
          scope_type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permissions_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          role_id: string
          scope_id: string | null
          scope_type: string | null
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          role_id: string
          scope_id?: string | null
          scope_type?: string | null
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          role_id?: string
          scope_id?: string | null
          scope_type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          accepted_at: string | null
          address_line_1: string | null
          address_line_2: string | null
          avatar_url: string | null
          city: string | null
          contact_id: string | null
          country: string | null
          created_at: string
          date_of_birth: string | null
          display_name: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relationship: string | null
          first_name: string | null
          gender: string | null
          health_insurance_expiry_date: string | null
          health_insurance_policy_number: string | null
          health_insurance_provider: string | null
          id: string
          invited_at: string | null
          is_active: boolean
          is_international: boolean | null
          job_title: string | null
          last_name: string | null
          last_sign_in_at: string | null
          marital_status: string | null
          nationality: string | null
          passport_country: string | null
          passport_expiry_date: string | null
          passport_number: string | null
          phone: string | null
          postal_code: string | null
          preferred_name: string | null
          province: string | null
          signup_type: string | null
          status: string
          updated_at: string
          visa_category: string | null
          visa_expiry_date: string | null
          visa_type: string | null
          drivers_licence_number: string | null
          licence_country: string | null
          licence_code: string | null
          licence_expiry_date: string | null
          licence_file_url: string | null
          licence_file_name: string | null
          licence_uploaded_at: string | null
          licence_uploaded_by: string | null
          base_driving_test_status: string
          base_driving_test_passed_at: string | null
          base_driving_test_note: string | null
        }
        Insert: {
          accepted_at?: string | null
          address_line_1?: string | null
          address_line_2?: string | null
          avatar_url?: string | null
          city?: string | null
          contact_id?: string | null
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          display_name?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          first_name?: string | null
          gender?: string | null
          health_insurance_expiry_date?: string | null
          health_insurance_policy_number?: string | null
          health_insurance_provider?: string | null
          id: string
          invited_at?: string | null
          is_active?: boolean
          is_international?: boolean | null
          job_title?: string | null
          last_name?: string | null
          last_sign_in_at?: string | null
          marital_status?: string | null
          nationality?: string | null
          passport_country?: string | null
          passport_expiry_date?: string | null
          passport_number?: string | null
          phone?: string | null
          postal_code?: string | null
          preferred_name?: string | null
          province?: string | null
          signup_type?: string | null
          status?: string
          updated_at?: string
          visa_category?: string | null
          visa_expiry_date?: string | null
          visa_type?: string | null
          drivers_licence_number?: string | null
          licence_country?: string | null
          licence_code?: string | null
          licence_expiry_date?: string | null
          licence_file_url?: string | null
          licence_file_name?: string | null
          licence_uploaded_at?: string | null
          licence_uploaded_by?: string | null
          base_driving_test_status?: string
          base_driving_test_passed_at?: string | null
          base_driving_test_note?: string | null
        }
        Update: {
          accepted_at?: string | null
          address_line_1?: string | null
          address_line_2?: string | null
          avatar_url?: string | null
          city?: string | null
          contact_id?: string | null
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          display_name?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          first_name?: string | null
          gender?: string | null
          health_insurance_expiry_date?: string | null
          health_insurance_policy_number?: string | null
          health_insurance_provider?: string | null
          id?: string
          invited_at?: string | null
          is_active?: boolean
          is_international?: boolean | null
          job_title?: string | null
          last_name?: string | null
          last_sign_in_at?: string | null
          marital_status?: string | null
          nationality?: string | null
          passport_country?: string | null
          passport_expiry_date?: string | null
          passport_number?: string | null
          phone?: string | null
          postal_code?: string | null
          preferred_name?: string | null
          province?: string | null
          signup_type?: string | null
          status?: string
          updated_at?: string
          visa_category?: string | null
          visa_expiry_date?: string | null
          visa_type?: string | null
          drivers_licence_number?: string | null
          licence_country?: string | null
          licence_code?: string | null
          licence_expiry_date?: string | null
          licence_file_url?: string | null
          licence_file_name?: string | null
          licence_uploaded_at?: string | null
          licence_uploaded_by?: string | null
          base_driving_test_status?: string
          base_driving_test_passed_at?: string | null
          base_driving_test_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_audience"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "users_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      xero_tokens: {
        Row: {
          access_token: string
          connected_by: string | null
          created_at: string
          expires_at: string
          id: string
          refresh_token: string
          region: string
          tenant_id: string
          tenant_name: string | null
          token_set: Json | null
          updated_at: string
        }
        Insert: {
          access_token: string
          connected_by?: string | null
          created_at?: string
          expires_at: string
          id?: string
          refresh_token: string
          region?: string
          tenant_id: string
          tenant_name?: string | null
          token_set?: Json | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          connected_by?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          refresh_token?: string
          region?: string
          tenant_id?: string
          tenant_name?: string | null
          token_set?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "xero_tokens_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_campaign_audience: {
        Row: {
          campaign_id: string | null
          contact_id: string | null
          email: string | null
          email_normalized: string | null
          first_name: string | null
          last_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_labels_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      v_contact_summary: {
        Row: {
          activity_count: number | null
          email: string | null
          first_name: string | null
          id: string | null
          label_count: number | null
          label_slugs: string[] | null
          last_interaction_at: string | null
          last_name: string | null
          marketing_status: string | null
          owner_id: string | null
          phone: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _library_cascade_link: {
        Args: {
          p_link_method: string
          p_linked_by: string
          p_person_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      approve_library_match: {
        Args: { p_notes?: string; p_queue_id: string }
        Returns: undefined
      }
      auto_link_library_records_for_user: {
        Args: { p_user_id: string }
        Returns: {
          auto_linked: number
          queued: number
        }[]
      }
      find_library_matches_for_user: {
        Args: { p_user_id: string }
        Returns: {
          confidence: string
          date_of_birth: string
          email: string
          first_name: string
          last_name: string
          match_reason: string
          person_id: string
        }[]
      }
      get_my_contact_id: { Args: never; Returns: string }
      grade_to_points: { Args: { grade: string }; Returns: number }
      has_any_role: { Args: { required_roles: string[] }; Returns: boolean }
      has_permission: {
        Args: { required_permission: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          check_scope_id?: string
          check_scope_type?: string
          required_role: string
        }
        Returns: boolean
      }
      has_schools_access: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_outreach_finance_admin: {
        Args: { check_team_id: string }
        Returns: boolean
      }
      is_outreach_team_member: {
        Args: { check_team_id: string }
        Returns: boolean
      }
      manual_link_library_person: {
        Args: { p_person_id: string; p_user_id: string }
        Returns: undefined
      }
      order_holds_inventory: {
        Args: { p_expires_at: string; p_status: string }
        Returns: boolean
      }
      reclaim_order_inventory: {
        Args: { p_order_id: string }
        Returns: boolean
      }
      redeem_promo_code: {
        Args: { p_promo_code_id: string }
        Returns: {
          amount_off_cents: number | null
          applies_to_ticket_type_id: string | null
          code: string
          created_at: string
          created_by: string | null
          event_id: string
          id: string
          is_active: boolean
          kind: string
          max_redemptions: number | null
          percent_off: number | null
          redemption_count: number
          valid_from: string | null
          valid_until: string | null
        }
        SetofOptions: {
          from: "*"
          to: "promo_codes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reject_library_match: {
        Args: { p_notes?: string; p_queue_id: string }
        Returns: undefined
      }
      release_ticket_holds: {
        Args: { p_event_id?: string; p_order_id?: string }
        Returns: number
      }
      release_ticket_inventory: {
        Args: { p_qty: number; p_ticket_type_id: string }
        Returns: {
          capacity: number | null
          created_at: string
          description: string | null
          display_price_cents: number
          event_id: string
          id: string
          is_active: boolean
          max_per_order: number | null
          name: string
          pricing_mode: string
          quantity_sold: number
          sales_end_at: string | null
          sales_start_at: string | null
          sort_order: number
          target_net_cents: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ticket_types"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reserve_ticket_inventory: {
        Args: { p_qty: number; p_ticket_type_id: string }
        Returns: {
          capacity: number | null
          created_at: string
          description: string | null
          display_price_cents: number
          event_id: string
          id: string
          is_active: boolean
          max_per_order: number | null
          name: string
          pricing_mode: string
          quantity_sold: number
          sales_end_at: string | null
          sales_start_at: string | null
          sort_order: number
          target_net_cents: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ticket_types"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      seed_default_reference_questions: {
        Args: { p_program_id: string }
        Returns: undefined
      }
      unlink_library_person: {
        Args: { p_person_id: string }
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
