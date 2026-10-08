// CRM records as persisted by the BETA server. Field names mirror the Supabase
// schema (supabase/migrations) in camelCase: companies ≈ customers, contacts,
// opportunities, tasks, activities. Every record carries organizationId and
// every read and write is scoped to the caller's organization.
import type {
  LeadLostReason,
  LeadSource,
  LeadStage,
  LeadStatus,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@renvara/domain';

export type Iso = string; // UTC instant, e.g. "2026-10-06T14:00:00.000Z"
export type CalendarDate = string; // "YYYY-MM-DD"

/** Who created a record. Maps to public.activity_source (user → manual, ai → ai_assistant). */
export type RecordSource = 'user' | 'system' | 'ai';

interface TenantRecord {
  readonly id: string;
  readonly organizationId: string;
  createdAt: Iso;
  updatedAt: Iso;
}

export interface Customer extends TenantRecord {
  companyName: string;
  oib: string;
  address: string;
  postalCode: string;
  city: string;
  email: string;
  phone: string;
  website: string;
  status: 'active' | 'inactive';
  type: 'customer' | 'prospect';
  ownerId: string | null;
  ownerName: string | null;
  notes: string;
  primaryContactId: string | null;
}

export interface Contact extends TenantRecord {
  companyId: string;
  firstName: string;
  lastName: string;
  role: string;
  email: string;
  phone: string;
  notes: string;
  isPrimary: boolean;
}

export interface Opportunity extends TenantRecord {
  companyId: string;
  contactId: string | null;
  title: string;
  value: number | null;
  currency: string;
  stage: string;
  status: 'active' | 'won' | 'lost';
  expectedCloseDate: CalendarDate | null;
  ownerId: string | null;
  ownerName: string | null;
  notes: string;
  closedAt: Iso | null;
  /** Seeded demo rows are already part of the dashboard's static pipeline numbers. */
  seeded?: boolean;
}

/**
 * A potential customer before it becomes one (public.leads). Never deleted:
 * won (converted) and lost leads stay for reporting, each outcome with its own date.
 */
export interface Lead extends TenantRecord {
  ownerId: string | null;
  ownerName: string | null;
  /** A person ("Ivan Horvat") or a business ("FERO-TERM Rijeka"). */
  name: string;
  companyName: string;
  email: string;
  phone: string;
  jobTitle: string;
  source: LeadSource | null;
  notes: string;
  stage: LeadStage;
  status: LeadStatus;
  estimatedValue: number | null;
  currency: string | null;
  qualifiedAt: Iso | null;
  convertedAt: Iso | null;
  lostAt: Iso | null;
  lostReason: LeadLostReason | null;
  lostNote: string;
  convertedCustomerId: string | null;
  convertedContactId: string | null;
  convertedOpportunityId: string | null;
}

export interface Task extends TenantRecord {
  companyId: string | null;
  contactId: string | null;
  opportunityId: string | null;
  /** Optional lead the task concerns; such a task needs no customer. */
  leadId?: string | null;
  assignedUserId: string | null;
  createdBy: string | null;
  type: TaskType;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  /** Sales Calendar placement ("Zakazano"). Null → not in the calendar. */
  scheduledStartAt: Iso | null;
  scheduledEndAt: Iso | null;
  /** Date-only calendar entry: scheduledStartAt is the start of that day in the org timezone. */
  allDay: boolean;
  /** Deadline ("Rok"): a calendar day or an exact instant, never both (as in the DB). */
  dueDate: CalendarDate | null;
  dueAt: Iso | null;
  location: string;
  source: RecordSource;
  completedAt: Iso | null;
  cancelledAt: Iso | null;
}

export interface Activity {
  readonly id: string;
  readonly organizationId: string;
  /** Null for entries of a lead that is not a customer (yet). */
  companyId: string | null;
  leadId?: string | null;
  type: string;
  title: string;
  description: string;
  relatedId: string | null;
  actorId: string | null;
  actorName: string | null;
  occurredAt: Iso;
  seq: number;
}

export interface CrmData {
  version: 2;
  seq: number;
  customers: Customer[];
  contacts: Contact[];
  opportunities: Opportunity[];
  tasks: Task[];
  activities: Activity[];
  leads: Lead[];
}

/** Who is acting, for which organization, at what time. Built per request from the session. */
export interface CrmContext {
  readonly organizationId: string;
  readonly user: { readonly id: string; readonly displayName: string };
  readonly timeZone: string;
  readonly now: Date;
}
