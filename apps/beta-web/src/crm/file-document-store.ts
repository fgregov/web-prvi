// BETA server storage of offer PDFs: a private directory outside everything the
// server serves (default .data/offer-documents, git-ignored). Directories 0700,
// files 0600. Keys are server-made (document-store.ts) and resolved strictly
// inside the root, so no request can name a path.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { assertDocumentKey, type DocumentStore } from './document-store.ts';

export function createFileDocumentStore(rootDir: string): DocumentStore & {
  /** Removes uploads that were never saved with an offer (call at start-up). */
  clearStaging(): Promise<void>;
} {
  const root = resolve(rootDir);
  const pathOf = (key: string) => {
    const path = resolve(root, ...assertDocumentKey(key).split('/'));
    if (!path.startsWith(root + sep)) throw new Error('Invalid document key');
    return path;
  };
  async function ensureDir(path: string) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  }
  return {
    async put(key, bytes) {
      const path = pathOf(key);
      await ensureDir(path);
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, bytes, { mode: 0o600 });
      await rename(temp, path);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathOf(key)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async move(from, to) {
      const target = pathOf(to);
      await ensureDir(target);
      await rename(pathOf(from), target);
    },
    async delete(key) {
      await rm(pathOf(key), { force: true });
    },
    async clearStaging() {
      await rm(resolve(root, 'staging'), { recursive: true, force: true });
    },
  };
}
