// Persistence for the BETA CRM: one JSON document, written atomically.
// Stands in for the Supabase tables until the app talks to Postgres; services
// only see CrmRepository, so the swap does not touch them.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CrmData } from './types.ts';

export interface CrmRepository {
  /** The live document. Mutate it, then call commit(). */
  data(): CrmData;
  commit(): void;
  replace(next: CrmData): void;
}

export const emptyData = (): CrmData => ({
  version: 2,
  seq: 0,
  customers: [],
  contacts: [],
  opportunities: [],
  tasks: [],
  activities: [],
});

export function createMemoryRepository(initial: CrmData = emptyData()): CrmRepository {
  let current = initial;
  return {
    data: () => current,
    commit: () => {},
    replace: (next) => {
      current = next;
    },
  };
}

/**
 * File-backed repository. `seed` builds the first document when the file does
 * not exist yet (or holds an older schema version).
 */
export function createFileRepository(file: string, seed: () => CrmData): CrmRepository {
  let current: CrmData;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<CrmData>;
    current = parsed.version === 2 ? { ...emptyData(), ...parsed } : seed();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    current = seed();
  }

  function commit() {
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(current), { mode: 0o600 });
    renameSync(temp, file); // atomic: readers never see a half-written file
  }

  commit();
  return {
    data: () => current,
    commit,
    replace(next) {
      current = next;
      commit();
    },
  };
}
