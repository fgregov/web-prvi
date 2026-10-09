/**
 * Typed contract of the PostgreSQL schema, consumed by the Supabase clients in
 * the mobile and web apps (`createClient<Database>(...)`).
 *
 * database.types.ts is GENERATED — never edit it by hand. Regenerate with
 * `pnpm db:types` after every migration (CI fails if it is stale).
 */
export type { Database, Json, Tables, TablesInsert, TablesUpdate, Enums } from './database.types';
export type { EnumContract } from './enum-contract';

import type { Tables } from './database.types';

export type OrganizationRow = Tables<'organizations'>;
export type OrganizationMemberRow = Tables<'organization_members'>;
export type ProfileRow = Tables<'profiles'>;
export type CompanyRow = Tables<'companies'>;
export type ContactRow = Tables<'contacts'>;
export type OpportunityRow = Tables<'opportunities'>;
export type OpportunityOverviewRow = Tables<'opportunity_overview'>;
export type ActivityRow = Tables<'activities'>;
export type TaskRow = Tables<'tasks'>;
