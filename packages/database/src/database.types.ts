export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      activities: {
        Row: {
          company_id: string | null;
          contact_id: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          lead_id: string | null;
          metadata: NonNullable<Json>;
          occurred_at: string;
          opportunity_id: string | null;
          organization_id: string;
          performed_by_user_id: string | null;
          source: Database['public']['Enums']['activity_source'];
          title: string;
          type: Database['public']['Enums']['activity_type'];
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          company_id?: string | null;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          lead_id?: string | null;
          metadata?: NonNullable<Json>;
          occurred_at?: string;
          opportunity_id?: string | null;
          organization_id: string;
          performed_by_user_id?: string | null;
          source?: Database['public']['Enums']['activity_source'];
          title: string;
          type: Database['public']['Enums']['activity_type'];
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          company_id?: string | null;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          lead_id?: string | null;
          metadata?: NonNullable<Json>;
          occurred_at?: string;
          opportunity_id?: string | null;
          organization_id?: string;
          performed_by_user_id?: string | null;
          source?: Database['public']['Enums']['activity_source'];
          title?: string;
          type?: Database['public']['Enums']['activity_type'];
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'activities_company_fk';
            columns: ['organization_id', 'company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'activities_contact_fk';
            columns: ['organization_id', 'contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'activities_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'activities_lead_fk';
            columns: ['organization_id', 'lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'activities_opportunity_fk';
            columns: ['organization_id', 'opportunity_id'];
            isOneToOne: false;
            referencedRelation: 'opportunities';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'activities_opportunity_fk';
            columns: ['organization_id', 'opportunity_id'];
            isOneToOne: false;
            referencedRelation: 'opportunity_overview';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'activities_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'activities_performer_fk';
            columns: ['organization_id', 'performed_by_user_id'];
            isOneToOne: false;
            referencedRelation: 'organization_members';
            referencedColumns: ['organization_id', 'user_id'];
          },
          {
            foreignKeyName: 'activities_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      companies: {
        Row: {
          address_line: string | null;
          archived_at: string | null;
          city: string | null;
          country_code: string | null;
          created_at: string;
          created_by: string | null;
          customer_status: Database['public']['Enums']['customer_status'];
          email: string | null;
          id: string;
          legal_name: string | null;
          name: string;
          notes: string | null;
          organization_id: string;
          owner_user_id: string | null;
          phone: string | null;
          postal_code: string | null;
          tax_id: string | null;
          updated_at: string;
          updated_by: string | null;
          website: string | null;
        };
        Insert: {
          address_line?: string | null;
          archived_at?: string | null;
          city?: string | null;
          country_code?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_status?: Database['public']['Enums']['customer_status'];
          email?: string | null;
          id?: string;
          legal_name?: string | null;
          name: string;
          notes?: string | null;
          organization_id: string;
          owner_user_id?: string | null;
          phone?: string | null;
          postal_code?: string | null;
          tax_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          website?: string | null;
        };
        Update: {
          address_line?: string | null;
          archived_at?: string | null;
          city?: string | null;
          country_code?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_status?: Database['public']['Enums']['customer_status'];
          email?: string | null;
          id?: string;
          legal_name?: string | null;
          name?: string;
          notes?: string | null;
          organization_id?: string;
          owner_user_id?: string | null;
          phone?: string | null;
          postal_code?: string | null;
          tax_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          website?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'companies_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'companies_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'companies_owner_fk';
            columns: ['organization_id', 'owner_user_id'];
            isOneToOne: false;
            referencedRelation: 'organization_members';
            referencedColumns: ['organization_id', 'user_id'];
          },
          {
            foreignKeyName: 'companies_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      contacts: {
        Row: {
          archived_at: string | null;
          company_id: string | null;
          created_at: string;
          created_by: string | null;
          email: string | null;
          first_name: string;
          id: string;
          is_primary: boolean;
          job_title: string | null;
          last_name: string | null;
          mobile_phone: string | null;
          notes: string | null;
          organization_id: string;
          owner_user_id: string | null;
          phone: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          archived_at?: string | null;
          company_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          first_name: string;
          id?: string;
          is_primary?: boolean;
          job_title?: string | null;
          last_name?: string | null;
          mobile_phone?: string | null;
          notes?: string | null;
          organization_id: string;
          owner_user_id?: string | null;
          phone?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          archived_at?: string | null;
          company_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          first_name?: string;
          id?: string;
          is_primary?: boolean;
          job_title?: string | null;
          last_name?: string | null;
          mobile_phone?: string | null;
          notes?: string | null;
          organization_id?: string;
          owner_user_id?: string | null;
          phone?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'contacts_company_fk';
            columns: ['organization_id', 'company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'contacts_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contacts_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'contacts_owner_fk';
            columns: ['organization_id', 'owner_user_id'];
            isOneToOne: false;
            referencedRelation: 'organization_members';
            referencedColumns: ['organization_id', 'user_id'];
          },
          {
            foreignKeyName: 'contacts_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      leads: {
        Row: {
          company_name: string | null;
          converted_at: string | null;
          converted_contact_id: string | null;
          converted_customer_id: string | null;
          converted_opportunity_id: string | null;
          created_at: string;
          created_by: string | null;
          currency: string | null;
          email: string | null;
          estimated_value: number | null;
          id: string;
          job_title: string | null;
          lost_at: string | null;
          lost_note: string | null;
          lost_reason: Database['public']['Enums']['lead_lost_reason'] | null;
          name: string;
          notes: string | null;
          organization_id: string;
          owner_user_id: string | null;
          phone: string | null;
          qualified_at: string | null;
          source: Database['public']['Enums']['lead_source'] | null;
          stage: Database['public']['Enums']['lead_stage'];
          status: Database['public']['Enums']['lead_status'];
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          company_name?: string | null;
          converted_at?: string | null;
          converted_contact_id?: string | null;
          converted_customer_id?: string | null;
          converted_opportunity_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string | null;
          email?: string | null;
          estimated_value?: number | null;
          id?: string;
          job_title?: string | null;
          lost_at?: string | null;
          lost_note?: string | null;
          lost_reason?: Database['public']['Enums']['lead_lost_reason'] | null;
          name: string;
          notes?: string | null;
          organization_id: string;
          owner_user_id?: string | null;
          phone?: string | null;
          qualified_at?: string | null;
          source?: Database['public']['Enums']['lead_source'] | null;
          stage?: Database['public']['Enums']['lead_stage'];
          status?: Database['public']['Enums']['lead_status'];
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          company_name?: string | null;
          converted_at?: string | null;
          converted_contact_id?: string | null;
          converted_customer_id?: string | null;
          converted_opportunity_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string | null;
          email?: string | null;
          estimated_value?: number | null;
          id?: string;
          job_title?: string | null;
          lost_at?: string | null;
          lost_note?: string | null;
          lost_reason?: Database['public']['Enums']['lead_lost_reason'] | null;
          name?: string;
          notes?: string | null;
          organization_id?: string;
          owner_user_id?: string | null;
          phone?: string | null;
          qualified_at?: string | null;
          source?: Database['public']['Enums']['lead_source'] | null;
          stage?: Database['public']['Enums']['lead_stage'];
          status?: Database['public']['Enums']['lead_status'];
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'leads_contact_fk';
            columns: ['organization_id', 'converted_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'leads_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leads_customer_fk';
            columns: ['organization_id', 'converted_customer_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'leads_opportunity_fk';
            columns: ['organization_id', 'converted_opportunity_id'];
            isOneToOne: false;
            referencedRelation: 'opportunities';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'leads_opportunity_fk';
            columns: ['organization_id', 'converted_opportunity_id'];
            isOneToOne: false;
            referencedRelation: 'opportunity_overview';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'leads_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leads_owner_fk';
            columns: ['organization_id', 'owner_user_id'];
            isOneToOne: false;
            referencedRelation: 'organization_members';
            referencedColumns: ['organization_id', 'user_id'];
          },
          {
            foreignKeyName: 'leads_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      opportunities: {
        Row: {
          closed_at: string | null;
          company_id: string;
          created_at: string;
          created_by: string | null;
          currency: string | null;
          description: string | null;
          estimated_value: number | null;
          expected_close_date: string | null;
          id: string;
          interest_level: Database['public']['Enums']['interest_level'] | null;
          lost_reason: string | null;
          manual_probability: number | null;
          organization_id: string;
          owner_user_id: string | null;
          primary_contact_id: string | null;
          stage: Database['public']['Enums']['opportunity_stage'];
          status: Database['public']['Enums']['opportunity_status'];
          title: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          closed_at?: string | null;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string | null;
          description?: string | null;
          estimated_value?: number | null;
          expected_close_date?: string | null;
          id?: string;
          interest_level?: Database['public']['Enums']['interest_level'] | null;
          lost_reason?: string | null;
          manual_probability?: number | null;
          organization_id: string;
          owner_user_id?: string | null;
          primary_contact_id?: string | null;
          stage?: Database['public']['Enums']['opportunity_stage'];
          status?: Database['public']['Enums']['opportunity_status'];
          title: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          closed_at?: string | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string | null;
          description?: string | null;
          estimated_value?: number | null;
          expected_close_date?: string | null;
          id?: string;
          interest_level?: Database['public']['Enums']['interest_level'] | null;
          lost_reason?: string | null;
          manual_probability?: number | null;
          organization_id?: string;
          owner_user_id?: string | null;
          primary_contact_id?: string | null;
          stage?: Database['public']['Enums']['opportunity_stage'];
          status?: Database['public']['Enums']['opportunity_status'];
          title?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'opportunities_company_fk';
            columns: ['organization_id', 'company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'opportunities_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'opportunities_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'opportunities_owner_fk';
            columns: ['organization_id', 'owner_user_id'];
            isOneToOne: false;
            referencedRelation: 'organization_members';
            referencedColumns: ['organization_id', 'user_id'];
          },
          {
            foreignKeyName: 'opportunities_primary_contact_fk';
            columns: ['organization_id', 'primary_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'opportunities_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_members: {
        Row: {
          created_at: string;
          id: string;
          invited_by: string | null;
          joined_at: string;
          organization_id: string;
          role: Database['public']['Enums']['member_role'];
          status: Database['public']['Enums']['member_status'];
          status_changed_at: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          invited_by?: string | null;
          joined_at?: string;
          organization_id: string;
          role?: Database['public']['Enums']['member_role'];
          status?: Database['public']['Enums']['member_status'];
          status_changed_at?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          invited_by?: string | null;
          joined_at?: string;
          organization_id?: string;
          role?: Database['public']['Enums']['member_role'];
          status?: Database['public']['Enums']['member_status'];
          status_changed_at?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_members_invited_by_fkey';
            columns: ['invited_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_members_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      organizations: {
        Row: {
          country_code: string | null;
          created_at: string;
          created_by: string | null;
          default_currency: string;
          id: string;
          legal_name: string | null;
          locale: string;
          name: string;
          tax_id: string | null;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          country_code?: string | null;
          created_at?: string;
          created_by?: string | null;
          default_currency?: string;
          id?: string;
          legal_name?: string | null;
          locale?: string;
          name: string;
          tax_id?: string | null;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          country_code?: string | null;
          created_at?: string;
          created_by?: string | null;
          default_currency?: string;
          id?: string;
          legal_name?: string | null;
          locale?: string;
          name?: string;
          tax_id?: string | null;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organizations_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_path: string | null;
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          locale: string | null;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          avatar_path?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id: string;
          locale?: string | null;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          avatar_path?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          locale?: string | null;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          assigned_user_id: string | null;
          closed_at: string | null;
          company_id: string | null;
          contact_id: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          due_at: string | null;
          due_date: string | null;
          id: string;
          is_all_day: boolean;
          lead_id: string | null;
          location: string | null;
          opportunity_id: string | null;
          organization_id: string;
          priority: Database['public']['Enums']['task_priority'];
          scheduled_end_at: string | null;
          scheduled_start_at: string | null;
          source: Database['public']['Enums']['activity_source'];
          status: Database['public']['Enums']['task_status'];
          title: string;
          type: Database['public']['Enums']['task_type'];
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          assigned_user_id?: string | null;
          closed_at?: string | null;
          company_id?: string | null;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          due_at?: string | null;
          due_date?: string | null;
          id?: string;
          is_all_day?: boolean;
          lead_id?: string | null;
          location?: string | null;
          opportunity_id?: string | null;
          organization_id: string;
          priority?: Database['public']['Enums']['task_priority'];
          scheduled_end_at?: string | null;
          scheduled_start_at?: string | null;
          source?: Database['public']['Enums']['activity_source'];
          status?: Database['public']['Enums']['task_status'];
          title: string;
          type?: Database['public']['Enums']['task_type'];
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          assigned_user_id?: string | null;
          closed_at?: string | null;
          company_id?: string | null;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          due_at?: string | null;
          due_date?: string | null;
          id?: string;
          is_all_day?: boolean;
          lead_id?: string | null;
          location?: string | null;
          opportunity_id?: string | null;
          organization_id?: string;
          priority?: Database['public']['Enums']['task_priority'];
          scheduled_end_at?: string | null;
          scheduled_start_at?: string | null;
          source?: Database['public']['Enums']['activity_source'];
          status?: Database['public']['Enums']['task_status'];
          title?: string;
          type?: Database['public']['Enums']['task_type'];
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tasks_assignee_fk';
            columns: ['organization_id', 'assigned_user_id'];
            isOneToOne: false;
            referencedRelation: 'organization_members';
            referencedColumns: ['organization_id', 'user_id'];
          },
          {
            foreignKeyName: 'tasks_company_fk';
            columns: ['organization_id', 'company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'tasks_contact_fk';
            columns: ['organization_id', 'contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'tasks_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_lead_fk';
            columns: ['organization_id', 'lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'tasks_opportunity_fk';
            columns: ['organization_id', 'opportunity_id'];
            isOneToOne: false;
            referencedRelation: 'opportunities';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'tasks_opportunity_fk';
            columns: ['organization_id', 'opportunity_id'];
            isOneToOne: false;
            referencedRelation: 'opportunity_overview';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'tasks_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      opportunity_overview: {
        Row: {
          closed_at: string | null;
          company_id: string | null;
          created_at: string | null;
          created_by: string | null;
          currency: string | null;
          description: string | null;
          estimated_value: number | null;
          expected_close_date: string | null;
          id: string | null;
          interest_level: Database['public']['Enums']['interest_level'] | null;
          last_activity_at: string | null;
          lost_reason: string | null;
          manual_probability: number | null;
          needs_next_action: boolean | null;
          next_task_assigned_user_id: string | null;
          next_task_due_at: string | null;
          next_task_due_date: string | null;
          next_task_id: string | null;
          next_task_title: string | null;
          next_task_type: Database['public']['Enums']['task_type'] | null;
          organization_id: string | null;
          owner_user_id: string | null;
          primary_contact_id: string | null;
          stage: Database['public']['Enums']['opportunity_stage'] | null;
          status: Database['public']['Enums']['opportunity_status'] | null;
          title: string | null;
          updated_at: string | null;
          updated_by: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'opportunities_company_fk';
            columns: ['organization_id', 'company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'opportunities_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'opportunities_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'opportunities_owner_fk';
            columns: ['organization_id', 'owner_user_id'];
            isOneToOne: false;
            referencedRelation: 'organization_members';
            referencedColumns: ['organization_id', 'user_id'];
          },
          {
            foreignKeyName: 'opportunities_primary_contact_fk';
            columns: ['organization_id', 'primary_contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'opportunities_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      create_organization: {
        Args: {
          p_country_code?: string;
          p_default_currency?: string;
          p_locale?: string;
          p_name: string;
          p_timezone?: string;
        };
        Returns: {
          country_code: string | null;
          created_at: string;
          created_by: string | null;
          default_currency: string;
          id: string;
          legal_name: string | null;
          locale: string;
          name: string;
          tax_id: string | null;
          timezone: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'organizations';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      activity_source: 'manual' | 'system' | 'ai_assistant' | 'import' | 'integration';
      activity_type:
        | 'phone_call'
        | 'email'
        | 'meeting'
        | 'note'
        | 'offer_sent'
        | 'follow_up'
        | 'status_change'
        | 'other';
      customer_status: 'prospect' | 'active_customer' | 'inactive_customer';
      interest_level: 'low' | 'medium' | 'high';
      lead_lost_reason:
        | 'not_interested'
        | 'no_response'
        | 'competitor'
        | 'price'
        | 'postponed'
        | 'not_a_fit'
        | 'duplicate'
        | 'other';
      lead_source:
        | 'manual'
        | 'referral'
        | 'web'
        | 'email'
        | 'phone'
        | 'event'
        | 'social'
        | 'partner'
        | 'other';
      lead_stage: 'new' | 'contacted' | 'qualified';
      lead_status: 'active' | 'won' | 'lost';
      member_role: 'owner' | 'admin' | 'manager' | 'sales';
      member_status: 'active' | 'suspended' | 'removed';
      opportunity_stage: 'new_lead' | 'contacted' | 'qualified' | 'proposal' | 'negotiation';
      opportunity_status: 'active' | 'won' | 'lost';
      task_priority: 'low' | 'normal' | 'high';
      task_status: 'open' | 'completed' | 'cancelled';
      task_type:
        | 'general'
        | 'call'
        | 'email'
        | 'meeting'
        | 'follow_up'
        | 'send_offer'
        | 'send_document'
        | 'other';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      activity_source: ['manual', 'system', 'ai_assistant', 'import', 'integration'],
      activity_type: [
        'phone_call',
        'email',
        'meeting',
        'note',
        'offer_sent',
        'follow_up',
        'status_change',
        'other',
      ],
      customer_status: ['prospect', 'active_customer', 'inactive_customer'],
      interest_level: ['low', 'medium', 'high'],
      lead_lost_reason: [
        'not_interested',
        'no_response',
        'competitor',
        'price',
        'postponed',
        'not_a_fit',
        'duplicate',
        'other',
      ],
      lead_source: [
        'manual',
        'referral',
        'web',
        'email',
        'phone',
        'event',
        'social',
        'partner',
        'other',
      ],
      lead_stage: ['new', 'contacted', 'qualified'],
      lead_status: ['active', 'won', 'lost'],
      member_role: ['owner', 'admin', 'manager', 'sales'],
      member_status: ['active', 'suspended', 'removed'],
      opportunity_stage: ['new_lead', 'contacted', 'qualified', 'proposal', 'negotiation'],
      opportunity_status: ['active', 'won', 'lost'],
      task_priority: ['low', 'normal', 'high'],
      task_status: ['open', 'completed', 'cancelled'],
      task_type: [
        'general',
        'call',
        'email',
        'meeting',
        'follow_up',
        'send_offer',
        'send_document',
        'other',
      ],
    },
  },
} as const;
