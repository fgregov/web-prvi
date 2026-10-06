/**
 * Controlled vocabularies of the RENVARA domain.
 *
 * These mirror the PostgreSQL enums 1:1. `@renvara/database` contains a
 * compile-time contract that fails the build if the two ever diverge, so the
 * database stays authoritative while the domain stays free of generated code.
 */

export const MEMBER_ROLES = ['owner', 'admin', 'manager', 'sales'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_STATUSES = ['active', 'suspended', 'removed'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const CUSTOMER_STATUSES = ['prospect', 'active_customer', 'inactive_customer'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** Ordered: index = position in the pipeline. */
export const OPPORTUNITY_STAGES = [
  'new_lead',
  'contacted',
  'qualified',
  'proposal',
  'negotiation',
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const OPPORTUNITY_STATUSES = ['active', 'won', 'lost'] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const INTEREST_LEVELS = ['low', 'medium', 'high'] as const;
export type InterestLevel = (typeof INTEREST_LEVELS)[number];

export const ACTIVITY_TYPES = [
  'phone_call',
  'email',
  'meeting',
  'note',
  'offer_sent',
  'follow_up',
  'status_change',
  'other',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_SOURCES = [
  'manual',
  'system',
  'ai_assistant',
  'import',
  'integration',
] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

/** Ordered as in the DB enum. `follow_up` is a plain type (no follow-up engine yet). */
export const TASK_TYPES = [
  'general',
  'call',
  'email',
  'meeting',
  'follow_up',
  'send_offer',
  'send_document',
  'other',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ['open', 'completed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
