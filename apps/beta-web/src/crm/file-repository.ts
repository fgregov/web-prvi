// BETA server storage: one JSON file, written atomically.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { emptyData, type CrmRepository } from './repository.ts';
import type { CrmData } from './types.ts';

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

  let depth = 0; // > 0 inside a transaction: writes wait for its end

  function write() {
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(current), { mode: 0o600 });
    renameSync(temp, file); // atomic: readers never see a half-written file
  }

  write();
  return {
    data: () => current,
    commit() {
      if (depth === 0) write();
    },
    replace(next) {
      current = next;
      if (depth === 0) write();
    },
    transaction(work) {
      const snapshot = structuredClone(current);
      depth += 1;
      try {
        const result = work();
        depth -= 1;
        if (depth === 0) write();
        return result;
      } catch (error) {
        depth -= 1;
        current = snapshot; // nothing was written while the transaction ran
        throw error;
      }
    },
  };
}
