// The demo's test database inside a claude.ai artifact: the artifact's `db`
// store, one document per record (`customers/<id>`, `tasks/<id>`, …).
//
// The platform store has no transactions, refuses bursts of concurrent writes
// (`resource_exhausted`), allows ONE write at a time per document, may apply a
// write and still answer `unavailable` ("a retried write can apply twice"),
// can be slow over a phone's bridge, and does not promise an answer at all
// once that bridge stops responding (a backgrounded phone). So a save:
//   - writes one document at a time, records before their history entries,
//     and never starts a write to a document whose previous write has not
//     been answered;
//   - waits patiently for a slow answer (telling the page after a few
//     seconds), up to a limit, so a request ends instead of hanging forever;
//   - when the outcome is uncertain (`unavailable`, or no answer), reads the
//     document back: a write that did land counts as done, not as a failure;
//   - retries once only for a definite refusal or a write that did not land;
//   - when a write fails, puts back what this save had already written, and
//     reports the records exactly as the database now holds them (a write
//     answered after the save gave up is recorded when it lands), so the page
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
/** Longest the page waits for one database call before the save gives up on it. */
export const CALL_LIMIT_MS = 45_000;
/** After this long without an answer, the page is told that the database is slow. */
export const SLOW_AFTER_MS = 4_000;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (promise) =>
  Promise.resolve(promise).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
/** JSON with sorted keys: the same document, whatever order the store returns its fields in. */
const canonical = (value) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );

/**
 * @template {Record<string, any>} T  the CRM data (collections of records by name)
 * @param {any} db  the artifact's `db` namespace (`claude.use("db")`)
 * @param {{
 *   collections: string[],
 *   empty: () => T,
 *   limitMs?: number,
 *   slowAfterMs?: number,
 *   retryDelayMs?: (code: string) => number,
 *   onSlow?: (slow: boolean) => void,
 *   onLate?: () => void,
 * }} options  onSlow: a call is taking long (true) / no longer (false); onLate: a
 *   write the save had given up on was answered after all (current() changed)
 */
export function databaseStore(
  db,
  {
    collections,
    empty,
    limitMs = CALL_LIMIT_MS,
    slowAfterMs = SLOW_AFTER_MS,
    retryDelayMs,
    onSlow = () => {},
    onLate = () => {},
  },
) {
  const saved = new Map(); // "collection/id" → JSON as the database holds it, as far as this view knows
  const pending = new Map(); // "collection/id" → a write to it that has not been answered yet
  let slowCalls = 0;
  const order = [
    ...WRITE_ORDER.filter((name) => collections.includes(name)),
    ...collections.filter((name) => !WRITE_ORDER.includes(name)),
  ];
  const delay =
    retryDelayMs ?? ((code) => (code === 'resource_exhausted' ? 1200 : 300) + Math.random() * 600);

  /**
   * Waits for one platform call, up to `limitMs` (then `timedOut`, the call
   * itself may still be answered later). Tells the page when it is slow.
   * @returns {Promise<{ ok: true, value?: any } | { ok: false, error: any, timedOut?: boolean }>}
   */
  async function wait(promise) {
    let slow = false;
    let limit;
    const slowTimer = setTimeout(() => {
      slow = true;
      if (slowCalls++ === 0) onSlow(true);
    }, slowAfterMs);
    try {
      return await Promise.race([
        settle(promise),
        new Promise((resolve) => {
          limit = setTimeout(
            () =>
              resolve({
                ok: false,
                timedOut: true,
                error: {
                  code: 'unavailable',
                  message: `No answer from the database in ${limitMs} ms`,
                },
              }),
            limitMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(slowTimer);
      clearTimeout(limit);
      if (slow && --slowCalls === 0) onSlow(false);
    }
  }

  const transient = (code) => code === 'unavailable' || code === 'resource_exhausted';

  /** A read: retried once for a transient refusal; no answer at all is a failure. */
  async function read(work) {
    for (let attempt = 0; ; attempt++) {
      const outcome = await wait(work());
      if (outcome.ok) return outcome.value;
      if (outcome.timedOut || !transient(outcome.error?.code) || attempt > 0) throw outcome.error;
      await pause(delay(outcome.error.code));
    }
  }

  const record = (key, json) => (json === null ? saved.delete(key) : saved.set(key, json));

  /** Whether the database holds `json` at `key` (null: no document). */
  async function holds(ref, json) {
    if (typeof ref.get !== 'function') return false;
    const outcome = await wait(ref.get());
    if (!outcome.ok) return false;
    const snapshot = outcome.value;
    if (json === null) return !snapshot.exists;
    return Boolean(snapshot.exists) && canonical(snapshot.data()) === canonical(JSON.parse(json));
  }

  async function write(key, json) {
    // One write at a time per document: wait for an earlier, unanswered one.
    const earlier = pending.get(key);
    if (earlier) {
      const outcome = await wait(earlier.promise);
      if (outcome.ok === false && outcome.timedOut) throw outcome.error;
    }
    const ref = db.doc(key);
    for (let attempt = 0; ; attempt++) {
      const promise = json === null ? ref.delete() : ref.set(JSON.parse(json));
      const entry = { promise, gaveUp: false };
      pending.set(key, entry);
      settle(promise).then(({ ok }) => {
        if (pending.get(key) !== entry) return;
        pending.delete(key);
        // Answered after the save gave up on it: the database has it after all.
        if (ok && entry.gaveUp) {
          record(key, json);
          onLate();
        }
      });
      const outcome = await wait(promise);
      if (outcome.ok) break;
      const code = outcome.error?.code;
      // Uncertain outcome: the write may have landed anyway. Look before retrying.
      if (code === 'unavailable' && (await holds(ref, json))) break;
      if (outcome.timedOut) {
        entry.gaveUp = true; // still unanswered: never race it with another write
        throw outcome.error;
      }
      if (!transient(code) || attempt > 0) throw outcome.error;
      await pause(delay(code));
    }
    record(key, json);
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
        collections.map((name) => read(() => db.collection(name).limit(1000).get())),
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
