// Offer PDFs in the demo: IndexedDB of this browser (a DocumentStore, as the
// server's private folder). The offer records go to the demo's store like any
// other record; the files never leave this browser. When IndexedDB is not
// available (e.g. a private window), files are kept in memory until reload.
import { assertDocumentKey } from '../server/crm/document-store.js';

const STORE = 'files';

export function indexedDbDocumentStore(name = 'renvara-demo-documents') {
  const memory = new Map();
  let opened = null;
  const open = () =>
    (opened ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  async function transaction(mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  const store = {
    async put(key, bytes) {
      assertDocumentKey(key);
      const copy = bytes.slice();
      try {
        await transaction('readwrite', (files) => files.put(copy, key));
        memory.delete(key);
      } catch {
        memory.set(key, copy);
      }
    },
    async get(key) {
      assertDocumentKey(key);
      if (memory.has(key)) return memory.get(key).slice();
      try {
        const bytes = await transaction('readonly', (files) => files.get(key));
        return bytes ? new Uint8Array(bytes) : null;
      } catch {
        return null;
      }
    },
    async move(from, to) {
      const bytes = await store.get(from);
      if (!bytes) throw new Error('Missing document');
      await store.put(to, bytes);
      await store.delete(from);
    },
    async delete(key) {
      assertDocumentKey(key);
      memory.delete(key);
      try {
        await transaction('readwrite', (files) => files.delete(key));
      } catch {
        /* nothing stored there */
      }
    },
  };
  return store;
}
