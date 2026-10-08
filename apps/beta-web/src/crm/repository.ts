// Persistence contract for the CRM: one JSON document. Services only see
// CrmRepository, so the storage (memory, file, browser demo, later Supabase)
// can change without touching them. The file-backed version is file-repository.ts.
import type { CrmData } from './types.ts';

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
});

export function createMemoryRepository(initial: CrmData = emptyData()): CrmRepository {
  let current = { ...emptyData(), ...initial };
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
