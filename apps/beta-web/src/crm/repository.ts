// Persistence contract for the CRM: one JSON document. Services only see
// CrmRepository, so the storage (memory, file, browser demo, later Supabase)
// can change without touching them. The file-backed version is file-repository.ts.
import type { CrmData, Lead, Offer, Opportunity } from './types.ts';

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
  tasks: [],
  activities: [],
  leads: [],
  offers: [],
  offerDocuments: [],
  offerShareLinks: [],
  offerEvents: [],
  reminders: [],
  pushSubscriptions: [],
});

/**
 * A stored document as the current code expects it. Collections added later
 * start empty. Offers saved before the Follow-up Engine get their customer
 * (from their opportunity), no contact and no note. Opportunities saved before
 * ADR-0009 belong to their customer only (no lead). Leads WON before ADR-0009
 * (WON then meant "converted") were won at their conversion: wonAt =
 * convertedAt, wonBasis = 'conversion'. Nothing else changes and no sale is
 * invented.
 */
export function normalizeData(input: Partial<CrmData>): CrmData {
  const data = { ...emptyData(), ...input } as CrmData;
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
