/**
 * Compile-time contract: the domain vocabulary must equal the PostgreSQL enums.
 * If a migration adds/removes an enum value and `pnpm db:types` is re-run, the
 * typecheck fails here until packages/domain/src/shared/vocabulary.ts matches.
 */
import type * as D from '@renvara/domain';
import type { Database } from './database.types';

type DbEnums = Database['public']['Enums'];

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type EnumContract = [
  Assert<Equal<D.MemberRole, DbEnums['member_role']>>,
  Assert<Equal<D.MemberStatus, DbEnums['member_status']>>,
  Assert<Equal<D.CustomerStatus, DbEnums['customer_status']>>,
  Assert<Equal<D.OpportunityStage, DbEnums['opportunity_stage']>>,
  Assert<Equal<D.OpportunityStatus, DbEnums['opportunity_status']>>,
  Assert<Equal<D.InterestLevel, DbEnums['interest_level']>>,
  Assert<Equal<D.ActivityType, DbEnums['activity_type']>>,
  Assert<Equal<D.ActivitySource, DbEnums['activity_source']>>,
  Assert<Equal<D.TaskType, DbEnums['task_type']>>,
  Assert<Equal<D.TaskStatus, DbEnums['task_status']>>,
  Assert<Equal<D.TaskPriority, DbEnums['task_priority']>>,
  Assert<Equal<D.LeadStage, DbEnums['lead_stage']>>,
  Assert<Equal<D.LeadStatus, DbEnums['lead_status']>>,
  Assert<Equal<D.LeadSource, DbEnums['lead_source']>>,
  Assert<Equal<D.LeadLostReason, DbEnums['lead_lost_reason']>>,
  Assert<Equal<D.OfferStatus, DbEnums['offer_status']>>,
  Assert<Equal<D.ReminderStatus, DbEnums['reminder_status']>>,
];
