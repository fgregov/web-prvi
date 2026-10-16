// Persistence contract for the CRM: one JSON document. Services only see
// CrmRepository, so the storage (memory, file, browser demo, later Supabase)
// can change without touching them. The file-backed version is file-repository.ts.
import type { CrmData, Lead, Offer, Opportunity, OpportunityStatusChange } from './types.ts';

export interface CrmRepository {
  /** The live document. Mutate it, then call commit(). */
  data(): CrmData;
  commit(): void;
  replace(next: CrmData): void;
  /**
   * Runs `work` as one unit: every change inside it is saved together, or —
   * when it throws — none is and the document is restored (e.g. converting a
   * lead: customer + contact + opportunity + lead update).
   */
  transaction<T>(work: () => T): T;
}

export const emptyData = (): CrmData => ({
  version: 2,
  seq: 0,
  customers: [],
  contacts: [],
  opportunities: [],
  opportunityStatusChanges: [],
  tasks: [],
  activities: [],
  leads: [],
  offers: [],
  offerDocuments: [],
  offerShareLinks: [],
  offerEvents: [],
  reminders: [],
  pushSubscriptions: [],
  notificationPreferences: [],
  notificationSettings: [],
  notificationDeliveries: [],
  users: [],
  userPermissions: [],
  auditLog: [],
  reportEmails: [],
});

/**
 * The status history of opportunities saved before it was recorded, rebuilt
 * from what is reliable: the status each was created with (at createdAt) and,
 * for a closed one, its close (at closedAt). Marked `backfill`. Nothing is
 * guessed from updatedAt.
 */
function backfillStatusHistory(opportunities: readonly Opportunity[]): OpportunityStatusChange[] {
  const out: OpportunityStatusChange[] = [];
  for (const o of opportunities) {
    const base = {
      organizationId: o.organizationId,
      opportunityId: o.id,
      currency: o.currency,
      ownerId: o.ownerId,
      changedBy: o.ownerId,
      source: 'backfill' as const,
    };
    const closedAtCreation = o.status !== 'active' && o.closedAt === o.createdAt;
    out.push({
      ...base,
      id: globalThis.crypto.randomUUID(),
      fromStatus: null,
      toStatus: closedAtCreation ? o.status : 'active',
      amount: closedAtCreation && o.status === 'won' ? (o.wonValue ?? o.value) : o.value,
      changedAt: o.createdAt,
    });
    if (o.status !== 'active' && o.closedAt && !closedAtCreation) {
      out.push({
        ...base,
        id: globalThis.crypto.randomUUID(),
        fromStatus: 'active',
        toStatus: o.status,
        amount: o.status === 'won' ? (o.wonValue ?? o.value) : o.value,
        changedAt: o.closedAt,
      });
    }
  }
  return out;
}

/**
 * Rights added with IZVJEŠTAJI (the same step as the database migration
 * 20261018120000_reports.sql): a member who could open reports may also e-mail
 * them; an administrator also compares sales representatives. Runs once, on the
 * first load of a document from before the reports.
 */
function grantReportRights(data: CrmData) {
  const now = new Date().toISOString();
  const has = (orgId: string, userId: string, key: string) =>
    data.userPermissions.some(
      (p) => p.organizationId === orgId && p.userId === userId && p.key === key && p.allowed,
    );
  for (const user of data.users) {
    if (user.role === 'owner') continue; // an owner holds every right implicitly
    const grant = (key: string) => {
      if (has(user.organizationId, user.id, key)) return;
      data.userPermissions.push({
        organizationId: user.organizationId,
        userId: user.id,
        key,
        allowed: true,
        updatedAt: now,
        updatedBy: null,
      });
    };
    if (has(user.organizationId, user.id, 'reports.view')) {
      grant('reports.email');
      if (user.role === 'admin') grant('reports.sales_reps');
    }
  }
}

/**
 * A stored document as the current code expects it. Collections added later
 * start empty. Offers saved before the Follow-up Engine get their customer
 * (from their opportunity), no contact and no note. Opportunities saved before
 * ADR-0009 belong to their customer only (no lead). Leads WON before ADR-0009
 * (WON then meant "converted") were won at their conversion: wonAt =
 * convertedAt, wonBasis = 'conversion'. Nothing else changes and no sale is
 * invented. Data from before MOBILNE OBAVIJESTI: a user with reminders still to
 * fire keeps receiving them ("Podsjetnik" on); everything else starts off.
 * Data from before IZVJEŠTAJI: the status history is rebuilt from createdAt
 * and closedAt, and the new report rights follow reports.view.
 */
export function normalizeData(input: Partial<CrmData>): CrmData {
  const data = { ...emptyData(), ...input } as CrmData;
  if (input.opportunityStatusChanges === undefined) {
    data.opportunityStatusChanges = backfillStatusHistory(data.opportunities);
  }
  if (input.reportEmails === undefined) grantReportRights(data);
  if (input.notificationPreferences === undefined) {
    const now = new Date().toISOString();
    const seen = new Set<string>();
    for (const r of data.reminders) {
      const key = `${r.organizationId}|${r.recipientUserId}`;
      if ((r.status !== 'pending' && r.status !== 'processing') || seen.has(key)) continue;
      seen.add(key);
      data.notificationPreferences.push({
        id: globalThis.crypto.randomUUID(),
        organizationId: r.organizationId,
        userId: r.recipientUserId,
        type: 'reminder_due',
        enabled: true,
        enabledAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  // Records as stored: fields added later may be missing (undefined).
  type Stored<T, K extends keyof T> = Omit<T, K> & { [P in K]?: T[P] };
  data.opportunities = data.opportunities.map((o) => {
    const stored = o as Stored<Opportunity, 'leadId'>;
    return stored.leadId === undefined ? { ...stored, leadId: null } : o;
  });
  data.leads = data.leads.map((lead) => {
    const l = lead as Stored<Lead, 'wonAt' | 'wonBasis'>;
    if (l.wonAt !== undefined && l.wonBasis !== undefined) return lead;
    const won = l.status === 'won';
    return {
      ...l,
      wonAt: won ? (l.convertedAt ?? l.updatedAt) : null,
      wonBasis: won ? ('conversion' as const) : null,
    };
  });
  const companyOf = new Map(data.opportunities.map((o) => [o.id, o.companyId]));
  data.offers = data.offers.map((offer) => {
    const o = offer as Stored<Offer, 'companyId' | 'note' | 'contactId' | 'opportunityId'>;
    if (o.companyId !== undefined && o.note !== undefined && o.contactId !== undefined) {
      return offer;
    }
    return {
      ...o,
      companyId: o.companyId || (o.opportunityId ? (companyOf.get(o.opportunityId) ?? null) : null),
      opportunityId: o.opportunityId ?? null,
      contactId: o.contactId ?? null,
      note: o.note ?? '',
    };
  });
  return data;
}

export function createMemoryRepository(initial: CrmData = emptyData()): CrmRepository {
  let current = normalizeData(initial);
  return {
    data: () => current,
    commit: () => {},
    replace: (next) => {
      current = next;
    },
    transaction(work) {
      const snapshot = structuredClone(current);
      try {
        return work();
      } catch (error) {
        current = snapshot;
        throw error;
      }
    },
  };
}
