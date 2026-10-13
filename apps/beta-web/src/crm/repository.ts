// Persistence contract for the CRM: one JSON document. Services only see
// CrmRepository, so the storage (memory, file, browser demo, later Supabase)
// can change without touching them. The file-backed version is file-repository.ts.
import type { CrmData, Offer } from './types.ts';

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
 * A stored document as the current code expects it: collections added later
 * start empty, and offers saved before the Follow-up Engine get their customer
 * (from their opportunity), no contact and no note. Nothing else changes.
 */
export function normalizeData(input: Partial<CrmData>): CrmData {
  const data = { ...emptyData(), ...input } as CrmData;
  const companyOf = new Map(data.opportunities.map((o) => [o.id, o.companyId]));
  data.offers = data.offers.map((offer) => {
    const o = offer as Partial<Offer> & Offer;
    if (o.companyId && 'note' in o && 'contactId' in o) return offer;
    return {
      ...o,
      companyId: o.companyId || (o.opportunityId ? (companyOf.get(o.opportunityId) ?? '') : ''),
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
