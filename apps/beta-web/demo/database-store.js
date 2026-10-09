// The demo's test database inside a claude.ai artifact: the artifact's `db`
// store, one document per record (`customers/<id>`, `tasks/<id>`, …).
//
// The platform store has no transactions, refuses bursts of concurrent writes
// (`resource_exhausted`) and does not promise that a call is ever answered
// once its bridge stops responding (a backgrounded phone). So a save:
//   - writes one document at a time, records before their history entries;
//   - gives every call a bounded wait (no answer = `unavailable`) and one
//     retry for transient conditions, so a request ends instead of hanging
//     and blocking every later save;
//   - when a write fails, puts back what this save had already written, and
//     reports the records exactly as the database now holds them, so the page
//     never keeps or shows a change the database does not have.

/** Records first, their history last: a failed save never leaves a history entry alone. */
export const WRITE_ORDER = [
  'leads',
  'customers',
  'contacts',
  'opportunities',
  'offers',
  'tasks',
  'reminders',
  'activities',
];
/** Longest one database call may take before it counts as `unavailable`. */
export const CALL_LIMIT_MS = 10_000;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rejects with `unavailable` when `promise` is not settled within `ms`. */
function within(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject({ code: 'unavailable', message: `No answer from the database in ${ms} ms` }),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * @template {Record<string, any>} T  the CRM data (collections of records by name)
 * @param {any} db  the artifact's `db` namespace (`claude.use("db")`)
 * @param {{ collections: string[], empty: () => T, limitMs?: number, retryDelayMs?: (code: string) => number }} options
 */
export function databaseStore(db, { collections, empty, limitMs = CALL_LIMIT_MS, retryDelayMs }) {
  const saved = new Map(); // "collection/id" → JSON as the database holds it, as far as this view knows
  const order = [
    ...WRITE_ORDER.filter((name) => collections.includes(name)),
    ...collections.filter((name) => !WRITE_ORDER.includes(name)),
  ];
  const delay =
    retryDelayMs ?? ((code) => (code === 'resource_exhausted' ? 1200 : 300) + Math.random() * 600);

  /** One platform call: bounded wait, one retry when the condition is transient. */
  async function call(work) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await within(work(), limitMs);
      } catch (error) {
        const transient = error?.code === 'unavailable' || error?.code === 'resource_exhausted';
        if (!transient || attempt > 0) throw error;
        await pause(delay(error.code));
      }
    }
  }

  async function write(key, json) {
    const ref = db.doc(key);
    if (json === null) {
      await call(() => ref.delete());
      saved.delete(key);
    } else {
      await call(() => ref.set(JSON.parse(json)));
      saved.set(key, json);
    }
  }

  /**
   * The records exactly as the database holds them (after a failed save).
   * @returns {T}
   */
  function current() {
    const data = empty();
    for (const [key, json] of saved) {
      const name = key.slice(0, key.indexOf('/'));
      if (Array.isArray(data[name])) data[name].push(JSON.parse(json));
    }
    data.seq = Math.max(0, ...(data.activities ?? []).map((a) => a.seq ?? 0));
    return data;
  }

  return {
    kind: 'database',
    current,

    /** @returns {Promise<T>} */
    async load() {
      const snapshots = await Promise.all(
        collections.map((name) => call(() => db.collection(name).limit(1000).get())),
      );
      saved.clear();
      snapshots.forEach((snap, i) => {
        for (const doc of snap.docs) {
          saved.set(`${collections[i]}/${doc.id}`, JSON.stringify(structuredClone(doc.data())));
        }
      });
      return current();
    },

    /**
     * Writes what changed since the last save. All or nothing, as far as the database allows.
     * @param {T} data
     */
    async save(data) {
      const ops = [];
      const next = new Set();
      for (const name of order) {
        for (const row of data[name] ?? []) {
          const key = `${name}/${row.id}`;
          const json = JSON.stringify(row);
          next.add(key);
          if (saved.get(key) !== json) ops.push({ key, json, previous: saved.get(key) ?? null });
        }
      }
      for (const [key, json] of saved) {
        if (!next.has(key)) ops.push({ key, json: null, previous: json });
      }
      const done = [];
      try {
        for (const op of ops) {
          await write(op.key, op.json);
          done.push(op);
        }
      } catch (error) {
        // Undo this save's earlier writes, newest first. A write that cannot be
        // undone stays recorded in `saved`, so current() still matches the database.
        for (const op of done.reverse()) {
          try {
            await write(op.key, op.previous);
          } catch {
            /* the database keeps it, and so does current() */
          }
        }
        throw error;
      }
    },
  };
}
