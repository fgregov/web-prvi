// CRM records as persisted by the BETA server. Field names mirror the Supabase
// schema (supabase/migrations) in camelCase: companies ≈ customers, contacts,
// opportunities, tasks, activities. Every record carries organizationId and
// every read and write is scoped to the caller's organization.
import type {
  LeadLostReason,
  LeadSource,
  LeadStage,
  LeadStatus,
  LeadWonBasis,
  NotificationType,
  OfferStatus,
  ReminderStatus,
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
  /**
   * Activation (companies.is_active): an inactive customer is out of the
   * default customer list, with all its data kept. Separate from `type`.
   */
  status: 'active' | 'inactive';
  /** When and by whom it was deactivated; null while active (absent on older records). */
  deactivatedAt?: Iso | null;
  deactivatedBy?: string | null;
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

/**
 * A sales deal of a lead or of a customer (ADR-0009): `leadId` and/or
 * `companyId`, never neither. A lead's deal gets its customer when the lead is
 * converted; the lead stays linked.
 */
export interface Opportunity extends TenantRecord {
  /** The customer; null while the deal belongs to a lead that is not (yet) a customer. */
  companyId: string | null;
  /** The lead the deal was opened for; kept after the lead's conversion. */
  leadId: string | null;
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
  /** When it was won or lost (with status). Reporting date for WON / LOST. */
  closedAt: Iso | null;
  /** Final amount of a won deal; null → `value` (the estimate) was won. */
  wonValue?: number | null;
  lostReason?: string;
  /** Seeded demo rows are already part of the dashboard's static pipeline numbers. */
  seeded?: boolean;
}

/**
 * One change of an opportunity's status (public.opportunity_status_history),
 * appended on every create, close and reopen; never changed or deleted. The
 * reports count an opportunity by its current status and closedAt; this is
 * the history behind it (and for later historical analysis).
 */
export interface OpportunityStatusChange {
  readonly id: string;
  readonly organizationId: string;
  readonly opportunityId: string;
  /** Null for the status it was created with. */
  readonly fromStatus: Opportunity['status'] | null;
  readonly toStatus: Opportunity['status'];
  /** The amount at that moment: a win's final amount (else the estimate), otherwise the estimate. */
  readonly amount: number | null;
  readonly currency: string;
  readonly ownerId: string | null;
  readonly changedAt: Iso;
  readonly changedBy: string | null;
  /** app: recorded when it happened · backfill: rebuilt from createdAt/closedAt of older records. */
  readonly source: 'app' | 'backfill';
}

/**
 * A sales offer (public.offers): created outside Renvara (ERP, Word), tracked
 * here. Belongs to a customer, optionally to one of its opportunities and
 * contacts. Waits for feedback from `sentAt` until answered (or withdrawn, or
 * its deal closed). Follow-up Engine offers carry a PDF and a share link.
 */
export interface Offer extends TenantRecord {
  /**
   * The customer (company). Older records get it from their opportunity on
   * load. Null only for an offer within a lead's deal before the lead is
   * converted (ADR-0009).
   */
  companyId: string | null;
  opportunityId: string | null;
  contactId: string | null;
  title: string;
  status: OfferStatus;
  sentAt: Iso | null;
  answeredAt: Iso | null;
  withdrawnAt: Iso | null;
  createdBy: string | null;
  /** Internal note of the salesperson. Never shown to the customer. */
  note: string;
}

/**
 * The PDF of an offer (public.offer_documents). One active version per offer:
 * a replacement adds a version and marks the previous one replaced, never
 * overwriting it. The bytes live in private storage under `storageKey`.
 */
export interface OfferDocument extends TenantRecord {
  offerId: string;
  /** "<organizationId>/<offerId>/<documentId>.pdf": server-generated only. */
  storageKey: string;
  /** Display name (sanitized), e.g. "Ponuda_Feroterm_2026.pdf". */
  fileName: string;
  contentType: 'application/pdf';
  sizeBytes: number;
  pageCount: number;
  /** Hex SHA-256 of the bytes (integrity, duplicate detection). */
  sha256: string;
  version: number;
  replacedAt: Iso | null;
  uploadedBy: string | null;
}

/**
 * A secret link that opens one offer's PDF without a Renvara account
 * (public.offer_share_links). Bearer access: whoever has an unexpired,
 * unrevoked link can open it. Looked up by the token's SHA-256; the token
 * itself is kept only sealed (AES-GCM, server key) so it can be copied again.
 */
export interface OfferShareLink extends TenantRecord {
  offerId: string;
  documentId: string;
  /** Hex SHA-256 of the token. */
  tokenHash: string;
  /** base64url(iv ‖ AES-256-GCM ciphertext) of the token. */
  tokenSealed: string;
  expiresAt: Iso;
  revokedAt: Iso | null;
  revokedBy: string | null;
  createdBy: string | null;
}

/**
 * One engagement signal on a shared offer (public.offer_engagement_events).
 * `link_access`: the link was requested (scanners included). `document_view`:
 * the viewer rendered the PDF in a visible tab. No IP, no raw user agent.
 */
export interface OfferEvent {
  readonly id: string;
  readonly organizationId: string;
  offerId: string;
  shareLinkId: string;
  type: 'link_access' | 'document_view';
  occurredAt: Iso;
  /** Random id of one viewer tab (sessionStorage), null for server-only accesses. */
  sessionId: string | null;
  suspectedBot: boolean;
  /** Why it looks automated: scanner_user_agent, prefetch, head_request, no_user_agent, automation. */
  botReason: string | null;
  /** Coarse client family only, e.g. "Safari · iOS". */
  client: string | null;
}

export type ReminderTarget =
  | { readonly kind: 'task'; readonly id: string }
  | { readonly kind: 'lead'; readonly id: string }
  | { readonly kind: 'opportunity'; readonly id: string };

/** A push reminder for exactly one task, lead or opportunity (public.reminders). */
export interface Reminder extends TenantRecord {
  recipientUserId: string;
  createdBy: string | null;
  taskId: string | null;
  leadId: string | null;
  opportunityId: string | null;
  /** The instant to deliver (UTC). */
  remindAt: Iso;
  /** The zone it was chosen in (display, DST-safe editing). */
  timeZone: string;
  status: ReminderStatus;
  attempts: number;
  nextAttemptAt: Iso | null;
  deliveredAt: Iso | null;
  cancelledAt: Iso | null;
  lastError: string | null;
}

/** One device of a user that receives push reminders (Web Push subscription). */
export interface PushSubscriptionRecord extends TenantRecord {
  userId: string;
  platform: 'web';
  provider: 'webpush';
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
  enabled: boolean;
  lastSeenAt: Iso;
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
  /** When the lead was won: its first won opportunity (ADR-0009). */
  wonAt: Iso | null;
  /** opportunity: a deal of the lead was won · conversion: WON as it was recorded before ADR-0009. */
  wonBasis: LeadWonBasis | null;
  /** When it was converted into a customer; null on a WON lead = conversion pending. */
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

/**
 * MOBILNE OBAVIJESTI: one member's choice for one event type
 * (public.notification_preferences). No record = off.
 */
export interface NotificationPreference {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly type: NotificationType;
  enabled: boolean;
  /** Last time it was switched on: events from before it are never notified. */
  enabledAt: Iso | null;
  createdAt: Iso;
  updatedAt: Iso;
}

/** One member's notification settings (public.notification_settings). */
export interface NotificationSettings {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  /** "HH:MM" for deadlines given as a date only; null = they are not notified. */
  deadlineTime: string | null;
  /** The organization's timezone when saved: dates and bands are counted in it. */
  timeZone: string;
  createdAt: Iso;
  updatedAt: Iso;
}

/**
 * A push notification of MOBILNE OBAVIJESTI (public.notification_deliveries):
 * one per event and recipient (`idempotencyKey`), written by the server.
 * `acceptedAt` = the push service accepted it; not a device receipt.
 */
export interface NotificationDelivery {
  readonly id: string;
  readonly organizationId: string;
  readonly recipientUserId: string;
  readonly type: NotificationType;
  /** The offer, task or opportunity it is about. */
  readonly sourceId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: Iso;
  status: ReminderStatus;
  attempts: number;
  nextAttemptAt: Iso | null;
  acceptedAt: Iso | null;
  devicesAccepted: number;
  lastError: string | null;
  title: string;
  body: string;
  url: string;
  createdAt: Iso;
  updatedAt: Iso;
}

// ------------------------------------------------------------- reports ---
export type ReportType = 'revenue' | 'quarters' | 'won_lost' | 'sales_reps';

/**
 * One "Pošalji e-mail" of a report (public.report_email_log): when, by whom,
 * to whom, which report and how it ended. Never the message text or the PDF.
 */
export interface ReportEmail {
  readonly id: string;
  readonly organizationId: string;
  readonly sentBy: string;
  readonly sentByName: string;
  readonly recipient: string;
  readonly reportType: ReportType;
  readonly periodFrom: CalendarDate | null;
  readonly periodTo: CalendarDate | null;
  readonly attachmentName: string;
  /** sent: the e-mail service accepted it · failed: it refused or did not answer. */
  readonly status: 'sent' | 'failed';
  readonly provider: string;
  /** The service's id of the accepted message. */
  readonly providerMessageId: string | null;
  /** Short reason of a failure (status code or kind), never secrets. */
  readonly error: string | null;
  readonly createdAt: Iso;
}

// ------------------------------------------------------- users (ADR-0014) ---
/** owner: every right, always; admin: given rights, may hold user administration; user: given rights. */
export type MemberRole = 'owner' | 'admin' | 'user';
export type MemberStatus = 'active' | 'inactive';

/**
 * A member of the organization (Korisnici). Credentials are never here: the
 * identity provider keeps them (local accounts file or Supabase Auth).
 */
export interface UserProfile {
  readonly id: string;
  readonly organizationId: string;
  firstName: string;
  lastName: string;
  /** Croatian OIB (personal data: shown only on the user's detail page). */
  oib: string;
  /** Sign-in address, unique in the organization (lower case). */
  email: string;
  phone: string;
  role: MemberRole;
  status: MemberStatus;
  /** The server's first owner, signing in with RENVARA_BETA_USERNAME (local identity). */
  readonly bootstrap?: boolean;
  readonly createdAt: Iso;
  readonly createdBy: string | null;
  updatedAt: Iso;
  deactivatedAt: Iso | null;
  deactivatedBy: string | null;
  lastLoginAt: Iso | null;
}

/** One right of one member; an owner's are not stored (an owner has all). */
export interface UserPermission {
  readonly organizationId: string;
  readonly userId: string;
  readonly key: string;
  allowed: boolean;
  updatedAt: Iso;
  updatedBy: string | null;
}

export type AuditAction =
  | 'user.create'
  | 'user.update'
  | 'user.deactivate'
  | 'user.activate'
  | 'user.access'
  | 'user.password_change'
  | 'user.password_link';

/** Administration log: who did what to whom, and how it ended. Never secrets. */
export interface AuditEntry {
  readonly id: string;
  readonly organizationId: string;
  readonly actorUserId: string | null;
  readonly targetUserId: string | null;
  readonly action: AuditAction;
  readonly result: 'success' | 'denied' | 'failed';
  /** Changed field names, role and rights added/removed; no values of personal data. */
  readonly details: Record<string, unknown>;
  readonly at: Iso;
}

/** What the signed-in member may do (resolved on every request; never from the browser). */
export interface MemberAccess {
  readonly role: MemberRole;
  readonly permissions: ReadonlySet<string>;
}

export interface CrmData {
  version: 2;
  seq: number;
  customers: Customer[];
  contacts: Contact[];
  opportunities: Opportunity[];
  opportunityStatusChanges: OpportunityStatusChange[];
  tasks: Task[];
  activities: Activity[];
  leads: Lead[];
  offers: Offer[];
  offerDocuments: OfferDocument[];
  offerShareLinks: OfferShareLink[];
  offerEvents: OfferEvent[];
  reminders: Reminder[];
  pushSubscriptions: PushSubscriptionRecord[];
  notificationPreferences: NotificationPreference[];
  notificationSettings: NotificationSettings[];
  notificationDeliveries: NotificationDelivery[];
  users: UserProfile[];
  userPermissions: UserPermission[];
  auditLog: AuditEntry[];
  reportEmails: ReportEmail[];
}

/** Who is acting, for which organization, at what time. Built per request from the session. */
export interface CrmContext {
  readonly organizationId: string;
  readonly user: { readonly id: string; readonly displayName: string };
  readonly timeZone: string;
  readonly now: Date;
  /** Role and rights of the user (API routes refuse what is not in it; absent: nothing allowed). */
  readonly access?: MemberAccess;
}
